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
  ROOM_LIVE_STATUSES,
  ROOM_TAKEN_MESSAGE,
  findRoomConflict,
  normalizeRoom,
  sortRoomHolders,
  type RoomHolder,
} from '@swonbiz/shared/domain/contract-room';
import {
  buildContractWrite,
  type ContractInput,
} from '@swonbiz/shared/domain/contract-payload';
import { missingDocsMessage } from '@swonbiz/shared/domain/contract-files';
import {
  OCCUPANCY_LIVE_STATUSES,
  occupancyBySpace,
  rejectSpacePick,
  type SpaceHolder,
} from '@swonbiz/shared/domain/space-occupancy';
import { requireSession } from '../session/hook.ts';
import { findCompany } from '../db/companies.ts';
import { listSpaces } from '../db/lookups.ts';
import { listCompanyFiles } from '../db/files.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  findContract,
  findSpaces,
  insertContract,
  insertStatusHistory,
  listContracts,
  listRoomHolders,
  listSpaceHolders,
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

/**
 * 계약호실이 이미 쓰이고 있으면 그 계약을 돌려준다. 통과면 `null`.
 *
 * ★★ **화면과 같은 함수**(`findRoomConflict`)로 본다. 화면은 팝업에서 [확인] 을
 *    막지만 화면은 우회할 수 있다. 이 번호는 **세무서에 내는 번호**라 우리 DB 안에서
 *    끝나는 문제가 아니다 — 두 계약이 같은 번호로 제출되면 밖에서 사고가 난다.
 *
 * ★ 저장 트랜잭션 **안에서** 부른다. 밖에서 미리 보면 그 사이에 다른 요청이
 *   같은 번호를 넣을 수 있다.
 */
async function roomConflict(
  client: Parameters<typeof listRoomHolders>[0],
  room: string | null,
  selfContractId: string | null,
): Promise<RoomHolder | null> {
  if (normalizeRoom(room) === '') return null;
  const rows = await listRoomHolders(client, ROOM_LIVE_STATUSES);
  const holders: RoomHolder[] = rows.map((r) => ({
    contractId: r.contract_id,
    companyName: r.company_name,
    room: r.contract_room,
  }));
  return findRoomConflict(holders, normalizeRoom(room), selfContractId);
}

/**
 * 계약확정에 빠진 필수 서류가 있으면 **사람에게 할 말**을 돌려준다. 통과면 `null`.
 *
 * ★★ **화면과 같은 함수**(`missingDocsMessage`)로 본다. 화면은 [계약확정] 을 막지만
 *    화면은 우회할 수 있다 — 서류 없이 확정된 계약은 나중에 아무도 알아채지 못한다.
 *
 * ★ **임시저장(`draft`)에서는 부르지 않는다.** 사업자등록 신청 중인 회사는 등록증이
 *   아직 없고, 그 상태로 자리를 잡아 두는 것이 계약대기의 쓸모다.
 *
 * ★ 회사를 못 찾으면 회원구분을 `''` 로 본다 — 신분증만 필수가 되고, 없으면 막힌다.
 *   모르는 상태에서 통과시키지 않는다(fail-closed).
 */
async function missingDocs(
  client: Parameters<typeof listCompanyFiles>[0],
  companyId: string,
): Promise<string | null> {
  const company = await findCompany(client, companyId);
  const files = await listCompanyFiles(client, companyId);
  return missingDocsMessage(
    company?.member_type ?? '',
    files.map((f) => f.file_purpose),
  );
}

const docsMissing = (reply: FastifyReply, message: string) =>
  reply.code(409).send({ error: 'docs_missing', message });

/**
 * 호실 줄을 받아도 되는지 — 통과면 `null`, 아니면 **사용자에게 보여줄 문구**.
 *
 * ★★ **화면과 같은 함수**(`rejectSpacePick`)로 본다. 셀렉트에서 사라진 호실이 API 로는
 *    들어가면 막은 의미가 없다.
 *
 * ★ **저장 트랜잭션 안에서** 부른다. 밖에서 미리 보면 그 사이에 다른 요청이 같은
 *   호실을 채울 수 있다.
 *
 * ★ `selfContractId` — 자기 계약이 잡고 있는 호실은 자기 것으로 세지 않는다.
 *   안 그러면 열어서 그대로 저장하는 것조차 막힌다.
 */
async function spaceConflict(
  client: Parameters<typeof listSpaceHolders>[0],
  rows: readonly { roomType: string; spaceId: string }[],
  selfContractId: string | null,
): Promise<string | null> {
  if (rows.every((r) => r.spaceId === '')) return null;

  const [holderRows, spaceRows] = await Promise.all([
    listSpaceHolders(client, OCCUPANCY_LIVE_STATUSES),
    listSpaces(client),
  ]);
  const holders: SpaceHolder[] = holderRows.map((r) => ({
    spaceId: r.space_id,
    contractId: r.contract_id,
    companyId: r.company_id,
    companyName: r.company_name,
  }));
  const names = new Map(spaceRows.map((s) => [s.space_id, s.room_name ?? '']));

  return rejectSpacePick(
    rows,
    occupancyBySpace(holders, selfContractId),
    (id) => names.get(id) ?? '',
  );
}

const spaceTaken = (reply: FastifyReply, message: string) =>
  reply.code(409).send({ error: 'space_taken', message });

const roomTaken = (reply: FastifyReply, conflict: RoomHolder) =>
  reply.code(409).send({
    error: 'room_taken',
    // ★ 어느 회사가 쓰고 있는지까지 말한다 — 「이미 사용 중」만으로는 무엇을 해야
    //   할지 알 수 없다. 운영사만 부르는 API 라 회사명을 말해도 된다.
    message: `${ROOM_TAKEN_MESSAGE} (${conflict.companyName})`,
  });

export function registerContractRoutes(app: FastifyInstance): void {
  /* ── 계약호실 조회 팝업 (s0300200040p3) ─────────────────────────────────
     ★ 운영사 전용이다. 이 목록은 **어느 회사가 어느 호실을 쓰는지**를 통째로 내려
       준다 — 입주사가 볼 것이 아니다(명부 유출과 같은 모양).
     ★ 아무것도 저장하지 않는다. */
  app.get('/contracts/rooms', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) {
      return reply
        .code(403)
        .send({ error: 'forbidden', message: '계약호실 조회는 운영사만 할 수 있습니다' });
    }

    const rows = await withCompanyScope(scopeOf(session), (client) =>
      listRoomHolders(client, ROOM_LIVE_STATUSES),
    );
    // 정렬도 **화면과 같은 함수**다 — 팝업이 다시 정렬하지 않아도 되고, 둘이 갈리지도 않는다.
    const rooms = sortRoomHolders(
      rows.map((r) => ({
        contractId: r.contract_id,
        companyName: r.company_name,
        room: r.contract_room,
      })),
    );
    return reply.header('cache-control', 'no-store').send({ rooms });
  });

  /* ── 호실 입주 현황 (섹션 2 호실 셀렉트) ────────────────────────────────
     ★ 운영사 전용이다. **어느 회사가 어느 호실에 있는지**를 통째로 내려 준다 —
       입주사가 볼 것이 아니다(명부 유출과 같은 모양).
     ★ 자기 계약을 빼는 것은 **화면이 한다**(`occupancyBySpace`). 여기서 빼면
       같은 목록을 부르는 곳마다 SQL 이 달라진다.
     ★ 아무것도 저장하지 않는다. */
  app.get('/contracts/space-holders', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== WRITE_ROLE) {
      return reply
        .code(403)
        .send({ error: 'forbidden', message: '호실 입주 현황은 운영사만 조회할 수 있습니다' });
    }

    const rows = await withCompanyScope(scopeOf(session), (client) =>
      listSpaceHolders(client, OCCUPANCY_LIVE_STATUSES),
    );
    const holders: SpaceHolder[] = rows.map((r) => ({
      spaceId: r.space_id,
      contractId: r.contract_id,
      companyId: r.company_id,
      companyName: r.company_name,
    }));
    return reply.header('cache-control', 'no-store').send({ holders });
  });

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

    const created = await withCompanyScope(scopeOf(session), async (client) => {
      // ★ 트랜잭션 **안에서** 본다. 밖에서 미리 보면 그 사이에 다른 요청이 같은
      //   번호를 넣을 수 있다. 새 계약이라 제외할 자기 자신이 없다.
      const conflict = await roomConflict(client, write.contract.contractRoom, null);
      if (conflict) return { kind: 'room_taken' as const, conflict };

      // ★ 새 계약이라 제외할 자기 자신이 없다.
      const spaceMessage = await spaceConflict(client, write.spaces, null);
      if (spaceMessage) return { kind: 'space_taken' as const, message: spaceMessage };

      // ★ 첫 저장이 바로 확정일 수 있다(create → confirmed). 그 길도 서류를 본다.
      if (status === 'confirmed') {
        const message = await missingDocs(client, companyId);
        if (message) return { kind: 'docs_missing' as const, message };
      }

      await insertContract(client, { contractId, companyId, status, write: write.contract, actor });
      await replaceSpaces(client, { contractId, companyId, spaces: write.spaces, actor, newId: randomUUID });
      // 최초 생성도 이력이다. from_status 가 NULL 인 행이 그것이다.
      await insertStatusHistory(client, {
        historyId: randomUUID(), contractId, fromStatus: null, toStatus: status, actor,
      });
      return { kind: 'ok' as const };
    });

    if (created.kind === 'room_taken') return roomTaken(reply, created.conflict);
    if (created.kind === 'docs_missing') return docsMissing(reply, created.message);
    if (created.kind === 'space_taken') return spaceTaken(reply, created.message);

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
      if (!contract) return { kind: 'not_found' as const };

      // ★★ CONT-09 — 여기가 잠금의 실제 지점이다. 화면 비활성화가 아니라 이 줄이다.
      if (isContractLocked(contract.status)) return { kind: 'locked' as const };

      // ★ 자기 자신은 제외한다. 안 그러면 **아무도 자기 계약을 수정할 수 없다** —
      //   열어서 그대로 저장해도 자기 번호가 걸린다.
      const conflict = await roomConflict(client, write.contract.contractRoom, contract.contract_id);
      if (conflict) return { kind: 'room_taken' as const, conflict };

      // ★ 자기 계약은 세지 않는다 — 열어서 그대로 저장하는 것까지 막히면 안 된다.
      const spaceMessage = await spaceConflict(client, write.spaces, contract.contract_id);
      if (spaceMessage) return { kind: 'space_taken' as const, message: spaceMessage };

      await updateContract(client, { contractId: contract.contract_id, write: write.contract, actor });
      await replaceSpaces(client, {
        contractId: contract.contract_id,
        companyId: contract.company_id,
        spaces: write.spaces,
        actor,
        newId: randomUUID,
      });
      return { kind: 'ok' as const };
    });

    if (result.kind === 'room_taken') return roomTaken(reply, result.conflict);
    if (result.kind === 'space_taken') return spaceTaken(reply, result.message);
    if (result.kind === 'not_found') return notFound(reply);
    if (result.kind === 'locked') {
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

      // ★★ 확정에만 건다. 취소·종료는 서류와 무관하다 — 오히려 서류가 없는 계약일수록
      //    정리돼야 하는데, 여기서 막으면 잘못 만든 계약을 닫을 수가 없다.
      if (to === 'confirmed') {
        const message = await missingDocs(client, contract.company_id);
        if (message) return { kind: 'docs_missing' as const, message };
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
    if (result.kind === 'docs_missing') return docsMissing(reply, result.message);
    if (result.kind === 'rejected') {
      return reply.code(400).send({ error: 'invalid_transition', message: result.message });
    }
    return reply.send({ contractId: req.params.id, status: to });
  });
}
