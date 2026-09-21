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

import { isContractExpired } from './contract-status.ts';
import { daysBetweenLocal } from './day.ts';

/** 만기 임박으로 보는 잔여일. `02-master-detail.md` 「만기 30일 이내」. */
export const EXPIRY_SOON_DAYS = 30;

/**
 * 필터 칩의 키. 한 입주사가 둘 이상에 걸릴 수 있다(계약중 + 만기 임박).
 *
 * ★★ `expired`(기간 만료)와 `ended`(종료)는 **다르다.**
 *   `expired`  종료일이 지났는데 **아직 `confirmed` 인** 계약이 있다 — 할 일이 남았다
 *   `ended`    종료 처리가 끝났다 — 할 일이 없다
 *
 *   자동 종료 배치를 만들지 않기로 했으므로 둘은 사람이 처리했는지로 갈린다. 예전에는
 *   한 칩이었는데, 그러면 **처리한 곳과 안 한 곳이 섞여** 운영자가 어디를 봐야 하는지
 *   알 수 없었다.
 */
export type TenantFilterKey = 'active' | 'soon' | 'expired' | 'review' | 'ended';

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
    .filter((c) => c.status === 'confirmed' && daysBetweenLocal(today, c.endDate) >= 0)
    .map((c) => daysBetweenLocal(today, c.endDate));

  /*
   * ★★ 종료 처리가 남은 계약 — 「기간 만료」.
   *
   * 판정은 `contract-status` 의 `isContractExpired` **하나**다. 계약 행의 「만료」
   * 뱃지도 같은 함수를 본다 — 두 벌이면 행은 만료라는데 칩에는 안 뜨는 상태가 된다.
   *
   * ★ 살아 있는 계약과 **함께 걸릴 수 있다.** 새 계약을 맺어 두고 옛 계약을 아직 안
   *   닫은 경우다. 그때도 닫을 것이 남았다는 사실은 보여야 한다.
   */
  const hasExpired = contracts.some((c) =>
    isContractExpired({ status: c.status, endDate: c.endDate, today }),
  );

  if (live.length > 0) {
    const remainingDays = Math.min(...live);
    const soon = remainingDays <= EXPIRY_SOON_DAYS;

    /*
     * ★★ 칩은 **더해진다.** 만료가 붙었다고 「만기 임박」에서 빼면, 임박으로 거르는
     *    운영자가 그 회사를 못 본다 — 한 번 그렇게 만들었다가 칩 개수가 줄어드는
     *    것으로 드러났다(2026-09-21).
     */
    const filters: TenantFilterKey[] = ['active'];
    if (soon) filters.push('soon');
    if (hasExpired) filters.push('expired');

    /*
     * 뱃지는 **하나**뿐이라 골라야 한다. **할 일 쪽**을 보여준다 — 계약중·임박은 칩으로
     * 찾을 수 있지만, 닫아야 할 계약은 여기서 말하지 않으면 아무 데서도 드러나지 않는다.
     *
     * ★ 시안의 뱃지 문구가 `D-9` 다. 「만기 임박」은 칩 이름이지 뱃지 문구가 아니다.
     */
    const label = hasExpired ? '기간 만료' : soon ? `D-${remainingDays}` : '계약중';
    return { label, filters, remainingDays };
  }

  // ★ 살아 있는 계약이 없고 만료된 계약만 있다 — 재계약 의사를 확인하고 닫을 자리다.
  //   **호실은 그대로 잡고 있다**(상태가 `confirmed` 이므로). 자동으로 풀지 않는다.
  if (hasExpired) return { label: '기간 만료', filters: ['expired'], remainingDays: null };

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
