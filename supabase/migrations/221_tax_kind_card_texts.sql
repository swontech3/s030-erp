-- =============================================================================
-- 221_tax_kind_card_texts.sql
--
-- 세무(S05) 자료 종류 코드(TAX_KIND) 이름 · 설명 바꾸기 (2026-11-07 대표 지시 — 화면 전체 수정 ④ 자료 올리기)
--
--   코드값    지금 이름(202)      새 이름
--   INVOICE   매입·매출 계산서    매출 · 매입파일
--   BANK      은행 입출금         은행거래 및 이체내역
--   NTAX      국세 납부           국세 납부 내역
--   LTAX      지방세 납부         지방세 내역
--   (CARD 카드 사용 내역 · CASH 현금 경비 · LOAN 대출 내역 · SOCIAL 4대보험 — 이름 그대로)
--
--   코드값    새 설명
--   INVOICE   홈택스에서 받은 엑셀 파일 업로드
--   CARD      홈택스 사업용 신용카드 엑셀 파일 업로드
--   CASH      표준양식을 받아 작성한 엑셀 파일 업로드
--   BANK      은행별 거래내역 · 이체내역 엑셀 업로드
--   NTAX      홈택스 납부내역 엑셀 파일 업로드
--   LTAX      위택스 · 이택스 납부내역 엑셀 파일 업로드
--   LOAN      원금 · 이자가 있는 은행별 대출내역 엑셀 파일 업로드
--   (SOCIAL 은 그대로 — 4대보험은 자료 올리기 카드에서 빠지고 인사 시스템으로 넘어간다)
--
-- ★ 왜: 자료 올리기 카드 제목 · 설명 한 줄을 짧게. 화면은 코드 이름 · 설명 그대로 그린다(소스에 글자를 박지 않는다).
--   이름은 다른 세무 화면(항목 지정 · 세무사 전달 · 올린 파일 구분 등)에도 그대로 보인다.
-- ★ 「개인 경비」(전 「삐용 경비」)는 TAX_KIND 코드가 아니다 — 화면 글자로 둔다(대표 결정 2026-11-07).
-- ★ 지금 값(202 이름 · 206/209/213/215 설명) 그대로일 때만 바꾼다 — 코드 관리에서 고친 값은 덮지 않는다.
--   코드값은 그대로(203 · 212 · 214 CHECK 가 기댄다). 표 · 칸 · 권한은 건드리지 않는다.
-- =============================================================================

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tb_s080_codes_line
   WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000'
     AND code IN ('INVOICE', 'CARD', 'CASH', 'BANK', 'NTAX', 'LTAX', 'SOCIAL', 'LOAN');
  IF n <> 8 THEN
    RAISE EXCEPTION '221 — TAX_KIND 코드값 8줄이 있어야 한다(지금 %줄). 202 를 먼저 적용할 것', n;
  END IF;
END $$;

-- 1. 이름 — 202 이름 그대로인 줄만
UPDATE public.tb_s080_codes_line AS l
   SET name       = d.new_name,
       updated_at = CURRENT_TIMESTAMP
  FROM (VALUES
    ('INVOICE', '매입·매출 계산서', '매출 · 매입파일'),
    ('BANK',    '은행 입출금',      '은행거래 및 이체내역'),
    ('NTAX',    '국세 납부',        '국세 납부 내역'),
    ('LTAX',    '지방세 납부',      '지방세 내역')
  ) AS d(code, old_name, new_name)
 WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.use_tp = '000' AND l.code = d.code
   AND l.name = d.old_name;

-- 2. 설명 — 지금 설명 그대로인 줄만
UPDATE public.tb_s080_codes_line AS l
   SET description = d.new_desc,
       updated_at  = CURRENT_TIMESTAMP
  FROM (VALUES
    ('INVOICE', '홈택스 전자세금계산서·계산서 목록 엑셀 그대로 올립니다',               '홈택스에서 받은 엑셀 파일 업로드'),
    ('CARD',    '홈택스 사업용 신용카드 사용내역 엑셀 그대로 올립니다',                 '홈택스 사업용 신용카드 엑셀 파일 업로드'),
    ('CASH',    '표준양식. 항목 칸을 비워 두면 매출 · 매입 항목 지정에서 붙입니다',     '표준양식을 받아 작성한 엑셀 파일 업로드'),
    ('BANK',    '통장 거래내역 · 이체 내역 엑셀. 계좌를 고릅니다',                     '은행별 거래내역 · 이체내역 엑셀 업로드'),
    ('NTAX',    '홈택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다',                 '홈택스 납부내역 엑셀 파일 업로드'),
    ('LTAX',    '위택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다',                 '위택스 · 이택스 납부내역 엑셀 파일 업로드'),
    ('LOAN',    '은행 대출거래내역 엑셀. 원금 · 이자를 나눠 읽습니다 — 이자만 비용입니다', '원금 · 이자가 있는 은행별 대출내역 엑셀 파일 업로드')
  ) AS d(code, old_desc, new_desc)
 WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.use_tp = '000' AND l.code = d.code
   AND l.description = d.old_desc;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-221.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-221.js .env packages/api/.env --dry-run supabase/migrations/221_tax_kind_card_texts.sql (늘 ROLLBACK)
-- =============================================================================
-- SELECT code, name, description FROM public.tb_s080_codes_line WHERE category = 'TAX_KIND' ORDER BY sort_order;
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 221 이 쓴 값 그대로일 때만 예전 값으로
-- -----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.tb_s080_codes_line AS l SET name = d.old_name, updated_at = CURRENT_TIMESTAMP
--   FROM (VALUES ('INVOICE','매입·매출 계산서','매출 · 매입파일'), ('BANK','은행 입출금','은행거래 및 이체내역'),
--                ('NTAX','국세 납부','국세 납부 내역'), ('LTAX','지방세 납부','지방세 내역')) AS d(code, old_name, new_name)
--  WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.code = d.code AND l.name = d.new_name;
-- UPDATE public.tb_s080_codes_line AS l SET description = d.old_desc, updated_at = CURRENT_TIMESTAMP
--   FROM (VALUES
--     ('INVOICE', '홈택스 전자세금계산서·계산서 목록 엑셀 그대로 올립니다', '홈택스에서 받은 엑셀 파일 업로드'),
--     ('CARD', '홈택스 사업용 신용카드 사용내역 엑셀 그대로 올립니다', '홈택스 사업용 신용카드 엑셀 파일 업로드'),
--     ('CASH', '표준양식. 항목 칸을 비워 두면 매출 · 매입 항목 지정에서 붙입니다', '표준양식을 받아 작성한 엑셀 파일 업로드'),
--     ('BANK', '통장 거래내역 · 이체 내역 엑셀. 계좌를 고릅니다', '은행별 거래내역 · 이체내역 엑셀 업로드'),
--     ('NTAX', '홈택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다', '홈택스 납부내역 엑셀 파일 업로드'),
--     ('LTAX', '위택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다', '위택스 · 이택스 납부내역 엑셀 파일 업로드'),
--     ('LOAN', '은행 대출거래내역 엑셀. 원금 · 이자를 나눠 읽습니다 — 이자만 비용입니다', '원금 · 이자가 있는 은행별 대출내역 엑셀 파일 업로드')
--   ) AS d(code, old_desc, new_desc)
--  WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.code = d.code AND l.description = d.new_desc;
-- COMMIT;
