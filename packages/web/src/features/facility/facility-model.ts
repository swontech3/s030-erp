/**
 * 센터 관리(s030100010) 모델 — 타입 · 호출 · 문구.
 *
 * ★ 화면 컴포넌트에 `fetch` 를 두지 않는다. 경로가 여러 군데로 퍼지면 어느 화면이 무엇을
 *   부르는지 읽히지 않고, 409(쓰고 있어서 못 지움) 처리가 자리마다 달라진다.
 *
 * ★★ 모든 호출이 **같은 모양으로 실패**한다 — `FacilityError` 하나다. 그 안에 `inUse`
 *    가 있어 화면이 「오류」와 「안내」를 가른다(409 는 요청이 틀린 것이 아니다).
 *
 * ★★ 금액 표기는 **청구 화면의 함수를 그대로 가져다 쓴다**(`won`). 센터 관리가 적어 둔
 *    금액과 청구가 적은 금액은 같은 돈이고, 모양이 갈리면 다른 값으로 읽힌다.
 *    기능 폴더를 넘어 가져오는 것이 마음에 걸리지만, 한 벌 더 쓰는 쪽이 더 나쁘다 —
 *    ERP 에 공용 금액 포맷 자리가 아직 없다(생기면 둘 다 그쪽으로 옮긴다).
 */
import { won } from '@/features/billing/billing-model';

export interface Building {
  buildId: string;
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
  isActive: boolean;
  floorCount: number;
}

export interface Floor {
  floorId: string;
  buildingId: string;
  floorNo: string;
  name: string | null;
  areaSqm: string | null;
  monthlyRent: number | null;
  deposit: number | null;
  hasLounge: boolean;
  hasMeetingRoom: boolean;
  hasOaZone: boolean;
  spaceCount: number;
  facilityCount: number;
}

export interface Space {
  spaceId: string;
  floorId: string;
  roomNo: string;
  roomName: string | null;
  roomType: string;
  status: string;
  bizAddrAvailable: boolean;
  standardFee: number | null;
  deposit: number | null;
  areaSqm: string | null;
  /** 정원 — **사람 수**다. 아래 `maxCompanies` 와 다른 칸이다. */
  capacity: number | null;
  /**
   * 「입주 가능 회사 수」 — 이 호실에 몇 곳까지 계약이 들어가는가.
   *
   * ★ p3 팝업에서 운영자가 정한다. **호실 표에는 보이지 않는다** — 호실 관리는
   *   재실여부만 다룬다(결정 2026-10-03).
   */
  maxCompanies: number;
  memo: string | null;
  isActive: boolean;
  /**
   * 지금 계약중·계약대기인 계약 수.
   *
   * ★ 표에는 보이지 않는다 — 「왜 못 지우는지」 문구에만 쓴다(`deleteBlockMessage`).
   */
  liveContracts: number;
  /** 종료·취소까지 포함한 **이력 전체**. ★ 0 이 아니면 지울 수 없다. */
  allContracts: number;
}

export interface MeetingRoom {
  facilityId: string;
  floorId: string | null;
  name: string;
  capacity: number | null;
  halfHourFee: number | null;
  openTime: string | null;
  closeTime: string | null;
  minDuration: number | null;
  maxDuration: number | null;
  status: string;
  isReservable: boolean;
  /** 취소되지 않은 예약 수. ★ 0 이 아니면 지울 수 없다. */
  liveReservations: number;
  allReservations: number;
}

export interface CodeItem {
  category: string;
  code: string;
  name: string;
}

export interface FacilityTree {
  buildings: Building[];
  floors: Floor[];
  codes: CodeItem[];
}

/**
 * 호출 실패.
 *
 * ★ `inUse` 는 409 다 — **쓰고 있어서 못 지운다**는 뜻이고, 요청이 틀린 것이 아니다.
 *   화면은 이것을 붉은 오류가 아니라 **안내**로 그린다(`message` 에 이유와 대안이 있다).
 */
export class FacilityError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly inUse: boolean,
  ) {
    super(message);
    this.name = 'FacilityError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new FacilityError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, false);
  }

  let body: { message?: string } & Record<string, unknown> = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 본문이 없을 수 있다(204 등). 그대로 둔다.
  }

  if (!res.ok) {
    throw new FacilityError(
      body.message ?? '처리하지 못했습니다',
      res.status,
      // ★ 409 가 「쓰고 있어서 못 지움」이다(`routes/facility.ts` 의 `inUse`).
      res.status === 409,
    );
  }
  return body as T;
}

const json = (body: unknown, method: 'POST' | 'PATCH'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const loadTree = () => call<FacilityTree>('/api/facility/tree');

export const loadSpaces = (floorId: string) =>
  call<{ spaces: Space[] }>(`/api/facility/floors/${encodeURIComponent(floorId)}/spaces`);

export const loadMeetingRooms = (floorId: string) =>
  call<{ facilities: MeetingRoom[] }>(`/api/facility/floors/${encodeURIComponent(floorId)}/facilities`);

export const saveBuilding = (buildId: string | null, body: unknown) =>
  buildId === null
    ? call<{ buildId: string }>('/api/facility/buildings', json(body, 'POST'))
    : call<{ buildId: string }>(`/api/facility/buildings/${encodeURIComponent(buildId)}`, json(body, 'PATCH'));

export const saveFloor = (floorId: string | null, body: unknown) =>
  floorId === null
    ? call<{ floorId: string }>('/api/facility/floors', json(body, 'POST'))
    : call<{ floorId: string }>(`/api/facility/floors/${encodeURIComponent(floorId)}`, json(body, 'PATCH'));

export const saveSpace = (spaceId: string | null, body: unknown) =>
  spaceId === null
    ? call<{ spaceId: string }>('/api/facility/spaces', json(body, 'POST'))
    : call<{ spaceId: string }>(`/api/facility/spaces/${encodeURIComponent(spaceId)}`, json(body, 'PATCH'));

export const saveMeetingRoom = (facilityId: string | null, body: unknown) =>
  facilityId === null
    ? call<{ facilityId: string }>('/api/facility/facilities', json(body, 'POST'))
    : call<{ facilityId: string }>(`/api/facility/facilities/${encodeURIComponent(facilityId)}`, json(body, 'PATCH'));

export const removeBuilding = (buildId: string) =>
  call<{ deleted: boolean }>(`/api/facility/buildings/${encodeURIComponent(buildId)}`, { method: 'DELETE' });

export const removeFloor = (floorId: string) =>
  call<{ deleted: boolean }>(`/api/facility/floors/${encodeURIComponent(floorId)}`, { method: 'DELETE' });

export const removeSpace = (spaceId: string) =>
  call<{ deleted: boolean }>(`/api/facility/spaces/${encodeURIComponent(spaceId)}`, { method: 'DELETE' });

export const removeMeetingRoom = (facilityId: string) =>
  call<{ deleted: boolean }>(`/api/facility/facilities/${encodeURIComponent(facilityId)}`, { method: 'DELETE' });

// =============================================================================
// 문구
// =============================================================================

/**
 * 호실상태 「공실」의 코드값(`ROOM_ST/000`).
 *
 * ★ **이름(공실·입주중·예약중)은 박지 않는다** — 코드 마스터가 갖고, 화면은
 *   `codeName(codes, 'ROOM_ST', …)` 로 붙인다. 여기 두는 것은 「아직 저장되지 않은
 *   새 호실의 기본값」 하나뿐이고, 서버의 `SPACE_STATUS.EMPTY` 와 같은 값이다.
 */
export const SPACE_STATUS_EMPTY = 'E';

/** 코드 → 표시명. ★ 문자열을 화면에 박지 않는다 — 이름이 바뀌면 코드 테이블만 고친다. */
export function codeName(codes: readonly CodeItem[], category: string, code: string): string {
  return codes.find((c) => c.category === category && c.code === code)?.name ?? code;
}

export const codesOf = (codes: readonly CodeItem[], category: string): CodeItem[] =>
  codes.filter((c) => c.category === category);

/** 층 이름 — 「3층」 또는 「3층 (라운지)」. */
export function floorLabel(floor: Floor): string {
  return floor.name ? `${floor.floorNo}층 (${floor.name})` : `${floor.floorNo}층`;
}

/**
 * 금액. **청구 화면과 같은 함수**다 — `₩4,400,000`.
 *
 * ★★ 여기서 다시 쓰지 않는다. 같은 금액이 화면마다 다른 모양으로 나오면(한쪽은 `₩`,
 *    한쪽은 맨 숫자) 운영자는 둘이 다른 값이라고 읽는다. 2026-10-03 까지 센터 관리가
 *    실제로 그랬다.
 *
 * ★ `null` 은 **「—」**다. 빈칸으로 두면 「0원」인지 「아직 모름」인지 구분이 안 되고,
 *   같은 표의 다른 칸은 이미 「—」를 그리고 있었다.
 */
export function money(n: number | null): string {
  return n === null ? '—' : won(n);
}

/**
 * 평수. DB 가 `numeric` 이라 `37.00` 으로 온다 — 꼬리의 0 을 떼고 `37` 로 보인다.
 *
 * ★ 숫자로 바꿔 계산하지 않는다. `Number('37.00')` 은 소수 자릿수를 잃고, 평수는
 *   `12.5` 처럼 반 칸이 있는 값이다. 글자 끝만 다듬는다.
 */
export function area(v: string | null | undefined): string {
  /* ★ 「—」를 돌려주지 않는다 — 이 값이 **입력칸의 초기값으로도** 쓰인다(p2·p3).
     빈칸 표기는 읽는 자리에서 `dash()` 가 붙인다. */
  if (v === null || v === undefined || v.trim() === '') return '';
  const t = v.trim();
  return /^-?\d+\.\d+$/.test(t) ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
}

/** 빈 값은 「—」로. 표와 상세가 같은 글자를 쓰게 한다. */
export const dash = (v: string | null | undefined): string =>
  v === null || v === undefined || v === '' ? '—' : v;

/**
 * 호실을 지울 수 있는가 — **누르기 전에** 화면이 안다.
 *
 * ★ 서버가 다시 보지만(`routes/facility.ts`), 못 지울 버튼을 눌러 보게 하지 않는다.
 *   판정의 근거는 **이력 전체**다. 종료된 계약도 지난 계약서가 그 호실을 가리킨다.
 */
export function spaceBlockReason(space: Space): string | null {
  if (space.allContracts === 0) return null;
  const live = space.liveContracts > 0 ? ` (지금 계약중·계약대기 ${space.liveContracts}건 포함)` : '';
  return `계약 ${space.allContracts}건에서 사용한 호실입니다${live} — 지우면 지난 계약서의 호실이 비어 버립니다. 더 쓰지 않으시려면 「사용 안 함」으로 바꿔 주세요`;
}

/** 회의실을 지울 수 있는가. ★ 취소된 예약만 있으면 지울 수 있다. */
export function meetingRoomBlockReason(room: MeetingRoom): string | null {
  if (room.liveReservations === 0) return null;
  return `예약 ${room.liveReservations}건이 걸려 있습니다 — 예약을 먼저 취소하거나 「예약 받지 않음」으로 바꿔 주세요`;
}

/* ══════════════════════════════════════════════════════════════════════════
   건물·층 첨부 (2026-10-03)
   ══════════════════════════════════════════════════════════════════════════
   ★★ **계약 서류와 같은 기계다.** `tb_cm_file` 에 `target_type` 두 값이 늘었을 뿐이고
      (`BUILDING`·`FLOOR`), 올리는 순서·바꿔치기·서명 URL 은 서버 쪽 한 코드가 한다.
      규칙(형식·크기)은 `@swonbiz/shared/domain/facility-files` 가 갖는다 — 화면이
      다시 적지 않는다.

   ★ 종류를 보내지 않는다. 대상당 서류가 한 가지뿐이라 서버가 안다(`?purpose=` 없음).
   ══════════════════════════════════════════════════════════════════════════ */

/** 첨부가 붙는 대상. 주소 조각이 그대로 이 값이다. */
export type AttachKind = 'buildings' | 'floors';

/** `GET /api/facility/{kind}/:id/files` 의 한 줄. */
export interface FacilityFile {
  fileId: string;
  purpose: string;
  originalName: string;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string;
  /** ★ 서명 URL. **만료된다** — state 에 오래 두지 않고 열 때 다시 받는다. */
  url: string | null;
}

const filesPath = (kind: AttachKind, id: string) =>
  `/api/facility/${kind}/${encodeURIComponent(id)}/files`;

export const loadFacilityFiles = (kind: AttachKind, id: string) =>
  call<{ files: FacilityFile[] }>(filesPath(kind, id));

/**
 * 올린다. 같은 서류가 이미 있으면 **바꿔치운다**(`replaced: true`).
 *
 * ★ 본문이 **파일 바이트 그대로**다 — JSON 이 아니다. 원본 이름은 헤더로 보내고,
 *   한글 이름은 반드시 인코딩한다(안 하면 프록시가 끊는다).
 */
export const uploadFacilityFile = (kind: AttachKind, id: string, file: File) =>
  call<{ file: FacilityFile; replaced: boolean }>(filesPath(kind, id), {
    method: 'POST',
    headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  });

export const removeFacilityFile = (kind: AttachKind, id: string, fileId: string) =>
  call<Record<string, never>>(`${filesPath(kind, id)}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  });
