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
import {
  duplicateVerdictOf,
  isBizNumberFormatOk,
  NO_NAME_DUPLICATE,
} from '@swonbiz/shared/domain/biz-number-check';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import { lookupNtsStatus } from '../lib/ntsStatus.ts';
import {
  buildExists,
  findCompany,
  findCompanyByBizNumber,
  findCompanyByName,
  listCompanies,
  listCompanyContracts,
  listContractFacts,
  listMembers,
  insertCompany,
  listRoomSummaries,
  replaceMembers,
  updateCompany,
  type CompanyRow,
  type MemberRow,
} from '../db/companies.ts';
import {
  patchOrgForCompany,
  retryBbiyongForCompany,
} from '../companies/registerOrg.ts';

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
    /**
     * 삐용 연동(3-2) — **조회 전용**. 화면은 이 값으로 「미연동」을 표시하고,
     * 처리([다시 시도])는 계약 폼에서만 한다(`CLAUDE.md` 한 업무 한 화면).
     *
     * ★ `linked` 판정은 `orgId` 로 한다 — `status` 는 「왜 아직 아닌가」를 말하는
     *   값이고, 둘이 어긋나면 `orgId` 를 믿는다(마이그레이션 031 주석).
     */
    bbiyong: {
      orgId: row.link_s020_org_id,
      orgCode: row.link_org_code,
      status: row.link_s020_org_id !== null ? 'linked' : (row.link_status ?? null),
      /** ★ 운영자에게 그대로 보여주는 문구다. 연결된 뒤에는 비어 있다. */
      reason: row.link_s020_org_id !== null ? null : row.link_failed_reason,
    },
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

/**
 * Postgres 의 UNIQUE 위반(`23505`)인가.
 *
 * ★ 문구가 아니라 **코드**로 본다. 메시지는 서버 로캘·버전에 따라 바뀐다.
 */
const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';

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
          /** 정렬용 — 종료일이 가장 가까운 확정 계약까지의 일수. 지났으면 음수다. */
          sortDays: status.sortDays,
          contractCount: contracts.length,
          /**
           * 삐용 미연동 — **조회 전용 표시**다(3-2).
           *
           * ★ 「계약은 확정됐는데 삐용 연결은 아직」인 회사만 `true` 다. 계약이 없거나
           *   임시저장뿐인 회사는 연동 대상이 아니므로 `false` 다(`link_status` 가 NULL).
           * ★★ 이 화면에는 [다시 시도] 버튼을 두지 않는다 — 처리는 계약 폼 한 곳이다
           *    (`CLAUDE.md` 한 업무 한 화면).
           */
          bbiyongPending: c.link_s020_org_id === null && c.link_status === 'pending',
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

  // ── 사업자번호 확인 (계약 폼 섹션 1 의 [확인]) ──────────────────────────
  /**
   * 국세청 상태와 ERP 중복을 **한 번에** 본다. 버튼이 하나라 호출도 하나다.
   *
   * ★★ **아무것도 저장하지 않고, 아무것도 막지 않는다.** 폐업자와도 계약할 수 있고
   *    그 판단은 운영자가 한다. 이 라우트는 계약 저장 경로에 있지 않다 — 여기가
   *    죽어도 계약 등록은 그대로 된다.
   *
   * ★ 형식이 틀리면 국세청을 **부르지 않는다.** 남의 API 를 쓰레기로 두드리지 않는다.
   *
   * ★ 둘을 **동시에** 본다. 국세청 왕복(최대 5초)에 DB 조회를 줄 세울 이유가 없다.
   */
  app.get<{ Querystring: { bizNumber?: string; companyName?: string; selfCompanyId?: string } }>(
    '/companies/biz-check',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      const digits = (req.query?.bizNumber ?? '').replace(/\D/g, '');
      if (!isBizNumberFormatOk(digits)) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: '사업자등록번호 10자리를 입력해 주세요' });
      }

      const self = text(req.query?.selfCompanyId);
      const name = text(req.query?.companyName);

      const [nts, found, sameName] = await Promise.all([
        lookupNtsStatus(digits, req.log),
        withCompanyScope(scopeOf(session), (client) => findCompanyByBizNumber(client, digits)),
        // 회사명을 안 보냈으면 찾지 않는다 — 빈 이름끼리 걸리면 전부 중복이 된다.
        name
          ? withCompanyScope(scopeOf(session), (client) => findCompanyByName(client, name, self))
          : Promise.resolve(null),
      ]);

      // 상태 판정은 목록 화면과 **같은 함수**를 쓴다 — 두 벌이면 「종료」의 뜻이 갈린다.
      const status = found
        ? deriveTenantStatus({
            contracts: found.contracts.map((c) => ({ status: c.status, endDate: c.end_date })),
            today: new Date(),
          })
        : null;
      const existing =
        found && status
          ? {
              companyId: found.company_id,
              companyName: found.company_name,
              filters: status.filters,
              statusLabel: status.label,
            }
          : null;

      const duplicate = duplicateVerdictOf(existing, self);

      /**
       * ★ 회사명 중복은 **알려만 준다.** 같은 상호는 법적으로 가능하고, 사업자번호가
       *   다르면 다른 회사다. 상태를 가리지 않는다 — 종료된 입주사와 겹치는 것도
       *   사람이 알아봐야 할 정보다.
       *
       * ★ 화면은 사업자번호가 이미 걸렸으면 이 값을 말하지 않는다(`bizCheckLine`).
       *   같은 번호면 같은 회사라 한 회사를 두 번 가리키게 되기 때문이다. 여기서
       *   미리 지우지 않는 이유는, **무엇을 보여줄지는 문장을 만드는 쪽의 판단**이고
       *   서버가 그것까지 정하면 화면이 다른 조합을 만들 수 없게 되기 때문이다.
       */
      const nameDuplicate = sameName
        ? { found: true, companyId: sameName.company_id, companyName: sameName.company_name }
        : NO_NAME_DUPLICATE;

      // ★ `no-store` — 국세청 상태는 **조회한 그 순간의 사실**이다. 캐시에 남으면
      //   어제의 사실이 오늘의 화면에 뜬다.
      return reply.header('cache-control', 'no-store').send({ nts, duplicate, nameDuplicate });
    },
  );

  // ── 등록 (계약 폼을 companyId 없이 열었을 때) ───────────────────────────
  /**
   * 새 입주사를 만든다. `[신규 입주사 등록]` → `/contracts/new` 의 첫 저장이 여기다.
   *
   * ★★ **삐용 호출은 없다.** ERP 테이블 한 행만 만든다. 삐용 조직 등록·단체코드 발급은
   *    3-2 에서 이 자리에 얹는다(ROADMAP 페이즈 4 작업 15). 지금 반쪽만 붙여 두면
   *    「ERP 에는 있는데 삐용에는 없는 회사」가 생기고, 그 상태를 되돌릴 화면이 없다.
   *
   * ★ 회사명이 비어도 막지 않는다 — `PATCH` 와 같은 이유다(아래 주석).
   *
   * ★ `buildId` 는 막는다. `NOT NULL` 인데 FK 가 없어서 틀린 값이 조용히 들어가고,
   *   그 회사의 구성원·계약이 전부 그 값을 물려받는다(`replaceMembers`).
   */
  app.post<{ Body: CompanyBody & { buildId?: string } }>('/companies', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const buildId = text(req.body?.buildId);
    if (!buildId) {
      return reply.code(400).send({ error: 'invalid_request', message: '건물을 지정해야 합니다' });
    }

    const companyId = randomUUID();
    const actor = String(session.s020MemberId);

    /**
     * ★ UNIQUE 위반을 **트랜잭션 밖에서** 받는다. 안에서 삼키면 `withCompanyScope` 가
     *   COMMIT 을 부르는데, 그 시점의 트랜잭션은 이미 abort 상태다. Postgres 가
     *   조용히 롤백해 주긴 하지만 「성공 경로로 COMMIT 을 부르는 실패」는 읽는 사람을
     *   속인다. 던져서 `withCompanyScope` 의 ROLLBACK 을 그대로 태운다.
     */
    let result: 'ok' | 'no_build';
    try {
      result = await withCompanyScope(scopeOf(session), async (client) => {
        if (!(await buildExists(client, buildId))) return 'no_build' as const;
        await insertCompany(client, {
          companyId,
          buildId,
          actor,
          patch: {
            companyName: text(req.body?.companyName),
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
    } catch (err) {
      // ★ `biz_number` 는 UNIQUE 다. 이미 등록된 번호로 신규 등록하면 여기로 온다 —
      //   운영자가 실제로 하는 일이다(같은 회사를 두 번 등록). 그대로 두면
      //   「서버 오류가 났습니다」가 뜨고, 운영자는 무엇을 고쳐야 하는지 알 수 없다.
      if (isUniqueViolation(err)) {
        return reply.code(409).send({
          error: 'duplicate',
          message: '이미 등록된 사업자등록번호입니다. 입주사 목록에서 찾아 주세요',
        });
      }
      throw err;
    }

    if (result === 'no_build') {
      return reply.code(400).send({ error: 'invalid_request', message: '없는 건물입니다' });
    }
    return reply.code(201).send({ companyId });
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

    /**
     * ★ 등록(POST)과 **같은 자리에서 같은 모양으로** 받는다. `biz_number` 는 UNIQUE 라
     *   남의 번호로 고치면 여기서 23505 가 난다 — 운영자가 실제로 하는 일이다(번호를
     *   잘못 옮겨 적었다가 고치는 중에 이미 있는 회사의 번호를 친다).
     *
     * ★★ try/catch 가 `withCompanyScope` **밖**이어야 한다. 안에서 삼키면 이미 abort 된
     *   트랜잭션에 COMMIT 을 부른다 — 등록 쪽 주석에 그 이유가 적혀 있다.
     */
    /**
     * ★ 회사명이 **실제로 바뀌었는지**를 들고 나온다 — 바뀐 때만 삐용에 수정을 보낸다.
     *   매번 보내면 연락처만 고친 요청에도 삐용 호출이 나가고, 삐용이 그것을 어떻게
     *   취급하는지는 규격에 없다.
     */
    let result: { kind: 'ok'; nameChanged: boolean } | { kind: 'not_found' };
    try {
      result = await withCompanyScope(scopeOf(session), async (client) => {
        const company = await findCompany(client, req.params.id);
        if (!company) return { kind: 'not_found' } as const;
        // ★ 빈 이름은 `updateCompany` 가 무시한다 — 그때는 바뀐 것이 아니다.
        const nameChanged = companyName !== null && companyName !== company.company_name;

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
        return { kind: 'ok', nameChanged } as const;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({
          error: 'duplicate',
          message: '이미 등록된 사업자등록번호입니다. 입주사 목록에서 찾아 주세요',
        });
      }
      throw err;
    }

    if (result.kind === 'not_found') return notFound(reply);

    /*
     * ★★ 삐용 회사명 수정 — **트랜잭션이 커밋된 뒤다**(등록·퇴실과 같은 이유).
     *    연결되지 않은 입주사면 `patchOrgName` 이 보내지 않는다(`skipped`).
     *    실패해도 ERP 수정은 그대로다 — 「연동 대기」로 남고 [다시 시도] 가 있다.
     */
    const bbiyong = result.nameChanged
      ? await patchOrgForCompany({ companyId: req.params.id, session, actor })
      : null;

    return reply.send({
      companyId: req.params.id,
      /** 삐용 반영 결과. 회사명이 안 바뀌었으면 null. `pending` 이면 화면이 배너를 띄운다. */
      bbiyong: bbiyong?.kind ?? null,
      bbiyongReason: bbiyong?.kind === 'pending' ? bbiyong.reason : null,
    });
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

  // ── 삐용 연동 다시 시도 (3-2) ───────────────────────────────────────────
  /**
   * 실패한 삐용 연동을 **다시 시도한다** — 등록 · 퇴실 · 재입주.
   *
   * =============================================================================
   * ★★ 「한 업무는 한 화면에서」 — 이 API 를 부르는 화면은 **계약 폼 하나다**
   * =============================================================================
   * 삐용 회사 생성은 **계약 확정의 뒷부분**이고, 계약 확정을 누르는 자리는 계약 폼
   * (`s030200040`)이다. 그래서 [다시 시도] 버튼도 거기에만 둔다. 입주사 목록
   * (`s030200030`)은 「삐용 미연동」을 **보여 주기만** 하고 계약으로 링크한다
   * (프로젝트 규칙 `CLAUDE.md`).
   *
   * ★ 이 라우트가 회사 하위 경로인 것은 **대상이 회사**이기 때문이다. 화면의 자리와는
   *   다른 이야기다 — 연결은 `tb_s080_companies` 한 행에 붙는다.
   *
   * ★★ **버튼 하나가 「지금 필요한 것」을 한다**(결정 2026-10-03). 회사의 지금 상태를
   *    보고 고른다 — 버튼을 셋으로 늘리지 않는다:
   *
   *      연결 안 됨            → 등록 (채번부터)
   *      연결됨 + 살아 있는 계약 있음 → 재입주 (회사를 다시 만들지 않는다)
   *      연결됨 + 살아 있는 계약 없음 → 퇴실
   *
   *    회사명 수정은 여기서 고르지 않는다 — 「이름이 달라졌는가」는 삐용에 물어야 알고,
   *    ERP 는 마지막으로 보낸 이름을 적지 않는다. 이름은 **바뀌는 순간** 보낸다
   *    (`PATCH /companies/:id`).
   *
   * ★★ 등록은 **멱등이다.** 이미 연결된 회사에 등록을 또 하지 않는다 — 두 번 눌러 회사가
   *    둘 만들어지는 일이 없다(`linkOrg` ⑤). 퇴실·재입주를 두 번 보내면 삐용이 거부하고,
   *    그 거부가 사유로 남는다 — ERP 가 미리 막지 않는다(사본을 두지 않는다).
   *
   * ★ **계약이 확정됐는지 여기서 보지 않는다.** 확정 없이 부르면 회사가 만들어지는데,
   *   그건 이 API 를 직접 부르는 경로뿐이고 운영사 계정이 필요하다. 막지 않는 이유는
   *   「확정했는데 연동만 실패한 회사」를 되살리는 것이 이 API 의 목적이고, 확정 여부를
   *   조건으로 걸면 계약이 그 뒤에 종료된 회사를 되살릴 수 없게 되기 때문이다.
   */
  app.post<{ Params: { id: string } }>('/companies/:id/bbiyong-link', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await retryBbiyongForCompany({
      companyId: req.params.id,
      session,
      actor: String(session.s020MemberId),
    });

    if (result.kind === 'not_found') return notFound(reply);

    // ★ `pending` 도 200 이다. 요청 처리는 정상으로 끝났고, 결과가 「아직」인 것이다 —
    //   4xx/5xx 로 내리면 화면이 오류 배너를 띄우고 사유를 보여줄 자리를 잃는다.
    return reply.send({
      companyId: req.params.id,
      bbiyong: result.kind,
      orgId: result.kind === 'linked' || result.kind === 'already' ? result.orgId : null,
      orgCode: result.kind === 'linked' ? result.orgCode : null,
      reason: result.kind === 'pending' ? result.reason : null,
    });
  });
}
