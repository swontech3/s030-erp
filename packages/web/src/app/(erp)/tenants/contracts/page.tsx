/** @screen s0300200030 입주사·계약 마스터-디테일 · 020 입주사관리 · 1차 */

/**
 * 입주사·계약 마스터-디테일 — **자리 화면이다**(3-1).
 *
 * 원본: design/handoff/tenant-contract/02-master-detail.md  ← ★ 정본(2026-09-13 인계)
 *       design/erp-master-detail/ErpMasterDetail.dc.html    ← 옛 원본. 참고용
 *
 * ★ 새 원본에서 `[+ 신규 입주사 등록]` 은 **모달이 아니라 계약 폼 페이지**를 연다
 *   (`01-flow.md` 흐름도). 계약 폼은 페이즈 4 라 지금은 모달을 계속 연다 —
 *   미결 사항으로 doc/DESIGN_HANDOFF_DIFF.md §C-1 에 올려 두었다.
 *
 * ★ 새 원본에 있으나 아직 없는 것: 상태 필터 칩 4종 + `전체` 해제(3-4),
 *   입주사 카드 2행(3-4), 우측 계약 테이블 6열(페이즈 4), 계약 상세 모달(페이즈 4).
 *
 * 이 페이즈에서 하는 것은 둘뿐이다.
 *   1. 모달을 열 부모를 만든다 — 좌 목록 / 우 상세의 틀만, 데이터 조회 없음
 *   2. 신규 입주사 모달(s0300200030p2)을 연다
 *
 * 실 데이터(입주사 CRUD·조직 연결)는 3-4, 계약 본문은 페이즈 4다.
 *
 * ★ 이 화면은 **운영사 전용(audience_tp='P')** 이다. 옆 호실의 계약 조건이 걸린
 *   자리라 사이드바에서 감추는 것만으로는 부족하다 — 아래 requireScreen 이 URL
 *   직접 접근도 막는다.
 */
import { requireScreen } from '@/lib/session';
import { TenantContractsView } from './TenantContractsView';

export default async function TenantContractsPage() {
  await requireScreen('s0300200030', '/tenants/contracts');

  return <TenantContractsView />;
}
