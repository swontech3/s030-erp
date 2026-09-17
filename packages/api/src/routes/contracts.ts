/**
 * 계약 라우트 — 4-3.
 *
 * 판정은 전부 `@swonbiz/shared/domain` 의 순수 함수가 한다. 이 파일은 **배선만** 한다 —
 * 세션에서 스코프를 꺼내고, 트랜잭션을 열고, 함수가 던진 것을 HTTP 코드로 바꾼다.
 * 규칙을 여기에 한 줄이라도 다시 쓰면 그 순간 두 벌이 된다.
 *
 * =============================================================================
 * ★★ 계약 쓰기는 운영사 전용이다 (CONT-18)
 * =============================================================================
 * 계약 등록·수정·상태 전이는 운영사 업무다. 입주사 세션은 **조회만** 한다.
 * 화면에서 버튼을 감추는 것이 아니라 여기서 403 으로 막는다.
 *
 * =============================================================================
 * ★ 없는 계약과 볼 수 없는 계약을 구분하지 않는다
 * =============================================================================
 * RLS 가 거른 뒤라 남의 계약은 애초에 0행으로 온다. 그대로 404 로 답한다 —
 * 403 으로 답하면 "그 ID 의 계약은 존재한다"를 알려 주는 셈이다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  assertTransition,
  isContractLocked,
} from '@swonbiz/shared/domain/contract-status';
import {
  buildContractWrite,
  type ContractInput,
} from '@swonbiz/shared/domain/contract-payload';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  findContract,
  findSpaces,
  insertContract,
  insertStatusHistory,
  listContracts,
  replaceSpaces,
  updateContract,
  updateStatus,
  type ContractRow,
  type ContractSpaceRow,
} from '../db/contracts.ts';

/** 계약을 쓸 수 있는 역할. 조회는 입주사도 한다. */
const WRITE_ROLE = 'operator';

interface ContractBody {
  companyId?: string;
  buildId?: string;
  contractRoom?: string | null;
  paymentMethod?: string;
  accessRoute?: string | null;
  contractDate?: string | null;
  periodMonths?: number;
  startDate?: string;
  memo?: string | null;
  status?: string;
  spaces?: unknown[];
}

interface StatusBody {
  to?: string;
  terminatedDate?: string | null;
  terminationReason?: string | null;
}

/**
 * 화면이 보낸 날짜 문자열 → `Date`.
 *
 * ★ **UTC 자정으로 고정한다.** `new Date('2026-03-01')` 은 UTC 로 읽히지만
 *   `new Date('2026-03-01T00:00')` 은 로컬로 읽힌다 — 형식 하나에 하루가 밀린다.
 *   계약 시작일이 하루 밀리면 종료일과 첫 청구월이 함께 밀린다.
 */
function parseDate(value: unknown, label: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new RangeError(`${label} 는 YYYY-MM-DD 형식이어야 한다: ${String(value)}`);
  }
  const parts = value.slice(0, 10).split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // ★ 형식만 맞고 값이 없는 날짜(2026-02-31)를 통과시키지 않는다. Date.UTC 는 그런
  //   값을 조용히 다음 달로 넘긴다 — 계약 시작일이 말없이 바뀌는 자리다.
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError(`${label} 가 없는 날짜다: ${value}`);
  }
  return parsed;
}

/** 본문 → 순수 함수가 받는 모양. 형식 오류는 여기서, 규칙 위반은 도메인에서 걸린다. */
function toContractInput(body: ContractBody): ContractInput {
  return {
    buildId: String(body.buildId ?? ''),
    contractRoom: body.contractRoom ?? null,
    paymentMethod: String(body.paymentMethod ?? ''),
    accessRoute: body.accessRoute ?? null,
    contractDate: body.contractDate ?? null,
    periodMonths: Number(body.periodMonths),
    startDate: parseDate(body.startDate, '시작일'),
    memo: body.memo ?? null,
    spaces: (body.spaces ?? []) as ContractInput['spaces'],
  };
}

const scopeOf = (session: { role: string; companyId: string | null }): CompanyScope => ({
  role: session.role as CompanyScope['role'],
  companyId: session.companyId,
});

/** 응답 모양 — DB 의 snake_case 를 그대로 내보내지 않는다. */
function toResponse(contract: ContractRow, spaces: ContractSpaceRow[]) {
  return {
    contractId: contract.contract_id,
    companyId: contract.company_id,
    buildId: contract.build_id,
    status: contract.status,
    contractNo: contract.contract_no,
    contractRoom: contract.contract_room,
    paymentMethod: contract.payment_method,
    accessRoute: contract.access_route,
    firstPayment: contract.first_payment,
    contractDate: contract.contract_date,
    periodMonths: contract.period_months,
    startDate: contract.start_date,
    endDate: contract.end_date,
    terminatedDate: contract.terminated_date,
    terminationReason: contract.termination_reason,
    memo: contract.memo,
    spaces: spaces.map((s) => ({
      seq: s.seq,
      roomType: s.room_type,
      spaceId: s.space_id,
      standardFee: s.standard_fee,
      deposit: s.deposit,
      monthlyFee: s.monthly_fee,
      vatYn: s.vat_yn,
      vatAmount: s.vat_amount,
      paymentAmount: s.payment_amount,
      lockerNo: s.locker_no,
    })),
  };
}

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: 'not_found', message: '계약을 찾을 수 없습니다' });

/** 도메인 함수가 던진 `RangeError` 는 사용자 입력 문제다 — 400 으로 바꾼다. */
function asBadRequest(err: unknown, reply: FastifyReply): FastifyReply | never {
  if (err instanceof RangeError) {
    return reply.code(400).send({ error: 'invalid_request', message: err.message });
  }
  throw err;
}

export function registerContractRoutes(app: FastifyInstance): void {
  // ── 목록 ────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { companyId?: string } }>('/contracts', async (req, reply) => {
    const session = requireSession(req);
    const rows = await withCompanyScope(scopeOf(session), (client) =>
      listContracts(client, req.query?.companyId ?? null),
    );
    return reply.send({ contracts: rows.map((r) => toResponse(r, [])) });
  });

  // ── 단건 조회 ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/contracts/:id', async (req, reply) => {
    const session = requireSession(req);
    const found = await withCompanyScope(scopeOf(session), async (client) => {
      const contract = await findContract(client, req.params.id);
      if (!contract) return null;
      return { contract, spaces: await findSpaces(client, req.params.id) };
    });
    if (!found) return notFound(reply);
    return reply.send(toResponse(found.contract, found.spaces));
  });

  // ── 등록 ────────────────────────────────────────────────────────────────
  app.post<{ Body: ContractBody }>('/contracts', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) {
      return reply.code(403).send({ error: 'forbidden', message: '계약 등록은 운영사만 할 수 있습니다' });
    }
    const companyId = String(req.body?.companyId ?? '');
    if (!companyId) {
      return reply.code(400).send({ error: 'invalid_request', message: '입주사를 지정해야 합니다' });
    }

    // ★ 첫 저장이 draft 일 수도 confirmed 일 수도 있다(04-status.md: create → 둘 다).
    const status = req.body?.status ?? 'draft';
    let write;
    try {
      assertTransition(null, status);
      write = buildContractWrite(toContractInput(req.body ?? {}));
    } catch (err) {
      return asBadRequest(err, reply);
    }

    const contractId = randomUUID();
    const actor = String(session.s020MemberId);

    await withCompanyScope(scopeOf(session), async (client) => {
      await insertContract(client, { contractId, companyId, status, write: write.contract, actor });
      await replaceSpaces(client, { contractId, companyId, spaces: write.spaces, actor, newId: randomUUID });
      // 최초 생성도 이력이다. from_status 가 NULL 인 행이 그것이다.
      await insertStatusHistory(client, {
        historyId: randomUUID(), contractId, fromStatus: null, toStatus: status, actor,
      });
    });

    if (write.warnings.length > 0) {
      // ★ 끄지 말 것. 프런트가 Math.round 를 쓰는 동안 계속 뜬다 — 그게 이 경고의 목적이다.
      req.log.warn({ contractId, mismatches: write.warnings }, '화면 금액이 서버 계산과 어긋났다 — 서버 값을 저장했다');
    }
    return reply.code(201).send({ contractId, status, warnings: write.warnings });
  });

  // ── 섹션2 수정 ──────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: ContractBody }>('/contracts/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) {
      return reply.code(403).send({ error: 'forbidden', message: '계약 수정은 운영사만 할 수 있습니다' });
    }

    let write;
    try {
      write = buildContractWrite(toContractInput(req.body ?? {}));
    } catch (err) {
      return asBadRequest(err, reply);
    }

    const actor = String(session.s020MemberId);
    const result = await withCompanyScope(scopeOf(session), async (client) => {
      const contract = await findContract(client, req.params.id);
      if (!contract) return 'not_found' as const;

      // ★★ CONT-09 — 여기가 잠금의 실제 지점이다. 화면 비활성화가 아니라 이 줄이다.
      if (isContractLocked(contract.status)) return 'locked' as const;

      await updateContract(client, { contractId: contract.contract_id, write: write.contract, actor });
      await replaceSpaces(client, {
        contractId: contract.contract_id,
        companyId: contract.company_id,
        spaces: write.spaces,
        actor,
        newId: randomUUID,
      });
      return 'ok' as const;
    });

    if (result === 'not_found') return notFound(reply);
    if (result === 'locked') {
      return reply.code(409).send({
        error: 'contract_locked',
        message: '확정된 계약의 조건은 변경할 수 없습니다. 종료 후 재계약해 주세요',
      });
    }
    return reply.send({ contractId: req.params.id, warnings: write.warnings });
  });

  // ── 상태 전이 ───────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: StatusBody }>('/contracts/:id/status', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) {
      return reply.code(403).send({ error: 'forbidden', message: '상태 변경은 운영사만 할 수 있습니다' });
    }
    const to = String(req.body?.to ?? '');
    const actor = String(session.s020MemberId);

    let terminatedDate: Date | null = null;
    try {
      if (req.body?.terminatedDate) terminatedDate = parseDate(req.body.terminatedDate, '종료일');
    } catch (err) {
      return asBadRequest(err, reply);
    }

    const result = await withCompanyScope(scopeOf(session), async (client) => {
      const contract = await findContract(client, req.params.id);
      if (!contract) return { kind: 'not_found' as const };

      // ★★ CONT-08 — 화이트리스트. 화면 버튼과 무관하게 여기서 막힌다.
      try {
        assertTransition(contract.status, to);
      } catch (err) {
        return { kind: 'rejected' as const, message: (err as Error).message };
      }

      await updateStatus(client, {
        contractId: contract.contract_id,
        toStatus: to,
        terminatedDate,
        terminationReason: req.body?.terminationReason ?? null,
        actor,
      });
      // 같은 트랜잭션이다 — 전이만 남고 이력이 빠지는 일이 없다.
      await insertStatusHistory(client, {
        historyId: randomUUID(),
        contractId: contract.contract_id,
        fromStatus: contract.status,
        toStatus: to,
        actor,
      });
      return { kind: 'ok' as const };
    });

    if (result.kind === 'not_found') return notFound(reply);
    if (result.kind === 'rejected') {
      return reply.code(400).send({ error: 'invalid_transition', message: result.message });
    }
    return reply.send({ contractId: req.params.id, status: to });
  });
}
