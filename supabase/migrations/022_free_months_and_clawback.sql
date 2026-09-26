-- =============================================================================
-- 022_free_months_and_clawback.sql
--
-- 무상 개월수와 중도 해지 환수.
--   ① tb_s080_contracts      `free_months` 추가 · `billing_start_date` **삭제**
--   ② tb_s080_invoice_lines  `is_free` 추가 — 무상 달의 0원 줄 표시
--   ③ tb_s080_settlements    `discount_clawback` · `free_clawback` 추가
--
-- =============================================================================
-- ★★★ 무상과 환수는 **한 쌍이다** — 따로 읽으면 이중으로 받는다
-- =============================================================================
-- 무상 달은 0원으로 청구된다. 중도 해지하면 그 달을 **환수**로 받는데, 실이용료
-- (`computeTerminationSettlement`)가 무상 달을 정상 월액으로 세고 있으면 같은 달을
-- 두 번 받는다. 그래서 실이용료에서 무상 달을 빼는 규칙과 무상 환수 규칙이 한 커밋에
-- 들어 있다. 한쪽만 되돌리면 조용히 두 배로 청구된다.
--
-- 규칙의 정본은 코드다 — `contract-settlement.ts`(실이용료) ·
-- `contract-clawback.ts`(환수) · `invoice-plan.ts`(0원 청구서).
--
-- -----------------------------------------------------------------------------
-- ① 왜 `billing_start_date` 를 지우나 — **쓰는 코드가 생기지 않았다**
-- -----------------------------------------------------------------------------
-- 001 이 CSCH-01(무상기간)을 위해 만든 칸이다. 그 뒤로 **읽는 코드도 쓰는 코드도
-- 없었고**, 적용 시점 11행 전부 NULL 이다(2026-09-24 실측).
--
-- 무상기간을 「청구를 언제부터 시작하는가」(날짜)가 아니라 **「몇 달이 무상인가」**
-- (개월수)로 정했다. 날짜로 두면 청구서 장수·납부일·환수 기간이 전부 그 날짜에서
-- 다시 유도돼야 하는데, 개월수는 장 앞머리 N장이라는 뜻이라 셋 다 바로 나온다.
--
-- ★ 두 칸을 **함께 두지 않는다.** 남겨 두면 언젠가 누가 채우고, 그때부터 무상 기간이
--   두 군데서 정해진다. 020 이 `storage_url` 을 지운 것과 같은 이유다.
--
-- -----------------------------------------------------------------------------
-- ③ 왜 환수 칸이 **둘**인가
-- -----------------------------------------------------------------------------
-- 둘은 뜻이 다르다 —
--   할인 환수 = (기준가 − 계약가) × 실제 사용 기간   ← 깎아 준 것을 되돌린다
--   무상 환수 = 계약가 × (무상 기간 중 쓴 부분)      ← 공짜로 준 것을 되돌린다
-- 합치면 무상 달이 정확히 기준가가 된다. 한 칸에 합쳐 두면 나중에 「무상은 얼마였나」를
-- 되짚을 수 없고, 분쟁에서 필요한 것이 바로 그 내역이다.
--
-- ★ 021 에서 `discount_clawback` 을 **일부러 안 만들었다**(할인 칸이 없어서 늘 0).
--   이제 기준가·계약가로 계산할 수 있게 됐으므로 되살린다. 그때의 판단은 그 시점에
--   맞았고, 지금 값이 생겨서 되돌리는 것이다.
-- =============================================================================

BEGIN;

-- ── ① 계약 ─────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_s080_contracts
  ADD COLUMN IF NOT EXISTS free_months smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tb_s080_contracts.free_months IS
  '무상 개월수. 계약 시작월부터 이 달 수만큼 0원 청구다. ★ 계약 개월수보다 작아야 한다.';

/*
 * ★ 무상은 **계약 개월수보다 작아야 한다.** 같거나 크면 계약 전체가 무상이고 그건
 *   이용계약이 아니다 — 일시불에서는 청구액이 0 이나 음수가 된다.
 *   `free_months = 0` 은 `period_months` 가 아직 NULL 인 임시저장에서도 통과해야 한다.
 */
ALTER TABLE public.tb_s080_contracts
  DROP CONSTRAINT IF EXISTS ck_s080_contracts_free_months;
ALTER TABLE public.tb_s080_contracts
  ADD CONSTRAINT ck_s080_contracts_free_months CHECK (
    free_months >= 0
    AND (free_months = 0 OR (period_months IS NOT NULL AND free_months < period_months))
  );

-- ★ 쓰는 코드가 생기지 않은 칸이다. 적용 시점 11행 전부 NULL — 위 ① 참조.
ALTER TABLE public.tb_s080_contracts
  DROP COLUMN IF EXISTS billing_start_date;

-- ── ② 청구 줄 ───────────────────────────────────────────────────────────────
ALTER TABLE public.tb_s080_invoice_lines
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tb_s080_invoice_lines.is_free IS
  '무상 달의 줄인가. 금액은 0 이지만 unit_price 에 ★ 얼마짜리를 무상으로 줬는지가 남는다.';

/*
 * ★ 무상 줄은 금액이 0 이다. `unit_price` 는 0 이 아니어도 된다 — 오히려 **남겨야**
 *   한다. 그래서 「단가 × 수량 = 공급가」를 강제하는 제약을 두지 않는다.
 *   (021 의 `ck_s080_invoice_lines_amounts` 는 `총액 = 공급가 + 부가세`만 본다.)
 */
ALTER TABLE public.tb_s080_invoice_lines
  DROP CONSTRAINT IF EXISTS ck_s080_invoice_lines_free;
ALTER TABLE public.tb_s080_invoice_lines
  ADD CONSTRAINT ck_s080_invoice_lines_free CHECK (
    NOT is_free OR (supply_amount = 0 AND vat_amount = 0 AND total_amount = 0)
  );

-- ── ③ 정산 원장 ─────────────────────────────────────────────────────────────
ALTER TABLE public.tb_s080_settlements
  ADD COLUMN IF NOT EXISTS discount_clawback integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_clawback     integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tb_s080_settlements.discount_clawback IS
  '할인 환수 = (기준가 − 계약가) × 실제 사용 기간. 부가세 포함. ★ 순정산금에서 뺀 값이다.';
COMMENT ON COLUMN public.tb_s080_settlements.free_clawback IS
  '무상 환수 = 계약가 × (무상 기간 중 실제 사용한 부분). 부가세 포함. ★ 순정산금에서 뺀 값이다.';

COMMIT;

-- =============================================================================
-- 검증 — npm run verify:billing (왕복) + 아래 구조 확인
-- =============================================================================
-- 1) free_months 가 생겼는지 · billing_start_date 가 없는지
--      \d public.tb_s080_contracts
-- 2) 무상 >= 기간이 막히는지 → 23514
--      UPDATE tb_s080_contracts SET free_months = period_months WHERE ... ;
-- 3) 무상 줄에 금액이 들어가면 막히는지 → 23514
--      INSERT ... (is_free, supply_amount) VALUES (true, 100);
-- 4) 정산 원장에 환수 두 칸이 있는지
--      \d public.tb_s080_settlements
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- ★★ **코드와 함께 되돌린다.** 실이용료에서 무상 달을 빼는 규칙만 남고 무상 환수가
--    사라지면 그 달을 **아무도 안 받는다**. 반대면 두 번 받는다.
--
-- ALTER TABLE public.tb_s080_settlements
--   DROP COLUMN IF EXISTS discount_clawback, DROP COLUMN IF EXISTS free_clawback;
-- ALTER TABLE public.tb_s080_invoice_lines
--   DROP CONSTRAINT IF EXISTS ck_s080_invoice_lines_free, DROP COLUMN IF EXISTS is_free;
-- ALTER TABLE public.tb_s080_contracts
--   DROP CONSTRAINT IF EXISTS ck_s080_contracts_free_months, DROP COLUMN IF EXISTS free_months;
-- ALTER TABLE public.tb_s080_contracts ADD COLUMN billing_start_date date;
-- -- ★ billing_start_date 의 값은 돌아오지 않는다. 적용 시점에 11행 전부 NULL 이었다.
