/**
 * 입주사·구성원 라우트 — 3-4.
 *
 * 판정은 전부 `@swonbiz/shared/domain` 의 순수 함수가 한다. 이 파일은 **배선만** 한다 —
 * 세션에서 스코프를 꺼내고, 트랜잭션을 열고, 함수가 던진 것을 HTTP 코드로 바꾼다.
 *
 * =============================================================================
 * ★★ 운영사 전용이다 — 읽기도 막는다
 * =============================================================================
 * 계약 라우트는 조회를 입주사에게도 열어 준다(자기 계약은 본다). 여기는 다르다:
 * 이 API 가 내려주는 것은 **입주사 명부**다. 한 입주사가 다른 입주사의 상호·대표자·
 * 연락처를 보게 되는 자리라 조회부터 403 으로 닫는다.
 * (2026-08 명부 유출이 정확히 이 모양이었다 — `withCompanyScope` 머리말 참조.)
 *
 * =============================================================================
 * ★ 없는 회사와 볼 수 없는 회사를 구분하지 않는다
 * =============================================================================
 * RLS 가 거른 뒤라 남의 회사는 0행으로 온다. 그대로 404 로 답한다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { deriveTenantStatus } from '@swonbiz/shared/domain/tenant-status';
import { buildMemberWrites, type MemberInput } from '@swonbiz/shared/domain/member-payload';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  findCompany,
  listCompanies,
  listCompanyContracts,
  listContractFacts,
  listMembers,
  listRoomSummaries,
  replaceMembers,
  updateCompany,
  type CompanyRow,
  type MemberRow,
} from '../db/companies.ts';

/** 입주사 화면은 운영사 업무다. 계약 라우트의 `WRITE_ROLE` 과 같은 값이다. */
const OPERATOR = 'operator';

const scopeOf = (session: { role: string; companyId: string | null }): CompanyScope => ({
  role: session.role as CompanyScope['role'],
  companyId: session.companyId,
});

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '입주사 정보는 운영사만 다룰 수 있습니다' });

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: 'not_found', message: '입주사를 찾을 수 없습니다' });

/** 도메인 함수가 던진 `RangeError` 는 사용자 입력 문제다 — 400 으로 바꾼다. */
function asBadRequest(err: unknown, reply: FastifyReply): FastifyReply | never {
  if (err instanceof RangeError) {
    return reply.code(400).send({ error: 'invalid_request', message: err.message });
  }
  throw err;
}

/** 응답 모양 — DB 의 snake_case 를 그대로 내보내지 않는다. */
function toCompany(row: CompanyRow) {
  return {
    companyId: row.company_id,
    buildId: row.build_id,
    companyName: row.company_name,
    bizNumber: row.biz_number,
    corpNumber: row.corp_number,
    ceoName: row.ceo_name,
    /** ★ DB 의 `business_type` 은 「업태」, `business_item` 은 「종목」이다. */
    businessType: row.business_type,
    businessItem: row.business_item,
    memberType: row.member_type,
    tel: row.tel,
    email: row.email,
    /** ★ 대표자 **자택** 주소다. 사업장 주소(`address`)가 아니다. */
    ceoZipCode: row.ceo_zip_code,
    ceoAddress: row.ceo_address,
    ceoAddressDetail: row.ceo_address_detail,
    memo: row.memo,
    status: row.status,
  };
}

function toMember(row: MemberRow) {
  return {
    memberId: row.member_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    // 화면은 boolean 으로 받는다. 코드값('C'/'M')은 서버 안에만 둔다.
    isRepresentative: row.is_representative === 'C',
    memo: row.memo,
  };
}

interface CompanyBody {
  companyName?: string;
  bizNumber?: string | null;
  corpNumber?: string | null;
  ceoName?: string | null;
  businessType?: string | null;
  businessItem?: string | null;
  memberType?: string | null;
  tel?: string | null;
  email?: string | null;
  ceoZipCode?: string | null;
  ceoAddress?: string | null;
  ceoAddressDetail?: string | null;
  memo?: string | null;
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

export function registerCompanyRoutes(app: FastifyInstance): void {
  // ── 목록 ────────────────────────────────────────────────────────────────
  app.get('/companies', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const data = await withCompanyScope(scopeOf(session), async (client) => ({
      companies: await listCompanies(client),
      facts: await listContractFacts(client),
      rooms: await listRoomSummaries(client),
    }));

    // ★ 오늘을 한 번만 정한다. 행마다 new Date() 를 부르면 목록을 그리는 도중
    //   자정을 넘길 때 기준이 갈린다.
    const today = new Date();
    const factsBy = new Map<string, { status: string; endDate: Date }[]>();
    for (const f of data.facts) {
      const list = factsBy.get(f.company_id) ?? [];
      list.push({ status: f.status, endDate: f.end_date });
      factsBy.set(f.company_id, list);
    }
    const roomBy = new Map(data.rooms.map((r) => [r.company_id, r]));

    return reply.send({
      // ★ 서버 전체 건수다. 화면의 칩 필터로 줄지 않는다(시안 「24곳」).
      total: data.companies.length,
      companies: data.companies.map((c) => {
        const contracts = factsBy.get(c.company_id) ?? [];
        const status = deriveTenantStatus({ contracts, today });
        const room = roomBy.get(c.company_id);
        return {
          companyId: c.company_id,
          companyName: c.company_name,
          ceoName: c.ceo_name,
          tel: c.tel,
          bizNumber: c.biz_number,
          /** 사업자등록 신청 중 — 화면이 「(가등록)」을 붙인다. */
          provisional: !c.biz_number,
          statusLabel: status.label,
          filters: status.filters,
          contractCount: contracts.length,
          roomSummary: room
            ? [room.room_name, room.contract_room ? `(${room.contract_room})` : null]
                .filter(Boolean)
                .join(' ')
            : '',
        };
      }),
    });
  });

  // ── 단건 + 계약 목록 ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/companies/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const found = await withCompanyScope(scopeOf(session), async (client) => {
      const company = await findCompany(client, req.params.id);
      if (!company) return null;
      return { company, contracts: await listCompanyContracts(client, req.params.id) };
    });
    if (!found) return notFound(reply);

    return reply.send({
      ...toCompany(found.company),
      contracts: found.contracts.map((k) => ({
        contractId: k.contract_id,
        contractNo: k.contract_no,
        status: k.status,
        periodMonths: k.period_months,
        contractDate: k.contract_date,
        startDate: k.start_date,
        endDate: k.end_date,
        paymentMethod: k.payment_method,
        contractRoom: k.contract_room,
        firstPayment: k.first_payment,
        /** 부가세 포함 월납부액 합계 — 줄별 `payment_amount` 의 합이다. */
        monthlyPayment: k.monthly_payment,
        depositTotal: k.deposit_total,
        roomTypes: k.room_types ? k.room_types.split(',') : [],
        roomNames: k.room_names ?? '',
        spaceCount: k.space_count,
      })),
    });
  });

  // ── 수정 (계약 폼 섹션 1) ───────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: CompanyBody }>('/companies/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    /**
     * ★ 회사명이 비어도 **막지 않는다.** 사업자등록 신청 중인 가계약은 회사명 없이
     *   임시저장으로 들어온다 — 400 으로 막으면 같은 요청에 실린 대표자·연락처까지
     *   통째로 날아간다. 비어 있으면 `updateCompany` 가 기존 값을 그대로 둔다.
     *
     *   빈 이름으로 **확정**되는 일은 화면이 막는다(`REQUIRED_FIELDS` 의 `company`).
     *   서버가 확정 시점의 필수값을 다시 보는 자리는 계약 라우트다.
     */
    const companyName = text(req.body?.companyName);

    const actor = String(session.s020MemberId);
    const result = await withCompanyScope(scopeOf(session), async (client) => {
      const company = await findCompany(client, req.params.id);
      if (!company) return 'not_found' as const;

      await updateCompany(client, {
        companyId: company.company_id,
        actor,
        patch: {
          companyName,
          bizNumber: text(req.body?.bizNumber),
          corpNumber: text(req.body?.corpNumber),
          ceoName: text(req.body?.ceoName),
          businessType: text(req.body?.businessType),
          businessItem: text(req.body?.businessItem),
          memberType: text(req.body?.memberType),
          tel: text(req.body?.tel),
          email: text(req.body?.email),
          ceoZipCode: text(req.body?.ceoZipCode),
          ceoAddress: text(req.body?.ceoAddress),
          ceoAddressDetail: text(req.body?.ceoAddressDetail),
          memo: text(req.body?.memo),
        },
      });
      return 'ok' as const;
    });

    if (result === 'not_found') return notFound(reply);
    return reply.send({ companyId: req.params.id });
  });

  // ── 구성원 조회 ─────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/companies/:id/members', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const found = await withCompanyScope(scopeOf(session), async (client) => {
      const company = await findCompany(client, req.params.id);
      if (!company) return null;
      return listMembers(client, req.params.id);
    });
    if (!found) return notFound(reply);
    return reply.send({ members: found.map(toMember) });
  });

  // ── 구성원 전체 교체 (계약 폼 섹션 3) ───────────────────────────────────
  app.put<{ Params: { id: string }; Body: { members?: MemberInput[] } }>(
    '/companies/:id/members',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      let writes;
      try {
        // ★★ 상한(20)과 대표자 정규화가 여기서 일어난다. 화면이 막는 것은 편의다.
        writes = buildMemberWrites(req.body?.members ?? []);
      } catch (err) {
        return asBadRequest(err, reply);
      }

      const actor = String(session.s020MemberId);
      const result = await withCompanyScope(scopeOf(session), async (client) => {
        const company = await findCompany(client, req.params.id);
        if (!company) return 'not_found' as const;

        const counts = await replaceMembers(client, {
          companyId: company.company_id,
          buildId: company.build_id,
          members: writes,
          actor,
          newId: randomUUID,
        });
        return { ...counts, members: await listMembers(client, company.company_id) };
      });

      if (result === 'not_found') return notFound(reply);
      return reply.send({
        companyId: req.params.id,
        inserted: result.inserted,
        updated: result.updated,
        deactivated: result.deactivated,
        members: result.members.map(toMember),
      });
    },
  );
}
