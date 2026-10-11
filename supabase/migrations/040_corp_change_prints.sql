-- =============================================================================
-- 040_corp_change_prints.sql
--
-- 법인변경 서류 출력 이력 — [인쇄] 를 누를 때마다 한 줄 (5-4, 2026-10-11, 승인 2026-10-11)
--
-- -----------------------------------------------------------------------------
-- 무엇을 남기나
-- -----------------------------------------------------------------------------
--   · 어느 건(corp_change_id) · 어느 서류(form_id + 그때의 양식 이름 form_name) ·
--     임원마다 서류면 어느 임원의 장(officer_name)
--   · 서류에 넣은 신청일 · 작성일(apply_date · write_date)
--   · 누가(printed_by = 삐용 회원 ID · printed_role = operator/tenant) · 언제(printed_at)
--
-- ★★★ 주민번호 칸이 없다 — 평문 · 암호문 · 마스킹 모두(Q4: 출력값은 저장 · 로그 금지).
--     서류의 다른 값(회사명 · 주소 · 세금 …)도 남기지 않는다 — 그 값은 작성완료 스냅샷에 있다.
-- ★★ 「인쇄 창을 연」 기록이다. 브라우저 인쇄 창에서 [취소] 했는지는 알 수 없다.
-- ★★ **FK 가 하나도 없다**(결정 2026-10-11):
--    · 건을 지워도 이력은 남는다 — corp_change_id 는 지워진 건의 id 를 그대로 들고 있다
--    · 양식을 지워도(법무 표시를 뗀 뒤) 남는다 — 이름은 form_name 이 들고 있다
--    그래서 org_id 는 **앱이 RLS 를 통과한 건에서 꺼내 넣는다**(화면이 준 값을 쓰지 않는다).
--    RLS 의 WITH CHECK 가 「남의 단체로 넣기」를 한 번 더 막는다.
-- ★ 기록이 실패해도 인쇄는 막지 않는다(결정 2026-10-11) — 실패는 서버 로그에만 남는다.
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① 새 표 tb_s080_corp_change_prints 만 만든다. **기존 표 · 칸 · 자료는 건드리지 않는다**
--   ② FK 없음(위 ★★)
--   ③ RLS — 037 과 같은 정책(erp_org_scope): 운영사 전부 · 회사는 자기 단체 줄만. FORCE
--   ④ erp_app 에는 읽기 · 넣기만 — 고치기 · 지우기는 없다(이력은 덧붙이기만)
--
-- 되돌리기: DROP TABLE public.tb_s080_corp_change_prints;
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_s080_corp_change_prints (
  id             text PRIMARY KEY,
  corp_change_id text NOT NULL,
  org_id         integer NOT NULL,
  form_id        text NOT NULL,
  form_name      text NOT NULL,
  officer_name   text,
  apply_date     date,
  write_date     date,
  printed_by     text NOT NULL,
  printed_role   text NOT NULL CHECK (printed_role IN ('operator', 'tenant')),
  printed_at     timestamp NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tb_s080_corp_change_prints IS
  '법인변경 서류 출력 이력(040) — [인쇄] 를 누를 때마다 한 줄. 주민번호 · 서류 값은 남기지 않는다.';
COMMENT ON COLUMN public.tb_s080_corp_change_prints.corp_change_id IS '법인변경 건 id — FK 없음. 건을 지워도 이력은 남는다(040).';
COMMENT ON COLUMN public.tb_s080_corp_change_prints.form_name IS '인쇄할 때의 양식 이름(양식을 지워도 남는다).';
COMMENT ON COLUMN public.tb_s080_corp_change_prints.officer_name IS '임원마다 서류의 장이면 그 임원 이름, 건마다 서류면 NULL.';
COMMENT ON COLUMN public.tb_s080_corp_change_prints.printed_by IS '삐용 회원 ID(s020MemberId).';

CREATE INDEX IF NOT EXISTS ix_s080_corp_change_prints_change
  ON public.tb_s080_corp_change_prints (corp_change_id, printed_at DESC);

ALTER TABLE public.tb_s080_corp_change_prints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tb_s080_corp_change_prints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_org_scope ON public.tb_s080_corp_change_prints;
CREATE POLICY erp_org_scope ON public.tb_s080_corp_change_prints FOR ALL
  USING (public.erp_is_operator() OR org_id = public.erp_current_org_id())
  WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id());

-- ★ 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 둘만 준다.
REVOKE ALL ON public.tb_s080_corp_change_prints FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT, INSERT ON public.tb_s080_corp_change_prints TO erp_app;

COMMIT;

-- =============================================================================
-- 검증(적용 뒤)
-- =============================================================================
-- SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tb_s080_corp_change_prints';  -- t, t
-- SELECT privilege_type FROM information_schema.role_table_grants
--  WHERE grantee = 'erp_app' AND table_name = 'tb_s080_corp_change_prints';                             -- SELECT, INSERT
-- SELECT count(*) FROM public.tb_s080_corp_change_prints;                                                -- 0
