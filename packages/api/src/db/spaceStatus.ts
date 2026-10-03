/**
 * 호실상태(`tb_s080_spaces.status`) — **계약이 정한다** (결정 2026-10-03).
 *
 * =============================================================================
 * ★★★ 전제 — **계약과 호실 상태가 어긋나면 계약이 맞다**
 * =============================================================================
 * 호실상태는 «이 방을 지금 누가 쓰는가»를 적는 칸이고, 그 답은 계약에만 있다. 그래서
 * 이 파일은 상태를 **고르지 않고 다시 센다** — 계약을 보고 계산해 덮는다. 둘이 갈리는
 * 길을 아예 만들지 않는 것이 목적이다.
 *
 *     계약대기(draft)     → `R` 예약중
 *     확정(confirmed)     → `O` 입주중
 *     종료·취소, 계약 없음 → `E` 공실
 *
 * ★ 한 호실에 계약이 여럿이면 **센 쪽**을 쓴다 — 확정 > 대기 > 없음. 재계약처럼 확정과
 *   대기가 겹치는 동안 「예약중」으로 내려가면 지금 사람이 들어 있는 방이 비어 보인다.
 *
 * =============================================================================
 * ★★ 손으로 바꾸는 길은 **없다**
 * =============================================================================
 * 센터 관리의 호실 수정 팝업(s030100010p3)에서 상태 칸을 뺐고, `updateSpace` 는
 * `status` 를 **건드리지 않는다**. 손으로 바꿀 수 있으면 계약과 어긋난 값이 남고,
 * 그때 어느 쪽이 참인지 아무도 모른다.
 *
 *     ★ 2026-10-03 이전에는 아무도 바꾸지 않아 **72실 전부 `E`(공실)** 이었다 —
 *       확정 계약이 살아 있는 Room 1 까지 공실이었다. 마이그레이션 032 가 한 번
 *       바로잡았고, 그 뒤로는 이 파일이 계속 맞춘다.
 *
 * =============================================================================
 * ★ 부르는 자리는 **둘뿐**이다 (`db/contracts.ts`)
 * =============================================================================
 *   `replaceSpaces`  계약의 호실 목록이 바뀔 때 — **빠진 호실도** 다시 센다
 *   `updateStatus`   계약 상태가 바뀔 때 (확정 · 종료 · 취소)
 *
 * 둘 다 **같은 트랜잭션 안**이다. 밖에서 부르면 계약은 바뀌었는데 호실은 안 바뀐
 * 순간이 생기고, 그 사이에 센터 관리 화면을 열면 거짓을 본다.
 */
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/**
 * `ROOM_ST/000` 의 코드값. **이름(공실·입주중·예약중)은 코드 마스터가 갖는다** —
 * 여기에는 코드만 둔다. 화면은 `codeName(codes, 'ROOM_ST', …)` 로 이름을 붙인다.
 */
export const SPACE_STATUS = {
  /** 공실 — 살아 있는 계약이 없다. */
  EMPTY: 'E',
  /** 입주중 — 확정 계약이 있다. */
  OCCUPIED: 'O',
  /** 예약중 — 계약대기(draft)만 있다. */
  RESERVED: 'R',
} as const;

/**
 * 준 호실들의 상태를 **계약에서 다시 세어** 덮는다. 바뀐 행 수를 돌려준다.
 *
 * ★ 한 문장이다. 호실마다 SELECT 후 UPDATE 하면 그 사이에 계약이 바뀔 수 있고,
 *   호실 10개짜리 계약에서 왕복이 20번이 된다.
 *
 * ★ `IS DISTINCT FROM` 으로 **달라진 것만** 쓴다. 같은 값을 다시 쓰면 `updated_at`·
 *   `updated_by` 가 운영자가 아무것도 안 했는데 바뀐다.
 */
export async function syncSpaceStatuses(
  client: ScopedClient,
  spaceIds: readonly string[],
  actor: string,
): Promise<number> {
  const ids = [...new Set(spaceIds.filter((id) => id !== ''))];
  if (ids.length === 0) return 0;

  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_spaces s
        SET status = x.next, updated_at = now(), updated_by = $2
       FROM (
         SELECT sp.space_id,
                CASE
                  WHEN bool_or(k.status = 'confirmed') THEN '${SPACE_STATUS.OCCUPIED}'
                  WHEN bool_or(k.status = 'draft')     THEN '${SPACE_STATUS.RESERVED}'
                  ELSE '${SPACE_STATUS.EMPTY}'
                END AS next
           FROM public.tb_s080_spaces sp
           LEFT JOIN public.tb_s080_contract_spaces cs ON cs.space_id = sp.space_id
           LEFT JOIN public.tb_s080_contracts       k  ON k.contract_id = cs.contract_id
          WHERE sp.space_id = ANY($1::text[])
          GROUP BY sp.space_id
       ) x
      WHERE s.space_id = x.space_id
        AND s.status IS DISTINCT FROM x.next`,
    [ids, actor],
  );
  return rowCount ?? 0;
}

/**
 * 이 계약에 **지금 붙어 있는** 호실들을 다시 센다.
 *
 * ★ 호실을 **뺀** 경우는 이것으로 잡히지 않는다 — 뺀 뒤에는 더 이상 이 계약의 호실이
 *   아니기 때문이다. 그래서 `replaceSpaces` 는 지우기 **전에** 옛 목록을 들고 있다가
 *   새 목록과 합쳐 `syncSpaceStatuses` 를 부른다.
 */
export async function syncSpaceStatusesOfContract(
  client: ScopedClient,
  contractId: string,
  actor: string,
): Promise<number> {
  const { rows } = await q<{ space_id: string }>(
    client,
    `SELECT space_id FROM public.tb_s080_contract_spaces WHERE contract_id = $1`,
    [contractId],
  );
  return syncSpaceStatuses(client, rows.map((r) => r.space_id), actor);
}

/**
 * **모든** 호실을 다시 센다. 마이그레이션 032 와 같은 계산이고, 검증이 「지금도 맞는가」를
 * 물을 때 쓴다(`scripts/verify-facility.js`).
 *
 * ★ 업무 경로에서는 부르지 않는다 — 72실이면 가볍지만, 전부 훑는 일을 저장 때마다 할
 *   이유가 없다. 계약이 건드린 호실만 다시 세는 것으로 충분하다.
 */
export async function syncAllSpaceStatuses(client: ScopedClient, actor: string): Promise<number> {
  const { rows } = await q<{ space_id: string }>(
    client,
    `SELECT space_id FROM public.tb_s080_spaces`,
  );
  return syncSpaceStatuses(client, rows.map((r) => r.space_id), actor);
}
