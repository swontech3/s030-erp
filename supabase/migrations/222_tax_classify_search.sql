-- =============================================================================
-- 222_tax_classify_search.sql
--
-- 세무(S05) 매출 · 매입 항목 지정(s050300010 · /tax/classify) — 2026-11-08 대표 지시 「화면 전체 수정 ⑤」
--
--   ① 코드 분류 TAX_CLS_STATUS  항목 지정 구분 — L 미지정 · D 지정. ★ 고정 코드
--   ② 코드 분류 TAX_CLS_SOURCE  항목 지정 출처 — P 매입 · S 매출 · CARD 카드 · CASH 현금경비 · PCARD 개인카드 · BANK 은행. ★ 고정 코드
--      개인카드 · 은행은 「사용 안 함」(is_active = false)으로 넣는다 — 선택지에 보이지 않는다. 기능이 생기면 코드 관리에서 켠다
--   ③ 칸 tb_s050_card_txns.note    카드 줄 「내용」(사용 내용, 사업주가 적는 짧은 글 · 비울 수 있음) — [확정] · [수정] 때 항목과 함께 저장
--
-- ★ 왜: 탭(미지정 건 · 지정 건 · 이번 달 자료 전체) · 칩 · 기간 직접 지정을 없애고 검색조건(년월 · 구분 · 출처)으로 합쳤다.
--   선택 상자는 코드 표에서 읽는다(소스에 글자를 박지 않는다). 「전체」는 선택 상자 첫 줄이고 코드가 아니다.
-- ★ 고정 코드: 서버가 코드값으로 거른다(shared `tax-classify.ts` CLASSIFY_STATUSES · CLASSIFY_KINDS, code-usage PINNED_CODES).
--   이름 · 순서 · 켜짐은 코드 관리에서 바꿀 수 있고, 코드값은 바꾸거나 지우지 못한다. 담는 칸이 없어 CHECK · FK 는 없다.
-- ★ 권한: erp_app 은 카드 줄 표에 칸 단위 UPDATE 만 있다(208 — item_code · classified_at · classified_by · vendor_id).
--   새 칸 note 의 UPDATE 를 같은 방식으로 더한다. 다른 표 · 칸 · 권한은 건드리지 않는다.
--
-- 하는 일 · 영향: 코드 세 표에 줄을 더하고 카드 줄 표에 칸 하나(NULL 허용, 기본값 없음)를 더한다. 있는 줄은 그대로(note = NULL).
--   다시 돌려도 같은 결과다(IF NOT EXISTS · ON CONFLICT DO NOTHING · GRANT 는 겹쳐도 같다).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 — 카드 줄 표(208)가 있어야 하고, 같은 이름의 분류가 다른 줄로 있으면 멈춘다
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regclass('public.tb_s050_card_txns') IS NULL THEN
    RAISE EXCEPTION '222 — 카드 줄 표가 없다. 208 을 먼저 적용할 것';
  END IF;
  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1' AND category IN ('TAX_CLS_STATUS', 'TAX_CLS_SOURCE')
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '222 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 코드 — TAX_CLS_STATUS(구분) · TAX_CLS_SOURCE(출처), 고정 코드
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES
  ('cm_1_TAX_CLS_STATUS', '1', 'TAX_CLS_STATUS', '항목 지정 구분',
   '세무(S05) 매출 · 매입 항목 지정의 검색조건 「구분」. ★ 고정 코드 — 서버가 L(미지정) · D(지정)로 거른다. 「전체」는 선택 상자 첫 줄이고 코드가 아니다',
   false, CURRENT_TIMESTAMP),
  ('cm_1_TAX_CLS_SOURCE', '1', 'TAX_CLS_SOURCE', '항목 지정 출처',
   '세무(S05) 매출 · 매입 항목 지정의 검색조건 「출처」. ★ 고정 코드 — 서버가 코드값으로 고를 자료를 정한다. 사용 안 함인 코드는 선택지에 보이지 않는다',
   false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES
  ('cc_1_TAX_CLS_STATUS_000', '1', 'TAX_CLS_STATUS', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
  ('cc_1_TAX_CLS_SOURCE_000', '1', 'TAX_CLS_SOURCE', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_CLS_STATUS_L',     '1', 'TAX_CLS_STATUS', 'L',     '미지정',   '항목을 아직 고르지 않은 매입 줄', '000', 1, true,  false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CLS_STATUS_D',     '1', 'TAX_CLS_STATUS', 'D',     '지정',     '항목을 확정한 매입 줄',           '000', 2, true,  false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CLS_SOURCE_P',     '1', 'TAX_CLS_SOURCE', 'P',     '매입',     '매입 계산서',                     '000', 1, true,  false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CLS_SOURCE_S',     '1', 'TAX_CLS_SOURCE', 'S',     '매출',     '매출 계산서',                     '000', 2, true,  false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CLS_SOURCE_CARD',  '1', 'TAX_CLS_SOURCE', 'CARD',  '카드',     '카드 사용 내역',                  '000', 3, true,  false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CLS_SOURCE_CASH',  '1', 'TAX_CLS_SOURCE', 'CASH',  '현금경비', '현금 경비',                       '000', 4, true,  false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CLS_SOURCE_PCARD', '1', 'TAX_CLS_SOURCE', 'PCARD', '개인카드', '준비 중 — 기능이 생기면 켠다',     '000', 5, false, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CLS_SOURCE_BANK',  '1', 'TAX_CLS_SOURCE', 'BANK',  '은행',     '준비 중 — 기능이 생기면 켠다',     '000', 6, false, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 카드 줄 「내용」 칸
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_card_txns ADD COLUMN IF NOT EXISTS note varchar(100);

COMMENT ON COLUMN public.tb_s050_card_txns.note IS
  '내용 — 사업주가 항목 지정에서 적는 사용 내용(짧은 글, 100자까지). 비울 수 있다. [확정] · [수정] 때 항목과 함께 저장(222).';

-- -----------------------------------------------------------------------------
-- 3. 권한 — 208 과 같이 칸 단위 UPDATE
-- -----------------------------------------------------------------------------
GRANT UPDATE (note) ON public.tb_s050_card_txns TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-222.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-222.js .env packages/api/.env --dry-run supabase/migrations/222_tax_classify_search.sql (늘 ROLLBACK)
-- =============================================================================
-- SELECT category, code, name, sort_order, is_active FROM public.tb_s080_codes_line
--  WHERE category IN ('TAX_CLS_STATUS', 'TAX_CLS_SOURCE') ORDER BY category, sort_order;
-- SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns
--  WHERE table_name = 'tb_s050_card_txns' AND column_name = 'note';
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — ★ 앱(항목 지정 검색조건 · 카드 내용)을 먼저 내린 뒤. 적은 내용은 사라진다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- REVOKE UPDATE (note) ON public.tb_s050_card_txns FROM erp_app;
-- ALTER TABLE public.tb_s050_card_txns DROP COLUMN IF EXISTS note;
-- DELETE FROM public.tb_s080_codes_line      WHERE build_id = '1' AND category IN ('TAX_CLS_STATUS', 'TAX_CLS_SOURCE');
-- DELETE FROM public.tb_s080_code_categories WHERE build_id = '1' AND category IN ('TAX_CLS_STATUS', 'TAX_CLS_SOURCE');
-- DELETE FROM public.tb_s080_code_masters    WHERE build_id = '1' AND category IN ('TAX_CLS_STATUS', 'TAX_CLS_SOURCE');
-- COMMIT;
