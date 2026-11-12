/** @screen s050500010 세무사 전달 서류 · 050 세무사 전달 · 세무 서비스(s05) */

/**
 * 세무사 전달 서류 — 부가세 신고 기간의 자료를 시트 아홉 엑셀로 묶어 미리 보고, 세무사 메일로 보내거나 내려받는다(1-9, 2026-11-07).
 * 시안 S05-10 · 결과서 S05-10.
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/handoff` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 신고 기간은 작업할 달이 든 기간 — 기간을 고르면 주소의 달이 그 기간 끝 달로 바뀐다(부가세 조회와 같다).
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxHandoffView } from '@/features/tax/handoff/TaxHandoffView';

export default async function TaxHandoffPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireScreen('s050500010', '/tax/handoff');
  const { month } = await searchParams;
  const work = workMonthOf(month, new Date());
  return <TaxHandoffView key={work} month={work} />;
}
