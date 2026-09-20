/**
 * 계약호실 — **판정만** 한다. DB 도 화면도 여기서 만지지 않는다.
 *
 * =============================================================================
 * ★★★ 이 번호는 **세무서에 내는 번호**다
 * =============================================================================
 * 계약호실은 국세청 신고용 대표 호실이다(`03-contract-form.md` 섹션 2). 두 계약이
 * 같은 번호로 제출되면 **밖에서 사고가 난다** — 우리 DB 안에서 끝나는 문제가 아니다.
 *
 * 그래서 규칙을 이 파일 하나에 두고 **양쪽이 이것을 부른다.**
 *   화면  `RoomPickerModal` — [확인] 을 눌러도 되는가
 *   서버  `routes/contracts.ts` — 저장을 받아도 되는가 (화면을 믿지 않는다)
 *
 * 두 벌이면 언젠가 갈리고, 그때 화면은 통과시키는데 서버가 거절한다 — 또는 더 나쁘게,
 * 화면이 막는 것을 서버가 받는다.
 *
 * =============================================================================
 * ★★ **나눠 쓰는 경우가 없다**
 * =============================================================================
 * 호실 자체는 여러 회사가 나눠 쓸 수 있지만(그건 섹션 2 의 계약 항목이 다룬다),
 * **계약호실은 계약당 하나이고 겹칠 수 없다.** 겹치면 막는다 — 경고가 아니다.
 *
 * ★ 끝난 계약의 번호는 **다시 쓸 수 있다.** 퇴실했으면 그 호실로 다시 신고한다.
 *   그래서 「살아 있는 계약」만 본다(`ROOM_LIVE_STATUSES`).
 */

/**
 * 계약호실을 붙들고 있는 상태.
 *
 * ★ `confirmed`(계약중)와 `draft`(계약대기)뿐이다. `terminated`·`cancelled` 는
 *   끝난 계약이라 그 번호를 놓아 준다.
 */
export const ROOM_LIVE_STATUSES = ['confirmed', 'draft'] as const;

export function holdsRoom(status: string): boolean {
  return (ROOM_LIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * 비교용으로 다듬는다. 앞뒤 공백만 떼고 **가운데는 건드리지 않는다** —
 * 「6-1」과 「6 - 1」을 같은 번호로 볼지는 우리가 정할 일이 아니다(세무서 표기다).
 */
export function normalizeRoom(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** 계약호실을 쓰고 있는 한 줄. 목록과 판정이 같은 모양을 본다. */
export interface RoomHolder {
  contractId: string;
  companyName: string;
  room: string;
}

/**
 * 이 번호가 이미 쓰이고 있는가.
 *
 * @param selfContractId 지금 편집 중인 계약. ★ **자기 자신은 중복이 아니다** —
 *   저장된 계약을 열어 그대로 저장하면 자기 번호가 걸린다. 그러면 아무도 자기
 *   계약을 수정할 수 없게 된다.
 */
export function findRoomConflict(
  holders: readonly RoomHolder[],
  room: string,
  selfContractId: string | null,
): RoomHolder | null {
  const wanted = normalizeRoom(room);
  // ★ 빈 계약호실은 중복이 아니다. 아직 안 정한 계약이 서로 부딪히면 안 된다.
  if (wanted === '') return null;
  return (
    holders.find((h) => normalizeRoom(h.room) === wanted && h.contractId !== selfContractId) ?? null
  );
}

/** 사용자에게 보여줄 문구. 화면과 서버가 **같은 말**을 하도록 여기 둔다. */
export const ROOM_TAKEN_MESSAGE = '이미 사용 중인 계약호실입니다';

/* ══════════════════════════════════════════════════════════════════════════
   정렬 — 「호실번호 순」
   ══════════════════════════════════════════════════════════════════════════
   ★ 문자열로 정렬하면 `1-10 · 112-3 · 6-1 · 7-2` 가 된다. 사람이 기대하는 것은
     `1-10 · 6-1 · 7-2 · 112-3` 이다. 숫자 토막은 숫자로 비교한다.

   ★ 숫자가 아닌 토막(「B1」·「지하」)이 섞여도 죽지 않아야 한다 — 그때는 글자로
     비교한다. 세무서 표기라 무엇이 들어올지 우리가 정하지 않는다. */

/** `112-3` → `[112, '-', 3]`. 숫자와 그 외를 번갈아 자른다. */
function segments(value: string): (number | string)[] {
  return value.match(/\d+|\D+/g)?.map((s) => (/^\d+$/.test(s) ? Number(s) : s)) ?? [];
}

export function compareRooms(a: string, b: string): number {
  const left = segments(normalizeRoom(a));
  const right = segments(normalizeRoom(b));

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1; // 짧은 쪽이 앞이다 — `6` 이 `6-1` 보다 앞
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
    } else {
      const cmp = String(x).localeCompare(String(y), 'ko');
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/** 목록 정렬. 번호가 같으면 회사명으로 — 순서가 흔들리지 않게 한다. */
export function sortRoomHolders(holders: readonly RoomHolder[]): RoomHolder[] {
  return [...holders].sort(
    (a, b) => compareRooms(a.room, b.room) || a.companyName.localeCompare(b.companyName, 'ko'),
  );
}
