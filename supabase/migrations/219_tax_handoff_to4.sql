-- =============================================================================
-- 219_tax_handoff_to4.sql
--
-- 세무(S05) 세무사 전달 서류 보낸 이력 — 받는 사람 1~3 → 1~4 (2026-11-07 대표 결정: 세무사 메일 4명 고정)
--
--   tb_s050_handoff_logs.ck_s050_handoff_logs_recipients  cardinality(recipients) BETWEEN 1 AND 4
--
-- ★ 세무 설정의 세무사 메일(tb_s050_settings.tax_emails)은 DB 가 개수를 강제하지 않는다(201) — 코드 제한만 3 → 4(앱).
-- ★ 하는 일 · 영향: CHECK 하나를 지우고 같은 이름으로 넓혀 다시 건다. 있는 이력(1~3명)은 새 CHECK 에도 그대로 맞는다 —
--   맞지 않는 줄이 있으면 스스로 멈춘다. 다른 표 · 칸 · 권한은 바꾸지 않는다. 다시 돌려도 같은 결과다.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tb_s050_handoff_logs') IS NULL THEN
    RAISE EXCEPTION '219 — 보낸 이력 표가 없다. 218 을 먼저 적용할 것';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tb_s050_handoff_logs WHERE cardinality(recipients) NOT BETWEEN 1 AND 4) THEN
    RAISE EXCEPTION '219 — 받는 사람이 1~4 가 아닌 이력이 있다. 먼저 확인할 것';
  END IF;
END $$;

ALTER TABLE public.tb_s050_handoff_logs DROP CONSTRAINT IF EXISTS ck_s050_handoff_logs_recipients;
ALTER TABLE public.tb_s050_handoff_logs
  ADD CONSTRAINT ck_s050_handoff_logs_recipients CHECK (cardinality(recipients) BETWEEN 1 AND 4);

COMMENT ON COLUMN public.tb_s050_handoff_logs.recipients IS '받는 사람 메일 — 세무 설정의 세무사 메일 가운데 고른 것(1~4, 219).';

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-219.js .env packages/api/.env (4항목) · node scripts/verify-218.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-219.js .env packages/api/.env --dry-run supabase/migrations/219_tax_handoff_to4.sql (늘 ROLLBACK)
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 받는 사람 4명인 이력이 있으면 걸리지 않는다. 먼저 센다:
--   SELECT count(*) FROM public.tb_s050_handoff_logs WHERE cardinality(recipients) = 4;
-- -----------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE public.tb_s050_handoff_logs DROP CONSTRAINT IF EXISTS ck_s050_handoff_logs_recipients;
-- ALTER TABLE public.tb_s050_handoff_logs
--   ADD CONSTRAINT ck_s050_handoff_logs_recipients CHECK (cardinality(recipients) BETWEEN 1 AND 3);
-- COMMENT ON COLUMN public.tb_s050_handoff_logs.recipients IS '받는 사람 메일 — 세무 설정의 세무사 메일 가운데 고른 것(1~3).';
-- COMMIT;
