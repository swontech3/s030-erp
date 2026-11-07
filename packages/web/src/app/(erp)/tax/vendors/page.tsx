/** @screen s050100020 거래처 · 010 기초 · 세무 서비스(s05) */

/**
 * 거래처 — 매입 · 매출로 나누지 않는 한 목록(1-2, 2026-10-26 · 2026-11-07 대표 수정 ③). 업로드 때 사업자번호로 자동으로 생긴다.
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/vendors` 가 org_id = 세션 단체 ID 를 직접 건다.
 * ★ 달과 상관없는 화면이다 — 달 줄 · 「N월 거래」 칸을 뺐다(2026-11-07). 검색 조건은 화면 안에서만 든다.
 */
import { requireScreen } from '@/lib/session';
import { TaxVendorsView } from '@/features/tax/vendors/TaxVendorsView';

export default async function TaxVendorsPage() {
  await requireScreen('s050100020', '/tax/vendors');
  return <TaxVendorsView />;
}
