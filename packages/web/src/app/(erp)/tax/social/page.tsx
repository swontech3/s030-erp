/** @screen s050300050 4대보험 · 030 정리하기 · 세무 서비스(s05) */

/**
 * 4대보험 — 1-6 에서 올린 4대보험 고지를 보기만 한다(2026-11-08 ⑥ — 세금 · 4대보험 · 대출의 탭에서 메뉴로 나눔).
 * 검색조건 / 버튼 / 목록 짜임은 `TaxSocialView` 머리말.
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/payments?tab=SOCIAL` 이 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 고지 연월은 주소 `?month=`(없으면 지난달). 자료 올리기 [보기]는 4대보험 파일을 `?file=` 로 보낸다.
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxSocialView } from '@/features/tax/payments/TaxSocialView';

export default async function TaxSocialPage({ searchParams }: { searchParams: Promise<{ month?: string; file?: string }> }) {
  await requireScreen('s050300050', '/tax/social');
  const { month, file } = await searchParams;
  const fileId = file?.trim() ? file.trim() : null;
  return <TaxSocialView key={fileId ?? ''} month={workMonthOf(month, new Date())} fileId={fileId} />;
}
