-- =============================================================================
-- 024_deposit_ledger.sql
--
-- 예치금 장부와 정산 환불 계좌.
--   ① tb_s080_deposit_ledger   계약마다 예치금 기록 — 받음 · 이월 · 반환 · 차감
--   ② tb_s080_settlements      환불 계좌(은행 · 계좌번호 · 예금주)
--
-- =============================================================================
-- ★★ 예치금은 청구서에 없는 돈이다 — 장부를 따로 둔다
-- =============================================================================
-- 예치금이 청구서에 섞이면 청구서 상태와 월별 미수금이 틀어진다(023 머리말). 그래서
-- 계약마다 기록을 쌓고 **보유액은 기록의 합**이다. 보유액 칸을 두지 않는다 — 두면 기록과
-- 칸이 어긋나는 날 어느 쪽이 맞는지 아무도 모른다.
--
--   receive    받음        +  계약 확정 때 자동(호실 예치금 합 · 계약일자). 0원이면 안 남긴다
--   carry_in   이월(받음)  +  재계약 확정 — 이전 계약에서 넘겨받음
--   carry_out  이월(넘김)  −  재계약 확정 — 이전 계약에서 넘겨줌
--   return     반환        −  정산 처리 · 기간 만료 반환 · 재계약 차액
--   deduct     차감        −  받을 돈을 예치금으로 메움(정산 처리)
--
-- 규칙의 정본은 `packages/shared/src/domain/deposit-ledger.ts` 와 그 시험이다.
--
-- ★ 금액은 **언제나 양수**다. 방향은 종류가 정한다 — 부호와 종류가 둘 다 방향을 말하면
--   언젠가 둘이 어긋난다.
--
-- ★ 이 마이그레이션은 **기존 계약에 기록을 만들지 않는다.** 이미 확정된 계약의 예치금이
--   실제로 들어왔는지 장부는 모른다. 지어내지 않는다(적용 시점 건수는 커밋 메시지 참조).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_s080_deposit_ledger (
  deposit_entry_id  text NOT NULL,
  build_id          text NOT NULL,
  company_id        text NOT NULL,
  contract_id       text NOT NULL,

  entry_kind        varchar(10) NOT NULL,
  /** 언제나 양수. */
  amount            integer NOT NULL,
  entry_on          date NOT NULL,

  /** 이월이면 상대 계약(이월 받음 ↔ 넘김이 서로를 가리킨다). */
  related_contract_id text,
  /** 정산 처리가 남긴 기록이면 그 정산. */
  settlement_id     text,

  /** 반환일 때만 — 돌려준 계좌. 정산 없이 반환(기간 만료)할 때 여기에 남는다. */
  refund_bank       varchar(40),
  refund_account    varchar(40),
  refund_holder     varchar(60),
  memo              text,

  created_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        text,

  CONSTRAINT tb_s080_deposit_ledger_pkey PRIMARY KEY (deposit_entry_id),
  CONSTRAINT tb_s080_deposit_ledger_build_id_fkey
    FOREIGN KEY (build_id) REFERENCES public.tb_s080_buildings (build_id),
  CONSTRAINT tb_s080_deposit_ledger_contract_company_fkey
    FOREIGN KEY (contract_id, company_id)
    REFERENCES public.tb_s080_contracts (contract_id, company_id),
  CONSTRAINT ck_s080_deposit_ledger_kind
    CHECK (entry_kind IN ('receive', 'carry_in', 'carry_out', 'return', 'deduct')),
  CONSTRAINT ck_s080_deposit_ledger_amount CHECK (amount > 0),
  -- 이월은 상대 계약이 있어야 한다 — 어디서 왔는지(어디로 갔는지) 모르는 이월은 기록이 아니다
  CONSTRAINT ck_s080_deposit_ledger_carry
    CHECK (entry_kind NOT IN ('carry_in', 'carry_out') OR related_contract_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS tb_s080_deposit_ledger_contract_idx
  ON public.tb_s080_deposit_ledger (contract_id, entry_on);
CREATE INDEX IF NOT EXISTS tb_s080_deposit_ledger_company_idx
  ON public.tb_s080_deposit_ledger (company_id);

/*
 * ★ 확정 때의 자동 「받음」은 계약마다 **한 번**이다. 확정 경로가 여럿이라(신규 확정 ·
 *   대기→확정 · 재계약 확정) 두 번 도는 길이 생길 수 있다 — 코드가 먼저 보지만 DB 도 막는다.
 *   재계약 차액 「받음」도 같은 자리에 들어가므로 이 규칙에 함께 걸린다(계약당 받음 1건).
 */
CREATE UNIQUE INDEX IF NOT EXISTS tb_s080_deposit_ledger_receive_once
  ON public.tb_s080_deposit_ledger (contract_id) WHERE entry_kind = 'receive';

ALTER TABLE public.tb_s080_deposit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_deposit_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_company_scope ON public.tb_s080_deposit_ledger;
CREATE POLICY erp_company_scope ON public.tb_s080_deposit_ledger FOR ALL
  USING (public.erp_is_operator() OR company_id = public.erp_current_company_id())
  WITH CHECK (public.erp_is_operator() OR company_id = public.erp_current_company_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_deposit_ledger TO erp_app;

COMMENT ON TABLE public.tb_s080_deposit_ledger IS
  '예치금 장부 — 계약마다 받음·이월·반환·차감. 보유액은 기록의 합이다(칸이 없다).';

-- ── ② 정산 환불 계좌 ────────────────────────────────────────────────────────
ALTER TABLE public.tb_s080_settlements
  ADD COLUMN IF NOT EXISTS refund_bank    varchar(40),
  ADD COLUMN IF NOT EXISTS refund_account varchar(40),
  ADD COLUMN IF NOT EXISTS refund_holder  varchar(60);

COMMENT ON COLUMN public.tb_s080_settlements.refund_account IS
  '환불 계좌번호. ★ 목록에서는 가린다 — 정산서와 정산 카드에서만 전체 표시.';

COMMIT;

-- =============================================================================
-- 되돌리기 — 예치금 기록이 사라진다. 되돌리기 전에 기록이 있는지 먼저 본다
-- =============================================================================
-- ALTER TABLE public.tb_s080_settlements
--   DROP COLUMN IF EXISTS refund_bank, DROP COLUMN IF EXISTS refund_account,
--   DROP COLUMN IF EXISTS refund_holder;
-- DROP TABLE IF EXISTS public.tb_s080_deposit_ledger;
