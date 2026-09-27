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

export async function listMessages(client: ScopedClient, inquiryId: string): Promise<MessageRow[]> {
  const { rows } = await q<MessageRow>(
    client,
    `SELECT message_id, kind, body, operator_name,
            to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
            to_char(edited_at,  'YYYY-MM-DD')         AS edited_at
       FROM public.tb_s080_inquiry_messages
      WHERE inquiry_id = $1
      ORDER BY created_at, message_id`,
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
 * ★ 삭제된 글도 센다(04-data-model.md §4) — 지우고 다시 쓰는 길을 막는다.
 */
export async function phoneUsage(
  client: ScopedClient,
  digits: string,
): Promise<{ today: number; secondsSinceLast: number | null }> {
  const { rows } = await q<{ today: number; since: number | null }>(
    client,
    `SELECT count(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today,
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - max(created_at)))::int AS since
       FROM public.tb_s080_inquiries
      WHERE phone_digits = $1`,
    [digits],
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
