/**
 * 입주사·계약 목록(s0300200030)의 **화면 상태를 주소에 담는 규칙.**
 *
 * =============================================================================
 * ★★ 왜 주소인가 — [이전] 으로 돌아왔을 때 떠나기 전 화면이어야 한다
 * =============================================================================
 * 켜진 칩·검색어·선택한 입주사는 원래 컴포넌트 상태에만 있었다. 계약 폼으로 넘어가면
 * 컴포넌트가 내려가면서 같이 사라지고, [이전] 으로 돌아오면 **기본값으로 다시 그려진다.**
 * 주소가 같아도 화면이 달랐다 — 그래서 「온 곳으로 돌아간다」는 검사를 통과하면서도
 * 사람은 처음부터 다시 걸러야 했다.
 *
 * 주소에 담으면 세 가지가 한꺼번에 해결된다.
 *   · [이전] — 브라우저가 주소를 되돌리면 화면이 따라온다
 *   · 새로고침 — 같은 주소라 같은 화면이다
 *   · 링크 공유 — 「이 조건으로 걸러진 목록」을 그대로 보낼 수 있다
 *
 * =============================================================================
 * ★★★ 「칩 없음」과 「칩 전부 해제」는 **다른 상태다**
 * =============================================================================
 *   주소에 `chips` 가 없다    첫 방문이다 → 기본 칩(만기 임박 · 기간 만료)
 *   `chips=all`               사람이 [전체] 를 눌렀다 → 아무것도 거르지 않는다
 *
 * 둘을 같은 것으로 읽으면 [전체] 를 누르고 계약에 들어갔다 [이전] 로 돌아왔을 때
 * 기본 칩이 다시 켜진다 — 고치려던 증상이 그대로 남는다. 그래서 «빈 목록»을
 * 파라미터 없음으로 적지 않고 **`all` 이라고 써 둔다.**
 *
 * ★ 사람이 한 번이라도 목록을 만졌으면 `chips` 는 **늘 적힌다**(`tenantListSearch`).
 *   기본값과 같아도 생략하지 않는다 — 생략하면 위의 구분이 다시 무너진다.
 */
import type { TenantFilterKey } from './tenant-status';

/** 주소에 쓰는 이름. 화면과 이 파일이 같은 문자열을 보도록 한 곳에 둔다. */
export const TENANT_LIST_PARAM = {
  chips: 'chips',
  keyword: 'q',
  company: 'companyId',
} as const;

/** 「아무것도 거르지 않는다」 — 빈 문자열은 도구·프록시가 지우기 쉬워 이름을 준다. */
export const ALL_CHIPS = 'all';

/** 칩의 정본 순서. 주소 문자열이 누를 때마다 뒤섞이지 않게 여기서 한 번 정한다. */
export const CHIP_ORDER: readonly TenantFilterKey[] = ['active', 'soon', 'expired', 'review', 'ended'];

export interface TenantListState {
  chips: readonly TenantFilterKey[];
  keyword: string;
  companyId: string | null;
}

/** `useSearchParams()` 와 `URLSearchParams` 둘 다 이 모양이라 그것만 받는다. */
export interface ReadableParams {
  get(name: string): string | null;
}

const isChipKey = (v: string): v is TenantFilterKey => (CHIP_ORDER as readonly string[]).includes(v);

/** 정본 순서로 줄 세우고 중복을 없앤다. */
export function sortChips(keys: readonly TenantFilterKey[]): TenantFilterKey[] {
  return CHIP_ORDER.filter((k) => keys.includes(k));
}

/**
 * 주소 → 화면 상태.
 *
 * ★ `defaults` 는 화면이 들고 있는 기본 칩이다. 이 파일이 기본값을 정하지 않는다 —
 *   무엇이 「할 일」인지는 화면의 결정이고 바뀔 수 있다(`DEFAULT_CHIPS`).
 *
 * ★★ `chips` 가 없는데 `companyId` 가 있으면 **거르지 않는다.** 계약 폼이 「이미
 *    계약중인 입주사입니다」와 함께 주는 링크가 그 모양인데, 기본 칩을 켜면 그 입주사가
 *    걸러져 **링크를 따라왔는데 아무것도 안 보이는** 일이 난다.
 */
export function parseTenantListParams(
  params: ReadableParams,
  defaults: readonly TenantFilterKey[],
): TenantListState {
  const raw = params.get(TENANT_LIST_PARAM.chips);
  const companyId = params.get(TENANT_LIST_PARAM.company) || null;

  let chips: TenantFilterKey[];
  if (raw === null) {
    // 첫 방문. 단, 입주사를 짚어 주는 링크로 들어왔으면 거르지 않는다.
    chips = companyId ? [] : sortChips(defaults);
  } else if (raw.trim().toLowerCase() === ALL_CHIPS) {
    chips = [];
  } else {
    // 모르는 값은 조용히 버린다 — 주소는 사람이 손으로 고칠 수 있는 자리다.
    chips = sortChips(raw.split(',').map((s) => s.trim()).filter(isChipKey));
  }

  return { chips, keyword: params.get(TENANT_LIST_PARAM.keyword) ?? '', companyId };
}

/**
 * 화면 상태 → 주소의 `?…` 부분. 앞의 `?` 를 포함하고, 담을 것이 없으면 빈 문자열이다.
 *
 * ★ `chips` 는 늘 적는다(위 머리말). `q` 와 `companyId` 는 값이 있을 때만 적는다 —
 *   빈 검색어까지 적으면 주소가 읽기 어려워지고, 없는 것과 빈 것이 같은 뜻이라 잃는 게 없다.
 */
export function tenantListSearch(state: TenantListState): string {
  const sp = new URLSearchParams();
  sp.set(TENANT_LIST_PARAM.chips, state.chips.length ? sortChips(state.chips).join(',') : ALL_CHIPS);
  if (state.keyword !== '') sp.set(TENANT_LIST_PARAM.keyword, state.keyword);
  if (state.companyId) sp.set(TENANT_LIST_PARAM.company, state.companyId);
  const s = sp.toString();
  return s ? `?${s}` : '';
}
