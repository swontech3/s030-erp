/** @screen s030200080 문의상담관리 · 020 입주사관리 · 3차 */

/**
 * 문의상담관리 — 사이드바 「문의상담관리」. 고객이 남긴 문의에 **운영자가 답하는 화면**이다.
 *
 * ★ **시안이 없다.** 기존 ERP 목록 화면의 모양으로 만들었다 — 2단 레이아웃은
 *   `s030200030`(입주사·계약), 스레드 카드는 고객 글 보기(`s030500070p2`) 의 것이다.
 *   맞춰야 할 점은 `design/handoff/inquiry-board/03-thread.md` §5 다.
 *
 * ★★ **운영사 전용(audience_tp='P').** 남이 남긴 이름·연락처·이메일·본문이 한 화면에
 *    모인다 — `requireScreen` 이 URL 직접 접근을 막고(사이드바에서 감추는 것만으로는
 *    부족하다), `/admin/inquiries` 는 Fastify 가 403 으로 막는다. 두 겹이다.
 *
 * ★ 코드 이름(유형 `QU_TP` · 상태 `QU_ST`)은 서버에서 받아 넘긴다 — 화면에 문자열을
 *   박지 않는다. 고객 화면과 **같은 라우트**(`/inquiries/codes`)를 쓴다: 내려가는 것이
 *   코드와 이름뿐이라 공개·운영 구분이 필요 없고, 두 화면의 뱃지 문구가 갈릴 수 없다.
 *
 * 목록·상세는 클라이언트가 받는다 — 필터를 바꿀 때마다 서버 렌더를 다시 돌리지 않으려고.
 */
import { callApi } from '@/lib/api';
import { requireScreen } from '@/lib/session';
import type { InquiryCodes } from '@/features/inquiry/inquiry-model';
import { InquiryAdminView } from './InquiryAdminView';

export default async function InquiryAdminPage() {
  await requireScreen('s030200080', '/inquiry-admin');

  // ★ 코드 조회가 실패해도 화면은 연다 — 뱃지에 코드값(R·O)이 보이는 편이 오류 화면보다 낫다.
  const res = await callApi<InquiryCodes>('/inquiries/codes');
  const codes = res.ok ? res.body : { types: [], statuses: [] };

  return <InquiryAdminView codes={codes} />;
}
