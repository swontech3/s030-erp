/**
 * 입주사 상태 판정 — s0300200030 의 상태 뱃지와 필터 칩이 같은 함수를 본다.
 *
 * ★ 화면이 이 규칙을 다시 쓰지 않는다. 목록 카드의 뱃지, 우측 패널 헤더의 뱃지,
 *   칩의 건수가 전부 여기서 나온다. 세 곳이 따로 판정하면 「계약중 21」이라고 적힌
 *   칩을 눌렀을 때 20건만 나오는 식으로 조용히 어긋난다.
 *
 * =============================================================================
 * ★★ 상태는 **계약**이 정한다. `tb_s080_companies.status` 가 아니다
 * =============================================================================
 * 코드 `COMPANY_ST`(R 입주예약 / O 입주중 / E 퇴실)가 회사 행에 있지만, 시안의 칩은
 * 「계약중 · 만기 임박 · 검토중 · 종료」이고 셋은 계약에서 유도되는 값이다.
 * 회사 행의 값을 쓰면 계약이 끝났는데 「입주중」으로 남는 상태를 사람이 손으로
 * 맞춰야 한다 — 그 순간 둘이 갈린다.
 *
 * =============================================================================
 * ★ 계약이 **한 건도 없는** 입주사는 「검토중」이다
 * =============================================================================
 * 시안 데이터에서 계약 0건인 곳은 세움컴퍼니 하나이고 「검토중」으로 그려져 있다.
 * 가등록(사업자등록 신청 중)이라 그렇게 보일 수도 있지만, 「검토중」을 **계약 전**으로
 * 읽으면 규칙이 셋으로 끝난다 — 유효 계약 있음 / 있었으나 끝남 / 아직 없음.
 * 새 라벨을 지어내지 않으려고 이 해석을 택했다. **판단이 필요했던 자리다.**
 *
 * 임시저장(`draft`)·취소(`cancelled`)만 있는 입주사도 같은 「검토중」이다. 그쪽을
 * 「종료」로 넣으면 계약서를 아직 쓰는 중인 회사가 끝난 회사로 보인다.
 *
 * 가등록 여부는 이것과 **직교**한다 — 회사명 앞 「(가등록)」과 2행의 「사업자등록 신청 중」은
 * 사업자번호가 없다는 표시이지 상태가 아니다.
 */

/** 만기 임박으로 보는 잔여일. `02-master-detail.md` 「만기 30일 이내」. */
export const EXPIRY_SOON_DAYS = 30;

/** 필터 칩의 키. 한 입주사가 둘 이상에 걸릴 수 있다(계약중 + 만기 임박). */
export type TenantFilterKey = 'active' | 'soon' | 'review' | 'ended';

export interface TenantStatus {
  /** 카드 우측 뱃지 문구. 만기 임박이면 `D-9` 처럼 남은 일수다. */
  label: string;
  /** 이 입주사가 걸리는 칩. **배열이다** — 「계약중이면서 만기 임박」이 있다. */
  filters: TenantFilterKey[];
  /** 유효 계약 중 가장 빨리 끝나는 것의 잔여일. 없으면 `null`. */
  remainingDays: number | null;
}

export interface TenantContractFact {
  /** `confirmed` 만 유효 계약으로 센다. draft·cancelled 는 아직/이미 계약이 아니다. */
  status: string;
  endDate: Date;
}

/** 날짜 두 개의 **일수** 차이. 시:분:초를 버리고 UTC 자정끼리 뺀다. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * 입주사 하나의 상태.
 *
 * `today` 를 받는다 — 함수 안에서 `new Date()` 를 부르면 시험할 수 없고, 목록 한 번을
 * 그리는 동안 자정을 넘기면 행마다 기준이 달라진다.
 */
export function deriveTenantStatus(args: {
  contracts: readonly TenantContractFact[];
  today: Date;
}): TenantStatus {
  const { contracts, today } = args;

  // 유효 계약 = 확정됐고 아직 끝나지 않은 것. 종료일 당일까지는 계약 중이다.
  const live = contracts
    .filter((c) => c.status === 'confirmed' && daysBetween(today, c.endDate) >= 0)
    .map((c) => daysBetween(today, c.endDate));

  if (live.length > 0) {
    const remainingDays = Math.min(...live);
    if (remainingDays <= EXPIRY_SOON_DAYS) {
      // 시안의 뱃지 문구가 `D-9` 다. 「만기 임박」은 칩 이름이지 뱃지 문구가 아니다.
      return { label: `D-${remainingDays}`, filters: ['active', 'soon'], remainingDays };
    }
    return { label: '계약중', filters: ['active'], remainingDays };
  }

  // ★ 「종료」는 **계약이 성립했다가 끝난** 것이다. `draft`(작성 중)와 `cancelled`(성립 전
  //   취소)는 여기 들어가지 않는다 — 임시저장만 해 둔 입주사가 「종료」로 보이면
  //   운영자가 끝난 회사로 읽는다.
  const everLive = contracts.some((c) => c.status === 'confirmed' || c.status === 'terminated');
  if (everLive) return { label: '종료', filters: ['ended'], remainingDays: null };

  // 유효 계약에 이르지 못했다 — 계약이 아예 없거나, 임시저장·취소뿐이다. 위 ★ 참조.
  return { label: '검토중', filters: ['review'], remainingDays: null };
}

/**
 * 칩 필터 적용 — **하나도 안 켜져 있으면 거르지 않는다.**
 *
 * 시안: 「멀티 선택, 기본 "계약중"만 선택, 전체 해제 시 모두 표시」.
 * 전체 해제를 "아무것도 안 보임"으로 읽으면 [전체] 버튼이 목록을 비우게 된다.
 */
export function matchesChips(filters: readonly TenantFilterKey[], on: readonly TenantFilterKey[]): boolean {
  if (on.length === 0) return true;
  return filters.some((f) => on.includes(f));
}
