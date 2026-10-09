/** @screen s040200010 법인변경 · 020 법인변경 · 법무 서비스(s04) */

/**
 * 법인변경 목록 — **자리만 있다**(2026-10-09). 화면 본체는 다음 단계다.
 *
 * 지금 이 페이지가 하는 일은 둘뿐이다: ① 화면 코드로 접근을 막고 기록한다
 * ② 사이드바 「법인변경」이 404 로 떨어지지 않게 한다.
 *
 * ★ 이 화면은 **운영사와 회사가 함께 쓴다.** 운영사는 전체 건을, 회사(입주사·비입주사)는
 *   자기 건만 본다 — 판정은 DB 의 RLS(`erp_org_scope`, 037)가 삐용 단체 ID 로 한다.
 * ★ 회사는 입력·출력·제출까지, 완료·취소는 운영사만(결정 2026-10-09) — 본체를 만들 때 서버가 막는다.
 * ★ 회사를 고르는 팝업은 공용 부품이다 — `components/org-lookup/OrgLookupDialog`.
 */
import { requireScreen } from '@/lib/session';

export default async function CorpChangesPage() {
  await requireScreen('s040200010', '/legal/corp-changes');

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 'var(--text-h3-size)', color: 'var(--text-heading)' }}>법인변경</h2>
      <p style={{ marginTop: 6, fontSize: 14, color: 'var(--text-muted)' }}>화면을 준비하고 있습니다.</p>
    </div>
  );
}
