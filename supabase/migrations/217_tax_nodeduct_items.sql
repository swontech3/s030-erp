-- =============================================================================
-- 217_tax_nodeduct_items.sql
--
-- 세무(S05) 「공제 안 될 수 있는 매입 항목」 코드 분류 (1-8 부가세 조회, 2026-11-05 대표 결정 4)
--
--   분류                이름                            코드 줄(코드 이름 = 출금 항목 TAX_ITEM_OUT 코드값)
--   TAX_NODEDUCT_ITEM   공제 안 될 수 있는 매입 항목    ENTERTAIN 접대비 · NONBIZ_TAXPRO 사업과 무관(법인) ·
--                                                       NONBIZ_OWNER 사업과 무관(개인) · VEHICLE 차량유지비
--
-- ★ 쓰는 곳: 부가세 조회(s050400020)의 「공제가 안 될 수 있는 매입」 카드. 매입 계산서 · 카드(공제) 줄 중
--   항목(item_code)이 이 분류의 코드 **이름**과 같은 줄의 세액을 항목별로 보인다(이름으로 견준다 — 215 TAX_TAX_NOEXP 와 같은 방식).
-- ★ 고정 코드가 아니다 — 담는 칸이 없어 코드 관리에서 더하고 지운다(이름에 출금 항목 코드값을 적는다). `is_system` 은 쓰지 않는다.
-- ★ 표 · 칸 · 권한은 건드리지 않는다. 코드 세 표에 줄을 더하기만 한다. 다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

-- 207 · 211 이 있어야 하고(출금 항목), 같은 이름의 분류가 다른 줄로 있으면 멈춘다(215 와 같은 이유)
DO $$
DECLARE
  hit text;
BEGIN
  IF (SELECT count(DISTINCT code) FROM public.tb_s080_codes_line
       WHERE build_id = '1' AND category = 'TAX_ITEM_OUT'
         AND code IN ('ENTERTAIN', 'NONBIZ_TAXPRO', 'NONBIZ_OWNER', 'VEHICLE')) <> 4 THEN
    RAISE EXCEPTION '217 — 출금 항목(TAX_ITEM_OUT) ENTERTAIN · NONBIZ_TAXPRO · NONBIZ_OWNER · VEHICLE 이 있어야 한다. 207 · 211 을 먼저 적용할 것';
  END IF;
  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1' AND category = 'TAX_NODEDUCT_ITEM'
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '217 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES
  ('cm_1_TAX_NODEDUCT_ITEM', '1', 'TAX_NODEDUCT_ITEM', '공제 안 될 수 있는 매입 항목',
   '세무(S05) 부가세 조회의 「공제가 안 될 수 있는 매입」. 코드 이름 = 출금 항목(TAX_ITEM_OUT) 코드값(이름으로 견준다). 판단은 세무사가 한다',
   false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES
  ('cc_1_TAX_NODEDUCT_ITEM_000', '1', 'TAX_NODEDUCT_ITEM', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_NODEDUCT_ITEM_ENTERTAIN',     '1', 'TAX_NODEDUCT_ITEM', 'ENTERTAIN',     'ENTERTAIN',     '접대비',                     '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_NODEDUCT_ITEM_NONBIZ_TAXPRO', '1', 'TAX_NODEDUCT_ITEM', 'NONBIZ_TAXPRO', 'NONBIZ_TAXPRO', '사업과 무관 — 세무사 판단(법인)', '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_NODEDUCT_ITEM_NONBIZ_OWNER',  '1', 'TAX_NODEDUCT_ITEM', 'NONBIZ_OWNER',  'NONBIZ_OWNER',  '사업과 무관 — 대표 인출(개인)',   '000', 3, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_NODEDUCT_ITEM_VEHICLE',       '1', 'TAX_NODEDUCT_ITEM', 'VEHICLE',       'VEHICLE',       '차량유지비',                 '000', 4, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-217.js .env packages/api/.env  (3항목)
--   적용 전 시험: node scripts/verify-217.js .env packages/api/.env --dry-run supabase/migrations/217_tax_nodeduct_items.sql (늘 ROLLBACK)
-- =============================================================================
-- SELECT code, name, sort_order FROM public.tb_s080_codes_line WHERE category = 'TAX_NODEDUCT_ITEM' ORDER BY sort_order;
--   -- ENTERTAIN · NONBIZ_TAXPRO · NONBIZ_OWNER · VEHICLE
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 담는 칸이 없어 지워도 자료는 그대로다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s080_codes_line      WHERE category = 'TAX_NODEDUCT_ITEM';
-- DELETE FROM public.tb_s080_code_categories WHERE category = 'TAX_NODEDUCT_ITEM';
-- DELETE FROM public.tb_s080_code_masters    WHERE category = 'TAX_NODEDUCT_ITEM';
-- COMMIT;
