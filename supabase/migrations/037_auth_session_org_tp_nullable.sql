-- =============================================================================
-- 037_auth_session_org_tp_nullable.sql
--
-- ERP 세션의 회사 구분(org_tp)을 **비워도 되게** 한다. 2026-10-22
--
-- -----------------------------------------------------------------------------
-- ★ 왜 — ERP 로그인을 규격서(연동규격 Q6)대로 바꿨다
-- -----------------------------------------------------------------------------
-- 브라우저가 삐용 로그인을 직접 부르고, ERP 서버는 받은 토큰을 삐용 my-orgs 로 **확인한 값**
-- 으로만 세션을 만든다. my-orgs 응답에는 회사 구분이 없다. 브라우저가 보낸 값은 믿지 않는다 —
-- 그래서 새 세션의 org_tp 는 NULL 이다(대표 결정 A · 2026-10-22).
--
-- ★ 이 칸으로 판정하는 ERP 코드는 **없다**(2026-10-22 전수 확인 — 세션에 넣는 줄 하나뿐 ·
--   MockBbiyongAcl 은 orgTp 를 보지 않는다는 시험까지 있다). 코드 주석이 말하는
--   「S-WonERP 레거시 브리지(erp-session-map.ts)」는 이 저장소에 없다 — 그쪽이 이 칸을 읽는다면
--   NULL 을 받는다(확인 필요).
-- ★ 기존 행은 그대로다(값이 있는 행은 값이 남는다).
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_auth_session
  ALTER COLUMN org_tp DROP NOT NULL;

COMMENT ON COLUMN public.tb_s080_auth_session.org_tp IS
  '삐용 orgTp(S=운영사). 2026-10-22 부터 새 세션은 NULL — 확인에 쓰는 삐용 my-orgs 에 없고 브라우저 값은 믿지 않는다. 판정에 쓰지 않는다.';

COMMIT;

-- -----------------------------------------------------------------------------
-- 확인
-- -----------------------------------------------------------------------------
-- SELECT is_nullable FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'tb_s080_auth_session' AND column_name = 'org_tp';   -- YES
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — NULL 인 세션이 있으면 실패한다. 그 세션을 먼저 끊는다(revoked)/지운 뒤 돌린다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s080_auth_session WHERE org_tp IS NULL;   -- 그 사람들은 다시 로그인한다
-- ALTER TABLE public.tb_s080_auth_session ALTER COLUMN org_tp SET NOT NULL;
-- COMMENT ON COLUMN public.tb_s080_auth_session.org_tp IS
--   '삐용 로그인 응답의 orgTp. S=운영사(에스원비즈) / 그 외=입주사. 홈 분기(§3-4)의 1차 신호.';
-- COMMIT;
