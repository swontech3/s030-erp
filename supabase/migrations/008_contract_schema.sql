-- =============================================================================
-- 008_contract_schema.sql
--
-- 계약 스키마 재정의 + 계약↔호실 테이블 신설. 페이즈 4 의 바탕이다.
-- 근거: doc/CONTRACT_DATA_MODEL.md (정본). 이 파일과 어긋나면 그 문서를 따른다.
--
-- -----------------------------------------------------------------------------
-- 왜 바꾸는가
-- -----------------------------------------------------------------------------
-- 레거시 계약은 `space_id` 단일 NOT NULL 이었다 — 계약 1건 = 호실 1개다.
-- 새 설계는 계약 1건에 **계약 항목 최대 10개**가 붙고 항목마다 계약구분·호실·
-- 금액이 따로 있다. 한 컬럼으로는 담을 수 없다.
--
-- 테이블 이름은 `tb_s080_contracts` 그대로 쓴다. `_v2` 같은 새 계보를 만들지 않는다.
-- 007 에서 데이터를 비웠으므로 여기서는 빈 테이블의 구조만 바꾼다 — 데이터 손실 0.
--
-- -----------------------------------------------------------------------------
-- ★ 드롭하는 컬럼 11개 — 어디로 갔는지
-- -----------------------------------------------------------------------------
--   space_id               → tb_s080_contract_spaces.space_id   (N행으로)
--   monthly_rent           → tb_s080_contract_spaces.monthly_fee
--   tax_fee                → tb_s080_contract_spaces.vat_amount
--   deposit                → tb_s080_contract_spaces.deposit
--   discount_amount        → 항목별 standard_fee − monthly_fee 로 파생
--   tax_issue_flag         → tb_s080_contract_spaces.vat_yn     (행 단위로)
--   signed_date            → contract_date 로 개명 (같은 뜻, 문서 용어에 맞춤)
--   payment_due_days       → 폐기. 코드에서 참조 0건
--   auto_renewal           → 폐기. 참조 0건. 재계약은 renewed_from_contract_id 로 잇는다
--   renewal_period_months  → 폐기. 참조 0건
--   (billing_day 는 남긴다 — contract-invoices.ts 가 읽는다)
--
-- ★ 001 이 넣은 CSCH-01~04 는 전부 유지한다(요구사항이다):
--   billing_start_date · deposit_return_status · biz_info_snapshot ·
--   renewed_from_contract_id
--   단 deposit_return_status 의 "금액은 기존 deposit 컬럼" 주석은 이제 맞지 않는다 —
--   금액은 Σ tb_s080_contract_spaces.deposit 이다. 주석을 갱신한다.
--
-- ★ 레거시 영향 — 가동 중인 S-WonERP(Prisma)가 이 테이블을 본다.
--   007 에서 계약 데이터를 이미 비웠으므로 목록·상세는 빈 화면이었고,
--   이 마이그레이션 뒤에는 드롭된 컬럼을 SELECT 하면 오류가 난다.
--   packages/shared 의 contract-settlement.ts(Prisma 바인딩)도 monthly_rent·
--   tax_fee·deposit·discount_amount 를 읽는데, 페이즈 4 에서 N행 구조로
--   다시 쓰기 전까지는 호출되지 않는다(ROADMAP 페이즈 4 재사용 표).
--
-- ★ 004_rename_tenant.sql 에 의존하지 않는다.
--   004 는 tenant_id → operator_id 개명이고 대상 9개에 contracts·spaces 가 없다.
--   이 파일은 tenant_id/operator_id 를 한 번도 쓰지 않으므로 004 적용 전후
--   어느 쪽에서도 돈다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. tb_s080_contracts — 드롭
-- -----------------------------------------------------------------------------
-- 제약이 딸린 컬럼은 제약이 함께 사라진다(space_id 의 FK).
ALTER TABLE public.tb_s080_contracts
  DROP COLUMN IF EXISTS space_id,
  DROP COLUMN IF EXISTS monthly_rent,
  DROP COLUMN IF EXISTS tax_fee,
  DROP COLUMN IF EXISTS deposit,
  DROP COLUMN IF EXISTS discount_amount,
  DROP COLUMN IF EXISTS tax_issue_flag,
  DROP COLUMN IF EXISTS payment_due_days,
  DROP COLUMN IF EXISTS auto_renewal,
  DROP COLUMN IF EXISTS renewal_period_months;

-- -----------------------------------------------------------------------------
-- 2. tb_s080_contracts — 개명·신설
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s080_contracts RENAME COLUMN signed_date TO contract_date;
ALTER TABLE public.tb_s080_contracts ALTER COLUMN contract_date TYPE date USING contract_date::date;

ALTER TABLE public.tb_s080_contracts
  ADD COLUMN IF NOT EXISTS first_payment integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_months smallint;

-- status 어휘를 새 4종으로. 레거시는 A/P/C/S/E 였다(CONTRACT_ST 코드).
-- 07 에서 데이터를 비웠으므로 기존 값과 충돌하지 않는다.
ALTER TABLE public.tb_s080_contracts ALTER COLUMN status TYPE varchar(20);
ALTER TABLE public.tb_s080_contracts ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE public.tb_s080_contracts
  ADD CONSTRAINT ck_s080_contracts_status
  CHECK (status IN ('draft','confirmed','terminated','cancelled'));

-- billing_day 는 남기되 기본값을 준다 — 청구 생성이 이 값을 읽는다.
ALTER TABLE public.tb_s080_contracts ALTER COLUMN billing_day SET DEFAULT 1;

COMMENT ON COLUMN public.tb_s080_contracts.deposit_return_status IS
  'CSCH-02 보증금 반환 상태. H:보유 / R:반환 / D:차감 / P:일부차감. '
  '★ 008 부터 금액은 Σ tb_s080_contract_spaces.deposit 이다 '
  '(계약의 deposit 컬럼은 008 에서 드롭됐다).';
COMMENT ON COLUMN public.tb_s080_contracts.contract_room IS
  '세무서 제출 호실번호. 계약당 1개. 호실이 여러 개일 때 어느 번호를 쓸지는 '
  '조회 팝업이 정한다(미구현). tb_s080_spaces.room_no(해시)와 무관하다.';

-- -----------------------------------------------------------------------------
-- 3. ★ 복합 UNIQUE — 자식이 (contract_id, company_id) 쌍을 참조할 수 있게
-- -----------------------------------------------------------------------------
-- 이것이 있어야 아래 4번의 복합 FK 를 걸 수 있고, 그래야 한 계약 안에 다른 회사의
-- 호실 줄이 섞이는 것을 **DB 가** 막는다. 애플리케이션 검증만으로는 부족하다.
ALTER TABLE public.tb_s080_contracts
  ADD CONSTRAINT tb_s080_contracts_contract_id_company_id_key
  UNIQUE (contract_id, company_id);

-- -----------------------------------------------------------------------------
-- 4. tb_s080_contract_spaces — 신설. 계약 1건에 N행(최대 10)
-- -----------------------------------------------------------------------------
CREATE TABLE public.tb_s080_contract_spaces (
  contract_space_id text     PRIMARY KEY,
  contract_id       text     NOT NULL,
  -- ★ RLS 를 조인 없이 세우려고 둔다. 계약의 company_id 와 반드시 같다(아래 복합 FK).
  company_id        text     NOT NULL,

  seq               smallint NOT NULL,

  -- 코드 ROOM_TP. 같은 구분을 여러 행에 중복해 쓸 수 있다.
  room_type         varchar(10) NOT NULL,
  -- ★ 화면 표시는 room_name, 저장은 space_id. room_no(12자리 해시)를 쓰지 않는다.
  space_id          text     NOT NULL,

  -- 금액은 전부 NOT NULL DEFAULT 0 — NULL 이 섞이면 합계가 NULL 이 되는 사고가 난다.
  -- ★ 호실 기준가를 복사해 박는다. 호실을 조인해 읽지 않는다.
  standard_fee      integer  NOT NULL DEFAULT 0,
  deposit           integer  NOT NULL DEFAULT 0,
  monthly_fee       integer  NOT NULL DEFAULT 0,

  -- ★ invoice_yn 이 아니다. 세금계산서는 계약 1건에 한 장 나간다.
  --   이 칸은 그 호실에 부가세를 매길지를 정하는 스위치다.
  vat_yn            boolean  NOT NULL DEFAULT true,
  -- 서버 계산: vat_yn 이 false 면 0, 아니면 floor(monthly_fee * 0.1)
  vat_amount        integer  NOT NULL DEFAULT 0,
  -- 서버 계산: monthly_fee + vat_amount
  payment_amount    integer  NOT NULL DEFAULT 0,

  -- 고정석·자유석만. 시안에 없어 미확정이라 NULL 허용.
  locker_no         varchar(30),

  created_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        text,
  updated_by        text,

  -- ★ 복합 FK — 계약과 회사를 함께 참조한다. contract_id 만 참조하면
  --   company_id 에 남의 회사를 넣어도 DB 가 통과시킨다.
  CONSTRAINT tb_s080_contract_spaces_contract_company_fkey
    FOREIGN KEY (contract_id, company_id)
    REFERENCES public.tb_s080_contracts (contract_id, company_id)
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT tb_s080_contract_spaces_space_id_fkey
    FOREIGN KEY (space_id) REFERENCES public.tb_s080_spaces (space_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,

  -- 최대 10행. 화면도 막지만 DB 도 막는다.
  CONSTRAINT ck_s080_contract_spaces_seq CHECK (seq BETWEEN 1 AND 10),
  -- 금액은 음수가 될 수 없다.
  CONSTRAINT ck_s080_contract_spaces_amounts
    CHECK (standard_fee >= 0 AND deposit >= 0 AND monthly_fee >= 0
           AND vat_amount >= 0 AND payment_amount >= 0),
  -- 부가세 대상이 아니면 부가세액은 0 이어야 한다.
  CONSTRAINT ck_s080_contract_spaces_vat
    CHECK (vat_yn OR vat_amount = 0)
);

CREATE UNIQUE INDEX tb_s080_contract_spaces_contract_id_seq_key
  ON public.tb_s080_contract_spaces (contract_id, seq);
CREATE INDEX tb_s080_contract_spaces_company_id_idx
  ON public.tb_s080_contract_spaces (company_id);
CREATE INDEX tb_s080_contract_spaces_space_id_idx
  ON public.tb_s080_contract_spaces (space_id);

CREATE INDEX IF NOT EXISTS tb_s080_contracts_company_id_idx
  ON public.tb_s080_contracts (company_id);
CREATE INDEX IF NOT EXISTS tb_s080_contracts_status_end_date_idx
  ON public.tb_s080_contracts (status, end_date);

COMMENT ON TABLE public.tb_s080_contract_spaces IS
  '계약 항목 — 계약 1건에 N행(최대 10). 계약구분·호실·금액이 행마다 따로다. '
  '금액은 호실을 조인하지 않고 계약 저장 시점 값을 복사해 박는다 '
  '(doc/CONTRACT_DATA_MODEL.md §C-2 ①②).';

-- -----------------------------------------------------------------------------
-- 5. RLS — 애플리케이션 + DB 이중 방어. 003 의 패턴을 그대로 따른다
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s080_contract_spaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_company_scope ON public.tb_s080_contract_spaces
  USING (erp_is_operator() OR company_id = erp_current_company_id())
  WITH CHECK (erp_is_operator() OR company_id = erp_current_company_id());

-- contracts 의 RLS 는 003 에서 이미 켜져 있다. 컬럼을 바꿔도 정책은 살아 있지만
-- 명시적으로 확인해 둔다(멱등).
ALTER TABLE public.tb_s080_contracts ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 6. 권한 — 003 의 ALTER DEFAULT PRIVILEGES 가 새 테이블에 자동 적용되지만
--    명시적으로 준다(그 기본권한이 나중에 바뀌어도 이 테이블은 동작해야 한다).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_contract_spaces TO erp_app;

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- 1) space_id 단일 컬럼이 사라졌는지
--    SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_contracts' AND column_name='space_id';
--    → 0행이어야 한다
--
-- 2) vat_yn 이지 invoice_yn 이 아닌지
--    SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_contract_spaces'
--       AND column_name IN ('vat_yn','invoice_yn');
--    → vat_yn 1행만
--
-- 3) RLS 가 실제로 막는지 — 다른 company_id 로 조회했을 때 0행
--    SET app.current_role='tenant'; SET app.current_company_id='다른회사';
--    SELECT count(*) FROM tb_s080_contract_spaces;   → 0
--
-- 4) 한 계약에 다른 회사 호실 줄이 들어가는지
--    INSERT ... (contract_id='C1', company_id='남의회사') → 23503 복합 FK 위반
-- =============================================================================

-- =============================================================================
-- ROLLBACK — 008 은 되돌릴 수 있다(데이터가 비어 있으므로).
-- 다만 드롭한 11개 컬럼의 **데이터**는 007 에서 이미 사라졌다. 구조만 돌아온다.
-- =============================================================================
-- BEGIN;
-- DROP TABLE public.tb_s080_contract_spaces;
-- ALTER TABLE public.tb_s080_contracts
--   DROP CONSTRAINT tb_s080_contracts_contract_id_company_id_key,
--   DROP CONSTRAINT ck_s080_contracts_status,
--   DROP COLUMN first_payment, DROP COLUMN period_months;
-- ALTER TABLE public.tb_s080_contracts RENAME COLUMN contract_date TO signed_date;
-- ALTER TABLE public.tb_s080_contracts
--   ADD COLUMN space_id text, ADD COLUMN monthly_rent integer NOT NULL DEFAULT 0,
--   ADD COLUMN tax_fee integer NOT NULL DEFAULT 0, ADD COLUMN deposit integer NOT NULL DEFAULT 0,
--   ADD COLUMN discount_amount integer NOT NULL DEFAULT 0, ADD COLUMN tax_issue_flag varchar(1),
--   ADD COLUMN payment_due_days integer NOT NULL DEFAULT 0, ADD COLUMN auto_renewal boolean NOT NULL DEFAULT false,
--   ADD COLUMN renewal_period_months integer;
-- COMMIT;
