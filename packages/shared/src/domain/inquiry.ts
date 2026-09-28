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

/**
 * 보유 기간(개월) — 원글 등록일부터 센다(04-data-model.md §5).
 *
 * ★★★ **자동 삭제는 없다.** 이 값이 하는 일은 운영자 문의 관리(s0300200080)에
 *    「보관 기간 지남」을 띄우는 것뿐이고, 지우는 것은 사람이 한다 — 상담 중인 글이
 *    배치에 지워지면 되돌릴 수 없다.
 * ★ 고객 화면에는 이 표시가 없다. 기간이 지나도 삭제 전까지는 목록·글 보기가 그대로다.
 * ★ 판정은 SQL 이 한다(`listAdminInquiries`) — 이 상수를 `make_interval(months => …)`
 *   로 넘긴다. 달 수를 더하는 계산(1/31 + 6개월)은 Postgres 가 맞게 하고, 「6」이
 *   적힌 자리는 여기 하나뿐이다.
 */
export const RETENTION_MONTHS = 6;

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

/* ══════════════════════════════════════════════════════════════════════════
   운영자 답변 — 문의 관리(s0300200080)가 쓴다
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 답변에 적히는 이름 — **고정 문구다**(2026-09-28 결정).
 *
 * =============================================================================
 * ★★★ 로그인한 사람의 이름을 쓰지 않는다
 * =============================================================================
 * 고객에게 필요한 것은 「누가 답했나(개인)」가 아니라 「어디서 답했나」다. 담당자가
 * 바뀌어도 답변의 서명이 흔들리지 않고, **이미 저장된 답변도 이 이름으로 보인다** —
 * 표시할 때 이 상수를 쓰므로 옛 글을 고칠 필요가 없다.
 *
 * ★ 서버도 이 값을 내려보낸다(`toMessage`). 그래서 공개 응답에 **직원 실명이 나가지
 *   않는다** — 화면에서 가리는 것이 아니라 응답에 없다.
 * ★ DB 의 `operator_id`·`operator_name` 은 그대로 남긴다. 표시용이 아니라 **누가 처리했나**
 *   의 기록이다(운영 추적용). 표시에는 쓰지 않는다.
 */
export const OPERATOR_DISPLAY_NAME = '에스원비즈 운영담당자';

/**
 * 운영자가 남길 수 있는 글 두 종.
 *
 * ★★ `customer` 는 여기 없다 — 운영자가 고객 이름으로 글을 붙일 길을 두지 않는다.
 *    고객 글은 열람 토큰을 가진 사람만 쓴다(03-thread.md §4).
 */
export type OperatorReplyKind = 'text' | 'phone';

/* ══════════════════════════════════════════════════════════════════════════
   답변 횟수 — **질문 하나에 답변 하나 · 글 하나에 최대 2회** (2026-09-28 결정)
   ══════════════════════════════════════════════════════════════════════════
   흐름은 하나뿐이다:  문의 → 답변1 → 추가 질문 → 답변2 → 끝

   ★★★ 연달아 두 번 답하지 않는다. 답 안 한 질문이 없으면 쓸 수 없고, 더 전할 말이
      있으면 **기존 답변을 수정**한다(수정은 횟수 제한이 없다).
      이유: 고객이 읽어야 할 곳이 한 군데여야 한다. 답변이 여러 조각으로 나뉘면
      「전화로 답변드렸습니다」와 글답변이 섞여 무엇이 최종인지 알 수 없다.

   ★ 추가 질문도 글 하나에 1회다(03-thread §4). 그래서 두 규칙이 맞물려
     스레드는 최대 네 줄이 된다 — 답변1 · 추가 질문 · 답변2.
   ══════════════════════════════════════════════════════════════════════════ */

/** 글 하나에 쓸 수 있는 운영자 답변 수(`text`·`phone` 합계). */
export const MAX_OPERATOR_ANSWERS = 2;

/** 답변을 쓸 수 없는 이유. `null` 이면 쓸 수 있다. */
export type ReplyBlock = 'used_up' | 'nothing_to_answer';

/**
 * 지금 답변을 쓸 수 있는가. 못 쓰면 **이유**를 돌려준다.
 *
 * ★ 화면은 이 값으로 입력칸을 잠그고, 서버는 같은 값으로 409 를 낸다 — 판정이 한 곳이다.
 * ★ 스레드가 비었으면(원글만) **원글이 답 안 한 질문**이다 — 그래서 쓸 수 있다.
 */
export function operatorReplyBlock(kinds: readonly MessageKind[]): ReplyBlock | null {
  const answers = kinds.filter((k) => k !== 'customer').length;
  if (answers >= MAX_OPERATOR_ANSWERS) return 'used_up';
  const last = kinds[kinds.length - 1];
  if (last && last !== 'customer') return 'nothing_to_answer';
  return null;
}

/**
 * 잠긴 이유를 사람 말로.
 *
 * ★ 화면의 잠금 안내와 서버의 409 message 가 **같은 문장**이다. 서버가 막았을 때
 *   화면에 다른 말이 뜨면 사용자는 두 가지 규칙이 있다고 읽는다.
 */
export const REPLY_BLOCK_MESSAGE: Record<ReplyBlock, string> = {
  used_up:
    '답변은 문의 하나에 두 번까지입니다. 더 전할 내용이 있으면 등록한 답변을 수정해 주세요.',
  nothing_to_answer:
    '답변할 새 질문이 없습니다. 고객이 추가 질문을 남기면 한 번 더 답변할 수 있습니다. 지금 더 전할 내용이 있으면 등록한 답변을 수정해 주세요.',
};

/**
 * 답변 등록 입력을 읽는다. 저장할 모양을 돌려주고, **틀리면 `null`** 이다.
 *
 * ★ `phone`(전화로 답변함)은 **본문이 없다.** 보내와도 버린다 — 고객 화면에
 *   「전화로 답변드렸습니다」 한 줄만 보이므로 적어 둔 본문은 아무도 못 읽는다.
 *   DB CHECK 도 같은 규칙이다(028 `tb_s080_inquiry_messages_body`).
 * ★ `text`(글답변)는 1~1000자. 공백만이면 답변이 아니다.
 */
export function parseOperatorReply(
  kind: string,
  body: string,
): { kind: OperatorReplyKind; body: string | null } | null {
  if (kind === 'phone') return { kind: 'phone', body: null };
  if (kind !== 'text') return null;
  const trimmed = body.trim();
  return validateFollowUp(trimmed) ? { kind: 'text', body: trimmed } : null;
}
