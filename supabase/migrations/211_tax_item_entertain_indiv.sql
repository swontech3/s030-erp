-- =============================================================================
-- 211_tax_item_entertain_indiv.sql
--
-- 세무(S05) 개인사업자 출금 항목에 「접대비」 (1-4 보완, 2026-10-31)
--
--   코드 TAX_ITEM_OUT 파티션 002(개인 일반과세자)
--     전(207)                                후
--     15 거래처 경조사비                     15 접대비(ENTERTAIN, 풀이 「거래처 식사·선물」) — 더함
--     16 사업과 무관 — 대표 인출             16 거래처 경조사비
--     17 잘 모름 — 세무사에게 묻기           17 사업과 무관 — 대표 인출
--                                            18 잘 모름 — 세무사에게 묻기
--   1~14 · 파티션 001(법인 17개)은 그대로. 코드 줄 34 → 35
--
-- ★ 결정(2026-10-31 대표): 개인사업자도 접대비를 쓴다. 이름 · 풀이는 법인(207) 접대비와 같다.
-- ★ 순서는 **지금 값이 207 그대로일 때만** 고친다 — 코드 관리에서 이미 바꾼 순서는 덮지 않는다(209 · 210 과 같은 방식).
--   덮지 않은 줄이 있으면 verify-211 의 E2 가 실패로 알린다(실제 값을 보고 판단).
-- ★ 코드값 ENTERTAIN 은 두 파티션에 같은 값이다 — 쓰지 못하게 막는 일은 code-usage.ts 의 TAX_ITEM_OUT 002 줄 셋이 이미 한다.
-- ★ `is_system` 은 쓰지 않는다(207 과 같이 false).
--
-- 하는 일 · 영향: 코드 줄 1줄 더함 · 3줄 순서 고침(옛 값일 때만). 표 구조 · 권한 · 업무 자료는 그대로.
--   다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING · 옛 순서일 때만).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 — 207 을 먼저
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tb_s080_code_categories
                  WHERE build_id = '1' AND category = 'TAX_ITEM_OUT' AND use_tp = '002') THEN
    RAISE EXCEPTION '211 — 코드 TAX_ITEM_OUT 파티션 002 가 없다. 207 을 먼저 적용할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tb_s080_codes_line
              WHERE build_id = '1' AND category = 'TAX_ITEM_OUT' AND use_tp = '002' AND code = 'ENTERTAIN'
                AND line_id <> 'cl_1_TAX_ITEM_OUT_002_ENTERTAIN') THEN
    RAISE EXCEPTION '211 — 파티션 002 에 ENTERTAIN 이 다른 줄로 이미 있다. 그 줄을 쓸지 정한 뒤 다시 돌릴 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 뒤 셋의 순서 — 207 그대로일 때만(경조사비 15 → 16 · 대표 인출 16 → 17 · 잘 모름 17 → 18)
--    ★ 접대비를 넣기 **전에** 고친다. 15 자리를 비운 뒤 넣는다
-- -----------------------------------------------------------------------------
UPDATE public.tb_s080_codes_line AS l
   SET sort_order = d.new_sort,
       updated_at = CURRENT_TIMESTAMP
  FROM (VALUES
    ('CONDOLENCE',   15, 16),
    ('NONBIZ_OWNER', 16, 17),
    ('UNKNOWN',      17, 18)
  ) AS d(code, old_sort, new_sort)
 WHERE l.build_id = '1' AND l.category = 'TAX_ITEM_OUT' AND l.use_tp = '002' AND l.code = d.code
   AND l.sort_order = d.old_sort
   -- 이미 접대비가 있으면(다시 돌림) 순서도 이미 고친 것이다
   AND NOT EXISTS (SELECT 1 FROM public.tb_s080_codes_line
                    WHERE line_id = 'cl_1_TAX_ITEM_OUT_002_ENTERTAIN');

-- -----------------------------------------------------------------------------
-- 2. 접대비 — 파티션 002 · 순서 15 · 이름 · 풀이는 법인(207) 접대비와 같다
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_ITEM_OUT_002_ENTERTAIN', '1', 'TAX_ITEM_OUT', 'ENTERTAIN', '접대비', '거래처 식사·선물', '002', 15, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-211.js (node scripts/verify-211.js .env packages/api/.env), 그다음 verify-207
-- =============================================================================
-- SELECT use_tp, count(*) FROM public.tb_s080_codes_line WHERE category = 'TAX_ITEM_OUT' GROUP BY 1 ORDER BY 1;  -- 001 17 · 002 18
-- SELECT sort_order, code, name FROM public.tb_s080_codes_line
--  WHERE category = 'TAX_ITEM_OUT' AND use_tp = '002' AND sort_order >= 14 ORDER BY sort_order;
--   -- 14 VEHICLE · 15 ENTERTAIN · 16 CONDOLENCE · 17 NONBIZ_OWNER · 18 UNKNOWN
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — ★ 개인 회사가 접대비를 붙인 줄이 있으면 코드 관리처럼 막아야 한다. 먼저 센다(0 이어야 지운다):
--   SELECT (SELECT count(*) FROM public.tb_s050_invoices i JOIN public.tb_s050_settings s ON s.org_id = i.org_id
--            WHERE s.biz_type = 'I' AND i.item_code = 'ENTERTAIN')
--        + (SELECT count(*) FROM public.tb_s050_card_txns c JOIN public.tb_s050_settings s ON s.org_id = c.org_id
--            WHERE s.biz_type = 'I' AND c.item_code = 'ENTERTAIN')
--        + (SELECT count(*) FROM public.tb_s050_cash_txns x JOIN public.tb_s050_settings s ON s.org_id = x.org_id
--            WHERE s.biz_type = 'I' AND x.item_code = 'ENTERTAIN');
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s080_codes_line WHERE line_id = 'cl_1_TAX_ITEM_OUT_002_ENTERTAIN';
-- UPDATE public.tb_s080_codes_line AS l SET sort_order = d.old_sort, updated_at = CURRENT_TIMESTAMP
--   FROM (VALUES ('CONDOLENCE', 15, 16), ('NONBIZ_OWNER', 16, 17), ('UNKNOWN', 17, 18)) AS d(code, old_sort, new_sort)
--  WHERE l.build_id = '1' AND l.category = 'TAX_ITEM_OUT' AND l.use_tp = '002' AND l.code = d.code AND l.sort_order = d.new_sort;
-- COMMIT;
