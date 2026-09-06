-- =============================================================================
-- 003_revoke_public.sql
-- 보안 — anon/authenticated 전권 차단 + company_id 기반 RLS.
--
-- ★ 설계 확장 — 지시는 "RLS 정책 추가(company_id 기반)"만 요청했지만,
-- Supabase의 `service_role`은 기본적으로 BYPASSRLS 속성을 가진 Postgres
-- 역할이다. Fastify가 service_role로 접속하면 RLS 정책을 아무리 걸어도
-- 전부 우회된다 — 정책이 있으나 마나다.
--
-- 그래서 이 마이그레이션은 Fastify 전용의 **BYPASSRLS 없는 새 역할**
-- (erp_app)을 만든다. Fastify는 앞으로 service_role이 아니라 erp_app으로
-- 접속하고, 매 요청 트랜잭션 시작 시 세션 GUC 두 개를 세팅한다:
--   SET LOCAL app.current_company_id = '<company_id>';   -- 입주사 세션
--   SET LOCAL app.current_role       = 'operator' | 'tenant';
-- RLS 정책은 이 GUC를 읽어 판정한다. 이렇게 해야 "DB 자체가 격리를 강제"
-- 한다는 지시의 취지(company_id 기반 RLS)가 실제로 성립한다.
--
-- 이 설계는 ORG_ARCHITECTURE.md §2-4의 스코프 헬퍼(애플리케이션 레벨)를
-- 대체하지 않는다 — 병행이다. 스코프 헬퍼가 실수로 뚫려도 DB가 막는다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. anon / authenticated 전권 회수
-- -----------------------------------------------------------------------------
-- 현재 public 32테이블 전부 RLS off + anon·authenticated·service_role에
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 전권(87건, Supabase
-- 기본 grant). anon 키는 NEXT_PUBLIC_SUPABASE_ANON_KEY로 클라이언트 번들에
-- 들어가 있다(BACKEND_ANALYSIS.md §4-6). 선행 확인: 기존 앱의 supabase-js는
-- Storage 전용이고 테이블 조회는 100% Prisma(GREP 결과 0건) — 이 REVOKE는
-- 기존 앱에 영향을 주지 않는다.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Fastify 전용 역할 erp_app — BYPASSRLS 없음
-- -----------------------------------------------------------------------------
-- ★ 비밀번호는 이 파일에 넣지 않는다(버전관리 커밋 금지). 적용 후 별도로:
--   ALTER ROLE erp_app PASSWORD '<비밀번호 관리 도구에서 생성한 값>';
-- 를 psql 또는 Supabase 대시보드에서 직접 실행한다. Fastify의 DATABASE_URL은
-- 이 역할로 접속하도록 바꾼다(기존 service_role 접속과 별개).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO erp_app;

-- -----------------------------------------------------------------------------
-- 3. RLS — company_id 격리축 (BACKEND_ANALYSIS.md §4-2가 식별한 6개 테이블)
-- -----------------------------------------------------------------------------
-- 대상: company_id 컬럼을 가진 테이블 중 애플리케이션 격리가 실제로 필요한 것.
-- 카탈로그성 테이블(buildings·floors·spaces·facilities·code_masters 등)은
-- 입주사별로 갈리지 않으므로 RLS 대상이 아니다(운영사 자산).
--
-- 정책 규칙 공통: operator는 전체, tenant는 자기 company_id만.
-- current_setting(..., true)는 GUC 미설정 시 NULL을 반환 — 즉 Fastify가
-- 세션 컨텍스트를 세팅하지 않은 접속(사고·버그)은 tenant 취급되어 아무
-- 것도 안 보인다(fail-closed). operator 문자열과 정확히 일치해야만 전체 허용.

CREATE OR REPLACE FUNCTION public.erp_current_company_id() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_company_id', true), '')
$$;

CREATE OR REPLACE FUNCTION public.erp_is_operator() RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.current_role', true) = 'operator'
$$;

-- contracts
ALTER TABLE public.tb_s080_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_company_scope ON public.tb_s080_contracts
  USING (erp_is_operator() OR company_id = erp_current_company_id())
  WITH CHECK (erp_is_operator() OR company_id = erp_current_company_id());

-- invoices
ALTER TABLE public.tb_s080_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_company_scope ON public.tb_s080_invoices
  USING (erp_is_operator() OR company_id = erp_current_company_id())
  WITH CHECK (erp_is_operator() OR company_id = erp_current_company_id());

-- payments
ALTER TABLE public.tb_s080_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_company_scope ON public.tb_s080_payments
  USING (erp_is_operator() OR company_id = erp_current_company_id())
  WITH CHECK (erp_is_operator() OR company_id = erp_current_company_id());

-- settlements
ALTER TABLE public.tb_s080_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_company_scope ON public.tb_s080_settlements
  USING (erp_is_operator() OR company_id = erp_current_company_id())
  WITH CHECK (erp_is_operator() OR company_id = erp_current_company_id());

-- members
ALTER TABLE public.tb_s080_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_company_scope ON public.tb_s080_members
  USING (erp_is_operator() OR company_id = erp_current_company_id())
  WITH CHECK (erp_is_operator() OR company_id = erp_current_company_id());

-- reservations — company_id는 nullable(고아 예약은 operator만 본다)
ALTER TABLE public.tb_s080_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_company_scope ON public.tb_s080_reservations
  USING (erp_is_operator() OR company_id = erp_current_company_id())
  WITH CHECK (erp_is_operator() OR company_id = erp_current_company_id());

COMMENT ON FUNCTION public.erp_current_company_id() IS
  'RLS 판정용. Fastify가 트랜잭션마다 SET LOCAL app.current_company_id로 세팅.';
COMMENT ON FUNCTION public.erp_is_operator() IS
  'RLS 판정용. Fastify가 트랜잭션마다 SET LOCAL app.current_role로 세팅.';

COMMIT;

-- =============================================================================
-- Fastify 쪽 짝 코드 (참고 — 이 파일이 만드는 것은 DB 쪽 절반뿐)
-- =============================================================================
-- await client.query('BEGIN');
-- await client.query('SET LOCAL app.current_role = $1', [session.role]);       -- 'operator' | 'tenant'
-- if (session.role !== 'operator') {
--   await client.query('SET LOCAL app.current_company_id = $1', [session.companyId]);
-- }
-- -- ... 쿼리 실행 ...
-- await client.query('COMMIT');
--
-- ★ 커넥션 풀을 쓰면 SET LOCAL은 트랜잭션 범위에서만 유효하므로 커넥션이
-- 반납돼도 다음 요청에 값이 새지 않는다. SET(LOCAL 없이)은 절대 쓰지 않는다
-- — 커넥션에 영구히 남아 다음 요청(다른 회사)에 새어나간다.

-- =============================================================================
-- 검증
-- =============================================================================
-- -- anon으로 접속해 아무 테이블이나 SELECT — permission denied 나와야 정상
-- -- erp_app으로 접속 후 GUC 없이 SELECT — 0건이어야 정상(fail-closed)
-- SET app.current_role = 'tenant';
-- SET app.current_company_id = '<실제 company_id>';
-- SELECT count(*) FROM tb_s080_contracts;  -- 그 회사 것만 나와야 함
-- SET app.current_role = 'operator';
-- SELECT count(*) FROM tb_s080_contracts;  -- 전체가 나와야 함

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS erp_company_scope ON public.tb_s080_contracts;
-- DROP POLICY IF EXISTS erp_company_scope ON public.tb_s080_invoices;
-- DROP POLICY IF EXISTS erp_company_scope ON public.tb_s080_payments;
-- DROP POLICY IF EXISTS erp_company_scope ON public.tb_s080_settlements;
-- DROP POLICY IF EXISTS erp_company_scope ON public.tb_s080_members;
-- DROP POLICY IF EXISTS erp_company_scope ON public.tb_s080_reservations;
-- ALTER TABLE public.tb_s080_contracts    DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_s080_invoices     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_s080_payments     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_s080_settlements  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_s080_members      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_s080_reservations DISABLE ROW LEVEL SECURITY;
-- DROP FUNCTION IF EXISTS public.erp_current_company_id();
-- DROP FUNCTION IF EXISTS public.erp_is_operator();
-- -- anon/authenticated 권한 복구는 의도적으로 포함하지 않는다(보안 후퇴이므로
-- -- 되돌릴 경우 사유를 남기고 수동으로 GRANT할 것).
-- COMMIT;
