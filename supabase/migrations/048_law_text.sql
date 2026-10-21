-- =============================================================================
-- 048_law_text.sql
--
-- 법령 원문 저장 — 법령 · 조문 (2026-10-21)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 공용 자료(법무 · 세무가 함께 읽음) — 어느 서비스 소속도 아니다. 업종 사전(047)과 같은 권한 방식.
-- 원본은 국가법령정보 공동활용 API(대한민국 현행법령 본문 XML). 적재는 일회용 스크립트
-- scripts/oneoff/2026-10-21-law-text.js 가 한다. 사용자 결정(2026-10-21):
--   · 갱신 — 시행일이 같으면 건너뛴다. 바뀌었으면 본문 해시로 바뀐 조문만 고친다
--   · 새 본문에서 빠진 조문은 지우지 않고 active = false 로 표시한다
--   · 의미 검색(벡터) · 인허가 기준표 · 화면은 이 범위가 아니다
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① tb_s080_law          법령마다 한 줄(법령 ID 가 키)
--   ② tb_s080_law_article  조문마다 한 줄. ①을 FK 로 가리킨다. 장 · 절 제목 줄(「전문」) · 부칙은 넣지 않는다
--   ③ 두 표 RLS ENABLE + FORCE, 읽기 정책 하나(운영사 · 회사 세션 모두 읽기). 쓰기 정책은 없다
--   ④ erp_app 은 SELECT 만. 적재는 일회용 스크립트가 postgres 로 한다(BYPASSRLS)
--   ⑤ 자료는 넣지 않는다
--
-- 되돌리기:
--   DROP TABLE IF EXISTS public.tb_s080_law_article;
--   DROP TABLE IF EXISTS public.tb_s080_law;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_s080_law (
  law_id          text PRIMARY KEY CHECK (law_id ~ '^[0-9]{6}$'),
  law_name        text NOT NULL,
  law_kind        text NOT NULL CHECK (law_kind IN ('법률', '시행령')),
  effective_date  date NOT NULL,
  ministry        text NOT NULL,
  fetched_at      timestamp NOT NULL
);

COMMENT ON TABLE public.tb_s080_law IS
  '법령 원문(048, 공용 — 법무 · 세무가 함께 읽음) — 법령마다 한 줄. 원본은 국가법령정보 API, 적재는 일회용 스크립트.';
COMMENT ON COLUMN public.tb_s080_law.law_id IS '법령 ID 6자리(국가법령정보). 개정돼도 바뀌지 않는다.';
COMMENT ON COLUMN public.tb_s080_law.law_name IS '법령명(한글).';
COMMENT ON COLUMN public.tb_s080_law.law_kind IS '종류 — 법률 / 시행령(원본 법종구분 「대통령령」을 시행령으로 적는다).';
COMMENT ON COLUMN public.tb_s080_law.effective_date IS '시행일 — 적재한 현행 본문의 시행일자. 같으면 다시 적재할 때 건너뛴다.';
COMMENT ON COLUMN public.tb_s080_law.ministry IS '소관 부처.';
COMMENT ON COLUMN public.tb_s080_law.fetched_at IS '가져온 날짜 — 이 법령을 마지막으로 적재한 때(시행일이 같아 건너뛰면 그대로).';

CREATE TABLE IF NOT EXISTS public.tb_s080_law_article (
  law_id      text NOT NULL REFERENCES public.tb_s080_law (law_id),
  article_no  smallint NOT NULL CHECK (article_no > 0),
  branch_no   smallint NOT NULL DEFAULT 0 CHECK (branch_no >= 0),
  title       text,
  body        text NOT NULL,
  is_deleted  boolean NOT NULL,
  body_hash   text NOT NULL CHECK (body_hash ~ '^[0-9a-f]{64}$'),
  fetched_at  timestamp NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (law_id, article_no, branch_no)
);

COMMENT ON TABLE public.tb_s080_law_article IS
  '법령 원문(048) — 조문마다 한 줄. 본문(「전문」 제목 줄 · 부칙 제외)만.';
COMMENT ON COLUMN public.tb_s080_law_article.article_no IS '조문 번호 — 제3조의2 면 3.';
COMMENT ON COLUMN public.tb_s080_law_article.branch_no IS '가지 번호 — 제3조의2 면 2, 가지 없는 조문은 0.';
COMMENT ON COLUMN public.tb_s080_law_article.title IS '조문 제목. 삭제된 조문은 제목이 없다(NULL).';
COMMENT ON COLUMN public.tb_s080_law_article.body IS
  '본문 — 조문내용 · 항 · 호 · 목 글자를 원본 순서대로 줄바꿈으로 잇는다(조문참고자료 「[전문개정 …]」는 넣지 않는다).';
COMMENT ON COLUMN public.tb_s080_law_article.is_deleted IS '삭제 여부 — 조문내용이 「제N조 삭제 <…>」 꼴인 조문(법에서 삭제된 조). 아래 active 와 다르다.';
COMMENT ON COLUMN public.tb_s080_law_article.body_hash IS '본문 해시(SHA-256 hex, body). 본문 첫머리에 「제N조(제목)」이 있어 제목 변경도 잡힌다. 다시 적재할 때 바뀐 조문만 고치는 데 쓴다.';
COMMENT ON COLUMN public.tb_s080_law_article.fetched_at IS '가져온 날짜 — 이 조문을 마지막으로 넣거나 고친 때.';
COMMENT ON COLUMN public.tb_s080_law_article.active IS '새 본문에서 빠진 조문은 지우지 않고 false(048).';

ALTER TABLE public.tb_s080_law ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_law FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_law_read ON public.tb_s080_law;
CREATE POLICY erp_law_read ON public.tb_s080_law FOR SELECT
  USING (current_setting('app.current_role', true) IN ('operator', 'tenant'));

ALTER TABLE public.tb_s080_law_article ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_law_article FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_law_article_read ON public.tb_s080_law_article;
CREATE POLICY erp_law_article_read ON public.tb_s080_law_article FOR SELECT
  USING (current_setting('app.current_role', true) IN ('operator', 'tenant'));

-- ★ 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 읽기만 준다.
REVOKE ALL ON public.tb_s080_law, public.tb_s080_law_article FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT ON public.tb_s080_law, public.tb_s080_law_article TO erp_app;

COMMIT;

-- =============================================================================
-- 검증(적용 뒤)
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('tb_s080_law', 'tb_s080_law_article');                                         -- 두 줄, t, t
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE grantee = 'erp_app' AND table_name IN ('tb_s080_law', 'tb_s080_law_article');              -- 두 줄, SELECT
-- SELECT count(*) FROM public.tb_s080_law;                                                           -- 0 (적재 전)
