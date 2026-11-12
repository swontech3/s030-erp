-- =============================================================================
-- 212_tax_bank_txns.sql
--
-- 세무(S05) 자료 올리기 — 은행 거래내역 줄 표 · 올린 파일과 대응표의 은행 칸 (1-5 멈춤 2, 2026-11-01, ★ 적용 전 승인 대기)
--
--   ① tb_s050_bank_txns      은행 거래내역 줄 — 은행마다 받은 엑셀을 대응표로 바꿔 넣는다(국민 004 · 우리 020 · 하나 081)
--                            + 이체 내역을 덧붙이는 칸 여섯(출금 줄만 — 이체 내역은 따로 저장하지 않는다)
--   ② tb_s050_upload_files   은행 칸 셋 — bank_file_tp(TXN 거래내역 · XFER 이체 내역) · account_no(고른 계좌번호) · bank_code
--   ③ tb_s050_import_maps    은행 칸 둘 — bank_code · bank_file_tp. 켜진 은행 대응표는 (은행, 파일 종류)마다 하나
--
-- ★ 결정(2026-11-01 대표, 설계 보고 12번 답):
--   - 올릴 때 세무 설정의 은행 계좌를 고른다 → 그 계좌의 은행 대응표를 쓴다(기관을 따로 고르지 않음)
--   - 이체 내역은 따로 저장하지 않는다. 거래내역의 **출금 줄**에 받는 은행 · 받는 계좌 · 예금주 · 메모 둘을 덧붙인다
--     (같은 돈이 두 번 잡히지 않게). 세무사 전달(뒤 단계)은 이 칸으로 「거래내역 · 이체 내역」 두 시트를 만든다
--   - ★★ 받는 계좌번호는 **끝 4자리만** 저장 · 응답 · 로그에 남긴다(4) — xfer_account_last4 는 char(4) + 숫자 CHECK
--   - 메모는 두 칸 모두 — 받는분 통장표시(xfer_to_memo_src) · 보내는분 통장표시(xfer_from_memo_src)(5)
--   - 이체 칸은 「모두 차 있음 / 모두 비어 있음」 CHECK(6). 이체 파일을 지울 때 **앱이 먼저 비운다** →
--     이체 파일 FK 는 RESTRICT(NO ACTION) — 비우지 않고 지우면 DB 가 막는다
--     ★ 메모 둘은 은행 파일에서 빈 칸일 수 있어 「덧붙인 줄만 채울 수 있음(비워도 됨)」으로 걸었다 — 대표 확인 대기
--   - 국민 「내 통장 표시」는 저장한다(my_note_src)(7). 처리점 · 구분 · 거래특이사항 · 수표 칸은 저장하지 않는다
--   - 이체일시 · 수수료는 저장하지 않는다(15) — 세무사 「이체 내역」 시트는 그 출금 줄의 거래일시 · 출금액을 쓴다
--   - 계좌는 계좌 id 가 아니라 **계좌번호(숫자) + 은행 코드**로 둔다(설계 4 — 카드 card_last4 와 같은 이유).
--     세무 설정 저장은 「지우고 다시 넣기 · 고치기」라 id FK 를 걸면 계좌를 지울 때 막히고, 번호를 고치면 올린 줄의 뜻이 바뀐다.
--     이 번호는 **우리 회사 계좌**(세무 설정에 등록한 것)라 전체를 둔다 — 남의 계좌(받는 계좌)는 끝 4자리만
--   - 은행 파일에는 고유 거래번호가 없다 → UNIQUE 를 걸지 않는다. 중복 막기는 앱이 「개수 맞추기」로 한다(설계 3)
--       열쇠: 계좌번호 · 거래일시(초까지) · 입금 · 출금 · 잔액 — 열쇠 색인만 둔다
--   - 취소는 반대쪽 금액의 별도 줄 그대로(설계 5) — 잔액은 마이너스 통장이 있어 부호 CHECK 가 없다
-- ★ 코드 칸(bank_code · bank_file_tp)에는 FK 가 없다(ERP 공통). 앱이 코드값에 기대는 bank_file_tp 만 CHECK(TXN · XFER).
--   bank_code 는 코드 관리에서 은행을 더할 수 있게 CHECK 를 두지 않는다(대응표가 없는 은행은 앱이 「아직 받지 못합니다」로 막음).
-- ★ FK 는 203 · 208 처럼 **단체까지 묶는다** — (org_id, file_id) · (org_id, xfer_file_id). FK 검사는 RLS 를 거치지 않는다.
--   덧붙인 이체 파일이 「XFER 파일」인지 · 같은 계좌인지는 DB 가 보지 않는다(앱이 본다 — 트리거를 두지 않음).
--
-- 하는 일 · 영향
--   ① 새 표 하나를 만든다. RLS ENABLE + FORCE + erp_org_scope(203 · 208 과 같은 정책)
--   ② 올린 파일 표에 칸 셋(비울 수 있음) + CHECK 셋. 지금 있는 파일은 모두 계산서 · 카드 · 현금이라 은행 칸이 비어 걸리지 않는다
--   ③ 대응표 표에 칸 둘(비울 수 있음) + CHECK 둘 + UNIQUE 부분 색인. 지금 있는 세 줄은 은행이 아니라 걸리지 않는다
--   ④ erp_app: 새 표 = 읽기 · 넣기 · 이체 칸 여섯만 고치기. 지우기 없음 — 거래내역 파일을 지우면 FK CASCADE 로 함께 지워진다.
--      anon · authenticated · PUBLIC 은 아무 권한 없음. 올린 파일 · 대응표 표의 권한은 그대로(새 칸도 표 권한을 따른다)
--   ⑤ 다른 표 · 칸 · 자료 · 권한은 건드리지 않는다
--
-- 코드(TAX_BANK_FILE · TAX_SKIP_REASON 더하기 · TAX_KIND BANK 설명)와 대응표 네 줄은 213 이 넣는다.
-- =============================================================================

BEGIN;

-- 203 · 208 이 있어야 한다. 없으면 여기서 멈춘다(반쯤 만들어지지 않게).
DO $$
BEGIN
  IF to_regprocedure('public.erp_current_org_id()') IS NULL
     OR to_regprocedure('public.erp_is_operator()') IS NULL THEN
    RAISE EXCEPTION '212 — erp_current_org_id() · erp_is_operator() 가 없다. 003 · 037 을 먼저 적용할 것';
  END IF;
  IF to_regclass('public.tb_s050_upload_files') IS NULL OR to_regclass('public.tb_s050_import_maps') IS NULL THEN
    RAISE EXCEPTION '212 — tb_s050_upload_files · tb_s050_import_maps 가 없다. 203 을 먼저 적용할 것';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_direction_kind') THEN
    RAISE EXCEPTION '212 — 올린 파일의 매입/매출 CHECK 가 없다. 208 을 먼저 적용할 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 대응표 — 은행 칸 둘 (은행 대응표만 채움)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_import_maps ADD COLUMN IF NOT EXISTS bank_code    varchar(10);
ALTER TABLE public.tb_s050_import_maps ADD COLUMN IF NOT EXISTS bank_file_tp varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_import_maps'::regclass AND conname = 'ck_s050_import_maps_bank_kind') THEN
    ALTER TABLE public.tb_s050_import_maps
      ADD CONSTRAINT ck_s050_import_maps_bank_kind
      CHECK ((kind = 'BANK') = (bank_code IS NOT NULL AND bank_file_tp IS NOT NULL)
             AND (kind = 'BANK' OR (bank_code IS NULL AND bank_file_tp IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_import_maps'::regclass AND conname = 'ck_s050_import_maps_bank_file_tp') THEN
    ALTER TABLE public.tb_s050_import_maps
      ADD CONSTRAINT ck_s050_import_maps_bank_file_tp CHECK (bank_file_tp IN ('TXN', 'XFER'));
  END IF;
END $$;

-- 켜진 은행 대응표는 (은행, 파일 종류)마다 하나 — 앱이 이 둘로 한 줄을 찾는다
CREATE UNIQUE INDEX IF NOT EXISTS uq_s050_import_maps_bank
  ON public.tb_s050_import_maps (bank_code, bank_file_tp) WHERE is_active AND kind = 'BANK';

COMMENT ON COLUMN public.tb_s050_import_maps.bank_code IS
  '은행 — 코드 BANK(000) 코드값. 은행 대응표(kind BANK)만 채운다. 고른 계좌의 은행으로 대응표를 찾는다.';
COMMENT ON COLUMN public.tb_s050_import_maps.bank_file_tp IS
  '은행 파일 종류 — 코드 TAX_BANK_FILE(000) 코드값. TXN 거래내역 · XFER 이체 내역. 은행 대응표만 채운다.';

-- -----------------------------------------------------------------------------
-- 2. 올린 파일 — 은행 칸 셋 (은행 파일만 채움)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_upload_files ADD COLUMN IF NOT EXISTS bank_file_tp varchar(10);
ALTER TABLE public.tb_s050_upload_files ADD COLUMN IF NOT EXISTS account_no   varchar(14);
ALTER TABLE public.tb_s050_upload_files ADD COLUMN IF NOT EXISTS bank_code    varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_bank_kind') THEN
    ALTER TABLE public.tb_s050_upload_files
      ADD CONSTRAINT ck_s050_upload_files_bank_kind
      CHECK ((kind = 'BANK') = (bank_file_tp IS NOT NULL AND account_no IS NOT NULL AND bank_code IS NOT NULL)
             AND (kind = 'BANK' OR (bank_file_tp IS NULL AND account_no IS NULL AND bank_code IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_bank_file_tp') THEN
    ALTER TABLE public.tb_s050_upload_files
      ADD CONSTRAINT ck_s050_upload_files_bank_file_tp CHECK (bank_file_tp IN ('TXN', 'XFER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_upload_files'::regclass AND conname = 'ck_s050_upload_files_account_no') THEN
    ALTER TABLE public.tb_s050_upload_files
      ADD CONSTRAINT ck_s050_upload_files_account_no CHECK (account_no ~ '^[0-9]{10,14}$');
  END IF;
END $$;

COMMENT ON COLUMN public.tb_s050_upload_files.bank_file_tp IS
  '은행 파일 종류 — 코드 TAX_BANK_FILE(000) 코드값. TXN 거래내역 · XFER 이체 내역. 은행 파일(kind BANK)만 채운다(CHECK).';
COMMENT ON COLUMN public.tb_s050_upload_files.account_no IS
  '올릴 때 고른 우리 회사 계좌번호(숫자만, 10~14자리). 은행 파일만. 별칭은 읽을 때 세무 설정에서 이 번호로 찾는다(FK 없음).';
COMMENT ON COLUMN public.tb_s050_upload_files.bank_code IS '그 계좌의 은행 — 코드 BANK(000) 코드값. 은행 파일만.';

-- -----------------------------------------------------------------------------
-- 3. 은행 거래내역 줄
-- -----------------------------------------------------------------------------
-- ★ 입금 · 출금은 한쪽만 0 보다 크다(샘플 세 은행 모두 그렇다). 둘 다 있거나 둘 다 0 인 줄은 앱이 뺀 줄로 센다.
-- ★ 이체 칸 — 파일 · 받는 은행 · 받는 계좌 끝 4자리 · 예금주는 모두 차 있거나 모두 비어 있다. 메모 둘은 덧붙인 줄에만(비워도 됨).
--   출금 줄에만 덧붙인다.
CREATE TABLE IF NOT EXISTS public.tb_s050_bank_txns (
  id                 text PRIMARY KEY,
  org_id             integer NOT NULL,
  file_id            text NOT NULL,
  account_no         varchar(14) NOT NULL
                     CONSTRAINT ck_s050_bank_txns_account_no CHECK (account_no ~ '^[0-9]{10,14}$'),
  bank_code          varchar(10) NOT NULL,
  txn_at             timestamp(0) without time zone NOT NULL,
  description_src    varchar(200),
  counterparty_src   varchar(200),
  my_note_src        varchar(200),
  memo_src           varchar(200),
  in_amount          bigint NOT NULL CONSTRAINT ck_s050_bank_txns_in_amount  CHECK (in_amount >= 0),
  out_amount         bigint NOT NULL CONSTRAINT ck_s050_bank_txns_out_amount CHECK (out_amount >= 0),
  balance            bigint NOT NULL,
  xfer_file_id       text,
  xfer_bank_src      varchar(50),
  xfer_account_last4 char(4)
                     CONSTRAINT ck_s050_bank_txns_xfer_last4 CHECK (xfer_account_last4 ~ '^[0-9]{4}$'),
  xfer_holder_src    varchar(100),
  xfer_to_memo_src   varchar(100),
  xfer_from_memo_src varchar(100),
  created_at         timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_s050_bank_txns_one_side CHECK ((in_amount > 0) <> (out_amount > 0)),
  CONSTRAINT ck_s050_bank_txns_xfer_all CHECK (
    (xfer_file_id IS NOT NULL AND xfer_bank_src IS NOT NULL AND xfer_account_last4 IS NOT NULL AND xfer_holder_src IS NOT NULL)
    OR (xfer_file_id IS NULL AND xfer_bank_src IS NULL AND xfer_account_last4 IS NULL AND xfer_holder_src IS NULL
        AND xfer_to_memo_src IS NULL AND xfer_from_memo_src IS NULL)),
  CONSTRAINT ck_s050_bank_txns_xfer_out CHECK (xfer_file_id IS NULL OR out_amount > 0),
  -- ★ 단체까지 묶는다 — 남의 단체 파일을 가리킬 수 없다(203 머리말)
  CONSTRAINT fk_s050_bank_txns_file FOREIGN KEY (org_id, file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE CASCADE,
  -- ★ 이체 파일은 RESTRICT — 덧붙인 줄이 있으면 못 지운다(앱이 이체 칸을 먼저 비운다, 결정 6)
  CONSTRAINT fk_s050_bank_txns_xfer_file FOREIGN KEY (org_id, xfer_file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.tb_s050_bank_txns IS
  '세무(S05) 은행 거래내역 줄 — 은행 엑셀을 대응표로 바꾼 것. 출금 줄에 이체 내역(받는 은행 · 계좌 끝 4자리 · 예금주 · 메모)을 덧붙인다. 거래번호가 없어 중복은 앱이 개수 맞추기로 막는다.';
COMMENT ON COLUMN public.tb_s050_bank_txns.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_bank_txns.file_id IS '들어온 거래내역 파일. 파일을 지우면 이 줄도 지워진다(CASCADE).';
COMMENT ON COLUMN public.tb_s050_bank_txns.account_no IS
  '우리 회사 계좌번호(숫자만) — 올릴 때 고른 세무 설정 계좌. 별칭은 읽을 때 이 번호로 찾는다(FK 없음).';
COMMENT ON COLUMN public.tb_s050_bank_txns.bank_code IS '은행 — 코드 BANK(000) 코드값.';
COMMENT ON COLUMN public.tb_s050_bank_txns.txn_at IS '거래일시(초까지) — 파일에 적힌 은행 시각 그대로(시간대 없음). 어느 달 자료인지 이 날짜로 정한다.';
COMMENT ON COLUMN public.tb_s050_bank_txns.description_src IS '적요 — 파일 그대로.';
COMMENT ON COLUMN public.tb_s050_bank_txns.counterparty_src IS '상대 — 국민 「보낸분/받는분」 · 우리 「기재내용」 · 하나 「의뢰인/수취인」, 파일 그대로.';
COMMENT ON COLUMN public.tb_s050_bank_txns.my_note_src IS '내 통장 표시 — 국민만(파일 그대로). 다른 은행은 비움.';
COMMENT ON COLUMN public.tb_s050_bank_txns.memo_src IS '메모 — 파일의 메모 칸 그대로.';
COMMENT ON COLUMN public.tb_s050_bank_txns.in_amount IS '입금(원, 0 이상). 입금 · 출금 중 한쪽만 0 보다 크다.';
COMMENT ON COLUMN public.tb_s050_bank_txns.out_amount IS '출금(원, 0 이상).';
COMMENT ON COLUMN public.tb_s050_bank_txns.balance IS '거래후 잔액(원). 마이너스 통장이 있어 부호 CHECK 가 없다.';
COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_file_id IS
  '덧붙인 이체 내역 파일. 비면 덧붙인 이체 없음. 덧붙인 줄이 있으면 그 파일을 지울 수 없다(RESTRICT — 앱이 먼저 비운다).';
COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_bank_src IS '받는 은행 — 이체 파일의 「입금은행」 글자 그대로(코드로 바꾸지 않는다).';
COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_account_last4 IS
  '받는 계좌번호 끝 4자리(숫자). ★ 전체 번호는 저장하지 않는다(대표 결정 2026-11-01).';
COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_holder_src IS '예금주 — 이체 파일의 「받는분」 그대로.';
COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_to_memo_src IS '받는분 통장표시 — 이체 파일 그대로. 비울 수 있다.';
COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_from_memo_src IS '보내는분 통장표시 — 이체 파일 그대로. 비울 수 있다.';

-- 개수 맞추기 열쇠(계좌번호 · 거래일시 · 입금 · 출금 · 잔액)
CREATE INDEX IF NOT EXISTS ix_s050_bank_txns_dedup
  ON public.tb_s050_bank_txns (org_id, account_no, txn_at, in_amount, out_amount, balance);
CREATE INDEX IF NOT EXISTS ix_s050_bank_txns_org_date
  ON public.tb_s050_bank_txns (org_id, txn_at);
CREATE INDEX IF NOT EXISTS ix_s050_bank_txns_file
  ON public.tb_s050_bank_txns (file_id);
CREATE INDEX IF NOT EXISTS ix_s050_bank_txns_xfer_file
  ON public.tb_s050_bank_txns (xfer_file_id) WHERE xfer_file_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. RLS — 운영사는 전부, 회사는 자기 단체만 (203 · 208 과 같은 정책)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_bank_txns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s050_bank_txns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_org_scope ON public.tb_s050_bank_txns;
CREATE POLICY erp_org_scope ON public.tb_s050_bank_txns FOR ALL
  USING (public.erp_is_operator() OR org_id = public.erp_current_org_id())
  WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id());

-- -----------------------------------------------------------------------------
-- 5. 권한 — 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 준다(203 · 208 과 같다)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tb_s050_bank_txns FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT, INSERT ON public.tb_s050_bank_txns TO erp_app;
-- 이체를 덧붙이고 비우는 여섯 칸만 고친다 — 금액 · 잔액 · 거래일시 · 계좌는 고칠 수 없다
GRANT UPDATE (xfer_file_id, xfer_bank_src, xfer_account_last4, xfer_holder_src, xfer_to_memo_src, xfer_from_memo_src)
  ON public.tb_s050_bank_txns TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-212.js (node scripts/verify-212.js .env packages/api/.env)
--   ★ 213 을 적용한 뒤 돌린다 — 시험 파일 줄이 213 의 대응표 줄(BANK_004_TXN · BANK_020_XFER)을 가리킨다.
--   적용 전 시험: node scripts/verify-212.js .env packages/api/.env --dry-run <212> <213>  (늘 ROLLBACK)
--   verify-203 도 다시 돌린다(올린 파일 · 대응표 표의 칸 수가 바뀌었다 — 그 스크립트의 칸 목록을 함께 고친다).
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tb_s050_bank_txns';  -- t, t
-- node scripts/check-grants.js .env                                                                       -- anon · authenticated 0건 그대로
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 은행 파일이 있으면 은행 칸 CHECK 를 지우기 전에 그 파일을 먼저 지운다(줄은 CASCADE). 먼저 센다:
--   SELECT bank_file_tp, count(*) FROM public.tb_s050_upload_files WHERE kind = 'BANK' GROUP BY 1;
--   ★ 이체 파일은 덧붙인 줄이 있으면 RESTRICT 로 막힌다 — 표를 먼저 지우면 된다(아래 순서)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS public.tb_s050_bank_txns;
-- DELETE FROM public.tb_s050_upload_files WHERE kind = 'BANK';
-- ALTER TABLE public.tb_s050_upload_files DROP CONSTRAINT IF EXISTS ck_s050_upload_files_bank_kind;
-- ALTER TABLE public.tb_s050_upload_files DROP CONSTRAINT IF EXISTS ck_s050_upload_files_bank_file_tp;
-- ALTER TABLE public.tb_s050_upload_files DROP CONSTRAINT IF EXISTS ck_s050_upload_files_account_no;
-- ALTER TABLE public.tb_s050_upload_files DROP COLUMN IF EXISTS bank_file_tp, DROP COLUMN IF EXISTS account_no, DROP COLUMN IF EXISTS bank_code;
-- DELETE FROM public.tb_s050_import_maps WHERE kind = 'BANK';      -- 213 의 네 줄(213 되돌리기와 같다)
-- DROP INDEX IF EXISTS public.uq_s050_import_maps_bank;
-- ALTER TABLE public.tb_s050_import_maps DROP CONSTRAINT IF EXISTS ck_s050_import_maps_bank_kind;
-- ALTER TABLE public.tb_s050_import_maps DROP CONSTRAINT IF EXISTS ck_s050_import_maps_bank_file_tp;
-- ALTER TABLE public.tb_s050_import_maps DROP COLUMN IF EXISTS bank_code, DROP COLUMN IF EXISTS bank_file_tp;
-- COMMIT;
