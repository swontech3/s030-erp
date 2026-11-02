/** @screen s050300040 세금 · 보험 납부 · 대출 · 030 정리하기 · 세무 서비스(s05) */

/**
 * 세금 · 보험 납부 · 대출 — 1-6 에서 올린 국세 · 지방세 · 4대보험 · 대출 자료를 보기만 한다(1-7, 2026-11-02). 시안 없음 —
 * 세무 화면의 같은 부품(작업할 달 줄 · 탭 · 버튼 줄 · 표)으로 만든다(`TaxPaymentsView` 머리말).
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/payments` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 자료 올리기 [보기]는 `?file=` 로 들어와 그 파일 종류의 탭으로 연다.
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { tabOfFileKind, type PaymentTab } from '@swonbiz/shared/domain/tax-payments';
import { requireScreen } from '@/lib/session';
import { TaxPaymentsView } from '@/features/tax/payments/TaxPaymentsView';

export default async function TaxPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string; file?: string }>;
}) {
  await requireScreen('s050300040', '/tax/payments');
  const { month, tab, file } = await searchParams;
  const work = workMonthOf(month, new Date());
  const initialTab: PaymentTab = tabOfFileKind(tab ?? '') ?? 'NTAX';
  // ★ 주소(달 · 탭 · 파일)가 바뀌면 새로 그린다 — 작업할 달 줄은 `?month=` 만 싣고 가므로 파일 거르기가 남지 않게
  return (
    <TaxPaymentsView
      key={`${work}|${tab ?? ''}|${file ?? ''}`}
      month={work}
      initialTab={initialTab}
      fileId={file?.trim() ? file.trim() : null}
    />
  );
}
