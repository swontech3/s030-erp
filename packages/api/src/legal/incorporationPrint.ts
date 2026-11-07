/**
 * 법인설립 서류 출력(10-5, 2026-10-11) — `GET /legal/incorporations/:id/print?applyDate=&writeDate=` · 출력 이력(043).
 *
 * 법인변경(`legal/corpChangePrint.ts`)과 같은 모양이다. 규칙은 shared `incorporation-print.ts` ·
 * `legal-form-mark.ts` 에 있고, 이 파일은 읽고 · 복호화하고 · 묶을 뿐이다.
 *
 * =============================================================================
 * ★★★ 주민번호는 이 함수 안에서만 평문이 된다
 * =============================================================================
 *   · 설립 서류는 건마다 서류의 목록 칸(이사 · 감사 · 발기인 · 조사보고인)에도 주민번호가 든다(레거시와 같다).
 *     사람은 모두 역할이 하나 이상이라(작성완료 검증) 어느 서류엔가 든다 — 그래서 설립 양식이 하나라도
 *     있으면 사람 전부를 복호화한다. 설립 양식이 없으면 복호화하지 않는다
 *   · 평문은 응답 값으로만 나간다. 저장 · 로그 · 스냅샷 · 오류 문구에 남기지 않는다. 응답은 no-store(라우트)
 *   · 복호화가 실패하면 **출력하지 않는다**(409)
 *
 * ★★ 값은 작성완료 스냅샷이다. 주민번호만 DB 사람 줄에서 꺼낸다 — E · C 에서는 사람을 고칠 수 없으므로
 *    같은 순서 · 같은 사람이다. 그래도 **짝이 어긋나면 출력하지 않는다**(409).
 *
 * 누가 부르나 — 운영사 · 회사 모두. 건이 보이는지는 RLS(042)가 가른다. 안 보이면 404.
 * 출력 이력(043) — [인쇄] 를 누를 때 한 줄. 기록이 실패해도 인쇄는 막지 않는다(라우트가 로그에 남긴다).
 */
import { randomUUID } from 'node:crypto';
import type { ErpSession } from '@swonbiz/shared';
import { canPrintCorpChange } from '@swonbiz/shared/domain/corp-change';
import { parsePrintInputs, parsePrintLogBody, pickDocFormSetting } from '@swonbiz/shared/domain/corp-change-print';
import { incorpTaxSettingOf } from '@swonbiz/shared/domain/doc-form-setting';
import { definitionTokens, migrateDefinition, type FormDefinition } from '@swonbiz/shared/domain/form-template';
import { INCORP_METHOD_CATEGORY, INCORP_METHOD_USE_TP, incorpMethodOf } from '@swonbiz/shared/domain/incorporation';
import {
  buildIncorpPrintDocuments,
  readIncorporationSnapshot,
  type IncorpMarkedForm,
  type IncorpPrintLogItem,
  type IncorpPrintPerson,
  type IncorporationPrintResponse,
} from '@swonbiz/shared/domain/incorporation-print';
import { incorpMarkCompanyType, personsForIncorpMark } from '@swonbiz/shared/domain/legal-form-mark';
import { decrypt } from '../lib/crypto.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { listMarkedFormTemplates } from '../db/formTemplates.ts';
import { listIncorporationSettings } from '../db/docFormSettings.ts';
import {
  getIncorporation,
  insertIncorpPrintLog,
  listIncorpPersonSecrets,
  listIncorpPrintLogs,
  readIncorporationSnapshotRaw,
} from '../db/incorporations.ts';
import type { OpResult } from './corpChangeOps.ts';

const fail = (status: 400 | 404 | 409, error: string, message: string, field?: string): OpResult<never> =>
  field
    ? { ok: false, status, error, message, errors: [{ field, message }] }
    : { ok: false, status, error, message };

const NOT_FOUND = () => fail(404, 'not_found', '법인설립 건을 찾을 수 없습니다');
const NOT_PRINTABLE = () => fail(409, 'not_printable', '서류는 작성완료 · 완료 건만 출력할 수 있습니다');
const NO_SNAPSHOT = () => fail(409, 'no_snapshot', '작성완료 기록이 없습니다 — [서류수정] 뒤 다시 작성완료해 주세요');

/**
 * 법인설립 표시가 붙은 양식들 — 정의를 읽지 못하는 양식은 **건너뛴다**(법인변경과 같다).
 * 자리표시 목록(`tokens`)은 「해당 사람 없음」 안내가 그 양식에 붙는지 볼 때 쓴다.
 */
async function incorporationForms(client: ScopedClient): Promise<IncorpMarkedForm<FormDefinition>[]> {
  const out: IncorpMarkedForm<FormDefinition>[] = [];
  for (const r of await listMarkedFormTemplates(client)) {
    try {
      const definition = migrateDefinition(r.definition);
      if (definition.legal?.domain === 'incorporation') {
        out.push({ id: r.id, name: r.name, mark: definition.legal, definition, tokens: definitionTokens(definition) });
      }
    } catch {
      // 위 머리말 — 건너뛴다
    }
  }
  return out;
}

export async function readIncorporationPrint(
  client: ScopedClient,
  _session: ErpSession,
  id: string,
  query: Record<string, unknown>,
): Promise<OpResult<IncorporationPrintResponse<FormDefinition>>> {
  const inputs = parsePrintInputs(query);
  if (!inputs.ok) return fail(400, 'invalid_request', inputs.message, inputs.field);

  const row = await getIncorporation(client, id);
  if (!row) return NOT_FOUND();
  if (!canPrintCorpChange(row.status)) return NOT_PRINTABLE();
  const snapshot = readIncorporationSnapshot(await readIncorporationSnapshotRaw(client, row.id));
  if (!snapshot) return NO_SNAPSHOT();

  // ★ 차례로 읽는다 — 한 트랜잭션의 클라이언트 하나에 동시에 보내지 않는다(법인변경과 같다)
  const settings = await listIncorporationSettings(client);
  const codes = await listCodes(client, [{ category: INCORP_METHOD_CATEGORY, useTp: INCORP_METHOD_USE_TP }]);
  const forms = await incorporationForms(client);

  // 주민번호 — 설립 양식이 하나라도 있으면 사람 전부(머리말 ★★★)
  const persons: IncorpPrintPerson[] = snapshot.persons.map((p) => ({ ...p, rrn: null }));
  if (forms.length > 0 && persons.length > 0) {
    const secrets = await listIncorpPersonSecrets(client, row.id);
    const paired = secrets.length === persons.length && secrets.every((s, i) => s.name === persons[i]!.name);
    if (!paired) {
      return fail(409, 'person_mismatch', '사람 목록이 작성완료 기록과 다릅니다 — [서류수정] 뒤 다시 작성완료해 주세요');
    }
    for (let i = 0; i < persons.length; i++) {
      const cipher = secrets[i]!.rrnCipher;
      if (cipher === null) continue; // 주민번호는 선택 칸이다 — 빈칸으로 나간다
      try {
        persons[i] = { ...persons[i]!, rrn: decrypt(cipher) };
      } catch {
        return fail(409, 'rrn_unreadable', `${persons[i]!.name} 님의 주민등록번호를 읽을 수 없습니다 — 다시 입력해 주세요`);
      }
    }
  }

  // 설립 구분 — 회사 형태로 정한다(R → R_PROMOTER · A → U_P, 결정 2026-10-31). 서류 묶음도 형태로 가른다(shared)
  const entity = snapshot.entityType;
  const method = incorpMethodOf(entity);
  const documents = buildIncorpPrintDocuments(forms, {
    snapshot,
    persons,
    // ★ 그 구분의 회사유형 줄(R · A)이 있으면 기본 줄 위에 덮는다(법인변경과 같은 고르기). 유한회사 줄이 없으면 설정 칸은 빈칸
    setting: pickDocFormSetting(settings, method, entity),
    // 세율 · 최소액 · 배수 · 수수료 — 그 구분 **기본 줄**의 taxes(2026-10-18, 090). 끈 줄 · 빈 값이면 세금 칸 빈칸
    taxSetting: incorpTaxSettingOf(settings, method),
    methodName: codes.find((c) => c.code === method)?.name ?? null,
    inputs: inputs.value,
  });
  return { ok: true, value: { id: row.id, status: row.status, documents } };
}

/**
 * 출력 이력 한 줄 — `{ formId, sheet, applyDate?, writeDate? }`. 성공이면 null.
 * ★ 서류 이름 · 사람 이름은 **서버가** 양식 · 스냅샷에서 찾는다(화면 값을 기록하지 않는다). 주민번호는 복호화하지 않는다.
 */
export async function recordIncorporationPrint(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
): Promise<OpResult<null>> {
  const parsed = parsePrintLogBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.field);
  const input = parsed.value;

  const row = await getIncorporation(client, id);
  if (!row) return NOT_FOUND();
  if (!canPrintCorpChange(row.status)) return NOT_PRINTABLE();
  const snapshot = readIncorporationSnapshot(await readIncorporationSnapshotRaw(client, row.id));
  if (!snapshot) return NO_SNAPSHOT();

  const form = (await incorporationForms(client)).find((f) => f.id === input.formId);
  // ★ 다른 회사 형태의 양식도 이 건에는 뜨지 않는다(결정 2026-10-31)
  if (!form || form.mark.domain !== 'incorporation' || incorpMarkCompanyType(form.mark) !== snapshot.entityType) {
    return fail(400, 'invalid_request', '이 건에 뜨는 서류가 아닙니다', 'formId');
  }

  let personName: string | null = null;
  if (form.mark.domain === 'incorporation' && form.mark.unit !== 'case') {
    const person = personsForIncorpMark(form.mark, snapshot.persons)[input.sheet];
    if (!person) return fail(400, 'invalid_request', '없는 장입니다', 'sheet');
    personName = person.name;
  } else if (input.sheet !== 0) {
    return fail(400, 'invalid_request', '없는 장입니다', 'sheet');
  }

  await insertIncorpPrintLog(client, {
    id: randomUUID(),
    incorporationId: row.id,
    orgId: row.orgId,
    formId: form.id,
    formName: form.name,
    personName,
    applyDate: input.applyDate,
    writeDate: input.writeDate,
    printedBy: String(session.s020MemberId),
    printedRole: session.role,
  });
  return { ok: true, value: null };
}

/** 그 건의 출력 이력 — 건이 보여야 한다(안 보이면 404). 줄은 RLS 가 한 번 더 가른다. */
export async function listIncorporationPrints(
  client: ScopedClient,
  id: string,
): Promise<OpResult<{ items: IncorpPrintLogItem[] }>> {
  const row = await getIncorporation(client, id);
  if (!row) return NOT_FOUND();
  return { ok: true, value: { items: await listIncorpPrintLogs(client, row.id) } };
}
