/** @screen s050000010 이번 달 할 일 · 000 · 세무 서비스(s05) */

/**
 * 이번 달 할 일 — ★ 1단계에서 뺐다(2026-11-07 대표 결정). 2단계에서 시안 S05-01 대로 채운다.
 *
 * ★ 1단계 세무 첫 화면은 월별 손익이다. 주소로 들어오면 `/tax/monthly-pl` 로 보낸다 — `?month=` 는 그대로 넘긴다.
 *   화면 권한(s050000010)을 보기 전에 보낸다 — 1단계에서는 이 화면 번호를 주지 않으므로, 먼저 보면 「접근 권한 없음」으로 막힌다.
 * ★ 화면 파일 · 화면 번호(screens.ts)는 지우지 않는다 — 사이드바 · 개발용 가짜 계정에서만 뺐다.
 */
import { redirect } from 'next/navigation';

export default async function TaxThisMonthPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const { month } = await searchParams;
  redirect(typeof month === 'string' ? `/tax/monthly-pl?month=${encodeURIComponent(month)}` : '/tax/monthly-pl');
}
