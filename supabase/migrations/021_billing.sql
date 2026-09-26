-- =============================================================================
-- 021_billing.sql
--
-- 청구·납부 1단계 — 네 표를 **다시 정의한다**.
--   ① tb_s080_invoices        청구서 머리
--   ② tb_s080_invoice_lines   청구 줄
--   ③ tb_s080_payments        수납
--   ④ tb_s080_settlements     중도해지 정산 원장
--
-- -----------------------------------------------------------------------------
-- ★ 왜 ALTER 가 아니라 DROP + CREATE 인가 — **한 번도 쓰인 적이 없다**
-- -----------------------------------------------------------------------------
-- 적용 전 확인한 사실(2026-09-23, `pg_stat_user_tables`):
--
--     relname                누적삽입  누적삭제  현재행
--     tb_s080_invoices              0         0       0
--     tb_s080_invoice_lines         0         0       0
--     tb_s080_payments              0         0       0
--     tb_s080_settlements           0         0       0
--
-- `pg_stat_database.stats_reset` 이 NULL 이다 — 통계가 초기화된 적이 없다는 뜻이고,
-- 같은 통계에서 `tb_s080_contracts` 는 누적삽입 202·삭제 188 을 보여준다. 즉 통계는
-- 살아 있고, 저 넷은 **0행인 것이 아니라 단 한 행도 들어온 적이 없다.**
-- 잃을 데이터가 없으므로 ALTER 로 기워 맞추지 않고 제대로 다시 만든다.
--
-- ★ 레거시 앱(S-WonERP)은 가동 중이 아니다. 008 이 이미 `tb_s080_contracts` 의
--   컬럼 11개를 드롭해 레거시 계약 화면은 그전부터 오류가 난다.
--
-- =============================================================================
-- 레거시에서 **일부러 버린 칸들** — 남겨 두면 언젠가 누가 그 값을 믿는다
-- =============================================================================
-- · `is_confirmed` · `confirmed_by` · `confirmed_at`
--     레거시에 「수납 확인」 절차가 **실제로는 없었다.** 손입력 경로가 이 칸을
--     건드리지 않아 늘 false 였고, 합계를 세는 쪽은 확인 여부를 보지도 않았다.
--     화면에도 확인 버튼이 없었다. 절차 없는 칸은 「확인 안 된 수납이 합계에
--     들어가 있다」는 오해만 만든다. 확인 단계를 실제로 두기로 하면 그때 만든다.
--
-- · `bank_name` · `account_last4` · `receipt_url`
--     레거시에서 쓰는 코드가 하나도 없었다. 수납 입력이 받는 것은 입금일·금액·
--     결제수단·비고 넷뿐이다.
--
-- · `issue_date`(발행일) · `sent_at`(발송 일시) · `nts_confirm_num`(국세청 승인번호)
--     세금계산서는 이번 범위가 아니다. 레거시에서도 이 셋은 **쓰는 코드가 0건**이고
--     발행 기능 자체가 빈 TODO 껍데기였다. 만들 때 함께 만든다.
--
-- · `invoice_no`(청구서 번호)
--     레거시에서 채우는 코드가 없어 전부 NULL 이 될 칸이었다. 번호 체계를 정하면
--     그때 만든다.
--
-- · `discount_clawback`(할인 환수)
--     이 저장소에 **할인 칸 자체가 없다.** 008 이 `contracts.discount_amount` 를
--     드롭했고 `contract_spaces` 에도 대응 칸이 없다. 늘 0 이 될 칸이다.
--     정산 계산 함수는 인자를 남겨 두었다(`contract-settlement.ts` 머리말).
-- =============================================================================

BEGIN;

-- 참조 방향의 역순으로 지운다.
DROP TABLE IF EXISTS public.tb_s080_payments;
DROP TABLE IF EXISTS public.tb_s080_invoice_lines;
DROP TABLE IF EXISTS public.tb_s080_settlements;
DROP TABLE IF EXISTS public.tb_s080_invoices;

-- ─────────────────────────────────────────────────────────────────────────────
-- ① 청구서 머리
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.tb_s080_invoices (
  invoice_id    text NOT NULL,
  build_id      text NOT NULL,
  -- ★ 격리축. RLS 정책이 이 컬럼 하나만 본다 — 조인 없이 판단할 수 있어야 한다.
  company_id    text NOT NULL,

  /*
   * ★★★ **계약이 없어도 되는 청구서다.**
   *
   * 지금 만드는 것은 전부 계약에서 나온 정기 청구다. 그래도 이 칸을 NOT NULL 로
   * 두지 않는 이유 — 시안이 이미 계약 밖의 청구를 그리고 있다.
   * `design/erp-tenants/ErpTenants.dc.html` 의 청구 이력 항목이
   * 「이용료 + 회의실 초과 2시간」이고, 외부인 회의실 이용은 계약이 없다.
   *
   * NOT NULL 로 시작하면 그때 가서 **이미 쌓인 청구서 전부를 손대야** 한다.
   * 지금 NULL 을 허용하는 값은 그 공사를 안 해도 된다는 것이다.
   *
   * ★ 대신 `company_id` 는 NOT NULL 로 둔다 — 누구에게 청구하는지 없는 청구서는
   *   없다. 격리축이기도 해서 NULL 이면 RLS 가 판단할 근거를 잃는다.
   */
  contract_id   text,

  /** 청구 연월 `YYYY-MM`. */
  year_month    varchar(7) NOT NULL,
  /** 납부일. 매달 계약 시작일과 같은 날이고, 그 날이 없는 달은 말일이다. */
  due_date      date NOT NULL,

  supply_amount integer NOT NULL DEFAULT 0,
  vat_amount    integer NOT NULL DEFAULT 0,
  total_amount  integer NOT NULL DEFAULT 0,
  /** 수납 합계. 수납이 들어오고 나갈 때마다 다시 센다. */
  paid_amount   integer NOT NULL DEFAULT 0,

  /*
   * 코드 `PAY_ST` — 단 **저장되는 것은 셋뿐**이다.
   *   P 납부대기 / E 납부완료 / C 취소
   *
   * ★★ `O`(미납)는 저장하지 않는다. 「납부일이 지났는데 안 들어왔다」는 시간이
   *    지나면 저절로 참이 되는 사실이라, 저장하면 매일 배치가 P 를 O 로 바꿔 줘야
   *    하고 배치가 하루 멈추면 청구서가 조용히 거짓말을 한다.
   *    화면이 `displayInvoiceStatus` 로 계산한다.
   */
  status        varchar(1) NOT NULL DEFAULT 'P',

  memo          text,

  created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- ★ 레거시 표 28개와 달리 **DEFAULT 를 준다.** 레거시는 Prisma 의 @updatedAt 이
  --   늘 값을 넣어 줘서 기본값이 붙은 적이 없고, 그래서 빼고 INSERT 하면 23502 로
  --   죽는다. 새로 만드는 표에까지 그 지뢰를 물려주지 않는다.
  updated_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    text,
  updated_by    text,

  CONSTRAINT tb_s080_invoices_pkey PRIMARY KEY (invoice_id),

  -- 자식(줄·수납)이 (invoice_id, company_id) 쌍을 참조할 수 있게.
  CONSTRAINT tb_s080_invoices_invoice_id_company_id_key
    UNIQUE (invoice_id, company_id),

  CONSTRAINT tb_s080_invoices_build_id_fkey
    FOREIGN KEY (build_id) REFERENCES public.tb_s080_buildings (build_id),
  CONSTRAINT tb_s080_invoices_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.tb_s080_companies (company_id),

  /*
   * ★ 복합 FK — 청구서의 회사와 계약의 회사가 어긋나면 남의 계약 금액이 이 회사
   *   청구서에 실린다. `contract_id` 가 NULL 이면 (MATCH SIMPLE) 검사하지 않는다 —
   *   계약 없는 청구가 통과하는 길이 이것이다.
   */
  CONSTRAINT tb_s080_invoices_contract_company_fkey
    FOREIGN KEY (contract_id, company_id)
    REFERENCES public.tb_s080_contracts (contract_id, company_id),

  CONSTRAINT ck_s080_invoices_status CHECK (status IN ('P', 'E', 'C')),
  CONSTRAINT ck_s080_invoices_year_month CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT ck_s080_invoices_amounts CHECK (
    supply_amount >= 0 AND vat_amount >= 0 AND total_amount >= 0
    AND total_amount = supply_amount + vat_amount
  )
);

/*
 * ★ 계약 정기 청구는 **계약당 한 달에 한 장**이다.
 *   부분 인덱스인 이유 — 계약 없는 청구(외부 이용)는 같은 달에 여러 장이 정상이다.
 *   그냥 UNIQUE 로 두면 NULL 끼리는 서로 다른 것으로 쳐서 결과는 같지만,
 *   부분 인덱스는 그 의도가 **읽힌다.**
 */
CREATE UNIQUE INDEX tb_s080_invoices_contract_month_key
  ON public.tb_s080_invoices (contract_id, year_month)
  WHERE contract_id IS NOT NULL;

CREATE INDEX tb_s080_invoices_company_id_idx ON public.tb_s080_invoices (company_id);
CREATE INDEX tb_s080_invoices_year_month_idx ON public.tb_s080_invoices (build_id, year_month);
CREATE INDEX tb_s080_invoices_contract_id_idx ON public.tb_s080_invoices (contract_id);

COMMENT ON TABLE public.tb_s080_invoices IS
  '청구서 머리. 월 1장(일시불은 전 기간 1장). ★ contract_id 는 NULL 을 받는다 — 계약 없는 외부 이용 청구 자리다.';
COMMENT ON COLUMN public.tb_s080_invoices.status IS
  'PAY_ST — 저장되는 것은 P 납부대기 / E 납부완료 / C 취소 셋뿐. 미납(O)은 화면이 납부일로 계산한다.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ② 청구 줄
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.tb_s080_invoice_lines (
  invoice_line_id   text NOT NULL,
  invoice_id        text NOT NULL,
  /*
   * ★ 레거시에는 없던 칸이다. 레거시 `tb_s080_invoice_lines` 는 **RLS 가 꺼져
   *   있고 정책이 하나도 없었다** — 회사축이 없어 걸 수가 없었기 때문이다.
   *   청구서를 조인해야 판단되는 정책은 느리고, 무엇보다 읽고 맞는지 알기 어렵다.
   *   `tb_s080_contract_spaces` 가 같은 이유로 `company_id` 를 들고 있다.
   */
  company_id        text NOT NULL,

  /** 표시 순서. 계약 항목의 `seq` 를 그대로 쓴다. */
  seq               smallint NOT NULL,

  /*
   * ★ **어디서 온 금액인가** — 코드 `PAY_ITEM`. 지금은 `M`(월 이용료) 하나다.
   *   나중에 주차·사물함·외부 회의실이 같은 청구서에 줄로 얹힌다.
   *   CHECK 로 목록을 박지 않는다 — 항목이 늘 때마다 마이그레이션을 해야 한다.
   *   코드 테이블(`tb_s080_codes_line`)이 목록의 정본이다.
   */
  pay_item          varchar(10) NOT NULL DEFAULT 'M',

  /** 어느 계약 항목에서 왔는가. 계약 밖의 줄(외부 이용)이면 NULL. */
  contract_space_id text,

  /** 월납이면 1, 일시불이면 계약 개월수. */
  quantity          integer NOT NULL DEFAULT 1,
  /** 단가 = 계약 항목의 월 이용료(부가세 제외). */
  unit_price        integer NOT NULL DEFAULT 0,
  supply_amount     integer NOT NULL DEFAULT 0,
  vat_amount        integer NOT NULL DEFAULT 0,
  total_amount      integer NOT NULL DEFAULT 0,

  created_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        text,
  updated_by        text,

  CONSTRAINT tb_s080_invoice_lines_pkey PRIMARY KEY (invoice_line_id),

  -- ★ 줄의 회사와 청구서의 회사가 어긋날 수 없다.
  CONSTRAINT tb_s080_invoice_lines_invoice_company_fkey
    FOREIGN KEY (invoice_id, company_id)
    REFERENCES public.tb_s080_invoices (invoice_id, company_id)
    ON DELETE CASCADE,

  CONSTRAINT tb_s080_invoice_lines_contract_space_id_fkey
    FOREIGN KEY (contract_space_id)
    REFERENCES public.tb_s080_contract_spaces (contract_space_id)
    ON DELETE SET NULL,

  CONSTRAINT ck_s080_invoice_lines_quantity CHECK (quantity >= 1),
  CONSTRAINT ck_s080_invoice_lines_amounts CHECK (
    unit_price >= 0 AND supply_amount >= 0 AND vat_amount >= 0 AND total_amount >= 0
    AND total_amount = supply_amount + vat_amount
  )
);

CREATE UNIQUE INDEX tb_s080_invoice_lines_invoice_id_seq_key
  ON public.tb_s080_invoice_lines (invoice_id, seq, pay_item);
CREATE INDEX tb_s080_invoice_lines_company_id_idx ON public.tb_s080_invoice_lines (company_id);

COMMENT ON COLUMN public.tb_s080_invoice_lines.pay_item IS
  'PAY_ITEM — 이 줄이 무엇으로 청구된 것인가. 지금은 M(월 이용료) 하나. 주차·사물함·외부 회의실이 뒤따른다.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ③ 수납
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.tb_s080_payments (
  payment_id  text NOT NULL,
  build_id    text NOT NULL,
  company_id  text NOT NULL,
  invoice_id  text NOT NULL,

  /** 입금일. 시각은 쓰지 않는다 — 운영자가 통장을 보고 날짜로 넣는다. */
  paid_on     date NOT NULL,

  /*
   * ★ **음수를 받는다.** 환불이 음수 수납이다. 청구서를 고쳐서 맞추지 않고
   *   수납 쪽에 한 줄을 더해서 맞춘다 — 그래야 「얼마를 청구했고 얼마를 돌려줬는지」가
   *   둘 다 남는다. 0 은 막는다(아무 일도 없었다는 줄은 기록이 아니다).
   */
  amount      integer NOT NULL,

  /** 코드 `PAY_METHOD` — B 계좌이체 / C 카드 결제. */
  pay_method  varchar(1) NOT NULL DEFAULT 'B',
  memo        text,

  created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by  text,
  updated_by  text,

  CONSTRAINT tb_s080_payments_pkey PRIMARY KEY (payment_id),

  CONSTRAINT tb_s080_payments_build_id_fkey
    FOREIGN KEY (build_id) REFERENCES public.tb_s080_buildings (build_id),

  -- ★ 수납의 회사와 청구서의 회사가 어긋날 수 없다.
  CONSTRAINT tb_s080_payments_invoice_company_fkey
    FOREIGN KEY (invoice_id, company_id)
    REFERENCES public.tb_s080_invoices (invoice_id, company_id),

  CONSTRAINT ck_s080_payments_amount CHECK (amount <> 0),
  CONSTRAINT ck_s080_payments_method CHECK (pay_method IN ('B', 'C'))
);

CREATE INDEX tb_s080_payments_invoice_id_idx ON public.tb_s080_payments (invoice_id);
CREATE INDEX tb_s080_payments_company_id_idx ON public.tb_s080_payments (company_id);
CREATE INDEX tb_s080_payments_paid_on_idx ON public.tb_s080_payments (build_id, paid_on);

COMMENT ON COLUMN public.tb_s080_payments.amount IS
  '입금액. ★ 음수는 환불이다 — 청구서를 고치지 않고 수납 줄로 맞춘다.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ④ 중도해지 정산 원장
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.tb_s080_settlements (
  settlement_id  text NOT NULL,
  build_id       text NOT NULL,
  company_id     text NOT NULL,
  contract_id    text NOT NULL,

  /** 실제로 끝낸 날. */
  terminate_date date NOT NULL,
  /** 정산 시점의 납부방법 스냅샷. 계약이 나중에 바뀌어도 이 줄은 안 흔들린다. */
  payment_method varchar(10),

  /** 그 계약에 들어온 수납 합계(정산 직전). */
  total_paid     integer NOT NULL DEFAULT 0,
  /** 예치금 반환액 — 조건 없이 전액이다. */
  deposit_return integer NOT NULL DEFAULT 0,
  /** 실이용료 = 온전히 쓴 달 × 월액 + 해지달 일할. */
  usage_charge   integer NOT NULL DEFAULT 0,
  /** 순정산금 — 양수는 환불, 음수는 추가청구. */
  net_amount     integer NOT NULL DEFAULT 0,
  /** refund 환불 / charge 추가청구 / none 정산 없음. */
  settle_type    varchar(10) NOT NULL,

  memo           text,
  created_at     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     text,

  CONSTRAINT tb_s080_settlements_pkey PRIMARY KEY (settlement_id),
  CONSTRAINT tb_s080_settlements_build_id_fkey
    FOREIGN KEY (build_id) REFERENCES public.tb_s080_buildings (build_id),
  CONSTRAINT tb_s080_settlements_contract_company_fkey
    FOREIGN KEY (contract_id, company_id)
    REFERENCES public.tb_s080_contracts (contract_id, company_id),
  CONSTRAINT ck_s080_settlements_type CHECK (settle_type IN ('refund', 'charge', 'none'))
);

/*
 * ★ 계약 하나에 정산 한 줄이다. 두 번 종료할 수 없으니(상태 전이가 막는다) 두 줄이
 *   생기면 그건 버그다 — DB 가 먼저 잡는다.
 */
CREATE UNIQUE INDEX tb_s080_settlements_contract_id_key
  ON public.tb_s080_settlements (contract_id);
CREATE INDEX tb_s080_settlements_company_id_idx ON public.tb_s080_settlements (company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ⑤ RLS — 네 표 모두. 레거시는 `invoice_lines` 만 빠져 있었다
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tb_s080_invoices', 'tb_s080_invoice_lines', 'tb_s080_payments', 'tb_s080_settlements'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- ★ FORCE 까지 건다. 소유자(postgres)로 붙은 스크립트도 정책을 거치게 한다.
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS erp_company_scope ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY erp_company_scope ON public.%I FOR ALL '
      'USING (public.erp_is_operator() OR company_id = public.erp_current_company_id()) '
      'WITH CHECK (public.erp_is_operator() OR company_id = public.erp_current_company_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO erp_app', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ⑥ 코드 이름 정리 — `PAY_ITEM M` 은 「월 임대료」가 아니라 「월 이용료」다
-- ─────────────────────────────────────────────────────────────────────────────
-- 계약 폼·계약서·`contract_spaces.monthly_fee` 가 전부 「월 이용료」다. 청구서에만
-- 「월 임대료」로 찍히면 같은 금액이 화면마다 다른 이름이 된다.
UPDATE public.tb_s080_codes_line
   SET name = '월 이용료', updated_at = CURRENT_TIMESTAMP
 WHERE category = 'PAY_ITEM' AND code = 'M' AND name <> '월 이용료';

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-021.js .env
-- =============================================================================
-- 1) 네 표가 새 모양인지            \d public.tb_s080_invoices  등
-- 2) RLS 가 넷 다 켜졌는지          SELECT relname, relrowsecurity, relforcerowsecurity
--                                     FROM pg_class WHERE relname LIKE 'tb_s080_invoice%'
--                                        OR relname IN ('tb_s080_payments','tb_s080_settlements');
-- 3) 정책이 넷인지                  SELECT tablename, policyname FROM pg_policies ...
-- 4) 계약 없는 청구가 들어가는지     contract_id = NULL 로 INSERT → 통과해야 한다
-- 5) 같은 계약·같은 달 두 장이 막히는지 → 23505
-- 6) total <> supply + vat 가 막히는지 → 23514
-- 7) amount = 0 수납이 막히는지      → 23514
-- 전부 트랜잭션 안에서 해보고 롤백한다.
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- 이 마이그레이션은 **데이터를 잃지 않는다**(적용 시점 4표 모두 0행).
-- 구조를 되돌리려면 네 표를 DROP 하고 레거시 Prisma 스키마
-- (`S-WonERP/S-WonERP/prisma/schema.prisma` 의 모델 4개)로 다시 만든다.
-- ★ 되돌릴 이유가 「레거시 앱을 살리려고」라면 008 부터 되돌려야 한다 —
--   레거시 계약 화면은 008 시점에 이미 깨져 있다.
