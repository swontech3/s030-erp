/**
 * 세무 설정(s050100010, 세무 S05) — `GET · PUT /tax/settings` (1-1, 2026-10-25).
 *
 *   GET  /tax/settings   설정 · 계좌 · 카드 · 코드(이름과 설명) · 회사 정보
 *   PUT  /tax/settings   [저장] 한 번 = 한 트랜잭션 { bizType, withholdingCycle, taxEmails[], unusedKinds[], finAccounts[] }
 *                        — 새 상태를 GET 과 같은 모양으로 돌려준다
 *
 * =============================================================================
 * ★★★ 운영사 세션도 **자기 단체만** — 모든 조회 · 저장에 `org_id = 세션 단체 ID` 를 직접 건다
 * =============================================================================
 * 법무와 달리 세무에는 「운영사가 남의 회사를 보는」 화면이 없다(시안). 그런데 운영사 세션은 RLS 로는
 * 모든 단체가 보인다. 그래서 단체는 언제나 `session.s020OrgId` 하나이고(`db/taxSettings.ts` 가 직접 건다),
 * DB 연결은 `scopeOfSession` 이다 — 회사 세션은 RLS(201)가 한 번 더 막는다.
 * ★ 역할로 403 을 내지 않는다(법무 라우트와 같다). 화면 번호 확인도 법무처럼 화면(`requireScreen`)이 한다 —
 *   API 라우트는 세션만 본다.
 *
 * ★ 저장 규칙은 shared `tax-settings.ts` 머리말. 코드값이 살아 있는지는 여기서 코드 표를 읽어 넘긴다.
 * ★ 계좌 · 카드는 **id 를 유지한다** — 있는 줄은 고치고, 새 줄은 넣고, 보낸 목록에 없는 줄은 지운다.
 *   보낸 id 가 이 단체의 줄이 아니면(남의 단체 · 없는 id) **404** 이고 아무것도 쓰지 않는다(법무와 같이 둘을 가르지 않는다).
 * ★ 회사 정보는 법무 `readCompanySource` 를 **고치지 않고** 부른다 — 입주사면 ERP 회사 표, 아니면 법무 회사 정보.
 *   둘 다 없으면 회사명만 세션 값(삐용 my-orgs → `getProfile`)이고 번호는 비운다. 번호는 숫자만 내려 준다.
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import { digitsOnly } from '@swonbiz/shared/domain/tax-number';
import {
  BANK_CATEGORY,
  CARD_COMPANY_CATEGORY,
  TAX_BIZ_TP_CATEGORY,
  TAX_CODE_USE_TP,
  TAX_FIN_KIND_CATEGORY,
  TAX_KIND_CATEGORY,
  TAX_WH_CYCLE_CATEGORY,
  TAX_WH_CYCLE_DEFAULT,
  parseTaxSettingsSave,
  type TaxCodeOption,
  type TaxCodeSets,
  type TaxCompanyInfo,
  type TaxSettingsResponse,
  type TaxSettingsSave,
} from '@swonbiz/shared/domain/tax-settings';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { readCompanySource } from '../db/corpChanges.ts';
import { bbiyongAuth } from '../bbiyong/index.ts';
import {
  deleteFinAccountsExcept,
  insertFinAccount,
  listCodeDescriptions,
  listFinAccounts,
  lockFinAccountIds,
  readTaxSettingsRow,
  updateFinAccount,
  upsertTaxSettings,
} from '../db/taxSettings.ts';

const CATEGORIES = [
  TAX_BIZ_TP_CATEGORY,
  TAX_WH_CYCLE_CATEGORY,
  TAX_KIND_CATEGORY,
  TAX_FIN_KIND_CATEGORY,
  BANK_CATEGORY,
  CARD_COMPANY_CATEGORY,
] as const;

type CodeOptions = TaxSettingsResponse['codes'];

/** 코드 — 이름 · 순서는 `listCodes`, 설명은 세무의 새 조회. 켜진 코드만. */
export async function loadTaxCodes(client: ScopedClient): Promise<CodeOptions> {
  // ★ 차례로 읽는다 — 한 트랜잭션의 클라이언트 하나에 동시에 보내지 않는다
  const rows = await listCodes(client, CATEGORIES.map((category) => ({ category, useTp: TAX_CODE_USE_TP })));
  const descs = await listCodeDescriptions(client, CATEGORIES, TAX_CODE_USE_TP);
  const pick = (category: string): TaxCodeOption[] =>
    rows
      .filter((r) => r.category === category)
      .map((r) => ({
        code: r.code,
        name: r.name,
        description: descs.find((d) => d.category === category && d.code === r.code)?.description ?? null,
      }));
  return {
    bizTypes: pick(TAX_BIZ_TP_CATEGORY),
    withholdingCycles: pick(TAX_WH_CYCLE_CATEGORY),
    kinds: pick(TAX_KIND_CATEGORY),
    finKinds: pick(TAX_FIN_KIND_CATEGORY),
    banks: pick(BANK_CATEGORY),
    cardCompanies: pick(CARD_COMPANY_CATEGORY),
  };
}

/** 본문 검사에 쓰는 코드값만. */
export function codeSetsOf(codes: CodeOptions): TaxCodeSets {
  const values = (list: TaxCodeOption[]) => list.map((c) => c.code);
  return {
    bizTypes: values(codes.bizTypes),
    withholdingCycles: values(codes.withholdingCycles),
    kinds: values(codes.kinds),
    banks: values(codes.banks),
    cardCompanies: values(codes.cardCompanies),
  };
}

/** 회사 정보(DB 쪽) — 회사명이 없으면 null 로 두고, 라우트가 세션 값으로 채운다(`withSessionName`). */
async function companyOf(client: ScopedClient, orgId: number): Promise<TaxCompanyInfo> {
  const src = await readCompanySource(client, orgId);
  const num = (v: string | null) => (v && digitsOnly(v) !== '' ? digitsOnly(v) : null);
  if (!src.isTenant && !src.hasLegalOrg) return { source: 'none', name: null, bizNumber: null, corpNumber: null };
  return {
    source: src.isTenant ? 'tenant' : 'legal',
    name: src.legalName,
    bizNumber: num(src.bizNumber),
    corpNumber: num(src.corpNumber),
  };
}

/** 읽기 — 이 단체(`orgId` = 세션 단체 ID)의 것만. */
export async function readTaxSettingsOp(client: ScopedClient, orgId: number): Promise<TaxSettingsResponse> {
  const row = await readTaxSettingsRow(client, orgId);
  const finAccounts = await listFinAccounts(client, orgId);
  const codes = await loadTaxCodes(client);
  const company = await companyOf(client, orgId);
  return {
    settings: row
      ? { saved: true, ...row }
      : { saved: false, bizType: null, withholdingCycle: TAX_WH_CYCLE_DEFAULT, taxEmails: [], unusedKinds: [] },
    finAccounts,
    codes,
    company,
  };
}

export type TaxSaveResult = { ok: true; data: TaxSettingsResponse } | { ok: false; status: 404; message: string };

/**
 * 저장 — 한 트랜잭션 안에서 부른다. 보낸 id 가 하나라도 이 단체의 줄이 아니면 **쓰기 전에** 404.
 * 계좌 · 카드 순서는 구분마다 보낸 순서다.
 */
export async function saveTaxSettingsOp(
  client: ScopedClient,
  orgId: number,
  save: TaxSettingsSave,
  actor: string,
): Promise<TaxSaveResult> {
  const existing = new Set(await lockFinAccountIds(client, orgId));
  if (save.finAccounts.some((a) => a.id !== null && !existing.has(a.id))) {
    return { ok: false, status: 404, message: '없는 계좌 · 카드입니다' };
  }

  await upsertTaxSettings(client, orgId, save, actor);
  await deleteFinAccountsExcept(
    client,
    orgId,
    save.finAccounts.flatMap((a) => (a.id === null ? [] : [a.id])),
  );
  const order = new Map<string, number>();
  for (const a of save.finAccounts) {
    const sortOrder = order.get(a.kind) ?? 0;
    order.set(a.kind, sortOrder + 1);
    if (a.id === null) await insertFinAccount(client, orgId, a, sortOrder, actor);
    else await updateFinAccount(client, orgId, { ...a, id: a.id }, sortOrder, actor);
  }
  return { ok: true, data: await readTaxSettingsOp(client, orgId) };
}

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 본문 · 역할 · 404 를 본다. */
export interface TaxSettingsDeps {
  /** 본문 검사에 쓰는 살아 있는 코드값. */
  codeSets(session: ErpSession): Promise<TaxCodeSets>;
  read(session: ErpSession): Promise<TaxSettingsResponse>;
  save(session: ErpSession, save: TaxSettingsSave): Promise<TaxSaveResult>;
}

const run = <T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>) =>
  withCompanyScope(scopeOfSession(session), fn);

/**
 * 회사 정보가 둘 다 없으면 회사명만 세션 값(삐용 my-orgs → `getProfile`). 삐용 호출은 트랜잭션 **밖에서**.
 * ★ 조회 실패는 화면을 깨뜨리지 않는다 — 회사명이 빈 채로 간다.
 */
async function withSessionName(session: ErpSession, data: TaxSettingsResponse): Promise<TaxSettingsResponse> {
  if (data.company.source !== 'none') return data;
  let name: string | null = null;
  try {
    name = (await bbiyongAuth.getProfile(session.s020MemberId))?.orgName || null;
  } catch {
    name = null;
  }
  return { ...data, company: { ...data.company, name } };
}

const defaultDeps: TaxSettingsDeps = {
  codeSets: async (session) => codeSetsOf(await run(session, loadTaxCodes)),
  read: async (session) => withSessionName(session, await run(session, (c) => readTaxSettingsOp(c, session.s020OrgId))),
  save: async (session, save) => {
    const r = await run(session, (c) => saveTaxSettingsOp(c, session.s020OrgId, save, String(session.s020MemberId)));
    return r.ok ? { ok: true, data: await withSessionName(session, r.data) } : r;
  },
};

export function registerTaxSettingRoutes(app: FastifyInstance, deps: TaxSettingsDeps = defaultDeps): void {
  app.get('/tax/settings', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    return reply.send(await deps.read(session));
  });

  app.put<{ Body: unknown }>('/tax/settings', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const parsed = parseTaxSettingsSave(req.body, await deps.codeSets(session));
    if (!parsed.ok) {
      return reply.code(400).send({ error: 'invalid_request', message: parsed.errors[0]!.message, errors: parsed.errors });
    }
    const r = await deps.save(session, parsed.value);
    if (!r.ok) return reply.code(404).send({ error: 'not_found', message: r.message });
    return reply.send(r.data);
  });
}
