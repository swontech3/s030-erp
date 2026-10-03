/**
 * 센터 관리(s030100010) 라우트 — 건물 · 층 · 호실 · 회의실.
 *
 * =============================================================================
 * ★★ 운영사 전용이다
 * =============================================================================
 * 센터·호실·요금은 운영사의 자산이고 입주사가 볼 자료가 아니다. 모든 핸들러가 첫 줄에서
 * `session.role !== 'operator'` 를 403 으로 막는다 — **화면이 아니라 여기가 막는 자리다.**
 * 주소를 직접 쳐서 들어와도 데이터가 나가지 않는다.
 *
 * =============================================================================
 * ★★★ 쓰고 있는 것은 지울 수 없다 — **이유를 문구로 돌려준다**
 * =============================================================================
 * 이 네 표에는 FK 가 없다(`db/facility.ts` 머리말). 그래서 지우기 전에 세고, 막을 때는
 * **사람이 읽는 문구**를 409 로 돌려준다 — 「계약 3건에서 사용한 호실입니다」처럼 몇 건인지
 * 적고, 대안(「사용 안 함」)까지 한 문장에 담는다.
 *
 * ★ 409 인 이유: 요청이 틀린 것이 아니라(400) **지금 상태와 충돌**하는 것이다. 화면은
 *   이 코드를 보고 오류가 아니라 안내로 그린다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import {
  countBuildingUsage,
  countFacilityUsage,
  countFloorUsage,
  countSpaceCompanies,
  countSpaceUsage,
  deleteBuilding,
  deleteFacility,
  deleteFloor,
  deleteSpace,
  insertBuilding,
  insertFacility,
  insertFloor,
  insertSpace,
  listBuildings,
  listFacilitiesOfFloor,
  listFloors,
  listSpacesOfFloor,
  newRoomNo,
  updateBuilding,
  updateFacility,
  updateFloor,
  updateSpace,
  type BuildingRow,
  type FacilityRow,
  type FloorRow,
  type SpaceAdminRow,
} from '../db/facility.ts';
import {
  deleteFile,
  findFile,
  listFiles,
  operatorIdForBuilding,
  operatorIdForFloor,
  replaceFile,
  type FileRow,
  type FileTarget,
} from '../db/files.ts';
import { SPACE_STATUS } from '../db/spaceStatus.ts';
import { putObject, removeObject, signedUrl, StorageError } from '../lib/storage.ts';
import {
  FACILITY_PURPOSE,
  FILE_TARGET_BUILDING,
  FILE_TARGET_FLOOR,
  facilityStoragePathFor,
  rejectFacilityUpload,
  type FacilityTarget,
} from '@swonbiz/shared/domain/facility-files';
import {
  DEFAULT_MAX_COMPANIES,
  MIN_MAX_COMPANIES,
} from '@swonbiz/shared/domain/space-occupancy';

const OPERATOR = 'operator';

/**
 * 스코프는 **항상 운영사**다.
 *
 * ★ 역할 검사를 통과한 뒤에만 쓰이므로 세션의 역할을 다시 읽지 않는다. 입주사 스코프로
 *   이 표들을 읽으면 RLS 가 없는 표라 결과가 같아 보이지만, 경로가 둘이 되는 것이 문제다.
 */
const OPERATOR_SCOPE: CompanyScope = { role: 'operator', companyId: null };

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '센터 관리는 운영사만 다룰 수 있습니다' });

const notFound = (reply: FastifyReply, what: string) =>
  reply.code(404).send({ error: 'not_found', message: `${what}을 찾을 수 없습니다` });

/** 쓰고 있어서 못 지운다. ★ `message` 는 화면이 그대로 보여 주는 문구다. */
const inUse = (reply: FastifyReply, message: string) =>
  reply.code(409).send({ error: 'in_use', message });

const badRequest = (reply: FastifyReply, message: string) =>
  reply.code(400).send({ error: 'invalid_request', message });

/** 빈 문자열은 `null` 로. 화면이 칸을 비운 것과 안 보낸 것을 가르지 않는다. */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** 숫자 칸. 콤마가 섞여 와도 받는다 — 화면이 `1,000,000` 으로 보여 주기 때문이다. */
function int(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v !== 'string') return null;
  const t = v.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** 평수는 `numeric` 이다 — 소수를 버리지 않으려고 문자열로 넘긴다. */
function decimal(v: unknown): string | null {
  const t = typeof v === 'number' ? String(v) : text(v);
  if (t === null) return null;
  return /^-?\d+(\.\d+)?$/.test(t.replace(/,/g, '')) ? t.replace(/,/g, '') : null;
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** `YYYY-MM-DD` 만 받는다. 그 밖은 null — 날짜를 짐작하지 않는다. */
function day(v: unknown): string | null {
  const t = text(v);
  return t !== null && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

const toBuilding = (r: BuildingRow) => ({
  buildId: r.build_id,
  name: r.name,
  address: r.address,
  ownerName: r.owner_name,
  ownerPhone: r.owner_phone,
  bizRegNo: r.biz_reg_no,
  contractFrom: r.contract_from ? r.contract_from.toISOString().slice(0, 10) : null,
  contractTo: r.contract_to ? r.contract_to.toISOString().slice(0, 10) : null,
  centerManager: r.center_manager,
  bankName: r.bank_name,
  bankAccount: r.bank_account,
  accountHolder: r.account_holder,
  memo: r.memo,
  isActive: r.is_active,
  floorCount: r.floor_count,
});

const toFloor = (r: FloorRow) => ({
  floorId: r.floor_id,
  buildingId: r.building_id,
  floorNo: r.floor_no,
  name: r.name,
  areaSqm: r.area_sqm,
  monthlyRent: r.monthly_rent,
  deposit: r.deposit,
  hasLounge: r.has_lounge,
  hasMeetingRoom: r.has_meeting_room,
  hasOaZone: r.has_oa_zone,
  spaceCount: r.space_count,
  facilityCount: r.facility_count,
});

const toSpace = (r: SpaceAdminRow) => ({
  spaceId: r.space_id,
  floorId: r.floor_id,
  /** ★ 기계값이다 — 화면은 보여 주지 않고 키로만 쓴다(`db/facility.ts`). */
  roomNo: r.room_no,
  roomName: r.room_name,
  roomType: r.room_type,
  status: r.status,
  bizAddrAvailable: r.biz_addr_available,
  standardFee: r.standard_fee,
  deposit: r.deposit,
  areaSqm: r.area_sqm,
  capacity: r.capacity,
  /** 「입주 가능 회사 수」 — p3 팝업의 칸이다. 호실 표에는 보이지 않는다. */
  maxCompanies: r.max_companies,
  memo: r.memo,
  isActive: r.is_active,
  /** 화면이 「지울 수 없음」을 **누르기 전에** 알려 주는 근거다. */
  liveContracts: r.live_contracts,
  allContracts: r.all_contracts,
});

const toFacility = (r: FacilityRow) => ({
  facilityId: r.facility_id,
  floorId: r.floor_id,
  name: r.name,
  capacity: r.capacity,
  halfHourFee: r.half_hour_fee,
  openTime: r.open_time,
  closeTime: r.close_time,
  minDuration: r.min_duration,
  maxDuration: r.max_duration,
  status: r.status,
  isReservable: r.is_reservable,
  liveReservations: r.live_reservations,
  allReservations: r.all_reservations,
});

interface BuildingBody {
  name?: string;
  address?: string;
  ownerName?: string;
  ownerPhone?: string;
  bizRegNo?: string;
  contractFrom?: string;
  contractTo?: string;
  centerManager?: string;
  bankName?: string;
  bankAccount?: string;
  accountHolder?: string;
  memo?: string;
}

interface FloorBody {
  buildingId?: string;
  floorNo?: string;
  name?: string;
  areaSqm?: string | number;
  monthlyRent?: string | number;
  deposit?: string | number;
  hasLounge?: boolean;
  hasMeetingRoom?: boolean;
  hasOaZone?: boolean;
}

interface SpaceBody {
  floorId?: string;
  roomName?: string;
  roomType?: string;
  status?: string;
  bizAddrAvailable?: boolean;
  standardFee?: string | number;
  deposit?: string | number;
  areaSqm?: string | number;
  capacity?: string | number;
  maxCompanies?: string | number;
  memo?: string;
  isActive?: boolean;
}

interface FacilityBody {
  floorId?: string;
  name?: string;
  capacity?: string | number;
  halfHourFee?: string | number;
  openTime?: string;
  closeTime?: string;
  minDuration?: string | number;
  maxDuration?: string | number;
  status?: string;
  isReservable?: boolean;
}

export function registerFacilityRoutes(app: FastifyInstance): void {
  /**
   * 화면이 한 번에 받는 것 — 건물 · 층 · 코드.
   *
   * ★ 호실·회의실은 층을 고른 뒤에 받는다. 72실이 전부 한 응답에 실리면 층을 옮길 때마다
   *   다 다시 보내게 된다.
   */
  app.get('/facility/tree', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const data = await withCompanyScope(OPERATOR_SCOPE, async (client) => ({
      buildings: await listBuildings(client),
      floors: await listFloors(client),
      /* 호실의 계약구분·상태. ★ 파티션은 `000`(공통) 이다 — `001` 의 「기타」는 쓰지 않는다. */
      codes: await listCodes(client, [
        { category: 'ROOM_TP', useTp: '000' },
        { category: 'ROOM_ST', useTp: '000' },
      ]),
    }));

    return reply.send({
      buildings: data.buildings.map(toBuilding),
      floors: data.floors.map(toFloor),
      codes: data.codes.map((c) => ({ category: c.category, code: c.code, name: c.name })),
    });
  });

  // ── 건물 ────────────────────────────────────────────────────────────────
  app.post<{ Body: BuildingBody }>('/facility/buildings', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const name = text(req.body?.name);
    if (!name) return badRequest(reply, '건물명을 입력해 주세요');

    const buildId = randomUUID();
    await withCompanyScope(OPERATOR_SCOPE, (client) =>
      insertBuilding(client, { buildId, patch: buildingPatch(req.body, name), actor: actorOf(session) }),
    );
    return reply.code(201).send({ buildId });
  });

  app.patch<{ Params: { id: string }; Body: BuildingBody }>('/facility/buildings/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const name = text(req.body?.name);
    if (!name) return badRequest(reply, '건물명을 입력해 주세요');

    const changed = await withCompanyScope(OPERATOR_SCOPE, (client) =>
      updateBuilding(client, {
        buildId: req.params.id,
        patch: buildingPatch(req.body, name),
        actor: actorOf(session),
      }),
    );
    if (changed === 0) return notFound(reply, '건물');
    return reply.send({ buildId: req.params.id });
  });

  app.delete<{ Params: { id: string } }>('/facility/buildings/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const use = await countBuildingUsage(client, req.params.id);
      /*
       * ★ 셋 중 하나라도 있으면 막는다. 입주사·계약은 `build_id` 로 건물에 달려 있어
       *   건물을 지우면 없는 건물을 가리킨다 — FK 가 없으니 조용히 그렇게 된다.
       */
      if (use.floors > 0 || use.companies > 0 || use.contracts > 0) {
        const parts = [
          use.floors > 0 ? `층 ${use.floors}개` : null,
          use.companies > 0 ? `입주사 ${use.companies}곳` : null,
          use.contracts > 0 ? `계약 ${use.contracts}건` : null,
        ].filter((v): v is string => v !== null);
        return { kind: 'in_use' as const, message: `${parts.join(' · ')}이 이 건물에 달려 있어 지울 수 없습니다. 먼저 정리해 주세요` };
      }
      const removed = await deleteBuilding(client, req.params.id);
      if (removed === 0) return { kind: 'not_found' as const };
      /* ★ 첨부(임대차계약서)도 같이 지운다 — 남겨 두면 없는 건물을 가리키는 기록이 된다. */
      return { kind: 'ok' as const, orphans: await purgeAttachments(client, FILE_TARGET_BUILDING, req.params.id) };
    });

    if (result.kind === 'not_found') return notFound(reply, '건물');
    if (result.kind === 'in_use') return inUse(reply, result.message);
    await dropObjects(req.log, result.orphans);
    return reply.send({ buildId: req.params.id, deleted: true });
  });

  // ── 층 ──────────────────────────────────────────────────────────────────
  app.post<{ Body: FloorBody }>('/facility/floors', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const buildingId = text(req.body?.buildingId);
    const floorNo = text(req.body?.floorNo);
    if (!buildingId) return badRequest(reply, '건물을 고르고 층을 추가해 주세요');
    if (!floorNo) return badRequest(reply, '층 번호를 입력해 주세요');

    const floorId = randomUUID();
    await withCompanyScope(OPERATOR_SCOPE, (client) =>
      insertFloor(client, { floorId, patch: floorPatch(req.body, buildingId, floorNo), actor: actorOf(session) }),
    );
    return reply.code(201).send({ floorId });
  });

  app.patch<{ Params: { id: string }; Body: FloorBody }>('/facility/floors/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const floorNo = text(req.body?.floorNo);
    if (!floorNo) return badRequest(reply, '층 번호를 입력해 주세요');

    const changed = await withCompanyScope(OPERATOR_SCOPE, (client) =>
      updateFloor(client, {
        floorId: req.params.id,
        /* ★ 건물은 바꾸지 않는다 — `updateFloor` 가 `building_id` 를 건드리지 않는다. */
        patch: floorPatch(req.body, '', floorNo),
        actor: actorOf(session),
      }),
    );
    if (changed === 0) return notFound(reply, '층');
    return reply.send({ floorId: req.params.id });
  });

  app.delete<{ Params: { id: string } }>('/facility/floors/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const use = await countFloorUsage(client, req.params.id);
      if (use.spaces > 0 || use.facilities > 0) {
        const parts = [
          use.spaces > 0 ? `호실 ${use.spaces}실` : null,
          use.facilities > 0 ? `회의실 ${use.facilities}개` : null,
        ].filter((v): v is string => v !== null);
        return { kind: 'in_use' as const, message: `${parts.join(' · ')}이 이 층에 있어 지울 수 없습니다. 먼저 정리해 주세요` };
      }
      const removed = await deleteFloor(client, req.params.id);
      if (removed === 0) return { kind: 'not_found' as const };
      /* ★ 첨부(층별 도면)도 같이 지운다 — 건물 삭제와 같은 이유다. */
      return { kind: 'ok' as const, orphans: await purgeAttachments(client, FILE_TARGET_FLOOR, req.params.id) };
    });

    if (result.kind === 'not_found') return notFound(reply, '층');
    if (result.kind === 'in_use') return inUse(reply, result.message);
    await dropObjects(req.log, result.orphans);
    return reply.send({ floorId: req.params.id, deleted: true });
  });

  // ── 호실 ────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/facility/floors/:id/spaces', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const rows = await withCompanyScope(OPERATOR_SCOPE, (client) => listSpacesOfFloor(client, req.params.id));
    return reply.send({ spaces: rows.map(toSpace) });
  });

  app.post<{ Body: SpaceBody }>('/facility/spaces', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const floorId = text(req.body?.floorId);
    const roomType = text(req.body?.roomType);
    if (!floorId) return badRequest(reply, '층을 고르고 호실을 추가해 주세요');
    if (!roomType) return badRequest(reply, '계약구분을 골라 주세요');

    const max = parseMaxCompanies(req.body?.maxCompanies);
    if (!max.ok) return badRequest(reply, max.message);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      /* ★ 호실은 건물에도 달려 있다(`build_id`) — 층에서 읽어 채운다. 화면이 보내지 않는다. */
      const floors = await listFloors(client);
      const floor = floors.find((f) => f.floor_id === floorId);
      if (!floor) return { kind: 'not_found' as const };

      const spaceId = randomUUID();
      await insertSpace(client, {
        spaceId,
        buildId: floor.building_id,
        floorId,
        roomNo: newRoomNo(),
        patch: spacePatch(req.body, roomType, max.value),
        actor: actorOf(session),
      });
      return { kind: 'ok' as const, spaceId };
    });

    if (result.kind === 'not_found') return notFound(reply, '층');
    return reply.code(201).send({ spaceId: result.spaceId });
  });

  app.patch<{ Params: { id: string }; Body: SpaceBody }>('/facility/spaces/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const roomType = text(req.body?.roomType);
    if (!roomType) return badRequest(reply, '계약구분을 골라 주세요');

    const max = parseMaxCompanies(req.body?.maxCompanies);
    if (!max.ok) return badRequest(reply, max.message);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      /*
       * ★★★ **지금 들어 있는 곳보다 적게 낮추지 못한다.**
       *
       * 낮추면 그 호실을 쓰는 계약을 **열어서 그대로 저장하는 것조차** 막힌다 —
       * 저장 검증은 자기 계약을 빼고 세므로, 2곳이 든 호실을 1곳으로 낮추면 두 계약
       * 모두 상대 1곳 때문에 거절된다. 셀렉트에는 (고른 값이라) 남아 있으니 바로
       * 「목록에 나오는데 저장이 막히는」 모양이 된다.
       *
       * ★ 세는 법이 판정과 같아야 한다 — `count(DISTINCT company_id)`
       *   (`countSpaceCompanies`) ↔ `occupancyBySpace`. 둘 다 회사로 접는다.
       *
       * ★ 같은 트랜잭션 안에서 보고 쓴다. 밖에서 미리 보면 그 사이에 계약이 들어온다.
       */
      const inUseNow = await countSpaceCompanies(client, req.params.id);
      if (max.value < inUseNow) {
        return {
          kind: 'too_low' as const,
          message:
            `지금 ${inUseNow}곳이 입주해 있어 입주 가능 회사 수를 ${max.value}곳으로 줄일 수 없습니다 — ` +
            `계약이 끝난 뒤에 줄여 주세요`,
        };
      }

      const changed = await updateSpace(client, {
        spaceId: req.params.id,
        patch: spacePatch(req.body, roomType, max.value),
        actor: actorOf(session),
      });
      return changed === 0 ? ({ kind: 'not_found' as const }) : ({ kind: 'ok' as const });
    });

    if (result.kind === 'not_found') return notFound(reply, '호실');
    if (result.kind === 'too_low') return inUse(reply, result.message);
    return reply.send({ spaceId: req.params.id });
  });

  app.delete<{ Params: { id: string } }>('/facility/spaces/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const use = await countSpaceUsage(client, req.params.id);
      /*
       * ★★★ **계약 이력이 있으면 막는다**(결정 2026-10-03) — 살아 있는 계약만이 아니다.
       *    종료된 계약도 `contract_spaces` 에 행을 남기고 지난 계약서가 그것을 읽는다.
       *    대안을 문구에 담는다: 「사용 안 함」으로 바꾸면 새 계약에는 안 나온다.
       */
      if (use.all > 0) {
        const live = use.live > 0 ? `(지금 계약중·계약대기 ${use.live}건 포함) ` : '';
        return {
          kind: 'in_use' as const,
          message:
            `계약 ${use.all}건에서 사용한 호실입니다 ${live}— 지우면 지난 계약서의 호실이 비어 버려 지울 수 없습니다. ` +
            `더 쓰지 않으시려면 「사용 안 함」으로 바꿔 주세요(새 계약에는 나오지 않고 지난 계약서는 그대로입니다)`,
        };
      }
      const removed = await deleteSpace(client, req.params.id);
      return removed === 0 ? ({ kind: 'not_found' as const }) : ({ kind: 'ok' as const });
    });

    if (result.kind === 'not_found') return notFound(reply, '호실');
    if (result.kind === 'in_use') return inUse(reply, result.message);
    return reply.send({ spaceId: req.params.id, deleted: true });
  });

  // ── 회의실 ──────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/facility/floors/:id/facilities', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const rows = await withCompanyScope(OPERATOR_SCOPE, (client) => listFacilitiesOfFloor(client, req.params.id));
    return reply.send({ facilities: rows.map(toFacility) });
  });

  app.post<{ Body: FacilityBody }>('/facility/facilities', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const floorId = text(req.body?.floorId);
    const name = text(req.body?.name);
    if (!floorId) return badRequest(reply, '층을 고르고 회의실을 추가해 주세요');
    if (!name) return badRequest(reply, '회의실명을 입력해 주세요');

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const floors = await listFloors(client);
      const floor = floors.find((f) => f.floor_id === floorId);
      if (!floor) return { kind: 'not_found' as const };

      const facilityId = randomUUID();
      await insertFacility(client, {
        facilityId,
        buildingId: floor.building_id,
        floorId,
        floorNo: floor.floor_no,
        patch: facilityPatch(req.body, name),
        actor: actorOf(session),
      });
      return { kind: 'ok' as const, facilityId };
    });

    if (result.kind === 'not_found') return notFound(reply, '층');
    return reply.code(201).send({ facilityId: result.facilityId });
  });

  app.patch<{ Params: { id: string }; Body: FacilityBody }>('/facility/facilities/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const name = text(req.body?.name);
    if (!name) return badRequest(reply, '회의실명을 입력해 주세요');

    const changed = await withCompanyScope(OPERATOR_SCOPE, (client) =>
      updateFacility(client, {
        facilityId: req.params.id,
        patch: facilityPatch(req.body, name),
        actor: actorOf(session),
      }),
    );
    if (changed === 0) return notFound(reply, '회의실');
    return reply.send({ facilityId: req.params.id });
  });

  app.delete<{ Params: { id: string } }>('/facility/facilities/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const use = await countFacilityUsage(client, req.params.id);
      /* ★ 취소된 예약만 있으면 막지 않는다 — 다만 그 수를 문구에 적어 알려 준다. */
      if (use.live > 0) {
        return {
          kind: 'in_use' as const,
          message: `예약 ${use.live}건이 걸려 있어 지울 수 없습니다. 예약을 먼저 취소하거나 「예약 받지 않음」으로 바꿔 주세요`,
        };
      }
      const removed = await deleteFacility(client, req.params.id);
      return removed === 0 ? ({ kind: 'not_found' as const }) : ({ kind: 'ok' as const, cancelled: use.all });
    });

    if (result.kind === 'not_found') return notFound(reply, '회의실');
    if (result.kind === 'in_use') return inUse(reply, result.message);
    return reply.send({ facilityId: req.params.id, deleted: true, cancelledReservations: result.cancelled });
  });

  // ── 건물·층 첨부 ────────────────────────────────────────────────────────
  //    임대차계약서(p1) · 층별 도면(p2). 화면코드는 늘지 않는다 — 같은 팝업 안의 칸이다.
  registerAttachRoutes(app, 'buildings');
  registerAttachRoutes(app, 'floors');
}

/* =============================================================================
   건물·층 첨부 (2026-10-03)
   =============================================================================
   ★★★ **계약 서류와 같은 기계다.** 새로 만든 것이 없다 —
        `tb_cm_file` 에 `target_type` 두 값(`BUILDING`·`FLOOR`)이 늘었을 뿐이고,
        순서·되돌리기·DELETE+INSERT·서명 URL 은 전부 그쪽 코드를 그대로 쓴다
        (`db/files.ts`, 순서의 근거는 `routes/files.ts` 머리말).

   ★ 그 순서를 다시 적는다 — 이 파일만 읽는 사람을 위해서다.
       올릴 때   ① 스토리지  → ② DB. ②가 실패하면 ①을 되돌린다
       지울 때   ① DB        → ② 스토리지. ②가 실패하면 고아 파일이 남는다
     어느 경우에도 «DB 에 있는데 실물이 없는» 상태는 만들지 않는다.

   ★ 대상 하나에 서류 한 가지뿐이라 `?purpose=` 를 받지 않는다. 받으면 화면이 틀린
     값을 보낼 길이 생기고, 그것을 검사하는 코드가 또 필요하다. 종류는 서버가 안다.

   ★ 운영사 전용은 세 라우트가 **같은 한 줄**로 막는다(`forbidden`). 거기에 DB 의 RLS
     (`erp_files_operator_only`)가 한 겹 더 있다 — 이 줄이 빠져도 DB 가 막는다.
   ============================================================================= */

/**
 * 대상이 지워질 때 **첨부 기록도 같이 지운다.** 돌려주는 것은 **지울 실물의 경로들**이고,
 * 실물은 라우트가 커밋 뒤에 지운다(`dropObjects`).
 *
 * ★★ 순서가 늘 같다 — **기록을 먼저, 실물은 그 다음.** 실물이 안 지워지면 아무도 볼 수
 *    없는 고아 파일이 남을 뿐이고, 반대로 하면 «기록은 있는데 열리지 않는 첨부»가
 *    남는다(`routes/files.ts` 머리말의 그 판단이다).
 *
 * ★ 첨부가 있다고 삭제를 막지는 않는다. 첨부는 그 건물·층의 **일부**이고, 「쓰고 있는
 *   것」(층·입주사·계약·호실·예약)이 아니다 — 함께 사라지는 것이 맞다.
 */
async function purgeAttachments(
  client: Parameters<typeof listFiles>[0],
  targetType: FacilityTarget,
  targetId: string,
): Promise<string[]> {
  const target: FileTarget = { type: targetType, id: targetId };
  const rows = await listFiles(client, target);
  for (const row of rows) await deleteFile(client, target, row.id);
  return rows.map((row) => row.storage_path);
}

/** 고아가 될 실물을 지운다. ★ 실패해도 응답은 성공이다 — 기록은 이미 없다. */
async function dropObjects(log: FastifyRequest['log'], paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await removeObject(path).catch((err: unknown) => {
      log.error({ err, storagePath: path }, '★ 실물 삭제 실패 — 고아 파일이 남았다. 기록은 지워졌다(의도한 방향)');
    });
  }
}

type AttachKind = 'buildings' | 'floors';

const ATTACH: Readonly<Record<AttachKind, { target: FacilityTarget; what: string }>> = {
  buildings: { target: FILE_TARGET_BUILDING, what: '건물' },
  floors: { target: FILE_TARGET_FLOOR, what: '층' },
};

/** 응답 모양. ★ `storage_path` 는 내보내지 않는다 — 버킷 내부 구조를 알릴 이유가 없다. */
function toAttachFile(row: FileRow, url: string | null) {
  return {
    fileId: row.id,
    purpose: row.file_purpose,
    originalName: row.original_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    /** ★ **만료된다.** 화면은 담아 두지 않고 열 때마다 다시 받는다. */
    url,
  };
}

function registerAttachRoutes(app: FastifyInstance, kind: AttachKind): void {
  const { target, what } = ATTACH[kind];
  const purpose = FACILITY_PURPOSE[target];
  /**
   * 대상이 **있는가**와 **어느 운영사 것인가**를 한 번에 본다 — `null` 이면 404 다.
   * ★ `operator_id` 를 상수 1 로 박지 않는 이유는 `db/files.ts` 머리말과 같다.
   */
  const operatorIdFor = kind === 'buildings' ? operatorIdForBuilding : operatorIdForFloor;
  const fileTarget = (id: string): FileTarget => ({ type: target, id });

  // ── 목록 ──────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(`/facility/${kind}/:id/files`, async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const rows = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      if ((await operatorIdFor(client, req.params.id)) === null) return null;
      return listFiles(client, fileTarget(req.params.id));
    });
    if (rows === null) return notFound(reply, what);

    // ★ 한 장이 실패해도 목록 전체를 죽이지 않는다 — 그 칸만 `url: null` 이다.
    const files = await Promise.all(
      rows.map(async (row) => {
        try {
          return toAttachFile(row, await signedUrl(row.storage_path));
        } catch (err) {
          req.log.error({ err, fileId: row.id }, '서명 URL 발급 실패 — 그 칸만 비운다');
          return toAttachFile(row, null);
        }
      }),
    );
    return reply.send({ files });
  });

  // ── 업로드 (있으면 바꾼다) ────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(`/facility/${kind}/:id/files`, async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      // 허용 형식이 아니면 content-type 파서가 붙지 않아 여기로 온다.
      return reply
        .code(415)
        .send({ error: 'unsupported_media_type', message: 'JPG · PNG · PDF 만 올릴 수 있습니다' });
    }

    const mimeType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    const originalName = readAttachName(req.headers['x-file-name']);
    if (!originalName) return badRequest(reply, '파일 이름이 없습니다');

    // ★ 화면과 **같은 함수**로 검사한다(형식·크기는 계약 서류와 한 벌이다).
    const reason = rejectFacilityUpload({ target, purpose, mimeType, size: body.length });
    if (reason) return badRequest(reply, reason);

    const operatorId = await withCompanyScope(OPERATOR_SCOPE, (client) =>
      operatorIdFor(client, req.params.id),
    );
    if (operatorId === null) return notFound(reply, what);

    const fileId = randomUUID();
    const storagePath = facilityStoragePathFor({
      operatorId,
      target,
      targetId: req.params.id,
      fileId,
      mimeType,
    });

    // ── ① 스토리지 먼저 ─────────────────────────────────────────────────
    try {
      await putObject({ path: storagePath, body, contentType: mimeType });
    } catch (err) {
      req.log.error({ err, storagePath }, '스토리지 업로드 실패 — DB 는 건드리지 않았다');
      if (err instanceof StorageError && err.status === 413) {
        return badRequest(reply, '파일이 너무 큽니다');
      }
      return reply.code(502).send({
        error: 'storage_unavailable',
        message: '파일 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요',
      });
    }

    // ── ② DB. 실패하면 ①을 되돌린다 ────────────────────────────────────
    let previous: FileRow | null = null;
    try {
      const result = await withCompanyScope(OPERATOR_SCOPE, (client) =>
        replaceFile(client, {
          target: fileTarget(req.params.id),
          purpose,
          fileId,
          originalName,
          storagePath,
          mimeType,
          size: body.length,
          operatorId,
          createdBy: actorOf(session),
        }),
      );
      previous = result.previous;
    } catch (err) {
      // ★ 기록 없는 파일을 남기지 않는다. 되돌리기가 또 실패하면 그때는 고아로 남긴다.
      req.log.error({ err, storagePath }, 'DB 기록 실패 — 방금 올린 실물을 되돌린다');
      await removeObject(storagePath).catch((cleanupErr: unknown) => {
        req.log.error(
          { err: cleanupErr, storagePath },
          '★ 되돌리기 실패 — 고아 파일이 남았다. 기록은 없다(의도한 방향)',
        );
      });
      throw err;
    }

    // ── ③ 옛 실물. 여기서 실패해도 **응답은 성공**이다 ──────────────────
    const replacedPath = previous?.storage_path ?? null;
    if (replacedPath) {
      await removeObject(replacedPath).catch((err: unknown) => {
        req.log.error(
          { err, storagePath: replacedPath },
          '★ 옛 실물 삭제 실패 — 고아 파일이 남았다. 기록은 이미 새것을 가리킨다',
        );
      });
    }

    let url: string | null = null;
    try {
      url = await signedUrl(storagePath);
    } catch (err) {
      req.log.error({ err, storagePath }, '업로드는 됐고 서명 URL 만 실패 — 화면이 다시 받는다');
    }

    return reply.code(201).send({
      file: toAttachFile(
        {
          id: fileId,
          target_type: target,
          target_id: req.params.id,
          file_purpose: purpose,
          original_name: originalName,
          storage_path: storagePath,
          file_size: body.length,
          mime_type: mimeType,
          created_at: new Date(),
        },
        url,
      ),
      /** 옛 파일을 바꿔치웠는가 — 화면이 「교체했습니다」라고 말할 수 있게. */
      replaced: previous !== null,
    });
  });

  // ── 삭제 ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string; fileId: string } }>(
    `/facility/${kind}/:id/files/:fileId`,
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      // ★ 지우기 **전에** 경로를 읽어 둔다. 지운 뒤에는 어디에 있는지 알 수 없다.
      const removed = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
        const row = await findFile(client, fileTarget(req.params.id), req.params.fileId);
        if (!row) return null;
        return (await deleteFile(client, fileTarget(req.params.id), req.params.fileId)) ? row : null;
      });

      if (!removed) return notFound(reply, '첨부');

      // DB 가 먼저 지워졌다. 실물이 안 지워지면 고아로 남는다 — 반대보다 낫다.
      try {
        await removeObject(removed.storage_path);
      } catch (err) {
        req.log.error(
          { err, storagePath: removed.storage_path },
          '★ 실물 삭제 실패 — 고아 파일이 남았다. 기록은 지워졌다(의도한 방향)',
        );
      }

      return reply.code(204).send();
    },
  );
}

/**
 * 원본 파일 이름. 헤더로 오므로 **인코딩돼 있다**(한글 이름이 그대로 들어가면 규격 위반).
 *
 * ★ `routes/files.ts` 의 `readFileName` 과 같은 일을 한다. 그쪽을 가져다 쓰지 않은 이유는
 *   하나뿐이다 — 그 파일은 계약 서류 라우트고, 끌어오면 두 라우트 파일이 서로를 import
 *   하는 모양이 된다. 갈리면 해가 되는 **판정**(형식·크기)은 이미 공유했다(`rejectBytes`).
 */
function readAttachName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  name = name.replace(/[\\/]/g, '_').replace(/\.{2,}/g, '.').trim();
  if (name === '' || name === '.') return null;
  return name.slice(0, 200);
}

// =============================================================================
// 본문 → 패치
// =============================================================================

function actorOf(session: { s020MemberId: number }): string {
  return String(session.s020MemberId);
}

function buildingPatch(body: BuildingBody | undefined, name: string) {
  return {
    name,
    address: text(body?.address),
    ownerName: text(body?.ownerName),
    ownerPhone: text(body?.ownerPhone),
    bizRegNo: text(body?.bizRegNo),
    contractFrom: day(body?.contractFrom),
    contractTo: day(body?.contractTo),
    centerManager: text(body?.centerManager),
    bankName: text(body?.bankName),
    bankAccount: text(body?.bankAccount),
    accountHolder: text(body?.accountHolder),
    memo: text(body?.memo),
  };
}

function floorPatch(body: FloorBody | undefined, buildingId: string, floorNo: string) {
  return {
    buildingId,
    floorNo,
    name: text(body?.name),
    areaSqm: decimal(body?.areaSqm),
    monthlyRent: int(body?.monthlyRent),
    deposit: int(body?.deposit),
    hasLounge: bool(body?.hasLounge),
    hasMeetingRoom: bool(body?.hasMeetingRoom),
    hasOaZone: bool(body?.hasOaZone),
  };
}

/**
 * 「입주 가능 회사 수」 — 통과면 수, 아니면 **보여줄 문구**.
 *
 * ★ 안 보내면 기본값이다(옛 화면도 저장된다). 보냈는데 1 미만이거나 숫자가 아니면
 *   **조용히 기본값으로 바꾸지 않고 거절한다** — 운영자가 넣은 3 이 1 로 둔갑하면
 *   아무도 눈치채지 못한다.
 */
function parseMaxCompanies(v: unknown): { ok: true; value: number } | { ok: false; message: string } {
  if (v === undefined || v === null || v === '') return { ok: true, value: DEFAULT_MAX_COMPANIES };
  const n = int(v);
  if (n === null || n < MIN_MAX_COMPANIES) {
    return { ok: false, message: `입주 가능 회사 수는 ${MIN_MAX_COMPANIES} 이상의 숫자여야 합니다` };
  }
  return { ok: true, value: n };
}

function spacePatch(body: SpaceBody | undefined, roomType: string, maxCompanies: number) {
  return {
    roomName: text(body?.roomName),
    roomType,
    /*
     * ★★ 본문의 `status` 는 **읽지 않는다.** 호실상태는 계약이 정한다
     *    (`db/spaceStatus.ts`). 새 호실은 계약이 없으니 언제나 「공실」로 들어가고,
     *    수정에서는 이 값이 쓰이지 않는다(`updateSpace` 가 SET 절에서 뺐다).
     * ★ 화면이 보내더라도 조용히 버린다 — 400 으로 막으면 옛 화면이 저장을 못 한다.
     */
    status: SPACE_STATUS.EMPTY,
    bizAddrAvailable: bool(body?.bizAddrAvailable),
    standardFee: int(body?.standardFee),
    deposit: int(body?.deposit),
    areaSqm: decimal(body?.areaSqm),
    capacity: int(body?.capacity),
    /* ★ 라우트가 `parseMaxCompanies` 로 먼저 걸러 넘긴 수다 — 여기서 짐작하지 않는다. */
    maxCompanies,
    memo: text(body?.memo),
    /* ★ 안 보내면 **사용함**이다. 「사용 안 함」은 화면이 명시적으로 false 를 보낸다. */
    isActive: body?.isActive === undefined ? true : bool(body.isActive),
  };
}

function facilityPatch(body: FacilityBody | undefined, name: string) {
  return {
    name,
    capacity: int(body?.capacity),
    halfHourFee: int(body?.halfHourFee),
    openTime: text(body?.openTime),
    closeTime: text(body?.closeTime),
    minDuration: int(body?.minDuration),
    maxDuration: int(body?.maxDuration),
    status: text(body?.status) ?? 'active',
    isReservable: body?.isReservable === undefined ? true : bool(body.isReservable),
  };
}
