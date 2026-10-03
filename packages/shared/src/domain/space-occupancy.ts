/**
 * 호실 입주 현황 — **판정만** 한다. DB 도 화면도 여기서 만지지 않는다.
 *
 * =============================================================================
 * ★★ 한 호실에 몇 곳까지 들어가는지는 **호실마다 운영자가 정한다**
 * =============================================================================
 * `tb_s080_spaces.max_companies` — 「입주 가능 회사 수」(센터 관리 p3). 들어 있는
 * 곳이 그 수보다 **적을 때만** 고를 수 있다.
 *
 *     max 1  아무도 없어야 고른다        (지금 비상주 50실과 기본값 72실이 이 모양)
 *     max 2  1곳까지 있어도 고른다
 *
 * ★★ 2026-10-03 까지는 이 수가 **코드에 박혀 있었다** — 비상주는 1곳, 그 외는 전부
 *    2곳. 3인실과 자유석이 같은 2곳이었다. 지금은 그 수가 호실에서 온다.
 *
 * ★★ **비상주 특례를 없앴다.** 규칙이 둘이면 운영자가 넣은 수가 50실에서 조용히
 *    무시된다 — 칸은 보이는데 효과가 없는 것이 가장 나쁘다. 비상주도 기본 1 이라
 *    동작은 그대로이고, 2 이상으로 올릴 때 화면이 「같은 주소로 두 사업자가 등록
 *    됩니다」를 알린다(`SpaceDialog`).
 *
 * 자리가 남아 목록에 남기는 것은 «같이 쓸 수 있다»는 뜻이고, 그때는 **누가 쓰고
 * 있는지 이름을 함께 보여준다**(`spaceOptionLabel`). 모르고 겹치는 것과 알고 겹치는
 * 것은 다르다.
 *
 * =============================================================================
 * ★★★ 세는 단위는 **회사**다 — 계약이 아니다
 * =============================================================================
 * 한 회사가 같은 호실을 두 계약으로 잡아도 **1곳**이다(`occupancyBySpace` 가 회사로
 * 접는다). 그래서 칸 이름이 「건수」가 아니라 「입주 가능 회사 수」다 — 「건수」는
 * 계약서 장수로 읽히고, 그러면 재계약 직후처럼 계약이 겹치는 순간에 한 회사가 두
 * 곳으로 세어진다.
 *
 * ★★ 그래서 세는 것은 **「다른 회사」**다. 지금 계약을 쓰는 회사는 이미 그 자리를
 *    쓰고 있어 둘째 계약이 자리를 더 먹지 않는다 — `selfCompanyId` 가 그 자리다.
 *
 * =============================================================================
 * ★★ 규칙이 여기 하나뿐이다
 * =============================================================================
 *   화면  `SectionContract`      — 셀렉트에 무엇을 보일지
 *   서버  `routes/contracts.ts`  — 저장을 받아도 되는지 (화면을 믿지 않는다)
 *
 * 두 벌이면 언젠가 갈리고, 그때 화면은 통과시키는데 서버가 거절한다 — 또는 더 나쁘게,
 * 화면이 막는 것을 서버가 받는다.
 *
 * =============================================================================
 * ★★★ **자기 계약은 세지 않는다**
 * =============================================================================
 * 세면 자기 계약을 열어 그대로 저장할 때 **자기 호실이 목록에서 사라진다.** 값이
 * 사라진 셀렉트는 빈 줄로 저장되고, 아무도 그걸 눈치채지 못한다.
 * `occupancyBySpace` 의 `selfContractId` 가 그 자리다.
 */
import { ROOM_LIVE_STATUSES } from './contract-room.ts';

/**
 * 입주로 세는 계약 상태.
 *
 * ★ 계약호실(`contract-room`)과 **일부러 같은 목록**이다. 「살아 있는 계약」의 정의는
 *   하나여야 한다 — 한쪽만 고치면 호실은 비었다는데 계약호실은 쓰고 있다고 나온다.
 */
export const OCCUPANCY_LIVE_STATUSES = ROOM_LIVE_STATUSES;

/**
 * 비상주 계약구분 코드(`ROOM_TP`).
 *
 * ★ 비상주는 **주소만 쓰는 계약**이다. 한 호실에 두 회사가 들어가면 같은 주소로 두
 *   사업자가 등록된다.
 *
 * ★★ **고를 수 있느냐를 여기서 정하지 않는다** — 그것은 「입주 가능 회사 수」 하나다.
 *    이 코드가 남아 있는 이유는 운영자가 비상주 호실의 수를 2 이상으로 올릴 때
 *    화면이 **알려 주기** 위해서다(`warnVirtualShared`).
 */
export const VIRTUAL_ROOM_TYPE = 'VR';

export function isVirtualRoomType(roomType: string): boolean {
  return roomType.trim() === VIRTUAL_ROOM_TYPE;
}

/** 입주 가능 회사 수의 **최솟값**. 0 이면 아무도 고를 수 없는 방이 된다. */
export const MIN_MAX_COMPANIES = 1;

/** 새 호실의 기본값. 72실 전부 이 값으로 들어갔다(마이그레이션 033). */
export const DEFAULT_MAX_COMPANIES = 1;

/**
 * 호실이 준 수를 믿을 수 있는 수로 만든다 — 값이 없거나 1 미만이면 **기본값**이다.
 *
 * ★ 화면과 서버가 같이 부른다. 한쪽만 느슨하면 목록에는 뜨는데 저장이 막힌다.
 */
export function maxCompaniesOf(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_MAX_COMPANIES
    ? Math.trunc(value)
    : DEFAULT_MAX_COMPANIES;
}

/**
 * 비상주 호실을 두 곳 이상에게 열 때 보여줄 말 — 막지 않고 **알린다.**
 * 통과면 `null`.
 */
export function warnVirtualShared(roomType: string, maxCompanies: number): string | null {
  return isVirtualRoomType(roomType) && maxCompanies > 1
    ? `비상주는 주소만 쓰는 계약입니다 — ${maxCompanies}곳으로 두면 같은 주소로 사업자 ${maxCompanies}곳이 등록됩니다`
    : null;
}

/** 호실 하나를 붙들고 있는 계약 줄 하나. */
export interface SpaceHolder {
  spaceId: string;
  contractId: string;
  companyId: string;
  companyName: string;
}

export interface SpaceOccupancy {
  /**
   * 들어 있는 **다른 회사** 수. 줄 수가 아니다 — 한 회사가 두 줄을 잡아도 1곳이고,
   * 지금 계약을 쓰는 회사는 아예 세지 않는다(`occupancyBySpace` 의 `selfCompanyId`).
   */
  count: number;
  /** 회사 이름 전부. 화면이 「Room 1 (가나 · 다라)」로 누가 쓰는지 보여준다. */
  companyNames: string[];
}

export const EMPTY_OCCUPANCY: SpaceOccupancy = { count: 0, companyNames: [] };

/**
 * 호실별 입주 현황을 만든다 — **다른 회사가 몇 곳 들어 있는가**.
 *
 * ★ **회사 단위로 센다.** 한 회사가 같은 호실을 여러 줄(또는 여러 계약)로 잡고 있어도
 *   1곳이다. 줄로 세면 재계약 직후처럼 계약이 겹치는 순간에 2곳으로 보인다.
 *
 * ★★★ `selfCompanyId` — **지금 계약을 쓰는 회사는 세지 않는다.** 그 회사는 이미 그
 *    자리를 쓰고 있으므로 둘째 계약이 자리를 **더 먹지 않는다**(결정 2026-10-03:
 *    「한 회사의 계약 둘은 1 이다」). 세면 1곳짜리 호실에서 같은 회사가 계약을 하나 더
 *    맺는 길이 막히는데, 그것은 「회사 수로 센다」와 어긋난다.
 *
 * ★ `selfContractIds` 의 줄도 **빼고** 센다. 위 ★★★ 참고. 회사까지 빼면 대개
 *   겹치지만, 입주사를 아직 안 고른 신규 계약에서는 이쪽만 쓸 수 있다.
 *
 * ★★ 「자기」가 하나가 아니다. 재계약은 이전 계약이 살아 있는 동안 만들어지고 같은
 *    호실을 이어받는다 — 이전 계약을 빼지 않으면 1곳짜리 호실이 「이미 사용 중」이 되어
 *    **재계약이 자기 이전 계약 때문에 막힌다.** 목록은 `contract-renewal` 의
 *    `selfContractIds` 가 만들고, 화면과 서버가 같이 부른다.
 */
export function occupancyBySpace(
  holders: readonly SpaceHolder[],
  selfContractIds: readonly string[],
  selfCompanyId?: string | null,
): Map<string, SpaceOccupancy> {
  /** spaceId → (companyId → companyName). 회사 단위로 접는 자리다. */
  const bySpace = new Map<string, Map<string, string>>();

  for (const h of holders) {
    if (selfContractIds.includes(h.contractId)) continue;
    if (selfCompanyId != null && selfCompanyId !== '' && h.companyId === selfCompanyId) continue;
    const companies = bySpace.get(h.spaceId) ?? new Map<string, string>();
    // 이름이 비어 있으면 덮어쓰지 않는다 — 한 줄이라도 이름이 있으면 그것을 보여준다.
    if (!companies.has(h.companyId) || companies.get(h.companyId) === '') {
      companies.set(h.companyId, h.companyName);
    }
    bySpace.set(h.spaceId, companies);
  }

  const out = new Map<string, SpaceOccupancy>();
  for (const [spaceId, companies] of bySpace) {
    out.set(spaceId, { count: companies.size, companyNames: [...companies.values()] });
  }
  return out;
}

/**
 * 이 줄에서 이 호실을 고를 수 있는가.
 *
 * ★★ 판정은 **한 줄**이다 — 들어 있는 곳이 호실이 정한 수보다 적으면 고른다.
 *    계약구분은 보지 않는다(비상주 특례를 없앴다 — 머리말 참고).
 *
 * ★ `pickedElsewhere` — **같은 계약 안에서 같은 호실을 두 줄에 넣는 것**도 막는다.
 *   두 줄이 되면 금액이 두 번 잡히고, 어느 줄이 진짜인지 아무도 모른다.
 *
 * ★ `maxCompanies` 를 안 주면 기본값(1)이다 — **느슨한 쪽으로 넘어가지 않는다.**
 *   목록에는 뜨는데 저장이 막히는 쪽이 훨씬 나쁘다.
 */
export function canPickSpace(args: {
  occupancy: SpaceOccupancy | undefined;
  maxCompanies?: number | null;
  pickedElsewhere?: boolean;
}): boolean {
  if (args.pickedElsewhere) return false;
  const occ = args.occupancy ?? EMPTY_OCCUPANCY;
  return occ.count < maxCompaniesOf(args.maxCompanies);
}

/**
 * 셀렉트에 뜨는 글자 — 「Room 1 (에스원3DP)」.
 *
 * ★ 들어 있는 곳이 있을 때만 이름을 붙인다. 0곳이면 붙일 이름이 없다.
 *
 * ★ 여러 곳이면 **전부** 적는다 — 운영자가 3곳까지 열어 둔 호실에서 한 곳만
 *   보여주면 나머지는 모르고 겹치는 것이 된다.
 */
export function spaceOptionLabel(roomName: string, occupancy: SpaceOccupancy | undefined): string {
  const occ = occupancy ?? EMPTY_OCCUPANCY;
  const names = occ.companyNames.filter((n) => n !== '');
  return names.length > 0 ? `${roomName} (${names.join(' · ')})` : roomName;
}

/** 판정에 필요한 호실 한 줄 — 이름과 「입주 가능 회사 수」. */
export interface SpaceLimit {
  roomName: string;
  maxCompanies: number | null;
}

/**
 * 저장을 받아도 되는지 — 통과면 `null`, 아니면 **사용자에게 보여줄 문구**.
 *
 * ★ 화면이 거르는 것과 **같은 규칙**(`canPickSpace`)이다. 여기는 화면을 우회한 요청을
 *   막는 자리다.
 *
 * ★★ 문구에 **몇 곳까지인지**를 적는다. 「이미 사용 중입니다」만으로는 운영자가 무엇을
 *    해야 하는지 알 수 없다 — 호실의 수를 올릴 수 있다는 것이 드러나야 한다.
 *
 * ★ 빈 호실 줄은 여기서 보지 않는다 — 그건 `buildContractWrite` 가 먼저 막는다.
 */
export function rejectSpacePick(
  rows: readonly { roomType: string; spaceId: string }[],
  occupancy: Map<string, SpaceOccupancy>,
  spaceOf: (spaceId: string) => SpaceLimit | undefined,
): string | null {
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.spaceId === '') continue;

    const space = spaceOf(row.spaceId);
    const name = space?.roomName || row.spaceId;

    if (seen.has(row.spaceId)) {
      return `${name} 을(를) 두 줄에 넣었습니다. 한 계약에서 같은 호실은 한 줄입니다`;
    }
    seen.add(row.spaceId);

    const occ = occupancy.get(row.spaceId) ?? EMPTY_OCCUPANCY;
    const max = maxCompaniesOf(space?.maxCompanies);
    if (canPickSpace({ occupancy: occ, maxCompanies: max })) continue;

    const who = occ.companyNames.filter((n) => n !== '').join(' · ');
    const whoPart = who === '' ? '' : ` (${who})`;
    return `${name} 은(는) ${max}곳까지 입주할 수 있습니다 — 이미 ${occ.count}곳이 사용 중입니다${whoPart}`;
  }

  return null;
}
