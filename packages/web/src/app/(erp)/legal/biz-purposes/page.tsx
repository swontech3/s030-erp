/** @screen s040300010 사업목적 · 030 사업목적 · 법무 서비스(s04) */

/**
 * 사업목적 — 공용 카탈로그(문구)의 추가 · 수정 · 사용 끄기(2026-10-11).
 *
 * ★ **시안이 없다.** 모양은 코드 관리(s030100030)의 오른쪽 패널과 같다(`BizPurposesView` 머리말).
 *
 * ★★ **운영사 전용.** `requireScreen` 이 주소 직접 접근을 막고(삐용이 회사에 이 화면을 주지 않는다),
 *    Fastify `POST · PATCH /legal/biz-purposes` 가 `role !== 'operator'` 를 403 으로, 041 RLS 가 한 번 더
 *    막는다. 목록 API 는 회사도 읽는다 — 법인변경 상세의 고르기 팝업이 부르기 때문이다(사용 중인 문구만).
 *
 * ★★★ **카탈로그를 고치는 자리는 이 화면 하나다**(CLAUDE.md 「한 업무는 한 화면에서」). 법인변경 · 설립은
 *    고르기 팝업으로 읽기만 한다.
 */
import { requireScreen } from '@/lib/session';
import { BizPurposesView } from '@/features/legal/BizPurposesView';

export default async function BizPurposesPage() {
  await requireScreen('s040300010', '/legal/biz-purposes');
  return <BizPurposesView />;
}
