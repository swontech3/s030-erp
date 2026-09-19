/**
 * 계약 상태 표시명 — **코드 테이블에서 온다**(`CONTRACT_ST` / `use_tp='000'`).
 *
 * =============================================================================
 * ★ 이 파일이 바꾸는 것은 **이름뿐이다**
 * =============================================================================
 * 저장값(`draft`·`confirmed`·`terminated`·`cancelled`)도, 전이 규칙도, 섹션 잠금도
 * 여기서 손대지 않는다. 그쪽은 `@swonbiz/shared/domain/contract-status` 가 판정한다.
 * 화면이 「무엇으로 부르는가」만 여기로 모았다 — 예전에는 목록·폼·모달이 각자
 * 「대기 / 진행중 / 종료 / 취소」를 들고 있어서 같은 상태를 세 이름으로 불렀다.
 *
 * =============================================================================
 * ★ 「만료」는 여기 없다 — **코드가 아니라 날짜다**
 * =============================================================================
 * `confirmed` 인데 종료일이 지난 계약을 화면이 「만료」로 부른다. 저장된 상태값은
 * 그대로 `confirmed` 다. 코드 테이블에 넣으면 저장되지 않는 상태가 코드 목록에
 * 끼어든다 — 판정은 `tenant-model.contractStatusLabel` 이 계속 한다.
 *
 * =============================================================================
 * ★ 코드를 못 받아도 **빈 칸이 되지 않는다**
 * =============================================================================
 * `/codes` 는 실패해도 화면을 열도록 되어 있다(`codesRes.ok ? … : []`). 그때 뱃지가
 * 빈 칸이 되면 상태를 읽을 수 없는 목록이 된다. 그래서 아래 기본값을 깔고 코드가
 * 오면 덮는다. 기본값에도 없는 값(새 상태가 DB 에만 생긴 경우)은 **코드값 자체**를
 * 보여준다 — 틀린 이름보다 낫다.
 */
import type { CodeOption } from './form-model';

export const CONTRACT_ST_CATEGORY = 'CONTRACT_ST';

/**
 * 코드를 못 받았을 때 쓰는 이름. **DB 의 `CONTRACT_ST 000` 과 같은 값으로 적어 둔다.**
 * 여기가 정본이 아니다 — 코드 테이블이 정본이고 이건 최후의 방어다.
 */
const FALLBACK_NAMES: Readonly<Record<string, string>> = {
  draft: '계약대기',
  confirmed: '계약중',
  terminated: '계약종료',
  cancelled: '계약취소',
};

/** 상태값 → 표시명 사전. `/codes` 응답(카테고리별 행 목록)에서 만든다. */
export function contractStatusNamesOf(codes: readonly CodeOption[]): Readonly<Record<string, string>> {
  const names: Record<string, string> = { ...FALLBACK_NAMES };
  for (const c of codes) {
    if (c.category === CONTRACT_ST_CATEGORY) names[c.code] = c.name;
  }
  return names;
}

/** 사전에서 하나 꺼낸다. 없으면 코드값 자체 — 빈 칸을 만들지 않는다. */
export function contractStatusName(
  names: Readonly<Record<string, string>>,
  status: string,
): string {
  return names[status] ?? FALLBACK_NAMES[status] ?? status;
}

/**
 * `카테고리:코드 → 이름` 사전에서 바로 꺼내는 형태.
 *
 * s0300200030 은 코드를 행 목록이 아니라 이 모양으로 들고 있다(`page.tsx` 가 그렇게
 * 묶는다). 두 화면이 같은 이름을 쓰게 하려고 입구만 둘로 냈다.
 */
export function contractStatusNameFromMap(
  codeNames: Readonly<Record<string, string>>,
  status: string,
): string {
  return codeNames[`${CONTRACT_ST_CATEGORY}:${status}`] ?? FALLBACK_NAMES[status] ?? status;
}
