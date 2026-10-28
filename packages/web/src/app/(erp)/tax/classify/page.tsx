/** @screen s050300010 매출 · 매입 항목 지정 · 030 정리하기 · 세무 서비스(s05) */

/**
 * 매출 · 매입 항목 지정(옛 이름 거래 분류, 2026-10-28) — 항목이 빈 매입 계산서에 출금 항목을 붙인다(1-3, 2026-10-27).
 * 시안 `doc/tax-service/prototypes/s05-tax` 의 S05-05 그대로(`TaxClassifyView` 머리말).
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/classify` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 자료 올리기 [보기]는 `?view=all&file=` 로 들어와 「이번 달 자료 전체」 탭으로 연다.
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxClassifyView } from '@/features/tax/classify/TaxClassifyView';

export default async function TaxClassifyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; file?: string }>;
}) {
  await requireScreen('s050300010', '/tax/classify');
  const { month, view, file } = await searchParams;
  const work = workMonthOf(month, new Date());
  // ★ 주소(달 · 보기 · 파일)가 바뀌면 새로 그린다 — 작업할 달 줄은 `?month=` 만 싣고 가므로 파일 거르기가 남지 않게
  return (
    <TaxClassifyView
      key={`${work}|${view ?? ''}|${file ?? ''}`}
      month={work}
      initialView={view === 'all' || file ? 'all' : 'left'}
      fileId={file?.trim() ? file.trim() : null}
    />
  );
}
