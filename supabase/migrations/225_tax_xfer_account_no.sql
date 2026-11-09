-- =============================================================================
-- 225_tax_xfer_account_no.sql
--
-- 세무(S05) 은행 거래내역 — 이체 받는 계좌번호 **전체**를 저장하는 칸(2026-11-08 대표 결정: 11-01 「끝 4자리만」을 이체 받는 계좌에 한해 바꾼다)
--
--   tb_s050_bank_txns.xfer_account_no  varchar(30) NULL — 받는 계좌번호 숫자 전체(이체 파일 그대로, 숫자만)
--     CHECK ck_s050_bank_txns_xfer_account_no — 비었거나, 숫자 4~30자리 · 덧붙인 줄(xfer_file_id 있음)만 · 끝 4자리가 xfer_account_last4 와 같다
--   erp_app — UPDATE (xfer_account_no) 칸 단위(212 의 덧붙이기 · 비우기 여섯 칸과 같은 원칙)
--
-- ★ 끝 4자리 칸(xfer_account_last4)은 그대로 둔다 — 다른 화면이 쓴다. 이체 파일을 읽을 때 둘을 함께 저장한다.
-- ★ 있는 줄은 NULL — 끝 4자리만 있다. **이체 파일을 다시 올려야(지우고 다시 올리기) 전체 번호가 들어간다.**
-- ★ 세무사 전달 서류의 「이체내역」 시트만 전체 번호를 내보낸다. 다른 시트 · 화면은 끝 4자리 그대로.
--
-- 하는 일 · 영향: 칸 하나 · CHECK 하나 · 칸 권한 하나를 더한다. 다른 표 · 칸 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(IF NOT EXISTS · CHECK 는 지우고 다시).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tb_s050_bank_txns') IS NULL THEN
    RAISE EXCEPTION '225 — 은행 거래내역 표가 없다. 212 를 먼저 적용할 것';
  END IF;
END $$;

ALTER TABLE public.tb_s050_bank_txns ADD COLUMN IF NOT EXISTS xfer_account_no varchar(30);

ALTER TABLE public.tb_s050_bank_txns DROP CONSTRAINT IF EXISTS ck_s050_bank_txns_xfer_account_no;
ALTER TABLE public.tb_s050_bank_txns ADD CONSTRAINT ck_s050_bank_txns_xfer_account_no CHECK (
  xfer_account_no IS NULL
  OR (xfer_account_no ~ '^[0-9]{4,30}$' AND xfer_file_id IS NOT NULL AND right(xfer_account_no, 4) = xfer_account_last4)
);

COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_account_no IS
  '받는 계좌번호 전체(숫자만, 225). 덧붙인 줄만 · 끝 4자리는 xfer_account_last4 와 같다. 225 전에 덧붙인 줄은 비어 있다(이체 파일을 다시 올리면 채워진다). 세무사 전달 「이체내역」 시트만 내보낸다.';
COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_account_last4 IS
  '받는 계좌번호 끝 4자리(숫자). 다른 화면은 이 칸만 쓴다. 전체 번호는 xfer_account_no(225 — 2026-11-08 대표 결정으로 이체 받는 계좌에 한해 저장).';

GRANT UPDATE (xfer_account_no) ON public.tb_s050_bank_txns TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-225.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-225.js .env packages/api/.env --dry-run supabase/migrations/225_tax_xfer_account_no.sql (늘 ROLLBACK)
--   그다음 node scripts/verify-212.js .env packages/api/.env (칸 · CHECK · 권한 목록에 이 칸) · npm run verify:tax-uploads · npm run verify:tax-handoff
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 저장한 전체 번호가 함께 지워진다(끝 4자리는 남는다). 앱(이체 읽기 · 저장 · 이체내역 시트)을 먼저 내린다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- REVOKE UPDATE (xfer_account_no) ON public.tb_s050_bank_txns FROM erp_app;
-- ALTER TABLE public.tb_s050_bank_txns DROP CONSTRAINT IF EXISTS ck_s050_bank_txns_xfer_account_no;
-- ALTER TABLE public.tb_s050_bank_txns DROP COLUMN IF EXISTS xfer_account_no;
-- COMMENT ON COLUMN public.tb_s050_bank_txns.xfer_account_last4 IS
--   '받는 계좌번호 끝 4자리(숫자). ★ 전체 번호는 저장하지 않는다(대표 결정 2026-11-01).';
-- COMMIT;
