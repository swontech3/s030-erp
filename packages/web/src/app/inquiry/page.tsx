/** @screen s030500070 문의 목록 · 050 공개 화면 */

/**
 * 문의상담 목록 — `swonbiz.com/inquiry`.
 *
 * 원본: templates/inquiry-board/InquiryBoard.dc.html
 * 시안: design/handoff/prototypes/s0300500070.html · 명세: inquiry-board/02-screens.md
 *
 * =============================================================================
 * ★★★ 로그인이 없다 — 050 공개 화면
 * =============================================================================
 * `(erp)` 그룹 **밖**이다. 셸도 사이드바도 세션도 없고, `proxy.ts` 의 matcher 에
 * `/inquiry` 가 없어 로그인으로 튕기지 않는다. Fastify 쪽 라우트도 전부
 * `config: { public: true }` 다 — **양쪽 모두** 공개라고 적어야 열린다.
 *
 * ★ 목록에 나가는 것은 유형 · 가린 이름 · 날짜 · 상태 넷뿐이다. 실명·연락처·본문은
 *   응답에 담기지 않는다(`api/src/routes/inquiry.ts` 머리말).
 */
import { Suspense } from 'react';
import { PublicShell } from '@/features/inquiry/PublicShell';
import { InquiryList } from '@/features/inquiry/InquiryList';

export const metadata = { title: '문의상담 — SwonBiz' };

export default function InquiryListPage() {
  return (
    <PublicShell>
      {/* useSearchParams 를 쓰는 클라이언트 컴포넌트라 경계가 필요하다 */}
      <Suspense fallback={null}>
        <InquiryList />
      </Suspense>
    </PublicShell>
  );
}
