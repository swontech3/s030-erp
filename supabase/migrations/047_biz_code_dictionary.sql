-- =============================================================================
-- 047_biz_code_dictionary.sql
--
-- 업종 사전(1차) — 국세청 업종코드 · 업태 · 종목 · KSIC 연계 (2026-10-15)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 공용 자료(법무 · 세무가 함께 읽음) — 어느 서비스 소속도 아니다(2026-10-18 세무 방 결정).
-- 원본은 국세청 「업종코드-표준산업분류 연계표」(홈택스 기준(단순)경비율
-- 조회에서 받는 xlsx). 사용자 결정(2026-10-15):
--   · 기준 키 = 국세청 업종코드 6자리. 종목 · KSIC 는 **연계표**에서 가져온다(연계표의
--     귀속연도 기준)
--   · 업태(2026-10-18): 같은 업종코드가 경비율 엑셀에 있으면 경비율 엑셀의 업태명, 연계표에만
--     있는 코드는 연계표 대분류 그대로
--   · 종목은 세세분류를 「, 」로 잇는다. 701206 · 701302 도 연계표 값 그대로
--   · 표 둘 — 업종코드 하나가 KSIC 여러 개에 이어지는 경우가 있다(2026 귀속: 1,614개 중 80개)
--   · 해마다 다시 적재하면 덮어쓴다(최신 한 벌). 새 원본에서 빠진 코드 · 연계는 지우지 않고
--     active = false 로만 둔다
--   · is_main 은 연계표에 「업종코드의 대표 KSIC」 표시가 있을 때만 채운다(짐작 금지). 없으면 NULL
--   · 기존 사업목적 카탈로그(tb_s080_biz_purpose_catalog)는 건드리지 않는다 — 별도 표
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① tb_s080_biz_code       업종코드마다 한 줄
--   ② tb_s080_biz_code_ksic  (업종코드, KSIC) 연계마다 한 줄. ①을 FK 로 가리킨다
--   ③ 두 표 RLS ENABLE + FORCE, 읽기 정책 하나(운영사 · 회사 세션 모두 읽기). 쓰기 정책은 없다
--   ④ erp_app 은 SELECT 만. 적재는 일회용 스크립트가 postgres 로 한다(BYPASSRLS)
--   ⑤ 자료는 넣지 않는다 — scripts/oneoff/2026-10-15-biz-code-dictionary.js 가 넣는다
--
-- 되돌리기:
--   DROP TABLE IF EXISTS public.tb_s080_biz_code_ksic;
--   DROP TABLE IF EXISTS public.tb_s080_biz_code;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_s080_biz_code (
  biz_code   text PRIMARY KEY CHECK (biz_code ~ '^[0-9]{6}$'),
  biz_type   text NOT NULL,
  item_name  text NOT NULL,
  tax_year   smallint NOT NULL,
  loaded_at  timestamp NOT NULL,
  active     boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.tb_s080_biz_code IS
  '업종 사전(047, 공용 — 법무 · 세무가 함께 읽음) — 국세청 업종코드마다 한 줄. 원본은 업종코드-표준산업분류 연계표, 적재는 일회용 스크립트.';
COMMENT ON COLUMN public.tb_s080_biz_code.biz_code IS '국세청 업종코드 6자리(기준 키).';
COMMENT ON COLUMN public.tb_s080_biz_code.biz_type IS '업태 — 경비율 엑셀에 같은 업종코드가 있으면 그 업태명, 연계표에만 있으면 연계표 업종코드 쪽 「대분류」 그대로.';
COMMENT ON COLUMN public.tb_s080_biz_code.item_name IS
  '종목 — 연계표 업종코드 쪽 「세세분류」. 한 코드에 세세분류가 여럿이면 원본 줄 순서대로 「, 」로 잇는다(경비율 엑셀과 같은 방식).';
COMMENT ON COLUMN public.tb_s080_biz_code.tax_year IS '귀속연도 — 연계표 머리줄 「YYYY년 귀속 업종코드」.';
COMMENT ON COLUMN public.tb_s080_biz_code.loaded_at IS '적재일시 — 이 줄이 마지막으로 적재된 때(원본에 있으면 해마다 갱신, 빠진 줄은 그대로).';
COMMENT ON COLUMN public.tb_s080_biz_code.active IS '새 원본에서 빠진 코드는 지우지 않고 false(047).';

CREATE TABLE IF NOT EXISTS public.tb_s080_biz_code_ksic (
  biz_code   text NOT NULL REFERENCES public.tb_s080_biz_code (biz_code),
  ksic_code  text NOT NULL CHECK (ksic_code ~ '^[0-9]{5}$'),
  ksic_name  text NOT NULL,
  ksic_plus  boolean NOT NULL DEFAULT false,
  is_main    boolean,
  tax_year   smallint NOT NULL,
  loaded_at  timestamp NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (biz_code, ksic_code)
);

COMMENT ON TABLE public.tb_s080_biz_code_ksic IS
  '업종 사전(047) — 업종코드와 KSIC(11차) 연계마다 한 줄. 업종코드 하나가 KSIC 여럿에 이어질 수 있다.';
COMMENT ON COLUMN public.tb_s080_biz_code_ksic.ksic_code IS 'KSIC 세세분류 코드 5자리(연계표의 「+」는 떼고 ksic_plus 에 남긴다).';
COMMENT ON COLUMN public.tb_s080_biz_code_ksic.ksic_name IS 'KSIC 세세분류 이름 — 연계표 표준산업분류 쪽 「세세분류」.';
COMMENT ON COLUMN public.tb_s080_biz_code_ksic.ksic_plus IS
  '연계표에서 코드 끝에 「+」가 붙은 연계 — 업종코드 중분류 94(인적용역)에 이어진 KSIC(직업). 원본 머리말의 뜻.';
COMMENT ON COLUMN public.tb_s080_biz_code_ksic.is_main IS
  '업종코드의 대표 KSIC 표시. 연계표에 그런 표시가 있을 때만 채운다 — 없으면 NULL(짐작하지 않는다).';
COMMENT ON COLUMN public.tb_s080_biz_code_ksic.active IS '새 원본에서 빠진 연계는 지우지 않고 false(047).';

CREATE INDEX IF NOT EXISTS ix_s080_biz_code_ksic_ksic ON public.tb_s080_biz_code_ksic (ksic_code);

ALTER TABLE public.tb_s080_biz_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_biz_code FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_biz_code_read ON public.tb_s080_biz_code;
CREATE POLICY erp_biz_code_read ON public.tb_s080_biz_code FOR SELECT
  USING (current_setting('app.current_role', true) IN ('operator', 'tenant'));

ALTER TABLE public.tb_s080_biz_code_ksic ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_biz_code_ksic FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_biz_code_ksic_read ON public.tb_s080_biz_code_ksic;
CREATE POLICY erp_biz_code_ksic_read ON public.tb_s080_biz_code_ksic FOR SELECT
  USING (current_setting('app.current_role', true) IN ('operator', 'tenant'));

-- ★ 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 읽기만 준다.
REVOKE ALL ON public.tb_s080_biz_code, public.tb_s080_biz_code_ksic FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT ON public.tb_s080_biz_code, public.tb_s080_biz_code_ksic TO erp_app;

COMMIT;

-- =============================================================================
-- 검증(적용 뒤)
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('tb_s080_biz_code', 'tb_s080_biz_code_ksic');                                  -- 두 줄, t, t
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE grantee = 'erp_app' AND table_name IN ('tb_s080_biz_code', 'tb_s080_biz_code_ksic');       -- 두 줄, SELECT
-- SELECT count(*) FROM public.tb_s080_biz_code;                                                      -- 0 (적재 전)
