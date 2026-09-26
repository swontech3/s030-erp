-- =============================================================================
-- 023_settlement_processing.sql
--
-- 중도해지 정산의 **처리 기록** — 정산 원장에 「처리 완료」 칸을 붙인다.
--   tb_s080_settlements  processed_on · processed_amount · processed_method ·
--                        processed_memo · processed_payment_id · processed_at · processed_by
--
-- =============================================================================
-- ★★★ 정산 처리는 **두 곳에 나누어** 남는다 — 섞으면 청구서가 거짓말을 한다
-- =============================================================================
-- 순정산금(`net_amount`)은 세 종류의 돈이 합쳐진 값이다.
--   ① 이용료 차액  = 총수납 − 실이용료      ← 청구서에서 온 돈이다
--   ② 예치금 반환                            ← 청구서에 없는 돈이다
--   ③ 할인 환수 · 무상 환수                  ← 청구서에 없는 돈이다
--
-- 순정산금을 통째로 해지 달 청구서에 수납으로 넣으면 그 청구서의 수납 합계가 청구액과
-- 어긋나 「미납」·「부분납부」로 보이고, **월별 청구의 미수금에 예치금·환수가 섞인다.**
--
-- 그래서 (2026-09-26 결정)
--   · 청구서   — ① 이용료 차액만 수납으로 넣는다. **청구서마다 남은 금액만큼** 나눈다 —
--               살아 있는 장은 청구 − 수납(미납이면 양수, 과납이면 음수), 취소된 장은
--               미리 받은 수납만큼 음수. 처리 후 살아 있는 장은 전부 납부완료, 취소된 장은
--               수납 합계 0. 나눈 합계가 이용료 차액과 다르면 처리를 막는다.
--               (해지 달 한 장에 통째로 넣으면 앞 달 미납이 있을 때 해지 달은 과납, 앞 달은
--                미납으로 남는다.) `processed_payment_id` 는 그중 해지 달 장의 수납이다
--   · 정산 원장 — 실제로 주고받은 금액 전체를 여기에 적는다. 예치금 반환과 환수를
--               **실제로 처리했는지**는 이 칸들만 안다
--
-- 두 쓰기는 한 트랜잭션이다(`POST /contracts/:id/settlement/process`).
--
-- ★ `processed_amount` 의 부호는 `net_amount` 와 같다 — 양수는 **돌려준 돈**(환불),
--   음수는 **받은 돈**(추가청구). 운영자가 실제 금액을 적으므로 `net_amount` 와 다를 수
--   있다(반올림·협의). 다르면 화면이 둘을 나란히 보여준다.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_settlements
  ADD COLUMN IF NOT EXISTS processed_on         date,
  ADD COLUMN IF NOT EXISTS processed_amount     integer,
  ADD COLUMN IF NOT EXISTS processed_method     varchar(1),
  ADD COLUMN IF NOT EXISTS processed_memo       text,
  ADD COLUMN IF NOT EXISTS processed_payment_id text,
  ADD COLUMN IF NOT EXISTS processed_at         timestamp,
  ADD COLUMN IF NOT EXISTS processed_by         text;

COMMENT ON COLUMN public.tb_s080_settlements.processed_on IS
  '정산을 실제로 처리한 날. NULL 이면 처리 대기.';
COMMENT ON COLUMN public.tb_s080_settlements.processed_amount IS
  '실제로 주고받은 금액. 부호는 net_amount 와 같다(양수 = 환불, 음수 = 추가청구 받음).';
COMMENT ON COLUMN public.tb_s080_settlements.processed_method IS
  '코드 PAY_METHOD — B 계좌이체 / C 카드.';
COMMENT ON COLUMN public.tb_s080_settlements.processed_payment_id IS
  '정산 처리가 넣은 수납 중 해지 달 장의 것(대표). 차액이 0 이었거나 그 수납을 지웠으면 NULL.';

/*
 * ★ 처리 칸은 **함께** 채워진다. 날짜만 있고 금액이 없는 줄은 「처리했다」도
 *   「안 했다」도 아니다.
 */
ALTER TABLE public.tb_s080_settlements
  DROP CONSTRAINT IF EXISTS ck_s080_settlements_processed;
ALTER TABLE public.tb_s080_settlements
  ADD CONSTRAINT ck_s080_settlements_processed CHECK (
    (processed_on IS NULL AND processed_amount IS NULL AND processed_method IS NULL
       AND processed_at IS NULL AND processed_payment_id IS NULL)
    OR
    (processed_on IS NOT NULL AND processed_amount IS NOT NULL AND processed_method IN ('B', 'C')
       AND processed_at IS NOT NULL)
  );

/*
 * ★ 수납은 운영자가 [내역] 에서 지울 수 있다. 지우면 원장의 연결만 끊는다 —
 *   처리 기록(날짜·금액)까지 사라지면 「예치금을 돌려줬다」는 사실이 함께 사라진다.
 */
ALTER TABLE public.tb_s080_settlements
  DROP CONSTRAINT IF EXISTS tb_s080_settlements_processed_payment_fkey;
ALTER TABLE public.tb_s080_settlements
  ADD CONSTRAINT tb_s080_settlements_processed_payment_fkey
    FOREIGN KEY (processed_payment_id) REFERENCES public.tb_s080_payments (payment_id)
    ON DELETE SET NULL;

COMMIT;

-- =============================================================================
-- 검증 — 트랜잭션 안에서 해보고 롤백한다
-- =============================================================================
-- 1) 칸이 생겼는지           \d public.tb_s080_settlements
-- 2) 날짜만 넣으면 막히는지   UPDATE ... SET processed_on = CURRENT_DATE → 23514
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 처리 기록이 사라진다. 되돌리기 전에 처리된 줄이 있는지 먼저 본다
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.tb_s080_settlements
--   DROP CONSTRAINT IF EXISTS tb_s080_settlements_processed_payment_fkey,
--   DROP CONSTRAINT IF EXISTS ck_s080_settlements_processed,
--   DROP COLUMN IF EXISTS processed_on, DROP COLUMN IF EXISTS processed_amount,
--   DROP COLUMN IF EXISTS processed_method, DROP COLUMN IF EXISTS processed_memo,
--   DROP COLUMN IF EXISTS processed_payment_id, DROP COLUMN IF EXISTS processed_at,
--   DROP COLUMN IF EXISTS processed_by;
