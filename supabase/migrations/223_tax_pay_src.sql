-- =============================================================================
-- 223_tax_pay_src.sql
--
-- 세무(S05) 세금 납부(s050300040 · /tax/payments) 검색조건 「세금 전체 / 국세 / 지방세」 — 2026-11-08 대표 지시 「화면 전체 수정 ⑥」
--
--   코드 분류 TAX_PAY_SRC  세금 납부 구분 — NTAX 국세 · LTAX 지방세. ★ 고정 코드
--
-- ★ 왜: 세금 · 4대보험 · 대출 화면의 탭을 없애고 메뉴 셋(세금 납부 · 4대보험 · 대출내역)으로 나눴다. 세금 납부는 국세 · 지방세를
--   한 목록에 보이고 검색조건으로 거른다 — 선택 상자는 코드 표에서 읽는다(소스에 글자를 박지 않는다). 「세금 전체」는 첫 줄이고 코드가 아니다.
-- ★ 고정 코드: 코드값이 자료 종류(TAX_KIND) 코드값과 같다 — 화면이 그대로 주소 tab 으로 보내고 서버가 거른다
--   (shared `tax-payments.ts` PAY_SRCS, code-usage PINNED_CODES). 이름 · 순서 · 켜짐은 코드 관리에서 바꿀 수 있다. 담는 칸이 없어 CHECK · FK 는 없다.
--
-- 하는 일 · 영향: 코드 세 표에 줄만 더한다. 표 · 칸 · 권한은 건드리지 않는다. 다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

-- 0. 같은 이름의 분류가 다른 줄로 있으면 멈춘다
DO $$
DECLARE
  hit text;
BEGIN
  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1' AND category = 'TAX_PAY_SRC'
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '223 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- 1. 코드 — TAX_PAY_SRC(세금 납부 구분, 고정 코드)
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES
  ('cm_1_TAX_PAY_SRC', '1', 'TAX_PAY_SRC', '세금 납부 구분',
   '세무(S05) 세금 납부의 검색조건. ★ 고정 코드 — 코드값이 자료 종류(NTAX 국세 · LTAX 지방세)와 같아 서버가 그대로 거른다. 「세금 전체」는 선택 상자 첫 줄이고 코드가 아니다',
   false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES
  ('cc_1_TAX_PAY_SRC_000', '1', 'TAX_PAY_SRC', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_PAY_SRC_NTAX', '1', 'TAX_PAY_SRC', 'NTAX', '국세',   '홈택스 국세 납부', '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_PAY_SRC_LTAX', '1', 'TAX_PAY_SRC', 'LTAX', '지방세', '위택스 · 이택스 지방세 납부', '000', 2, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-223.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-223.js .env packages/api/.env --dry-run supabase/migrations/223_tax_pay_src.sql (늘 ROLLBACK)
-- =============================================================================
-- SELECT code, name, sort_order, is_active FROM public.tb_s080_codes_line WHERE category = 'TAX_PAY_SRC' ORDER BY sort_order;
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — ★ 앱(세금 납부 검색조건)을 먼저 내린 뒤
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s080_codes_line      WHERE build_id = '1' AND category = 'TAX_PAY_SRC';
-- DELETE FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = 'TAX_PAY_SRC';
-- DELETE FROM public.tb_s080_code_masters    WHERE build_id = '1' AND category = 'TAX_PAY_SRC';
-- COMMIT;
