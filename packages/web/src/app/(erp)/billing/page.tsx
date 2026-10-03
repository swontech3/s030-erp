/** @screen s030200070 월별 청구 · 020 입주사관리 · 3차(청구 1단계와 함께 당김) */

/**
 * 월별 청구 — 사이드바 「청구」.
 *
 * 원본: design/erp-tenants/ErpTenants.dc.html 의 `data-view="billing"` ← 구성
 * 모양: design/handoff (s030200030 목록 · s030200040 확인 모달) ← 색·글꼴·표·버튼
 *
 * ★ 시안의 **세금계산서 칸과 「청구서 발행」·「미발행 N건 발행」 버튼은 만들지 않는다.**
 *   청구서는 계약 확정이 만들고(발행 절차가 없다), 세금계산서는 이번 범위가 아니다.
 *
 * ★ 운영사 전용(audience_tp='P'). 남의 입주사 청구액이 한 화면에 모인다 — `requireScreen`
 *   이 URL 직접 접근을 막고, `/billing/invoices` 는 Fastify 가 403 으로 막는다.
 *
 * 데이터는 클라이언트가 받는다 — 월을 바꿀 때마다 서버 렌더를 다시 돌리지 않으려고.
 */
import { requireScreen } from '@/lib/session';
import { BillingView } from './BillingView';

export default async function BillingPage() {
  await requireScreen('s030200070', '/billing');
  return <BillingView />;
}
