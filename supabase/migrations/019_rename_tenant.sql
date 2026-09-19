-- =============================================================================
-- 019_rename_tenant.sql   (← 원래 004_rename_tenant.sql. 2026-09-19 번호 이동)
--
-- tenant_id → operator_id 개명 + 타입 통일(text→int) + FK 부여. 9개 테이블.
--
-- -----------------------------------------------------------------------------
-- ★ 번호가 004 에서 019 로 바뀐 이유
-- -----------------------------------------------------------------------------
-- 이 파일은 `migrations_hold/` 에서 오래 보류됐고, 그동안 005~018 이 붙었다.
-- 004 자리로 되돌리면 적용 순서와 파일 이름이 어긋난다. 내용은 그대로다.
--
-- -----------------------------------------------------------------------------
-- ★★ 보류 사유가 해소됐다 (2026-09-19)
-- -----------------------------------------------------------------------------
-- 원래 경고는 «기존 앱(S-WonERP)이 즉시 깨진다 — 앱 코드와 같은 배포 창에서
-- 적용하라»였다. **그 전제가 더 이상 맞지 않는다:**
--
--   · 레거시 S-WonERP 는 **쓰이지 않는다**(`doc/LEGACY_DATA_SURVEY.md` 머리말).
--     세울 앱이 없으므로 정지 창이 필요 없다.
--   · 새 앱(`packages/`)은 이 컬럼들을 **한 번도 만지지 않는다** —
--     `tenant_id` · `tenantId` · `tenant010` · `operator_id` 전부 **0건**.
--   · 고칠 코드는 `scripts/verify-001-003.js` **3줄**뿐이다(tenant010 에
--     INSERT 하고 PK 를 되받는 자리).
--
-- 레거시를 되살릴 계획이 생기면 그 저장소(`S-WonERP/S-WonERP`, 자체 git)의
-- `prisma/schema.prisma` 에서 `@map("tenant_id")` **10곳**을
-- `@map("operator_id")` 로 바꿔야 한다. Prisma 필드명 `tenantId` 는 그대로 둬도
-- 된다 — 앱 코드는 안 바뀐다.
--
-- -----------------------------------------------------------------------------
-- ★★★ 되돌리기 — 이 파일에는 롤백 스크립트가 없다
-- -----------------------------------------------------------------------------
-- 하단 ROLLBACK 절은 골격 주석뿐이다(«지면상 반복 생략»). 컬럼 이름과 타입이
-- 동시에 바뀌므로 **백업 복원이 유일한 복구 수단**이다.
--   적용 직전 백업: C:\Users\Swontech\swonbiz-db-backup\public-20260919-231028-pre004gate.sql
--
-- ★ public."User" 테이블은 대상에서 제외한다 — AUTH-01(ERP 전용 계정
-- 미발급)에 따라 폐기 대상이라 개명 비용을 들이지 않는다(BACKEND_ANALYSIS.md
-- §4-1). tenant_id(int, FK)를 그대로 둔 채 앱 전환 완료 후 테이블째 지운다.
--
-- ★ 이 파일은 "개명 + 타입 통일"만 요청받았으나, FK 부여를 함께 넣는다
-- (SCHEMA_ANALYSIS.md C8이 애초에 "타입 통일 + FK 부여"를 한 항목으로
-- 묶었다 — 타입만 맞추고 FK가 없으면 오타가 여전히 조용히 통과한다).
-- 원치 않으면 각 섹션의 FK 추가 줄만 제거하고 적용할 수 있다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. tb_s080_tenant010 — PK 컬럼 (int, 타입 변경 불필요, rename만)
-- -----------------------------------------------------------------------------
-- Postgres는 RENAME COLUMN 시 참조 중인 FK 제약을 자동으로 따라간다
-- (제약 재생성 불필요). 시퀀스·PK 이름은 바꾸지 않는다(범위 밖).

ALTER TABLE public.tb_s080_tenant010 RENAME COLUMN tenant_id TO operator_id;

-- -----------------------------------------------------------------------------
-- 2. tb_s080_buildings — int FK, rename만
-- -----------------------------------------------------------------------------

ALTER TABLE public.tb_s080_buildings RENAME COLUMN tenant_id TO operator_id;
-- FK tb_s080_buildings_tenant_id_fkey는 이름은 그대로지만 대상 컬럼은
-- 자동으로 operator_id를 가리킨다. 이름까지 정리하려면:
ALTER TABLE public.tb_s080_buildings
  RENAME CONSTRAINT tb_s080_buildings_tenant_id_fkey TO tb_s080_buildings_operator_id_fkey;

ALTER INDEX public.tb_s080_buildings_tenant_id_idx RENAME TO tb_s080_buildings_operator_id_idx;

-- -----------------------------------------------------------------------------
-- 3. tb_cm_file — text → int (FK 없음, 단순 컬럼 하나)
-- -----------------------------------------------------------------------------
-- 데이터는 전부 '1'(개발 운영사 하나뿐, SCHEMA_ANALYSIS.md §6.2) — 안전한 캐스팅.

ALTER TABLE public.tb_cm_file ADD COLUMN operator_id integer;
UPDATE public.tb_cm_file SET operator_id = tenant_id::integer;
ALTER TABLE public.tb_cm_file ALTER COLUMN operator_id SET NOT NULL;
ALTER TABLE public.tb_cm_file DROP COLUMN tenant_id;
ALTER TABLE public.tb_cm_file
  ADD CONSTRAINT tb_cm_file_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.tb_s080_tenant010(operator_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- -----------------------------------------------------------------------------
-- 4. tb_s080_departments — text → int + 복합 UNIQUE 1건 + 인덱스 1건
-- -----------------------------------------------------------------------------

ALTER TABLE public.tb_s080_departments ADD COLUMN operator_id integer;
UPDATE public.tb_s080_departments SET operator_id = tenant_id::integer;
ALTER TABLE public.tb_s080_departments ALTER COLUMN operator_id SET NOT NULL;

DROP INDEX IF EXISTS public.tb_s080_departments_tenant_id_dept_code_key;
DROP INDEX IF EXISTS public.tb_s080_departments_tenant_id_idx;

ALTER TABLE public.tb_s080_departments DROP COLUMN tenant_id;
ALTER TABLE public.tb_s080_departments
  ADD CONSTRAINT tb_s080_departments_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.tb_s080_tenant010(operator_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE UNIQUE INDEX tb_s080_departments_operator_id_dept_code_key
  ON public.tb_s080_departments USING btree (operator_id, dept_code);
CREATE INDEX tb_s080_departments_operator_id_idx
  ON public.tb_s080_departments USING btree (operator_id);

-- -----------------------------------------------------------------------------
-- 5. tb_s080_employees — text → int + 복합 UNIQUE 2건 + 인덱스 2건
-- -----------------------------------------------------------------------------

ALTER TABLE public.tb_s080_employees ADD COLUMN operator_id integer;
UPDATE public.tb_s080_employees SET operator_id = tenant_id::integer;
ALTER TABLE public.tb_s080_employees ALTER COLUMN operator_id SET NOT NULL;

DROP INDEX IF EXISTS public.tb_s080_employees_tenant_id_email_key;
DROP INDEX IF EXISTS public.tb_s080_employees_tenant_id_emp_no_key;
DROP INDEX IF EXISTS public.tb_s080_employees_tenant_id_emp_status_is_active_idx;
DROP INDEX IF EXISTS public.tb_s080_employees_tenant_id_idx;

ALTER TABLE public.tb_s080_employees DROP COLUMN tenant_id;
ALTER TABLE public.tb_s080_employees
  ADD CONSTRAINT tb_s080_employees_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.tb_s080_tenant010(operator_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE UNIQUE INDEX tb_s080_employees_operator_id_email_key
  ON public.tb_s080_employees USING btree (operator_id, email);
CREATE UNIQUE INDEX tb_s080_employees_operator_id_emp_no_key
  ON public.tb_s080_employees USING btree (operator_id, emp_no);
CREATE INDEX tb_s080_employees_operator_id_emp_status_is_active_idx
  ON public.tb_s080_employees USING btree (operator_id, emp_status, is_active);
CREATE INDEX tb_s080_employees_operator_id_idx
  ON public.tb_s080_employees USING btree (operator_id);

-- -----------------------------------------------------------------------------
-- 6. tb_s080_incorporations — text → int + 복합 인덱스 1건 ([A] 재사용 영역이나
--    tenant_id 컬럼 자체는 함께 개명한다 — 반쪽만 두면 나중에 더 헷갈린다)
-- -----------------------------------------------------------------------------

ALTER TABLE public.tb_s080_incorporations ADD COLUMN operator_id integer;
UPDATE public.tb_s080_incorporations SET operator_id = tenant_id::integer;
ALTER TABLE public.tb_s080_incorporations ALTER COLUMN operator_id SET NOT NULL;

DROP INDEX IF EXISTS public.tb_s080_incorporations_tenant_id_company_id_idx;

ALTER TABLE public.tb_s080_incorporations DROP COLUMN tenant_id;
ALTER TABLE public.tb_s080_incorporations
  ADD CONSTRAINT tb_s080_incorporations_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.tb_s080_tenant010(operator_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX tb_s080_incorporations_operator_id_company_id_idx
  ON public.tb_s080_incorporations USING btree (operator_id, company_id);

-- -----------------------------------------------------------------------------
-- 7. tb_s080_corp_changes — text → int + 복합 인덱스 1건
-- -----------------------------------------------------------------------------

ALTER TABLE public.tb_s080_corp_changes ADD COLUMN operator_id integer;
UPDATE public.tb_s080_corp_changes SET operator_id = tenant_id::integer;
ALTER TABLE public.tb_s080_corp_changes ALTER COLUMN operator_id SET NOT NULL;

DROP INDEX IF EXISTS public.tb_s080_corp_changes_tenant_id_company_id_idx;

ALTER TABLE public.tb_s080_corp_changes DROP COLUMN tenant_id;
ALTER TABLE public.tb_s080_corp_changes
  ADD CONSTRAINT tb_s080_corp_changes_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.tb_s080_tenant010(operator_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX tb_s080_corp_changes_operator_id_company_id_idx
  ON public.tb_s080_corp_changes USING btree (operator_id, company_id);

-- -----------------------------------------------------------------------------
-- 8. tb_s080_form_templates — text → int + 인덱스 1건
-- -----------------------------------------------------------------------------

ALTER TABLE public.tb_s080_form_templates ADD COLUMN operator_id integer;
UPDATE public.tb_s080_form_templates SET operator_id = tenant_id::integer;
ALTER TABLE public.tb_s080_form_templates ALTER COLUMN operator_id SET NOT NULL;

DROP INDEX IF EXISTS public.tb_s080_form_templates_tenant_id_idx;

ALTER TABLE public.tb_s080_form_templates DROP COLUMN tenant_id;
ALTER TABLE public.tb_s080_form_templates
  ADD CONSTRAINT tb_s080_form_templates_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.tb_s080_tenant010(operator_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX tb_s080_form_templates_operator_id_idx
  ON public.tb_s080_form_templates USING btree (operator_id);

-- -----------------------------------------------------------------------------
-- 9. tb_s080_doc_form_settings — text → int + 복합 UNIQUE 1건 + 복합 인덱스 1건
-- -----------------------------------------------------------------------------

ALTER TABLE public.tb_s080_doc_form_settings ADD COLUMN operator_id integer;
UPDATE public.tb_s080_doc_form_settings SET operator_id = tenant_id::integer;
ALTER TABLE public.tb_s080_doc_form_settings ALTER COLUMN operator_id SET NOT NULL;

DROP INDEX IF EXISTS public.tb_s080_doc_form_settings_tenant_id_domain_idx;
DROP INDEX IF EXISTS public.tb_s080_doc_form_settings_tenant_id_domain_reg_type_key_com_key;

ALTER TABLE public.tb_s080_doc_form_settings DROP COLUMN tenant_id;
ALTER TABLE public.tb_s080_doc_form_settings
  ADD CONSTRAINT tb_s080_doc_form_settings_operator_id_fkey
  FOREIGN KEY (operator_id) REFERENCES public.tb_s080_tenant010(operator_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX tb_s080_doc_form_settings_operator_id_domain_idx
  ON public.tb_s080_doc_form_settings USING btree (operator_id, domain);
CREATE UNIQUE INDEX tb_s080_doc_form_settings_operator_id_domain_reg_type_key_com_key
  ON public.tb_s080_doc_form_settings USING btree (operator_id, domain, reg_type_key, company_type);

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- node scripts/rowcounts.js .env
-- node scripts/inspect-deps.js .env
-- \d tb_s080_tenant010          -- operator_id PK 확인
-- \d tb_s080_buildings          -- operator_id FK 확인
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND column_name='tenant_id';   -- User 1건만 남아야 정상
--
-- 앱 스모크 테스트(schema.prisma 수정 + 재기동 후):
--   계약 목록 조회 → 상세 → 등록 / 청구 목록 / 예약 등록
--   (이 3개가 tenant_id를 가장 많이 참조한다 — BACKEND_ANALYSIS.md §5-2)

-- =============================================================================
-- ROLLBACK — 역순. 앱이 이미 operator_id를 참조하기 시작했다면 앱도 함께
-- 되돌려야 한다(이 파일 단독 롤백은 위험하다).
-- =============================================================================
-- BEGIN;
-- -- 9~4: DROP FK/index/unique → ADD COLUMN tenant_id text → 역캐스팅 → DROP operator_id
-- -- (지면상 각 테이블 반복 생략 — 001/002 패턴과 동일하게 대칭 작성)
-- -- 2, 1: RENAME COLUMN operator_id TO tenant_id (+ 제약·인덱스 이름 원복)
-- COMMIT;
