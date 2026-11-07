-- =============================================================================
-- 220_tax_vendor_closed.sql
--
-- 세무(S05) 거래처 종료 여부 칸 (2026-11-07 대표 수정 ③ 거래처)
--
--   tb_s050_vendors.is_closed  boolean NOT NULL DEFAULT false — false 거래 중 · true 종료
--
-- ★ 거래처 화면의 [거래종료] · [수정] 팝업 「거래 중 / 거래 종료」가 바꾸고, 검색 조건 「종료여부」(처음 값 거래 중)가 거른다.
-- ★ 표시 · 거르기만 한다 — 자료 올리기의 거래처 자동 등록 · 연결 규칙은 바꾸지 않는다(종료된 거래처에 새 자료가 붙어도 그대로 둔다).
-- ★ 거래처 합치기 · 지우기는 화면 · API 에서 없앴다(같은 날). 표 · FK · 권한은 그대로 둔다 — erp_app 의 표 단위 UPDATE(203)로 새 칸도 고친다.
-- ★ 하는 일 · 영향: 칸 하나를 더한다(있는 거래처는 모두 기본값 false = 거래 중). 다른 표 · 칸 · 권한은 바꾸지 않는다. 다시 돌려도 같은 결과다.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tb_s050_vendors') IS NULL THEN
    RAISE EXCEPTION '220 — 거래처 표가 없다. 203 을 먼저 적용할 것';
  END IF;
END $$;

ALTER TABLE public.tb_s050_vendors ADD COLUMN IF NOT EXISTS is_closed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tb_s050_vendors.is_closed IS
  '종료 여부 — false 거래 중 · true 종료(2026-11-07). 거래처 화면에서 표시 · 거르기만 한다. 자료 올리기의 자동 등록 · 연결은 이 값을 보지 않는다.';

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-220.js .env packages/api/.env (6항목) · node scripts/verify-203.js .env packages/api/.env(거래처 칸 목록에 is_closed)
--   적용 전 시험: node scripts/verify-220.js .env packages/api/.env --dry-run supabase/migrations/220_tax_vendor_closed.sql (늘 ROLLBACK)
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 종료로 바꾼 표시가 사라진다. 먼저 센다: SELECT count(*) FROM public.tb_s050_vendors WHERE is_closed;
--   ★ 앱(거래처 화면 · API 의 is_closed)을 먼저 내린다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE public.tb_s050_vendors DROP COLUMN IF EXISTS is_closed;
-- COMMIT;
