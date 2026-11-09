/**
 * 법인변경 서류 출력(5-2, 2026-10-11) — `GET /legal/corp-changes/:id/print?applyDate=&writeDate=`.
 *
 * 규칙은 shared `corp-change-print.ts` · `legal-form-mark.ts` 에 있다. 이 파일은 읽고, 복호화하고,
 * 묶을 뿐이다.
 *
 * =============================================================================
 * ★★★ 주민번호는 이 함수 안에서만 평문이 된다 (Q4)
 * =============================================================================
 *   · 임원마다 양식의 장에 드는 임원만 복호화한다 — 쓰지 않을 평문을 만들지 않는다
 *   · 평문은 응답 값(`officerRrn`)으로만 나간다. 저장 · 로그 · 스냅샷에 남기지 않는다
 *     (오류 문구에도 넣지 않는다). 응답은 `Cache-Control: no-store`(라우트)
 *   · 복호화가 실패하면 **출력하지 않는다**(409) — 빈 주민번호로 서류가 나가면 아무도 모른다
 *
 * =============================================================================
 * ★★ 값은 작성완료 스냅샷이다 — 지금의 회사 정보가 아니다
 * =============================================================================
 * 상호변경이 끝나 회사명이 바뀌어도 서류는 작성완료 당시(= 변경 전) 값으로 나온다(4단계 머리말).
 * 임원도 스냅샷의 임원이다. 주민번호만 스냅샷에 없어서(그렇게 정했다) DB 임원 줄에서 꺼낸다 —
 * E · C 에서는 임원을 고칠 수 없으므로 DB 줄과 스냅샷은 같은 순서 · 같은 사람이다. 그래도 **짝이
 * 어긋나면 출력하지 않는다**(409) — 남의 주민번호가 다른 사람 서류에 찍히는 것을 막는다.
 *
 * 누가 부르나 — 운영사 · 회사 모두(Q4). 건이 보이는지는 RLS(037)가 가른다. 안 보이면 404.
 *
 * 출력 이력(040) — `recordCorpChangePrint` · `listCorpChangePrints`. [인쇄] 를 누를 때 한 줄.
 * 기록이 실패해도 인쇄는 막지 않는다(화면이 결과를 기다리지 않는다 — 실패는 서버 로그, 라우트).
 */
import type { ErpSession } from '@swonbiz/shared';
import {
  CORP_CHANGE_CODE_USE_TP,
  CORP_CHANGE_TYPE_CATEGORY,
  articlesChangeNotice,
  canPrintCorpChange,
} from '@swonbiz/shared/domain/corp-change';
import { randomUUID } from 'node:crypto';
import {
  buildPrintDocuments,
  parsePrintInputs,
  parsePrintLogBody,
  type PrintDocument,
  type PrintLogItem,
  pickDocFormSetting,
  readSubmitSnapshot,
  type CorpChangePrintResponse,
  type MarkedForm,
  type PrintOfficer,
} from '@swonbiz/shared/domain/corp-change-print';
import type { CorpChangeSubmitSnapshot } from '@swonbiz/shared/domain/corp-change-transition';
import { migrateDefinition, type FormDefinition } from '@swonbiz/shared/domain/form-template';
import { markAppliesTo, officersForMark } from '@swonbiz/shared/domain/legal-form-mark';
import {
  AMENDED_ARTICLES_FORM_ID,
  AMENDED_ARTICLES_NAME,
  AMENDED_ARTICLES_REPRINT_NOTICE,
  amendedArticlesCompanyName,
  amendedArticlesDefinition,
  applyArticleChanges,
  articlesRolesFor,
} from '@swonbiz/shared/domain/legal-articles';
import { decrypt } from '../lib/crypto.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import {
  getCorpChange,
  insertPrintLog,
  listOfficerSecrets,
  listPrintLogs,
  readSubmitSnapshotRaw,
} from '../db/corpChanges.ts';
import { listMarkedFormTemplates } from '../db/formTemplates.ts';
import { listCorpChangeSettings } from '../db/docFormSettings.ts';
import { getArticlesHead, listArticleItems } from '../db/legalArticles.ts';
import { articleContextOfSnapshot, readArticlesRules } from './articlesOps.ts';
import { completedIncorpNamePosition } from '../db/incorporations.ts';
import type { OpResult } from './corpChangeOps.ts';

const fail = (status: 400 | 404 | 409, error: string, message: string, field?: string): OpResult<never> =>
  field
    ? { ok: false, status, error, message, errors: [{ field, message }] }
    : { ok: false, status, error, message };

/**
 * 법무 표시가 붙은 양식들 — 정의를 읽지 못하는 양식은 **건너뛴다**(그 양식 하나 때문에 다른
 * 서류까지 못 뽑게 하지 않는다). 표양식 화면이 저장 때 같은 검사를 하므로 정상이면 생기지 않는다.
 */
async function markedForms(client: ScopedClient): Promise<MarkedForm<FormDefinition>[]> {
  const out: MarkedForm<FormDefinition>[] = [];
  for (const r of await listMarkedFormTemplates(client)) {
    try {
      const definition = migrateDefinition(r.definition);
      if (definition.legal) out.push({ id: r.id, name: r.name, mark: definition.legal, definition });
    } catch {
      // 위 머리말 — 건너뛴다
    }
  }
  return out;
}

export async function readCorpChangePrint(
  client: ScopedClient,
  _session: ErpSession,
  id: string,
  query: Record<string, unknown>,
): Promise<OpResult<CorpChangePrintResponse<FormDefinition>>> {
  const inputs = parsePrintInputs(query);
  if (!inputs.ok) return fail(400, 'invalid_request', inputs.message, inputs.field);

  const row = await getCorpChange(client, id);
  if (!row) return fail(404, 'not_found', '법인변경 건을 찾을 수 없습니다');
  if (!canPrintCorpChange(row.status)) return fail(409, 'not_printable', '서류는 작성완료 · 완료 건만 출력할 수 있습니다');

  const snapshot = readSubmitSnapshot(await readSubmitSnapshotRaw(client, row.id));
  if (!snapshot || snapshot.changeType !== row.changeType) {
    return fail(409, 'no_snapshot', '작성완료 기록이 없습니다 — [서류수정] 뒤 다시 작성완료해 주세요');
  }

  // ★ 차례로 읽는다 — 한 트랜잭션의 클라이언트 하나에 동시에 보내지 않는다(pg 가 줄 세우지만 pg@9 에서 막힌다)
  const settings = await listCorpChangeSettings(client);
  const codes = await listCodes(client, [{ category: CORP_CHANGE_TYPE_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP }]);
  const forms = await markedForms(client);
  // 상호 낱말 위치 — 그 단체의 완료된 법인설립 건(없으면 앞, 결정 2026-11-06)
  const namePosition = await completedIncorpNamePosition(client, row.orgId);
  const src = {
    snapshot,
    namePosition,
    setting: pickDocFormSetting(settings, snapshot.changeType, snapshot.company.memberType),
    changeTypeName: codes.find((c) => c.code === snapshot.changeType)?.name ?? null,
    inputs: inputs.value,
  };

  // 주민번호 — 임원마다 양식의 장에 드는 임원만 복호화한다(머리말 ★★★)
  const officers: PrintOfficer[] = snapshot.officers.map((o) => ({ ...o, rrn: null }));
  const needed = new Set<number>();
  for (const f of forms) {
    if (f.mark.unit !== 'officer') continue;
    for (const o of officersForMark(f.mark, officers)) needed.add(officers.indexOf(o));
  }
  if (needed.size > 0) {
    const secrets = await listOfficerSecrets(client, row.id);
    const paired =
      secrets.length === officers.length &&
      secrets.every((s, i) => s.name === officers[i]!.name && s.changeKind === officers[i]!.changeKind);
    if (!paired) {
      return fail(409, 'officer_mismatch', '임원 목록이 작성완료 기록과 다릅니다 — [서류수정] 뒤 다시 작성완료해 주세요');
    }
    for (const i of needed) {
      const cipher = secrets[i]!.rrnCipher;
      if (cipher === null) continue; // 주민번호는 선택 칸이다 — 빈칸으로 나간다
      try {
        officers[i] = { ...officers[i]!, rrn: decrypt(cipher) };
      } catch {
        return fail(409, 'rrn_unreadable', `${officers[i]!.name} 임원의 주민등록번호를 읽을 수 없습니다 — 다시 입력해 주세요`);
      }
    }
  }

  const documents = buildPrintDocuments(forms, src, officers);
  const amended = await amendedArticles(client, row, snapshot, namePosition);
  if (amended) documents.push(amended);
  return {
    ok: true,
    value: {
      id: row.id,
      changeType: row.changeType,
      status: row.status,
      documents,
      articlesNotice: await articlesNoticeOf(client, row, snapshot, amended !== null),
    },
  };
}

/**
 * 「변경된 정관」(2026-11-08, 설계 §3-3 · §8-1~§8-4) — 작성완료 스냅샷에 바뀐 조항이 있고 최종본이 있을 때만, 목록 맨 끝.
 * 지금 최종본에 이 건의 바뀐 조항을 넣고 개정 부칙을 덧붙인다(완료 뒤에는 이미 들어 있어 그대로 — 지금 최종본 기준).
 * ★ 표양식 양식이 아니다 — 정의를 코드가 만든다(표양식 원칙의 예외, §8-1). 자리표시가 없다.
 */
async function amendedArticles(
  client: ScopedClient,
  row: { id: string; orgId: number },
  snapshot: CorpChangeSubmitSnapshot,
  namePosition: string | null,
): Promise<PrintDocument<FormDefinition> | null> {
  const art = snapshot.articles;
  if (!art || art.changes.length === 0) return null;
  const head = await getArticlesHead(client, row.orgId);
  if (!head || head.state !== 'FINAL') return null;
  const resolutionDate = typeof snapshot.payload.resolutionDate === 'string' ? snapshot.payload.resolutionDate : null;
  const items = applyArticleChanges(await listArticleItems(client, row.orgId), art.changes, { changeId: row.id, resolutionDate });
  const ctx = articleContextOfSnapshot(snapshot, namePosition);
  return {
    formId: AMENDED_ARTICLES_FORM_ID,
    name: AMENDED_ARTICLES_NAME,
    unit: 'case',
    definition: amendedArticlesDefinition({
      items,
      companyName: amendedArticlesCompanyName(ctx),
      ceoName: snapshot.company.ceoName ?? '',
      amendedOn: resolutionDate,
    }),
    sheets: [{ officerName: null, values: {} }],
  };
}

/**
 * [서류 출력] 위쪽 안내 한 줄(종이에는 나가지 않는다).
 *   · 「변경된 정관」이 있고 완료된 건 — 지금 최종본 기준으로 나온다(§8-4)
 *   · 정관을 다룬 그 밖의 건(스냅샷에 정관 칸이 있다) — 안내 없음
 *   · 정관을 다루지 않은 정관 변경 건(최종본이 없는 다른 곳 설립 회사 · 이 기능 전에 작성완료한 건) — 지금처럼
 *     「변경된 정관은 따로 준비하세요」(`articlesChangeNotice`, 역할은 공통 코드 LAW_CNG_AR)
 */
async function articlesNoticeOf(
  client: ScopedClient,
  row: { status: string },
  snapshot: CorpChangeSubmitSnapshot,
  hasAmended: boolean,
): Promise<string | null> {
  if (hasAmended) return row.status === 'C' ? AMENDED_ARTICLES_REPRINT_NOTICE : null;
  if (snapshot.articles) return null;
  const roles = articlesRolesFor(snapshot.changeType, await readArticlesRules(client));
  const newHq = snapshot.payload.newHqAddress;
  const newHqAddress = typeof newHq === 'object' && newHq !== null ? (newHq as { address?: unknown }).address : null;
  return articlesChangeNotice(roles, snapshot.company.head.address, typeof newHqAddress === 'string' ? newHqAddress : null);
}

/**
 * 출력 이력 한 줄 — `{ formId, sheet, applyDate?, writeDate? }`. 성공이면 null.
 * 거절: 400 본문 · 이 건에 뜨지 않는 서류 · 없는 장 / 404 안 보이는 건 / 409 출력 불가 상태 · 스냅샷 없음.
 * ★ 서류 이름 · 임원 이름은 **서버가** 양식 · 스냅샷에서 찾는다(화면 값을 기록하지 않는다).
 * ★ 주민번호는 복호화하지 않는다.
 */
export async function recordCorpChangePrint(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
): Promise<OpResult<null>> {
  const parsed = parsePrintLogBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.field);
  const input = parsed.value;

  const row = await getCorpChange(client, id);
  if (!row) return fail(404, 'not_found', '법인변경 건을 찾을 수 없습니다');
  if (!canPrintCorpChange(row.status)) return fail(409, 'not_printable', '서류는 작성완료 · 완료 건만 출력할 수 있습니다');
  const snapshot = readSubmitSnapshot(await readSubmitSnapshotRaw(client, row.id));
  if (!snapshot || snapshot.changeType !== row.changeType) return fail(409, 'no_snapshot', '작성완료 기록이 없습니다');

  // 「변경된 정관」(2026-11-08) — 표양식 양식이 아니다. 이 건에 뜰 때만(스냅샷에 바뀐 조항 · 최종본) 받는다
  if (input.formId === AMENDED_ARTICLES_FORM_ID) {
    const shown =
      (snapshot.articles?.changes.length ?? 0) > 0 && (await getArticlesHead(client, row.orgId))?.state === 'FINAL';
    if (!shown) return fail(400, 'invalid_request', '이 건에 뜨는 서류가 아닙니다', 'formId');
    if (input.sheet !== 0) return fail(400, 'invalid_request', '없는 장입니다', 'sheet');
    await insertPrintLog(client, {
      id: randomUUID(),
      corpChangeId: row.id,
      orgId: row.orgId,
      formId: AMENDED_ARTICLES_FORM_ID,
      formName: AMENDED_ARTICLES_NAME,
      officerName: null,
      applyDate: input.applyDate,
      writeDate: input.writeDate,
      printedBy: String(session.s020MemberId),
      printedRole: session.role,
    });
    return { ok: true, value: null };
  }

  const form = (await markedForms(client)).find(
    (f) => f.id === input.formId && markAppliesTo(f.mark, snapshot.changeType, snapshot.company.memberType),
  );
  if (!form) return fail(400, 'invalid_request', '이 건에 뜨는 서류가 아닙니다', 'formId');

  let officerName: string | null = null;
  if (form.mark.unit === 'officer') {
    const officer = officersForMark(form.mark, snapshot.officers)[input.sheet];
    if (!officer) return fail(400, 'invalid_request', '없는 장입니다', 'sheet');
    officerName = officer.name;
  } else if (input.sheet !== 0) {
    return fail(400, 'invalid_request', '없는 장입니다', 'sheet');
  }

  await insertPrintLog(client, {
    id: randomUUID(),
    corpChangeId: row.id,
    orgId: row.orgId,
    formId: form.id,
    formName: form.name,
    officerName,
    applyDate: input.applyDate,
    writeDate: input.writeDate,
    printedBy: String(session.s020MemberId),
    printedRole: session.role,
  });
  return { ok: true, value: null };
}

/** 그 건의 출력 이력 — 건이 보여야 한다(안 보이면 404). 줄은 RLS 가 한 번 더 가른다. */
export async function listCorpChangePrints(
  client: ScopedClient,
  id: string,
): Promise<OpResult<{ items: PrintLogItem[] }>> {
  const row = await getCorpChange(client, id);
  if (!row) return fail(404, 'not_found', '법인변경 건을 찾을 수 없습니다');
  return { ok: true, value: { items: await listPrintLogs(client, row.id) } };
}
