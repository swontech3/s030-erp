/**
 * 마스킹 칸의 **커서 자리** (CONT-19).
 *
 * =============================================================================
 * ★★ 무엇이 문제였나 — 중간을 고치면 커서가 맨 끝으로 튄다
 * =============================================================================
 * 사업자등록번호·법인등록번호·연락처는 입력할 때마다 `-` 를 다시 넣어 값을 통째로
 * 바꾼다. 제어 컴포넌트라 React 가 새 값을 인풋에 써 넣는데, **값을 쓰면 브라우저가
 * 커서를 맨 뒤로 보낸다.** 그래서 `111-22-85905` 의 앞자리를 고치려고 가운데를 찍고
 * 한 글자를 치면, 글자는 들어가지만 커서가 12번(맨 끝)으로 날아간다 — 앞자리를
 * 이어서 고칠 수 없다. 실측: `111-22-85905` 의 2번 자리에서 `9` → 커서 12.
 *
 * 금액 칸은 이미 이 문제를 겪고 손으로 커서를 되돌리고 있었다(`formatMoneyInput`).
 * 같은 일을 나머지 칸에도 해 주는 것이 이 파일이다.
 *
 * =============================================================================
 * ★ 길이가 아니라 «뜻 있는 글자 수»로 센다
 * =============================================================================
 * 「커서 앞에 숫자가 몇 개 있었는가」를 세고, 마스크를 씌운 값에서 **그 숫자 다음**에
 * 커서를 둔다. 구분자(`-`)는 마스크가 알아서 넣었다 뺐다 하므로 세지 않는다.
 * 길이 차이로 보정하면(`formatMoneyInput` 이 그렇게 한다) 구분자가 두 개 들어가는
 * 자리에서 한 칸씩 어긋난다.
 */

export interface MaskedCaretArgs {
  /** 사람이 친 직후의 날 값(마스크 씌우기 전). */
  raw: string;
  /** 그때의 커서 자리. */
  caret: number;
  /** 마스크를 씌운 값. */
  masked: string;
  /**
   * «뜻 있는 글자» 판정. 숫자 칸은 `/\d/`, 이메일 아이디는 `/[A-Za-z0-9._-]/` 다.
   * 마스크가 지우거나 새로 넣는 글자(구분자)는 여기 걸리지 않아야 한다.
   */
  keep: RegExp;
}

/** 마스크를 씌운 뒤 커서를 둘 자리. */
export function caretForMasked({ raw, caret, masked, keep }: MaskedCaretArgs): number {
  const before = raw.slice(0, Math.max(0, Math.min(raw.length, caret)));
  let count = 0;
  for (const ch of before) if (keep.test(ch)) count++;

  if (count === 0) return 0;

  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (keep.test(masked[i] ?? '')) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  // ★ 마스크가 상한에서 잘라낸 경우(10자리 초과 등) — 남은 것의 끝에 둔다.
  return masked.length;
}

// =============================================================================
// 숫자 마스크 — 사업자등록번호 · 법인등록번호 · 전화 (web 계약 폼에서 옮겨 왔다, 2026-10-10)
// =============================================================================
// ★ 화면(계약 폼 · 법무 상세)과 서버(법무 회사 정보 검사)가 **같은 함수**를 쓴다. 전에는
//   web `features/contracts/form-model.ts` 에 있었다 — 서버가 쓸 수 없어서 옮겼다.
// ★ 표시 형식이다. 저장된 DB 값을 고쳐 쓰지 않는다 — 읽어 보여 줄 때 씌울 뿐이다.

export type DigitMaskKind = 'bizno' | 'corpno' | 'phone';

/**
 * 마스크 3종 — 시안 `maskValue`(`05-logic.md` §5) 그대로에 **서울 02** 를 더했다.
 *
 *   사업자등록번호 000-00-00000 · 법인등록번호 000000-0000000
 *   전화  02  → 02-XXX-XXXX(9자리) / 02-XXXX-XXXX(10자리)
 *         010 → 010-XXXX-XXXX
 *         그 밖 → 3-3-4, 11자리면 3-4-4
 *
 * ★ 02 는 결함 수정이다(2026-10-10) — 전에는 `0212345678` 이 `021-234-5678` 로 끊겼다.
 * ★ 0 으로 시작하지 않는 번호(1588 등 대표번호)는 규칙이 없다 — 「그 밖」으로 끊긴다
 *   (`15881234` → `158-812-34`). 막지는 않는다(`isDigitMaskComplete`).
 */
export function maskValue(kind: DigitMaskKind, raw: string): string {
  const max = kind === 'corpno' ? 13 : kind === 'phone' ? 11 : 10;
  const d = raw.replace(/\D/g, '').slice(0, max);

  if (kind === 'bizno') {
    if (d.length > 5) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
  }
  if (kind === 'corpno') {
    return d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
  }
  if (d.startsWith('02')) {
    const x = d.slice(0, 10);
    const mid = x.length > 9 ? 6 : 5;
    if (x.length > mid) return `${x.slice(0, 2)}-${x.slice(2, mid)}-${x.slice(mid)}`;
    return x.length > 2 ? `${x.slice(0, 2)}-${x.slice(2)}` : x;
  }
  // 010 은 3-4-4, 그 외는 3-3-4
  const mid = d.startsWith('010') || d.length > 10 ? 7 : 6;
  if (d.length > mid) return `${d.slice(0, 3)}-${d.slice(3, mid)}-${d.slice(mid)}`;
  return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
}

/** 자릿수 규칙 — 칸 옆 안내 · 서버 오류 문구가 같이 쓴다. */
export const DIGIT_MASK_RULE: Readonly<Record<DigitMaskKind, string>> = {
  corpno: '숫자 13자리',
  bizno: '숫자 10자리',
  phone: '지역번호를 포함한 숫자(02 는 9~10자리, 010 은 11자리, 그 밖의 0XX 는 10~11자리)',
};

/**
 * 자릿수가 맞는가 — 빈 값은 맞다(작성 중 임시 저장 · 칸을 비워 두는 회사가 있다).
 * 숫자 · 하이픈 · 공백 말고 다른 글자가 있으면 틀리다.
 *
 * ★ 전화는 **0 으로 시작할 때만** 자릿수를 본다. 1588 같은 대표번호는 막지 않는다(결정 2026-10-10).
 */
export function isDigitMaskComplete(kind: DigitMaskKind, value: string | null | undefined): boolean {
  const t = (value ?? '').trim();
  if (t === '') return true;
  if (/[^\d\s-]/.test(t)) return false;
  const n = t.replace(/\D/g, '').length;
  if (kind === 'corpno') return n === 13;
  if (kind === 'bizno') return n === 10;
  const d = t.replace(/\D/g, '');
  if (d.startsWith('02')) return n === 9 || n === 10;
  if (d.startsWith('010')) return n === 11;
  if (d.startsWith('0')) return n === 10 || n === 11;
  return true;
}
