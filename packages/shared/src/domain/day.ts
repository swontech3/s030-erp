/**
 * 날짜 한 칸 — `YYYY-MM-DD` 하나를 읽고 쓰는 자리.
 *
 * =============================================================================
 * ★★★ 규칙 둘이 전부이고, 둘 다 조용히 틀리는 종류다
 * =============================================================================
 * ① **없는 날짜를 통과시키지 않는다.** `new Date(Date.UTC(2026, 1, 31))` 은 오류가
 *    아니라 **3월 3일**을 준다. 형식만 보고 넘기면 계약 시작일이 말없이 바뀐다.
 *
 * ② **UTC 로 센다.** 로컬로 세면 시간대에 따라 하루가 밀리고, 계약 시작일이 밀리면
 *    종료일과 첫 청구월이 함께 밀린다.
 *
 * ★★ `parseDay` 는 **ISO 전체 문자열을 받지 않는다.** `2026-12-31T15:00:00.000Z` 는
 *    KST 로 다음 날 자정이라, 앞 10자를 잘라 쓰면 하루 앞선 날짜가 된다. 그 실수를
 *    막는 방법은 「자를 수 있게」 두지 않는 것이다 — 부르는 쪽이 먼저 로컬 날짜로
 *    바꿔서 넘긴다(웹의 `toDateInput`).
 *
 * ★ 같은 규칙이 계약 여러 곳에 퍼져 있어 한 곳으로 모았다 — 재계약 시작일,
 *   기간 만료 판정, [계약종료] 기본값. 두 벌로 두면 한쪽만 고쳐져 갈린다.
 *
 * ★ 계약 저장 경로(`routes/contracts.ts` 의 `parseDate`)는 **던지는** 변형이다.
 *   거기는 400 으로 바꿔 내보내야 해서 `null` 이 아니라 예외가 필요하다.
 */

/** `YYYY-MM-DD` → UTC 자정의 `Date`. 형식이 틀리거나 **없는 날짜**면 `null`. */
export function parseDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  // ★ 여기가 ① 이다. Date.UTC 가 넘겨 버린 값을 되돌려 보고 잡는다.
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return at;
}

/** `Date` → `YYYY-MM-DD`. **UTC 기준**이다(위 ②). */
export function toDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → 그 **다음 날**. 읽을 수 없으면 `null`. */
export function dayAfter(iso: string): string | null {
  const at = parseDay(iso);
  if (at === null) return null;
  at.setUTCDate(at.getUTCDate() + 1);
  return toDay(at);
}

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ `Date` 끼리 비교할 때는 **로컬**이다 — 위 ②와 반대다
   ══════════════════════════════════════════════════════════════════════════
   위의 `parseDay`·`dayAfter` 는 **문자열**(`YYYY-MM-DD`)을 다룬다. 문자열에는
   시간대가 없으니 UTC 로 만들어 두면 흔들릴 것이 없다.

   `Date` 는 사정이 다르다. pg 는 `date`/`timestamp` 를 **로컬 자정의 Date** 로 주고,
   그 값의 UTC 날짜는 **하루 앞**이다(KST 기준 `...T15:00:00.000Z`). 반면
   「오늘」(`new Date()`)은 낮 시간대에 UTC 날짜와 로컬 날짜가 **같다.**
   즉 **둘의 어긋남이 서로 다르다** — UTC 로 세면 한쪽만 밀린다.

   증상: 같은 계약이 아침에는 만료로, 자정 직후에는 아닌 것으로 읽힌다.
   실제로 그랬다(2026-09-21, 「기간 만료」 칩을 붙이다 드러났다).
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 두 `Date` 의 **일수** 차이(`to - from`). 시:분:초를 버리고 **로컬 날짜**로 센다.
 *
 * ★ pg 가 주는 날짜와 「오늘」을 비교하는 자리는 전부 이 함수를 쓴다.
 *   `new Date(y, m, d)` 가 정의상 로컬 자정이라 pg 가 주는 모양과 같다.
 */
export function daysBetweenLocal(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  // 서머타임이 있는 지역에서는 나누어떨어지지 않는다 — 반올림으로 하루 단위를 지킨다.
  return Math.round((b - a) / 86_400_000);
}
