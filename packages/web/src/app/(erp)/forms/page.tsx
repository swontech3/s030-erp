/** @screen s030100020 표양식 관리 · 010 기준설정 · 4차 */

/**
 * 표양식 관리 — 사이드바 「표양식 관리」. 서류 양식(법무 제출 양식 · 재직증명서 같은 직원
 * 서류)을 등록·수정하고, 그 양식으로 문서를 뽑는다(2026-10-07).
 *
 * ★ **시안이 없다.** 레거시 「양식관리」(`/form-templates`)의 기능을 옮기고, 모양은
 *   **코드 관리(s030100030)와 같게** 맞췄다(왼쪽 목록 + 오른쪽 패널).
 *
 * ★★ **운영사 전용.** `requireScreen` 이 주소 직접 접근을 막고, Fastify 쪽
 *    `/form-templates/**` 가 `role !== 'operator'` 를 403 으로 막는다 — 두 겹이다.
 *
 * ★★★ **일반 서류를 뽑는 곳은 이 화면 하나다**(CLAUDE.md 「한 업무는 한 화면에서」, 결정 2026-10-07).
 *    **법무 양식은 여기서 뽑지 않는다** — 법무 서비스(s04)에서 회사가 직접 뽑는다(결정 2026-10-09).
 *
 * ★ `?id=` — 그 양식이 골라진 채로 연다. 편집 페이지에서 돌아올 때 쓴다.
 */
import { requireScreen } from '@/lib/session';
import { FormsView } from '@/features/forms/FormsView';

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireScreen('s030100020', '/forms');
  const { id } = await searchParams;
  return <FormsView initialId={id && id.trim() !== '' ? id : null} />;
}
