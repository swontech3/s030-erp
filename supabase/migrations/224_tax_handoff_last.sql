-- =============================================================================
-- 224_tax_handoff_last.sql
--
-- 세무(S05) 세무사 전달 서류 — 보낸 이력 → 최종 발송 한 줄(2026-11-08 대표 지시 ⑧)
--
--   ① 새 표 tb_s050_handoff_last   단체 · 종류 · 신고 기간마다 최종 발송 한 줄 — 보낸 때 · 받는 사람 · 참조 · 파일 이름 ·
--                                   보낸 사람(삐용 회원 번호 + 보낼 때 읽은 이름). 성공할 때만 덮어쓴다(실패는 남기지 않는다)
--   ② 옮기기 — 218 · 219 의 보낸 이력(tb_s050_handoff_logs)에서 단체 · 종류 · 기간마다 마지막 **성공** 한 줄만 옮긴다
--   ③ 지우기 — 보낸 이력 표 tb_s050_handoff_logs
--
-- ★ 결정(2026-11-08 대표): 이력은 남기지 않는다. 실패는 저장하지 않고 화면 알림만.
-- ★ 기간은 신고 기간 ID(`2026-Q3` 법인 분기 · `2026-H2` 개인 반기) — 화면 · API 의 `period` 그대로.
--   옛 이력은 기간 ID 칸이 없어 기간 첫날 · 끝날 · 세무 설정의 사업자 유형으로 찾는다:
--     첫 달 4 · 10 월 → 분기 / 끝날이 첫 달 + 3달 이상 → 반기 / 첫 달 1 · 7 월이면 사업자 유형 I 개인 → 반기, 그 밖 → 분기
--   (첫 달이 분기 · 반기 첫 달이 아니면 스스로 멈춘다)
-- ★ 덮어쓰기는 INSERT … ON CONFLICT DO UPDATE — erp_app 에 읽기 · 넣기 + 덮어쓰는 칸만 UPDATE(키 칸 · 단체는 못 고친다). 지우기 없음.
-- ★ 코드 칸(handoff_tp)은 218 과 같이 FK 없이 CHECK 로 고정한다(T · M). FK 를 걸지 않는다(설정이 지워져도 남는다).
--
-- 하는 일 · 영향: 표 하나를 새로 만들고, 옛 이력 표의 성공 줄을 옮긴 뒤 옛 표를 지운다. 코드 표 · 다른 표 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(IF NOT EXISTS · 옛 표가 없으면 옮기기를 건너뜀 · 정책은 지우고 다시).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 — RLS 함수 · 세무 설정(201) · 코드 TAX_HANDOFF_TP(218)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.erp_current_org_id()') IS NULL
     OR to_regprocedure('public.erp_is_operator()') IS NULL THEN
    RAISE EXCEPTION '224 — erp_current_org_id() · erp_is_operator() 가 없다. 003 · 037 을 먼저 적용할 것';
  END IF;
  IF to_regclass('public.tb_s050_settings') IS NULL THEN
    RAISE EXCEPTION '224 — 세무 설정 표가 없다. 201 을 먼저 적용할 것';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tb_s080_codes_line WHERE build_id = '1' AND category = 'TAX_HANDOFF_TP') THEN
    RAISE EXCEPTION '224 — 코드 TAX_HANDOFF_TP 가 없다. 218 을 먼저 적용할 것';
  END IF;
  IF to_regclass('public.tb_s050_handoff_logs') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.tb_s050_handoff_logs
        WHERE ok AND EXTRACT(MONTH FROM period_from) NOT IN (1, 4, 7, 10)) THEN
    RAISE EXCEPTION '224 — 기간 첫 달이 분기 · 반기 첫 달이 아닌 성공 이력이 있다. 먼저 확인할 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 최종 발송
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tb_s050_handoff_last (
  org_id       integer NOT NULL,
  handoff_tp   varchar(10) NOT NULL CONSTRAINT ck_s050_handoff_last_tp CHECK (handoff_tp IN ('T', 'M')),
  period_id    varchar(7) NOT NULL CONSTRAINT ck_s050_handoff_last_period CHECK (period_id ~ '^\d{4}-(Q[1-4]|H[12])$'),
  sent_at      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recipients   text[] NOT NULL CONSTRAINT ck_s050_handoff_last_recipients CHECK (cardinality(recipients) BETWEEN 1 AND 4),
  cc           varchar(320),
  file_name    varchar(255) NOT NULL CONSTRAINT ck_s050_handoff_last_file_name CHECK (btrim(file_name) <> ''),
  sent_by      text NOT NULL,
  sent_by_name varchar(100),
  CONSTRAINT pk_s050_handoff_last PRIMARY KEY (org_id, handoff_tp, period_id),
  CONSTRAINT ck_s050_handoff_last_cc CHECK (cc IS NULL OR btrim(cc) <> '')
);

COMMENT ON TABLE public.tb_s050_handoff_last IS
  '세무(S05) 세무사 전달 서류 최종 발송 — 단체 · 종류 · 신고 기간마다 한 줄. 성공할 때만 덮어쓴다(실패는 남기지 않는다). 224 가 218 보낸 이력을 바꿈. FK 없음.';
COMMENT ON COLUMN public.tb_s050_handoff_last.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_handoff_last.handoff_tp IS '종류 — 코드 TAX_HANDOFF_TP(000) 코드값. T 부가세 납부 · M 원천세 납부(준비 중).';
COMMENT ON COLUMN public.tb_s050_handoff_last.period_id IS '신고 기간 ID — 2026-Q3(법인 분기) · 2026-H2(개인 반기). 화면 · API 의 period 그대로.';
COMMENT ON COLUMN public.tb_s050_handoff_last.sent_at IS '최종 발송 때(성공).';
COMMENT ON COLUMN public.tb_s050_handoff_last.recipients IS '받는 사람 메일 — 세무 설정의 세무사 메일 가운데 고른 것(1~4).';
COMMENT ON COLUMN public.tb_s050_handoff_last.cc IS '참조 메일 — 보낸 사람이 대표자가 아니면 대표자(서버가 정한다). 없으면 비운다.';
COMMENT ON COLUMN public.tb_s050_handoff_last.file_name IS '첨부 엑셀 파일 이름 — 예: 세무자료_부가세_2026년3분기.xlsx.';
COMMENT ON COLUMN public.tb_s050_handoff_last.sent_by IS '보낸 사람 — 삐용 회원 번호(memberId).';
COMMENT ON COLUMN public.tb_s050_handoff_last.sent_by_name IS '보낸 사람 이름 — 보낼 때 삐용에서 읽은 값. 못 읽으면 비운다.';

-- -----------------------------------------------------------------------------
-- 2. 옮기기 — 옛 보낸 이력의 마지막 성공 한 줄(단체 · 종류 · 기간마다). 옛 표가 없으면 건너뛴다
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.tb_s050_handoff_logs') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.tb_s050_handoff_last (org_id, handoff_tp, period_id, sent_at, recipients, cc, file_name, sent_by, sent_by_name)
  SELECT DISTINCT ON (x.org_id, x.handoff_tp, x.period_id)
         x.org_id, x.handoff_tp, x.period_id, x.sent_at, x.recipients, NULL, x.file_name, x.sent_by, x.sent_by_name
    FROM (
      SELECT l.*,
             to_char(l.period_from, 'YYYY') || '-' ||
             CASE
               WHEN EXTRACT(MONTH FROM l.period_from) IN (4, 10) THEN 'Q' || ((EXTRACT(MONTH FROM l.period_from)::int + 2) / 3)
               WHEN l.period_to >= (l.period_from + interval '3 months')::date
                    OR s.biz_type = 'I' THEN 'H' || CASE WHEN EXTRACT(MONTH FROM l.period_from) = 1 THEN '1' ELSE '2' END
               ELSE 'Q' || ((EXTRACT(MONTH FROM l.period_from)::int + 2) / 3)
             END AS period_id
        FROM public.tb_s050_handoff_logs l
        LEFT JOIN public.tb_s050_settings s ON s.org_id = l.org_id
       WHERE l.ok
    ) x
   ORDER BY x.org_id, x.handoff_tp, x.period_id, x.sent_at DESC, x.id DESC
  ON CONFLICT (org_id, handoff_tp, period_id) DO NOTHING;
END $$;

-- -----------------------------------------------------------------------------
-- 3. 지우기 — 옛 보낸 이력 표
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.tb_s050_handoff_logs;

-- -----------------------------------------------------------------------------
-- 4. RLS — 운영사는 전부, 회사는 자기 단체만 (218 과 같은 정책)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s050_handoff_last ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s050_handoff_last FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_org_scope ON public.tb_s050_handoff_last;
CREATE POLICY erp_org_scope ON public.tb_s050_handoff_last FOR ALL
  USING (public.erp_is_operator() OR org_id = public.erp_current_org_id())
  WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id());

-- -----------------------------------------------------------------------------
-- 5. 권한 — 기본 권한이 붙였을 수 있는 것을 먼저 거둔 뒤 준다. 읽기 · 넣기 + 덮어쓰는 칸만 UPDATE · 지우기 없음
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tb_s050_handoff_last FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT, INSERT ON public.tb_s050_handoff_last TO erp_app;
GRANT UPDATE (sent_at, recipients, cc, file_name, sent_by, sent_by_name) ON public.tb_s050_handoff_last TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — node scripts/verify-224.js .env packages/api/.env
--   적용 전 시험: node scripts/verify-224.js .env packages/api/.env --dry-run supabase/migrations/224_tax_handoff_last.sql (늘 ROLLBACK)
--   그다음 npm run verify:codes (쓰임 표 이름이 tb_s050_handoff_last 로) · node scripts/check-grants.js .env · npm run verify:tax-handoff
-- =============================================================================
-- SELECT org_id, handoff_tp, period_id, sent_at FROM public.tb_s050_handoff_last ORDER BY org_id, period_id;
-- SELECT to_regclass('public.tb_s050_handoff_logs');                                                       -- NULL
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 지운 이력(실패 줄 · 마지막 아닌 성공 줄)은 돌아오지 않는다. 218 · 219 의 표를 빈 채로 다시 만들고
--   최종 발송 줄을 성공 이력으로 옮긴다. ★ 앱(tb_s050_handoff_last 를 읽는 화면 · API)을 먼저 내린다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- (218 의 「2. 보낸 이력」 · 「3. RLS」 · 「4. 권한」 과 219 의 CHECK 를 그대로 돌린다)
-- INSERT INTO public.tb_s050_handoff_logs (id, org_id, handoff_tp, period_from, period_to, recipients, file_name, row_count, ok, sent_by, sent_by_name, sent_at)
--   SELECT gen_random_uuid()::text, org_id, handoff_tp,
--          (left(period_id, 4) || '-' || lpad(CASE WHEN period_id LIKE '%H1' THEN '1' WHEN period_id LIKE '%H2' THEN '7'
--             ELSE ((right(period_id, 1)::int - 1) * 3 + 1)::text END, 2, '0') || '-01')::date,
--          (left(period_id, 4) || '-' || lpad(CASE WHEN period_id LIKE '%H1' THEN '6' WHEN period_id LIKE '%H2' THEN '12'
--             ELSE (right(period_id, 1)::int * 3)::text END, 2, '0') || '-01')::date + interval '1 month' - interval '1 day',
--          recipients, file_name, 0, true, sent_by, sent_by_name, sent_at
--     FROM public.tb_s050_handoff_last;
-- DROP TABLE public.tb_s050_handoff_last;
-- COMMIT;
