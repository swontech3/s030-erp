/**
 * 문의상담 게시판 규칙 — s0300500070 · p1 · p2.
 *
 * 명세: design/handoff/inquiry-board/ 01~04
 *
 * =============================================================================
 * ★★★ 규칙은 여기 하나 · 화면과 서버가 같이 부른다
 * =============================================================================
 * 예약(`reservation-rules.ts`)과 같은 규칙이다. 화면 검사는 **친절**이고 서버 검사가
 * **규칙**이다 — API 를 직접 찌르면 화면을 지나가지 않는다. 그래서 검증·상태 판정·
 * 마스킹을 이 파일에 모으고 양쪽이 부른다.
 *
 * =============================================================================
 * ★★★ 상태는 저장하지 않는다 — **마지막 글로 판정**한다
 * =============================================================================
 * 컬럼에 적어 두면 추가 질문·답변마다 두 곳(행과 스레드)을 같이 고쳐야 하고, 언젠가
 * 한쪽만 고쳐진다. 그 순간 운영자 목록의 「답변 필요」가 틀려진다(03-thread.md §2).
 *
 * ★ 코드 값은 **코드 마스터**의 것이다 — `QU_ST`(R 접수 · A 답변완료) ·
 *   `QU_TP`(O·L·T·R·E). 표시 이름은 DB 에서 가져오고 화면에 문자열을 박지 않는다.
 *   그래서 이 파일에도 「접수」 같은 **라벨이 없다.**
 */

/** 목록 한 쪽 — 2열 × 10행(02-screens.md §2). */
export const PAGE_SIZE = 20;
/** 본문·추가 질문 길이 상한. */
export const BODY_MAX = 1000;
/** 비밀번호 최소 길이. 짧은 대신 해시 + 시도 제한이 전제다(04-data-model.md §4). */
export const PASSWORD_MIN = 4;

/** 같은 연락처로 하루에 남길 수 있는 글(04-data-model.md §4). */
export const DAILY_LIMIT = 3;
/** 같은 연락처의 직전 등록으로부터 이만큼은 다시 못 쓴다(초). */
export const COOLDOWN_SECONDS = 60;

/** 열람 토큰 수명(분). 글 하나에만 유효하다(03-thread.md §4). */
export const TOKEN_TTL_MINUTES = 30;
/** 비밀번호 시도 제한 — 이 창(분) 안에 `UNLOCK_MAX_ATTEMPTS` 번 틀리면 잠근다. */
export const UNLOCK_WINDOW_MINUTES = 10;
export const UNLOCK_MAX_ATTEMPTS = 5;

/** 스레드 글의 종류. `phone` 은 본문이 없다(전화로 답변한 기록). */
export type MessageKind = 'text' | 'phone' | 'customer';

/** 코드 마스터 `QU_ST` 의 code. */
export type InquiryStatus = 'R' | 'A';

export interface InquiryInput {
  name: string;
  phone: string;
  email: string;
  companyName: string;
  /** 코드 마스터 `QU_TP` 의 code. */
  type: string;
  body: string;
  password: string;
  agreed: boolean;
}

/** 채워지지 않은 자리. **화면의 세로 순서 그대로** 돌려준다 — 배너가 개수를 센다. */
export type InquiryField = 'name' | 'phone' | 'email' | 'type' | 'body' | 'password' | 'agreed';

/**
 * 목록에 나갈 이름.
 *
 * ★★★ **서버가 가려서 내려보낸다.** 화면에서 가리면 응답에는 실명이 남고, 그것이
 *    곧 노출이다(04-data-model.md §4 첫 줄).
 * ★ 글자 수를 드러내지 않으려고 `**` 고정이다 — 「남궁민수」도 「남**」.
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed.charAt(0)}**` : '';
}

/**
 * 연락처에서 숫자만.
 * ★ 스팸 판정이 `010-1234-5678` 과 `01012345678` 을 **같은 연락처**로 봐야 한다.
 */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * 상태 — 마지막 글이 고객 글이거나 스레드가 비었으면 「접수」다.
 *
 * ★★★ 추가 질문이 달리면 **다시 접수로 돌아간다.** 운영자 목록에서 「답변 필요」를
 *    찾는 기준이 그대로 이 값이다(03-thread.md §2).
 */
export function inquiryStatus(kinds: readonly MessageKind[]): InquiryStatus {
  const last = kinds[kinds.length - 1];
  return !last || last === 'customer' ? 'R' : 'A';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 등록 검증.
 *
 * @param typeCodes 코드 마스터 `QU_TP` 에 있는 code 목록. ★ 화면이 보내온 유형이
 *   **마스터에 있는 값인지** 서버가 본다 — 없으면 목록 제목이 빈 칸이 된다.
 */
export function validateInquiry(input: InquiryInput, typeCodes: readonly string[]): InquiryField[] {
  const bad: InquiryField[] = [];
  if (!input.name.trim()) bad.push('name');
  if (phoneDigits(input.phone).length < 10) bad.push('phone');
  if (!EMAIL.test(input.email.trim())) bad.push('email');
  if (!typeCodes.includes(input.type)) bad.push('type');
  const body = input.body.trim();
  if (!body || body.length > BODY_MAX) bad.push('body');
  if (input.password.length < PASSWORD_MIN) bad.push('password');
  if (!input.agreed) bad.push('agreed');
  return bad;
}

/** 추가 질문 — 1자 이상 1000자 이하(03-thread.md §4). */
export function validateFollowUp(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length >= 1 && trimmed.length <= BODY_MAX;
}
