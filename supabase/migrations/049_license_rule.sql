-- =============================================================================
-- 049_license_rule.sql
--
-- 인허가 기준표 — 업종별 신고 · 허가 · 등록 · 면허와 근거 조문 (2026-10-22)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 공용 자료(법무 · 세무가 함께 읽음) — 어느 서비스 소속도 아니다. 업종 사전(047) · 법령 원문(048)과 같은 권한 방식.
-- 적재는 일회용 스크립트 scripts/oneoff/2026-10-22-license-rule.js 가 한다. 사용자 결정(2026-10-22):
--   · 표 셋 — 규칙 · 근거 조문(048 조문을 가리킨다) · 업종코드 연결(047 업종코드를 가리킨다)
--   · 구분 = 신고 · 허가 · 등록 · 면허 · 없음. 저장된 원문에서 근거를 못 찾은 규칙은 구분을 비운다(NULL — 짐작하지 않는다)
--   · 검토 상태 = 검토됨 / 확인 필요. 처음 적재는 모두 「확인 필요」. 바꾸는 것은 일회용 스크립트로만(화면 없음)
--   · 근거 조문마다 넣을(검토할) 때의 본문 해시를 남긴다 — 048 을 다시 적재해 조문이 바뀌면 대조해 「확인 필요」로 되돌리는 데 쓴다
--   · 조문 첫 줄은 저장하지 않는다(048 본문에서 읽는다)
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① tb_s080_license_rule           규칙마다 한 줄(rule_id 는 적재 스크립트가 정하는 고정 키)
--   ② tb_s080_license_rule_basis     (규칙, 조문)마다 한 줄. ① 과 048 조문을 FK 로 가리킨다
--   ③ tb_s080_license_rule_biz_code  (규칙, 업종코드)마다 한 줄. ① 과 047 업종코드를 FK 로 가리킨다
--   ④ 세 표 RLS ENABLE + FORCE, 읽기 정책 하나(운영사 · 회사 세션 모두 읽기). 쓰기 정책은 없다
--   ⑤ erp_app 은 SELECT 만. 적재 · 검토 상태 변경은 일회용 스크립트가 postgres 로 한다(BYPASSRLS)
--   ⑥ 자료는 넣지 않는다. 047 · 048 을 먼저 적용해야 한다(FK)
--
-- 되돌리기:
--   DROP TABLE IF EXISTS public.tb_s080_license_rule_biz_code;
--   DROP TABLE IF EXISTS public.tb_s080_license_rule_basis;
--   DROP TABLE IF EXISTS public.tb_s080_license_rule;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_s080_license_rule (
  rule_id        text PRIMARY KEY CHECK (rule_id ~ '^[a-z0-9_]+$'),
  name_easy      text NOT NULL,
  license_kind   text CHECK (license_kind IN ('신고', '허가', '등록', '면허', '없음')),
  license_name   text,
  note           text,
  review_status  text NOT NULL DEFAULT '확인 필요' CHECK (review_status IN ('검토됨', '확인 필요')),
  reviewed_at    timestamp,
  reviewed_by    text,
  loaded_at      timestamp NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  CHECK ((review_status = '검토됨') = (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)),
  CHECK (review_status = '확인 필요' OR license_kind IS NOT NULL)
);

COMMENT ON TABLE public.tb_s080_license_rule IS
  '인허가 기준표(049, 공용 — 법무 · 세무가 함께 읽음) — 규칙마다 한 줄. 적재 · 검토 상태 변경은 일회용 스크립트.';
COMMENT ON COLUMN public.tb_s080_license_rule.rule_id IS '규칙 키 — 적재 스크립트가 정하는 고정 이름(영문 소문자 · 숫자 · _). 다시 적재할 때 이 키로 맞춘다.';
COMMENT ON COLUMN public.tb_s080_license_rule.name_easy IS '업종 쉬운 이름(예: 쇼핑몰 · 온라인 판매).';
COMMENT ON COLUMN public.tb_s080_license_rule.license_kind IS
  '필요한 것 — 신고 / 허가 / 등록 / 면허 / 없음. 저장된 원문에서 근거를 못 찾았으면 NULL(짐작하지 않는다). 검토됨이면 비울 수 없다.';
COMMENT ON COLUMN public.tb_s080_license_rule.license_name IS '이름(예: 통신판매업 신고). 없음 · 근거 못 찾음이면 NULL.';
COMMENT ON COLUMN public.tb_s080_license_rule.note IS '예외 · 단서 · 확인할 점.';
COMMENT ON COLUMN public.tb_s080_license_rule.review_status IS '검토 상태 — 검토됨 / 확인 필요. 처음 적재는 확인 필요. 일회용 스크립트로만 바꾼다.';
COMMENT ON COLUMN public.tb_s080_license_rule.reviewed_at IS '검토한 때 — 검토됨일 때만 채운다.';
COMMENT ON COLUMN public.tb_s080_license_rule.reviewed_by IS '검토한 사람 — 검토됨일 때만 채운다.';
COMMENT ON COLUMN public.tb_s080_license_rule.loaded_at IS '적재일시 — 이 줄을 마지막으로 넣거나 고친 때.';
COMMENT ON COLUMN public.tb_s080_license_rule.active IS '적재 스크립트에서 빠진 규칙은 지우지 않고 false(049).';

CREATE TABLE IF NOT EXISTS public.tb_s080_license_rule_basis (
  rule_id              text NOT NULL REFERENCES public.tb_s080_license_rule (rule_id),
  law_id               text NOT NULL,
  article_no           smallint NOT NULL,
  branch_no            smallint NOT NULL DEFAULT 0,
  part                 text,
  body_hash_at_review  text NOT NULL CHECK (body_hash_at_review ~ '^[0-9a-f]{64}$'),
  loaded_at            timestamp NOT NULL,
  active               boolean NOT NULL DEFAULT true,
  PRIMARY KEY (rule_id, law_id, article_no, branch_no),
  FOREIGN KEY (law_id, article_no, branch_no) REFERENCES public.tb_s080_law_article (law_id, article_no, branch_no)
);

COMMENT ON TABLE public.tb_s080_license_rule_basis IS
  '인허가 기준표(049) — 규칙의 근거 조문마다 한 줄. 048 조문을 가리킨다(법률 · 시행령처럼 여럿일 수 있다).';
COMMENT ON COLUMN public.tb_s080_license_rule_basis.part IS '항 · 호 · 목(예: 제1항제8호). 조 전체면 NULL.';
COMMENT ON COLUMN public.tb_s080_license_rule_basis.body_hash_at_review IS
  '넣을(검토할) 때의 048 조문 body_hash. 지금 조문 해시와 다르면 조문이 바뀐 것 — 규칙을 다시 확인한다.';
COMMENT ON COLUMN public.tb_s080_license_rule_basis.active IS '적재 스크립트에서 빠진 근거는 지우지 않고 false(049).';

CREATE TABLE IF NOT EXISTS public.tb_s080_license_rule_biz_code (
  rule_id    text NOT NULL REFERENCES public.tb_s080_license_rule (rule_id),
  biz_code   text NOT NULL REFERENCES public.tb_s080_biz_code (biz_code),
  loaded_at  timestamp NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (rule_id, biz_code)
);

COMMENT ON TABLE public.tb_s080_license_rule_biz_code IS
  '인허가 기준표(049) — 규칙과 업종코드(047) 연결마다 한 줄. 업종코드 하나에 규칙이 여럿 붙을 수 있다. 후보 연결이다 — 확정은 규칙의 검토 상태로 본다.';
COMMENT ON COLUMN public.tb_s080_license_rule_biz_code.active IS '적재 스크립트에서 빠진 연결은 지우지 않고 false(049).';

CREATE INDEX IF NOT EXISTS ix_s080_license_rule_biz_code_biz ON public.tb_s080_license_rule_biz_code (biz_code);
CREATE INDEX IF NOT EXISTS ix_s080_license_rule_basis_article ON public.tb_s080_license_rule_basis (law_id, article_no, branch_no);

ALTER TABLE public.tb_s080_license_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_license_rule FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_license_rule_read ON public.tb_s080_license_rule;
CREATE POLICY erp_license_rule_read ON public.tb_s080_license_rule FOR SELECT
  USING (current_setting('app.current_role', true) IN ('operator', 'tenant'));

ALTER TABLE public.tb_s080_license_rule_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_license_rule_basis FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_license_rule_basis_read ON public.tb_s080_license_rule_basis;
CREATE POLICY erp_license_rule_basis_read ON public.tb_s080_license_rule_basis FOR SELECT
  USING (current_setting('app.current_role', true) IN ('operator', 'tenant'));

ALTER TABLE public.tb_s080_license_rule_biz_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_license_rule_biz_code FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_license_rule_biz_code_read ON public.tb_s080_license_rule_biz_code;
CREATE POLICY erp_license_rule_biz_code_read ON public.tb_s080_license_rule_biz_code FOR SELECT
  USING (current_setting('app.current_role', true) IN ('operator', 'tenant'));

-- ★ 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 읽기만 준다.
REVOKE ALL ON public.tb_s080_license_rule, public.tb_s080_license_rule_basis, public.tb_s080_license_rule_biz_code
  FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT ON public.tb_s080_license_rule, public.tb_s080_license_rule_basis, public.tb_s080_license_rule_biz_code TO erp_app;

COMMIT;

-- =============================================================================
-- 검증(적용 뒤)
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('tb_s080_license_rule', 'tb_s080_license_rule_basis', 'tb_s080_license_rule_biz_code');   -- 세 줄, t, t
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE grantee = 'erp_app' AND table_name IN ('tb_s080_license_rule', 'tb_s080_license_rule_basis', 'tb_s080_license_rule_biz_code');  -- 세 줄, SELECT
-- SELECT count(*) FROM public.tb_s080_license_rule;                                                                -- 0 (적재 전)
