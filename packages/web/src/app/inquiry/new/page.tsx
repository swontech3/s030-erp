/** @screen s030500070p1 문의하기 · 050 공개 화면 */

/**
 * 문의하기 — `swonbiz.com/inquiry/new`. **모달이 아니라 페이지다.**
 *
 * 입력 항목이 길고 모바일에서 키보드가 올라오면 모달 스크롤이 불편하다는 이유로
 * 시안이 페이지로 정했다(02-screens.md §3). 등록 완료도 같은 화면 안에서 바뀐다.
 */
import { Suspense } from 'react';
import { PublicShell } from '@/features/inquiry/PublicShell';
import { InquiryForm } from '@/features/inquiry/InquiryForm';

export const metadata = { title: '문의하기 — SwonBiz' };

export default function InquiryNewPage() {
  return (
    <PublicShell>
      {/*
        ★ `useSearchParams` 를 쓰는 클라이언트 컴포넌트라 경계가 필요하다 —
          랜딩이 `?type=` 으로 문의 유형을 골라 보낸다(2026-10-01). 목록(`/inquiry`)과
          같은 이유다.
      */}
      <Suspense fallback={null}>
        <InquiryForm />
      </Suspense>
    </PublicShell>
  );
}
