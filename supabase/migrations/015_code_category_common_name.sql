-- =============================================================================
-- 015_code_category_common_name.sql
--
-- `use_tp = '000'` 파티션의 이름을 **전부 「공통」으로** 통일한다.
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 — `000` 은 정의상 공통이다. 이름이 그 규칙을 어기고 있었다
-- -----------------------------------------------------------------------------
-- 013 은 레거시 호출처 역산표(`doc/CODE_MASTER_ANALYSIS.md` §B-3)를 그대로 이름에
-- 옮겼다. 그 결과 `use_tp='000'` 인데 이름이 제각각인 행이 4개 생겼다:
--
--     MEMBER_TYPE 000  (미상)            ← 호출처를 못 찾아 미상으로 두었다
--     PAY_ST      000  (미상)            ← 〃
--     RES_TP      000  계약 입주자용     ← 역산한 용도를 이름에 넣었다
--     ROOM_TP     000  계약·호실 공통    ← 〃
--
-- `000` 은 **어느 카테고리에서나 공통 파티션**이다(22종 전부가 가지고 있다).
-- 이름 칸이 그 규칙을 말해야 하는데, 어떤 화면이 쓰는지를 담고 있었다. 둘은 다른
-- 정보다 — **쓰임새는 `description` 이 담는다.**
--
-- ★ 이 마이그레이션은 `name` 만 건드린다. `description` 은 그대로 둔다. 역산으로
--   알아낸 내용(어느 화면이 쓰는지, 호출처를 못 찾았다는 사실)은 거기 남아 있다.
--
-- ★ `use_tp <> '000'` 은 **건드리지 않는다.** `ROOM_TP 001` 의 「(미상)」도 그대로다 —
--   그건 공통 파티션이 아니라 용도를 모르는 별도 파티션이고, 이름이 그 사실을 말해야 한다.
-- =============================================================================

BEGIN;

UPDATE public.tb_s080_code_categories
   SET name = '공통',
       updated_at = CURRENT_TIMESTAMP
 WHERE use_tp = '000'
   AND name <> '공통';

-- ★ 반대쪽 실수도 함께 고친다 — `EXEC_TP 001` 이 「공통」으로 되어 있었다.
--   013 의 이름표 VALUES 에 EXEC_TP 를 빠뜨려 기본값(`공통`)이 들어갔는데,
--   `001` 은 공통 파티션이 아니다. 역산표(§B-3)에서 EXEC_TP 는 000·001 **양쪽 다
--   호출처를 못 찾았다** — 000 은 규칙대로 공통이고, 001 은 용도를 모르는 파티션이다.
--   (데이터상 000 은 대표이사·이사·감사 3종, 001 은 대표이사가 빠진 2종이다.)
UPDATE public.tb_s080_code_categories
   SET name = '(미상)',
       description = '2026-09-19 기준 레거시에 호출처가 없다. 000 에서 대표이사(C)가 빠진 2종이다',
       updated_at = CURRENT_TIMESTAMP
 WHERE category = 'EXEC_TP' AND use_tp = '001';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- node scripts/verify-013.js .env
--
-- 1) 000 이 전부 공통인지 (0행이어야 한다)
--    SELECT category, use_tp, name FROM public.tb_s080_code_categories
--     WHERE use_tp='000' AND name <> '공통';
-- 2) 000 이 아닌 파티션의 이름은 남아 있는지 (4행)
--    SELECT category, use_tp, name FROM public.tb_s080_code_categories
--     WHERE use_tp <> '000' ORDER BY category, use_tp;
-- 3) 쓰임새가 description 에 남아 있는지
--    SELECT category, use_tp, name, description FROM public.tb_s080_code_categories
--     WHERE category IN ('ROOM_TP','RES_TP','MEMBER_TYPE','PAY_ST') ORDER BY category, use_tp;
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- UPDATE public.tb_s080_code_categories SET name='(미상)'        WHERE category='MEMBER_TYPE' AND use_tp='000';
-- UPDATE public.tb_s080_code_categories SET name='(미상)'        WHERE category='PAY_ST'      AND use_tp='000';
-- UPDATE public.tb_s080_code_categories SET name='계약 입주자용' WHERE category='RES_TP'      AND use_tp='000';
-- UPDATE public.tb_s080_code_categories SET name='계약·호실 공통' WHERE category='ROOM_TP'    AND use_tp='000';
