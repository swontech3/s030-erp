/** @screen s050400010 월별 손익 · 040 결과 보기 · 세무 서비스(s05) */

/**
 * 월별 손익 — 달마다 매출 · 비용 · 이익을 보기만 한다(1-8, 2026-11-05). 시안 S05-08 · 결과서 S05-08.
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/pl` 이 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 막대를 누르면 그 달로 바뀐다(모든 세무 화면 공통).
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxPlView } from '@/features/tax/pl/TaxPlView';

export default async function TaxPlPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireScreen('s050400010', '/tax/monthly-pl');
  const { month } = await searchParams;
  const work = workMonthOf(month, new Date());
  return <TaxPlView key={work} month={work} />;
}
