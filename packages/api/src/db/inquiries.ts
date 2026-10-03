/**
 * 문의상담 조회·쓰기 — SQL 만 한다.
 *
 * 무엇을 받아도 되는지는 `@swonbiz/shared/domain/inquiry` 의 순수 함수가 정한다.
 *
 * =============================================================================
 * ★★★ 목록은 **고를 컬럼이 곧 계약**이다
 * =============================================================================
 * `listInquiries` 가 이름·연락처·이메일·본문을 SELECT 하지 않는다. 라우트가 거르는
 * 것이 아니라 **가져오지 않는다** — 나중에 누가 응답 모양을 손대도 없는 값은 샐 수 없다.
 * 이름만은 가져온다(가려서 내려보내야 하므로) — 그 자리는 `maskName` 하나뿐이다.
 *
 * ★ 상태(접수·답변완료)는 컬럼이 아니다. 마지막 글의 `kind` 를 같이 가져오고
 *   판정은 shared 가 한다(`inquiryStatus`). 검색도 같은 규칙으로 짠다 —
 *   라우트가 「답변완료로 치는 kind 목록」을 shared 에서 만들어 넘긴다.
 */
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 마지막 글 한 건을 붙이는 조각 — 목록과 상세가 같은 규칙을 쓴다. */
const LAST_KIND = `
  LEFT JOIN LATERAL (
    SELECT m.kind
      FROM public.tb_s080_inquiry_messages m
     WHERE m.inquiry_id = i.inquiry_id
     ORDER BY m.created_at DESC, m.message_id DESC
     LIMIT 1
  ) l ON true`;

/** 검색 조건 — 목록과 건수가 **같은 문자열**을 쓴다(둘이 갈리면 페이지가 어긋난다). */
const WHERE = `
  WHERE i.deleted_at IS NULL
    AND ($1::date IS NULL OR i.created_at >= $1::date)
    AND ($2::date IS NULL OR i.created_at < ($2::date + 1))
    AND ($3::text IS NULL OR i.type = $3::text)
    AND ($4::text[] IS NULL OR l.kind = ANY($4::text[]) OR (l.kind IS NULL AND $5::boolean))`;

export interface InquiryListFilter {
  from: string | null;
  to: string | null;
  type: string | null;
  /** 이 `kind` 들이 마지막이면 찾는 상태다. 상태 검색을 안 하면 `null`. */
  kinds: string[] | null;
  /** 스레드가 비었을 때도 그 상태인가(= 「접수」를 찾을 때만 true). */
  emptyMatches: boolean;
}

export interface InquiryListRow {
  inquiry_id: string;
  type: string;
  /** ★ 가려서 내려보낼 원본. 라우트 밖으로 나가지 않는다. */
  name: string;
  day: string;
  last_kind: string | null;
}

export async function listInquiries(
  client: ScopedClient,
  filter: InquiryListFilter,
  page: { limit: number; offset: number },
): Promise<InquiryListRow[]> {
  const { rows } = await q<InquiryListRow>(
    client,
    `SELECT i.inquiry_id, i.type, i.name,
            to_char(i.created_at, 'YYYY-MM-DD') AS day, l.kind AS last_kind
       FROM public.tb_s080_inquiries i ${LAST_KIND}
      ${WHERE}
      ORDER BY i.created_at DESC, i.inquiry_id DESC
      LIMIT $6 OFFSET $7`,
    [filter.from, filter.to, filter.type, filter.kinds, filter.emptyMatches, page.limit, page.offset],
  );
  return rows;
}

export async function countInquiries(client: ScopedClient, filter: InquiryListFilter): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM public.tb_s080_inquiries i ${LAST_KIND} ${WHERE}`,
    [filter.from, filter.to, filter.type, filter.kinds, filter.emptyMatches],
  );
  return rows[0]?.n ?? 0;
}

export interface InquiryRow {
  inquiry_id: string;
  type: string;
  name: string;
  phone: string;
  email: string;
  company_name: string | null;
  body: string;
  password_hash: string;
  created_at: string;
  day: string;
}

/** 글 한 건 — **비밀번호를 맞춘 사람에게만** 라우트가 내려보낸다. */
export async function findInquiry(client: ScopedClient, inquiryId: string): Promise<InquiryRow | null> {
  const { rows } = await q<InquiryRow>(
    client,
    `SELECT inquiry_id, type, name, phone, email, company_name, body, password_hash,
            to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
            to_char(created_at, 'YYYY-MM-DD') AS day
       FROM public.tb_s080_inquiries
      WHERE inquiry_id = $1 AND deleted_at IS NULL`,
    [inquiryId],
  );
  return rows[0] ?? null;
}

/** 목록·비밀번호 화면이 쓰는 최소 정보 — 이름은 가려서 쓴다. */
export async function findInquiryHead(
  client: ScopedClient,
  inquiryId: string,
): Promise<{ inquiry_id: string; type: string; name: string; day: string } | null> {
  const { rows } = await q<{ inquiry_id: string; type: string; name: string; day: string }>(
    client,
    `SELECT inquiry_id, type, name, to_char(created_at, 'YYYY-MM-DD') AS day
       FROM public.tb_s080_inquiries
      WHERE inquiry_id = $1 AND deleted_at IS NULL`,
    [inquiryId],
  );
  return rows[0] ?? null;
}

export interface MessageRow {
  message_id: string;
  kind: string;
  body: string | null;
  operator_name: string | null;
  created_at: string;
  edited_at: string | null;
}

/**
 * 스레드 한 묶음 — **시간순**이다. 순서가 곧 화면이고, 마지막 글이 곧 상태다.
 *
 * =============================================================================
 * ★★★ `ORDER BY m.created_at` — **테이블을 가리켜야 한다**(2026-09-28 수정)
 * =============================================================================
 * `ORDER BY created_at` 으로 적으면 SQL 은 그것을 **출력 별칭**(위의 `to_char(...) AS
 * created_at`, 분까지만 남은 문자열)으로 읽는다. 별칭이 테이블 컬럼보다 우선한다.
 * 그러면 **같은 분에 들어온 글끼리 순서가 message_id(UUID)로** 정해진다 — 사실상 무작위다.
 *
 * 그 결과가 고객 화면의 뒤집힌 스레드이고, 더 나쁜 것은 **상태가 틀려지는 것**이다:
 * 상태는 마지막 글로 판정하므로(`inquiryStatus`), 운영자가 답한 직후인데 「접수」로,
 * 고객이 추가 질문한 직후인데 「답변완료」로 보일 수 있다. 실제로 그랬다 —
 * `verify-inquiry.js` 20번(전화 답변 기록)이 이것을 잡았다.
 */
export async function listMessages(client: ScopedClient, inquiryId: string): Promise<MessageRow[]> {
  const { rows } = await q<MessageRow>(
    client,
    `SELECT m.message_id, m.kind, m.body, m.operator_name,
            to_char(m.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
            to_char(m.edited_at,  'YYYY-MM-DD')         AS edited_at
       FROM public.tb_s080_inquiry_messages m
      WHERE m.inquiry_id = $1
      ORDER BY m.created_at, m.message_id`,
    [inquiryId],
  );
  return rows;
}

export async function insertInquiry(
  client: ScopedClient,
  row: {
    inquiryId: string;
    buildId: string;
    type: string;
    name: string;
    phone: string;
    phoneDigits: string;
    email: string;
    companyName: string | null;
    body: string;
    passwordHash: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_inquiries
       (inquiry_id, build_id, type, name, phone, phone_digits, email, company_name,
        body, password_hash, agreed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [row.inquiryId, row.buildId, row.type, row.name, row.phone, row.phoneDigits, row.email,
     row.companyName, row.body, row.passwordHash],
  );
}

/**
 * 스팸 판정 재료 — 같은 연락처의 **오늘 몇 건**과 **직전 등록이 몇 초 전인가**.
 *
 * ★ 삭제된 글도 센다(04-data-model.md §4) — 지우고 다시 쓰는 길을 막는다.
 * ★★ 그래서 후보가 **둘**이다. 살아 있는 글은 숫자(`01012345678`)로 남아 있고,
 *    운영자가 지운 글은 같은 자리에 **연락처 해시**가 들어 있다(`purgeInquiry`).
 *    하나만 찾으면 지운 글이 집계에서 빠지고, 그 순간 하루 3건이 무력해진다.
 */
export async function phoneUsage(
  client: ScopedClient,
  candidates: readonly string[],
): Promise<{ today: number; secondsSinceLast: number | null }> {
  const { rows } = await q<{ today: number; since: number | null }>(
    client,
    `SELECT count(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today,
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - max(created_at)))::int AS since
       FROM public.tb_s080_inquiries
      WHERE phone_digits = ANY($1::text[])`,
    [candidates],
  );
  return { today: rows[0]?.today ?? 0, secondsSinceLast: rows[0]?.since ?? null };
}

export async function insertMessage(
  client: ScopedClient,
  row: {
    messageId: string;
    inquiryId: string;
    kind: string;
    body: string | null;
    operatorId?: string | null;
    operatorName?: string | null;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_inquiry_messages
       (message_id, inquiry_id, kind, body, operator_id, operator_name, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, CURRENT_TIMESTAMP)`,
    [row.messageId, row.inquiryId, row.kind, row.body, row.operatorId ?? null, row.operatorName ?? null],
  );
}

/* ── 열람 토큰 ─────────────────────────────────────────────────────────────
   ★ 원문이 아니라 해시를 저장한다 — 세션(erp_sid)과 같은 규칙이다. */

export async function insertToken(
  client: ScopedClient,
  row: { tokenHash: string; inquiryId: string; ttlMinutes: number },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_inquiry_tokens (token_hash, inquiry_id, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + make_interval(mins => $3))`,
    [row.tokenHash, row.inquiryId, row.ttlMinutes],
  );
}

/** 살아 있는 토큰인가. ★ **그 글의 것인지**까지 본다 — 남의 글에 쓰지 못한다. */
export async function findLiveToken(
  client: ScopedClient,
  args: { tokenHash: string; inquiryId: string },
): Promise<boolean> {
  const { rows } = await q<{ ok: boolean }>(
    client,
    `SELECT true AS ok FROM public.tb_s080_inquiry_tokens
      WHERE token_hash = $1 AND inquiry_id = $2 AND expires_at > CURRENT_TIMESTAMP`,
    [args.tokenHash, args.inquiryId],
  );
  return rows.length > 0;
}

/** 만료된 토큰을 치운다 — 청소 배치를 두지 않고 지나가는 요청이 쓸어 담는다. */
export async function sweepTokens(client: ScopedClient): Promise<void> {
  await q(client, `DELETE FROM public.tb_s080_inquiry_tokens WHERE expires_at <= CURRENT_TIMESTAMP`);
}

/* ── 비밀번호 시도 ─────────────────────────────────────────────────────── */

export async function countAttempts(
  client: ScopedClient,
  args: { inquiryId: string; clientIp: string; windowMinutes: number },
): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM public.tb_s080_inquiry_unlock_attempts
      WHERE inquiry_id = $1 AND client_ip = $2
        AND tried_at > CURRENT_TIMESTAMP - make_interval(mins => $3)`,
    [args.inquiryId, args.clientIp, args.windowMinutes],
  );
  return rows[0]?.n ?? 0;
}

export async function insertAttempt(
  client: ScopedClient,
  args: { attemptId: string; inquiryId: string; clientIp: string },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_inquiry_unlock_attempts (attempt_id, inquiry_id, client_ip)
     VALUES ($1, $2, $3)`,
    [args.attemptId, args.inquiryId, args.clientIp],
  );
}

/** 맞히면 지운다 — 다음 사람이 앞사람의 실패를 물려받지 않는다. */
export async function clearAttempts(
  client: ScopedClient,
  args: { inquiryId: string; clientIp: string },
): Promise<void> {
  await q(
    client,
    `DELETE FROM public.tb_s080_inquiry_unlock_attempts WHERE inquiry_id = $1 AND client_ip = $2`,
    [args.inquiryId, args.clientIp],
  );
}

export async function sweepAttempts(client: ScopedClient, windowMinutes: number): Promise<void> {
  await q(
    client,
    `DELETE FROM public.tb_s080_inquiry_unlock_attempts
      WHERE tried_at <= CURRENT_TIMESTAMP - make_interval(mins => $1)`,
    [windowMinutes],
  );
}

/* ── 코드 마스터 ───────────────────────────────────────────────────────────
   ★ 화면에 문자열을 박지 않는다. 유형 버튼·상태 뱃지·검색 Select 가 이것으로 그려진다.
   ★ 공개 라우트가 쓰므로 **두 카테고리만** 내려간다 — `routes/lookups.ts` 의 운영자용
     코드 조회와 섞지 않는다(그쪽은 계약 폼 코드를 준다). */
export async function listInquiryCodes(
  client: ScopedClient,
): Promise<{ category: string; code: string; name: string }[]> {
  const { rows } = await q<{ category: string; code: string; name: string }>(
    client,
    `SELECT category, code, name
       FROM public.tb_s080_codes_line
      WHERE category IN ('QU_TP', 'QU_ST') AND use_tp = '000' AND is_active
      ORDER BY category, sort_order`,
  );
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
   운영자 문의 관리 (s030200080)
   ══════════════════════════════════════════════════════════════════════════
   ★★★ 여기서부터는 **이름·연락처·이메일을 가져온다.** 공개 목록과 정반대다 —
      운영자가 답하려면 누가 무엇을 물었는지 알아야 한다. 대신 이 함수들을 부르는
      라우트는 운영사 세션이 아니면 403 이다(`routes/inquiryAdmin.ts`).
   ★ 그래도 **비밀번호 해시는 고르지 않는다.** 운영자도 고객의 비밀번호를 볼 일이 없다.
   ★ 「보관 기간 지남」은 SQL 이 센다 — 달 수만 shared(`RETENTION_MONTHS`)에서 받는다.
      1/31 + 6개월 같은 계산은 Postgres 가 맞게 하고, 「6」이 적힌 자리는 한 곳뿐이다.
   ══════════════════════════════════════════════════════════════════════════ */

/** LIKE 특수문자를 글자로 만든다 — 검색어의 `%` 가 「전부」가 되지 않게. */
const likeEscape = (raw: string): string => raw.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface AdminListFilter {
  /** 코드 마스터 `QU_TP` 의 code. */
  type: string | null;
  /** 이름·연락처 검색어. 숫자만 남긴 값으로 연락처도 함께 찾는다. */
  keyword: string | null;
  /** 이 `kind` 들이 마지막이면 찾는 상태다. 상태 검색을 안 하면 `null`. */
  kinds: string[] | null;
  /** 스레드가 비었을 때도 그 상태인가(= 「접수」를 찾을 때만 true). */
  emptyMatches: boolean;
}

/** 마지막 글 — 목록의 「마지막 글」 칸과 상태 판정이 같은 한 건을 본다. */
const LAST_MESSAGE = `
  LEFT JOIN LATERAL (
    SELECT m.kind, m.created_at
      FROM public.tb_s080_inquiry_messages m
     WHERE m.inquiry_id = i.inquiry_id
     ORDER BY m.created_at DESC, m.message_id DESC
     LIMIT 1
  ) l ON true`;

/** 검색 조건 — 목록과 건수가 **같은 문자열**을 쓴다(둘이 갈리면 페이지가 어긋난다). */
const ADMIN_WHERE = `
  WHERE i.deleted_at IS NULL
    AND ($1::text IS NULL OR i.type = $1::text)
    AND ($2::text[] IS NULL OR l.kind = ANY($2::text[]) OR (l.kind IS NULL AND $3::boolean))
    AND ($4::text IS NULL
         OR i.name ILIKE '%' || $4::text || '%'
         OR ($5::text IS NOT NULL AND i.phone_digits LIKE '%' || $5::text || '%'))`;

/**
 * 검색 파라미터 다섯. ★ 연락처는 **숫자 두 자 이상**부터 찾는다 — 한 자로 찾으면
 * 이름 검색이 아닌 사람이 연락처 전부와 걸린다.
 */
const adminParams = (filter: AdminListFilter): unknown[] => {
  const raw = filter.keyword?.trim() ?? '';
  const digits = raw.replace(/\D/g, '');
  return [
    filter.type,
    filter.kinds,
    filter.emptyMatches,
    raw ? likeEscape(raw) : null,
    digits.length >= 2 ? digits : null,
  ];
};

export interface AdminListRow {
  inquiry_id: string;
  type: string;
  /** ★ 실명이다 — 가리지 않는다. 운영자가 답해야 할 사람이다. */
  name: string;
  day: string;
  last_kind: string | null;
  last_at: string | null;
  /** 원글 등록일 + `RETENTION_MONTHS` 가 지났다. **표시만** 한다 — 자동 삭제는 없다. */
  retention_passed: boolean;
}

export async function listAdminInquiries(
  client: ScopedClient,
  filter: AdminListFilter,
  page: { limit: number; offset: number },
  retentionMonths: number,
): Promise<AdminListRow[]> {
  const { rows } = await q<AdminListRow>(
    client,
    `SELECT i.inquiry_id, i.type, i.name,
            to_char(i.created_at, 'YYYY-MM-DD') AS day,
            l.kind AS last_kind,
            to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS last_at,
            (i.created_at + make_interval(months => $8::int) <= CURRENT_TIMESTAMP) AS retention_passed
       FROM public.tb_s080_inquiries i ${LAST_MESSAGE}
      ${ADMIN_WHERE}
      ORDER BY i.created_at DESC, i.inquiry_id DESC
      LIMIT $6 OFFSET $7`,
    [...adminParams(filter), page.limit, page.offset, retentionMonths],
  );
  return rows;
}

export async function countAdminInquiries(client: ScopedClient, filter: AdminListFilter): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM public.tb_s080_inquiries i ${LAST_MESSAGE} ${ADMIN_WHERE}`,
    adminParams(filter),
  );
  return rows[0]?.n ?? 0;
}

export interface AdminInquiryRow {
  inquiry_id: string;
  type: string;
  name: string;
  phone: string;
  email: string;
  company_name: string | null;
  body: string;
  day: string;
  created_at: string;
  retention_passed: boolean;
}

/** 글 한 건 — 운영자용. ★ `password_hash` 를 고르지 않는다. */
export async function findAdminInquiry(
  client: ScopedClient,
  inquiryId: string,
  retentionMonths: number,
): Promise<AdminInquiryRow | null> {
  const { rows } = await q<AdminInquiryRow>(
    client,
    `SELECT inquiry_id, type, name, phone, email, company_name, body,
            to_char(created_at, 'YYYY-MM-DD') AS day,
            to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
            (created_at + make_interval(months => $2::int) <= CURRENT_TIMESTAMP) AS retention_passed
       FROM public.tb_s080_inquiries
      WHERE inquiry_id = $1 AND deleted_at IS NULL`,
    [inquiryId, retentionMonths],
  );
  return rows[0] ?? null;
}

/** 고칠 글 한 건. ★ `kind` 를 함께 보고 라우트가 「글답변만 수정」을 지킨다. */
export async function findMessage(
  client: ScopedClient,
  args: { inquiryId: string; messageId: string },
): Promise<{ message_id: string; kind: string } | null> {
  const { rows } = await q<{ message_id: string; kind: string }>(
    client,
    `SELECT message_id, kind FROM public.tb_s080_inquiry_messages
      WHERE message_id = $1 AND inquiry_id = $2`,
    [args.messageId, args.inquiryId],
  );
  return rows[0] ?? null;
}

/**
 * 답변 본문 교체 — 「수정됨」.
 *
 * ★★ `created_at` 을 건드리지 않는다. 수정해도 **등록 시각과 스레드 순서는 그대로**다
 *    (03-thread.md §3). 맨 아래로 옮기면 고객이 읽던 순서가 바뀐다.
 * ★ 같은 날 고쳐도 `edited_at` 을 남긴다 — 고객이 이미 읽은 내용이 바뀌었을 수 있다.
 * ★ `kind = 'text'` 를 SQL 에도 적는다. 라우트가 이미 보지만, 전화 기록에 본문이
 *   생기는 길은 두 겹으로 막는다(028 의 CHECK 가 세 번째다).
 */
export async function updateMessageBody(
  client: ScopedClient,
  args: { inquiryId: string; messageId: string; body: string },
): Promise<boolean> {
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_inquiry_messages
        SET body = $3, edited_at = CURRENT_TIMESTAMP
      WHERE message_id = $1 AND inquiry_id = $2 AND kind = 'text'`,
    [args.messageId, args.inquiryId, args.body],
  );
  return (rowCount ?? 0) > 0;
}

/** 지우기 전에 볼 연락처 — 해시를 만들 재료다. 살아 있는 글만 돌려준다. */
export async function findPhoneDigits(client: ScopedClient, inquiryId: string): Promise<string | null> {
  const { rows } = await q<{ phone_digits: string }>(
    client,
    `SELECT phone_digits FROM public.tb_s080_inquiries
      WHERE inquiry_id = $1 AND deleted_at IS NULL`,
    [inquiryId],
  );
  return rows[0]?.phone_digits ?? null;
}

/**
 * 글 전체 삭제 — **개인정보를 지우고 지운 표시를 남긴다**(04-data-model.md §5).
 *
 * =============================================================================
 * ★★★ 무엇을 지우고 무엇을 남기는가 (2026-09-28 결정)
 * =============================================================================
 * 지운다 — 이름 · 연락처 · 이메일 · 회사명 · 본문 · **스레드 전체**(운영자 답변과
 *          고객 추가 질문 모두) · 글 비밀번호 해시 · 열람 토큰. **되돌릴 수 없다.**
 * 남긴다 — `inquiry_id`(참조) · `type` · `created_at` · `deleted_at` · `agreed_at` ·
 *          **연락처 해시**(`phone_digits`).
 *
 * ★★ 연락처 해시를 남기는 이유는 하나다: **스팸 판정.** 같은 연락처의 하루 3건을
 *    세지 못하면 「지우고 다시 쓰기」가 열린다(04-data-model.md §4 마지막 줄).
 *    번호 자체는 남지 않는다 — 키를 섞은 해시라 되돌릴 수 없다(`lib/crypto.ts`
 *    `phoneDigitsToken`). 집계 SQL(`phoneUsage`)이 숫자와 해시를 함께 찾는다.
 * ★ 행을 통째로 `DELETE` 하지 않는 것도 그래서다 — 그러면 해시도 함께 사라진다.
 * ★ 본문에 `(삭제됨)` 을 넣는 것은 028 의 CHECK(1~1000자) 때문이다. 빈 문자열을 넣을
 *   수 없어서 쓰는 자리표시이고, 이 글은 목록에도 글 보기에도 나오지 않는다.
 * ★ 스레드는 **행째 지운다.** 고객의 추가 질문도 개인정보이고, 지운 글의 스레드를 읽는
 *   화면은 없다. 열람 토큰도 함께 지운다 — `deleted_at` 검사가 이미 막지만,
 *   이미 발급된 토큰을 살려 둘 이유가 없다.
 * ★ 비밀번호 해시는 `scrypt$deleted` 로 덮는다. 형식이 깨진 값이라 `verifyPassword` 가
 *   무엇을 넣어도 false 다 — 고객이 쓰던 비밀번호(다른 곳에서도 쓸 수 있다)를 남기지 않는다.
 */
export async function purgeInquiry(
  client: ScopedClient,
  args: { inquiryId: string; phoneToken: string },
): Promise<boolean> {
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_inquiries
        SET deleted_at    = CURRENT_TIMESTAMP,
            updated_at    = CURRENT_TIMESTAMP,
            name          = '(삭제)',
            phone         = '',
            phone_digits  = $2,
            email         = '',
            company_name  = NULL,
            body          = '(삭제됨)',
            password_hash = 'scrypt$deleted'
      WHERE inquiry_id = $1 AND deleted_at IS NULL`,
    [args.inquiryId, args.phoneToken],
  );
  if ((rowCount ?? 0) === 0) return false;

  await q(client, `DELETE FROM public.tb_s080_inquiry_messages WHERE inquiry_id = $1`, [args.inquiryId]);
  await q(client, `DELETE FROM public.tb_s080_inquiry_tokens WHERE inquiry_id = $1`, [args.inquiryId]);
  return true;
}
