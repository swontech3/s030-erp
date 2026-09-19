-- =============================================================================
-- 014_name_position.sql
--
-- 상호 표기위치(앞/뒤)를 `MEMBER_TYPE` 의 **자식 코드**에서 떼어내 별도 카테고리
-- `NAME_POSITION` 으로 옮기고, `parent_line_id` 컬럼을 없앤다.
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 — 계층이 담고 있던 정보량이 0 이었다
-- -----------------------------------------------------------------------------
-- `parent_line_id` 는 112행 중 8행에만 값이 있었고, 전부 `MEMBER_TYPE` 이었다.
-- 구조는 「법인형태 → 상호 표기위치」 2단인데, 펼쳐 보면 이렇다:
--
--     R 주식회사        → 앞 · 뒤
--     A 유한회사        → 앞 · 뒤
--     C 농/어업회사법인 → 앞 · 뒤
--
-- **셋이 완전히 같다.** "어느 법인형태가 어떤 표기위치를 쓸 수 있나"에 차이가 없다.
-- 자식 6행은 부모 이름을 앞에 붙인 **라벨**일 뿐이고, 그 조합은 레거시가 이미 런타임에
-- 한다 — `lib/incorp-company-name.ts` 의 `composeCompanyName()`:
--     position === 'F' ? `${type} ${nm}` : `${nm} ${type}`
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 — 저장 구조가 이미 평면이었다
-- -----------------------------------------------------------------------------
--     tb_s080_incorporations.entity_type            text   ← R / A / C
--     tb_s080_incorporations.company_type_position  text   ← F / B
--
-- **독립된 두 컬럼**이고 `line_id` 를 참조하지 않는다. 즉 저장은 평면인데 코드 테이블만
-- 계층이었다. 이 마이그레이션이 둘을 맞춘다. (해당 테이블은 현재 0행이라 이관할 업무
-- 데이터가 없다.)
--
-- -----------------------------------------------------------------------------
-- ★★ 무엇이 함께 닫히는가
-- -----------------------------------------------------------------------------
-- ① 레거시 업무 화면·API **9곳**의 `parentLineId === null` 필터가 불필요해진다.
--    9곳이 전부 같은 한 가지를 막고 있었다 — "이 행은 법인형태지 표기위치가 아니다".
--    성격이 다른 두 종류를 한 목록에 담아 놓아 읽는 쪽마다 걸러야 했다.
-- ② `002` 파티션의 깨진 링크가 소멸한다. `F 주식회사 앞(002)` 의 부모가
--    `R 주식회사(001)` 이었고(교차 참조), `A 유한회사(002)` 는 자식이 없었다.
--
-- -----------------------------------------------------------------------------
-- ★ 알고 넘어가는 것 (되돌리기 전에 읽을 것)
-- -----------------------------------------------------------------------------
-- 「어느 법인형태에 어떤 표기위치가 허용되나」를 스키마로 표현할 수단이 없어진다.
-- 그런 규칙이 생기면 애플리케이션 코드로 간다. 현재 데이터에 그 차이가 없고, 상법상
-- 앞/뒤가 법인형태에 따라 갈리지 않는다고 판단해 채택했다.
-- 반대 논거 전문: `doc/CODE_MASTER_ANALYSIS.md` §F-4
-- =============================================================================

BEGIN;

INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_NAME_POSITION', '1', 'NAME_POSITION', '상호 표기위치',
        'MEMBER_TYPE 과 함께 쓴다 — 법인 상호에서 형태 표기를 앞에 두는지 뒤에 두는지. '
        'tb_s080_incorporations.company_type_position 에 스칼라로 저장된다',
        true, CURRENT_TIMESTAMP);

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_NAME_POSITION_000', '1', 'NAME_POSITION', '000', '공통',
        '단일 파티션. 법인형태와 무관하게 앞/뒤 둘뿐이다', true);

-- 표시명은 「앞」·「뒤」다. 「주식회사 앞」이 아니다 — 형태 이름은 화면이 조합한다.
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, use_tp, sort_order, is_active, is_system, updated_at)
VALUES ('cl_1_NAME_POSITION_F', '1', 'NAME_POSITION', 'F', '앞', '000', 1, true, true, CURRENT_TIMESTAMP),
       ('cl_1_NAME_POSITION_B', '1', 'NAME_POSITION', 'B', '뒤', '000', 2, true, true, CURRENT_TIMESTAMP);

-- MEMBER_TYPE 안의 표기위치 8행을 지운다.
-- ★ `parent_line_id IS NOT NULL` 인 행이 **정확히 그 8행**이다(F 4행 · B 4행).
--   다른 카테고리에는 부모를 가진 행이 하나도 없다.
DELETE FROM public.tb_s080_codes_line WHERE parent_line_id IS NOT NULL;

-- 컬럼을 지우면 이 컬럼이 낀 유니크 인덱스도 **함께 사라진다.** 같은 이름으로 다시 만든다.
-- 위에서 8행을 지웠으므로 (build_id, category, code, use_tp) 중복은 남아 있지 않다.
ALTER TABLE public.tb_s080_codes_line DROP COLUMN parent_line_id;

CREATE UNIQUE INDEX tb_s080_codes_line_build_id_category_code_use_tp_key
  ON public.tb_s080_codes_line (build_id, category, code, use_tp);

COMMENT ON TABLE public.tb_s080_codes_line IS
  '코드 라인. (build_id, category, use_tp) 로 tb_s080_code_categories 를 참조한다. '
  '★ 계층이 없다 — 2026-09-19 parent_line_id 를 없앴다. 하위 구분이 필요하면 카테고리를 '
  '나눈다(NAME_POSITION 이 그 예다). doc/CODE_MASTER_ANALYSIS.md §C';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- node scripts/verify-014.js .env
--
-- 1) 표기위치가 옮겨졌는지
--    SELECT category, code, name, use_tp, sort_order FROM public.tb_s080_codes_line
--     WHERE category IN ('MEMBER_TYPE','NAME_POSITION') ORDER BY category, use_tp, sort_order;
-- 2) 컬럼이 사라졌는지
--    SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_codes_line' AND column_name='parent_line_id';
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — ★ 지운 8행은 되살아나지 않는다
-- -----------------------------------------------------------------------------
-- 컬럼은 되돌릴 수 있으나 DELETE 한 표기위치 8행은 이 스크립트로 복구되지 않는다.
-- 필요하면 doc/CODE_MASTER_ANALYSIS.md §C-2 의 트리를 보고 손으로 다시 넣는다.
--
-- DROP INDEX public.tb_s080_codes_line_build_id_category_code_use_tp_key;
-- ALTER TABLE public.tb_s080_codes_line ADD COLUMN parent_line_id text;
-- ALTER TABLE public.tb_s080_codes_line ADD CONSTRAINT tb_s080_codes_line_parent_line_id_fkey
--   FOREIGN KEY (parent_line_id) REFERENCES public.tb_s080_codes_line(line_id)
--   ON UPDATE CASCADE ON DELETE RESTRICT;
-- CREATE UNIQUE INDEX tb_s080_codes_line_build_id_category_code_use_tp_key
--   ON public.tb_s080_codes_line (build_id, category, code, use_tp, parent_line_id);
-- DELETE FROM public.tb_s080_codes_line   WHERE category='NAME_POSITION';
-- DELETE FROM public.tb_s080_code_categories WHERE category='NAME_POSITION';
-- DELETE FROM public.tb_s080_code_masters    WHERE category='NAME_POSITION';
