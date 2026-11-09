-- =============================================================================
-- 050_legal_org_articles_file.sql
--
-- 법무 회사별 정관 파일 — 기존 첨부 표 `tb_cm_file` 에 회사 세션 정책 하나를 더한다 (2026-11-07)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 사용자 결정(2026-11-07):
--   · 정관 파일은 회사(단체 org_id)별로 한 개 — 최종본만. 입주사 · 비입주사 모두. 법무 쪽에서 관리
--   · 저장은 ERP 기존 첨부 그대로 — 비공개 저장소(lib/storage.ts) + `tb_cm_file` 한 줄
--       target_type = 'LEGAL_ORG' · target_id = 단체 org_id(글자) · file_purpose = 'ARTICLES'
--     (target_type, target_id, file_purpose) 유일 인덱스(020)가 「회사당 한 개」를 DB 에서도 지킨다
--   · 바꾸면 이전 파일은 지운다(행 · 저장소 실물) — 이력 없음
--   · 회사 사람은 자기 단체 정관을 본다 · 회사 정보를 고칠 수 있는 사람은 올린다(판정은 앱 — 권한이 삐용에서 온다)
--
-- 그런데 `tb_cm_file` 은 020 의 정책(erp_files_operator_only) 하나라 회사 세션은 읽기 0건 · 쓰기 거절이다.
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① 정책 erp_files_legal_org_own 을 **더한다**(FOR ALL, permissive — 020 정책과 OR):
--        target_type = 'LEGAL_ORG' AND target_id = 세션 단체(erp_current_org_id()) 인 행만
--   ② 020 정책은 그대로 — 운영사는 전부. `COMPANY`(계약 서류 · 신분증) · `BUILDING` · `FLOOR` 첨부는 지금처럼 운영사만
--   ③ 표 · 인덱스 · 권한(erp_app)은 바꾸지 않는다. 자료도 넣지 않는다
--
-- 되돌리기:
--   DROP POLICY IF EXISTS erp_files_legal_org_own ON public.tb_cm_file;
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS erp_files_legal_org_own ON public.tb_cm_file;
CREATE POLICY erp_files_legal_org_own ON public.tb_cm_file
  FOR ALL
  USING (target_type = 'LEGAL_ORG' AND target_id = public.erp_current_org_id()::text)
  WITH CHECK (target_type = 'LEGAL_ORG' AND target_id = public.erp_current_org_id()::text);

COMMENT ON POLICY erp_files_legal_org_own ON public.tb_cm_file IS
  '법무 회사별 정관 파일(050) — 회사 세션은 자기 단체의 LEGAL_ORG 첨부만. 그 밖의 첨부는 erp_files_operator_only(운영사만)';

COMMIT;

-- =============================================================================
-- 검증 (적용 뒤 — erp_app 로 바꿔 본다)
-- =============================================================================
-- 1) 정책 둘                     SELECT policyname FROM pg_policies WHERE tablename = 'tb_cm_file' ORDER BY 1;
--                                  -- erp_files_legal_org_own · erp_files_operator_only
-- 2) 회사 세션은 COMPANY 0건      BEGIN; SET LOCAL ROLE erp_app;
--                                  SELECT set_config('app.current_role', 'tenant', true), set_config('app.current_org_id', '1344', true);
--                                  SELECT count(*) FROM public.tb_cm_file WHERE target_type = 'COMPANY';   -- 0
--                                  ROLLBACK;
-- 3) 회사 세션은 남의 단체 LEGAL_ORG 를 넣지 못한다(정책 위반 42501)
