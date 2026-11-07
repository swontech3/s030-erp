/** @screen s050300040 세금 납부 · 030 정리하기 · 세무 서비스(s05) */

/**
 * 세금 납부 — 1-6 에서 올린 국세 · 지방세 납부를 한 목록으로 보기만 한다(1-7 세금 · 4대보험 · 대출에서 2026-11-08 ⑥ 으로 나눔).
 * 검색조건 / 버튼 / 목록 짜임은 `TaxPaymentsView` 머리말.
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/payments` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 자료 올리기 [보기]는 국세 · 지방세 파일을 `?file=` 로 보낸다.
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxPaymentsView } from '@/features/tax/payments/TaxPaymentsView';

export default async function TaxPaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string; file?: string }> }) {
  await requireScreen('s050300040', '/tax/payments');
  const { month, file } = await searchParams;
  const fileId = file?.trim() ? file.trim() : null;
  // ★ 파일이 바뀌면 새로 그린다 — 달만 바뀌면 검색조건은 그대로 두고 다시 읽는다
  return <TaxPaymentsView key={fileId ?? ''} month={workMonthOf(month, new Date())} fileId={fileId} />;
}
