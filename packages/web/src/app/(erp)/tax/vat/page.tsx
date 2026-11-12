/** @screen s050400020 부가세 조회 · 040 결과 보기 · 세무 서비스(s05) */

/**
 * 부가세 조회 — 신고 기간별 낼 세금 예상 · 공제가 안 될 수 있는 매입을 보기만 한다(1-8, 2026-11-05). 시안 S05-09 · 결과서 S05-09.
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/vat` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 신고 기간은 작업할 달이 든 기간 — 이 화면에서 기간을 고르면 주소의 달이 그 기간 끝 달로 바뀐다(11-06).
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxVatView } from '@/features/tax/vat/TaxVatView';

export default async function TaxVatPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireScreen('s050400020', '/tax/vat');
  const { month } = await searchParams;
  const work = workMonthOf(month, new Date());
  return <TaxVatView key={work} month={work} />;
}
