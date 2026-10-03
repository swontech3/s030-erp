-- =============================================================================
-- 005_acl_shadow_log.sql
-- ACL shadow 모드 기록 테이블. 페이즈 1의 2-8에서 필요하다.
--
-- 번호가 004를 건너뛴다 — 004_rename_tenant.sql 은 앱 정지 창이 필요해
-- `supabase/migrations_hold/` 에 있다(페이즈 G). 번호를 재사용하면 나중에
-- 004가 적용될 때 순서가 어긋난다.
--
-- 구조 출처: doc/ORG_ARCHITECTURE.md §4-5.
-- 이름 정정: 그 문서의 `tb_s030_t001.tb_s030_acl_shadow_log` → `public.tb_s080_acl_shadow_log`
-- (D-1-a — 테이블 접두어는 tb_s080_*, 네 번째 계보를 만들지 않는다)
-- =============================================================================

BEGIN;

CREATE TABLE public.tb_s080_acl_shadow_log (
  log_id         bigserial   PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  s020_member_id integer,
  s020_org_id    integer,
  screen_code    text,                       -- ERP 화면 ID (s030000060 …)
  action         text,                       -- VIEW | CREATE | UPDATE | DELETE
  verdict        text,                       -- DENY | ALLOW_STALE | NO_GRANT_LIST
  route          text,                       -- 실제 라우트
  http_method    text,
  enforced       boolean     NOT NULL DEFAULT false   -- 이 시점에 실제로 막았는가
);

COMMENT ON TABLE public.tb_s080_acl_shadow_log IS
  'ACL shadow 모드 기록(ACL-08). ★ ALLOW 는 기록하지 않는다 — 전량 기록하면 로그가 '
  '데이터보다 커진다. DENY 와 비정상 상태(ALLOW_STALE·NO_GRANT_LIST)만 남긴다.';
COMMENT ON COLUMN public.tb_s080_acl_shadow_log.enforced IS
  '1단계 shadow 에서는 항상 false(기록만). 3단계 실제 차단으로 올리면 true 가 섞인다.';
COMMENT ON COLUMN public.tb_s080_acl_shadow_log.verdict IS
  'DENY=화면 목록에 없음 / ALLOW_STALE=캐시된 목록으로 통과 / NO_GRANT_LIST=목록 조회 자체가 실패';

CREATE INDEX idx_s080_acl_shadow_occurred
  ON public.tb_s080_acl_shadow_log USING btree (occurred_at DESC);
CREATE INDEX idx_s080_acl_shadow_screen
  ON public.tb_s080_acl_shadow_log USING btree (screen_code, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 권한
-- -----------------------------------------------------------------------------
-- 003 의 ALTER DEFAULT PRIVILEGES 가 postgres 역할이 만드는 새 테이블에 자동으로
-- 붙지만, 그건 "적용을 postgres 로 한다"는 규약에 의존한다. 규약이 깨져도 이 테이블만은
-- 붙도록 명시한다. anon·authenticated 에는 아무것도 주지 않는다(check-grants.js 가 검사).
--
-- UPDATE·DELETE 는 주지 않는다 — 감사 로그는 append-only 여야 한다.
GRANT SELECT, INSERT ON public.tb_s080_acl_shadow_log TO erp_app;
GRANT USAGE, SELECT ON SEQUENCE public.tb_s080_acl_shadow_log_log_id_seq TO erp_app;

-- RLS 는 걸지 않는다. 이 테이블은 company_id 축이 없는 운영 로그이고,
-- 기록 시점에는 스코프 GUC 가 아직 세팅되지 않았을 수도 있다(세션 해석 실패도 기록 대상).
-- erp_app 이 INSERT 만 할 수 있으므로 노출면은 erp_app 접속 하나뿐이다.

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- \d tb_s080_acl_shadow_log
-- SELECT screen_code, action, count(*), max(occurred_at)
--   FROM public.tb_s080_acl_shadow_log
--  WHERE occurred_at > now() - interval '1 day'
--  GROUP BY 1, 2 ORDER BY 3 DESC;
-- -- 결과가 나오는 화면은 삐용 마스터에 없거나 권한이 안 부여된 화면이다(ORG §4-5).

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- DROP TABLE IF EXISTS public.tb_s080_acl_shadow_log;
