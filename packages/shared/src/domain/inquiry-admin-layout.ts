/**
 * 문의상담관리(s030200080) — 앱 안 휴대폰 모양 규칙 · 앱 1단계 5-나 (대표 지시 2026-11-07)
 *
 * ★ 같은 화면 `/inquiry-admin` 이다 — 새 경로 · 새 서버 주소 없음. 처리 기능(답변 · 전화로 답변함 ·
 *   답변 수정)은 그대로이고 **모양만** 바뀐다(ERP CLAUDE.md 「한 업무는 한 화면에서」).
 * ★ 휴대폰 모양은 **앱 안일 때만** 켠다(`isAppUserAgent`). PC 브라우저는 좁은 창이어도 지금 그대로다.
 *   - 목록 : 접수만 · 상태 칩 감춤 · 이름 · 연락처 검색과 유형 거르기는 남김 · 정렬은 서버 그대로(원글 순)
 *   - 상세 : 글 삭제 감춤(PC 만 — 개인정보를 지우는 되돌릴 수 없는 처리)
 *   - 목록 ↔ 상세는 한 장씩. 상세를 열 때 방문 기록을 남긴다 — 폰 [뒤로] 가 목록으로 돌아온다
 *     (PC 는 지금처럼 `replaceState` — 기록을 쌓지 않는다)
 */

/** 「접수」 상태 코드 — 목록 기본 거르기와 같은 값(`InquiryAdminView`) */
const RECEIVED = 'R';

export interface InquiryAdminLayout {
  /** 휴대폰 모양(목록 ↔ 상세 한 장씩) */
  phone: boolean;
  /** 상태 칩(접수 · 답변완료 · 전체)을 보이는가 */
  statusChips: boolean;
  /** [글 삭제] 를 보이는가 */
  deleteButton: boolean;
  /** 상태 거르기를 이 값으로 못 박는다(`null` 이면 고를 수 있다) */
  fixedStatus: string | null;
  /** 목록에서 상세를 열 때 주소를 적는 방법 */
  detailHistory: 'push' | 'replace';
}

export function inquiryAdminLayout(inApp: boolean): InquiryAdminLayout {
  return inApp
    ? { phone: true, statusChips: false, deleteButton: false, fixedStatus: RECEIVED, detailHistory: 'push' }
    : { phone: false, statusChips: true, deleteButton: true, fixedStatus: null, detailHistory: 'replace' };
}

/** 처음 상태 거르기 — PC 는 지금 그대로(`st=all` → 전체 · 없으면 접수), 앱 안은 접수 고정 */
export function initialStatus(layout: InquiryAdminLayout, st: string | null): string | null {
  if (layout.fixedStatus) return layout.fixedStatus;
  return st === 'all' ? null : st || RECEIVED;
}

/** 빈 목록의 [전체 보기] 가 상태를 어디로 돌리는가 — 앱 안은 접수를 놓지 않는다 */
export function resetStatus(layout: InquiryAdminLayout): string | null {
  return layout.fixedStatus;
}

/**
 * 고른 문의가 `prev` → `next` 로 바뀔 때 주소를 적는 방법.
 * ★ 기록을 남기는 것은 「앱 안 · 목록에서 상세를 열 때」 하나뿐이다. 닫힐 때는 [뒤로] 가 이미
 *   주소를 되돌려 놓았거나(popstate) 조건을 바꾼 것이라, 기록을 또 쌓으면 [뒤로] 가 같은 자리를 돈다.
 */
export function detailHistory(
  layout: InquiryAdminLayout,
  prev: string | null,
  next: string | null,
): 'push' | 'replace' {
  return layout.detailHistory === 'push' && prev === null && next !== null ? 'push' : 'replace';
}
