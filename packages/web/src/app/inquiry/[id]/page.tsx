/** @screen s0300500070p2 글 보기 · 050 공개 화면 */

/**
 * 글 보기 — `swonbiz.com/inquiry/{id}`. 비밀번호 확인이 **이 화면의 첫 단계**다.
 *
 * ★★★ 비밀번호를 맞히기 전에는 서버가 원글을 주지 않는다. 화면에서 가리는 것이
 *    아니다 — `POST /inquiries/{id}/unlock` 이 200 을 준 뒤에야 내용이 생긴다.
 */
import { PublicShell } from '@/features/inquiry/PublicShell';
import { InquiryView } from '@/features/inquiry/InquiryView';

export const metadata = { title: '문의 보기 — SwonBiz' };

export default async function InquiryViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PublicShell>
      <InquiryView inquiryId={id} />
    </PublicShell>
  );
}
