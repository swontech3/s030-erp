/** @screen s050100020 거래처 · 010 기초 · 세무 서비스(s05) */

/**
 * 거래처 — 매입 · 매출로 나누지 않는 한 목록(1-2, 2026-10-26). 업로드 때 사업자번호로 자동으로 생긴다.
 * 시안 `doc/tax-service/prototypes/s05-tax` 의 S05-06 그대로(`TaxVendorsView` 머리말).
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/vendors` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 달 선택은 없지만 「{달} 거래」 칸은 작업할 달(주소 `?month=`, 없으면 지난달)을 따른다(결과서 0-2).
 */
import { workMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { requireScreen } from '@/lib/session';
import { TaxVendorsView } from '@/features/tax/vendors/TaxVendorsView';

export default async function TaxVendorsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireScreen('s050100020', '/tax/vendors');
  const { month } = await searchParams;
  return <TaxVendorsView month={workMonthOf(month, new Date())} />;
}
