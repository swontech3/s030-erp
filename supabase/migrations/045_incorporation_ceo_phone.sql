-- =============================================================================
-- 045_incorporation_ceo_phone.sql
--
-- 법인설립 건에 「대표이사 전화」 칸을 더한다(2026-10-14). ★ 적용 전 승인 대기
--
--   · tb_s080_incorporations.ceo_phone — 설립등기신청서 서명란의 대표이사 전화. 선택 입력
--
-- NULL 허용 · 기본값 없음. 이미 있는 행은 NULL 로 남는다(서류는 빈칸).
--
-- ★ 앱 코드가 이 칸을 읽는다 — 적용 전에는 설립 상세 읽기가 실패한다.
-- ★ RLS(erp_org_scope)는 org_id 만 본다. 칸을 더해도 정책은 그대로다.
-- ★ 레거시 S-WonERP(Prisma)는 이 칸을 모른다 — 칸을 더하는 것이라 레거시 읽기는 깨지지 않는다.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_incorporations
  ADD COLUMN ceo_phone text;

COMMENT ON COLUMN public.tb_s080_incorporations.ceo_phone IS
  '대표이사 전화 — 설립등기신청서 서명란. 선택. 045';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'tb_s080_incorporations' AND column_name = 'ceo_phone';
-- -- 한 줄
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.tb_s080_incorporations DROP COLUMN ceo_phone;
