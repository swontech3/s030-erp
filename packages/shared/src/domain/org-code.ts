/**
 * 삐용 단체코드 채번 — `Z01` 부터 순번.
 *
 * =============================================================================
 * ★★★ Z 는 장식이 아니다
 * =============================================================================
 * 삐용은 **단체코드가 `Z` 로 시작하는 것을 보고 「ERP 가 만든 회사」로 알아본다**
 * (회신 5). 그래서 이 대역 밖의 코드를 발급하면 삐용 쪽에서 그 회사가 ERP 것인지
 * 알 수 없게 된다. 삐용 **부서코드도 이 코드를 접두사로 물려받으므로** 한번 발급된
 * 코드는 함부로 바꿀 수 없다.
 *
 * 그래서 소진됐을 때 `ZA0` 같은 코드를 즉흥적으로 만들지 않는다 — `null` 을 주고 멈춘다.
 * 대역을 넓히는 것은 삐용과 합의할 일이다.
 *
 * =============================================================================
 * 한계 — 99개다
 * =============================================================================
 * 삐용 단체코드는 **3자리**이고(`영문/숫자 3자리`) 그중 첫 자리가 `Z` 로 고정되므로
 * 숫자 2자리 = `Z01`~`Z99` 99개가 전부다. 그 이상이 필요해지면 대역 확장을 삐용에
 * 요청해야 한다 — 이 파일이 조용히 늘리지 않는다.
 *
 * ★ 순수 함수다. DB 도 삐용도 모른다 — 「이미 쓰인 코드 목록」을 받아서 다음 것을 고를 뿐이다.
 */

/** 첫 번호. `Z00` 이 아니라 `Z01` 부터다 — 사람이 1부터 센다. */
export const FIRST_ORG_CODE = 'Z01';

/** 마지막 번호. 이 다음은 없다. */
export const LAST_ORG_CODE = 'Z99';

const PATTERN = /^Z[0-9]{2}$/;

/** ERP 가 발급한 코드인가. ★ 아니면 채번이 건드리지 않는다(삐용 화면에서 손으로 만든 회사들이다). */
export function isErpOrgCode(code: string): boolean {
  return PATTERN.test(code);
}

/** 코드 → 번호(1~99). ERP 코드가 아니면 `null`. */
function toSeq(code: string): number | null {
  const trimmed = code.trim().toUpperCase();
  if (!isErpOrgCode(trimmed)) return null;
  return Number(trimmed.slice(1));
}

/** 번호(1~99) → 코드. 범위를 벗어나면 `null`. */
function toCode(seq: number): string | null {
  if (!Number.isInteger(seq) || seq < 1 || seq > 99) return null;
  return `Z${String(seq).padStart(2, '0')}`;
}

/**
 * 이 코드 다음 번호. **삐용이 「이미 사용중인 단체코드」로 거절했을 때** 쓴다.
 *
 * ★ 거절 응답의 `data.orgId` 를 **가져다 쓰지 않는다.** 그 회사는 우리가 만들려던
 *   회사가 아닐 수 있다 — 같은 코드를 이미 쓰는 **남의 회사**일 수 있고, 그 org_id 를
 *   우리 입주사에 연결하면 그 입주사가 남의 데이터를 보게 된다(격리의 뿌리가
 *   `link_s020_org_id` 하나다). 그래서 번호만 올려 다시 시도한다.
 */
export function nextOrgCode(code: string): string | null {
  const seq = toSeq(code);
  if (seq === null) return null;
  return toCode(seq + 1);
}

/**
 * 아직 안 쓰인 첫 번호. 99개를 다 썼으면 `null`.
 *
 * ★★ **최대값+1 이 아니라 「빈 자리 중 가장 앞」이다.** 입주사를 지우면 그 번호가
 *    비는데, 최대값+1 로만 가면 99개를 금방 태운다. 삐용 쪽에 그 코드의 회사가 남아
 *    있으면 중복으로 거절되고 그때 다음 번호로 넘어가므로(`nextOrgCode`), 구멍을
 *    먼저 시도하는 쪽이 안전하다.
 */
export function firstFreeOrgCode(taken: readonly string[]): string | null {
  const used = new Set<number>();
  for (const code of taken) {
    const seq = toSeq(code);
    if (seq !== null) used.add(seq);
  }
  for (let seq = 1; seq <= 99; seq += 1) {
    if (!used.has(seq)) return toCode(seq);
  }
  return null;
}
