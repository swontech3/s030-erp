/** @screen s040200010 법인변경 · 020 법인변경 · 법무 서비스(s04) */

/**
 * 법인변경 목록 — 목록 조회(2단계) · [새 건](3단계, 2026-10-10). 줄을 누르면 상세(s040200011).
 *
 * ★ 이 화면은 **운영사와 회사가 함께 쓴다.** 운영사는 전체 건을, 회사(입주사·비입주사)는
 *   자기 건만 본다 — 판정은 DB 의 RLS(`erp_org_scope`, 037)가 삐용 단체 ID 로 한다.
 * ★ 회사는 입력 · 작성완료 · 서류수정 · 완료까지, 완료 취소 · 취소 · 복원 · 삭제는 운영사만(결정 2026-10-10 —
 *   제출(A) 단계는 없앴다). 상태 전이는 상세 화면에서만, shared 의 `checkTransition` 으로 서버가 막는다.
 * ★ 목록 · 선택지는 클라이언트가 받는다 — 조건을 바꿀 때마다 서버 렌더를 다시 돌리지 않으려고.
 * ★ [새 건] 의 회사 고르기: 운영사는 공용 회사 조회 팝업(`components/org-lookup`), 회사 사용자는
 *   자기 회사로 바로 시작한다 — 팝업 API 가 운영사 전용이라 회사 화면에는 두지 않는다
 *   (`OrgLookupDialog` 머리말). 그래서 세션 역할을 **화면 모양에만** 쓴다. 남의 단체로 만드는
 *   것은 서버가 막는다(코드 + RLS).
 */
import { getMe, requireScreen } from '@/lib/session';
import { CorpChangesView } from '@/features/legal/CorpChangesView';

export default async function CorpChangesPage() {
  await requireScreen('s040200010', '/legal/corp-changes');
  const me = await getMe();
  return <CorpChangesView pickOrg={me?.role === 'operator'} />;
}
