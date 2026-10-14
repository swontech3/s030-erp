-- =============================================================================
-- 044_legal_meeting_time_resign_reason.sql
--
-- 법무 양식의 한글 자리표시 정리(2026-10-14) — 입력 칸 셋을 더한다. ★ 적용 전 승인 대기
--
--   · tb_s080_incorporations.meeting_time   — 개회시간 `HH:MM`(글자). 폐회시간은 저장하지 않는다
--                                            (개회 + 30분, shared `closingTimeOf`)
--   · tb_s080_incorporations.payment_bank   — 납입은행(지점)
--   · tb_s080_corp_change_officers.resign_reason — 임원 사임사유(구분이 사임일 때 화면이 보여 준다)
--
-- 셋 다 선택 입력이다 — NULL 을 허용하고 기본값을 두지 않는다. 개회시간 기본값(10:00)은 새 건의
-- 화면이 채워 둔다. 사임사유 기본 문구(「일신상의 사유」)는 화면이 채우고 출력이 비었을 때 쓴다.
-- 이미 있는 행은 NULL 로 남는다(서류는 빈칸 · 사임서는 기본 문구).
--
-- ★ 앱 코드(714bf50)가 이 칸들을 읽는다 — 적용 전에는 설립 상세 · 법인변경 임원 읽기가 실패한다.
-- ★ RLS(erp_org_scope)는 org_id 만 본다. 칸을 더해도 정책은 그대로다.
-- ★★ 레거시 S-WonERP(Prisma)는 이 칸을 모른다 — 칸을 더하는 것이라 레거시 읽기는 깨지지 않는다.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_incorporations
  ADD COLUMN meeting_time varchar(5),
  ADD COLUMN payment_bank text;

ALTER TABLE public.tb_s080_corp_change_officers
  ADD COLUMN resign_reason text;

COMMENT ON COLUMN public.tb_s080_incorporations.meeting_time IS
  '발기인총회 개회시간 HH:MM. 선택. 폐회시간은 저장하지 않는다(개회 + 30분). 044';
COMMENT ON COLUMN public.tb_s080_incorporations.payment_bank IS
  '납입은행(지점) — 조사보고서 · 주식인수증의 납입기관. 선택. 044';
COMMENT ON COLUMN public.tb_s080_corp_change_officers.resign_reason IS
  '임원 사임사유 — 사임서. 선택. 비면 출력이 기본 문구(일신상의 사유)를 쓴다. 044';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- SELECT table_name, column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND (table_name, column_name) IN (('tb_s080_incorporations', 'meeting_time'),
--                                      ('tb_s080_incorporations', 'payment_bank'),
--                                      ('tb_s080_corp_change_officers', 'resign_reason'));
-- -- 세 줄
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.tb_s080_incorporations DROP COLUMN meeting_time, DROP COLUMN payment_bank;
-- ALTER TABLE public.tb_s080_corp_change_officers DROP COLUMN resign_reason;
