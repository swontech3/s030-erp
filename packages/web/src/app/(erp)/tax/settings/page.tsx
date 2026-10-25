/** @screen s050100010 세무 설정 · 010 기초 · 세무 서비스(s05) */

/**
 * 세무 설정 — 사업자 유형 · 세무사 메일 · 계좌 · 카드 · 쓰지 않는 자료 · 원천세 신고 주기(1-1, 2026-10-25).
 * 회사 기본정보는 보기만 한다. 시안 `doc/tax-service/prototypes/s05-tax` 의 S05-11 그대로(`TaxSettingsView` 머리말).
 *
 * ★ 운영사 · 회사 모두 **자기 단체만** — Fastify `/tax/settings` 가 org_id = 세션 단체 ID 를 직접 건다.
 *   화면 번호 확인은 법무처럼 여기(`requireScreen`)서 한다.
 */
import { requireScreen } from '@/lib/session';
import { TaxSettingsView } from '@/features/tax/settings/TaxSettingsView';

export default async function TaxSettingsPage() {
  await requireScreen('s050100010', '/tax/settings');
  return <TaxSettingsView />;
}
