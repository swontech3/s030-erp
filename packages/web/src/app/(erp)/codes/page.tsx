/** @screen s030100030 코드 관리 · 010 기준설정 · 2차 */

/**
 * 코드 관리 — 사이드바 「코드 관리」. 분류 · 파티션 · 코드값을 다루는 화면이다.
 *
 * ★ **시안이 없다.** 레거시 `/admin/codes`(카테고리 아코디언 + 코드표)를 기준으로 기능을
 *   옮기고, 모양은 **센터 관리(s030100010)와 같게** 맞췄다(좌측 트리 + 우측 패널).
 *   레거시는 2층이었지만 지금 코드는 3층이라(분류 → 파티션 → 코드값) 트리로 간다.
 *
 * ★★ **운영사 전용.** `requireScreen` 이 주소 직접 접근을 막고, Fastify 쪽
 *    `/codes-admin/**` 가 `role !== 'operator'` 를 403 으로 막는다 — 두 겹이다.
 *    사이드바에서 감추는 것만으로는 부족하다(센터 관리·문의상담관리와 같은 이유).
 *
 * ★★★ **코드를 고치는 자리는 이 화면 하나다.** 계약 폼·센터 관리는 `GET /codes` 로
 *    읽기만 한다(CLAUDE.md 「한 업무는 한 화면에서」).
 *
 * ★ 자료는 클라이언트가 받는다 — 트리에서 파티션을 옮길 때마다 서버 렌더를 다시 돌리지
 *   않으려고(센터 관리와 같다).
 */
import { requireScreen } from '@/lib/session';
import { CodesView } from '@/features/codes/CodesView';

export default async function CodesPage() {
  await requireScreen('s030100030', '/codes');
  return <CodesView />;
}
