/**
 * 청구서의 **화면 상태** 판정 — 순수 함수.
 *
 * 레거시 S-WonERP `src/lib/invoice-status.ts` 에서 가져왔다. 시험도 함께 옮겼다.
 *
 * =============================================================================
 * ★★ 저장상태와 화면상태는 다른 것이다
 * =============================================================================
 * 저장되는 것은 셋뿐이다 — `P` 납부대기 / `E` 납부완료 / `C` 취소
 * (`invoice-recalc.ts` 의 `computeStoredStatus`).
 *
 * 화면은 다섯이다 — 여기에 **미납**과 **부분납부**가 더해진다. 둘 다 저장할 수 없는
 * 종류의 사실이기 때문이다:
 *   · 미납   = 「납부일이 지났는데 안 들어왔다」 — **시간이 지나면 저절로 참이 된다.**
 *              저장하면 매일 배치가 P 를 O 로 바꿔 줘야 하고, 배치가 하루 멈추면
 *              청구서가 조용히 거짓말을 한다
 *   · 부분납부 = 수납 합계와 청구액의 관계다 — 이미 두 칸에 다 있다
 *
 * ★ 코드 `PAY_ST` 에 `O`(미납)가 있지만 **저장하지 않는다.** 화면 필터가 쓰는 이름이다.
 *
 * =============================================================================
 * ★★★ 레거시에서 **고친 것 하나** — 납부일 당일
 * =============================================================================
 * 레거시는 `asOf > dueDate` 로 `Date` 를 그냥 비교했다. pg 의 `date` 는 **로컬 자정**
 * 으로 오고 「지금」은 하루 중 어느 시각이라, **납부일 당일 00:00 을 넘긴 순간부터
 * 미납**이 된다. 납부일 아침에 전 입주사가 한꺼번에 연체로 뜬다.
 *
 * 옮기기 전에 레거시 구현 그대로 시험을 돌려 실제로 깨지는 것을 확인했다
 * (`unpaid` 가 나왔다). 그 시험이 `invoice-status.test.ts` 마지막 describe 다.
 *
 * `day.ts` 머리말이 같은 종류의 어긋남을 이미 적어 두었다 — `Date` 끼리의 비교는
 * 전부 `daysBetweenLocal` 을 거친다.
 *
 * ★ 레거시의 `STATUS_META`(배지 색 팔레트)는 **옮기지 않았다.** 이 저장소는 디자인
 *   토큰(`design/handoff/tokens`)이 색을 정한다 — 도메인 모듈에 색을 박으면 두 벌이 된다.
 */
import { daysBetweenLocal } from './day.ts';

export type DisplayStatus = 'paid' | 'partial' | 'unpaid' | 'pending' | 'canceled';

/**
 * 지금 이 청구서를 화면에 뭐라고 쓸 것인가.
 *
 * @param status  저장된 상태 `P` / `E` / `C`
 * @param dueDate 납부일. `null` 이면 기한이 없는 것으로 보아 미납 판정을 하지 않는다
 * @param asOf    「지금」. 부르는 쪽의 시각을 여기서 추측하지 않는다
 */
export function displayInvoiceStatus(args: {
  status: string;
  paidAmount: number;
  totalAmount: number;
  dueDate: Date | null;
  asOf: Date;
}): DisplayStatus {
  const { status, paidAmount, totalAmount, dueDate, asOf } = args;

  if (status === 'C') return 'canceled';
  if (status === 'E' || paidAmount >= totalAmount) return 'paid';
  if (paidAmount > 0) return 'partial';

  // ★ 납부일 **당일은 아직 미납이 아니다.** 하루가 다 지나야 한다.
  if (dueDate !== null && daysBetweenLocal(dueDate, asOf) > 0) return 'unpaid';

  return 'pending';
}
