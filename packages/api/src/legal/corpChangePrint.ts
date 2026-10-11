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
 */
import type { ErpSession } from '@swonbiz/shared';
import {
  CORP_CHANGE_CODE_USE_TP,
  CORP_CHANGE_TYPE_CATEGORY,
  canPrintCorpChange,
} from '@swonbiz/shared/domain/corp-change';
import {
  buildPrintDocuments,
  parsePrintInputs,
  pickDocFormSetting,
  readSubmitSnapshot,
  type CorpChangePrintResponse,
  type MarkedForm,
  type PrintOfficer,
} from '@swonbiz/shared/domain/corp-change-print';
import { migrateDefinition, type FormDefinition } from '@swonbiz/shared/domain/form-template';
import { officersForMark } from '@swonbiz/shared/domain/legal-form-mark';
import { decrypt } from '../lib/crypto.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { getCorpChange, listOfficerSecrets, readSubmitSnapshotRaw } from '../db/corpChanges.ts';
import { listMarkedFormTemplates } from '../db/formTemplates.ts';
import { listCorpChangeSettings } from '../db/docFormSettings.ts';
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

  const [settings, codes, forms] = await Promise.all([
    listCorpChangeSettings(client),
    listCodes(client, [{ category: CORP_CHANGE_TYPE_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP }]),
    markedForms(client),
  ]);
  const src = {
    snapshot,
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

  return {
    ok: true,
    value: {
      id: row.id,
      changeType: row.changeType,
      status: row.status,
      documents: buildPrintDocuments(forms, src, officers),
    },
  };
}
