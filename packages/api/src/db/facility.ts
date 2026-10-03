/**
 * 센터 관리(s030100010) 저장소 — 건물 · 층 · 호실 · 회의실.
 *
 * =============================================================================
 * ★★★ 이 네 표에는 **FK 가 하나도 없다** (2026-10-03 실측)
 * =============================================================================
 * `information_schema` 로 확인했다 — `tb_s080_buildings`·`floors`·`spaces`·`facilities`
 * 를 참조하는 외래키가 **0건**이다. 즉 **DB 가 막아 주지 않는다.** 층을 지우면 그 층의
 * 호실이 없는 층을 가리키는 채로 남고, 호실을 지우면 지난 계약서의 호실이 빈칸이 된다.
 *
 * 그래서 **쓰고 있는지 세는 일을 이 파일이 한다**(`countXxxUsage`). 지우기 전에 반드시
 * 센다 — 세지 않고 지우는 경로를 만들면 그것이 곧 사고의 형태다.
 *
 * =============================================================================
 * ★★ 「삭제」와 「사용 안 함」은 다른 일이다 (결정 2026-10-03)
 * =============================================================================
 *   삭제      행을 **지운다**. 계약 이력이 한 번이라도 있으면 **막는다** —
 *             지난 계약서·정산서가 그 호실을 가리키므로 이력이 깨진다.
 *   사용 안 함 `is_active = false`. 행은 남고 **새 계약 호실 목록에서만 사라진다**
 *             (`db/lookups.ts` 의 `listSpaces` 가 `is_active = true` 로 거른다).
 *             지난 계약서는 그대로다. 언제든 다시 켤 수 있다.
 *
 * ★ 레거시(`/api/admin/spaces/rooms/bulk`)는 「삭제」 버튼이 실은 `isActive:false` 였다 —
 *   즉 **하드 삭제가 아예 없었다.** 우리는 둘을 가른다. 이력이 없는 호실은 정말 지울 수
 *   있어야 하고(잘못 만든 행), 이력이 있는 호실은 지워선 안 된다.
 *
 * ★ `room_no` 는 **사람이 읽는 번호가 아니다** — 12자리 16진값이다(실측: 72행 전부
 *   길이 12, 서로 다름). 사람이 보는 이름은 `room_name` 이다. 신규 호실의 `room_no` 는
 *   서버가 만든다 — 화면이 받지 않는다(`db/lookups.ts` 의 같은 주석).
 */
import { randomBytes } from 'node:crypto';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 살아 있는 계약 — `isPreviousLive` 와 같은 어휘다(계약중·계약대기). */
const LIVE_STATUSES = ['confirmed', 'draft'];

/**
 * 신규 호실의 `room_no`.
 *
 * ★ 기존 72행과 **같은 모양**(12자리 16진)으로 만든다. 모양을 바꾸면 이 컬럼으로
 *   정렬하거나 길이를 가정하는 코드가 생겼을 때 조용히 어긋난다.
 */
export function newRoomNo(): string {
  return randomBytes(6).toString('hex');
}

// =============================================================================
// 건물
// =============================================================================

export interface BuildingRow {
  build_id: string;
  name: string;
  address: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  biz_reg_no: string | null;
  contract_from: Date | null;
  contract_to: Date | null;
  center_manager: string | null;
  bank_name: string | null;
  bank_account: string | null;
  account_holder: string | null;
  memo: string | null;
  is_active: boolean;
  floor_count: number;
}

/** 건물 전체 + 층 개수. 센터는 많지 않아 페이징을 두지 않는다. */
export async function listBuildings(client: ScopedClient): Promise<BuildingRow[]> {
  const { rows } = await q<BuildingRow>(
    client,
    `SELECT b.build_id, b.name, b.address, b.owner_name, b.owner_phone, b.biz_reg_no,
            b.contract_from, b.contract_to, b.center_manager,
            b.bank_name, b.bank_account, b.account_holder, b.memo, b.is_active,
            (SELECT count(*)::int FROM public.tb_s080_floors f WHERE f.building_id = b.build_id) AS floor_count
       FROM public.tb_s080_buildings b
      ORDER BY b.name, b.build_id`,
  );
  return rows;
}

export interface BuildingPatch {
  name: string;
  address: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  bizRegNo: string | null;
  contractFrom: string | null;
  contractTo: string | null;
  centerManager: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  memo: string | null;
}

export async function insertBuilding(
  client: ScopedClient,
  args: { buildId: string; patch: BuildingPatch; actor: string },
): Promise<void> {
  const p = args.patch;
  await q(
    client,
    /*
     * ★ `operator_id` 는 1 로 고정한다 — 개발계·가동계 모두 운영사가 하나다
     *   (`verify-3-2.js` 의 같은 주석). 운영사가 늘면 세션에서 받아야 한다.
     * ★ `is_active` 는 true 로 시작한다. `total_floors` 는 쓰지 않는다 —
     *   층 개수는 `tb_s080_floors` 를 세면 되고, 두 곳에 두면 어긋난다.
     */
    `INSERT INTO public.tb_s080_buildings
       (build_id, operator_id, name, address, owner_name, owner_phone, biz_reg_no,
        contract_from, contract_to, center_manager, bank_name, bank_account,
        account_holder, memo, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true,
             now(), now(), $14, $14)`,
    [
      args.buildId, p.name, p.address, p.ownerName, p.ownerPhone, p.bizRegNo,
      p.contractFrom, p.contractTo, p.centerManager, p.bankName, p.bankAccount,
      p.accountHolder, p.memo, args.actor,
    ],
  );
}

export async function updateBuilding(
  client: ScopedClient,
  args: { buildId: string; patch: BuildingPatch; actor: string },
): Promise<number> {
  const p = args.patch;
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_buildings
        SET name = $2, address = $3, owner_name = $4, owner_phone = $5, biz_reg_no = $6,
            contract_from = $7, contract_to = $8, center_manager = $9,
            bank_name = $10, bank_account = $11, account_holder = $12, memo = $13,
            updated_at = now(), updated_by = $14
      WHERE build_id = $1`,
    [
      args.buildId, p.name, p.address, p.ownerName, p.ownerPhone, p.bizRegNo,
      p.contractFrom, p.contractTo, p.centerManager, p.bankName, p.bankAccount,
      p.accountHolder, p.memo, args.actor,
    ],
  );
  return rowCount ?? 0;
}

/**
 * 건물을 지울 수 있는가. **쓰고 있으면 사유를 돌려준다.**
 *
 * ★ 입주사·계약이 `build_id` 로 건물에 달려 있다. 건물을 지우면 그것들이 없는 건물을
 *   가리킨다 — FK 가 없으니 조용히 그렇게 된다.
 */
export async function countBuildingUsage(
  client: ScopedClient,
  buildId: string,
): Promise<{ floors: number; companies: number; contracts: number }> {
  const { rows } = await q<{ floors: number; companies: number; contracts: number }>(
    client,
    `SELECT (SELECT count(*)::int FROM public.tb_s080_floors    WHERE building_id = $1) AS floors,
            (SELECT count(*)::int FROM public.tb_s080_companies WHERE build_id   = $1) AS companies,
            (SELECT count(*)::int FROM public.tb_s080_contracts WHERE build_id   = $1) AS contracts`,
    [buildId],
  );
  return rows[0] ?? { floors: 0, companies: 0, contracts: 0 };
}

export async function deleteBuilding(client: ScopedClient, buildId: string): Promise<number> {
  const { rowCount } = await q(client, `DELETE FROM public.tb_s080_buildings WHERE build_id = $1`, [buildId]);
  return rowCount ?? 0;
}

// =============================================================================
// 층
// =============================================================================

export interface FloorRow {
  floor_id: string;
  building_id: string;
  floor_no: string;
  name: string | null;
  area_sqm: string | null;
  monthly_rent: number | null;
  deposit: number | null;
  has_lounge: boolean;
  has_meeting_room: boolean;
  has_oa_zone: boolean;
  space_count: number;
  facility_count: number;
}

/**
 * 층 전체(건물별) + 호실·회의실 개수.
 *
 * ★ 층 번호는 `text` 다 — 「B1」·「1」·「10」이 섞인다. 그래서 **숫자로 정렬할 수 없다.**
 *   숫자로 읽히면 숫자 순, 아니면 뒤로 보낸다. 이렇게 하지 않으면 10층이 2층 앞에 온다.
 */
export async function listFloors(client: ScopedClient, buildId?: string): Promise<FloorRow[]> {
  const { rows } = await q<FloorRow>(
    client,
    `SELECT f.floor_id, f.building_id, f.floor_no, f.name, f.area_sqm,
            f.monthly_rent, f.deposit, f.has_lounge, f.has_meeting_room, f.has_oa_zone,
            (SELECT count(*)::int FROM public.tb_s080_spaces     s WHERE s.floor_id = f.floor_id) AS space_count,
            (SELECT count(*)::int FROM public.tb_s080_facilities c WHERE c.floor_id = f.floor_id) AS facility_count
       FROM public.tb_s080_floors f
      WHERE ($1::text IS NULL OR f.building_id = $1)
      ORDER BY f.building_id,
               (CASE WHEN f.floor_no ~ '^-?[0-9]+$' THEN f.floor_no::int ELSE NULL END) NULLS LAST,
               f.floor_no`,
    [buildId ?? null],
  );
  return rows;
}

export interface FloorPatch {
  buildingId: string;
  floorNo: string;
  name: string | null;
  areaSqm: string | null;
  monthlyRent: number | null;
  deposit: number | null;
  hasLounge: boolean;
  hasMeetingRoom: boolean;
  hasOaZone: boolean;
}

export async function insertFloor(
  client: ScopedClient,
  args: { floorId: string; patch: FloorPatch; actor: string },
): Promise<void> {
  const p = args.patch;
  await q(
    client,
    `INSERT INTO public.tb_s080_floors
       (floor_id, building_id, floor_no, name, area_sqm, monthly_rent, deposit,
        has_lounge, has_meeting_room, has_oa_zone, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), $11, $11)`,
    [
      args.floorId, p.buildingId, p.floorNo, p.name, p.areaSqm, p.monthlyRent, p.deposit,
      p.hasLounge, p.hasMeetingRoom, p.hasOaZone, args.actor,
    ],
  );
}

export async function updateFloor(
  client: ScopedClient,
  args: { floorId: string; patch: FloorPatch; actor: string },
): Promise<number> {
  const p = args.patch;
  const { rowCount } = await q(
    client,
    /* ★ `building_id` 는 고치지 않는다 — 층을 다른 건물로 옮기는 업무는 없다. */
    `UPDATE public.tb_s080_floors
        SET floor_no = $2, name = $3, area_sqm = $4, monthly_rent = $5, deposit = $6,
            has_lounge = $7, has_meeting_room = $8, has_oa_zone = $9,
            updated_at = now(), updated_by = $10
      WHERE floor_id = $1`,
    [
      args.floorId, p.floorNo, p.name, p.areaSqm, p.monthlyRent, p.deposit,
      p.hasLounge, p.hasMeetingRoom, p.hasOaZone, args.actor,
    ],
  );
  return rowCount ?? 0;
}

/** 층을 지울 수 있는가 — 호실·회의실이 남아 있으면 막는다(비우고 지우게 한다). */
export async function countFloorUsage(
  client: ScopedClient,
  floorId: string,
): Promise<{ spaces: number; facilities: number }> {
  const { rows } = await q<{ spaces: number; facilities: number }>(
    client,
    `SELECT (SELECT count(*)::int FROM public.tb_s080_spaces     WHERE floor_id = $1) AS spaces,
            (SELECT count(*)::int FROM public.tb_s080_facilities WHERE floor_id = $1) AS facilities`,
    [floorId],
  );
  return rows[0] ?? { spaces: 0, facilities: 0 };
}

export async function deleteFloor(client: ScopedClient, floorId: string): Promise<number> {
  const { rowCount } = await q(client, `DELETE FROM public.tb_s080_floors WHERE floor_id = $1`, [floorId]);
  return rowCount ?? 0;
}

// =============================================================================
// 호실
// =============================================================================

export interface SpaceAdminRow {
  space_id: string;
  build_id: string;
  floor_id: string;
  room_no: string;
  room_name: string | null;
  room_type: string;
  status: string;
  biz_addr_available: boolean;
  standard_fee: number | null;
  deposit: number | null;
  area_sqm: string | null;
  capacity: number | null;
  /** 「입주 가능 회사 수」 — 계약을 몇 곳까지 받는가(`domain/space-occupancy`). */
  max_companies: number;
  memo: string | null;
  is_active: boolean;
  /**
   * 이 호실을 쓴 계약 수 — **살아 있는 것과 이력 전체를 따로** 센다.
   *
   * ★ 호실 표에는 **보이지 않는다**(결정 2026-10-03 — 호실 관리는 재실여부만 다룬다).
   *   `all_contracts` 는 「왜 못 지우는지」를 누르기 전에 알려 주는 데 쓰고,
   *   `live_contracts` 는 그 문구에 함께 들어간다(`facility-model.deleteBlockMessage`).
   */
  live_contracts: number;
  all_contracts: number;
}

/**
 * 한 층의 호실 전체 — **`is_active` 로 거르지 않는다.**
 *
 * ★★ 계약 폼의 목록(`listSpaces`)과 다른 점이 이것이다. 관리 화면은 「사용 안 함」인
 *    호실도 보여야 한다 — 보이지 않으면 다시 켤 방법이 없다.
 */
export async function listSpacesOfFloor(client: ScopedClient, floorId: string): Promise<SpaceAdminRow[]> {
  const { rows } = await q<SpaceAdminRow>(
    client,
    `SELECT s.space_id, s.build_id, s.floor_id, s.room_no, s.room_name, s.room_type,
            s.status, s.biz_addr_available, s.standard_fee, s.deposit,
            s.area_sqm, s.capacity, s.max_companies, s.memo, s.is_active,
            (SELECT count(*)::int FROM public.tb_s080_contract_spaces cs
               JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
              WHERE cs.space_id = s.space_id AND k.status = ANY($2::text[])) AS live_contracts,
            (SELECT count(*)::int FROM public.tb_s080_contract_spaces cs
              WHERE cs.space_id = s.space_id) AS all_contracts
       FROM public.tb_s080_spaces s
      WHERE s.floor_id = $1
      ORDER BY s.room_type, s.room_name NULLS LAST, s.space_id`,
    [floorId, LIVE_STATUSES],
  );
  return rows;
}

export interface SpacePatch {
  roomName: string | null;
  roomType: string;
  status: string;
  bizAddrAvailable: boolean;
  standardFee: number | null;
  deposit: number | null;
  areaSqm: string | null;
  capacity: number | null;
  /** 「입주 가능 회사 수」. ★ 1 미만은 라우트가 400 으로 막고, DB 에도 CHECK 가 있다. */
  maxCompanies: number;
  memo: string | null;
  isActive: boolean;
}

export async function insertSpace(
  client: ScopedClient,
  args: { spaceId: string; buildId: string; floorId: string; roomNo: string; patch: SpacePatch; actor: string },
): Promise<void> {
  const p = args.patch;
  await q(
    client,
    /* ★ `amenities` 를 쓰지 않는다 — 읽는 코드가 없고 72행 전부 비어 있다(결정 2026-10-03). */
    /* ★ 새 호실은 계약이 없으니 `E`(공실)로 들어간다. 그 뒤로는 계약이 정한다. */
    `INSERT INTO public.tb_s080_spaces
       (space_id, build_id, floor_id, room_no, room_name, room_type, status,
        biz_addr_available, standard_fee, deposit, area_sqm, capacity, max_companies,
        memo, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             now(), now(), $16, $16)`,
    [
      args.spaceId, args.buildId, args.floorId, args.roomNo,
      p.roomName, p.roomType, p.status, p.bizAddrAvailable, p.standardFee, p.deposit,
      p.areaSqm, p.capacity, p.maxCompanies, p.memo, p.isActive, args.actor,
    ],
  );
}

export async function updateSpace(
  client: ScopedClient,
  args: { spaceId: string; patch: SpacePatch; actor: string },
): Promise<number> {
  const p = args.patch;
  const { rowCount } = await q(
    client,
    /* ★ `room_no` 는 고치지 않는다 — 기계값이고 바꿀 업무가 없다. */
    /*
     * ★★★ `status` 도 **고치지 않는다** — 계약이 정하는 값이다(결정 2026-10-03).
     *
     * 예전에는 이 UPDATE 가 호실상태를 함께 썼다. 그대로 두면 운영자가 손으로 「공실」로
     * 돌려놓는 순간 계약과 어긋나고, 그때 어느 쪽이 참인지 아무도 모른다. 상태를 바꾸는
     * 길은 `db/spaceStatus.ts` 하나뿐이고, 그것은 계약을 보고 다시 센다.
     *
     * ★ 칸을 목록에서 빼기만 하면 **안 된다** — 화면이 안 보내면 `E`(기본값)가 들어가
     *   계약이 살아 있는 방이 공실로 덮인다. 그래서 SET 절에서 통째로 뺀다.
     */
    `UPDATE public.tb_s080_spaces
        SET room_name = $2, room_type = $3, biz_addr_available = $4,
            standard_fee = $5, deposit = $6, area_sqm = $7, capacity = $8,
            max_companies = $9, memo = $10, is_active = $11,
            updated_at = now(), updated_by = $12
      WHERE space_id = $1`,
    [
      args.spaceId, p.roomName, p.roomType, p.bizAddrAvailable,
      p.standardFee, p.deposit, p.areaSqm, p.capacity, p.maxCompanies,
      p.memo, p.isActive, args.actor,
    ],
  );
  return rowCount ?? 0;
}

/**
 * 호실을 지울 수 있는가.
 *
 * ★★★ **계약 이력이 한 번이라도 있으면 막는다**(결정 2026-10-03) — 살아 있는 계약만
 *    보는 것이 아니다. 종료된 계약도 `contract_spaces` 에 행을 남기고, 지난 계약서·
 *    정산서가 그 호실을 가리킨다. 지우면 **지난 계약서의 호실이 빈칸이 된다.**
 */
export async function countSpaceUsage(
  client: ScopedClient,
  spaceId: string,
): Promise<{ live: number; all: number }> {
  const { rows } = await q<{ live: number; all: number }>(
    client,
    `SELECT (SELECT count(*)::int FROM public.tb_s080_contract_spaces cs
               JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
              WHERE cs.space_id = $1 AND k.status = ANY($2::text[])) AS live,
            (SELECT count(*)::int FROM public.tb_s080_contract_spaces WHERE space_id = $1) AS all`,
    [spaceId, LIVE_STATUSES],
  );
  return rows[0] ?? { live: 0, all: 0 };
}

/**
 * 지금 이 호실에 들어 있는 **회사 수**. 「입주 가능 회사 수」를 그보다 낮추지 못하게
 * 막는 자리다.
 *
 * ★★ `count(DISTINCT company_id)` 다 — 줄 수가 아니다. 한 회사가 두 계약으로 잡고
 *    있어도 1곳이고, 판정하는 `occupancyBySpace` 도 회사로 접는다. 두 곳이 세는 법이
 *    다르면 화면은 통과시키는데 저장이 막힌다.
 */
export async function countSpaceCompanies(client: ScopedClient, spaceId: string): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(DISTINCT k.company_id)::int AS n
       FROM public.tb_s080_contract_spaces cs
       JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
      WHERE cs.space_id = $1 AND k.status = ANY($2::text[])`,
    [spaceId, LIVE_STATUSES],
  );
  return rows[0]?.n ?? 0;
}

export async function deleteSpace(client: ScopedClient, spaceId: string): Promise<number> {
  const { rowCount } = await q(client, `DELETE FROM public.tb_s080_spaces WHERE space_id = $1`, [spaceId]);
  return rowCount ?? 0;
}

// =============================================================================
// 회의실
// =============================================================================

export interface FacilityRow {
  facility_id: string;
  building_id: string;
  floor_id: string | null;
  floor_no: string | null;
  name: string;
  facility_type: string;
  capacity: number | null;
  half_hour_fee: number | null;
  open_time: string | null;
  close_time: string | null;
  min_duration: number | null;
  max_duration: number | null;
  status: string;
  is_reservable: boolean;
  /** 취소되지 않은 예약 수 — 지우기를 막는 근거다. */
  live_reservations: number;
  all_reservations: number;
}

export async function listFacilitiesOfFloor(client: ScopedClient, floorId: string): Promise<FacilityRow[]> {
  const { rows } = await q<FacilityRow>(
    client,
    /*
     * ★ 「살아 있는 예약」은 `status <> 'cancelled'` 다. 취소된 예약만 있는 회의실은
     *   막지 않는다 — 다만 이력이 사라지므로 화면이 그 수를 함께 보여 준다.
     */
    `SELECT c.facility_id, c.building_id, c.floor_id, c.floor_no, c.name, c.facility_type,
            c.capacity, c.half_hour_fee, c.open_time, c.close_time,
            c.min_duration, c.max_duration, c.status, c.is_reservable,
            (SELECT count(*)::int FROM public.tb_s080_reservations r
              WHERE r.facility_id = c.facility_id AND coalesce(r.status, '') <> 'cancelled') AS live_reservations,
            (SELECT count(*)::int FROM public.tb_s080_reservations r
              WHERE r.facility_id = c.facility_id) AS all_reservations
       FROM public.tb_s080_facilities c
      WHERE c.floor_id = $1
      ORDER BY c.name, c.facility_id`,
    [floorId],
  );
  return rows;
}

export interface FacilityPatch {
  name: string;
  capacity: number | null;
  halfHourFee: number | null;
  openTime: string | null;
  closeTime: string | null;
  minDuration: number | null;
  maxDuration: number | null;
  status: string;
  isReservable: boolean;
}

export async function insertFacility(
  client: ScopedClient,
  args: {
    facilityId: string;
    buildingId: string;
    floorId: string;
    floorNo: string | null;
    patch: FacilityPatch;
    actor: string;
  },
): Promise<void> {
  const p = args.patch;
  await q(
    client,
    /*
     * ★ `facility_type` 은 `'MEETING'` 고정이다 — 이 화면이 다루는 것은 회의실이고,
     *   지금 1행도 MEETING 이다. 다른 종류가 생기면 그때 칸을 만든다.
     * ★ `floor_no` 를 함께 넣는다 — 키오스크·예약 화면이 층 표시에 쓰는 값이다.
     */
    `INSERT INTO public.tb_s080_facilities
       (facility_id, building_id, floor_id, floor_no, name, facility_type,
        capacity, half_hour_fee, open_time, close_time, min_duration, max_duration,
        status, is_reservable, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'MEETING', $6, $7, $8, $9, $10, $11, $12, $13,
             now(), now(), $14, $14)`,
    [
      args.facilityId, args.buildingId, args.floorId, args.floorNo,
      p.name, p.capacity, p.halfHourFee, p.openTime, p.closeTime,
      p.minDuration, p.maxDuration, p.status, p.isReservable, args.actor,
    ],
  );
}

export async function updateFacility(
  client: ScopedClient,
  args: { facilityId: string; patch: FacilityPatch; actor: string },
): Promise<number> {
  const p = args.patch;
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_facilities
        SET name = $2, capacity = $3, half_hour_fee = $4, open_time = $5, close_time = $6,
            min_duration = $7, max_duration = $8, status = $9, is_reservable = $10,
            updated_at = now(), updated_by = $11
      WHERE facility_id = $1`,
    [
      args.facilityId, p.name, p.capacity, p.halfHourFee, p.openTime, p.closeTime,
      p.minDuration, p.maxDuration, p.status, p.isReservable, args.actor,
    ],
  );
  return rowCount ?? 0;
}

/** 회의실을 지울 수 있는가 — 취소되지 않은 예약이 있으면 막는다. */
export async function countFacilityUsage(
  client: ScopedClient,
  facilityId: string,
): Promise<{ live: number; all: number }> {
  const { rows } = await q<{ live: number; all: number }>(
    client,
    `SELECT (SELECT count(*)::int FROM public.tb_s080_reservations
              WHERE facility_id = $1 AND coalesce(status, '') <> 'cancelled') AS live,
            (SELECT count(*)::int FROM public.tb_s080_reservations WHERE facility_id = $1) AS all`,
    [facilityId],
  );
  return rows[0] ?? { live: 0, all: 0 };
}

export async function deleteFacility(client: ScopedClient, facilityId: string): Promise<number> {
  const { rowCount } = await q(client, `DELETE FROM public.tb_s080_facilities WHERE facility_id = $1`, [facilityId]);
  return rowCount ?? 0;
}
