/** @screen s050300010 매출 · 매입 항목 지정 · 030 정리하기 · 세무 서비스(s05) */

/**
 * 매출 · 매입 항목 지정(옛 이름 거래 분류, 2026-10-28) — 매입 줄에 출금 항목을 붙인다(1-3, 2026-10-27).
 * 2026-11-08 대표 수정 ⑤ — 검색조건(년월 · 구분 · 출처) / 버튼 / 목록 짜임(`TaxClassifyView` 머리말).
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/classify` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 작업할 달은 주소 `?month=`(없으면 지난달). 자료 올리기 [보기]는 `?file=`(옛 `view=all` 도 붙어 오지만 보지 않는다)로 들어와 그 파일 줄만 보인다.
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxClassifyView } from '@/features/tax/classify/TaxClassifyView';

export default async function TaxClassifyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; file?: string }>;
}) {
  await requireScreen('s050300010', '/tax/classify');
  const { month, file } = await searchParams;
  const work = workMonthOf(month, new Date());
  const fileId = file?.trim() ? file.trim() : null;
  // ★ 파일이 바뀌면 새로 그린다 — 달만 바뀌면 구분 · 출처 검색조건은 그대로 두고 다시 읽는다
  return <TaxClassifyView key={fileId ?? ''} month={work} fileId={fileId} />;
}
