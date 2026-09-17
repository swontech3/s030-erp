/**
 * 계약 상태 전이와 섹션 잠금 — 순수 함수.
 *
 * 정본은 `design/handoff/tenant-contract/04-status.md` 의 표 두 개다.
 * 규칙의 기록은 `contract-status.test.ts` 다.
 *
 * =============================================================================
 * ★★ 서버가 강제한다 — 화면 버튼 노출과 무관하다 (CONT-08)
 * =============================================================================
 * 화면이 버튼을 감추는 것은 UX 이지 방어가 아니다. API 를 직접 불러도 막혀야 한다.
 * 그래서 이 판정이 `packages/web` 이 아니라 여기 있고, 라우트가 이 함수를 통과하지
 * 못한 요청을 거부한다.
 *
 * 화면도 같은 함수를 쓴다 — 두 벌로 두면 반드시 어긋나고, 어긋나는 쪽은 늘
 * 방어가 아니라 화면이라 **뚫린 줄도 모른다.**
 *
 * =============================================================================
 * ★ 모르는 값은 잠근 것으로 본다 (fail-closed)
 * =============================================================================
 * 상태 문자열은 화면·DB·다른 서비스 어디서든 올 수 있다. 오타 하나가 "잠기지 않음"
 * 으로 읽히면 확정된 계약의 금액이 바뀐다. 판단이 안 서면 잠근다.
 */

/**
 * 저장되는 계약 상태 — 넷이다.
 *
 * ★ `create` 는 여기 없다. 아직 저장되지 않은 **화면의 모드**이지 상태가 아니다.
 *   DB 의 `ck_s080_contracts_status` 도 이 넷만 받는다(008).
 */
export const CONTRACT_STATUS = ['draft', 'confirmed', 'terminated', 'cancelled'] as const;

export type ContractStatus = (typeof CONTRACT_STATUS)[number];

/** 계약 폼의 섹션 번호 — 03-contract-form.md 의 4개 섹션. */
export type ContractSection = 1 | 2 | 3 | 4;

function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === 'string' && (CONTRACT_STATUS as readonly string[]).includes(value);
}

/**
 * 허용되는 전이 전부. **이 목록에 없으면 막힌다**(화이트리스트).
 *
 *     null(최초 생성) → draft        임시저장
 *     null(최초 생성) → confirmed    create 에서 바로 계약확정
 *     draft           → confirmed    계약확정
 *     draft           → cancelled    계약취소
 *     confirmed       → terminated   종료
 *
 * ★ 되돌리는 전이가 없다. 조건을 바꾸려면 **종료 후 재계약**이다.
 * ★ `confirmed → cancelled` 도 없다. 취소는 대기 상태에서만이다 —
 *   확인 모달 문구가 "임시저장된 계약 정보가 삭제됩니다"인 이유다.
 * ★ 같은 상태로의 전이도 없다. 재저장은 전이가 아니라 수정이고 다른 경로다.
 */
const TRANSITIONS: readonly (readonly [ContractStatus | null, ContractStatus])[] = [
  [null, 'draft'],
  [null, 'confirmed'],
  ['draft', 'confirmed'],
  ['draft', 'cancelled'],
  ['confirmed', 'terminated'],
];

/**
 * 이 전이가 허용되는가.
 *
 * `from` 이 `null` 이면 최초 생성이다. 둘 중 하나라도 아는 값이 아니면 `false` 다 —
 * 모르는 상태에서 출발하거나 모르는 상태로 가는 길을 열어 주지 않는다.
 */
export function canTransition(from: string | null, to: string): boolean {
  if (from !== null && !isContractStatus(from)) return false;
  if (!isContractStatus(to)) return false;

  return TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/**
 * 전이를 강제한다. 막힌 전이면 던진다.
 *
 * 라우트는 이 함수를 부르고, 던진 것을 400 으로 바꿔 내보낸다.
 * 문구에 어느 전이가 막혔는지 넣는다 — 로그만 보고 원인을 알 수 있어야 한다.
 */
export function assertTransition(from: string | null, to: string): void {
  if (!canTransition(from, to)) {
    throw new RangeError(
      `허용되지 않은 상태 전이다: ${from ?? '(신규)'} → ${to}. ` +
        '되돌리는 전이는 없다 — 조건을 바꾸려면 종료 후 재계약이다',
    );
  }
}

/**
 * 계약 조건(섹션 2)이 잠겼는가 — CONT-09.
 *
 * `confirmed` 이후로는 계약 항목·금액·기간을 바꿀 수 없다. 이미 계약이 성립했고
 * 세금계산서가 걸린 값이기 때문이다.
 *
 * ★ 회사 정보(섹션1)·사용자(섹션3)·첨부(섹션4)는 `confirmed` 에서도 계속 수정한다.
 *   잠기는 것은 **계약 조건뿐**이다.
 */
export function isContractLocked(status: string | null): boolean {
  if (status === null) return false;
  if (!isContractStatus(status)) return true; // 모르는 값은 잠근다
  return status !== 'draft';
}

/** `null`(저장 전)·`draft` 에서 열려 있는 섹션. */
const ALL_SECTIONS: readonly ContractSection[] = [1, 2, 3, 4];
/** `confirmed` — 계약 조건만 잠긴다. */
const SECTIONS_WITHOUT_CONTRACT: readonly ContractSection[] = [1, 3, 4];
/** `terminated` · `cancelled` — 전 섹션 읽기 전용. */
const NO_SECTIONS: readonly ContractSection[] = [];

/**
 * 지금 수정할 수 있는 섹션 번호들 — 04-status.md 「섹션별 수정 가능 여부」.
 *
 * 화면은 이걸로 입력을 비활성화하고, 서버는 같은 값으로 쓰기를 거부한다.
 *
 * ★ 새 배열을 돌려준다. 내부 상수를 그대로 내주면 호출한 쪽이 고쳤을 때
 *   다음 호출부터 규칙이 바뀐다 — 찾기 어려운 형태의 버그다.
 */
export function editableSections(status: string | null): ContractSection[] {
  if (status === null || status === 'draft') return [...ALL_SECTIONS];
  if (status === 'confirmed') return [...SECTIONS_WITHOUT_CONTRACT];
  return [...NO_SECTIONS]; // terminated · cancelled · 모르는 값
}
