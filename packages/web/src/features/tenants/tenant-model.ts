/**
 * s030200030 이 쓰는 모양과 표시 형식.
 *
 * ★ 상태 판정은 여기 없다 — `@swonbiz/shared/domain/tenant-status` 가 갖는다.
 *   이 파일은 서버가 준 값을 화면 문자열로 바꾸는 일만 한다.
 */
import type { TenantFilterKey } from '@swonbiz/shared/domain/tenant-status';
import { EXPIRED_LABEL, isContractExpired } from '@swonbiz/shared/domain/contract-status';
import { contractStatusNameFromMap } from '@/features/contracts/contract-status-name';

/** `GET /companies` 의 한 줄. */
export interface TenantCard {
  companyId: string;
  companyName: string;
  ceoName: string | null;
  tel: string | null;
  bizNumber: string | null;
  /** 사업자등록 신청 중 — 회사명 앞에 「(가등록)」이 붙는다. */
  provisional: boolean;
  statusLabel: string;
  filters: TenantFilterKey[];
  /**
   * 정렬용 — 종료일이 가장 가까운 «확정» 계약까지의 일수. **지났으면 음수**이고,
   * 확정된 계약이 없으면 `null` 이다. 규칙과 이유는 `tenant-status` 의 `sortDays`.
   */
  sortDays: number | null;
  contractCount: number;
  /**
   * 삐용 연동이 대기 중인가 — 계약은 확정됐는데 삐용에 회사가 아직 없다(3-2).
   *
   * ★ **표시 전용이다.** 이 화면에 [다시 시도] 버튼을 두지 않는다 — 처리는 계약 폼
   *   한 곳이고(`CLAUDE.md` 한 업무 한 화면), 여기서는 계약으로 링크한다.
   */
  bbiyongPending?: boolean;
  roomSummary: string;
}

/** `GET /companies/:id` 의 계약 한 줄(서버가 준 원형). */
export interface ContractSummaryResponse {
  contractId: string;
  contractNo: string | null;
  status: string;
  periodMonths: number | null;
  contractDate: string | null;
  startDate: string;
  endDate: string;
  paymentMethod: string | null;
  contractRoom: string | null;
  firstPayment: number;
  monthlyPayment: number;
  depositTotal: number;
  roomTypes: string[];
  roomNames: string;
  spaceCount: number;
}

/** 화면이 쓰는 모양 — 표시 문자열을 미리 붙여 둔다. */
export interface TenantContract extends ContractSummaryResponse {
  statusLabel: string;
  planLabel: string;
  paymentMethodLabel: string;
}

/**
 * ★ `YYYY.MM.DD` — **`slice(0, 10)` 을 쓰지 않는다.**
 *
 * 계약의 날짜 칸은 `timestamp`/`date` 이고 pg 는 그것을 **로컬 자정의 Date** 로 준다.
 * JSON 을 거치면 `2026-01-14T15:00:00.000Z`(KST 1월 15일)가 되므로 앞 10자를 자르면
 * **하루 앞선 날짜**가 나온다. 계약 폼의 `toDateInput` 과 같은 사정이다.
 */
export function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** 원본의 `won()` — `₩400,000`. */
export function formatWon(n: number): string {
  return `₩${(n || 0).toLocaleString('ko-KR')}`;
}

/** 날짜 두 개의 일수 차이. 시:분:초를 버린다. */
export function daysUntil(value: string, today: Date): number {
  const d = new Date(value);
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** 계약 행 2줄째 — 「잔여 9일」 / 「종료」. */
export function remainingLabel(contract: ContractSummaryResponse, today: Date): string {
  if (contract.status !== 'confirmed') return '—';
  const left = daysUntil(contract.endDate, today);
  return left >= 0 ? `잔여 ${left}일` : '종료';
}

/** 만기 30일 이내인가 — 잔여일 문구와 상태 칸의 「만기 임박」이 같은 판정을 본다. */
export function isExpiringSoon(contract: ContractSummaryResponse, today: Date, soonDays: number): boolean {
  if (contract.status !== 'confirmed') return false;
  const left = daysUntil(contract.endDate, today);
  return left >= 0 && left <= soonDays;
}

/**
 * 계약 상태 뱃지 문구.
 *
 * ★ **표시명은 코드 테이블에서 온다**(`CONTRACT_ST` / `use_tp='000'`). 2026-09-19
 *   이전에는 여기 「대기 / 진행중 / 종료 / 취소」가 박혀 있었는데, 계약 폼은 같은
 *   상태를 다른 이름으로 부르고 있었다. 이름을 한 곳으로 모았다 —
 *   `features/contracts/contract-status-name.ts`.
 *   `codeNames` 는 s030200030 이 들고 있는 `카테고리:코드 → 이름` 사전이다.
 *   코드를 못 받으면 그쪽 기본값이 받는다. **빈 칸이 되지 않는다.**
 *
 * ★ 만료는 상태값이 아니라 **날짜**다. `confirmed` 인데 종료일이 지났으면
 *   「계약중(만료)」다. 저장된 상태는 그대로 `confirmed` 이므로 **코드 테이블에 넣지
 *   않았다** — 저장되지 않는 이름이 코드 목록에 끼면 상태가 다섯 개인 것처럼 보인다.
 *
 * ★ 문구는 `EXPIRED_LABEL` 하나다 — 입주사 목록 뱃지가 같은 상수를 쓴다. 왼쪽 카드는
 *   「계약중(만료)」인데 오른쪽 계약 행은 「만료」인 화면이 되면 안 된다.
 */
export function contractStatusLabel(
  contract: ContractSummaryResponse,
  today: Date,
  codeNames: Readonly<Record<string, string>>,
): string {
  // ★ 판정은 `isContractExpired` 한 곳이다 — 「기간 만료」 칩이 같은 함수를 본다.
  //   두 벌이면 행은 만료라는데 칩에는 안 뜨는 상태가 된다.
  if (isContractExpired({ status: contract.status, endDate: new Date(contract.endDate), today })) {
    return EXPIRED_LABEL;
  }
  return contractStatusNameFromMap(codeNames, contract.status);
}

/** 「1인실」 / 「1인실 외 2건」 — 명세 「항목 1개면 그 값, 여러 개면 …」. */
export function planLabel(roomTypeNames: string[], spaceCount: number): string {
  const first = roomTypeNames[0];
  if (!first) return '—';
  return spaceCount > 1 ? `${first} 외 ${spaceCount - 1}건` : first;
}

/** 검색 — 회사명·대표자. placeholder 가 「회사명, 대표자 검색」이다. */
export function matchesSearch(card: TenantCard, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return [card.companyName, card.ceoName ?? ''].some((v) => v.toLowerCase().includes(q));
}
