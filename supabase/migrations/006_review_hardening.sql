-- =============================================================================
-- 006_review_hardening.sql
-- 페이즈 1 리뷰(2026-09-07, gstack /review 데이터 마이그레이션 전문가) 반영 3건.
-- 기존 앱(S-WonERP, postgres 접속) 영향 없음 — erp_app 권한과 함수 EXECUTE 만 조인다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. shadow 로그를 실제로 append-only 로
-- -----------------------------------------------------------------------------
-- 005 는 "UPDATE·DELETE 는 주지 않는다"고 적었지만 실제로는 주어져 있었다.
-- 003 의 ALTER DEFAULT PRIVILEGES(postgres 가 만드는 모든 테이블에 erp_app SELECT/INSERT/UPDATE/DELETE)가
-- 005 의 좁은 GRANT 보다 먼저 적용되고, GRANT 는 더하기만 하지 빼지 않는다.
-- 감사 로그를 쓰는 쪽(erp_app)이 지울 수 있으면 감사 로그가 아니다.
REVOKE UPDATE, DELETE, TRUNCATE ON public.tb_s080_acl_shadow_log FROM erp_app;

-- -----------------------------------------------------------------------------
-- 2. tb_s080_companies — 스코프의 뿌리를 입주사 세션이 못 만지게
-- -----------------------------------------------------------------------------
-- link_s020_org_id 는 "이 삐용 조직 = 이 입주사" 라는 격리의 뿌리다. erp_app 이 전 테이블 DML 을
-- 가진 상태에서 이 테이블에 RLS 가 없으면, 나중 페이즈의 어떤 입주사 라우트 버그 하나가
-- 연결을 다른 회사로 돌려놓을 수 있고, 그 순간 resolveCompanyId 가 남의 company_id 를 준다.
--
-- 읽기: 모두 허용 — resolveCompanyId 는 스코프 GUC 가 세팅되기 *전에* 이 테이블을 읽는다.
-- 쓰기: operator 세션만. 입주사 연결 UI(페이즈 3)는 운영사 작업이다.
ALTER TABLE public.tb_s080_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_companies_read  ON public.tb_s080_companies FOR SELECT USING (true);
CREATE POLICY erp_companies_write ON public.tb_s080_companies FOR ALL
  USING (erp_is_operator()) WITH CHECK (erp_is_operator());

-- -----------------------------------------------------------------------------
-- 3. 함수 EXECUTE — anon/authenticated 의 기본 권한 회수
-- -----------------------------------------------------------------------------
-- 003 은 "그 시점에 있던" 함수의 EXECUTE 만 회수했고, 이후 만든 erp_current_company_id() ·
-- erp_is_operator() 는 Supabase 기본값대로 anon/authenticated 가 부를 수 있었다(PostgREST /rpc).
-- 지금은 값을 읽을 뿐이라 위험이 작지만, 앞으로 SECURITY DEFINER 함수가 생기면 그대로 구멍이다.
REVOKE ALL ON FUNCTION public.erp_current_company_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_is_operator()        FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
-- erp_app 은 RLS 정책 안에서 이 두 함수를 호출하므로 EXECUTE 가 있어야 한다.
GRANT EXECUTE ON FUNCTION public.erp_current_company_id(), public.erp_is_operator() TO erp_app;

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- SELECT has_table_privilege('erp_app','public.tb_s080_acl_shadow_log','DELETE');   -- false
-- SELECT has_function_privilege('anon','public.erp_is_operator()','EXECUTE');       -- false
-- -- erp_app + tenant GUC 로: UPDATE tb_s080_companies SET memo='x' → 0 rows (정책이 막음)
-- -- erp_app + GUC 없이:     SELECT count(*) FROM tb_s080_companies → 전체 (읽기는 열려 있음)

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- GRANT UPDATE, DELETE ON public.tb_s080_acl_shadow_log TO erp_app;
-- DROP POLICY IF EXISTS erp_companies_write ON public.tb_s080_companies;
-- DROP POLICY IF EXISTS erp_companies_read  ON public.tb_s080_companies;
-- ALTER TABLE public.tb_s080_companies DISABLE ROW LEVEL SECURITY;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
-- COMMIT;
