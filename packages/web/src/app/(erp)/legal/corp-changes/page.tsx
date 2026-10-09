/** @screen s040200010 법인변경 · 020 법인변경 · 법무 서비스(s04) */

/**
 * 법인변경 목록 — 2단계(2026-10-10). 새 건 · 상세 · 임원 · 상태 전이는 3단계 이후다.
 *
 * ★ 이 화면은 **운영사와 회사가 함께 쓴다.** 운영사는 전체 건을, 회사(입주사·비입주사)는
 *   자기 건만 본다 — 판정은 DB 의 RLS(`erp_org_scope`, 037)가 삐용 단체 ID 로 한다.
 * ★ 회사는 입력·출력·제출까지, 완료·취소는 운영사만(결정 2026-10-09) — 상세(3단계)에서
 *   shared 의 `checkTransition` 으로 서버가 막는다.
 * ★ 목록 · 선택지는 클라이언트가 받는다 — 조건을 바꿀 때마다 서버 렌더를 다시 돌리지 않으려고.
 * ★ 회사를 고르는 팝업은 공용 부품이다 — `components/org-lookup/OrgLookupDialog`(새 건, 3단계).
 */
import { requireScreen } from '@/lib/session';
import { CorpChangesView } from '@/features/legal/CorpChangesView';

export default async function CorpChangesPage() {
  await requireScreen('s040200010', '/legal/corp-changes');
  return <CorpChangesView />;
}
