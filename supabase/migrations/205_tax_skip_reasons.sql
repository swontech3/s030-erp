-- =============================================================================
-- 205_tax_skip_reasons.sql
--
-- 세무(S05) 자료 올리기 — 「뺀 줄」 종류 코드 (1-2 멈춤 3-B 0단계, 2026-10-26, ★ 적용 전 승인 대기)
--
--   분류              이름          코드값(= API 미리보기 응답 `excluded` 의 키)            쓰는 곳
--   TAX_SKIP_REASON   뺀 줄 종류    nonGeneral · noBizNo · badAmount · noApproval ·        미리보기 · 올리기 응답의 뺀 줄 수에
--                                   dupInFile · otherClass · badDate                       이름을 붙인다(화면 문구)
--
-- ★ 고정 코드 — 코드값이 API 응답의 키(shared `InvoiceExcluded`)와 같아야 화면이 이름을 찾는다. 코드값을 바꾸면
--   그 종류의 이름이 빈칸이 된다. 지우기 · 코드값 바꾸기 막기는 code-usage.ts 의 `PINNED_CODES` 몫이다(적용 뒤 더한다).
--   이름은 코드 관리에서 고칠 수 있다(화면 문구). `is_system` 은 쓰지 않는다(202 · 204 와 같이 false).
-- ★ 업무 표에 이 코드를 담는 칸은 없다 — 뺀 줄은 저장하지 않고 수만 센다(203). 그래서 CODE_USAGE 줄은 없고 고정 코드만.
-- ★ 코드값은 API 키 그대로(낙타 표기)다 — 다른 세무 코드(대문자)와 모양이 다르다. 바꾸기표를 두면 같은 것을 두 번 적게 된다.
--
-- 하는 일 · 영향: 코드 세 표(tb_s080_code_masters · tb_s080_code_categories · tb_s080_codes_line)에
--   줄을 **더하기만** 한다. 기존 분류 · 코드값 · 표 구조 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING — 202 · 204 와 같은 방식).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 같은 분류 이름이 **다른 줄로** 이미 있으면 멈춘다(202 · 204 와 같은 이유)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1'
     AND category = 'TAX_SKIP_REASON'
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '205 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 분류(머리)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_TAX_SKIP_REASON', '1', 'TAX_SKIP_REASON', '뺀 줄 종류',
        '세무(S05) 자료 올리기에서 넣지 않은 줄의 종류. ★ 고정 코드 — 코드값이 API 응답(excluded)의 키와 같아야 화면이 이름을 찾는다',
        false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 파티션 — 공통(000) 하나
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_TAX_SKIP_REASON_000', '1', 'TAX_SKIP_REASON', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. 코드값 — 순서(sort_order)가 화면에 늘어놓는 순서다(API `excluded` 의 키 순서와 같다)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_SKIP_REASON_nonGeneral', '1', 'TAX_SKIP_REASON', 'nonGeneral', '수정 · 취소 계산서',  '아직 넣지 않습니다(결정 6)', '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noBizNo',    '1', 'TAX_SKIP_REASON', 'noBizNo',    '사업자번호 없음',     NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_badAmount',  '1', 'TAX_SKIP_REASON', 'badAmount',  '금액이 숫자가 아님',  NULL, '000', 3, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noApproval', '1', 'TAX_SKIP_REASON', 'noApproval', '승인번호 없음',       NULL, '000', 4, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_dupInFile',  '1', 'TAX_SKIP_REASON', 'dupInFile',  '파일 안에서 겹친 승인번호', NULL, '000', 5, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_otherClass', '1', 'TAX_SKIP_REASON', 'otherClass', '세금계산서가 아님',   NULL, '000', 6, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_badDate',    '1', 'TAX_SKIP_REASON', 'badDate',    '작성일이 날짜가 아님', NULL, '000', 7, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-205.js (node scripts/verify-205.js .env packages/api/.env)
-- =============================================================================
-- SELECT code, name FROM public.tb_s080_codes_line WHERE category = 'TAX_SKIP_REASON' ORDER BY sort_order;  -- 7줄
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 업무 표에 이 코드를 담는 칸이 없어 먼저 볼 것이 없다(앱이 이름을 못 찾아 빈칸이 될 뿐)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s080_codes_line      WHERE category = 'TAX_SKIP_REASON';
-- DELETE FROM public.tb_s080_code_categories WHERE category = 'TAX_SKIP_REASON';
-- DELETE FROM public.tb_s080_code_masters    WHERE category = 'TAX_SKIP_REASON';
-- COMMIT;
