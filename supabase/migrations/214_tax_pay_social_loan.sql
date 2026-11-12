-- =============================================================================
-- 214_tax_pay_social_loan.sql
--
-- 세무(S05) 국세 · 지방세 납부 줄 · 4대보험 고지 줄 · 대출 거래 줄 표 셋 (1-6 멈춤 2, 2026-11-01, ★ 적용 전 승인 대기)
--
--   ① tb_s050_tax_payments  국세(NTAX) · 지방세(LTAX) 납부 줄 — 납부일 · 세목 글자 · 납부번호 · 금액 · 가산금(국세만) ·
--                            귀속 연월(지방세 과세대상에서, 비울 수 있음) · 수납관서/납부기관 · 납부방법(지방세만)
--   ② tb_s050_social_ins    4대보험 고지 줄 — 한 사람 × 한 보험 = 한 줄. 고지 연월 · 보험 종류 · 이름 · 가입자 번호 끝 4자리 ·
--                            파일 금액(고지 · 결정보험료) · 보수월액(있는 보험만)
--   ③ tb_s050_loan_txns     대출 거래 줄 — 대출 기관(은행) · 대출번호 끝 4자리 · 거래일 · 실행/상환 · 거래종류 글자 ·
--                            원금 · 이자(정상 + 연체 − 환출) · 수수료 · 대출잔액
--   ④ tb_s050_upload_files  + social_ins_tp(보험 종류) · notice_month(고지 연월) — 4대보험 파일만 채움.
--                            같은 단체 · 같은 보험 · 같은 고지 연월 파일은 하나(UNIQUE 부분 색인)
--   ⑤ tb_s050_import_maps   + social_ins_tps(그 대응표가 받는 보험 종류 목록) — 4대보험 대응표만 채움.
--                            은행 칸 CHECK 를 바꿈 — 파일 종류(bank_file_tp)는 은행만, 은행 코드(bank_code)는 은행 · 대출
--
-- ★ 결정(2026-11-01 대표, 설계 보고 9번 답):
--   - 4대보험 직원 · 회사 나눔은 이번에 하지 않는다 — 파일 금액 그대로(employee · company 칸 없음, 직원 급여 단계에서) (7 · 8)
--   - 보수월액은 저장한다 — 있는 보험만, 비울 수 있음(9). 고지 연월로 저장(10)
--   - 같은 달 같은 보험 파일이 이미 있으면 막고 먼저 지우게 한다(11) → uq_s050_upload_files_social_month
--   - 직원 이름 저장, 가입자 번호는 끝 4자리만(12). ★ 주민번호 · 생년월일 칸은 두지 않는다(파일의 주민번호 칸은 읽지도 않는다)
--   - 대출: 이자 = 정상 + 연체 − 환출, 수수료 따로. 거래원금 > 0 이면 실행(D), 원금상환 · 이자가 있으면 상환(R) (13)
--   - 대출 계좌는 세무 설정에 등록하지 않는다(14) — 대출번호는 파일 머리에서 읽어 끝 4자리만
--   - 국세는 납부세액과 가산금을 따로 저장(15 — 교육세 · 농특세는 저장 안 함). 지방세 납부방법 저장(16)
--   - 단체 범위(org_id)로만 받는다(17 — 네 파일 모두 사업자번호가 없다)
-- ★ 부호 CHECK 를 두지 않은 칸(일부러): 4대보험 notice_amount(고지 = 산출 + 정산 — 정산이 환급이면 0 아래일 수 있다) ·
--   대출 interest_amount(환출이자가 더 크면 0 아래). 납부 금액은 0 보다 커야 한다(납부세액 = 내국세 + … + 가산금).
-- ★ 중복: 국세 · 지방세는 (org_id, kind, pay_no) UNIQUE(계산서 승인번호와 같은 방식). 대출은 고유 번호가 없어 앱이 개수 맞추기
--   (ix_s050_loan_txns_dedup). 4대보험은 파일째(같은 달 · 같은 보험) 막는다 — 줄 UNIQUE 는 없다.
-- ★ 코드 칸(kind · ins_tp · txn_tp · social_ins_tp · social_ins_tps)은 FK 를 걸지 않고 CHECK 로 고정한다(203 · 212 와 같다).
--   코드값은 215 가 넣는다 — TAX_SOCIAL_INS(NP · HI · LTC · EI · IA) · TAX_LOAN_TP(D · R). 파일로 고르는 보험 종류는
--   NP · HI(장기요양 포함) · EI · IA 넷 — LTC 는 건강 파일에서 나오는 줄의 종류로만 쓴다.
--
-- 하는 일 · 영향: 표 셋을 새로 만들고, 있는 두 표(올린 파일 · 대응표)에 NULL 허용 칸을 하나씩 · 둘 더한다(있는 줄은 모두 NULL).
--   대응표 은행 CHECK(ck_s050_import_maps_bank_kind)는 지우고 같은 이름으로 다시 건다 — 있는 일곱 줄(은행 넷 · 그 밖 셋)은
--   새 CHECK 도 그대로 맞는다(은행 줄은 두 칸 다 참, 그 밖은 두 칸 다 NULL). 다른 표 · 칸 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(IF NOT EXISTS · 제약은 있으면 건너뜀 · 은행 CHECK 는 지우고 다시).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 — 212 · 213 이 있어야 한다
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.erp_current_org_id()') IS NULL
     OR to_regprocedure('public.erp_is_operator()') IS NULL THEN
    RAISE EXCEPTION '214 — erp_current_org_id() · erp_is_operator() 가 없다. 003 · 037 을 먼저 적용할 것';
  END IF;
  IF to_regclass('public.tb_s050_bank_txns') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.tb_s050_import_maps'::regclass AND conname = 'ck_s050_import_maps_bank_kind') THEN
    RAISE EXCEPTION '214 — 은행 표 · 대응표 은행 CHECK 가 없다. 212 를 먼저 적용할 것';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = 'TAX_BANK_FILE') THEN
    RAISE EXCEPTION '214 — 코드 TAX_BANK_FILE 이 없다. 213 을 먼저 적용할 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 대응표 — 4대보험 칸 하나 · 은행 CHECK 바꾸기(대출에도 은행 코드)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_import_maps ADD COLUMN IF NOT EXISTS social_ins_tps text[];

ALTER TABLE public.tb_s050_import_maps DROP CONSTRAINT IF EXISTS ck_s050_import_maps_bank_kind;
ALTER TABLE public.tb_s050_import_maps
  ADD CONSTRAINT ck_s050_import_maps_bank_kind
  CHECK ((kind = 'BANK') = (bank_file_tp IS NOT NULL)
         AND (kind IN ('BANK', 'LOAN')) = (bank_code IS NOT NULL));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_import_maps'::regclass AND conname = 'ck_s050_import_maps_social_kind') THEN
    ALTER TABLE public.tb_s050_import_maps
      ADD CONSTRAINT ck_s050_import_maps_social_kind CHECK ((kind = 'SOCIAL') = (social_ins_tps IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_import_maps'::regclass AND conname = 'ck_s050_import_maps_social_tps') THEN
    ALTER TABLE public.tb_s050_import_maps
      ADD CONSTRAINT ck_s050_import_maps_social_tps
      CHECK (cardinality(social_ins_tps) >= 1 AND social_ins_tps <@ ARRAY['NP', 'HI', 'EI', 'IA']::text[]);
  END IF;
END $$;

COMMENT ON COLUMN public.tb_s050_import_maps.social_ins_tps IS
  '4대보험 대응표만 — 이 대응표로 읽는 파일의 보험 종류(코드 TAX_SOCIAL_INS(000) 코드값, NP · HI · EI · IA). 고용 · 산재는 제목 줄이 같아 한 대응표가 둘을 받는다. 다른 자료는 NULL.';
COMMENT ON COLUMN public.tb_s050_import_maps.bank_code IS
  '은행 — 코드 BANK(000) 코드값. 은행 대응표(kind BANK)는 고른 계좌의 은행으로 대응표를 찾고, 대출 대응표(kind LOAN)는 대출 기관이다(214). 다른 자료는 NULL.';

-- -----------------------------------------------------------------------------
-- 2. 올린 파일 — 4대보험 칸 둘 · 같은 달 같은 보험 파일은 하나
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_upload_files ADD COLUMN IF NOT EXISTS social_ins_tp varchar(10);
ALTER TABLE public.tb_s050_upload_files ADD COLUMN IF NOT EXISTS notice_month  date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_social_kind') THEN
    ALTER TABLE public.tb_s050_upload_files
      ADD CONSTRAINT ck_s050_upload_files_social_kind
      CHECK ((kind = 'SOCIAL') = (social_ins_tp IS NOT NULL AND notice_month IS NOT NULL)
             AND (kind = 'SOCIAL' OR (social_ins_tp IS NULL AND notice_month IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_social_ins_tp') THEN
    ALTER TABLE public.tb_s050_upload_files
      ADD CONSTRAINT ck_s050_upload_files_social_ins_tp CHECK (social_ins_tp IN ('NP', 'HI', 'EI', 'IA'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_notice_month') THEN
    ALTER TABLE public.tb_s050_upload_files
      ADD CONSTRAINT ck_s050_upload_files_notice_month CHECK (EXTRACT(DAY FROM notice_month) = 1);
  END IF;
END $$;

-- ★ 결정 11 — 같은 달 같은 보험 파일이 있으면 막는다(앱은 이 색인 이름의 23505 를 「먼저 지우세요」로 바꾼다)
CREATE UNIQUE INDEX IF NOT EXISTS uq_s050_upload_files_social_month
  ON public.tb_s050_upload_files (org_id, social_ins_tp, notice_month) WHERE kind = 'SOCIAL';

COMMENT ON COLUMN public.tb_s050_upload_files.social_ins_tp IS
  '4대보험 파일만 — 올릴 때 고른 보험 종류(코드 TAX_SOCIAL_INS(000) 코드값, NP · HI(장기요양 포함) · EI · IA). 다른 자료는 NULL.';
COMMENT ON COLUMN public.tb_s050_upload_files.notice_month IS
  '4대보험 파일만 — 올릴 때 고른 고지 연월(달 첫날). 파일에 연월이 없다. 같은 단체 · 보험 · 연월 파일은 하나. 다른 자료는 NULL.';

-- -----------------------------------------------------------------------------
-- 3. 국세 · 지방세 납부 줄
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_s050_tax_payments (
  id             text PRIMARY KEY,
  org_id         integer NOT NULL,
  file_id        text NOT NULL,
  kind           varchar(10) NOT NULL CONSTRAINT ck_s050_tax_payments_kind CHECK (kind IN ('NTAX', 'LTAX')),
  pay_date       date NOT NULL,
  tax_item_src   varchar(100) NOT NULL CONSTRAINT ck_s050_tax_payments_tax_item CHECK (btrim(tax_item_src) <> ''),
  pay_no         varchar(40) NOT NULL CONSTRAINT ck_s050_tax_payments_pay_no CHECK (btrim(pay_no) <> ''),
  amount         bigint NOT NULL CONSTRAINT ck_s050_tax_payments_amount CHECK (amount > 0),
  penalty_amount bigint,
  belong_month   date CONSTRAINT ck_s050_tax_payments_belong_month CHECK (EXTRACT(DAY FROM belong_month) = 1),
  office_src     varchar(100),
  pay_method_src varchar(50),
  created_at     timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_s050_tax_payments_penalty CHECK (penalty_amount >= 0 AND penalty_amount <= amount),
  CONSTRAINT ck_s050_tax_payments_penalty_kind CHECK ((kind = 'NTAX') = (penalty_amount IS NOT NULL)),
  CONSTRAINT ck_s050_tax_payments_pay_method_kind CHECK (kind = 'LTAX' OR pay_method_src IS NULL),
  -- ★ 단체까지 묶는다 — 남의 단체 파일을 가리킬 수 없다(203 머리말)
  CONSTRAINT fk_s050_tax_payments_file FOREIGN KEY (org_id, file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.tb_s050_tax_payments IS
  '세무(S05) 국세 · 지방세 납부 줄 — 홈택스 · 위택스 납부내역을 대응표로 바꾼 것. 비용인지는 저장하지 않고 읽을 때 코드 TAX_TAX_NOEXP(비용이 아닌 세목)로 정한다. 같은 납부번호는 (단체, 종류)마다 하나.';
COMMENT ON COLUMN public.tb_s050_tax_payments.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_tax_payments.file_id IS '들어온 파일. 파일을 지우면 이 줄도 지워진다(CASCADE).';
COMMENT ON COLUMN public.tb_s050_tax_payments.kind IS '자료 종류 — 코드 TAX_KIND(000) 코드값 NTAX 국세 · LTAX 지방세.';
COMMENT ON COLUMN public.tb_s050_tax_payments.pay_date IS '납부일. 어느 달 자료인지 이 날짜로 정한다(명세 06).';
COMMENT ON COLUMN public.tb_s050_tax_payments.tax_item_src IS '세목 — 파일 글자 그대로. 비용 여부는 코드 TAX_TAX_NOEXP 의 이름과 견준다.';
COMMENT ON COLUMN public.tb_s050_tax_payments.pay_no IS '납부번호 — 국세 전자납부번호 · 지방세 납세번호, 파일 글자 그대로. (org_id, kind, pay_no) UNIQUE.';
COMMENT ON COLUMN public.tb_s050_tax_payments.amount IS '납부금액(원, 0 보다 큼) — 국세 납부세액(가산금 포함) · 지방세 납부금액.';
COMMENT ON COLUMN public.tb_s050_tax_payments.penalty_amount IS '가산금(원) — 국세만(0 이상, 납부금액 이하). 지방세는 NULL(파일에 칸이 없다). 결정 15.';
COMMENT ON COLUMN public.tb_s050_tax_payments.belong_month IS '귀속 연월(달 첫날) — 지방세 과세대상 「YYYY년 MM월 귀속분」에서. 국세 파일은 귀속연도가 비어 있어 NULL.';
COMMENT ON COLUMN public.tb_s050_tax_payments.office_src IS '국세 수납관서 · 지방세 납부기관 — 파일 글자 그대로.';
COMMENT ON COLUMN public.tb_s050_tax_payments.pay_method_src IS '납부방법 — 지방세만, 파일 글자 그대로(결정 16). 국세는 NULL.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_s050_tax_payments_pay_no ON public.tb_s050_tax_payments (org_id, kind, pay_no);
CREATE INDEX IF NOT EXISTS ix_s050_tax_payments_org_date ON public.tb_s050_tax_payments (org_id, pay_date);
CREATE INDEX IF NOT EXISTS ix_s050_tax_payments_file ON public.tb_s050_tax_payments (file_id);

-- -----------------------------------------------------------------------------
-- 4. 4대보험 고지 줄
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_s050_social_ins (
  id              text PRIMARY KEY,
  org_id          integer NOT NULL,
  file_id         text NOT NULL,
  notice_month    date NOT NULL CONSTRAINT ck_s050_social_ins_month CHECK (EXTRACT(DAY FROM notice_month) = 1),
  ins_tp          varchar(10) NOT NULL CONSTRAINT ck_s050_social_ins_tp CHECK (ins_tp IN ('NP', 'HI', 'LTC', 'EI', 'IA')),
  member_name_src varchar(100) NOT NULL CONSTRAINT ck_s050_social_ins_name CHECK (btrim(member_name_src) <> ''),
  member_no_last4 char(4) CONSTRAINT ck_s050_social_ins_last4 CHECK (member_no_last4 ~ '^[0-9]{4}$'),
  notice_amount   bigint NOT NULL,
  pay_base        bigint CONSTRAINT ck_s050_social_ins_pay_base CHECK (pay_base >= 0),
  created_at      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_s050_social_ins_file FOREIGN KEY (org_id, file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.tb_s050_social_ins IS
  '세무(S05) 4대보험 고지 줄 — 사회보험 통합징수포털 가입자별 고지 내역(CSV)을 대응표로 바꾼 것. 한 사람 × 한 보험 = 한 줄. ★ 주민번호는 읽지도 저장하지도 않는다. 직원 · 회사 나눔은 직원 급여 단계에서(2026-11-01 결정).';
COMMENT ON COLUMN public.tb_s050_social_ins.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_social_ins.file_id IS '들어온 파일. 파일을 지우면 이 줄도 지워진다(CASCADE).';
COMMENT ON COLUMN public.tb_s050_social_ins.notice_month IS '고지 연월(달 첫날) — 올린 파일의 고지 연월과 같다. 어느 달 자료인지 이 날짜로 정한다(결정 10).';
COMMENT ON COLUMN public.tb_s050_social_ins.ins_tp IS '보험 종류 — 코드 TAX_SOCIAL_INS(000) 코드값. 건강 파일 한 줄에서 HI · LTC 두 줄이 나온다.';
COMMENT ON COLUMN public.tb_s050_social_ins.member_name_src IS '가입자 이름 — 파일 글자 그대로(결정 12).';
COMMENT ON COLUMN public.tb_s050_social_ins.member_no_last4 IS
  '그 보험의 가입자 번호(건강 증번호 · 국민연금번호 · 고용/산재 원부번호) 끝 4자리. ★ 전체 번호는 저장하지 않는다. 파일에 없으면 NULL.';
COMMENT ON COLUMN public.tb_s050_social_ins.notice_amount IS
  '파일 금액(원) — 건강 · 장기요양 고지보험료, 연금 · 고용 · 산재 결정보험료 그대로. 정산이 환급이면 0 아래일 수 있어 부호 CHECK 없음.';
COMMENT ON COLUMN public.tb_s050_social_ins.pay_base IS '보수월액(원, 0 이상) — 건강 보수월액 · 고용/산재 월평균보수월액. 연금 파일에는 칸이 없어 NULL(결정 9).';

CREATE INDEX IF NOT EXISTS ix_s050_social_ins_org_month ON public.tb_s050_social_ins (org_id, notice_month);
CREATE INDEX IF NOT EXISTS ix_s050_social_ins_file ON public.tb_s050_social_ins (file_id);

-- -----------------------------------------------------------------------------
-- 5. 대출 거래 줄
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_s050_loan_txns (
  id               text PRIMARY KEY,
  org_id           integer NOT NULL,
  file_id          text NOT NULL,
  bank_code        varchar(10) NOT NULL,
  loan_no_last4    char(4) NOT NULL CONSTRAINT ck_s050_loan_txns_last4 CHECK (loan_no_last4 ~ '^[0-9]{4}$'),
  txn_date         date NOT NULL,
  txn_tp           varchar(10) NOT NULL CONSTRAINT ck_s050_loan_txns_tp CHECK (txn_tp IN ('D', 'R')),
  txn_type_src     varchar(50),
  principal_amount bigint NOT NULL CONSTRAINT ck_s050_loan_txns_principal CHECK (principal_amount >= 0),
  interest_amount  bigint NOT NULL,
  fee_amount       bigint NOT NULL CONSTRAINT ck_s050_loan_txns_fee CHECK (fee_amount >= 0),
  balance          bigint NOT NULL CONSTRAINT ck_s050_loan_txns_balance CHECK (balance >= 0),
  created_at       timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_s050_loan_txns_some_amount CHECK (principal_amount > 0 OR interest_amount <> 0 OR fee_amount > 0),
  CONSTRAINT fk_s050_loan_txns_file FOREIGN KEY (org_id, file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.tb_s050_loan_txns IS
  '세무(S05) 대출 거래 줄 — 은행 대출거래내역을 대응표로 바꾼 것. 이자만 비용, 원금은 아니다(명세 06). 거래번호가 없어 중복은 앱이 개수 맞추기로 막는다.';
COMMENT ON COLUMN public.tb_s050_loan_txns.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_loan_txns.file_id IS '들어온 파일. 파일을 지우면 이 줄도 지워진다(CASCADE).';
COMMENT ON COLUMN public.tb_s050_loan_txns.bank_code IS '대출 기관 — 대응표의 은행(코드 BANK(000) 코드값). 대출 계좌는 세무 설정에 등록하지 않는다(결정 14).';
COMMENT ON COLUMN public.tb_s050_loan_txns.loan_no_last4 IS '대출 계좌번호 끝 4자리 — 파일 머리 「대출 계좌번호 :」에서. ★ 전체 번호는 저장하지 않는다.';
COMMENT ON COLUMN public.tb_s050_loan_txns.txn_date IS '거래일. 어느 달 자료인지 이 날짜로 정한다.';
COMMENT ON COLUMN public.tb_s050_loan_txns.txn_tp IS '구분 — 코드 TAX_LOAN_TP(000) 코드값. 거래원금 > 0 이면 D 실행, 원금상환 · 이자가 있으면 R 상환(결정 13).';
COMMENT ON COLUMN public.tb_s050_loan_txns.txn_type_src IS '거래종류 — 파일 글자 그대로(예: 이자납입).';
COMMENT ON COLUMN public.tb_s050_loan_txns.principal_amount IS '원금(원, 0 이상) — 실행은 거래원금, 상환은 원금상환.';
COMMENT ON COLUMN public.tb_s050_loan_txns.interest_amount IS '이자(원) = 정상이자 + 연체이자 − 환출이자(결정 13). 환출이 크면 0 아래일 수 있어 부호 CHECK 없음.';
COMMENT ON COLUMN public.tb_s050_loan_txns.fee_amount IS '수수료(원, 0 이상) — 따로 저장(결정 13).';
COMMENT ON COLUMN public.tb_s050_loan_txns.balance IS '거래 뒤 대출잔액(원, 0 이상).';

-- 개수 맞추기 열쇠(대출 기관 · 대출번호 끝 4자리 · 거래일 — 나머지 칸은 앱이 견준다)
CREATE INDEX IF NOT EXISTS ix_s050_loan_txns_dedup ON public.tb_s050_loan_txns (org_id, bank_code, loan_no_last4, txn_date);
CREATE INDEX IF NOT EXISTS ix_s050_loan_txns_org_date ON public.tb_s050_loan_txns (org_id, txn_date);
CREATE INDEX IF NOT EXISTS ix_s050_loan_txns_file ON public.tb_s050_loan_txns (file_id);

-- -----------------------------------------------------------------------------
-- 6. RLS — 운영사는 전부, 회사는 자기 단체만 (203 · 208 · 212 와 같은 정책)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tb_s050_tax_payments', 'tb_s050_social_ins', 'tb_s050_loan_txns'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS erp_org_scope ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY erp_org_scope ON public.%I FOR ALL '
      'USING (public.erp_is_operator() OR org_id = public.erp_current_org_id()) '
      'WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id())', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 7. 권한 — 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 준다(203 · 208 · 212 와 같다)
--   읽기 · 넣기만 — 고치기 · 지우기 없음(줄은 파일을 지울 때 CASCADE 로만 지워진다)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tb_s050_tax_payments FROM PUBLIC, anon, authenticated, erp_app;
REVOKE ALL ON public.tb_s050_social_ins   FROM PUBLIC, anon, authenticated, erp_app;
REVOKE ALL ON public.tb_s050_loan_txns    FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT, INSERT ON public.tb_s050_tax_payments TO erp_app;
GRANT SELECT, INSERT ON public.tb_s050_social_ins   TO erp_app;
GRANT SELECT, INSERT ON public.tb_s050_loan_txns    TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-214.js (node scripts/verify-214.js .env packages/api/.env)
--   ★ 215 를 적용한 뒤 돌린다 — 시험 파일 줄이 215 의 대응표 줄을 가리킨다.
--   적용 전 시험: node scripts/verify-214.js .env packages/api/.env --dry-run <214> <215>  (늘 ROLLBACK)
--   verify-203 · verify-212 도 다시 돌린다(올린 파일 · 대응표 표의 칸 수가 바뀌었다 — 그 스크립트의 칸 목록 · 칸 수를 함께 고친다).
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('tb_s050_tax_payments', 'tb_s050_social_ins', 'tb_s050_loan_txns');   -- 셋 다 t, t
-- node scripts/check-grants.js .env                                                        -- anon · authenticated 0건 그대로
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 새 종류 파일이 있으면 CHECK 를 지우기 전에 그 파일을 먼저 지운다(줄은 CASCADE). 먼저 센다:
--   SELECT kind, count(*) FROM public.tb_s050_upload_files WHERE kind IN ('NTAX', 'LTAX', 'SOCIAL', 'LOAN') GROUP BY 1;
--   ★ 대응표 은행 CHECK 는 212 의 모양으로 되돌린다 — 대출 대응표(215)를 먼저 지워야 걸린다(215 되돌리기 먼저)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS public.tb_s050_tax_payments;
-- DROP TABLE IF EXISTS public.tb_s050_social_ins;
-- DROP TABLE IF EXISTS public.tb_s050_loan_txns;
-- DELETE FROM public.tb_s050_upload_files WHERE kind IN ('NTAX', 'LTAX', 'SOCIAL', 'LOAN');
-- DROP INDEX IF EXISTS public.uq_s050_upload_files_social_month;
-- ALTER TABLE public.tb_s050_upload_files DROP CONSTRAINT IF EXISTS ck_s050_upload_files_social_kind;
-- ALTER TABLE public.tb_s050_upload_files DROP CONSTRAINT IF EXISTS ck_s050_upload_files_social_ins_tp;
-- ALTER TABLE public.tb_s050_upload_files DROP CONSTRAINT IF EXISTS ck_s050_upload_files_notice_month;
-- ALTER TABLE public.tb_s050_upload_files DROP COLUMN IF EXISTS social_ins_tp, DROP COLUMN IF EXISTS notice_month;
-- ALTER TABLE public.tb_s050_import_maps DROP CONSTRAINT IF EXISTS ck_s050_import_maps_social_kind;
-- ALTER TABLE public.tb_s050_import_maps DROP CONSTRAINT IF EXISTS ck_s050_import_maps_social_tps;
-- ALTER TABLE public.tb_s050_import_maps DROP COLUMN IF EXISTS social_ins_tps;
-- ALTER TABLE public.tb_s050_import_maps DROP CONSTRAINT IF EXISTS ck_s050_import_maps_bank_kind;
-- ALTER TABLE public.tb_s050_import_maps
--   ADD CONSTRAINT ck_s050_import_maps_bank_kind
--   CHECK ((kind = 'BANK') = (bank_code IS NOT NULL AND bank_file_tp IS NOT NULL)
--          AND (kind = 'BANK' OR (bank_code IS NULL AND bank_file_tp IS NULL)));
-- COMMENT ON COLUMN public.tb_s050_import_maps.bank_code IS
--   '은행 — 코드 BANK(000) 코드값. 은행 대응표(kind BANK)만 채운다. 고른 계좌의 은행으로 대응표를 찾는다.';
-- COMMIT;
