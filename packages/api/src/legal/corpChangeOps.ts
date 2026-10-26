/**
 * 법인변경 처리 — 첫 저장(새 건) · 임시 모드 · 상세 · 변경 내용 · 임원 · 비입주사 법무 회사
 * 정보(3단계) · 상태 전이 · 삭제 · 작성완료 스냅샷(4단계, 2026-10-10).
 *
 * 라우트(`routes/corpChanges.ts`)는 본문 읽기와 응답만 하고, **판정은 여기서** 한다. 검증
 * 스크립트(`scripts/verify-corp-change-detail.js`)가 erp_app 접속 · 롤백 트랜잭션 안에서 이
 * 함수들을 그대로 부른다 — 라우트가 쓰는 그 판정을 RLS 를 거쳐 잰다.
 *
 * ★★★ 건은 첫 [저장] 때 생긴다 — 건 + 변경 내용 + 임원 전부를 **한 트랜잭션**으로 넣는다
 *    (`createCorpChange`). 본문은 그 전에 다 읽어 두었으므로(`parseFirstSave`) 모양이 틀린 것이
 *    하나라도 있으면 여기까지 오지 않는다. DB 가 도중에 거절하면(RLS 등) 트랜잭션째 되돌아간다.
 * ★★ 모든 함수는 `scopeOfSession` 스코프의 클라이언트를 받는다. 건이 안 보이면(없거나 남의
 *    단체) **404** 다 — 둘을 가르지 않는다.
 * ★★ 고칠 수 있는 상태는 서류작성중(P)뿐이다(`canEditCorpChange`). 아니면 **409**.
 * ★ 이 파일은 주민번호 평문을 **받아서 바로 암호화**할 뿐, 저장하지도 돌려주지도 기록하지도
 *   않는다. 응답의 주민번호는 마스킹된 것뿐이다.
 */
import { randomUUID } from 'node:crypto';
import type { ErpSession } from '@swonbiz/shared';
import {
  CHANGE_TYPE_DEFS,
  CORP_CHANGE_CODE_USE_TP,
  CORP_CHANGE_STATUS_CATEGORY,
  CORP_CHANGE_TYPE_CATEGORY,
  INITIAL_CORP_CHANGE_STATUS,
  availableTransitions,
  canEditCorpChange,
  checkDelete,
  checkTransition,
  isCorpChangeStatus,
  isCorpChangeType,
  type CorpChangeFieldError,
  type CorpChangeOfficerInput,
  type CorpChangeType,
  type TransitionRefusal,
} from '@swonbiz/shared/domain/corp-change';
import {
  STALE_STATUS_MESSAGE,
  buildSubmitSnapshot,
  parseSeenStatus,
  parseTransitionBody,
} from '@swonbiz/shared/domain/corp-change-transition';
import {
  LEGAL_MEMBER_TYPE_CATEGORY,
  LEGAL_MEMBER_TYPE_USE_TP,
  TENANT_MEMBER_TYPE_USE_TP,
  corpChangeCompanyName,
  maskRrn,
  parseCompanyPart,
  parseOfficerBody,
  parsePayload,
  type CorpChangeCompanyInfo,
  type CorpChangeCreateInput,
  type CorpChangeDetailResponse,
  type CorpChangeDraftResponse,
  type CorpChangeOfficerView,
  type FirstSaveInput,
  type LegalOrgInput,
  type OrgTarget,
} from '@swonbiz/shared/domain/corp-change-detail';
import type { CodeOption } from '@swonbiz/shared/domain/corp-change-list';
import { encrypt } from '../lib/crypto.ts';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import {
  deleteCorpChange,
  deleteOfficer,
  getCorpChange,
  insertCorpChange,
  insertOfficer,
  listOfficers,
  readCompanySource,
  tenantOrgCode,
  touchCorpChange,
  updateCorpChangeStatus,
  updateOfficer,
  updatePayload,
  upsertLegalOrg,
  type CorpChangeRow,
  type RrnStored,
} from '../db/corpChanges.ts';

export type OpError = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  message: string;
  /** 칸별 오류 — 400 일 때. 화면이 칸 옆에 붙인다. */
  errors?: CorpChangeFieldError[];
};
export type OpResult<T> = { ok: true; value: T } | OpError;

const fail = (status: OpError['status'], error: string, message: string, errors?: CorpChangeFieldError[]): OpError =>
  errors ? { ok: false, status, error, message, errors } : { ok: false, status, error, message };
const NOT_FOUND = fail(404, 'not_found', '법인변경 건을 찾을 수 없습니다');
const NOT_EDITABLE = fail(409, 'not_editable', '서류작성중일 때만 고칠 수 있습니다');
const NOT_OFFICER = fail(409, 'no_officers', '임원변경 건에만 임원을 넣을 수 있습니다');

function actorOf(session: { s020MemberId: number }): string {
  return String(session.s020MemberId);
}

/** 주민번호 숫자 13자리 → 저장 값. 평문은 이 함수 밖으로 나가지 않는다. */
function sealRrn(digits: string): RrnStored {
  return { cipher: encrypt(digits), masked: maskRrn(digits) };
}

/** 고칠 건을 잠가서 읽는다 — 없으면 404, P 가 아니면 409. */
async function lockEditable(client: ScopedClient, id: string): Promise<OpResult<CorpChangeRow>> {
  const row = await getCorpChange(client, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (!canEditCorpChange(row.status)) return NOT_EDITABLE;
  return { ok: true, value: row };
}

/**
 * 건의 단체코드(표시용) — 운영사는 팝업이 준 값(형식만 본 것), 회사 세션은 입주사면 ERP 의
 * `link_org_code`, 아니면 null(결정 2026-10-10). 주소 · 본문의 값을 회사 세션에서는 쓰지 않는다.
 */
async function orgCodeFor(client: ScopedClient, session: ErpSession, target: OrgTarget): Promise<string | null> {
  return session.role === 'operator' ? target.orgCode : tenantOrgCode(client, target.orgId);
}

// =============================================================================
// 기본정보 · 이름 — 임시 모드와 상세가 같이 쓴다
// =============================================================================

/**
 * 기본정보 카드 + 회사유형 선택지.
 * ★★ `orgId` 는 RLS 를 통과한 건의 것이거나 `parseOrgTarget` 을 거친 것만 넣는다(db 머리말 ⚠).
 */
async function companyView(
  client: ScopedClient,
  org: { orgId: number; orgCode: string | null },
  companyEditor: boolean,
): Promise<{ company: CorpChangeCompanyInfo; memberTypes: CodeOption[]; canEditCompany: boolean }> {
  // ★ 한 클라이언트(한 트랜잭션)라 차례로 부른다 — pg 클라이언트는 쿼리를 동시에 돌리지 않는다.
  const company = await readCompanySource(client, org.orgId);
  // listCodes 는 파티션을 돌려주지 않으므로 MEMBER_TYPE 두 파티션은 따로 읽는다.
  // 입주사 값의 이름은 입주사 파티션(000)에서, 비입주사 선택지 · 이름은 법무 파티션(002)에서.
  const legalTypes = await listCodes(client, [{ category: LEGAL_MEMBER_TYPE_CATEGORY, useTp: LEGAL_MEMBER_TYPE_USE_TP }]);
  const tenantTypes = company.isTenant
    ? await listCodes(client, [{ category: LEGAL_MEMBER_TYPE_CATEGORY, useTp: TENANT_MEMBER_TYPE_USE_TP }])
    : [];
  const memberTypeName = company.memberType
    ? ((company.isTenant ? tenantTypes : legalTypes).find((c) => c.code === company.memberType)?.name ??
      company.memberType)
    : null;

  return {
    company: {
      isTenant: company.isTenant,
      tenantCompanyId: company.tenantCompanyId,
      displayName: corpChangeCompanyName(company.legalName, org),
      legalName: company.legalName,
      corpNumber: company.corpNumber,
      bizNumber: company.bizNumber,
      ceoName: company.ceoName,
      tel: company.tel,
      head: { zipCode: company.headZipCode, address: company.headAddress, addressDetail: company.headAddressDetail },
      ceo: { zipCode: company.ceoZipCode, address: company.ceoAddress, addressDetail: company.ceoAddressDetail },
      memberType: company.memberType,
      memberTypeName,
      hasLegalOrg: company.hasLegalOrg,
      // 삐용 기본값은 라우트가 트랜잭션 밖에서 채운다(`applyCompanyDefaults`).
      defaultedFields: [],
    },
    memberTypes: legalTypes.map((c) => ({ code: c.code, name: c.name })),
    // 입주사는 누구도 여기서 고치지 않는다(409 — `checkCompanyWrite`).
    canEditCompany: companyEditor && !company.isTenant,
  };
}

/** 구분 · 상태의 코드표 이름. 코드표에 없으면 코드값. */
async function codeNames(
  client: ScopedClient,
  changeType: string,
  status: string,
): Promise<{ changeTypeName: string; statusName: string }> {
  const codes = await listCodes(client, [
    { category: CORP_CHANGE_TYPE_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP },
    { category: CORP_CHANGE_STATUS_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP },
  ]);
  const nameOf = (category: string, code: string) =>
    codes.find((c) => c.category === category && c.code === code)?.name ?? code;
  return {
    changeTypeName: nameOf(CORP_CHANGE_TYPE_CATEGORY, changeType),
    statusName: nameOf(CORP_CHANGE_STATUS_CATEGORY, status),
  };
}

// =============================================================================
// 비입주사 법무 회사 정보 — 저장 본문의 `company` (결정 2026-10-10 — 저장 버튼 하나)
// =============================================================================

/**
 * 회사 정보를 쓰기 **전에** 거절할 것을 다 본다 — 이 함수가 통과해야 건 · 변경 내용도 쓴다.
 * 쓰는 쪽이 판정 뒤에 쓰므로, 회사 정보가 틀리면 건 · 변경 내용도 남지 않는다.
 *
 * ★★ **운영사 또는 수정 권한이 있는 그 회사 사용자**만 고친다(결정 2026-10-22 → 넓힘 2026-10-25,
 *    `companyEditGrant.ts`). 권한은 라우트가 트랜잭션 밖에서 정해 `companyEditor` 로 넘긴다. 없으면
 *    **403** — DB 를 읽기 전에 거절한다. RLS(037)는 그대로 둔다(코드에서만 막는다).
 * ★★ 입주사 단체(`link_s020_org_id` 에 있다)면 **409** — 법무는 ERP 에 쓰지 않는다. 입주사
 *    정보는 입주사 화면에서 고친다.
 * ★ 회사유형은 `MEMBER_TYPE` 002 에 있어야 한다(400, 자리 `company.memberType`).
 * ★ 단체는 RLS 를 통과한 건의 것이거나 `parseOrgTarget` 을 거친 것만 넣는다(db 머리말 ⚠).
 */
async function checkCompanyWrite(
  client: ScopedClient,
  companyEditor: boolean,
  orgId: number,
  company: LegalOrgInput,
): Promise<OpError | null> {
  if (!companyEditor) return fail(403, 'operator_only', '회사 정보는 운영사 또는 수정 권한이 있는 회사 사용자만 고칠 수 있습니다');
  const source = await readCompanySource(client, orgId);
  if (source.isTenant) return fail(409, 'tenant_company', '입주사 정보는 ERP 입주사 화면에서 고칩니다');

  const memberType = company.memberType;
  if (memberType !== null) {
    const allowed = await listCodes(client, [{ category: LEGAL_MEMBER_TYPE_CATEGORY, useTp: LEGAL_MEMBER_TYPE_USE_TP }]);
    if (!allowed.some((c) => c.code === memberType)) {
      const message = '회사유형이 올바르지 않습니다';
      return fail(400, 'invalid_request', message, [{ field: 'company.memberType', message }]);
    }
  }
  return null;
}

// =============================================================================
// 임시 모드 · 첫 저장
// =============================================================================

/**
 * 임시 모드(`/legal/corp-changes/new`) — **건을 읽지 않는다**(아직 없다). 기본정보만 읽어서 보여 준다.
 * ★ 단체는 `parseCreateBody` 를 거친 것이다 — 회사 세션이 주소에 남의 단체를 적으면 그 전에 403.
 */
export async function readCorpChangeDraft(
  client: ScopedClient,
  session: ErpSession,
  input: CorpChangeCreateInput,
  companyEditor = session.role === 'operator',
): Promise<OpResult<CorpChangeDraftResponse>> {
  const orgCode = await orgCodeFor(client, session, input);
  const view = await companyView(client, { orgId: input.orgId, orgCode }, companyEditor);
  const names = await codeNames(client, input.changeType, INITIAL_CORP_CHANGE_STATUS);
  return {
    ok: true,
    value: {
      orgId: input.orgId,
      orgCode,
      changeType: input.changeType,
      status: INITIAL_CORP_CHANGE_STATUS,
      ...names,
      ...view,
    },
  };
}

/**
 * 첫 [저장] — 건(서류작성중 P) + 변경 내용 + 임원 전부를 한 번에 넣는다.
 *
 * ★ 본문은 `parseFirstSave` 가 이미 다 읽었다(틀린 것이 하나라도 있으면 여기 오지 않는다). 남의
 *   단체도 거기서 403 이고, DB 의 RLS `WITH CHECK` 가 한 번 더 막는다 — 막히면 예외가 트랜잭션을
 *   통째로 되돌린다(건도 임원도 남지 않는다).
 */
export async function createCorpChange(
  client: ScopedClient,
  session: ErpSession,
  input: FirstSaveInput,
  companyEditor = session.role === 'operator',
): Promise<OpResult<{ id: string }>> {
  // ★ 회사 정보 판정이 먼저다 — 틀리면 건도 만들지 않는다(쓰기 전에 돌려준다).
  if (input.company) {
    const refused = await checkCompanyWrite(client, companyEditor, input.orgId, input.company);
    if (refused) return refused;
  }

  const id = randomUUID();
  const actor = actorOf(session);
  await insertCorpChange(client, {
    id,
    changeType: input.changeType,
    status: INITIAL_CORP_CHANGE_STATUS,
    orgId: input.orgId,
    orgCode: await orgCodeFor(client, session, input),
    payload: input.payload,
    actor,
  });
  for (const officer of input.officers) {
    await insertOfficer(client, {
      id: randomUUID(),
      corpChangeId: id,
      orgId: input.orgId,
      input: officer,
      rrn: officer.rrn ? sealRrn(officer.rrn) : null,
    });
  }
  if (input.company) await upsertLegalOrg(client, { orgId: input.orgId, input: input.company, actor });
  return { ok: true, value: { id } };
}

// =============================================================================
// 상세
// =============================================================================

export async function readCorpChangeDetail(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  companyEditor = session.role === 'operator',
): Promise<OpResult<CorpChangeDetailResponse>> {
  const row = await getCorpChange(client, id);
  if (!row) return NOT_FOUND;
  // ★ 037 이후 앱이 만든 건은 늘 5종이다. 코드표에만 있는 구분(CEO_CHG)이 들어 있으면 자료가
  //   깨진 것이다 — 화면이 칸을 그릴 수 없으므로 열지 않는다.
  if (!isCorpChangeType(row.changeType)) return fail(409, 'unknown_type', '앱이 모르는 변경 구분입니다');
  const changeType: CorpChangeType = row.changeType;

  // ★ 회사 정보는 **이 건의 org_id** 로만 읽는다(RLS 를 통과한 값 — db 머리말 ⚠).
  const view = await companyView(client, row, companyEditor);
  const officers = CHANGE_TYPE_DEFS[changeType].usesOfficers ? await listOfficers(client, row.id) : [];
  const names = await codeNames(client, changeType, row.status);
  // ★ 복원 대상은 취소(X)일 때만 뜻이 있다. 다른 상태에 남은 값은 내려보내지 않는다.
  const statusBeforeCancel =
    row.status === 'X' && isCorpChangeStatus(row.statusBeforeCancel) ? row.statusBeforeCancel : null;
  const statusBeforeCancelName = statusBeforeCancel
    ? (await codeNames(client, changeType, statusBeforeCancel)).statusName
    : null;

  return {
    ok: true,
    value: {
      id: row.id,
      orgId: row.orgId,
      orgCode: row.orgCode,
      changeType,
      status: row.status,
      ...names,
      payload: row.payload,
      createdOn: row.createdOn,
      editable: canEditCorpChange(row.status),
      ...view,
      officers,
      // ★ 버튼은 서버가 전이를 받을 때와 **같은 표**로 고른다(`corp-change.ts` 머리말 ★★★).
      availableTransitions: availableTransitions(row.status, session.role, statusBeforeCancel),
      canDelete: checkDelete(row.status, session.role).ok,
      statusBeforeCancel,
      statusBeforeCancelName,
      cancelReason: row.status === 'X' ? row.cancelReason : null,
      writtenOn: row.writtenOn,
      completedOn: row.completedOn,
    },
  };
}

// =============================================================================
// 상태 전이 · 삭제(4단계)
// =============================================================================

/** `checkTransition` · `checkDelete` 의 거절 사유 → 응답 상태(결정 2026-10-10). */
const REFUSAL_STATUS: Readonly<Record<TransitionRefusal, OpError['status']>> = {
  invalid: 400,
  forbidden: 403,
  not_allowed: 409,
  restore_target: 409,
  unknown_status: 409,
};

const STALE = fail(409, 'stale_status', STALE_STATUS_MESSAGE);

/** 저장된 임원 → 검증에 넘기는 모양. ★ 주민번호는 넘기지 않는다 — 암호문이고, 형식은 입력 때 봤다. */
const officerForValidation = (o: CorpChangeOfficerView): CorpChangeOfficerInput => ({
  name: o.name,
  changeKind: o.changeKind,
  position: o.position,
  effectiveDate: o.effectiveDate,
});

/**
 * 상태 전이 `{ from, to, cancelReason? }` — 판정은 `checkTransition` 한 곳이다.
 *
 * 순서: 본문 모양(400) → 잠가서 읽기(404) → **화면이 본 상태와 대조(409)** → `checkTransition`
 * (400 검증 · 403 역할 · 409 표에 없음/복원 대상) → 쓰기.
 *
 * ★★ P→E 검증은 **저장된 값**으로 돈다 — 변경 내용과, 임원 건이면 저장된 임원 목록. 실패하면
 *    400 + 칸별 오류이고 아무것도 쓰지 않는다.
 * ★★ P→E 는 작성완료 스냅샷(submit_snapshot)과 작성완료 시각(written_at)을 **같은 트랜잭션**에서 쓴다 —
 *    상태만 바뀌고 스냅샷이 없는 건은 없다. 스냅샷의 용도는 shared `corp-change-transition.ts` 머리말.
 *    회사값은 이 건의 org_id(RLS 를 통과한 값)로 읽는다.
 * ★ 성공하면 새 상세를 돌려준다 — 화면이 그 값으로 버튼을 다시 그린다.
 */
export async function transitionCorpChange(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
  companyEditor = session.role === 'operator',
): Promise<OpResult<CorpChangeDetailResponse>> {
  const parsed = parseTransitionBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);
  const { from, to, cancelReason } = parsed.value;

  const row = await getCorpChange(client, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (row.status !== from) return STALE;
  if (!isCorpChangeType(row.changeType)) return fail(409, 'unknown_type', '앱이 모르는 변경 구분입니다');
  const completing = row.status === 'P' && to === 'E';
  const officers =
    CHANGE_TYPE_DEFS[row.changeType].usesOfficers && completing ? await listOfficers(client, row.id) : [];
  // 작성완료 때 회사값 — 대표주소 변경의 「변경 전 주소」(대표자 자택) 검증과 스냅샷이 같이 쓴다.
  // ★ 이 건의 org_id(RLS 를 통과한 값)로 읽는다.
  const company = completing ? await readCompanySource(client, row.orgId) : null;
  const check = checkTransition({
    from: row.status,
    to,
    role: session.role,
    statusBeforeCancel: row.statusBeforeCancel,
    content: completing
      ? {
          changeType: row.changeType,
          payload: row.payload,
          officers: officers.map(officerForValidation),
          company: company ? { isTenant: company.isTenant, ceoZipCode: company.ceoZipCode, ceoAddress: company.ceoAddress } : undefined,
        }
      : undefined,
  });
  if (!check.ok) {
    const status = REFUSAL_STATUS[check.code];
    return fail(status, check.code, check.reason, status === 400 ? (check.errors ?? []) : undefined);
  }

  const snapshot =
    completing && company
    ? buildSubmitSnapshot({
        changeType: row.changeType,
        company,
        payload: row.payload,
        officers,
      })
    : undefined;

  const changed = await updateCorpChangeStatus(client, {
    id,
    from: row.status,
    to,
    actor: actorOf(session),
    cancelReason: to === 'X' ? cancelReason : null,
    snapshot,
  });
  // 잠가 두었으므로 생기지 않는다. 생기면 판정 없이 쓴 것이 없도록 멈춘다.
  if (!changed) return STALE;
  return readCorpChangeDetail(client, session, id, companyEditor);
}

/**
 * 삭제 `?from=` — 판정은 `checkDelete`(운영사 · P/X). 임원을 함께 지운다.
 * 순서는 전이와 같다: 본 상태(400) → 잠가서 읽기(404) → 대조(409) → 판정(403 · 409).
 */
export async function deleteCorpChangeOp(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  seen: unknown,
): Promise<OpResult<null>> {
  const parsed = parseSeenStatus(seen);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);

  const row = await getCorpChange(client, id, { forUpdate: true });
  if (!row) return NOT_FOUND;
  if (row.status !== parsed.value) return STALE;
  const check = checkDelete(row.status, session.role);
  if (!check.ok) return fail(REFUSAL_STATUS[check.code], check.code, check.reason);

  const gone = await deleteCorpChange(client, { id, status: row.status });
  if (!gone) return STALE;
  return { ok: true, value: null };
}

// =============================================================================
// 변경 내용
// =============================================================================

/**
 * [저장] — 변경 내용 `{ payload, company? }`. P 만. 내용 검증은 하지 않는다(임시 저장,
 * `corp-change-detail.ts` 머리말).
 *
 * ★ `company` 가 실려 오면(비입주사 · 사람이 고쳤거나 삐용 기본값이 있다) **같은 트랜잭션**에서
 *   법무 회사 정보도 저장한다. 판정(모양 · 입주사 · 회사유형)을 모두 먼저 하고 쓰므로, 회사 정보가
 *   틀리면 변경 내용도 바뀌지 않는다. 회사 단체는 **이 건의 org_id**(RLS 를 통과한 값)다.
 * ★ 성공하면 새 상세를 돌려준다 — 화면이 회사명 · 기본값 표시까지 그 값으로 다시 그린다.
 */
export async function saveCorpChangePayload(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
  companyEditor = session.role === 'operator',
): Promise<OpResult<CorpChangeDetailResponse>> {
  const locked = await lockEditable(client, id);
  if (!locked.ok) return locked;
  const row = locked.value;
  if (!isCorpChangeType(row.changeType)) return fail(409, 'unknown_type', '앱이 모르는 변경 구분입니다');

  const raw = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  // ★ 구분은 바꾸지 못한다(결정 2026-10-10). 본문에 다른 구분이 오면 조용히 무시하지 않고 거절한다.
  if (raw.changeType !== undefined && raw.changeType !== row.changeType) {
    return fail(400, 'invalid_request', '변경 구분은 바꿀 수 없습니다');
  }
  const parsed = parsePayload(row.changeType, raw.payload);
  const company = parseCompanyPart(raw.company);
  // 틀린 칸을 다 모은다 — 변경 내용과 회사 정보를 한 번에 알려 준다.
  const errors = [
    ...(parsed.ok ? [] : (parsed.errors ?? [{ field: 'payload', message: parsed.message }])),
    ...(company.ok ? [] : (company.errors ?? [{ field: 'company', message: company.message }])),
  ];
  if (!parsed.ok || !company.ok) return fail(400, 'invalid_request', errors[0]!.message, errors);

  if (company.value) {
    const refused = await checkCompanyWrite(client, companyEditor, row.orgId, company.value);
    if (refused) return refused;
  }

  const actor = actorOf(session);
  await updatePayload(client, { id, payload: parsed.value, actor });
  if (company.value) await upsertLegalOrg(client, { orgId: row.orgId, input: company.value, actor });
  return readCorpChangeDetail(client, session, id, companyEditor);
}

// =============================================================================
// 임원 — 저장된 건(임시 모드의 임원은 첫 저장이 한꺼번에 넣는다)
// =============================================================================

/** 임원을 고칠 수 있는 건 — 보이고 · P 이고 · 임원변경이다. */
async function lockOfficerParent(client: ScopedClient, id: string): Promise<OpResult<CorpChangeRow>> {
  const locked = await lockEditable(client, id);
  if (!locked.ok) return locked;
  const row = locked.value;
  if (!isCorpChangeType(row.changeType) || !CHANGE_TYPE_DEFS[row.changeType].usesOfficers) return NOT_OFFICER;
  return locked;
}

export async function addOfficer(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  body: unknown,
): Promise<OpResult<CorpChangeOfficerView>> {
  // ★ 본문을 먼저 읽는다 — 형식이 틀린 주민번호는 건 상태와 상관없이 400 이다.
  const parsed = parseOfficerBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);
  const parent = await lockOfficerParent(client, id);
  if (!parent.ok) return parent;

  const input = parsed.value;
  const officer = await insertOfficer(client, {
    id: randomUUID(),
    corpChangeId: id,
    orgId: parent.value.orgId,
    input,
    rrn: input.rrn ? sealRrn(input.rrn) : null,
  });
  await touchCorpChange(client, id, actorOf(session));
  return { ok: true, value: officer };
}

export async function editOfficer(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  officerId: string,
  body: unknown,
): Promise<OpResult<CorpChangeOfficerView>> {
  const parsed = parseOfficerBody(body);
  if (!parsed.ok) return fail(400, 'invalid_request', parsed.message, parsed.errors);
  const parent = await lockOfficerParent(client, id);
  if (!parent.ok) return parent;

  const input = parsed.value;
  const officer = await updateOfficer(client, {
    id: officerId,
    corpChangeId: id,
    input,
    rrn: input.rrn ? sealRrn(input.rrn) : undefined,
  });
  // ★ 다른 건의 임원 ID 면 0건 — 404. 「그 임원은 있지만 이 건 것이 아니다」를 알려 주지 않는다.
  if (!officer) return fail(404, 'not_found', '임원을 찾을 수 없습니다');
  await touchCorpChange(client, id, actorOf(session));
  return { ok: true, value: officer };
}

export async function removeOfficer(
  client: ScopedClient,
  session: ErpSession,
  id: string,
  officerId: string,
): Promise<OpResult<null>> {
  const parent = await lockOfficerParent(client, id);
  if (!parent.ok) return parent;
  const gone = await deleteOfficer(client, { id: officerId, corpChangeId: id });
  if (!gone) return fail(404, 'not_found', '임원을 찾을 수 없습니다');
  await touchCorpChange(client, id, actorOf(session));
  return { ok: true, value: null };
}

