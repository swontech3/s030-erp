-- =============================================================================
-- 207_tax_classify.sql
--
-- 세무(S05) 거래 분류(s050300010) — 매입 계산서에 붙이는 항목 (1-3 멈춤 2, 2026-10-27, ★ 적용 전 승인 대기)
--
--   ① 계산서 표(tb_s050_invoices)에 칸 셋
--        item_code      항목 — 코드 TAX_ITEM_OUT 코드값. 비어 있으면 「분류 필요」(확인할 줄). 매출이면 늘 비어 있다(CHECK)
--        classified_at  확정한 때
--        classified_by  확정한 사람(삐용 회원 ID, s020MemberId)
--   ② 코드 분류 TAX_ITEM_OUT 「출금 항목」 — 파티션 001 법인 · 002 개인 일반과세자, 파티션마다 17개(코드 줄 34)
--
-- ★ 결정(2026-10-27 대표):
--   - 매입 계산서도 분류한다(명세 03 · 06 과 다름 — 결정 B). 매출은 항목이 없고 코드 TAX_INV_DIR 의 「매출」 이름으로 보인다
--   - 「고르기만 하고 확정 전」은 저장하지 않는다 — 값이 있으면 곧 확정이다. [고치기]는 화면 안에서만, 다시 확정하면 덮는다
--   - 거래처 기억은 저장하지 않는다 — 그 거래처의 가장 최근 확정 항목을 읽을 때 찾아 골라 두기만 한다
--   - 파티션은 ERP 코드 규약대로 숫자 3자(코드 관리 USE_TP_RE). 사업자 유형 → 파티션 바꿈표(C → 001, I → 002)는
--     shared 한 곳에 두는 고정 코드다. 항목 이름은 두 파티션 모두에서 찾는다(사업자 유형을 바꾼 회사)
--   - 입금 항목(TAX_ITEM_IN) · 부가세 속성(공제 추정 · 계산서 없는 매출)은 뒤 단계
-- ★ 항목 목록 = 명세 07 §2 · 결과서 S05-05 · 시안 tax-data.js ITEMS(출금) + 대표가 더한 수도광열비 · 차량유지비(교육·도서비 다음, 13 · 14).
--   이름은 코드 이름, 풀이(「이름 — 풀이」의 뒤)는 설명 칸. 순서(sort_order)가 선택 칸의 순서다.
-- ★ item_code 에 FK 는 걸지 않는다(203 의 다른 코드 칸과 같다). 쓰는 코드를 지우지 못하게 막는 일은
--   code-usage.ts 의 CODE_USAGE 몫이다(적용 뒤 두 파티션 2줄을 더한다).
-- ★ `is_system` 은 쓰지 않는다(202 · 204 · 205 와 같이 false).
--
-- 하는 일 · 영향: 계산서 표에 NULL 허용 칸 셋을 더한다(있는 줄은 모두 NULL = 분류 필요). 다른 칸 · 다른 표는 그대로.
--   erp_app 에 그 세 칸 UPDATE 만 더한다(지금의 vendor_id UPDATE 는 그대로). 코드 세 표에는 줄을 더하기만 한다.
--   다시 돌려도 같은 결과다(IF NOT EXISTS · ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 203 이 있어야 하고, 같은 분류 이름이 **다른 줄로** 있으면 멈춘다(202 · 204 · 205 와 같은 이유)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regclass('public.tb_s050_invoices') IS NULL THEN
    RAISE EXCEPTION '207 — tb_s050_invoices 가 없다. 203 을 먼저 적용할 것';
  END IF;
  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1'
     AND category = 'TAX_ITEM_OUT'
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '207 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 계산서 표 — 분류 칸 셋 · 매출이면 비어 있게
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_invoices
  ADD COLUMN IF NOT EXISTS item_code     varchar(20),
  ADD COLUMN IF NOT EXISTS classified_at timestamp(3) without time zone,
  ADD COLUMN IF NOT EXISTS classified_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.tb_s050_invoices'::regclass AND conname = 'ck_s050_invoices_item_purchase') THEN
    ALTER TABLE public.tb_s050_invoices
      ADD CONSTRAINT ck_s050_invoices_item_purchase CHECK (direction = 'P' OR item_code IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.tb_s050_invoices.item_code IS
  '거래 분류 항목 — 코드 TAX_ITEM_OUT(001 법인 · 002 개인) 코드값. NULL = 분류 필요(확인할 줄). 매출(S)은 늘 NULL(CHECK).';
COMMENT ON COLUMN public.tb_s050_invoices.classified_at IS '항목을 확정한 때. 다시 확정하면 바뀐다.';
COMMENT ON COLUMN public.tb_s050_invoices.classified_by IS '항목을 확정한 사람 — 삐용 회원 ID(s020MemberId).';

-- erp_app — 분류 세 칸만 고친다(203 의 vendor_id 고치기는 그대로)
GRANT UPDATE (item_code, classified_at, classified_by) ON public.tb_s050_invoices TO erp_app;

-- -----------------------------------------------------------------------------
-- 2. 분류(머리)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_TAX_ITEM_OUT', '1', 'TAX_ITEM_OUT', '출금 항목',
        '세무(S05) 거래 분류의 출금 항목(매입 계산서에 붙인다). 파티션 = 사업자 유형(001 법인 · 002 개인 일반과세자). 설명 칸 = 선택 칸의 풀이',
        false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. 파티션 — 사업자 유형마다 하나(★ 고정 — shared 의 바꿈표 C → 001 · I → 002 가 기댄다)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES
  ('cc_1_TAX_ITEM_OUT_001', '1', 'TAX_ITEM_OUT', '001', '법인',            '사업자 유형 C(법인)의 출금 항목. 세무(S05)가 쓴다', false),
  ('cc_1_TAX_ITEM_OUT_002', '1', 'TAX_ITEM_OUT', '002', '개인 일반과세자', '사업자 유형 I(개인 일반과세자)의 출금 항목. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. 코드값 — 파티션마다 17개. 공통 15개(1~14 · 17)는 두 파티션에 같은 코드값으로 둔다
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
SELECT 'cl_1_TAX_ITEM_OUT_' || p.use_tp || '_' || i.code, '1', 'TAX_ITEM_OUT', i.code, i.name, i.description,
       p.use_tp, i.sort_order, true, false, CURRENT_TIMESTAMP
  FROM (VALUES ('001', 'C'), ('002', 'I')) AS p(use_tp, biz),
       (VALUES
         -- 코드값          이름                          풀이(설명 칸)                       순서  어디에(A 둘 다 · C 법인 · I 개인)
         ('RENT',          '사무실 월세',                NULL,                               1,   'A'),
         ('TEL',           '통신비',                     NULL,                               2,   'A'),
         ('SUPPLY',        '소모품비',                   '사무용품·작은 비품',               3,   'A'),
         ('MEAL',          '식대·회의비',                '직원 식사·회의 다과',              4,   'A'),
         ('TRAVEL',        '교통·출장비',                NULL,                               5,   'A'),
         ('DELIVERY',      '택배·운송비',                NULL,                               6,   'A'),
         ('AD',            '광고비',                     NULL,                               7,   'A'),
         ('FEE',           '수수료',                     '은행·플랫폼 수수료',               8,   'A'),
         ('OUTSOURCE',     '외주 용역비',                NULL,                               9,   'A'),
         ('INSURANCE',     '보험료',                     NULL,                               10,  'A'),
         ('REPAIR',        '수선비',                     NULL,                               11,  'A'),
         ('EDU',           '교육·도서비',                NULL,                               12,  'A'),
         ('UTILITY',       '수도광열비',                 '전기 · 수도 · 가스',               13,  'A'),
         ('VEHICLE',       '차량유지비',                 '주유 · 차량 수리 · 주차',          14,  'A'),
         ('ENTERTAIN',     '접대비',                     '거래처 식사·선물',                 15,  'C'),
         ('CONDOLENCE',    '거래처 경조사비',            NULL,                               15,  'I'),
         ('NONBIZ_TAXPRO', '사업과 무관 — 세무사 판단',  '세무사가 처리 방법을 정합니다',    16,  'C'),
         ('NONBIZ_OWNER',  '사업과 무관 — 대표 인출',    '대표가 개인 용도로 쓴 돈',         16,  'I'),
         ('UNKNOWN',       '잘 모름 — 세무사에게 묻기',  NULL,                               17,  'A')
       ) AS i(code, name, description, sort_order, scope)
 WHERE i.scope = 'A' OR i.scope = p.biz
ON CONFLICT (line_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-207.js (node scripts/verify-207.js .env packages/api/.env)
-- =============================================================================
-- SELECT use_tp, count(*) FROM public.tb_s080_codes_line WHERE category = 'TAX_ITEM_OUT' GROUP BY 1 ORDER BY 1;  -- 001 17 · 002 17
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'tb_s050_invoices' AND column_name IN ('item_code', 'classified_at', 'classified_by');      -- 3줄
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 확정한 항목이 있으면 그 값이 사라진다. 먼저 센다:
--   SELECT count(*) FROM public.tb_s050_invoices WHERE item_code IS NOT NULL;
-- -----------------------------------------------------------------------------
-- BEGIN;
-- REVOKE UPDATE (item_code, classified_at, classified_by) ON public.tb_s050_invoices FROM erp_app;
-- ALTER TABLE public.tb_s050_invoices DROP CONSTRAINT IF EXISTS ck_s050_invoices_item_purchase;
-- ALTER TABLE public.tb_s050_invoices DROP COLUMN IF EXISTS item_code,
--                                     DROP COLUMN IF EXISTS classified_at,
--                                     DROP COLUMN IF EXISTS classified_by;
-- DELETE FROM public.tb_s080_codes_line      WHERE category = 'TAX_ITEM_OUT';
-- DELETE FROM public.tb_s080_code_categories WHERE category = 'TAX_ITEM_OUT';
-- DELETE FROM public.tb_s080_code_masters    WHERE category = 'TAX_ITEM_OUT';
-- COMMIT;
