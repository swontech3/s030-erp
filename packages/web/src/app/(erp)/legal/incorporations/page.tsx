/** @screen s040100010 법인설립 · 010 법인설립 · 법무 서비스(s04) */

/**
 * 법인설립 목록 — 주식회사 · 발기설립(10-4, 2026-10-11). 줄을 누르면 상세(s040100020).
 *
 * ★ 이 화면은 **운영사와 회사가 함께 쓴다.** 운영사는 전체 건을, 회사는 자기 건만 본다 — 판정은 DB 의
 *   RLS(`erp_org_scope`, 042)가 삐용 단체 ID 로 한다. 상태 전이 규칙은 법인변경과 같다.
 * ★ [새 건] 의 회사 고르기는 법인변경과 같다 — 운영사는 공용 회사 조회 팝업, 회사 사용자는 자기 회사.
 *   그래서 세션 역할을 **화면 모양에만** 쓴다. 남의 단체로 만드는 것은 서버가 막는다(코드 + RLS).
 */
import { getMe, requireScreen } from '@/lib/session';
import { IncorporationsView } from '@/features/legal/IncorporationsView';

export default async function IncorporationsPage() {
  await requireScreen('s040100010', '/legal/incorporations');
  const me = await getMe();
  return <IncorporationsView pickOrg={me?.role === 'operator'} />;
}
