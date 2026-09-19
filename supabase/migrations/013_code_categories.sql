-- =============================================================================
-- 013_code_categories.sql
--
-- 코드 라인의 `use_tp` 에 **이름을 주는 테이블**을 만들고, 라인의 FK 를 그쪽으로 옮긴다.
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 필요한가 — `use_tp` 의 뜻이 DB 어디에도 없었다
-- -----------------------------------------------------------------------------
-- `tb_s080_codes_line.use_tp` 는 varchar(3) 짜리 값(`000`/`001`/`002`)인데, 그 의미가
-- 스키마에도 주석에도 문서에도 없었다. 뜻을 알아내려면 레거시 S-WonERP 의 `useCodes()`
-- 호출 27곳을 역산해야 했다. 그 역산 결과가 `doc/CODE_MASTER_ANALYSIS.md` §B-3 이다.
--
-- ★ `use_tp` 는 **한 category 안의 독립 파티션**이다. 상속이 아니다.
--   `000` 이 공통이지만 `001` 이 `000` 을 물려받지 않는다 — 각 파티션이 완결된 목록이다.
--   증거: `PAY_ST` 의 `001` 은 `000` 에 있는 「취소」를 **뺀다**. 합집합이면 뺄 수 없다.
--   그래서 `001` 은 공통 코드를 다시 적어 둔다(`ROOM_TP 001` 이 R1~VR 6개를 복제한다).
--
-- -----------------------------------------------------------------------------
-- ★★ 이 마이그레이션의 값어치는 테이블이 아니라 **FK** 다
-- -----------------------------------------------------------------------------
-- 지금까지는 **존재하지 않는 `use_tp` 를 아무 값이나 넣을 수 있었다.** 스키마가 막지
-- 않으니 레거시 코드관리 화면도 막을 근거가 없었고, 실제로 사용용도 칸을 자유 텍스트
-- 3자(`placeholder="예: WEB"`)로 받고 있었다 — 실데이터 규약은 숫자 3자인데도.
--
-- FK 를 `(build_id, category)` 에서 `(build_id, category, use_tp)` 로 옮기면 DB 가 막는다.
-- 「뜻을 DB 에 새긴다」의 실질이 여기 있다.
--
-- ★ 이름을 못 붙인 파티션 4개가 있다 — `ROOM_TP 001` · `MEMBER_TYPE 000` · `PAY_ST 000` ·
--   `EXEC_TP 000/001`. 레거시에 호출처가 없어 용도를 알 수 없다. **끄지 않고** `(미상)`
--   으로 적어 둔다. 지우거나 비활성화할 이유가 없다 — 계약 폼 오노출 문제는 조회가
--   파티션을 지정하는 것으로 닫힌다(마이그레이션이 아니라 앱 쪽 변경이다).
--
-- 근거 전문: `doc/CODE_MASTER_ANALYSIS.md` §B · §F-1
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_s080_code_categories (
  code_category_id text        PRIMARY KEY,
  build_id         text        NOT NULL,
  category         text        NOT NULL,
  use_tp           varchar(3)  NOT NULL DEFAULT '000',
  name             text        NOT NULL,
  description      text,
  is_system        boolean     NOT NULL DEFAULT false,
  created_at       timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       text,
  updated_by       text,
  CONSTRAINT tb_s080_code_categories_build_id_category_fkey
    FOREIGN KEY (build_id, category)
    REFERENCES public.tb_s080_code_masters (build_id, category)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT tb_s080_code_categories_build_id_category_use_tp_key
    UNIQUE (build_id, category, use_tp)
);

CREATE INDEX IF NOT EXISTS tb_s080_code_categories_build_id_category_idx
  ON public.tb_s080_code_categories (build_id, category);

-- 기존 라인에서 **실제로 쓰이는** (build_id, category, use_tp) 조합을 그대로 뜬다 = 27행.
-- 쓰이지 않는 조합을 상상해서 넣지 않는다.
INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
SELECT 'cc_' || l.build_id || '_' || l.category || '_' || l.use_tp,
       l.build_id, l.category, l.use_tp,
       COALESCE(m.name, '공통'),
       COALESCE(m.note, '단일 파티션. 이 카테고리는 use_tp 로 갈리지 않는다'),
       true
  FROM (SELECT DISTINCT build_id, category, use_tp FROM public.tb_s080_codes_line) l
  LEFT JOIN (VALUES
    ('ROOM_TP',     '000', '계약·호실 공통', '호실 관리 · 계약 상세 · 계약 폼 · 계약서 출력이 쓴다'),
    ('ROOM_TP',     '001', '(미상)',         '2026-09-19 기준 레거시에 호출처가 없다. ET(기타)만 여기 있다'),
    ('RES_TP',      '000', '계약 입주자용',  '계약 폼 섹션 3 입주자 그리드(대표자/직원)'),
    -- ★ `RES_TP 001` 은 넣지 않는다. 레거시 운영사 직원 폼이 그 파티션을 부르지만
    --   **이 DB 에 행이 하나도 없다**(EMP_RANK·EMP_DUTY·EMP_STATUS 와 같은 부류로,
    --   레거시가 부르는데 데이터가 없는 자리다). 쓰이지 않는 조합을 상상해 넣지 않는다.
    ('MEMBER_TYPE', '000', '(미상)',         '2026-09-19 기준 레거시에 전용 호출처가 없다'),
    ('MEMBER_TYPE', '001', '법인설립용',     '법인설립 화면의 법인종류'),
    ('MEMBER_TYPE', '002', '문서양식용',     '문서양식 설정 · 법인변경 문서'),
    ('PAY_ST',      '000', '(미상)',         '2026-09-19 기준 레거시에 호출처가 없다. 취소(C)만 여기 있다'),
    ('PAY_ST',      '001', '납부관리용',     '납부 관리 화면')
  ) AS m(category, use_tp, name, note)
    ON m.category = l.category AND m.use_tp = l.use_tp;

-- ★ 여기가 핵심이다. 라인이 참조하는 대상을 마스터(카테고리)에서 **파티션**으로 옮긴다.
ALTER TABLE public.tb_s080_codes_line
  DROP CONSTRAINT IF EXISTS tb_s080_codes_line_build_id_category_fkey;

ALTER TABLE public.tb_s080_codes_line
  ADD CONSTRAINT tb_s080_codes_line_category_fkey
  FOREIGN KEY (build_id, category, use_tp)
  REFERENCES public.tb_s080_code_categories (build_id, category, use_tp)
  ON UPDATE CASCADE ON DELETE RESTRICT;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_code_categories TO erp_app;

COMMENT ON TABLE public.tb_s080_code_categories IS
  '코드 카테고리 — tb_s080_codes_line.use_tp 에 이름을 주는 자리. use_tp 는 한 category '
  '안의 독립 파티션이고 상속이 아니다(000 이 공통이지만 001 이 000 을 물려받지 않는다). '
  'doc/CODE_MASTER_ANALYSIS.md §B';

COMMENT ON COLUMN public.tb_s080_code_categories.use_tp IS
  '파티션 식별자 3자. 000 이 공통이다. 값 형식을 바꾸지 않는 이유는 라인 112행과 '
  '레거시 상수(''000''/''001''/''002'')를 건드리지 않기 위해서다';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- node scripts/verify-013.js .env
--
-- 1) 27행이 들어갔는지
--    SELECT category, use_tp, name FROM public.tb_s080_code_categories ORDER BY category, use_tp;
-- 2) FK 가 실제로 막는지 (반드시 ROLLBACK)
--    BEGIN;
--    INSERT INTO public.tb_s080_codes_line
--      (line_id, build_id, category, code, name, use_tp, sort_order, is_active, is_system, updated_at)
--      VALUES ('__probe__','1','ROOM_TP','__X__','probe','999',99,true,false,CURRENT_TIMESTAMP);
--    ROLLBACK;   -- 위 INSERT 가 FK 위반으로 실패해야 정상이다
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.tb_s080_codes_line DROP CONSTRAINT tb_s080_codes_line_category_fkey;
-- ALTER TABLE public.tb_s080_codes_line ADD CONSTRAINT tb_s080_codes_line_build_id_category_fkey
--   FOREIGN KEY (build_id, category) REFERENCES public.tb_s080_code_masters (build_id, category)
--   ON UPDATE CASCADE ON DELETE RESTRICT;
-- DROP TABLE public.tb_s080_code_categories;
