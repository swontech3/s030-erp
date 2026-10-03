/**
 * 건물·층 첨부 — **계약 서류와 같은 기계를 쓴다**(2026-10-03).
 *
 * =============================================================================
 * ★★★ 새 기계를 만들지 않았다 — `tb_cm_file` 에 `target_type` 을 두 개 더했을 뿐이다
 * =============================================================================
 * 레거시는 건물·층 첨부를 **테이블 컬럼**에 넣었다 —
 * `tb_s080_buildings.contract_doc_url` · `tb_s080_floors.floor_plan_url` 에 주소를
 * 문자열로 박아 두는 방식이다. 그 길은 두 가지가 이미 깨져 있었다:
 *
 *   ① 주소가 **만료된다.** 비공개 버킷의 서명 URL 을 DB 에 저장하면 5분 뒤 전부 죽은
 *      링크가 된다(레거시 결함 ②, `routes/files.ts` 머리말).
 *   ② 파일 한 장의 **원본 이름·크기·형식·올린 사람**을 둘 곳이 없다.
 *
 * 그래서 ERP 의 첨부 기계를 그대로 쓴다. 바뀐 것은 `target_type` 두 값뿐이고,
 * 올리는 순서·되돌리기·서명 URL·운영사 전용 잠금은 **계약 서류와 같은 코드**가 한다
 * (`routes/files.ts` 의 순서 규칙, `db/files.ts` 의 DELETE+INSERT).
 *
 *     ★ 레거시의 두 컬럼은 **건드리지 않는다.** 지금 아무 코드도 읽지 않고(실측
 *       2026-10-03), 거기에도 쓰면 같은 사실이 두 곳에 남아 갈린다.
 *
 * =============================================================================
 * ★★ 형식·크기 규칙을 **다시 적지 않는다**
 * =============================================================================
 * `rejectBytes` 를 부른다 — 계약 서류가 쓰는 그 함수다. JPG·PNG·PDF · 10MB 는
 * 버킷 `erp-files` 설정과 같은 값이어야 하고, 두 벌이 되면 한쪽만 고쳐지는 날이 온다.
 *
 * =============================================================================
 * ★ 둘 다 **선택**이다 — 없어도 저장된다
 * =============================================================================
 * 계약 서류에는 「필수」가 있고(계약확정 게이트) 여기에는 없다. 건물·층은 운영사가
 * 자기 기준자료를 넣는 자리이고, 임대차계약서가 아직 손에 없어도 건물은 등록해야 한다.
 * 그래서 `missingRequiredDocs` 같은 게이트를 두지 않았다 — 막을 것이 없다.
 */
import { extensionFor, rejectBytes } from './contract-files.ts';

/**
 * `tb_cm_file.target_type` — 건물과 층.
 *
 * ★ DB 에 CHECK 제약이 없다(실측 2026-10-03: `tb_cm_file` 의 제약은 PK 와 operator_id
 *   FK 둘뿐이다). 그래서 **허용값을 아는 곳이 이 파일뿐이다** — 서버가 이 목록으로
 *   판정한다. 값을 늘릴 때 여기만 보면 된다.
 */
export const FILE_TARGET_BUILDING = 'BUILDING';
export const FILE_TARGET_FLOOR = 'FLOOR';

export const FACILITY_TARGETS = [FILE_TARGET_BUILDING, FILE_TARGET_FLOOR] as const;
export type FacilityTarget = (typeof FACILITY_TARGETS)[number];

/**
 * 서류 종류 — 대상당 **한 가지씩**이다.
 *
 * ★ 값이 `tb_cm_file.file_purpose` 에 그대로 들어간다. 레거시에는 대응하는 값이
 *   **없다**(컬럼에 담았으므로 purpose 라는 개념이 없었다). 그래서 레거시 문자열을
 *   물려받을 것이 없고, 컬럼 이름을 그대로 대문자로 옮겼다 —
 *   `contract_doc_url` → `BUILDING_CONTRACT` · `floor_plan_url` → `FLOOR_PLAN`.
 *
 * ★ 대상당 한 장은 **DB 가 지킨다** — 020 의 유일 인덱스
 *   `tb_cm_file_target_purpose_uk (target_type, target_id, file_purpose)` 다.
 *   같은 건물에 임대차계약서를 또 올리면 계약 서류와 똑같이 **바꿔치운다.**
 */
export const FACILITY_PURPOSE: Readonly<Record<FacilityTarget, string>> = {
  BUILDING: 'BUILDING_CONTRACT',
  FLOOR: 'FLOOR_PLAN',
};

/** 화면에 뜨는 이름과 설명. 두 곳(팝업 p1·p2)이 이 값을 쓴다. */
export const FACILITY_DOC: Readonly<Record<FacilityTarget, { name: string; desc: string }>> = {
  BUILDING: { name: '임대차계약서', desc: '건물주와 맺은 임대차계약서 사본 · 선택' },
  FLOOR: { name: '층별 도면', desc: '호실 배치가 보이는 평면도 · 선택' },
};

/** 이 대상에서 쓰는 `file_purpose`. 모르는 대상이면 `null` 이다. */
export function facilityPurposeFor(target: string): string | null {
  return isFacilityTarget(target) ? FACILITY_PURPOSE[target] : null;
}

export function isFacilityTarget(value: unknown): value is FacilityTarget {
  return typeof value === 'string' && (FACILITY_TARGETS as readonly string[]).includes(value);
}

/**
 * 올려도 되는가. 통과면 `null`, 아니면 **사용자에게 보여줄 문구**.
 *
 * ★ 회원구분 같은 조건이 없다 — 건물·층 첨부는 누가 올리든 같은 서류다. 남는 것은
 *   형식·크기이고 그것은 계약 서류와 **같은 함수**가 본다.
 */
export function rejectFacilityUpload(c: {
  target: string;
  purpose: string;
  mimeType: string;
  size: number;
}): string | null {
  if (!isFacilityTarget(c.target)) return '알 수 없는 첨부 대상입니다';
  if (c.purpose !== FACILITY_PURPOSE[c.target]) return '알 수 없는 서류 종류입니다';
  return rejectBytes(c.mimeType, c.size);
}

/**
 * 버킷 안의 경로. **계약 서류와 같은 모양**이다 —
 * `{operatorId}/{buildings|floors}/{targetId}/{PURPOSE}/{fileId}.{ext}`
 *
 * ★ 운영사 번호로 시작하는 이유는 `storagePathFor` 와 같다 — 나중에 스토리지 정책을
 *   경로 접두사로 가를 수 있다.
 *
 * ★ 원본 파일 이름을 경로에 쓰지 않는다. 「우리빌딩_임대차계약서.pdf」가 URL 에 실릴
 *   이유가 없다 — 그 이름은 `original_name` 에만 둔다.
 */
export function facilityStoragePathFor(args: {
  operatorId: number;
  target: FacilityTarget;
  targetId: string;
  fileId: string;
  mimeType: string;
}): string {
  const folder = args.target === FILE_TARGET_BUILDING ? 'buildings' : 'floors';
  const purpose = FACILITY_PURPOSE[args.target];
  const ext = extensionFor(args.mimeType);
  return `${args.operatorId}/${folder}/${args.targetId}/${purpose}/${args.fileId}.${ext}`;
}
