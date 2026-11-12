-- =============================================================================
-- 208_tax_card_cash.sql
--
-- 세무(S05) 자료 올리기 — 카드 사용 내역 · 현금 경비 줄 표 둘 (1-4 멈춤 2, 2026-10-30, ★ 적용 전 승인 대기)
--
--   ① tb_s050_card_txns   카드 사용 내역 줄 — 홈택스 「사업용 신용카드 사용내역」만(카드사 양식 없음, 대표 결정)
--   ② tb_s050_cash_txns   현금 경비 줄 — 세무 표준 양식(화면에서 내려받는 양식)
--   ③ tb_s050_upload_files.direction(매입/매출) — 계산서 파일만 채우고, 카드 · 현금 파일은 비운다
--
-- ★ 결정(2026-10-30 대표, 설계 보고 12번 답):
--   - 표는 따로 둘(1). 매입 · 매출 항목 지정(s050300010)의 「미지정 건」 = 그 달 (매입 계산서 + 카드 줄 + 현금 매입 줄) 중 항목이 빈 줄
--   - 카드번호는 **끝 4자리만** 저장 · 응답 · 로그에 남긴다. 전체 번호는 어디에도 남기지 않는다 — card_last4 는 char(4) + 숫자 CHECK
--   - 카드 공제 여부(코드 TAX_CARD_DEDUCT Y · N) + 비고(불공제 사유, 파일 글 그대로)만 저장. 가맹점유형 · 업태 · 업종은 저장하지 않는다(2).
--     공제 여부 칸이 「공제 · 불공제」가 아니면 줄을 빼지 않고 비워서 넣고 경고한다(멈춤 2 판단 3) → vat_deduct NULL 허용
--   - 홈택스 파일에는 승인번호가 없다 → UNIQUE 를 걸 수 없다(같은 날 같은 가게 같은 금액 두 번이 실제로 있다).
--     중복 막기는 앱이 「개수 맞추기」로 한다(4 · 5) — 열쇠마다 파일 안 n개, DB m개면 n−m개만 넣는다. 열쇠 색인만 둔다
--       카드 열쇠: 끝 4자리 · 사용일 · 가맹점 사업자번호 · 합계
--       현금 열쇠: 날짜 · 품명 · 거래처 · 매출/매입 · 금액 · 지급방법
--   - 카드 취소는 음수 줄 그대로(6) — 금액 칸에 부호 CHECK 가 없다
--   - 카드 가맹점은 사업자번호가 있으면 거래처(일반 G)로 붙인다(7). 번호 없는 줄은 거래처 없이 → vendor_id NULL 허용
--   - 현금 거래처는 거래처 표에 넣지 않고 글로만 둔다(7) — 「지난번 항목」은 이 글이 같은 현금 줄끼리(8)
--   - 현금 매출(매출액 줄)은 넣되 항목이 없다(9 가) — 207 의 매출 계산서와 같은 CHECK
--   - 증빙은 선택(11) — proof NULL 허용. 필수는 날짜 · 품명 · 금액(하나) · 지급방법
--   - 등록 안 된 카드 끝 4자리 줄은 넣고 경고(3) — 그래서 세무 설정의 카드(tb_s050_fin_accounts)와 FK 로 묶지 않는다.
--     카드 별칭은 읽을 때 끝 4자리로 찾는다(세무 설정에서 카드를 지우거나 번호를 고쳐도 올린 줄이 막지 않는다)
-- ★ 코드 칸에는 FK 가 없다(ERP 공통). 앱이 코드값에 기대는 칸만 CHECK — vat_deduct(Y · N 또는 비움) · 현금 direction(P · S).
--   pay_method · proof 는 코드 관리에서 코드값을 더할 수 있게 CHECK 를 두지 않는다(지우기 막기는 CODE_USAGE 몫).
-- ★ FK 는 203 처럼 **단체까지 묶는다** — (org_id, file_id) · (org_id, vendor_id). FK 검사는 RLS 를 거치지 않는다.
--
-- 하는 일 · 영향
--   ① 새 표 둘을 만든다. RLS ENABLE + FORCE + erp_org_scope(203 과 같은 정책)
--   ② 올린 파일 표의 direction 에서 NOT NULL 을 풀고, 「계산서 파일이면 채움 · 아니면 비움」 CHECK 를 더한다.
--      지금 있는 줄은 모두 계산서 파일(direction 채움)이라 CHECK 에 걸리지 않는다
--   ③ erp_app: 두 표 = 읽기 · 넣기 · 항목 세 칸(item_code · classified_at · classified_by)만 고치기, 카드 표는 vendor_id 도(거래처 합치기).
--      지우기 권한 없음 — 파일을 지우면 FK CASCADE 로 함께 지워진다. anon · authenticated · PUBLIC 은 아무 권한 없음
--   ④ 다른 표 · 칸 · 자료 · 권한은 건드리지 않는다
--
-- 코드(TAX_PAY_METHOD · TAX_PROOF · TAX_CARD_DEDUCT · TAX_SKIP_REASON 더하기)와 대응표 두 줄은 209 가 넣는다.
-- =============================================================================

BEGIN;

-- 203 · 207 이 있어야 한다. 없으면 여기서 멈춘다(반쯤 만들어지지 않게).
DO $$
BEGIN
  IF to_regprocedure('public.erp_current_org_id()') IS NULL
     OR to_regprocedure('public.erp_is_operator()') IS NULL THEN
    RAISE EXCEPTION '208 — erp_current_org_id() · erp_is_operator() 가 없다. 003 · 037 을 먼저 적용할 것';
  END IF;
  IF to_regclass('public.tb_s050_upload_files') IS NULL OR to_regclass('public.tb_s050_vendors') IS NULL THEN
    RAISE EXCEPTION '208 — tb_s050_upload_files · tb_s050_vendors 가 없다. 203 을 먼저 적용할 것';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tb_s050_invoices' AND column_name = 'item_code') THEN
    RAISE EXCEPTION '208 — tb_s050_invoices.item_code 가 없다. 207 을 먼저 적용할 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 올린 파일 — 매입/매출 칸은 계산서 파일만(결정 19 — 카드 · 현금 파일은 비움)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_upload_files ALTER COLUMN direction DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_direction_kind') THEN
    ALTER TABLE public.tb_s050_upload_files
      ADD CONSTRAINT ck_s050_upload_files_direction_kind CHECK ((kind = 'INVOICE') = (direction IS NOT NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.tb_s050_upload_files.direction IS
  '계산서 구분 — 코드 TAX_INV_DIR(000) 코드값. P 매입 · S 매출. 계산서 파일만 채우고 카드 · 현금 파일은 비운다(CHECK).';

-- -----------------------------------------------------------------------------
-- 2. 카드 사용 내역 줄 — 홈택스 사업용 신용카드 사용내역
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_s050_card_txns (
  id                  text PRIMARY KEY,
  org_id              integer NOT NULL,
  file_id             text NOT NULL,
  vendor_id           text,
  card_last4          char(4) NOT NULL
                      CONSTRAINT ck_s050_card_txns_last4 CHECK (card_last4 ~ '^[0-9]{4}$'),
  use_date            date NOT NULL,
  merchant_name_src   varchar(200) NOT NULL,
  merchant_biz_no_src varchar(10)
                      CONSTRAINT ck_s050_card_txns_biz_no CHECK (merchant_biz_no_src ~ '^[0-9]{10}$'),
  supply_amount       bigint NOT NULL,
  tax_amount          bigint NOT NULL,
  nontax_amount       bigint NOT NULL,
  total_amount        bigint NOT NULL,
  vat_deduct          varchar(10)
                      CONSTRAINT ck_s050_card_txns_vat_deduct CHECK (vat_deduct IN ('Y', 'N')),
  deduct_note_src     varchar(50),
  item_code           varchar(20),
  classified_at       timestamp(3) without time zone,
  classified_by       text,
  created_at          timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- ★ 단체까지 묶는다 — 남의 단체 파일 · 거래처를 가리킬 수 없다(203 머리말)
  CONSTRAINT fk_s050_card_txns_file FOREIGN KEY (org_id, file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_s050_card_txns_vendor FOREIGN KEY (org_id, vendor_id)
    REFERENCES public.tb_s050_vendors (org_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.tb_s050_card_txns IS
  '세무(S05) 카드 사용 내역 줄 — 홈택스 사업용 신용카드 사용내역. 카드번호는 끝 4자리만. 승인번호가 없어 중복은 앱이 개수 맞추기로 막는다.';
COMMENT ON COLUMN public.tb_s050_card_txns.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_card_txns.file_id IS '들어온 파일. 파일을 지우면 이 줄도 지워진다(CASCADE).';
COMMENT ON COLUMN public.tb_s050_card_txns.vendor_id IS
  '거래처(가맹점 사업자번호로 붙인 곳). 번호 없는 줄은 비움. 가리키는 줄이 있으면 거래처를 지울 수 없다(RESTRICT).';
COMMENT ON COLUMN public.tb_s050_card_txns.card_last4 IS
  '카드번호 끝 4자리(숫자). ★ 전체 번호는 저장하지 않는다. 세무 설정의 카드와는 이 값으로 찾아 맞춘다(FK 없음).';
COMMENT ON COLUMN public.tb_s050_card_txns.use_date IS '사용일(파일의 승인일자). 어느 달 자료인지 이 날짜로 정한다.';
COMMENT ON COLUMN public.tb_s050_card_txns.merchant_name_src IS '가맹점명 — 파일에 적힌 그대로.';
COMMENT ON COLUMN public.tb_s050_card_txns.merchant_biz_no_src IS '가맹점 사업자번호 — 파일 값의 숫자만. 없으면 비움.';
COMMENT ON COLUMN public.tb_s050_card_txns.supply_amount IS '공급가액(원). 취소 줄은 음수.';
COMMENT ON COLUMN public.tb_s050_card_txns.tax_amount IS '세액(원).';
COMMENT ON COLUMN public.tb_s050_card_txns.nontax_amount IS '비과세(원).';
COMMENT ON COLUMN public.tb_s050_card_txns.total_amount IS '합계(원). 취소 줄은 음수.';
COMMENT ON COLUMN public.tb_s050_card_txns.vat_deduct IS '공제 여부 — 코드 TAX_CARD_DEDUCT(000) 코드값. Y 공제 · N 불공제. 파일 값이 그 둘이 아니면 비움(경고).';
COMMENT ON COLUMN public.tb_s050_card_txns.deduct_note_src IS '비고(불공제 사유) — 파일에 적힌 그대로(예: 선택불공제). 없으면 비움.';
COMMENT ON COLUMN public.tb_s050_card_txns.item_code IS
  '항목 — 코드 TAX_ITEM_OUT(001 법인 · 002 개인) 코드값. NULL = 미지정 건.';
COMMENT ON COLUMN public.tb_s050_card_txns.classified_at IS '항목을 확정한 때. 다시 확정하면 바뀐다.';
COMMENT ON COLUMN public.tb_s050_card_txns.classified_by IS '항목을 확정한 사람 — 삐용 회원 ID(s020MemberId).';

-- 개수 맞추기 열쇠(끝 4자리 · 사용일 · 가맹점번호 · 합계)
CREATE INDEX IF NOT EXISTS ix_s050_card_txns_dedup
  ON public.tb_s050_card_txns (org_id, card_last4, use_date, merchant_biz_no_src, total_amount);
CREATE INDEX IF NOT EXISTS ix_s050_card_txns_org_date
  ON public.tb_s050_card_txns (org_id, use_date);
CREATE INDEX IF NOT EXISTS ix_s050_card_txns_vendor
  ON public.tb_s050_card_txns (org_id, vendor_id);
CREATE INDEX IF NOT EXISTS ix_s050_card_txns_file
  ON public.tb_s050_card_txns (file_id);

-- -----------------------------------------------------------------------------
-- 3. 현금 경비 줄 — 세무 표준 양식
-- -----------------------------------------------------------------------------
-- ★ 매출액 · 매입액 중 하나만 적는다 — 매입액이면 P(출금), 매출액이면 S(입금). 금액은 늘 양수(0 보다 큼).
-- ★ 매출 줄은 항목이 없다(입금 항목은 뒤 단계) — 207 의 매출 계산서와 같은 CHECK.
CREATE TABLE IF NOT EXISTS public.tb_s050_cash_txns (
  id              text PRIMARY KEY,
  org_id          integer NOT NULL,
  file_id         text NOT NULL,
  use_date        date NOT NULL,
  description     varchar(200) NOT NULL
                  CONSTRAINT ck_s050_cash_txns_description CHECK (btrim(description) <> ''),
  vendor_name_src varchar(200),
  direction       varchar(10) NOT NULL
                  CONSTRAINT ck_s050_cash_txns_direction CHECK (direction IN ('P', 'S')),
  amount          bigint NOT NULL
                  CONSTRAINT ck_s050_cash_txns_amount CHECK (amount > 0),
  pay_method      varchar(10) NOT NULL,
  proof           varchar(10),
  item_code       varchar(20),
  classified_at   timestamp(3) without time zone,
  classified_by   text,
  created_at      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_s050_cash_txns_item_purchase CHECK (direction = 'P' OR item_code IS NULL),
  CONSTRAINT fk_s050_cash_txns_file FOREIGN KEY (org_id, file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.tb_s050_cash_txns IS
  '세무(S05) 현금 경비 줄 — 세무 표준 양식. 거래처는 글로만(거래처 표에 넣지 않음). 중복은 앱이 개수 맞추기로 막는다.';
COMMENT ON COLUMN public.tb_s050_cash_txns.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_cash_txns.file_id IS '들어온 파일. 파일을 지우면 이 줄도 지워진다(CASCADE).';
COMMENT ON COLUMN public.tb_s050_cash_txns.use_date IS '날짜. 어느 달 자료인지 이 날짜로 정한다.';
COMMENT ON COLUMN public.tb_s050_cash_txns.description IS '품명(필수).';
COMMENT ON COLUMN public.tb_s050_cash_txns.vendor_name_src IS '거래처 — 파일에 적힌 글 그대로(선택). 「지난번 항목」은 이 글이 같은 현금 줄끼리 찾는다.';
COMMENT ON COLUMN public.tb_s050_cash_txns.direction IS '코드 TAX_INV_DIR(000) 코드값. P 매입(매입액 칸) · S 매출(매출액 칸).';
COMMENT ON COLUMN public.tb_s050_cash_txns.amount IS '금액(원, 0 보다 큼) — 매입액 또는 매출액.';
COMMENT ON COLUMN public.tb_s050_cash_txns.pay_method IS
  '지급방법 — 코드 TAX_PAY_METHOD(000) 코드값. TRANSFER(계좌이체 · 직원 정산) 줄은 뒤 단계 은행 짝 맞추기에서 이체 줄과 짝이 된다.';
COMMENT ON COLUMN public.tb_s050_cash_txns.proof IS '증빙 — 코드 TAX_PROOF(000) 코드값. 선택.';
COMMENT ON COLUMN public.tb_s050_cash_txns.item_code IS
  '항목 — 코드 TAX_ITEM_OUT(001 법인 · 002 개인) 코드값. NULL = 미지정 건(매입만). 매출(S)은 늘 NULL(CHECK).';
COMMENT ON COLUMN public.tb_s050_cash_txns.classified_at IS '항목을 확정한 때(파일에 항목이 적혀 있었으면 올린 때). 다시 확정하면 바뀐다.';
COMMENT ON COLUMN public.tb_s050_cash_txns.classified_by IS '항목을 확정한 사람(파일에서 왔으면 올린 사람) — 삐용 회원 ID(s020MemberId).';

-- 개수 맞추기 열쇠의 앞부분(날짜 · 금액) — 나머지는 걸러 낸 줄에서 앱이 견준다
CREATE INDEX IF NOT EXISTS ix_s050_cash_txns_dedup
  ON public.tb_s050_cash_txns (org_id, use_date, amount);
CREATE INDEX IF NOT EXISTS ix_s050_cash_txns_file
  ON public.tb_s050_cash_txns (file_id);

-- -----------------------------------------------------------------------------
-- 4. RLS — 운영사는 전부, 회사는 자기 단체만 (203 과 같은 정책)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tb_s050_card_txns', 'tb_s050_cash_txns'] LOOP
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
-- 5. 권한 — 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 준다(203 과 같다)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tb_s050_card_txns FROM PUBLIC, anon, authenticated, erp_app;
REVOKE ALL ON public.tb_s050_cash_txns FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT, INSERT ON public.tb_s050_card_txns TO erp_app;
GRANT SELECT, INSERT ON public.tb_s050_cash_txns TO erp_app;
-- 항목 지정 세 칸만 고친다 — 금액 · 날짜 · 카드번호는 고칠 수 없다
GRANT UPDATE (item_code, classified_at, classified_by) ON public.tb_s050_card_txns TO erp_app;
GRANT UPDATE (item_code, classified_at, classified_by) ON public.tb_s050_cash_txns TO erp_app;
-- 카드 줄은 거래처 합치기 때 거래처도 옮긴다(203 의 계산서와 같다)
GRANT UPDATE (vendor_id) ON public.tb_s050_card_txns TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-208.js (node scripts/verify-208.js .env packages/api/.env)
--   ★ 209 를 적용한 뒤 돌린다 — 시험 파일 줄이 209 의 대응표 줄(HOMETAX_BIZ_CARD · TAX_CASH_STD)을 가리킨다.
--   verify-203 도 다시 돌린다(올린 파일 표의 direction 이 바뀌었다).
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('tb_s050_card_txns', 'tb_s050_cash_txns');                  -- 둘 다 t, t
-- node scripts/check-grants.js .env                                               -- anon · authenticated 0건 그대로
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 새 표 둘을 지우고 direction 을 되돌린다. 카드 · 현금 파일이 있으면 NOT NULL 이 걸리지 않으므로
--   그 파일을 먼저 지운다(줄은 CASCADE 로 함께 사라진다). 먼저 센다:
--   SELECT kind, count(*) FROM public.tb_s050_upload_files WHERE kind <> 'INVOICE' GROUP BY 1;
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s050_upload_files WHERE kind <> 'INVOICE';
-- DROP TABLE IF EXISTS public.tb_s050_cash_txns;
-- DROP TABLE IF EXISTS public.tb_s050_card_txns;
-- ALTER TABLE public.tb_s050_upload_files DROP CONSTRAINT IF EXISTS ck_s050_upload_files_direction_kind;
-- ALTER TABLE public.tb_s050_upload_files ALTER COLUMN direction SET NOT NULL;
-- COMMIT;
