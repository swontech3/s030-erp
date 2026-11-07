/** @screen s050300060 대출내역 · 030 정리하기 · 세무 서비스(s05) */

/**
 * 대출내역 — 1-6 에서 올린 대출 거래를 보기만 한다(2026-11-08 ⑥ — 세금 · 4대보험 · 대출의 탭에서 메뉴로 나눔).
 * 검색조건 / 버튼 / 목록 짜임은 `TaxLoansView` 머리말.
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/payments?tab=LOAN` 이 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 자료 올리기 [보기]는 대출 파일을 `?file=` 로 보낸다.
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxLoansView } from '@/features/tax/payments/TaxLoansView';

export default async function TaxLoansPage({ searchParams }: { searchParams: Promise<{ month?: string; file?: string }> }) {
  await requireScreen('s050300060', '/tax/loans');
  const { month, file } = await searchParams;
  const fileId = file?.trim() ? file.trim() : null;
  return <TaxLoansView key={fileId ?? ''} month={workMonthOf(month, new Date())} fileId={fileId} />;
}
