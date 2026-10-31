/**
 * 법인설립 처리 — 목록 · 임시 모드 · 첫 저장 · 상세 · 설립 정보 · 사람 · 상태 전이 · 삭제(10-3, 2026-10-11).
 *
 * 법인변경(`legal/corpChangeOps.ts`)과 같은 규칙이다 — 라우트는 본문 읽기와 응답만, **판정은 여기서**:
 *   · 건은 첫 [저장] 때 생긴다 — 건 + 설립 정보 + 사람 전부를 한 트랜잭션으로
 *   · 모든 함수는 `scopeOfSession` 스코프의 클라이언트를 받는다. 건이 안 보이면 404(없음 · 남의 단체를 가르지 않는다)
 *   · 고칠 수 있는 상태는 서류작성중(P)뿐이다 — 아니면 409
 *   · 상태 전이 판정은 법인변경과 같은 표(`checkIncorporationTransition` → `checkLegalTransition`)
 *   · 주민번호 평문은 받아서 바로 암호화할 뿐이다 — 응답은 마스킹뿐
 *
 * ★★ ERP 회사표에 쓰지 않는다(결정 2026-10-11). 완료(E→C)도 상태만 바꾼다 — ERP 반영은 링크 안내.
 * ★ 상호 표기위치는 코드표 `NAME_POSITION` 에 있는 값만(F · B). 비면 기본값 F 로 저장한다(결정 2026-10-11).
 * ★ 회사 형태(결정 2026-10-31)는 코드표 `MEMBER_TYPE`/001 에 켜져 있는 R · A 만 — 새 건을 만들 때만 받는다.
 *   형태가 이름표 · 검증 · 경고 · 상호 합치기를 가른다(shared `incorporation.ts`).
 */
import { randomUUID } from 'node:crypto';
import type { ErpSession } from '@swonbiz/shared';
import {
  CORP_CHANGE_CODE_USE_TP,
  CORP_CHANGE_STATUS_CATEGORY,
  INITIAL_CORP_CHANGE_STATUS,
  availableTransitions,
  canEditCorpChange,
  checkDelete,
  isCorpChangeStatus,
  type CorpChangeStatus,
  type TransitionRefusal,
} from '@swonbiz/shared/domain/corp-change';
import { STALE_STATUS_MESSAGE, parseSeenStatus, parseTransitionBody } from '@swonbiz/shared/domain/corp-change-transition';
import { maskRrn, type OrgTarget } from '@swonbiz/shared/domain/corp-change-detail';
import {
  INCORP_ENTITY_CATEGORY,
  INCORP_ENTITY_TYPE,
  INCORP_ENTITY_USE_TP,
  checkIncorporationTransition,
  incorporationWarnings,
  isIncorpEntityType,
  type IncorporationPersonInput,
} from '@swonbiz/shared/domain/incorporation';
import {
  DEFAULT_NAME_POSITION,
  NAME_POSITION_CATEGORY,
  NAME_POSITION_USE_TP,
  buildIncorporationSnapshot,
  composeIncorporationName,
  incorporationDisplayName,
  parseIncorpInfo,
  parseIncorpPersonBody,
  type IncorpFirstSaveInput,
  type IncorpInfoInput,
  type IncorpPersonView,
  type IncorporationDetailResponse,
  type IncorporationDraftResponse,
  type IncorporationListFilter,
  type IncorporationListItem,
  type IncorporationListResponse,
} from '@swonbiz/shared/domain/incorporation-detail';
import { pickCorpChangeOptions, type CodeOption } from '@swonbiz/shared/domain/corp-change-list';
import { encrypt } from '../lib/crypto.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { tenantOrgCode, type RrnStored } from '../db/corpChanges.ts';
import {
  deleteIncorpPerson,
  deleteIncorporation,
  getIncorporation,
  insertIncorpPerson,
  insertIncorporation,
  listIncorpPersons,
  listIncorporations,
  touchIncorporation,
  updateIncorpPerson,
  updateIncorporationInfo,
  updateIncorporationStatus,
  type IncorporationRow,
} from '../db/incorporations.ts';
import type { OpError, OpResult } from './corpChangeOps.ts';

const fail = (status: OpError['status'], error: string, message: string, errors?: OpError['errors']): OpError =>
  errors ? { ok: false, status, error, message, errors } : { ok: false, status, error, message };
const NOT_FOUND = fail(404, 'not_found', '법인설립 건을 찾을 수 없습니다');
const NOT_EDITABLE = fail(409, 'not_editable', '서류작성중일 때만 고칠 수 있습니다');
const STALE = fail(409, 'stale_status', STALE_STATUS_MESSAGE);

/** 판정 거절 → 응답 상태 — 법인변경과 같다. */
const REFUSAL_STATUS: Readonly<Record<TransitionRefusal, OpError['status']>> = {
  invalid: 400,
  forbidden: 403,
  not_allowed: 409,
  restore_target: 409,
  unknown_status: 409,
};

const actorOf = (session: { s020MemberId: number }) => String(session.s020MemberId);
const sealRrn = (digits: string): RrnStored => ({ cipher: encrypt(digits), masked: maskRrn(digits) });

/** 단체코드(표시용) — 법인변경과 같다(운영사 = 팝업 값, 회사 = ERP 의 입주사 코드 또는 null). */
async function orgCodeFor(client: ScopedClient, session: ErpSession, target: OrgTarget): Promise<string | null> {
  return session.role === 'operator' ? target.orgCode : tenantOrgCode(client, target.orgId);
}

async function namePositions(client: ScopedClient): Promise<CodeOption[]> {
  return (await listCodes(client, [{ category: NAME_POSITION_CATEGORY, useTp: NAME_POSITION_USE_TP }])).map((c) => ({
    code: c.code,
    name: c.name,
  }));
}

/** 회사 형태 선택지 — 코드표 `MEMBER_TYPE`/001 에 켜진 것 중 앱이 다루는 R · A(코드표 순서). */
async function entityTypes(client: ScopedClient): Promise<CodeOption[]> {
  return (await listCodes(client, [{ category: INCORP_ENTITY_CATEGORY, useTp: INCORP_ENTITY_USE_TP }]))
    .filter((c) => isIncorpEntityType(c.code))
    .map((c) => ({ code: c.code, name: c.name }));
}

async function statusName(client: ScopedClient, status: string): Promise<string> {
  const codes = await listCodes(client, [{ category: CORP_CHANGE_STATUS_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP }]);
  return codes.find((c) => c.code === status)?.name ?? status;
}

/**
 * 위치를 코드표로 확인하고, 비었으면 기본값(F)으로 채운다. 코드표에 없으면 400(자리 `info.companyTypePosition`).
 * ★ 코드표가 비어 있으면(코드 관리에서 지웠다) 기본값만 받는다 — F 는 앱이 쓰는 값이다.
 */
async function settlePosition(client: ScopedClient, info: IncorpInfoInput): Promise<OpResult<IncorpInfoInput>> {
  const pos = info.companyTypePosition ?? DEFAULT_NAME_POSITION;
  const allowed = await namePositions(client);
  if (pos !== DEFAULT_NAME_POSITION && !allowed.some((c) => c.code === pos)) {
    const message = '상호 표기위치가 올바르지 않습니다';
    return fail(400, 'invalid_request', message, [{ field: 'info.companyTypePosition', message }]);
  }
  return { ok: true, value: { ...info, companyTypePosition: pos } };
}

/** 저장된 사람 → 검증 모양. 주민번호는 넘기지 않는다(암호문이고, 형식은 입력 때 봤다). */
const personForValidation = (p: IncorpPersonView): IncorporationPersonInput => ({
  name: p.name,
  isFounder: p.isFounder,
  isDirector: p.isDirector,
  isAuditor: p.isAuditor,
  isRepresentative: p.isRepresentative,
  unitsSubscribed: p.unitsSubscribed,
  appointmentDate: p.appointmentDate,
});

// =============================================================================
// 목록
// =============================================================================

/** 목록 + 상태 선택지 · 이름(법인변경 목록과 같은 모양 — 구분 선택지는 없다). */
export async function listIncorporationItems(client: ScopedClient, f: IncorporationListFilter): Promise<IncorporationListResponse> {
  const statusRows = await listCodes(client, [{ category: CORP_CHANGE_STATUS_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP }]);
  const { statuses, statusNames } = pickCorpChangeOptions([], statusRows.map(({ code, name }) => ({ code, name })));
  const items: IncorporationListItem[] = (await listIncorporations(client, f)).map((r) => ({
    id: r.id,
    orgId: r.org_id,
    orgCode: r.org_code,
    composedName: composeIncorporationName(r.name_ko, r.company_type_position, isIncorpEntityType(r.entity_type) ? r.entity_type : INCORP_ENTITY_TYPE) || null,
    status: r.status,
    createdOn: r.created_on,
    plannedDate: r.planned_date,
  }));
  return { items, statuses, statusNames };
}

// =============================================================================
// 임시 모드 · 첫 저장
// =============================================================================

/** 임시 모드 — 건을 읽지 않는다. 단체 · 상태 · 위치 선택지만. 단체는 `parseIncorpOrgTarget` 을 거친 것이다. */
export async function readIncorporationDraft(
  client: ScopedClient,
  session: ErpSession,
  target: OrgTarget,
): Promise<OpResult<IncorporationDraftResponse>> {
  const orgCode = await orgCodeFor(client, session, target);
  return {
    ok: true,
    value: {
      orgId: target.orgId,
      orgCode,
      status: INITIAL_CORP_CHANGE_STATUS,
      statusName: await statusName(client, INITIAL_CORP_CHANGE_STATUS),
      displayName: incorporationDisplayName('', { orgId: target.orgId, orgCode }),
      namePositions: await namePositions(client),
      defaultNamePosition: DEFAULT_NAME_POSITION,
      entityTypes: await entityTypes(client),
      defaultEntityType: INCORP_ENTITY_TYPE,
    },
  };
}

/**
 * 첫 [저장] — 건(P) + 설립 정보 + 사람 전부를 한 번에. 본문은 `parseIncorpFirstSave` 가 다 읽었다.
 * 남의 단체는 거기서 403, DB 의 RLS `WITH CHECK` 가 한 번 더 막는다(막히면 트랜잭션째 되돌아간다).
 */
export async function createIncorporation(
  client: ScopedClient,
  session: ErpSession,
  input: IncorpFirstSaveInput,
): Promise<OpResult<{ id: string }>> {
  // 회사 형태 — 기본값(R)이 아니면 코드표에 켜져 있어야 한다(위치와 같은 규칙, 자리 `entityType`)
  if (input.entityType !== INCORP_ENTITY_TYPE && !(await entityTypes(client)).some((c) => c.code === input.entityType)) {
    const message = '회사 형태가 올바르지 않습니다';
    return fail(400, 'invalid_request', message, [{ field: 'entityType', message }]);
  }
  const settled = await settlePosition(client, input.info);
  if (!settled.ok) return settled;

  const id = randomUUID();
  await insertIncorporation(client, {
    id,
    status: INITIAL_CORP_CHANGE_STATUS,
    orgId: input.orgId,
    orgCode: await orgCodeFor(client, session, input),
    entityType: input.entityType,
    info: settled.value,
    actor: actorOf(session),
  });
  for (const p of input.persons) {
    await insertIncorpPerson(client, {
      id: randomUUID(),
      incorporationId: id,
      orgId: input.orgId,
      input: p,
      rrn: p.rrn ? sealRrn(p.rrn) : null,
    });
  }
  return { ok: true, value: { id } };
}

// =============================================================================
// 상세
// =============================================================================

export async function readIncorporationDetail(
  client: ScopedClient,
  session: ErpSession,
  id: string,
): Promise<OpResult<IncorporationDetailResponse>> {
  const row = await getIncorporation(client, id);
  if (!row) return NOT_FOUND;
  return { ok: true, value: await detailOf(client, session, row) };
}

async function detailOf(client: ScopedClient, session: ErpSession, row: IncorporationRow): Promise<IncorporationDetailResponse> {
  const persons = await listIncorpPersons(client, row.id);
  const composedName = composeIncorporationName(row.info.nameKo, row.info.companyTypePosition, row.entityType);
  const types = await entityTypes(client);
  const statusBeforeCancel: CorpChangeStatus | null =
    row.status === 'X' && isCorpChangeStatus(row.statusBeforeCancel) ? row.statusBeforeCancel : null;
  return {
    id: row.id,
    orgId: row.orgId,
    orgCode: row.orgCode,
    status: row.status as CorpChangeStatus,
    statusName: await statusName(client, row.status),
    displayName: incorporationDisplayName(composedName, row),
    namePositions: await namePositions(client),
    defaultNamePosition: DEFAULT_NAME_POSITION,
    entityTypes: types,
    defaultEntityType: INCORP_ENTITY_TYPE,
    entityType: row.entityType,
    entityTypeName: types.find((c) => c.code === row.entityType)?.name ?? row.entityType,
    info: row.info,
    composedName,
    persons,
    createdOn: row.createdOn,
    editable: canEditCorpChange(row.status),
    // ★ 버튼은 서버가 전이를 받을 때와 **같은 표**로 고른다(법인변경과 같다).
    availableTransitions: availableTransitions(row.status, session.role, statusBeforeCancel),
    canDelete: checkDelete(row.status, session.role).ok,
    statusBeforeCancel,
    statusBeforeCancelName: statusBeforeCancel ? await statusName(client, statusBeforeCancel) : null,
    cancelReason: row.status === 'X' ? row.cancelReason : null,
    writtenOn: row.writtenOn,
    completedOn: row.completedOn,
    warnings: incorporationWarnings({ info: row.info, persons: persons.map(personForValidation) }, row.entityType),
  };
}

// =============================================================================
// 설립 정보 — [저장](P 만, 내용 검증 없음)
// =============================================================================

export async function saveIncorporationInfo(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
): Promise<OpResult<IncorporationDetailResponse>> {
  const raw = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const parsed = parseIncorpInfo(raw.info ?? {});
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);

  const row = await getIncorporation(client, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (!canEditCorpChange(row.status)) return NOT_EDITABLE;

  const settled = await settlePosition(client, parsed.value);
  if (!settled.ok) return settled;
  await updateIncorporationInfo(client, { id, info: settled.value, actor: actorOf(session) });
  return readIncorporationDetail(client, session, id);
}

// =============================================================================
// 상태 전이 · 삭제
// =============================================================================

/**
 * 상태 전이 `{ from, to, cancelReason? }` — 순서는 법인변경과 같다:
 * 본문(400) → 잠가서 읽기(404) → 화면이 본 상태와 대조(409) → 판정(400 검증 · 403 · 409) → 쓰기.
 * ★ P→E 검증은 **저장된 값**(설립 정보 + 사람)으로 돈다. 작성완료 스냅샷 · 시각을 같은 트랜잭션에서 쓴다.
 */
export async function transitionIncorporation(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
): Promise<OpResult<IncorporationDetailResponse>> {
  const parsed = parseTransitionBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);
  const { from, to, cancelReason } = parsed.value;

  const row = await getIncorporation(client, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (row.status !== from) return STALE;
  const completing = row.status === 'P' && to === 'E';
  const persons = completing ? await listIncorpPersons(client, row.id) : [];

  const check = checkIncorporationTransition({
    from: row.status,
    to,
    role: session.role,
    statusBeforeCancel: row.statusBeforeCancel,
    content: completing ? { info: row.info, persons: persons.map(personForValidation) } : undefined,
    entityType: row.entityType,
  });
  if (!check.ok) {
    const status = REFUSAL_STATUS[check.code];
    return fail(status, check.code, check.reason, status === 400 ? (check.errors ?? []) : undefined);
  }

  const changed = await updateIncorporationStatus(client, {
    id,
    from: row.status,
    to,
    actor: actorOf(session),
    cancelReason: to === 'X' ? cancelReason : null,
    snapshot: completing ? buildIncorporationSnapshot(row.info, persons, row.entityType) : undefined,
  });
  if (!changed) return STALE;
  return readIncorporationDetail(client, session, id);
}

/** 삭제 `?from=` — 판정은 `checkDelete`(운영사 · P/X). 사람을 함께 지운다. */
export async function deleteIncorporationOp(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  seen: unknown,
): Promise<OpResult<null>> {
  const parsed = parseSeenStatus(seen);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);
  const row = await getIncorporation(client, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (row.status !== parsed.value) return STALE;
  const check = checkDelete(row.status, session.role);
  if (!check.ok) return fail(REFUSAL_STATUS[check.code], check.code, check.reason);
  const gone = await deleteIncorporation(client, { id, status: row.status });
  return gone ? { ok: true, value: null } : STALE;
}

// =============================================================================
// 사람 — 저장된 건(임시 모드의 사람은 첫 저장이 한꺼번에 넣는다)
// =============================================================================

async function lockEditable(client: ScopedClient, id: string): Promise<OpResult<IncorporationRow>> {
  const row = await getIncorporation(client, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (!canEditCorpChange(row.status)) return NOT_EDITABLE;
  return { ok: true, value: row };
}

export async function addIncorpPerson(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
): Promise<OpResult<IncorpPersonView>> {
  const parsed = parseIncorpPersonBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);
  const parent = await lockEditable(client, id);
  if (!parent.ok) return parent;
  const p = parsed.value;
  const person = await insertIncorpPerson(client, {
    id: randomUUID(),
    incorporationId: id,
    orgId: parent.value.orgId,
    input: p,
    rrn: p.rrn ? sealRrn(p.rrn) : null,
  });
  await touchIncorporation(client, id, actorOf(session));
  return { ok: true, value: person };
}

export async function editIncorpPerson(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  personId: string,
  body: unknown,
): Promise<OpResult<IncorpPersonView>> {
  const parsed = parseIncorpPersonBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);
  const parent = await lockEditable(client, id);
  if (!parent.ok) return parent;
  const p = parsed.value;
  const person = await updateIncorpPerson(client, {
    id: personId,
    incorporationId: id,
    input: p,
    rrn: p.rrn ? sealRrn(p.rrn) : undefined,
  });
  // ★ 다른 건의 사람 ID 면 0건 — 404(그 사람이 다른 건에 있다는 것을 알려 주지 않는다).
  if (!person) return fail(404, 'not_found', '사람을 찾을 수 없습니다');
  await touchIncorporation(client, id, actorOf(session));
  return { ok: true, value: person };
}

export async function removeIncorpPerson(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  personId: string,
): Promise<OpResult<null>> {
  const parent = await lockEditable(client, id);
  if (!parent.ok) return parent;
  const gone = await deleteIncorpPerson(client, { id: personId, incorporationId: id });
  if (!gone) return fail(404, 'not_found', '사람을 찾을 수 없습니다');
  await touchIncorporation(client, id, actorOf(session));
  return { ok: true, value: null };
}
