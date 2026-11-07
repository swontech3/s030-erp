-- =============================================================================
-- 218_tax_handoff.sql
--
-- 세무(S05) 세무사 전달 서류(s050500010 · /tax/handoff, 1-9 · 2026-11-07 대표 지시 「답변 · 변경」)
--
--   ① 코드 분류 TAX_HANDOFF_TP  세무사 전달 종류 — T 부가세 납부 · M 원천세 납부. ★ 고정 코드
--      (화면 · API 가 T 만 동작시키고 M 은 「준비 중」으로 막는다 — 인사 시스템 뒤. 보낸 이력 CHECK 도 T · M 에 기댄다)
--   ② 표 tb_s050_handoff_logs   보낸 이력 — 보낸 때 · 종류 · 기간(첫날 · 끝날) · 받는 사람(1~3) · 파일 이름 · 줄 수(시트 아홉 합) ·
--      결과(성공 / 실패 사유) · 보낸 사람(삐용 회원 번호 + 보낼 때 읽은 이름)
--
-- ★ 결정(2026-11-07 대표):
--   - 메일은 서버(api)가 엑셀을 만들어 첨부해 보낸다(nodemailer · SMTP). 실패도 이력에 남긴다(사유와 함께)
--   - 보낸 사람은 번호 + 이름 두 칸 — 이름은 보낼 때 삐용에서 읽은 값, 못 읽으면 비운다(화면은 번호를 보인다)
--   - 받는 사람은 세무 설정의 세무사 메일(최대 3) 가운데 고른 것 — 그래서 1~3 개
-- ★ 이력은 고치거나 지우지 않는다 — erp_app 읽기 · 넣기만. FK 를 걸지 않는다(설정 · 파일이 지워져도 이력은 남는다).
-- ★ 코드 칸(handoff_tp)은 FK 를 걸지 않고 CHECK 로 고정한다(203 · 212 · 214 와 같다). `is_system` 은 쓰지 않는다(202 와 같이 false).
--
-- 하는 일 · 영향: 표 하나를 새로 만들고 코드 세 표에 줄을 더한다. 다른 표 · 칸 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(IF NOT EXISTS · ON CONFLICT DO NOTHING · 정책은 지우고 다시).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 — RLS 함수 · 세무 설정(201)이 있어야 하고, 같은 이름의 분류가 다른 줄로 있으면 멈춘다
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regprocedure('public.erp_current_org_id()') IS NULL
     OR to_regprocedure('public.erp_is_operator()') IS NULL THEN
    RAISE EXCEPTION '218 — erp_current_org_id() · erp_is_operator() 가 없다. 003 · 037 을 먼저 적용할 것';
  END IF;
  IF to_regclass('public.tb_s050_settings') IS NULL THEN
    RAISE EXCEPTION '218 — 세무 설정 표가 없다. 201 을 먼저 적용할 것';
  END IF;
  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1' AND category = 'TAX_HANDOFF_TP'
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '218 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 코드 — TAX_HANDOFF_TP(세무사 전달 종류, 고정 코드)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES
  ('cm_1_TAX_HANDOFF_TP', '1', 'TAX_HANDOFF_TP', '세무사 전달 종류',
   '세무(S05) 세무사 전달 서류의 종류. ★ 고정 코드 — 화면 · API 가 T(부가세 납부)만 동작시키고 M(원천세 납부)은 「준비 중」으로 막는다. 보낸 이력 CHECK 가 T · M 에 기댄다',
   false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES
  ('cc_1_TAX_HANDOFF_TP_000', '1', 'TAX_HANDOFF_TP', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_HANDOFF_TP_T', '1', 'TAX_HANDOFF_TP', 'T', '부가세 납부', '부가세 신고 기간의 자료를 세무사에게 보낸다', '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_HANDOFF_TP_M', '1', 'TAX_HANDOFF_TP', 'M', '원천세 납부', '준비 중 — 인사 시스템 뒤', '000', 2, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 보낸 이력
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_s050_handoff_logs (
  id           text PRIMARY KEY,
  org_id       integer NOT NULL,
  handoff_tp   varchar(10) NOT NULL CONSTRAINT ck_s050_handoff_logs_tp CHECK (handoff_tp IN ('T', 'M')),
  period_from  date NOT NULL CONSTRAINT ck_s050_handoff_logs_from CHECK (EXTRACT(DAY FROM period_from) = 1),
  period_to    date NOT NULL,
  recipients   text[] NOT NULL CONSTRAINT ck_s050_handoff_logs_recipients CHECK (cardinality(recipients) BETWEEN 1 AND 3),
  file_name    varchar(255) NOT NULL CONSTRAINT ck_s050_handoff_logs_file_name CHECK (btrim(file_name) <> ''),
  row_count    integer NOT NULL CONSTRAINT ck_s050_handoff_logs_rows CHECK (row_count >= 0),
  ok           boolean NOT NULL,
  fail_reason  varchar(500),
  sent_by      text NOT NULL,
  sent_by_name varchar(100),
  sent_at      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_s050_handoff_logs_period CHECK (period_to >= period_from),
  CONSTRAINT ck_s050_handoff_logs_result CHECK (ok = (fail_reason IS NULL))
);

COMMENT ON TABLE public.tb_s050_handoff_logs IS
  '세무(S05) 세무사 전달 서류 보낸 이력 — 메일 한 번 = 한 줄(실패도). 고치거나 지우지 않는다. FK 없음(설정 · 파일이 지워져도 남는다).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_handoff_logs.handoff_tp IS '종류 — 코드 TAX_HANDOFF_TP(000) 코드값. T 부가세 납부 · M 원천세 납부(준비 중).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.period_from IS '보낸 자료의 첫날(달 첫날).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.period_to IS '보낸 자료의 끝날 — 부가세는 신고 기간 끝과 작업할 달 끝 중 이른 날(부가세 조회와 같은 범위).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.recipients IS '받는 사람 메일 — 세무 설정의 세무사 메일 가운데 고른 것(1~3).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.file_name IS '첨부 엑셀 파일 이름 — 예: 세무자료_부가세_2026년3분기.xlsx.';
COMMENT ON COLUMN public.tb_s050_handoff_logs.row_count IS '엑셀 시트 아홉의 줄 수 합(제목 줄 뺌).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.ok IS '결과 — true 성공 · false 실패.';
COMMENT ON COLUMN public.tb_s050_handoff_logs.fail_reason IS '실패 사유 — 실패일 때만 채운다(CHECK).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.sent_by IS '보낸 사람 — 삐용 회원 번호(memberId).';
COMMENT ON COLUMN public.tb_s050_handoff_logs.sent_by_name IS '보낸 사람 이름 — 보낼 때 삐용에서 읽은 값. 못 읽으면 비운다.';
COMMENT ON COLUMN public.tb_s050_handoff_logs.sent_at IS '보낸 때.';

CREATE INDEX IF NOT EXISTS ix_s050_handoff_logs_org_sent ON public.tb_s050_handoff_logs (org_id, sent_at DESC);

-- -----------------------------------------------------------------------------
-- 3. RLS — 운영사는 전부, 회사는 자기 단체만 (203 · 214 와 같은 정책)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_handoff_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s050_handoff_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_org_scope ON public.tb_s050_handoff_logs;
CREATE POLICY erp_org_scope ON public.tb_s050_handoff_logs FOR ALL
  USING (public.erp_is_operator() OR org_id = public.erp_current_org_id())
  WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id());

-- -----------------------------------------------------------------------------
-- 4. 권한 — 기본 권한이 붙였을 수 있는 것을 먼저 거둔 뒤 준다(214 와 같다). 읽기 · 넣기만
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tb_s050_handoff_logs FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT, INSERT ON public.tb_s050_handoff_logs TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-218.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-218.js .env packages/api/.env --dry-run supabase/migrations/218_tax_handoff.sql (늘 ROLLBACK)
--   그다음 npm run verify:codes (선언표에 쓰임 1줄 · 고정 코드 1줄) · node scripts/check-grants.js .env
-- =============================================================================
-- SELECT code, name, sort_order FROM public.tb_s080_codes_line WHERE category = 'TAX_HANDOFF_TP' ORDER BY sort_order;   -- T · M
-- SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tb_s050_handoff_logs';                       -- t, t
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 보낸 이력이 함께 지워진다. 먼저 센다: SELECT count(*) FROM public.tb_s050_handoff_logs;
--   ★ 앱(code-usage.ts 의 TAX_HANDOFF_TP 쓰임 · 고정 코드)을 먼저 내린다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS public.tb_s050_handoff_logs;
-- DELETE FROM public.tb_s080_codes_line      WHERE category = 'TAX_HANDOFF_TP';
-- DELETE FROM public.tb_s080_code_categories WHERE category = 'TAX_HANDOFF_TP';
-- DELETE FROM public.tb_s080_code_masters    WHERE category = 'TAX_HANDOFF_TP';
-- COMMIT;
