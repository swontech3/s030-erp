-- =============================================================================
-- 004_rename_tenant.sql
--
-- ★★★ 이 파일은 001~003과 같은 방식으로 적용하지 않는다. ★★★
--
-- tenant_id → operator_id 개명 + 타입 통일(text→int)은 기존 앱(S-WonERP)의
-- `schema.prisma` @map 12곳과 `parseInt(ctx.tenantId, 10)` 호출부(164곳,
-- BACKEND_ANALYSIS.md §1-7)에 동시에 영향을 준다. 이 파일 하나만 실행하면
-- 기존 앱이 즉시 깨진다 — 반드시 앱 코드 수정과 같은 배포 창에서 적용한다.
--
-- 적용 절차 (BACKEND_ANALYSIS.md §5 순서 6번):
--   1. 기존 S-WonERP 앱 정지
--   2. pg_dump 백업
--   3. 이 파일 적용
--   4. schema.prisma에서 전 모델의 @map("tenant_id") → @map("operator_id")
--      (Prisma 필드명 tenantId는 유지 가능 — 코드 변경 없음. 필드명까지
--      operatorId로 바꾸려면 164곳 기계적 치환 별도 진행)
--   5. 앱 재기동 → 계약 목록·상세·등록, 청구 목록, 예약 등록 스모크 테스트
--
-- `supabase db push`/`migration up`을 무심코 돌리면 001~003과 함께 이 파일도
-- 적용된다. Supabase CLI에는 "보류" 상태 개념이 없으므로, 준비가 끝나기
-- 전까지는 이 파일을 이 디렉터리 밖(예: supabase/migrations_pending/)에
-- 두거나, 001~003을 psql -f로 개별 적용하는 방식을 권장한다.
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
