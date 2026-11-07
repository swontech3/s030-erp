-- =============================================================================
-- 051_legal_articles.sql
--
-- 법무 정관 최종본 — 머리 · 조항 두 표 (2026-11-08)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 설계 doc/법무_정관_최종본_설계.md §2-1 · §8-11(결정 2026-11-08 — 표 두 개):
--   · 회사(단체 org_id)마다 정관 최종본 하나 — 조항 단위로. 출력은 늘 최종본에서
--   · 정관이 바뀌는 변경등기는 최종본에서 해당 조항만 바꾼 「변경된 정관」을 출력하고, 건이 완료되면
--     그것이 새 최종본(개정 부칙 한 줄을 덧붙인다)
--   · 1단계(2026-11-08)는 우리 시스템으로 설립한 회사만 — 첫 정관 변경 때 설립 건 자료로 만들어 바로 확정
--   · 조항은 번호가 아니라 역할(상호 · 목적 · 본점 · 공고)로 찾는다 — 역할마다 0 또는 1
--   · 이력은 남기지 않는다(최종본 하나)
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① 새 표 tb_s080_legal_articles(머리 — 단체마다 한 줄) · tb_s080_legal_article_items(조항)
--   ② 조항 → 머리 FK(ON DELETE CASCADE). 단체 · 법인변경 건으로는 FK 를 걸지 않는다(040 · 043 과 같다)
--   ③ 역할 부분 유일 인덱스 (org_id, role) WHERE role IS NOT NULL — 「상호 조항이 둘」을 DB 가 막는다
--   ④ RLS — 037 · 040 · 042 · 043 과 같은 정책(erp_org_scope): 운영사 전부 · 회사는 자기 단체 줄만. FORCE
--      (회사 사용자도 건을 작성완료 · 완료하므로 최종본을 만들고 고친다)
--   ⑤ erp_app 에 읽기 · 넣기 · 고치기 · 지우기(조항은 통째로 바꿔 쓴다)
--   ⑥ 기존 표 · 칸 · 자료는 건드리지 않는다. 자료도 넣지 않는다
--
-- 되돌리기:
--   DROP TABLE IF EXISTS public.tb_s080_legal_article_items;
--   DROP TABLE IF EXISTS public.tb_s080_legal_articles;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_s080_legal_articles (
  org_id          integer PRIMARY KEY,
  company_type    text,
  origin          text NOT NULL CHECK (origin IN ('INCORP', 'UPLOAD')),
  origin_ref      text,
  state           text NOT NULL CHECK (state IN ('DRAFT', 'FINAL')),
  revision        integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  confirmed_at    timestamp,
  confirmed_by    text,
  last_change_id  text,
  updated_at      timestamp NOT NULL DEFAULT now(),
  updated_by      text NOT NULL
);

COMMENT ON TABLE public.tb_s080_legal_articles IS
  '법무 정관 최종본 머리(051) — 단체마다 한 줄. 조항은 tb_s080_legal_article_items. 이력 없음(최종본 하나).';
COMMENT ON COLUMN public.tb_s080_legal_articles.org_id IS '단체(삐용 org_id) — 회사마다 하나.';
COMMENT ON COLUMN public.tb_s080_legal_articles.company_type IS '만들 때의 회사유형(R 주식회사 · A 유한회사) — 읽기 참고용.';
COMMENT ON COLUMN public.tb_s080_legal_articles.origin IS 'INCORP = 우리 설립 건(정관 양식 + 설립 값)에서 만듦 · UPLOAD = docx · txt 를 나눔(2단계).';
COMMENT ON COLUMN public.tb_s080_legal_articles.origin_ref IS 'INCORP 면 설립 건 id, UPLOAD 면 올린 원본 이름.';
COMMENT ON COLUMN public.tb_s080_legal_articles.state IS 'DRAFT = 확인 전(2단계) · FINAL = 확정된 최종본.';
COMMENT ON COLUMN public.tb_s080_legal_articles.revision IS '개정 번호 — 확정 · 법인변경 건 완료로 바뀔 때마다 +1. 작성완료 때 번호와 완료 때 번호를 대조한다.';
COMMENT ON COLUMN public.tb_s080_legal_articles.last_change_id IS '마지막으로 최종본을 바꾼 법인변경 건 id.';

CREATE TABLE IF NOT EXISTS public.tb_s080_legal_article_items (
  org_id      integer NOT NULL REFERENCES public.tb_s080_legal_articles (org_id) ON DELETE CASCADE,
  seq         integer NOT NULL CHECK (seq > 0),
  kind        text NOT NULL CHECK (kind IN ('CHAPTER', 'ARTICLE', 'TEXT')),
  article_no  text,
  title       text,
  body        text NOT NULL DEFAULT '',
  role        text CHECK (role IN ('TRADE_NAME', 'PURPOSE', 'HQ', 'NOTICE')),
  section     text NOT NULL DEFAULT 'MAIN' CHECK (section IN ('MAIN', 'SUPPLEMENT')),
  change_id   text,
  PRIMARY KEY (org_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS tb_s080_legal_article_items_role_uq
  ON public.tb_s080_legal_article_items (org_id, role) WHERE role IS NOT NULL;
CREATE INDEX IF NOT EXISTS tb_s080_legal_article_items_change_idx
  ON public.tb_s080_legal_article_items (change_id) WHERE change_id IS NOT NULL;

COMMENT ON TABLE public.tb_s080_legal_article_items IS
  '법무 정관 최종본 조항(051) — 한 줄이 장 · 조 · 글 하나. 순서는 seq. 주민번호는 넣지 않는다(정관 말미 서명란은 넣지 않는다).';
COMMENT ON COLUMN public.tb_s080_legal_article_items.kind IS 'CHAPTER 장 제목 줄 · ARTICLE 조 · TEXT 조가 아닌 글(개정 부칙 등).';
COMMENT ON COLUMN public.tb_s080_legal_article_items.article_no IS '조 번호 글자(「1」 · 「2의2」) — 회사마다 다르므로 찾는 데 쓰지 않는다.';
COMMENT ON COLUMN public.tb_s080_legal_article_items.title IS '조 제목 · 장 제목.';
COMMENT ON COLUMN public.tb_s080_legal_article_items.body IS '본문 — 항 · 호는 줄로.';
COMMENT ON COLUMN public.tb_s080_legal_article_items.role IS '조항 역할 — TRADE_NAME 상호 · PURPOSE 목적 · HQ 본점 · NOTICE 공고방법. 단체마다 역할 하나에 한 줄.';
COMMENT ON COLUMN public.tb_s080_legal_article_items.section IS 'MAIN 본칙 · SUPPLEMENT 부칙(개정마다 덧붙인다).';
COMMENT ON COLUMN public.tb_s080_legal_article_items.change_id IS '이 줄을 덧붙인 법인변경 건 id(개정 부칙). 이 값이 있으면 그 건은 최종본에 반영됐다.';

ALTER TABLE public.tb_s080_legal_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_legal_articles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_org_scope ON public.tb_s080_legal_articles;
CREATE POLICY erp_org_scope ON public.tb_s080_legal_articles FOR ALL
  USING (public.erp_is_operator() OR org_id = public.erp_current_org_id())
  WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id());

ALTER TABLE public.tb_s080_legal_article_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_legal_article_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_org_scope ON public.tb_s080_legal_article_items;
CREATE POLICY erp_org_scope ON public.tb_s080_legal_article_items FOR ALL
  USING (public.erp_is_operator() OR org_id = public.erp_current_org_id())
  WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_legal_articles TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_legal_article_items TO erp_app;

COMMIT;
