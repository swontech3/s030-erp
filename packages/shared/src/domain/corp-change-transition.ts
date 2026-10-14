/**
 * 법인변경 상세(s040200011) 4단계 — 상태 전이 · 삭제 요청 읽기 + 작성완료 스냅샷. 순수 함수.
 *
 * 전이 · 삭제를 **판정**하는 것은 1단계(`corp-change.ts`)의 `checkTransition` · `checkDelete` 다.
 * 이 파일은 규칙을 다시 적지 않는다 — 본문의 모양을 읽고, 작성완료 때 남길 기록을 만들 뿐이다.
 *
 * =============================================================================
 * ★★★ 스냅샷(submit_snapshot)은 작성완료(P→E) 때 남긴다 — 무엇에 쓰나 (결정 2026-10-10)
 * =============================================================================
 * **나중에 회사 정보가 바뀌어도 작성완료 당시 값(= 변경 전 값)으로 서류를 다시 뽑기 위해서다.**
 * 상호변경이 끝나 ERP 회사명이 바뀌면 「변경 전 상호」는 이 기록에만 남는다.
 *   · 5단계 서류 출력은 작성완료(E) · 완료(C) 건을 **이 스냅샷 값으로** 그린다
 *   · 화면에는 따로 보여 주지 않는다
 *   · 서류수정(E→P) 뒤 다시 작성완료하면 **새 스냅샷으로 통째로** 바뀐다. 작성완료 시각(written_at)도 같다
 *   · 칸 이름이 submit_snapshot 인 것은 옛 「제출(A)」 단계의 흔적이다(037). 제출 단계는 없앴다
 *     (2026-10-10) — 칸 이름은 그대로 두고 남기는 때만 P→E 로 옮겼다
 *
 * =============================================================================
 * ★★★ 화면이 본 상태(`from`)를 함께 보낸다 (결정 2026-10-10)
 * =============================================================================
 * 서버는 행을 잠근 뒤 현재 상태를 다시 읽고, `from` 과 다르면 **409** 다. 보내지 않으면 이런 일이
 * 생긴다 — 운영사가 C 를 보고 [완료 취소](C→E)를 눌렀는데 그새 다른 사람이 취소(X)했다가 다시
 * 완료로 복원했으면, 화면이 본 적 없는 상태 변화를 조용히 덮는다. 삭제도 같다(`?from=`).
 *
 * =============================================================================
 * ★★ 스냅샷에는 주민번호가 없다 — 마스킹 값도 넣지 않는다 (결정 2026-10-10)
 * =============================================================================
 * 임원은 고른 칸만 옮긴다(`SNAPSHOT_OFFICER_KEYS`). 화면 응답 모양(`CorpChangeOfficerView`)을
 * 통째로 넣지 않는다 — 그쪽에 칸이 늘면 스냅샷에도 따라 들어가기 때문이다.
 */
import { isCorpChangeStatus, type CorpChangeFieldError, type CorpChangeStatus } from './corp-change.ts';
import type { CorpChangeOfficerView, Parsed } from './corp-change-detail.ts';

/** 취소 사유 최대 길이 — DB `cancel_reason varchar(200)` 그대로. */
export const CANCEL_REASON_MAX = 200;

/** 화면이 본 상태가 달라졌을 때의 문구(409). */
export const STALE_STATUS_MESSAGE = '다른 사용자가 상태를 바꿨습니다. 화면을 새로 읽어 주세요';

export interface TransitionInput {
  /** 화면이 본 상태 — 서버가 잠근 뒤 읽은 상태와 다르면 409. */
  from: CorpChangeStatus;
  to: CorpChangeStatus;
  /** 취소(→X) 때만. 비우면 null. */
  cancelReason: string | null;
}

const bad = (field: string, message: string): Parsed<never> => ({
  ok: false,
  status: 400,
  message,
  errors: [{ field, message } satisfies CorpChangeFieldError],
});

/** 화면이 본 상태 하나 — 삭제의 `?from=` 도 이것으로 읽는다. */
export function parseSeenStatus(raw: unknown): Parsed<CorpChangeStatus> {
  if (raw === undefined || raw === null || raw === '') return bad('from', '화면이 본 상태(from)가 없습니다');
  if (!isCorpChangeStatus(raw)) return bad('from', '상태값이 올바르지 않습니다');
  return { ok: true, value: raw };
}

/**
 * 전이 본문 `{ from, to, cancelReason? }`.
 *
 * ★ 여기서는 **모양만** 본다 — 그 전이가 표에 있는지 · 이 역할이 할 수 있는지는 `checkTransition`.
 * ★ 취소 사유는 취소(→X) 때만 받는다. 다른 전이에 실려 오면 조용히 버리지 않고 400.
 */
export function parseTransitionBody(raw: unknown): Parsed<TransitionInput> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad('body', '요청 형식이 올바르지 않습니다');
  const body = raw as Record<string, unknown>;
  const from = parseSeenStatus(body.from);
  if (!from.ok) return from;
  if (!isCorpChangeStatus(body.to)) return bad('to', '바꿀 상태가 올바르지 않습니다');
  const to = body.to;

  const r = body.cancelReason;
  let cancelReason: string | null = null;
  if (r !== undefined && r !== null) {
    if (typeof r !== 'string') return bad('cancelReason', '취소 사유는 글자로 입력하세요');
    const t = r.trim();
    if (t !== '' && to !== 'X') return bad('cancelReason', '취소 사유는 취소할 때만 적습니다');
    if (t.length > CANCEL_REASON_MAX) {
      return bad('cancelReason', `취소 사유는 ${CANCEL_REASON_MAX}자 이내로 입력하세요`);
    }
    cancelReason = t === '' ? null : t;
  }
  return { ok: true, value: { from: from.value, to, cancelReason } };
}

// =============================================================================
// 작성완료 스냅샷 — submit_snapshot(037, 칸 이름은 그대로)
// =============================================================================

export interface SnapshotAddress {
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
}

/** 스냅샷의 임원 한 명 — ★ 주민번호 칸이 **없다**(평문 · 암호문 · 마스킹 모두). */
export interface SnapshotOfficer {
  name: string;
  changeKind: string;
  position: string | null;
  effectiveDate: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  /** 사임사유 — v3 부터. 옛 스냅샷은 null. */
  resignReason: string | null;
}

const SNAPSHOT_OFFICER_KEYS = [
  'name',
  'changeKind',
  'position',
  'effectiveDate',
  'zipCode',
  'address',
  'addressDetail',
  'resignReason',
] as const satisfies readonly (keyof SnapshotOfficer)[];

/**
 * 작성완료(P→E) 시점 기록. 한 번 저장되면 고치지 않는다 — 서류수정(E→P) 뒤 다시 작성완료하면
 * **새 스냅샷으로 통째로** 바뀐다(머리말 ★★★).
 *
 * ★ 회사값은 **변경 전** 값이다 — 입주사 = ERP 입주사 정보, 비입주사 = 법무 회사 정보(038).
 *   상호변경이 끝나 ERP 회사명이 바뀌면 옛 이름은 여기에만 남는다(037 머리말).
 */
export interface CorpChangeSubmitSnapshot {
  /**
   * 모양 번호 — 칸이 바뀌면 올린다.
   *   1 — 10-10 첫 모양
   *   2 — 10-11 회사에 전화(`tel`) · 사업자번호(`bizNumber`) · 회사유형(`memberType`)을 더했다(서류 출력 Q5).
   *       ★ 옛 v1 은 고치지 않는다(결정 H) — 읽는 쪽(`readSubmitSnapshot`)이 빈 칸을 null 로 채운다
   *   3 — 10-14 임원에 사임사유(`resignReason`)를 더했다. 옛 v1 · v2 의 사유는 null 이다
   */
  version: 3;
  changeType: string;
  company: {
    isTenant: boolean;
    /** 입주사 = ERP 회사명, 비입주사 = 등기상 상호. */
    name: string | null;
    corpNumber: string | null;
    /** 사업자등록번호 — 저장된 모양 그대로. */
    bizNumber: string | null;
    ceoName: string | null;
    /** 회사 전화 — 서류의 「대표자 전화」가 이 값이다(결정 C — 대표자 전화 칸은 따로 없다). */
    tel: string | null;
    /**
     * 회사유형 코드 — 입주사 = ERP 회원구분(파티션 000), 비입주사 = 법무 회사유형(파티션 002).
     * 서류 출력이 등기 설정의 회사유형 줄과 양식의 회사유형 표시를 이 값으로 고른다.
     */
    memberType: string | null;
    /** 본점. */
    head: SnapshotAddress;
    /** 대표자 자택. */
    ceoHome: SnapshotAddress;
  };
  payload: Record<string, unknown>;
  officers: SnapshotOfficer[];
}

/** 스냅샷에 넣을 회사값 — 저장소의 `CompanySourceRow` 에서 이 칸들만 넘긴다. */
export interface SnapshotCompanySource {
  isTenant: boolean;
  legalName: string | null;
  corpNumber: string | null;
  bizNumber: string | null;
  ceoName: string | null;
  tel: string | null;
  memberType: string | null;
  headZipCode: string | null;
  headAddress: string | null;
  headAddressDetail: string | null;
  ceoZipCode: string | null;
  ceoAddress: string | null;
  ceoAddressDetail: string | null;
}

export function buildSubmitSnapshot(args: {
  changeType: string;
  company: SnapshotCompanySource;
  payload: Record<string, unknown>;
  officers: readonly CorpChangeOfficerView[];
}): CorpChangeSubmitSnapshot {
  const c = args.company;
  return {
    version: 3,
    changeType: args.changeType,
    company: {
      isTenant: c.isTenant,
      name: c.legalName,
      corpNumber: c.corpNumber,
      bizNumber: c.bizNumber,
      ceoName: c.ceoName,
      tel: c.tel,
      memberType: c.memberType,
      head: { zipCode: c.headZipCode, address: c.headAddress, addressDetail: c.headAddressDetail },
      ceoHome: { zipCode: c.ceoZipCode, address: c.ceoAddress, addressDetail: c.ceoAddressDetail },
    },
    payload: args.payload,
    officers: args.officers.map((o) => {
      const out = {} as Record<(typeof SNAPSHOT_OFFICER_KEYS)[number], unknown>;
      for (const k of SNAPSHOT_OFFICER_KEYS) out[k] = o[k];
      return out as unknown as SnapshotOfficer;
    }),
  };
}
