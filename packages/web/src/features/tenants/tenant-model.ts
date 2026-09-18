/**
 * s0300200030 이 쓰는 모양과 표시 형식.
 *
 * ★ 상태 판정은 여기 없다 — `@swonbiz/shared/domain/tenant-status` 가 갖는다.
 *   이 파일은 서버가 준 값을 화면 문자열로 바꾸는 일만 한다.
 */
import type { TenantFilterKey } from '@swonbiz/shared/domain/tenant-status';

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
  contractCount: number;
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

const STATUS_LABEL: Record<string, string> = {
  draft: '대기',
  confirmed: '진행중',
  terminated: '종료',
  cancelled: '취소',
};

/**
 * 계약 상태 뱃지 문구.
 *
 * ★ 시안은 「진행중 / 만료」 둘만 그린다(확정된 계약만 있는 시안 데이터라서).
 *   저장 가능한 상태는 넷이고(`draft`·`confirmed`·`terminated`·`cancelled`) 화면에
 *   전부 뜰 수 있다. 시안에 없는 둘은 계약 폼의 상태 어휘(04-status.md)를 그대로 쓴다 —
 *   거기서는 `draft`=「계약 대기」, `cancelled`=「취소」다.
 *
 * ★ 만료는 상태값이 아니라 **날짜**다. `confirmed` 인데 종료일이 지났으면 「만료」다.
 */
export function contractStatusLabel(contract: ContractSummaryResponse, today: Date): string {
  if (contract.status === 'confirmed' && daysUntil(contract.endDate, today) < 0) return '만료';
  return STATUS_LABEL[contract.status] ?? contract.status;
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
