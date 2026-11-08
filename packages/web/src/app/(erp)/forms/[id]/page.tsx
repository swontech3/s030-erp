/** @screen s030100021 표양식 관리 — 양식 편집 페이지 · 010 기준설정 · 4차 */

/**
 * 양식 편집 — 칸을 그리고 자리표시(`{{이름}}`)를 넣는다. `/forms/new` 는 새 양식이다.
 *
 * ★ 디자이너가 폭을 많이 써서 **넓은 별도 페이지**로 뒀다 — 계약 목록 → 계약 폼과 같은
 *   방식이다(결정 2026-10-07).
 * ★ 화면 코드는 s030100021 이다(2026-11-08) — 목록(s030100020)과 따로 부여한다.
 * ★ 사이드바에서 들어오는 길은 없다. 그래도 `requireScreen` 은 반드시 거친다 — 주소를
 *   직접 치면 열리기 때문이다.
 * ★ 양식은 브라우저가 받는다(`loadTemplate`) — 저장 뒤 다시 받을 때도 같은 길을 쓴다.
 */
import { requireScreen } from '@/lib/session';
import { FormEditor } from '@/features/forms/FormEditor';

/** 새 양식을 가리키는 세그먼트. 실제 양식 ID(cuid · UUID)와 겹치지 않는다. */
const NEW = 'new';

export default async function FormEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireScreen('s030100021', '/forms/[id]');
  const { id } = await params;
  return <FormEditor id={id === NEW ? null : id} />;
}
