-- =============================================================================
-- 041_biz_purpose_catalog_scope.sql
--
-- 사업목적 카탈로그(s040300010) — 레거시 표를 그대로 쓰고 읽기 · 쓰기를 가른다 (30-2, 2026-10-11)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 레거시 `tb_s080_biz_purpose_catalog` 를 재사용한다(결정 2026-10-11 — 새 표 없음). 지금은
-- RLS 가 꺼져 있고 erp_app 이 읽기 · 넣기 · 고치기 · 지우기를 모두 가진다 — 회사 세션이 카탈로그를
-- 고칠 수 있는 상태다. 결정은:
--   · 편집 = 운영사만 · 읽기 = 로그인한 모든 회사 사용자(입주사 · 비입주사), **사용 중인 문구만**
--   · 실제 삭제는 없다 — 사용 끄기(active = false)만
--   · 운영사가 화면에서 문구만 추가한다 → 업종코드가 없다. 그래서 biz_code 의 NOT NULL 을 푼다
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① biz_code NOT NULL 해제. **UNIQUE 는 그대로**(tb_s080_biz_purpose_catalog_biz_code_key).
--      PostgreSQL 의 UNIQUE 는 NULL 을 서로 다른 값으로 본다(NULLS DISTINCT 가 기본, 이 인덱스에
--      NULLS NOT DISTINCT 없음) → 업종코드 없는 줄이 여럿이어도 걸리지 않는다.
--      ★ 앱은 빈 문자열('')이 아니라 **NULL** 을 넣어야 한다 — '' 는 한 줄만 들어간다.
--   ② RLS ENABLE + FORCE, 정책 셋
--      · erp_biz_purpose_read   SELECT — 운영사 전부 / 회사(tenant)는 active 줄만
--      · erp_biz_purpose_insert INSERT — 운영사만
--      · erp_biz_purpose_update UPDATE — 운영사만
--      app.current_role 이 비어 있는 접속(세션 없는 경로)은 아무것도 못 본다(닫힌 쪽).
--   ③ erp_app 의 DELETE 를 거둔다 — 실제 삭제가 없으므로(결정 2). 읽기 · 넣기 · 고치기는 그대로
--   ④ **자료는 바꾸지 않는다.** 지금 4줄(레거시 샘플) 그대로. 업종코드 · KSIC · 인허가 칸도 그대로
--   ⑤ 설립 표(tb_s080_incorporations · tb_s080_incorp_purposes)는 건드리지 않는다
--
-- ★ postgres · service_role 은 BYPASSRLS 라 정책을 타지 않는다(적용 · 적재 스크립트는 그대로 돈다).
-- ★ 같은 문구 중복(앞뒤 공백 무시) 거절은 **앱(API)** 이 한다 — DB 유일 인덱스는 두지 않는다.
--
-- 되돌리기:
--   DROP POLICY IF EXISTS erp_biz_purpose_read   ON public.tb_s080_biz_purpose_catalog;
--   DROP POLICY IF EXISTS erp_biz_purpose_insert ON public.tb_s080_biz_purpose_catalog;
--   DROP POLICY IF EXISTS erp_biz_purpose_update ON public.tb_s080_biz_purpose_catalog;
--   ALTER TABLE public.tb_s080_biz_purpose_catalog NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.tb_s080_biz_purpose_catalog DISABLE ROW LEVEL SECURITY;
--   GRANT DELETE ON public.tb_s080_biz_purpose_catalog TO erp_app;
--   -- biz_code NOT NULL 복구는 업종코드 없는 줄을 먼저 처리해야 한다
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_biz_purpose_catalog ALTER COLUMN biz_code DROP NOT NULL;

COMMENT ON COLUMN public.tb_s080_biz_purpose_catalog.biz_code IS
  '국세청 업종코드 6자리. 화면에서 추가한 문구는 NULL(041) — 빈 문자열 금지(UNIQUE). 나중 법령 적재가 채운다.';
COMMENT ON COLUMN public.tb_s080_biz_purpose_catalog.biz_name IS
  '사업목적 문구(화면 · API 의 text). 같은 문구(앞뒤 공백 무시) 중복은 앱이 거절한다(041).';

ALTER TABLE public.tb_s080_biz_purpose_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_biz_purpose_catalog FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_biz_purpose_read ON public.tb_s080_biz_purpose_catalog;
CREATE POLICY erp_biz_purpose_read ON public.tb_s080_biz_purpose_catalog FOR SELECT
  USING (public.erp_is_operator() OR (current_setting('app.current_role', true) = 'tenant' AND active));

DROP POLICY IF EXISTS erp_biz_purpose_insert ON public.tb_s080_biz_purpose_catalog;
CREATE POLICY erp_biz_purpose_insert ON public.tb_s080_biz_purpose_catalog FOR INSERT
  WITH CHECK (public.erp_is_operator());

DROP POLICY IF EXISTS erp_biz_purpose_update ON public.tb_s080_biz_purpose_catalog;
CREATE POLICY erp_biz_purpose_update ON public.tb_s080_biz_purpose_catalog FOR UPDATE
  USING (public.erp_is_operator())
  WITH CHECK (public.erp_is_operator());

REVOKE DELETE ON public.tb_s080_biz_purpose_catalog FROM erp_app;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-041.js (적용 전: --dry-run 으로 롤백 안에서 돌려 본다)
-- =============================================================================
-- SELECT is_nullable FROM information_schema.columns
--  WHERE table_name = 'tb_s080_biz_purpose_catalog' AND column_name = 'biz_code';                  -- YES
-- SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tb_s080_biz_purpose_catalog'; -- t, t
-- SELECT privilege_type FROM information_schema.role_table_grants
--  WHERE grantee = 'erp_app' AND table_name = 'tb_s080_biz_purpose_catalog';                        -- SELECT, INSERT, UPDATE
-- SELECT count(*) FROM public.tb_s080_biz_purpose_catalog;                                          -- 4
