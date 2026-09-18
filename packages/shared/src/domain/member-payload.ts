/**
 * 입주자 사용자(구성원) 저장 페이로드 — 계약 폼 섹션 3 이 올리는 값.
 *
 * ★ `contract-payload.ts` 와 같은 자리다. **화면 값을 믿지 않는다** — 상한도 대표자
 *   판정도 여기서 다시 한다. 화면이 막는 것은 편의이고, API 를 직접 부르는 경로가
 *   늘 열려 있다.
 */

/**
 * 구성원 최대 행수 — `03-contract-form.md` 섹션 3 「최대 20행」.
 * ★ 화면도 이 값에서 [사용자 추가]를 비활성화한다. 숫자를 두 곳에 적지 않는다.
 */
export const MAX_MEMBERS = 20;

/**
 * `is_representative` 의 값 — ★ **「여부」가 아니라 코드다.**
 *
 * 컬럼 이름이 `is_representative` 이고 주석이 「대표자 여부」라 boolean 으로 읽히지만
 * 실제 타입은 `varchar(1)` 이고 기본값이 `'M'` 이다. 레거시 앱이
 * `isRepresentative === "C"` 로 비교하고 `e.isRepresentative ? "C" : "M"` 로 저장한다
 * (S-WonERP `api/contracts/route.ts`). 코드 `RES_TP` 의 `C 입주사 대표` · `M 입주사 직원`
 * 과 같은 어휘다.
 *
 * ★ `true`/`'Y'` 를 넣으면 조용히 「직원이 아닌 무언가」가 된다. 여기를 거쳐서만 쓴다.
 */
export const MEMBER_ROLE = {
  /** 입주사 대표. 계약서·세금계산서에 찍히고 삐용 계정을 받는 사람이다. */
  REPRESENTATIVE: 'C',
  /** 입주사 직원. */
  STAFF: 'M',
} as const;

export type MemberRole = (typeof MEMBER_ROLE)[keyof typeof MEMBER_ROLE];

/** 화면이 올리는 한 줄. `memberId` 가 없으면 새 사람이다. */
export interface MemberInput {
  memberId?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  /** 화면의 대표자 체크박스. 코드값이 아니라 boolean 으로 받는다. */
  isRepresentative?: boolean;
  memo?: string | null;
}

/** 저장할 한 줄. */
export interface MemberRowWrite {
  memberId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  /** 코드 `'C'` / `'M'`. */
  isRepresentative: MemberRole;
  memo: string | null;
}

function optionalText(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * 화면 페이로드 → 저장할 행들.
 *
 * 던지는 경우: 20행 초과 · 이름이 빈 줄.
 *
 * ★★ **대표자는 정확히 한 명으로 맞춘다.**
 *   여럿이 올라오면 **첫 번째만** 대표이고 나머지는 직원이 된다. 아무도 없으면
 *   **첫 줄**이 대표다. 던지지 않는 이유 — 화면은 라디오처럼 동작해 한 명을 보장하고,
 *   그래도 어긋난 페이로드는 «대표가 없는 회사»로 저장되는 것보다 고쳐서 넣는 편이
 *   덜 위험하다. 계약서에 찍을 이름이 없는 상태가 되지 않는다.
 *
 * ★ 빈 배열은 허용한다. 사용자를 한 명도 안 넣은 계약이 있을 수 있다.
 */
export function buildMemberWrites(rows: readonly MemberInput[]): MemberRowWrite[] {
  if (rows.length > MAX_MEMBERS) {
    throw new RangeError(`입주자 사용자는 최대 ${MAX_MEMBERS}명이다: ${rows.length}명이 올라왔다`);
  }

  const named = rows.map((row, index) => {
    const name = optionalText(row.name);
    if (!name) throw new RangeError(`${index + 1}행 성명은 필수다`);
    return { ...row, name };
  });

  const flagged = named.findIndex((r) => r.isRepresentative === true);
  const repIndex = flagged >= 0 ? flagged : 0;

  return named.map((row, index) => ({
    memberId: optionalText(row.memberId),
    name: row.name,
    phone: optionalText(row.phone),
    email: optionalText(row.email),
    isRepresentative: index === repIndex ? MEMBER_ROLE.REPRESENTATIVE : MEMBER_ROLE.STAFF,
    memo: optionalText(row.memo),
  }));
}
