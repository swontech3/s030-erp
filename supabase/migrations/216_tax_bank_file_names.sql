-- =============================================================================
-- 216_tax_bank_file_names.sql
--
-- 세무(S05) 은행 파일 종류 코드 이름 바꾸기 (2026-11-05 대표 지시)
--
--   분류            코드값   지금 이름(213)   새 이름
--   TAX_BANK_FILE   TXN      거래내역         은행거래내역
--   TAX_BANK_FILE   XFER     이체 내역        은행이체내역
--
-- ★ 왜: 자료 올리기 「올린 파일」 표의 「구분」 칸에 은행 파일은 파일 종류 이름 하나만 보인다(「은행 입출금 · 이체 내역」처럼
--   이어 붙이지 않음). 이름만으로 은행 파일인 줄 알도록 「은행」을 붙인다. 화면 · 소스에는 글자를 박지 않는다 — 코드 이름 그대로 그린다.
-- ★ 이름이 213 그대로일 때만 바꾼다 — 코드 관리에서 고친 이름은 덮지 않는다. 코드값(TXN · XFER)은 그대로(212 CHECK 가 기댄다).
-- ★ 표 · 칸 · 권한은 건드리지 않는다. 코드 줄 이름만 고친다.
-- =============================================================================

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tb_s080_codes_line
   WHERE build_id = '1' AND category = 'TAX_BANK_FILE' AND use_tp = '000' AND code IN ('TXN', 'XFER');
  IF n <> 2 THEN
    RAISE EXCEPTION '216 — TAX_BANK_FILE 의 TXN · XFER 두 줄이 있어야 한다(지금 %줄). 213 을 먼저 적용할 것', n;
  END IF;
END $$;

UPDATE public.tb_s080_codes_line AS l
   SET name       = d.new_name,
       updated_at = CURRENT_TIMESTAMP
  FROM (VALUES
    ('TXN',  '거래내역',  '은행거래내역'),
    ('XFER', '이체 내역', '은행이체내역')
  ) AS d(code, old_name, new_name)
 WHERE l.build_id = '1' AND l.category = 'TAX_BANK_FILE' AND l.use_tp = '000' AND l.code = d.code
   AND l.name = d.old_name;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-216.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-216.js .env packages/api/.env --dry-run supabase/migrations/216_tax_bank_file_names.sql (늘 ROLLBACK)
--   그다음 node scripts/verify-213.js .env packages/api/.env — C2 의 이름 기대값을 새 이름으로 고쳤다.
-- =============================================================================
-- SELECT code, name FROM public.tb_s080_codes_line WHERE category = 'TAX_BANK_FILE' ORDER BY sort_order;
--   -- TXN 은행거래내역 · XFER 은행이체내역
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.tb_s080_codes_line SET name = '거래내역', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_BANK_FILE' AND code = 'TXN' AND name = '은행거래내역';
-- UPDATE public.tb_s080_codes_line SET name = '이체 내역', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_BANK_FILE' AND code = 'XFER' AND name = '은행이체내역';
-- COMMIT;
