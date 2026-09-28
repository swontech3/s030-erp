/**
 * 운영자 문의 관리 라우트 — s0300200080. **운영사 전용(audience_tp='P').**
 *
 * 명세: design/handoff/inquiry-board/03-thread.md §5 · 04-data-model.md §5
 *
 * =============================================================================
 * ★★★ 왜 `routes/inquiry.ts` 와 **다른 파일**인가
 * =============================================================================
 * 그쪽은 라우트마다 `config: { public: true }` 가 붙은 **로그인 없는** 게시판이다.
 * 여기는 이름·연락처·이메일·본문이 그대로 나가는 자리다. 한 파일에 섞으면
 * `public: true` 를 옆 라우트에 잘못 붙이는 순간 개인정보가 로그인 없이 열린다 —
 * 현황판(`routes/kiosk.ts`)을 예약(`routes/booking.ts`)에서 떼어 둔 것과 같은 이유다.
 *
 * ★ 이 파일의 라우트에는 `public` 이 **하나도 없다.** 세션 훅이 401 로 걸러 주고,
 *   그 위에 역할 검사(운영사만)가 한 겹 더 있다.
 *
 * =============================================================================
 * ★★ 한 업무는 한 화면에서 (CLAUDE.md) — 답변은 이 화면에서만
 * =============================================================================
 * 답변 등록·전화 답변 기록·답변 수정·글 삭제는 전부 여기다. 고객 화면(s0300500070)은
 * 그 결과를 보여 주기만 하고, 고객이 쓰는 것은 추가 질문 하나뿐이다.
 *
 * =============================================================================
 * ★★ 상태(접수·답변완료)는 저장하지 않는다
 * =============================================================================
 * 마지막 글로 판정한다(`inquiryStatus`). 그래서 답변을 등록하면 「답변완료」가 되고,
 * 고객이 추가 질문을 달면 **다시 「접수」**가 된다 — 목록 기본 필터가 그 값이다.
 * 검색도 같은 함수로 「어떤 kind 가 그 상태인가」를 만들어 SQL 에 넘긴다.
 *
 * =============================================================================
 * ★★ 답변은 **질문 하나에 하나 · 최대 2회** (2026-09-28)
 * =============================================================================
 * 흐름은 하나다: 문의 → 답변1 → 추가 질문 → 답변2 → 끝. 연달아 두 번 답하지 않고,
 * 더 전할 말이 있으면 **기존 답변을 수정**한다(수정은 횟수 제한이 없다).
 * 판정은 shared 의 `operatorReplyBlock` 하나이고, 화면은 그것으로 입력칸을 잠근다 —
 * 그래도 **정본은 이 파일이다.** 화면을 지나지 않는 요청이 있기 때문이다.
 *
 * ★ 메시지 **단위 삭제 라우트를 두지 않는다**(03-thread.md §5). 삭제는 글 전체 하나뿐이다.
 * ★ 알림 메일을 보내지 않는다 — 고객은 이 글에서 확인한다(01-flow.md).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  OPERATOR_DISPLAY_NAME,
  PAGE_SIZE,
  REPLY_BLOCK_MESSAGE,
  RETENTION_MONTHS,
  inquiryStatus,
  operatorReplyBlock,
  parseOperatorReply,
  type MessageKind,
} from '@swonbiz/shared/domain/inquiry';
import { bbiyongAuth } from '../bbiyong/index.ts';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import { phoneDigitsToken } from '../lib/crypto.ts';
import {
  countAdminInquiries,
  findAdminInquiry,
  findMessage,
  findPhoneDigits,
  insertMessage,
  listAdminInquiries,
  listMessages,
  purgeInquiry,
  updateMessageBody,
  type AdminListRow,
  type MessageRow,
} from '../db/inquiries.ts';

/** 문의 관리는 운영 업무다. 조회부터 닫는다 — 여는 순간 남의 연락처가 한 화면에 모인다. */
const ADMIN_ROLE = 'operator';

const ALL_KINDS: MessageKind[] = ['text', 'phone', 'customer'];

/** 「이 상태로 치는 마지막 kind 는 무엇인가」 — 판정은 shared 하나뿐이다. */
function kindsFor(status: 'R' | 'A'): { kinds: string[]; emptyMatches: boolean } {
  return {
    kinds: ALL_KINDS.filter((k) => inquiryStatus([k]) === status),
    emptyMatches: inquiryStatus([]) === status,
  };
}

function scopeOf(session: { role: string; companyId: string | null }): CompanyScope {
  return { role: session.role as CompanyScope['role'], companyId: session.companyId };
}

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '문의 관리는 운영사만 볼 수 있습니다' });

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: 'not_found', message: '문의를 찾을 수 없습니다' });

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function toMessage(row: MessageRow) {
  return {
    messageId: row.message_id,
    kind: row.kind,
    /** ★ `phone` 은 본문이 없다 — 고객 화면에 「전화로 답변드렸습니다」만 보인다. */
    body: row.body,
    /**
     * ★★★ 표시 이름은 **고정 문구**다(2026-09-28). 운영자 화면도 고객 화면과 **같은
     *    이름**을 본다 — 고객에게 보이는 그대로가 이 화면에 보여야 한다.
     * ★ 누가 처리했는지는 DB 의 `operator_id`·`operator_name` 에 남는다(운영 추적용).
     */
    operatorName: row.kind === 'customer' ? null : OPERATOR_DISPLAY_NAME,
    createdAt: row.created_at,
    /** 있으면 「수정됨」. 날짜만이다(03-thread.md §3). */
    editedAt: row.edited_at,
  };
}

function toListItem(row: AdminListRow) {
  return {
    inquiryId: row.inquiry_id,
    type: row.type,
    /** ★ 운영자 화면이라 **실명**이다. 공개 목록은 `maskName` 을 거친다. */
    name: row.name,
    day: row.day,
    status: inquiryStatus(row.last_kind ? [row.last_kind as MessageKind] : []),
    /** 마지막 글의 종류·시각. 스레드가 비었으면 둘 다 `null`(= 원글만). */
    lastKind: row.last_kind,
    lastAt: row.last_at,
    /** ★ **운영자 화면에만** 있는 값이다 — 고객 목록·글 보기에는 없다(04-data-model §5). */
    retentionPassed: row.retention_passed,
  };
}

/**
 * 답변에 적힐 담당자 이름 — 삐용 프로필에서 가져온다.
 *
 * ★★ 세션 테이블에 이름을 복사해 두지 않는 것은 `/auth/me` 와 같은 원칙이지만,
 *    **메시지에는 스냅샷으로 박는다**(`operator_name`). 담당자 이름이 나중에 바뀌어도
 *    고객이 읽은 답변의 서명은 그대로여야 한다(04-data-model.md §2).
 * ★ 못 가져오면 `null` 이다 — 답변 등록을 막지 않는다. 답변이 늦는 것보다 서명이
 *   비는 것이 낫고, 고객 화면은 「SwonBiz」까지는 그린다.
 */
async function operatorName(memberId: number, req: FastifyRequest): Promise<string | null> {
  try {
    const profile = await bbiyongAuth.getProfile(memberId);
    return profile?.memberName ?? null;
  } catch (err) {
    req.log.warn({ err }, '담당자 이름 조회 실패 — 답변은 그대로 등록한다');
    return null;
  }
}

export function registerInquiryAdminRoutes(app: FastifyInstance): void {
  /* ── 목록 ────────────────────────────────────────────────────────────────
     필터는 셋이다 — 상태(접수·답변완료) · 유형 · 검색(이름·연락처).
     ★ 화면 기본값은 「접수」다(답해야 할 것부터 보인다). 서버는 기본값을 두지 않는다 —
       거르는 조건을 서버가 몰래 넣으면 「전체」를 고를 수 없다.
     ★ 목록에는 **연락처를 담지 않는다.** 검색은 연락처로 되지만(아래 `q`) 돌려주는
       줄에는 없다 — 목록에 필요한 것이 아니고, 상세를 열면 보인다. */
  app.get<{
    Querystring: { page?: string; status?: string; type?: string; q?: string };
  }>('/admin/inquiries', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== ADMIN_ROLE) return forbidden(reply);

    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const type = req.query.type ? String(req.query.type) : null;
    const status = req.query.status === 'R' || req.query.status === 'A' ? req.query.status : null;
    const picked = status ? kindsFor(status) : { kinds: null, emptyMatches: false };
    const filter = {
      type,
      keyword: req.query.q ? String(req.query.q).slice(0, 60) : null,
      kinds: picked.kinds,
      emptyMatches: picked.emptyMatches,
    };

    const seen = await withCompanyScope(scopeOf(session), async (client) => ({
      total: await countAdminInquiries(client, filter),
      rows: await listAdminInquiries(
        client,
        filter,
        { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
        RETENTION_MONTHS,
      ),
    }));

    return reply.send({
      total: seen.total,
      page,
      pageSize: PAGE_SIZE,
      /** 화면이 「보관 기간 지남」 문구에 쓴다 — 개월 수를 화면에 박지 않는다. */
      retentionMonths: RETENTION_MONTHS,
      items: seen.rows.map(toListItem),
    });
  });

  /* ── 글 한 건 — 원글 전체 + 스레드 ──────────────────────────────────────
     ★ 비밀번호를 묻지 않는다. 운영자는 답하는 사람이다 — 대신 이 라우트 자체가
       운영사 세션에만 열린다. */
  app.get<{ Params: { id: string } }>('/admin/inquiries/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== ADMIN_ROLE) return forbidden(reply);

    const inquiryId = String(req.params.id);
    const found = await withCompanyScope(scopeOf(session), async (client) => {
      const row = await findAdminInquiry(client, inquiryId, RETENTION_MONTHS);
      if (!row) return null;
      return { row, messages: await listMessages(client, inquiryId) };
    });
    if (!found) return notFound(reply);

    const { row, messages } = found;
    return reply.send({
      inquiry: {
        inquiryId: row.inquiry_id,
        type: row.type,
        name: row.name,
        phone: row.phone,
        email: row.email,
        companyName: row.company_name,
        body: row.body,
        day: row.day,
        createdAt: row.created_at,
        status: inquiryStatus(messages.map((m) => m.kind as MessageKind)),
        retentionPassed: row.retention_passed,
        retentionMonths: RETENTION_MONTHS,
      },
      messages: messages.map(toMessage),
    });
  });

  /* ── 답변 등록 · 전화 답변 기록 ──────────────────────────────────────────
     ★ `kind` 둘뿐이다 — `text`(글답변) · `phone`(전화로 답변함, 본문 없음).
       `customer` 는 받지 않는다(`parseOperatorReply`) — 운영자가 고객 이름으로
       글을 붙일 길을 두지 않는다.
     ★ 등록하면 상태가 「답변완료」가 된다. 저장하는 컬럼이 아니라 마지막 글이 바뀐
       결과다 — 응답의 `status` 를 화면이 뱃지에 그대로 쓴다.

     ★★★ **횟수를 여기서 막는다**(`operatorReplyBlock`, 2026-09-28). 답 안 한 질문이
        없으면(= 마지막이 운영자 글) 쓸 수 없고, 2회를 다 쓰면 잠긴다 — 더 전할 말은
        **기존 답변 수정**이다. 화면도 같은 함수로 입력칸을 잠그지만 **정본은 여기다**:
        API 를 직접 찌르면 화면을 지나가지 않는다. */
  app.post<{ Params: { id: string }; Body: { kind?: string; body?: string } }>(
    '/admin/inquiries/:id/messages',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== ADMIN_ROLE) return forbidden(reply);

      const inquiryId = String(req.params.id);
      const parsed = parseOperatorReply(str(req.body?.kind), str(req.body?.body));
      if (!parsed) {
        return reply.code(400).send({ error: 'invalid_request', message: '답변 내용을 입력해 주세요' });
      }

      const name = await operatorName(session.s020MemberId, req);
      const result = await withCompanyScope(scopeOf(session), async (client) => {
        // ★ 지운 글에는 답을 붙이지 않는다 — `findAdminInquiry` 가 deleted_at 을 본다.
        const row = await findAdminInquiry(client, inquiryId, RETENTION_MONTHS);
        if (!row) return { code: 404 as const };

        /* ★★ 횟수 판정은 **지금 스레드**를 보고 한다. 화면이 들고 있는 값을 믿지 않는다 —
           두 사람이 같은 문의를 열어 두었을 수 있고, 그때 늦게 누른 쪽이 409 를 받아야 한다. */
        const before = await listMessages(client, inquiryId);
        const block = operatorReplyBlock(before.map((m) => m.kind as MessageKind));
        if (block) return { code: 409 as const, block };

        await insertMessage(client, {
          messageId: randomUUID(),
          inquiryId,
          kind: parsed.kind,
          body: parsed.body,
          operatorId: String(session.s020MemberId),
          /** ★ 표시에는 쓰지 않는다 — **누가 처리했나**의 기록이다(표시는 고정 문구). */
          operatorName: name,
        });
        return { code: 201 as const, messages: await listMessages(client, inquiryId) };
      });

      if (result.code === 404) return notFound(reply);
      if (result.code === 409) {
        /* ★ 화면의 잠금 안내와 **같은 문장**이다(`REPLY_BLOCK_MESSAGE`). `reason` 은
           기계용 — 화면이 어느 이유인지 가려서 쓸 수 있게 함께 보낸다. */
        return reply
          .code(409)
          .send({ error: 'conflict', reason: result.block, message: REPLY_BLOCK_MESSAGE[result.block] });
      }

      return reply.code(201).send({
        messages: result.messages.map(toMessage),
        status: inquiryStatus(result.messages.map((m) => m.kind as MessageKind)),
      });
    },
  );

  /* ── 답변 수정 — 「수정됨」 ───────────────────────────────────────────────
     ★ 고칠 수 있는 것은 **글답변(`text`)의 본문**뿐이다. 전화 기록은 본문이 없어
       고칠 것이 없고(기록 시각·담당자는 그대로), 고객의 추가 질문은 운영자가
       고치는 것이 아니다 — 둘 다 409 로 거절한다.
     ★ 순서는 그대로다 — `created_at` 을 건드리지 않는다(`updateMessageBody`). */
  app.patch<{ Params: { id: string; messageId: string }; Body: { body?: string } }>(
    '/admin/inquiries/:id/messages/:messageId',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== ADMIN_ROLE) return forbidden(reply);

      const inquiryId = String(req.params.id);
      const messageId = String(req.params.messageId);
      const parsed = parseOperatorReply('text', str(req.body?.body));
      if (!parsed?.body) {
        return reply.code(400).send({ error: 'invalid_request', message: '답변 내용을 입력해 주세요' });
      }

      const result = await withCompanyScope(scopeOf(session), async (client) => {
        const row = await findAdminInquiry(client, inquiryId, RETENTION_MONTHS);
        if (!row) return { code: 404 as const };
        const message = await findMessage(client, { inquiryId, messageId });
        if (!message) return { code: 404 as const };
        if (message.kind !== 'text') return { code: 409 as const };
        await updateMessageBody(client, { inquiryId, messageId, body: parsed.body! });
        return { code: 200 as const, messages: await listMessages(client, inquiryId) };
      });

      if (result.code === 404) return notFound(reply);
      if (result.code === 409) {
        return reply
          .code(409)
          .send({ error: 'conflict', message: '글답변만 수정할 수 있습니다' });
      }

      return reply.send({
        messages: result.messages.map(toMessage),
        status: inquiryStatus(result.messages.map((m) => m.kind as MessageKind)),
      });
    },
  );

  /* ── 글 전체 삭제 ────────────────────────────────────────────────────────
     ★★★ **되돌릴 수 없다.** 개인정보를 지우고 스레드를 없앤다 — 무엇이 남는지는
        `purgeInquiry` 머리말에 적어 두었다(연락처 해시만 남는다 · 스팸 집계용).
     ★ 확인 창은 화면이 띄우지만, 그것은 친절이다. 여기서는 한 번 더 살아 있는
       글인지만 본다 — 이미 지운 글에 두 번 삭제를 보내면 404 다.
     ★ 「보관 기간 지남」이 아닌 글도 지울 수 있다(2026-09-28 결정 · 03-thread §5 가
       운영 판단으로 남긴 자리다). 스팸 글을 6개월 들고 있을 이유가 없다. 대신
       화면의 확인 문구가 기간이 지났는지에 따라 다르다. */
  app.delete<{ Params: { id: string } }>('/admin/inquiries/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== ADMIN_ROLE) return forbidden(reply);

    const inquiryId = String(req.params.id);
    const done = await withCompanyScope(scopeOf(session), async (client) => {
      const digits = await findPhoneDigits(client, inquiryId);
      if (digits === null) return false;
      return await purgeInquiry(client, { inquiryId, phoneToken: phoneDigitsToken(digits) });
    });
    if (!done) return notFound(reply);

    req.log.info({ inquiryId, memberId: session.s020MemberId }, '문의 삭제 — 개인정보 파기');
    // 204 에 본문을 붙이지 않는다(`forwardDelete` 와 같은 규칙).
    return reply.code(204).send();
  });
}
