/** @screen s030100010 센터 관리 · 010 기준설정 · 2차 */

/**
 * 센터 관리 — 사이드바 「센터 관리」. 건물 · 층 · 호실 · 회의실을 다루는 화면이다.
 *
 * ★ **시안이 없다.** 레거시 `/admin/spaces`(좌측 트리 + 우측 내용 2단)를 기준으로 만들고,
 *   모양은 기존 ERP 화면과 같은 디자인 토큰으로 맞췄다(`features/facility/facility.module.css`).
 *
 * ★★ **운영사 전용.** `requireScreen` 이 주소 직접 접근을 막고, Fastify 쪽 `/facility/**` 가
 *    `role !== 'operator'` 를 403 으로 막는다 — 두 겹이다. 사이드바에서 감추는 것만으로는
 *    부족하다(문의상담관리와 같은 이유).
 *
 * ★ 자료는 클라이언트가 받는다 — 트리에서 층을 옮길 때마다 서버 렌더를 다시 돌리지 않으려고.
 */
import { requireScreen } from '@/lib/session';
import { FacilityView } from '@/features/facility/FacilityView';

export default async function FacilityPage() {
  await requireScreen('s030100010', '/facility');
  return <FacilityView />;
}
