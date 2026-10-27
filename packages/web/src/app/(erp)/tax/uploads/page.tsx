/** @screen s050200010 자료 올리기 · 020 자료 모으기 · 세무 서비스(s05) */

/**
 * 자료 올리기 — 세무 전용 엑셀 창구(1-2, 2026-10-26). 1-2 는 홈택스 전자세금계산서 매입 · 매출만 동작한다.
 * 시안 `doc/tax-service/prototypes/s05-tax` 의 S05-02 그대로(`TaxUploadsView` 머리말).
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/uploads` 가 org_id = 세션 단체 ID 를 직접 건다.
 *   화면 번호 확인은 세무 설정처럼 여기(`requireScreen`)서 한다.
 * ★ 작업할 달은 주소 `?month=` — 없거나 틀리거나 이번 달보다 뒤면 지난달(`workMonthOf`).
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxUploadsView } from '@/features/tax/uploads/TaxUploadsView';

export default async function TaxUploadsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireScreen('s050200010', '/tax/uploads');
  const { month } = await searchParams;
  return <TaxUploadsView month={workMonthOf(month, new Date())} />;
}
