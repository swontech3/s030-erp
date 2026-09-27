/**
 * 문의상담 게시판 라우트 — s0300500070 · p1 · p2. **로그인 없는 공개 화면.**
 *
 * 명세: design/handoff/inquiry-board/ 01~04
 *
 * =============================================================================
 * ★★★ 공개 화면이라 **응답이 곧 보안 경계다**
 * =============================================================================
 * 목록에 나가는 것은 유형 · 가린 이름 · 날짜 · 상태 넷뿐이다. 이름·연락처·이메일·
 * 본문은 `listInquiries` 가 **가져오지도 않는다**(실명만 가져와 즉시 가린다).
 * 원글 전체는 비밀번호를 맞춘 사람에게만 — 현황판(026)과 같은 규칙이다.
 *
 * =============================================================================
 * ★★★ 4자 비밀번호는 **해시 + 시도 제한**이 함께여야 성립한다
 * =============================================================================
 * `unlock` 은 글 하나·IP 하나에 10분 5회다. 맞히면 시도 기록을 지우고, 틀리면 남긴다.
 * IP 는 우리 Next 프록시가 넘겨 준다(`x-erp-client-ip`) — Fastify 는 loopback 에만
 * 바인딩돼 있어 그 헤더를 넣을 수 있는 것은 우리 프록시뿐이다. 못 받으면 `unknown`
 * 으로 묶이고, 그때는 **글 단위 제한**이 된다(느슨해지는 것이 아니라 더 조인다).
 *
 * =============================================================================
 * ★★ 상태는 저장하지 않는다
 * =============================================================================
 * 마지막 글로 판정한다(`inquiryStatus`). 검색도 같은 함수로 「어떤 kind 가 답변인가」를
 * 만들어 SQL 에 넘긴다 — 규칙이 SQL 과 코드 두 곳에 적히지 않게.
 *
 * ★ 운영자 답변 등록·수정은 **여기 없다.** 문의 관리 화면(s0300200080)과 함께 만든다
 *   (2026-09-27 결정). 이 파일에 쓰기는 「원글 등록」과 「고객 추가 질문」 둘뿐이다.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseDay } from '@swonbiz/shared/domain/day';
import {
  COOLDOWN_SECONDS,
  DAILY_LIMIT,
  PAGE_SIZE,
  TOKEN_TTL_MINUTES,
  UNLOCK_MAX_ATTEMPTS,
  UNLOCK_WINDOW_MINUTES,
  inquiryStatus,
  maskName,
  phoneDigits,
  validateFollowUp,
  validateInquiry,
  type MessageKind,
} from '@swonbiz/shared/domain/inquiry';
import { withCompanyScope } from '../db/withCompanyScope.ts';
import {
  clearAttempts,
  countAttempts,
  countInquiries,
  findInquiry,
  findInquiryHead,
  findLiveToken,
  insertAttempt,
  insertInquiry,
  insertMessage,
  insertToken,
  listInquiries,
  listInquiryCodes,
  listMessages,
  phoneUsage,
  sweepAttempts,
  sweepTokens,
  type MessageRow,
} from '../db/inquiries.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';

/** 세션이 없는 요청이 쓰는 스코프 — RLS 가 0건으로 보는 자리(`routes/kiosk.ts` 와 같다). */
const NO_SCOPE = { role: 'tenant' as const, companyId: null };

/** 건물은 하나다. 회의실·계약과 같은 값을 쓴다. */
const BUILD_ID = '1';

const ALL_KINDS: MessageKind[] = ['text', 'phone', 'customer'];

/** 「이 상태로 치는 마지막 kind 는 무엇인가」 — 판정은 shared 하나뿐이다. */
function kindsFor(status: 'R' | 'A'): { kinds: string[]; emptyMatches: boolean } {
  return {
    kinds: ALL_KINDS.filter((k) => inquiryStatus([k]) === status),
    emptyMatches: inquiryStatus([]) === status,
  };
}

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** 프록시가 넘겨 준 클라이언트 IP. 없으면 `unknown` — 그때는 글 단위 제한이 된다. */
function clientIpOf(req: FastifyRequest): string {
  const given = req.headers['x-erp-client-ip'];
  const raw = Array.isArray(given) ? given[0] : given;
  return (raw ?? '').trim().slice(0, 60) || 'unknown';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function toMessage(row: MessageRow) {
  return {
    messageId: row.message_id,
    kind: row.kind,
    /** ★ `phone` 은 본문이 없다 — 「전화로 답변드렸습니다」만 보여 준다. */
    body: row.body,
    operatorName: row.operator_name,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

export function registerInquiryRoutes(app: FastifyInstance): void {
  /* ── 코드 — 유형·상태 이름 ────────────────────────────────────────────────
     ★ 화면에 문자열을 박지 않는다. 유형 버튼 5개·상태 뱃지·검색 Select 가 이 값으로
       그려진다. 공개 라우트지만 내려가는 것은 코드와 이름뿐이다. */
  app.get('/inquiries/codes', { config: { public: true } }, async (_req, reply) => {
    const rows = await withCompanyScope(NO_SCOPE, (client) => listInquiryCodes(client));
    return reply.send({
      types: rows.filter((r) => r.category === 'QU_TP').map((r) => ({ code: r.code, name: r.name })),
      statuses: rows.filter((r) => r.category === 'QU_ST').map((r) => ({ code: r.code, name: r.name })),
    });
  });

  /* ── 목록 ────────────────────────────────────────────────────────────────
     ★★★ 나가는 것은 넷뿐이다 — id · 유형 · 가린 이름 · 날짜 · 상태.
        본문·연락처·이메일·회사명은 SELECT 하지도 않는다(`db/inquiries.ts` 머리말). */
  app.get<{
    Querystring: { page?: string; from?: string; to?: string; status?: string; type?: string };
  }>('/inquiries', { config: { public: true } }, async (req, reply) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const from = req.query.from && parseDay(String(req.query.from)) ? String(req.query.from) : null;
    const to = req.query.to && parseDay(String(req.query.to)) ? String(req.query.to) : null;
    const type = req.query.type ? String(req.query.type) : null;
    const status = req.query.status === 'R' || req.query.status === 'A' ? req.query.status : null;
    const picked = status ? kindsFor(status) : { kinds: null, emptyMatches: false };
    const filter = { from, to, type, kinds: picked.kinds, emptyMatches: picked.emptyMatches };

    const seen = await withCompanyScope(NO_SCOPE, async (client) => ({
      total: await countInquiries(client, filter),
      rows: await listInquiries(client, filter, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    }));

    return reply.send({
      total: seen.total,
      page,
      pageSize: PAGE_SIZE,
      items: seen.rows.map((r) => ({
        inquiryId: r.inquiry_id,
        type: r.type,
        /** ★ 서버가 가린다. 실명은 이 줄 밖으로 나가지 않는다. */
        maskedName: maskName(r.name),
        day: r.day,
        status: inquiryStatus(r.last_kind ? [r.last_kind as MessageKind] : []),
      })),
    });
  });

  /* ── 글 머리 — 비밀번호 화면이 보여 줄 「김** · 입주문의」 ─────────────────
     ★★ 목록 한 줄과 **똑같은 넷**이다(가린 이름 · 유형 · 날짜). 새로 새는 것이 없다 —
        목록에 이미 있는 값이고, 그 줄을 눌러서 온 화면이다. 그래서 비밀번호 전에
        보여 줘도 되는 유일한 정보다(02-screens.md §4 「비밀글입니다」 아래 줄).
     ★ 없는 글이면 404. 본문·연락처는 여기서도 나가지 않는다. */
  app.get<{ Params: { id: string } }>(
    '/inquiries/:id',
    { config: { public: true } },
    async (req, reply) => {
      const head = await withCompanyScope(NO_SCOPE, (client) =>
        findInquiryHead(client, String(req.params.id)),
      );
      if (!head) return reply.code(404).send({ error: 'not_found', message: '문의를 찾을 수 없습니다' });
      return reply.send({
        inquiryId: head.inquiry_id,
        type: head.type,
        maskedName: maskName(head.name),
        day: head.day,
      });
    },
  );

  /* ── 등록 ────────────────────────────────────────────────────────────────
     ★ 스팸은 **연락처 숫자**로 센다(표기가 달라도 같은 사람). 하루 3건 · 1분 간격.
     ★ 429 의 `reason` 으로 화면이 배너 두 종을 가른다(02-screens.md §3). */
  app.post<{
    Body: {
      name?: string; phone?: string; email?: string; companyName?: string;
      type?: string; body?: string; password?: string; agreed?: boolean;
    };
  }>('/inquiries', { config: { public: true } }, async (req, reply) => {
    const input = {
      name: str(req.body?.name).trim(),
      phone: str(req.body?.phone).trim(),
      email: str(req.body?.email).trim(),
      companyName: str(req.body?.companyName).trim(),
      type: str(req.body?.type),
      body: str(req.body?.body),
      password: str(req.body?.password),
      agreed: req.body?.agreed === true,
    };

    const codes = await withCompanyScope(NO_SCOPE, (client) => listInquiryCodes(client));
    const typeCodes = codes.filter((c) => c.category === 'QU_TP').map((c) => c.code);
    const bad = validateInquiry(input, typeCodes);
    if (bad.length) {
      return reply.code(400).send({ error: 'invalid_request', fields: bad, message: '입력을 확인해 주세요' });
    }

    const digits = phoneDigits(input.phone);
    const usage = await withCompanyScope(NO_SCOPE, (client) => phoneUsage(client, digits));
    // ★ 하루 3건을 먼저 본다 — 둘 다 걸리면 「오늘은 더 등록할 수 없습니다」가 맞는 말이다.
    if (usage.today >= DAILY_LIMIT) {
      return reply.code(429).send({ error: 'too_many', reason: 'daily', message: '오늘은 더 등록할 수 없습니다' });
    }
    if (usage.secondsSinceLast !== null && usage.secondsSinceLast < COOLDOWN_SECONDS) {
      return reply.code(429).send({ error: 'too_many', reason: 'cooldown', message: '잠시 후 다시 등록해 주세요' });
    }

    const inquiryId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await withCompanyScope(NO_SCOPE, (client) =>
      insertInquiry(client, {
        inquiryId,
        buildId: BUILD_ID,
        type: input.type,
        name: input.name,
        phone: input.phone,
        phoneDigits: digits,
        email: input.email,
        companyName: input.companyName || null,
        body: input.body.trim(),
        passwordHash,
      }),
    );

    // 완료 화면의 「목록 표시」 미리보기용 — 실명이 아니라 가린 이름을 돌려준다.
    return reply.code(201).send({ inquiryId, maskedName: maskName(input.name), type: input.type });
  });

  /* ── 비밀번호 확인 → 열람 토큰 ───────────────────────────────────────────
     ★★★ 여기가 글 보기의 유일한 문이다. 화면이 아니라 **서버가** 막는다. */
  app.post<{ Params: { id: string }; Body: { password?: string } }>(
    '/inquiries/:id/unlock',
    { config: { public: true } },
    async (req, reply) => {
      const inquiryId = String(req.params.id);
      const password = str(req.body?.password);
      const clientIp = clientIpOf(req);

      const result = await withCompanyScope(NO_SCOPE, async (client) => {
        await sweepAttempts(client, UNLOCK_WINDOW_MINUTES);
        const head = await findInquiryHead(client, inquiryId);
        // ★ 없는 글과 틀린 비밀번호를 구분해 알려 주지 않는다 — 글 목록을 훑는 단서가 된다.
        if (!head) return { code: 401 as const };

        const tried = await countAttempts(client, { inquiryId, clientIp, windowMinutes: UNLOCK_WINDOW_MINUTES });
        if (tried >= UNLOCK_MAX_ATTEMPTS) return { code: 429 as const };

        const row = await findInquiry(client, inquiryId);
        if (!row || !(await verifyPassword(password, row.password_hash))) {
          await insertAttempt(client, { attemptId: randomUUID(), inquiryId, clientIp });
          return { code: 401 as const };
        }

        await clearAttempts(client, { inquiryId, clientIp });
        await sweepTokens(client);
        const token = randomBytes(32).toString('base64url');
        await insertToken(client, { tokenHash: sha256(token), inquiryId, ttlMinutes: TOKEN_TTL_MINUTES });
        const messages = await listMessages(client, inquiryId);
        return { code: 200 as const, token, row, messages };
      });

      if (result.code === 429) {
        return reply.code(429).send({ error: 'too_many', message: '잠시 후 다시 시도해 주세요' });
      }
      if (result.code === 401) {
        return reply.code(401).send({ error: 'unauthorized', message: '비밀번호가 맞지 않습니다' });
      }

      const { row, messages, token } = result;
      return reply.send({
        token,
        inquiry: {
          inquiryId: row.inquiry_id,
          type: row.type,
          name: row.name,
          phone: row.phone,
          email: row.email,
          companyName: row.company_name,
          body: row.body,
          day: row.day,
          status: inquiryStatus(messages.map((m) => m.kind as MessageKind)),
        },
        messages: messages.map(toMessage),
      });
    },
  );

  /* ── 추가 질문 ───────────────────────────────────────────────────────────
     ★★★ **토큰이 없으면 쓸 수 없다.** 없으면 누구나 남의 글에 글을 붙인다
        (03-thread.md §4 「비밀번호 세션」).
     ★ 글 하나에 1회 — 두 번째는 409 다. 화면도 막지만 서버가 정본이다. */
  app.post<{ Params: { id: string }; Body: { body?: string } }>(
    '/inquiries/:id/messages',
    { config: { public: true } },
    async (req, reply) => {
      const inquiryId = String(req.params.id);
      const body = str(req.body?.body).trim();
      const rawToken = req.headers['x-inquiry-token'];
      const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

      if (!token) {
        return reply.code(401).send({ error: 'unauthorized', message: '비밀번호를 다시 확인해 주세요' });
      }
      if (!validateFollowUp(body)) {
        return reply.code(400).send({ error: 'invalid_request', message: '내용을 입력해 주세요' });
      }

      const result = await withCompanyScope(NO_SCOPE, async (client) => {
        const ok = await findLiveToken(client, { tokenHash: sha256(token), inquiryId });
        if (!ok) return { code: 401 as const };
        const before = await listMessages(client, inquiryId);
        // 판정은 「고객 글이 하나라도 있는가」 하나다(03-thread.md §4).
        if (before.some((m) => m.kind === 'customer')) return { code: 409 as const };

        await insertMessage(client, {
          messageId: randomUUID(),
          inquiryId,
          kind: 'customer',
          body,
        });
        const after = await listMessages(client, inquiryId);
        return { code: 201 as const, after };
      });

      if (result.code === 401) {
        return reply.code(401).send({ error: 'unauthorized', message: '비밀번호를 다시 확인해 주세요' });
      }
      if (result.code === 409) {
        return reply.code(409).send({ error: 'conflict', message: '추가 질문은 한 번만 남길 수 있습니다' });
      }

      const messages = result.after;
      return reply.code(201).send({
        messages: messages.map(toMessage),
        // ★ 추가 질문이 달렸으니 「접수」로 돌아간다 — 화면이 뱃지를 이 값으로 바꾼다.
        status: inquiryStatus(messages.map((m) => m.kind as MessageKind)),
      });
    },
  );
}
