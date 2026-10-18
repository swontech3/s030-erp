/** @screen s040900010 설정 · 090 설정 · 법무 서비스(s04) */

/**
 * 설정 — 등기 설정(표시명 · 양식호수 · 등기의 목적/사유 · 등기할 사항 · 세금 · 첨부서면)을 구분별로 고친다
 * (2026-10-18).
 *
 * ★ **시안이 없다.** 모양은 코드 관리(s030100030)와 같다(`DocFormSettingsView` 머리말).
 *
 * ★★ **운영사 전용.** `requireScreen` 이 주소 직접 접근을 막고(삐용이 회사에 이 화면을 주지 않는다),
 *    Fastify `/legal/doc-form-settings` 가 `role !== 'operator'` 를 403 으로 막는다(표에 RLS 가 없다).
 *
 * ★★★ **등기 설정을 고치는 자리는 이 화면 하나다**(CLAUDE.md 「한 업무는 한 화면에서」). 법인변경 · 설립
 *    서류 출력은 설정을 읽기만 한다.
 */
import { requireScreen } from '@/lib/session';
import { DocFormSettingsView } from '@/features/legal/DocFormSettingsView';

export default async function DocFormSettingsPage() {
  await requireScreen('s040900010', '/legal/doc-form-settings');
  return <DocFormSettingsView />;
}
