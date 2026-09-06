-- SwonBiz ERP :: existing public schema (structure only, no data)
-- source  : 192.168.0.14:54322/postgres
-- server  : PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
-- taken   : 2026-09-05T05:14:57.289Z

-- ============ TABLES (32) ============

-- ---------------------------------------------------------------
CREATE TABLE "User" (
    id                           text NOT NULL,
    email                        text NOT NULL,
    name                         text,
    company                      text,
    role                         text DEFAULT 'member'::text NOT NULL,
    tenant_id                    integer,
    "mfaEnabled"                 boolean DEFAULT false NOT NULL,
    "createdAt"                  timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt"                  timestamp(3) without time zone NOT NULL,
    CONSTRAINT "User_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tb_s080_tenant010(tenant_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);
CREATE INDEX "User_tenant_id_idx" ON public."User" USING btree (tenant_id);

-- ---------------------------------------------------------------
CREATE TABLE _prisma_migrations (
    id                           character varying(36) NOT NULL,
    checksum                     character varying(64) NOT NULL,
    finished_at                  timestamp with time zone,
    migration_name               character varying(255) NOT NULL,
    logs                         text,
    rolled_back_at               timestamp with time zone,
    started_at                   timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count          integer DEFAULT 0 NOT NULL,
    CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------
CREATE TABLE tb_cm_file (
    id                           text NOT NULL,
    tenant_id                    text NOT NULL,
    target_type                  text NOT NULL,
    target_id                    text NOT NULL,
    file_purpose                 text NOT NULL,
    original_name                text NOT NULL,
    storage_path                 text NOT NULL,
    storage_url                  text NOT NULL,
    file_size                    integer,
    mime_type                    text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by                   text,
    CONSTRAINT tb_cm_file_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_cm_file_target_id_target_type_idx ON public.tb_cm_file USING btree (target_id, target_type);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_biz_purpose_catalog (
    id                           text NOT NULL,
    biz_code                     text NOT NULL,
    biz_name                     text NOT NULL,
    ksic_code                    text,
    ksic_name                    text,
    ksic_major                   text,
    ksic_mid                     text,
    license_type                 text DEFAULT 'UNKNOWN'::text NOT NULL,
    license_law_name             text,
    review_status                text DEFAULT 'manual_pending'::text NOT NULL,
    source_updated_at            timestamp(3) without time zone,
    active                       boolean DEFAULT true NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    CONSTRAINT tb_s080_biz_purpose_catalog_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX tb_s080_biz_purpose_catalog_biz_code_key ON public.tb_s080_biz_purpose_catalog USING btree (biz_code);
CREATE INDEX tb_s080_biz_purpose_catalog_ksic_major_idx ON public.tb_s080_biz_purpose_catalog USING btree (ksic_major);
CREATE INDEX tb_s080_biz_purpose_catalog_review_status_idx ON public.tb_s080_biz_purpose_catalog USING btree (review_status);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_buildings (
    build_id                     text NOT NULL,
    tenant_id                    integer NOT NULL,
    name                         text NOT NULL,
    address                      text,
    total_floors                 integer,
    memo                         text,
    is_active                    boolean DEFAULT true NOT NULL,
    owner_name                   text,
    owner_phone                  text,
    contract_from                timestamp(3) without time zone,
    contract_to                  timestamp(3) without time zone,
    center_manager               text,
    biz_reg_no                   text,
    bank_name                    text,
    bank_account                 text,
    account_holder               text,
    contract_doc_url             text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_buildings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tb_s080_tenant010(tenant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_buildings_pkey PRIMARY KEY (build_id)
);
COMMENT ON TABLE tb_s080_buildings IS '건물(오피스) — 운영사가 관리하는 개별 건물 단위';
COMMENT ON COLUMN tb_s080_buildings.build_id IS '건물ID (CUID)';
COMMENT ON COLUMN tb_s080_buildings.tenant_id IS '운영사ID (FK → tb_s080_tenant010)';
COMMENT ON COLUMN tb_s080_buildings.name IS '건물명';
COMMENT ON COLUMN tb_s080_buildings.address IS '주소';
COMMENT ON COLUMN tb_s080_buildings.total_floors IS '총 층수';
COMMENT ON COLUMN tb_s080_buildings.memo IS '비고';
COMMENT ON COLUMN tb_s080_buildings.is_active IS '사용여부';
COMMENT ON COLUMN tb_s080_buildings.owner_name IS '건물주 성명';
COMMENT ON COLUMN tb_s080_buildings.owner_phone IS '건물주 전화';
COMMENT ON COLUMN tb_s080_buildings.contract_from IS '임대 계약 시작일';
COMMENT ON COLUMN tb_s080_buildings.contract_to IS '임대 계약 종료일';
COMMENT ON COLUMN tb_s080_buildings.center_manager IS '센터장';
COMMENT ON COLUMN tb_s080_buildings.biz_reg_no IS '사업자번호';
COMMENT ON COLUMN tb_s080_buildings.bank_name IS '입금 은행명';
COMMENT ON COLUMN tb_s080_buildings.bank_account IS '입금 계좌번호';
COMMENT ON COLUMN tb_s080_buildings.account_holder IS '예금주';
COMMENT ON COLUMN tb_s080_buildings.contract_doc_url IS '계약서 파일 URL';
CREATE INDEX tb_s080_buildings_tenant_id_idx ON public.tb_s080_buildings USING btree (tenant_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_code_masters (
    code_id                      text NOT NULL,
    build_id                     text NOT NULL,
    category                     text NOT NULL,
    name                         text NOT NULL,
    description                  text,
    is_system                    boolean DEFAULT false NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_code_masters_pkey PRIMARY KEY (code_id)
);
COMMENT ON TABLE tb_s080_code_masters IS '코드마스트';
CREATE UNIQUE INDEX tb_s080_code_masters_build_id_category_key ON public.tb_s080_code_masters USING btree (build_id, category);
CREATE INDEX tb_s080_code_masters_build_id_idx ON public.tb_s080_code_masters USING btree (build_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_codes_line (
    line_id                      text NOT NULL,
    build_id                     text NOT NULL,
    category                     text NOT NULL,
    code                         text NOT NULL,
    name                         text NOT NULL,
    description                  text,
    use_tp                       character varying(3) DEFAULT ''::character varying NOT NULL,
    sort_order                   smallint DEFAULT 0 NOT NULL,
    is_active                    boolean DEFAULT true NOT NULL,
    is_system                    boolean DEFAULT false NOT NULL,
    extra                        jsonb,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    parent_line_id               text,
    CONSTRAINT tb_s080_codes_line_build_id_category_fkey FOREIGN KEY (build_id, category) REFERENCES tb_s080_code_masters(build_id, category) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_codes_line_parent_line_id_fkey FOREIGN KEY (parent_line_id) REFERENCES tb_s080_codes_line(line_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_codes_line_pkey PRIMARY KEY (line_id)
);
COMMENT ON TABLE tb_s080_codes_line IS '코드Line';
COMMENT ON COLUMN tb_s080_codes_line.parent_line_id IS '상위line_id';
CREATE UNIQUE INDEX tb_s080_codes_line_build_id_category_code_use_tp_key ON public.tb_s080_codes_line USING btree (build_id, category, code, use_tp, parent_line_id);
CREATE INDEX tb_s080_codes_line_build_id_category_idx ON public.tb_s080_codes_line USING btree (build_id, category);
CREATE INDEX tb_s080_codes_line_build_id_category_is_active_sort_order_idx ON public.tb_s080_codes_line USING btree (build_id, category, is_active, sort_order);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_companies (
    company_id                   text NOT NULL,
    build_id                     text NOT NULL,
    company_name                 text NOT NULL,
    biz_number                   text,
    corp_number                  text,
    ceo_name                     text,
    business_type                text,
    business_item                text,
    address                      text,
    zip_code                     character varying(10),
    address_detail               character varying(200),
    member_type                  character varying(20),
    tel                          text,
    fax                          text,
    email                        text,
    website                      text,
    employee_count               integer,
    status                       character varying(1) DEFAULT 'R'::character varying NOT NULL,
    memo                         text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    company_name_en              text,
    is_non_tenant                boolean DEFAULT false NOT NULL,
    head_address                 text,
    head_address_detail          character varying(200),
    head_zip_code                character varying(10),
    CONSTRAINT tb_s080_companies_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_companies_pkey PRIMARY KEY (company_id)
);
COMMENT ON TABLE tb_s080_companies IS '입주사(법인) — 건물에 입주한 회원사';
COMMENT ON COLUMN tb_s080_companies.company_id IS '입주사 ID (CUID)';
COMMENT ON COLUMN tb_s080_companies.build_id IS '건물 ID (FK → tb_s080_buildings.build_id)';
COMMENT ON COLUMN tb_s080_companies.company_name IS '회사명';
COMMENT ON COLUMN tb_s080_companies.biz_number IS '사업자등록번호';
COMMENT ON COLUMN tb_s080_companies.corp_number IS '법인등록번호';
COMMENT ON COLUMN tb_s080_companies.ceo_name IS '대표자 성명';
COMMENT ON COLUMN tb_s080_companies.business_type IS '업태';
COMMENT ON COLUMN tb_s080_companies.business_item IS '종목';
COMMENT ON COLUMN tb_s080_companies.address IS '주소';
COMMENT ON COLUMN tb_s080_companies.zip_code IS '우편번호';
COMMENT ON COLUMN tb_s080_companies.address_detail IS '상세주소';
COMMENT ON COLUMN tb_s080_companies.member_type IS '회원구분 코드 (FK → MEMBER_TYPE)';
COMMENT ON COLUMN tb_s080_companies.tel IS '대표 전화';
COMMENT ON COLUMN tb_s080_companies.fax IS '팩스';
COMMENT ON COLUMN tb_s080_companies.email IS '대표 이메일';
COMMENT ON COLUMN tb_s080_companies.website IS '홈페이지';
COMMENT ON COLUMN tb_s080_companies.employee_count IS '직원 수';
COMMENT ON COLUMN tb_s080_companies.status IS '회원사 상태 — 공통코드 COMPANY_ST (R:등록 / O:이용중 / E:만료)';
COMMENT ON COLUMN tb_s080_companies.memo IS '비고';
CREATE UNIQUE INDEX tb_s080_companies_biz_number_key ON public.tb_s080_companies USING btree (biz_number);
CREATE INDEX tb_s080_companies_build_id_idx ON public.tb_s080_companies USING btree (build_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_contracts (
    contract_id                  text NOT NULL,
    build_id                     text NOT NULL,
    company_id                   text NOT NULL,
    space_id                     text NOT NULL,
    contract_no                  text,
    start_date                   timestamp(3) without time zone NOT NULL,
    end_date                     timestamp(3) without time zone NOT NULL,
    monthly_rent                 integer NOT NULL,
    tax_fee                      integer DEFAULT 0 NOT NULL,
    deposit                      integer DEFAULT 0 NOT NULL,
    billing_day                  integer DEFAULT 1 NOT NULL,
    tax_issue_flag               character varying(1),
    payment_due_days             integer DEFAULT 10 NOT NULL,
    auto_renewal                 boolean DEFAULT false NOT NULL,
    renewal_period_months        integer,
    status                       character varying(1) DEFAULT 'P'::character varying NOT NULL,
    signed_date                  timestamp(3) without time zone,
    terminated_date              timestamp(3) without time zone,
    termination_reason           text,
    contract_room                text,
    access_route                 character varying(20),
    payment_method               character varying(20),
    memo                         text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    discount_amount              integer DEFAULT 0 NOT NULL,
    CONSTRAINT tb_s080_contracts_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_contracts_company_id_fkey FOREIGN KEY (company_id) REFERENCES tb_s080_companies(company_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_contracts_space_id_fkey FOREIGN KEY (space_id) REFERENCES tb_s080_spaces(space_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_contracts_pkey PRIMARY KEY (contract_id)
);
COMMENT ON TABLE tb_s080_contracts IS '계약 — 입주사와 건물 간 임대 계약';
COMMENT ON COLUMN tb_s080_contracts.contract_id IS '계약 ID (CUID)';
COMMENT ON COLUMN tb_s080_contracts.build_id IS '건물 ID (FK → tb_s080_buildings.build_id)';
COMMENT ON COLUMN tb_s080_contracts.company_id IS '입주사 ID (FK → tb_s080_companies)';
COMMENT ON COLUMN tb_s080_contracts.space_id IS '호실 ID (FK → tb_s080_spaces)';
COMMENT ON COLUMN tb_s080_contracts.contract_no IS '계약 번호';
COMMENT ON COLUMN tb_s080_contracts.start_date IS '계약 시작일';
COMMENT ON COLUMN tb_s080_contracts.end_date IS '계약 종료일';
COMMENT ON COLUMN tb_s080_contracts.monthly_rent IS '월 임대료 (원)';
COMMENT ON COLUMN tb_s080_contracts.tax_fee IS '부가세액 (원) — 계산서 발행 시 월임대료의 10%. DB 컬럼명은 tax_fee';
COMMENT ON COLUMN tb_s080_contracts.deposit IS '보증금 (원)';
COMMENT ON COLUMN tb_s080_contracts.billing_day IS '청구일 (매월 N일) — 저장 시 시작일(start_date)의 일자(DD)를 자동 추출하여 기록';
COMMENT ON COLUMN tb_s080_contracts.tax_issue_flag IS '계산서 발행 여부 (Y=발행 / N=미발행)';
COMMENT ON COLUMN tb_s080_contracts.payment_due_days IS '납부 기한 (청구일로부터 N일)';
COMMENT ON COLUMN tb_s080_contracts.auto_renewal IS '자동 갱신 여부';
COMMENT ON COLUMN tb_s080_contracts.renewal_period_months IS '갱신 기간 (개월)';
COMMENT ON COLUMN tb_s080_contracts.status IS '계약 상태 — 공통코드 CONTRACT_ST (P:대기 / A:계약중 / E:만료 / S:중도해지 / C:취소)';
COMMENT ON COLUMN tb_s080_contracts.signed_date IS '계약 체결일';
COMMENT ON COLUMN tb_s080_contracts.terminated_date IS '해지일';
COMMENT ON COLUMN tb_s080_contracts.termination_reason IS '해지 사유';
COMMENT ON COLUMN tb_s080_contracts.contract_room IS '계약 호실 (호실 지정 텍스트)';
COMMENT ON COLUMN tb_s080_contracts.access_route IS '접근 경로 코드 (공통코드 ACCESS_ROUTE의 code 값)';
COMMENT ON COLUMN tb_s080_contracts.payment_method IS '납부방법 코드 (공통코드 PAYMENT_METHOD의 code 값: M=월납, C=일시불)';
COMMENT ON COLUMN tb_s080_contracts.memo IS '비고';
CREATE INDEX tb_s080_contracts_build_id_idx ON public.tb_s080_contracts USING btree (build_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_corp_change_officers (
    id                           text NOT NULL,
    corp_change_id               text NOT NULL,
    name                         text NOT NULL,
    rrn_masked                   text,
    rrn_cipher                   text,
    rrn_iv                       text,
    change_kind                  text NOT NULL,
    position                     text,
    effective_date               timestamp(3) without time zone,
    zip_code                     text,
    address                      text,
    address_detail               text,
    sort_order                   integer NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    CONSTRAINT tb_s080_corp_change_officers_corp_change_id_fkey FOREIGN KEY (corp_change_id) REFERENCES tb_s080_corp_changes(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT tb_s080_corp_change_officers_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_s080_corp_change_officers_corp_change_id_idx ON public.tb_s080_corp_change_officers USING btree (corp_change_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_corp_changes (
    id                           text NOT NULL,
    tenant_id                    text NOT NULL,
    company_id                   text,
    is_member                    boolean DEFAULT true NOT NULL,
    change_type                  text NOT NULL,
    status                       text DEFAULT 'P'::text NOT NULL,
    company_name                 text NOT NULL,
    corp_number                  text,
    biz_number                   text,
    ceo_name                     text,
    phone                        text,
    hq_zip_code                  character varying(10),
    hq_address                   text,
    hq_address_detail            character varying(200),
    payload                      jsonb,
    submitted_at                 timestamp(3) without time zone,
    completed_at                 timestamp(3) without time zone,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    cancel_reason                character varying(200),
    cancelled_at                 timestamp(3) without time zone,
    status_before_cancel         character varying(1),
    CONSTRAINT tb_s080_corp_changes_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_s080_corp_changes_tenant_id_company_id_idx ON public.tb_s080_corp_changes USING btree (tenant_id, company_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_departments (
    department_id                text NOT NULL,
    tenant_id                    text NOT NULL,
    dept_code                    text NOT NULL,
    dept_name                    text NOT NULL,
    parent_id                    text,
    dept_level                   smallint DEFAULT 1 NOT NULL,
    sort_order                   integer DEFAULT 0 NOT NULL,
    is_active                    boolean DEFAULT true NOT NULL,
    memo                         text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_departments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES tb_s080_departments(department_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_departments_pkey PRIMARY KEY (department_id)
);
CREATE UNIQUE INDEX tb_s080_departments_tenant_id_dept_code_key ON public.tb_s080_departments USING btree (tenant_id, dept_code);
CREATE INDEX tb_s080_departments_tenant_id_idx ON public.tb_s080_departments USING btree (tenant_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_doc_form_settings (
    id                           text NOT NULL,
    tenant_id                    text NOT NULL,
    domain                       text NOT NULL,
    reg_type_key                 text NOT NULL,
    label                        text NOT NULL,
    form_no                      text,
    matter                       text,
    tax_mode                     text DEFAULT 'fixed'::text NOT NULL,
    taxes                        jsonb,
    attachments                  jsonb,
    sort_order                   integer DEFAULT 0 NOT NULL,
    is_active                    boolean DEFAULT true NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    custom_tokens                jsonb,
    company_type                 text DEFAULT ''::text NOT NULL,
    form_template_id             text,
    reg_purpose                  text,
    reg_reason                   text,
    matter_body                  text,
    CONSTRAINT tb_s080_doc_form_settings_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_s080_doc_form_settings_tenant_id_domain_idx ON public.tb_s080_doc_form_settings USING btree (tenant_id, domain);
CREATE UNIQUE INDEX tb_s080_doc_form_settings_tenant_id_domain_reg_type_key_com_key ON public.tb_s080_doc_form_settings USING btree (tenant_id, domain, reg_type_key, company_type);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_employees (
    employee_id                  text NOT NULL,
    tenant_id                    text NOT NULL,
    user_id                      text,
    emp_no                       text NOT NULL,
    legacy_emp_no                text,
    name                         text NOT NULL,
    email                        text NOT NULL,
    phone                        text,
    hire_date                    date NOT NULL,
    resign_date                  date,
    emp_status                   text DEFAULT 'W'::text NOT NULL,
    salary                       integer,
    respon_code                  character(1) DEFAULT 'E'::bpchar NOT NULL,
    dept_id                      text,
    rank_code                    text,
    duty_code                    text,
    building_id                  text,
    floor_id                     text,
    memo                         text,
    is_active                    boolean DEFAULT true NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_employees_building_id_fkey FOREIGN KEY (building_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_employees_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES tb_s080_departments(department_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_employees_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES tb_s080_floors(floor_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_employees_pkey PRIMARY KEY (employee_id)
);
CREATE INDEX tb_s080_employees_building_id_idx ON public.tb_s080_employees USING btree (building_id);
CREATE INDEX tb_s080_employees_dept_id_idx ON public.tb_s080_employees USING btree (dept_id);
CREATE INDEX tb_s080_employees_floor_id_idx ON public.tb_s080_employees USING btree (floor_id);
CREATE UNIQUE INDEX tb_s080_employees_tenant_id_email_key ON public.tb_s080_employees USING btree (tenant_id, email);
CREATE UNIQUE INDEX tb_s080_employees_tenant_id_emp_no_key ON public.tb_s080_employees USING btree (tenant_id, emp_no);
CREATE INDEX tb_s080_employees_tenant_id_emp_status_is_active_idx ON public.tb_s080_employees USING btree (tenant_id, emp_status, is_active);
CREATE INDEX tb_s080_employees_tenant_id_idx ON public.tb_s080_employees USING btree (tenant_id);
CREATE INDEX tb_s080_employees_user_id_idx ON public.tb_s080_employees USING btree (user_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_facilities (
    facility_id                  text NOT NULL,
    building_id                  text NOT NULL,
    name                         text NOT NULL,
    facility_type                text NOT NULL,
    floor_no                     text,
    capacity                     integer,
    half_hour_fee                integer,
    min_duration                 integer,
    max_duration                 integer,
    open_time                    text,
    close_time                   text,
    amenities                    jsonb,
    image_url                    text,
    status                       text DEFAULT 'active'::text NOT NULL,
    is_reservable                boolean DEFAULT true NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    floor_id                     text,
    CONSTRAINT tb_s080_facilities_building_id_fkey FOREIGN KEY (building_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_facilities_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES tb_s080_floors(floor_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_facilities_pkey PRIMARY KEY (facility_id)
);
COMMENT ON TABLE tb_s080_facilities IS '공용 시설 — 건물 내 입주사가 예약 사용하는 공용 공간';
COMMENT ON COLUMN tb_s080_facilities.facility_id IS '시설ID (CUID)';
COMMENT ON COLUMN tb_s080_facilities.building_id IS '건물ID (FK → tb_s080_buildings)';
COMMENT ON COLUMN tb_s080_facilities.name IS '시설명';
COMMENT ON COLUMN tb_s080_facilities.facility_type IS '시설 유형 코드';
COMMENT ON COLUMN tb_s080_facilities.floor_no IS '위치 층';
COMMENT ON COLUMN tb_s080_facilities.capacity IS '수용 인원';
COMMENT ON COLUMN tb_s080_facilities.half_hour_fee IS '시간당 이용료';
COMMENT ON COLUMN tb_s080_facilities.min_duration IS '최소 이용 시간(분)';
COMMENT ON COLUMN tb_s080_facilities.max_duration IS '최대 이용 시간(분)';
COMMENT ON COLUMN tb_s080_facilities.open_time IS '운영 시작 시간 (HH:MM)';
COMMENT ON COLUMN tb_s080_facilities.close_time IS '운영 종료 시간 (HH:MM)';
COMMENT ON COLUMN tb_s080_facilities.amenities IS '편의시설 (JSON)';
COMMENT ON COLUMN tb_s080_facilities.image_url IS '대표 이미지 URL';
COMMENT ON COLUMN tb_s080_facilities.status IS '상태 (active/inactive)';
COMMENT ON COLUMN tb_s080_facilities.is_reservable IS '예약 가능 여부';
CREATE INDEX tb_s080_facilities_building_id_idx ON public.tb_s080_facilities USING btree (building_id);
CREATE INDEX tb_s080_facilities_floor_id_idx ON public.tb_s080_facilities USING btree (floor_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_floors (
    floor_id                     text NOT NULL,
    building_id                  text NOT NULL,
    floor_no                     text NOT NULL,
    name                         text,
    area_sqm                     numeric(10,2),
    floor_plan_url               text,
    monthly_rent                 integer,
    deposit                      integer,
    has_lounge                   boolean DEFAULT false NOT NULL,
    has_meeting_room             boolean DEFAULT false NOT NULL,
    has_oa_zone                  boolean DEFAULT false NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_floors_building_id_fkey FOREIGN KEY (building_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_floors_pkey PRIMARY KEY (floor_id)
);
COMMENT ON TABLE tb_s080_floors IS '층 — 건물 단위 층 정보';
COMMENT ON COLUMN tb_s080_floors.floor_id IS '층ID (CUID)';
COMMENT ON COLUMN tb_s080_floors.building_id IS '건물ID (FK → tb_s080_buildings)';
COMMENT ON COLUMN tb_s080_floors.floor_no IS '층 번호 (문자열, 예: "1", "B1")';
COMMENT ON COLUMN tb_s080_floors.name IS '층 명칭';
COMMENT ON COLUMN tb_s080_floors.area_sqm IS '전용 면적(㎡)';
COMMENT ON COLUMN tb_s080_floors.floor_plan_url IS '도면 URL';
COMMENT ON COLUMN tb_s080_floors.monthly_rent IS '월 임대료';
COMMENT ON COLUMN tb_s080_floors.deposit IS '보증금';
COMMENT ON COLUMN tb_s080_floors.has_lounge IS '라운지 유무';
COMMENT ON COLUMN tb_s080_floors.has_meeting_room IS '회의실 유무';
COMMENT ON COLUMN tb_s080_floors.has_oa_zone IS 'OA존 유무';
CREATE UNIQUE INDEX tb_s080_floors_building_id_floor_no_key ON public.tb_s080_floors USING btree (building_id, floor_no);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_form_templates (
    id                           text NOT NULL,
    tenant_id                    text NOT NULL,
    name                         text NOT NULL,
    description                  text,
    definition                   jsonb NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    kind                         text DEFAULT 'T'::text NOT NULL,
    CONSTRAINT tb_s080_form_templates_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_s080_form_templates_tenant_id_idx ON public.tb_s080_form_templates USING btree (tenant_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_incorp_persons (
    id                           text NOT NULL,
    incorporation_id             text NOT NULL,
    member_id                    text,
    name                         text NOT NULL,
    rrn_masked                   text,
    rrn_cipher                   text,
    rrn_iv                       text,
    zip_code                     text,
    address                      text,
    address_detail               text,
    is_founder                   boolean DEFAULT false NOT NULL,
    is_director                  boolean DEFAULT false NOT NULL,
    is_auditor                   boolean DEFAULT false NOT NULL,
    is_representative            boolean DEFAULT false NOT NULL,
    units_subscribed             integer DEFAULT 0 NOT NULL,
    appointment_date             timestamp(3) without time zone,
    sort_order                   integer NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    phone                        text,
    CONSTRAINT tb_s080_incorp_persons_incorporation_id_fkey FOREIGN KEY (incorporation_id) REFERENCES tb_s080_incorporations(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT tb_s080_incorp_persons_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_s080_incorp_persons_incorporation_id_idx ON public.tb_s080_incorp_persons USING btree (incorporation_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_incorp_purposes (
    id                           text NOT NULL,
    incorporation_id             text NOT NULL,
    catalog_id                   text,
    purpose_text                 text NOT NULL,
    sort_order                   integer NOT NULL,
    biz_code                     text,
    ksic_code                    text,
    license_type                 text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    CONSTRAINT tb_s080_incorp_purposes_incorporation_id_fkey FOREIGN KEY (incorporation_id) REFERENCES tb_s080_incorporations(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT tb_s080_incorp_purposes_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_s080_incorp_purposes_incorporation_id_idx ON public.tb_s080_incorp_purposes USING btree (incorporation_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_incorporations (
    id                           text NOT NULL,
    tenant_id                    text NOT NULL,
    company_id                   text NOT NULL,
    entity_type                  text NOT NULL,
    status                       text DEFAULT 'P'::text NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    capital_amount               integer,
    establishment_method         text DEFAULT 'PROMOTER'::text NOT NULL,
    fiscal_end                   text,
    fiscal_start                 text,
    par_value                    integer,
    planned_date                 timestamp(3) without time zone,
    public_notice_method         text,
    units_authorized             integer,
    units_issued                 integer,
    completed_at                 timestamp(3) without time zone,
    submitted_at                 timestamp(3) without time zone,
    company_type_position        text,
    contract_id                  text,
    cancel_reason                character varying(200),
    cancelled_at                 timestamp(3) without time zone,
    status_before_cancel         character varying(1),
    CONSTRAINT tb_s080_incorporations_company_id_fkey FOREIGN KEY (company_id) REFERENCES tb_s080_companies(company_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_incorporations_pkey PRIMARY KEY (id)
);
CREATE INDEX tb_s080_incorporations_tenant_id_company_id_idx ON public.tb_s080_incorporations USING btree (tenant_id, company_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_invoice_lines (
    invoice_line_id              text NOT NULL,
    build_id                     text NOT NULL,
    invoice_id                   text NOT NULL,
    pay_item                     character varying(1) DEFAULT 'M'::character varying NOT NULL,
    quantity                     numeric(10,2) DEFAULT 1 NOT NULL,
    unit_price                   integer NOT NULL,
    supply_amount                integer NOT NULL,
    tax_rate                     numeric(5,2) DEFAULT 10.00 NOT NULL,
    tax_amount                   integer DEFAULT 0 NOT NULL,
    total_amount                 integer NOT NULL,
    sort_order                   integer DEFAULT 0 NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_invoice_lines_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES tb_s080_invoices(invoice_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT tb_s080_invoice_lines_pkey PRIMARY KEY (invoice_line_id)
);
COMMENT ON TABLE tb_s080_invoice_lines IS '청구서 라인 — 청구서 세부 항목';
COMMENT ON COLUMN tb_s080_invoice_lines.invoice_line_id IS '청구서 라인 ID (CUID)';
COMMENT ON COLUMN tb_s080_invoice_lines.build_id IS '건물 ID (FK → tb_s080_buildings.build_id)';
COMMENT ON COLUMN tb_s080_invoice_lines.invoice_id IS '청구서 ID (FK → tb_s080_invoices)';
COMMENT ON COLUMN tb_s080_invoice_lines.pay_item IS '항목 설명';
COMMENT ON COLUMN tb_s080_invoice_lines.quantity IS '수량';
COMMENT ON COLUMN tb_s080_invoice_lines.unit_price IS '단가 (원)';
COMMENT ON COLUMN tb_s080_invoice_lines.supply_amount IS '공급가액 (원)';
COMMENT ON COLUMN tb_s080_invoice_lines.tax_rate IS '세율 (%)';
COMMENT ON COLUMN tb_s080_invoice_lines.tax_amount IS '세액 (원)';
COMMENT ON COLUMN tb_s080_invoice_lines.total_amount IS '합계 금액 (원)';
COMMENT ON COLUMN tb_s080_invoice_lines.sort_order IS '정렬 순서';
CREATE INDEX tb_s080_invoice_lines_build_id_idx ON public.tb_s080_invoice_lines USING btree (build_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_invoices (
    invoice_id                   text NOT NULL,
    build_id                     text NOT NULL,
    company_id                   text NOT NULL,
    contract_id                  text NOT NULL,
    invoice_no                   text,
    year_month                   character(7) NOT NULL,
    issue_date                   timestamp(3) without time zone,
    due_date                     timestamp(3) without time zone,
    subtotal                     integer DEFAULT 0 NOT NULL,
    tax_amount                   integer DEFAULT 0 NOT NULL,
    total_amount                 integer DEFAULT 0 NOT NULL,
    paid_amount                  integer DEFAULT 0 NOT NULL,
    status                       character varying(1) DEFAULT 'P'::character varying NOT NULL,
    sent_at                      timestamp(3) without time zone,
    nts_confirm_num              text,
    memo                         text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_invoices_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES tb_s080_companies(company_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_invoices_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES tb_s080_contracts(contract_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_invoices_pkey PRIMARY KEY (invoice_id)
);
COMMENT ON TABLE tb_s080_invoices IS '청구서(인보이스) — 월별 입주사 청구 명세';
COMMENT ON COLUMN tb_s080_invoices.invoice_id IS '청구서 ID (CUID)';
COMMENT ON COLUMN tb_s080_invoices.build_id IS '건물 ID (FK → tb_s080_buildings.build_id)';
COMMENT ON COLUMN tb_s080_invoices.company_id IS '입주사 ID (FK → tb_s080_companies)';
COMMENT ON COLUMN tb_s080_invoices.contract_id IS '계약 ID (FK → tb_s080_contracts)';
COMMENT ON COLUMN tb_s080_invoices.invoice_no IS '청구서 번호';
COMMENT ON COLUMN tb_s080_invoices.year_month IS '청구 연월 (YYYY-MM)';
COMMENT ON COLUMN tb_s080_invoices.issue_date IS '발행일';
COMMENT ON COLUMN tb_s080_invoices.due_date IS '납부 기한일';
COMMENT ON COLUMN tb_s080_invoices.subtotal IS '공급가액 합계';
COMMENT ON COLUMN tb_s080_invoices.tax_amount IS '세액 합계';
COMMENT ON COLUMN tb_s080_invoices.total_amount IS '청구 합계 (공급가액 + 세액)';
COMMENT ON COLUMN tb_s080_invoices.paid_amount IS '수납 금액';
COMMENT ON COLUMN tb_s080_invoices.status IS '청구 상태 (P / E / O / C-PAY_ST)';
COMMENT ON COLUMN tb_s080_invoices.sent_at IS '발송 일시';
COMMENT ON COLUMN tb_s080_invoices.nts_confirm_num IS '국세청 승인번호';
COMMENT ON COLUMN tb_s080_invoices.memo IS '비고';
CREATE INDEX tb_s080_invoices_build_id_idx ON public.tb_s080_invoices USING btree (build_id);
CREATE UNIQUE INDEX tb_s080_invoices_contract_id_year_month_key ON public.tb_s080_invoices USING btree (contract_id, year_month);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_members (
    member_id                    text NOT NULL,
    build_id                     text NOT NULL,
    company_id                   text NOT NULL,
    user_id                      text,
    name                         text NOT NULL,
    position                     text,
    dept                         text,
    email                        text,
    phone                        text,
    join_date                    timestamp(3) without time zone,
    leave_date                   timestamp(3) without time zone,
    is_representative            character varying(1) DEFAULT 'M'::character varying NOT NULL,
    initial_password             character varying(20),
    memo                         text,
    status                       text DEFAULT 'active'::text NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_members_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES tb_s080_companies(company_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_members_pkey PRIMARY KEY (member_id)
);
COMMENT ON TABLE tb_s080_members IS '입주사 구성원 — 입주사 소속 직원';
COMMENT ON COLUMN tb_s080_members.member_id IS '구성원 ID (CUID)';
COMMENT ON COLUMN tb_s080_members.build_id IS '건물 ID (FK → tb_s080_buildings.build_id)';
COMMENT ON COLUMN tb_s080_members.company_id IS '입주사 ID (FK → tb_s080_companies)';
COMMENT ON COLUMN tb_s080_members.user_id IS '연결 사용자 ID';
COMMENT ON COLUMN tb_s080_members.name IS '성명';
COMMENT ON COLUMN tb_s080_members.position IS '직책';
COMMENT ON COLUMN tb_s080_members.dept IS '부서';
COMMENT ON COLUMN tb_s080_members.email IS '이메일';
COMMENT ON COLUMN tb_s080_members.phone IS '전화';
COMMENT ON COLUMN tb_s080_members.join_date IS '입사일';
COMMENT ON COLUMN tb_s080_members.leave_date IS '퇴사일';
COMMENT ON COLUMN tb_s080_members.is_representative IS '대표자 여부';
COMMENT ON COLUMN tb_s080_members.initial_password IS '초기 패스워드 (계약 등록 시 입력)';
COMMENT ON COLUMN tb_s080_members.memo IS '비고';
COMMENT ON COLUMN tb_s080_members.status IS '상태 (active / inactive)';
CREATE INDEX tb_s080_members_build_id_idx ON public.tb_s080_members USING btree (build_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_menu_permissions (
    permission_id                text NOT NULL,
    build_id                     text NOT NULL,
    menu_id                      text NOT NULL,
    role                         text NOT NULL,
    can_read                     boolean DEFAULT true NOT NULL,
    can_write                    boolean DEFAULT false NOT NULL,
    can_delete                   boolean DEFAULT false NOT NULL,
    can_export                   boolean DEFAULT false NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_menu_permissions_menu_id_fkey FOREIGN KEY (menu_id) REFERENCES tb_s080_menus(menu_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_menu_permissions_pkey PRIMARY KEY (permission_id)
);
CREATE UNIQUE INDEX tb_s080_menu_permissions_build_id_menu_id_role_key ON public.tb_s080_menu_permissions USING btree (build_id, menu_id, role);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_menus (
    menu_id                      text NOT NULL,
    build_id                     text NOT NULL,
    service_id                   text NOT NULL,
    parent_id                    text,
    code                         text NOT NULL,
    name                         text NOT NULL,
    path                         text,
    icon                         text,
    depth                        integer DEFAULT 1 NOT NULL,
    sort_order                   integer DEFAULT 0 NOT NULL,
    is_active                    boolean DEFAULT true NOT NULL,
    is_visible                   boolean DEFAULT true NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_menus_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES tb_s080_menus(menu_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_menus_service_id_fkey FOREIGN KEY (service_id) REFERENCES tb_s080_services(service_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_menus_pkey PRIMARY KEY (menu_id)
);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_payments (
    payment_id                   text NOT NULL,
    build_id                     text NOT NULL,
    invoice_id                   text NOT NULL,
    company_id                   text NOT NULL,
    paid_at                      timestamp(3) without time zone NOT NULL,
    amount                       integer NOT NULL,
    pay_method                   character varying(1) DEFAULT 'B'::character varying NOT NULL,
    bank_name                    text,
    account_last4                character(4),
    receipt_url                  text,
    is_confirmed                 boolean DEFAULT false NOT NULL,
    confirmed_by                 text,
    confirmed_at                 timestamp(3) without time zone,
    memo                         text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_payments_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES tb_s080_companies(company_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES tb_s080_invoices(invoice_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_payments_pkey PRIMARY KEY (payment_id)
);
COMMENT ON TABLE tb_s080_payments IS '수납(결제) — 청구서별 입금 내역';
COMMENT ON COLUMN tb_s080_payments.payment_id IS '수납 ID (CUID)';
COMMENT ON COLUMN tb_s080_payments.build_id IS '건물 ID (FK → tb_s080_buildings.build_id)';
COMMENT ON COLUMN tb_s080_payments.invoice_id IS '청구서 ID (FK → tb_s080_invoices)';
COMMENT ON COLUMN tb_s080_payments.company_id IS '입주사 ID (FK → tb_s080_companies)';
COMMENT ON COLUMN tb_s080_payments.paid_at IS '입금 일시';
COMMENT ON COLUMN tb_s080_payments.amount IS '입금 금액 (원)';
COMMENT ON COLUMN tb_s080_payments.pay_method IS '결제 수단';
COMMENT ON COLUMN tb_s080_payments.bank_name IS '입금 은행명';
COMMENT ON COLUMN tb_s080_payments.account_last4 IS '계좌 끝 4자리';
COMMENT ON COLUMN tb_s080_payments.receipt_url IS '영수증 URL';
COMMENT ON COLUMN tb_s080_payments.is_confirmed IS '확인 여부';
COMMENT ON COLUMN tb_s080_payments.confirmed_by IS '확인자 ID';
COMMENT ON COLUMN tb_s080_payments.confirmed_at IS '확인 일시';
COMMENT ON COLUMN tb_s080_payments.memo IS '비고';
CREATE INDEX tb_s080_payments_build_id_idx ON public.tb_s080_payments USING btree (build_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_reservations (
    reservation_id               text NOT NULL,
    build_id                     text NOT NULL,
    facility_id                  text NOT NULL,
    company_id                   text,
    member_id                    text,
    user_id                      text,
    title                        text NOT NULL,
    start_at                     timestamp(3) without time zone NOT NULL,
    end_at                       timestamp(3) without time zone NOT NULL,
    attendees                    integer,
    purpose                      text,
    usage_fee                    integer,
    status                       text DEFAULT 'confirmed'::text NOT NULL,
    cancelled_at                 timestamp(3) without time zone,
    cancel_reason                text,
    memo                         text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_reservations_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_reservations_company_id_fkey FOREIGN KEY (company_id) REFERENCES tb_s080_companies(company_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_reservations_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES tb_s080_facilities(facility_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_reservations_member_id_fkey FOREIGN KEY (member_id) REFERENCES tb_s080_members(member_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT tb_s080_reservations_pkey PRIMARY KEY (reservation_id)
);
COMMENT ON TABLE tb_s080_reservations IS '시설 예약 — 입주사의 공용 시설 예약 이력';
COMMENT ON COLUMN tb_s080_reservations.reservation_id IS '예약ID (CUID)';
COMMENT ON COLUMN tb_s080_reservations.build_id IS '건물ID (FK → tb_s080_buildings)';
COMMENT ON COLUMN tb_s080_reservations.facility_id IS '시설ID (FK → tb_s080_facilities)';
COMMENT ON COLUMN tb_s080_reservations.company_id IS '입주사ID';
COMMENT ON COLUMN tb_s080_reservations.member_id IS '구성원ID';
COMMENT ON COLUMN tb_s080_reservations.user_id IS '예약자 사용자ID';
COMMENT ON COLUMN tb_s080_reservations.title IS '예약 제목';
COMMENT ON COLUMN tb_s080_reservations.start_at IS '시작일시';
COMMENT ON COLUMN tb_s080_reservations.end_at IS '종료일시';
COMMENT ON COLUMN tb_s080_reservations.attendees IS '참석 인원';
COMMENT ON COLUMN tb_s080_reservations.purpose IS '사용 목적';
COMMENT ON COLUMN tb_s080_reservations.usage_fee IS '이용 요금';
COMMENT ON COLUMN tb_s080_reservations.status IS '상태 (confirmed/cancelled)';
COMMENT ON COLUMN tb_s080_reservations.cancelled_at IS '취소일시';
COMMENT ON COLUMN tb_s080_reservations.cancel_reason IS '취소 사유';
COMMENT ON COLUMN tb_s080_reservations.memo IS '비고';
CREATE INDEX tb_s080_reservations_build_id_idx ON public.tb_s080_reservations USING btree (build_id);
CREATE INDEX tb_s080_reservations_facility_id_start_at_end_at_idx ON public.tb_s080_reservations USING btree (facility_id, start_at, end_at);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_services (
    service_id                   text NOT NULL,
    build_id                     text NOT NULL,
    code                         text NOT NULL,
    name                         text NOT NULL,
    description                  text,
    icon                         text,
    color                        text,
    sort_order                   integer DEFAULT 0 NOT NULL,
    is_active                    boolean DEFAULT true NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_services_pkey PRIMARY KEY (service_id)
);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_settlements (
    settlement_id                text NOT NULL,
    build_id                     text NOT NULL,
    company_id                   text NOT NULL,
    contract_id                  text NOT NULL,
    terminate_date               timestamp(3) without time zone NOT NULL,
    payment_method               character varying(20),
    total_rent_paid              integer NOT NULL,
    deposit_return               integer NOT NULL,
    discount_clawback            integer NOT NULL,
    usage_charge                 integer NOT NULL,
    net_amount                   integer NOT NULL,
    settle_type                  character varying(10) NOT NULL,
    memo                         text,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by                   text,
    CONSTRAINT tb_s080_settlements_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_settlements_company_id_fkey FOREIGN KEY (company_id) REFERENCES tb_s080_companies(company_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_settlements_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES tb_s080_contracts(contract_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_settlements_pkey PRIMARY KEY (settlement_id)
);
CREATE INDEX tb_s080_settlements_contract_id_idx ON public.tb_s080_settlements USING btree (contract_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_space_room (
    room_space_id                text NOT NULL,
    space_id                     text NOT NULL,
    build_id                     text NOT NULL,
    floor_id                     text NOT NULL,
    contract_room                character varying(50) NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_space_room_space_id_fkey FOREIGN KEY (space_id) REFERENCES tb_s080_spaces(space_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT tb_s080_space_room_pkey PRIMARY KEY (room_space_id)
);
COMMENT ON TABLE tb_s080_space_room IS '호실별계약호실별정보 (1 Space : N Room)';
COMMENT ON COLUMN tb_s080_space_room.room_space_id IS '계약호실ID (CUID)';
COMMENT ON COLUMN tb_s080_space_room.space_id IS '호실ID (FK → tb_s080_spaces.space_id)';
COMMENT ON COLUMN tb_s080_space_room.build_id IS '건물 고유 ID';
COMMENT ON COLUMN tb_s080_space_room.floor_id IS '층 고유 ID';
COMMENT ON COLUMN tb_s080_space_room.contract_room IS '계약호실 명칭/번호 (예: 1-A호, 1-B호)';
CREATE INDEX tb_s080_space_room_contract_room_idx ON public.tb_s080_space_room USING btree (contract_room);
CREATE INDEX tb_s080_space_room_space_id_idx ON public.tb_s080_space_room USING btree (space_id);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_spaces (
    space_id                     text NOT NULL,
    build_id                     text NOT NULL,
    floor_id                     text NOT NULL,
    room_no                      text NOT NULL,
    room_type                    text NOT NULL,
    area_sqm                     numeric(10,2),
    capacity                     integer,
    standard_fee                 integer,
    deposit                      integer,
    status                       character varying(1) DEFAULT 'E'::character varying NOT NULL,
    amenities                    jsonb,
    memo                         text,
    is_active                    boolean DEFAULT true NOT NULL,
    room_name                    text,
    biz_addr_available           boolean DEFAULT false NOT NULL,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    created_by                   text,
    updated_by                   text,
    CONSTRAINT tb_s080_spaces_build_id_fkey FOREIGN KEY (build_id) REFERENCES tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_spaces_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES tb_s080_floors(floor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT tb_s080_spaces_pkey PRIMARY KEY (space_id)
);
COMMENT ON TABLE tb_s080_spaces IS '호실(공간) — 건물 내 임대 가능한 개별 공간';
COMMENT ON COLUMN tb_s080_spaces.space_id IS '호실ID (CUID)';
COMMENT ON COLUMN tb_s080_spaces.build_id IS '건물ID (FK → tb_s080_buildings)';
COMMENT ON COLUMN tb_s080_spaces.floor_id IS '층ID (FK → tb_s080_floors)';
COMMENT ON COLUMN tb_s080_spaces.room_no IS '호실 번호';
COMMENT ON COLUMN tb_s080_spaces.room_type IS '호실 유형 코드 (R1/R2/R3/FI/FR/VR)';
COMMENT ON COLUMN tb_s080_spaces.area_sqm IS '전용 면적(㎡)';
COMMENT ON COLUMN tb_s080_spaces.capacity IS '수용 인원';
COMMENT ON COLUMN tb_s080_spaces.standard_fee IS '기준 임대료';
COMMENT ON COLUMN tb_s080_spaces.deposit IS '보증금';
COMMENT ON COLUMN tb_s080_spaces.status IS '호실 점유상태 — 공통코드 ROOM_ST (E:공실 / O:점유 / R:예약)';
COMMENT ON COLUMN tb_s080_spaces.amenities IS '편의시설 (JSON)';
COMMENT ON COLUMN tb_s080_spaces.memo IS '비고';
COMMENT ON COLUMN tb_s080_spaces.is_active IS '사용여부';
COMMENT ON COLUMN tb_s080_spaces.room_name IS '호실명';
COMMENT ON COLUMN tb_s080_spaces.biz_addr_available IS '사업장 주소 사용 가능 여부';
CREATE INDEX tb_s080_spaces_build_id_idx ON public.tb_s080_spaces USING btree (build_id);
CREATE UNIQUE INDEX tb_s080_spaces_floor_id_room_no_key ON public.tb_s080_spaces USING btree (floor_id, room_no);

-- ---------------------------------------------------------------
CREATE TABLE tb_s080_tenant010 (
    tenant_id                    integer DEFAULT nextval('tb_s080_tenant010_tenant_id_seq'::regclass) NOT NULL,
    name                         character varying(191) NOT NULL,
    slug                         character varying(191) NOT NULL,
    ceo_name                     character varying(20),
    reg_no                       character varying(12),
    law_no                       character varying(14),
    home_address                 character varying(100),
    business_tp                  character varying(255),
    business_kd                  character varying(255),
    found_date                   date,
    created_at                   timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at                   timestamp(3) without time zone NOT NULL,
    CONSTRAINT tb_s080_tenant010_pkey PRIMARY KEY (tenant_id)
);
CREATE UNIQUE INDEX tb_s080_tenant010_slug_key ON public.tb_s080_tenant010 USING btree (slug);

-- ============ SEQUENCES ============
-- tb_s080_tenant010_tenant_id_seq  integer start 1 inc 1

-- ============ FUNCTIONS ============
-- array_to_halfvec(numeric[], integer, boolean)
-- array_to_halfvec(integer[], integer, boolean)
-- array_to_halfvec(real[], integer, boolean)
-- array_to_halfvec(double precision[], integer, boolean)
-- array_to_sparsevec(integer[], integer, boolean)
-- array_to_sparsevec(numeric[], integer, boolean)
-- array_to_sparsevec(double precision[], integer, boolean)
-- array_to_sparsevec(real[], integer, boolean)
-- array_to_vector(numeric[], integer, boolean)
-- array_to_vector(integer[], integer, boolean)
-- array_to_vector(real[], integer, boolean)
-- array_to_vector(double precision[], integer, boolean)
-- avg(halfvec)
-- avg(vector)
-- binary_quantize(vector)
-- binary_quantize(halfvec)
-- cosine_distance(sparsevec, sparsevec)
-- cosine_distance(halfvec, halfvec)
-- cosine_distance(vector, vector)
-- halfvec(halfvec, integer, boolean)
-- halfvec_accum(double precision[], halfvec)
-- halfvec_add(halfvec, halfvec)
-- halfvec_avg(double precision[])
-- halfvec_cmp(halfvec, halfvec)
-- halfvec_combine(double precision[], double precision[])
-- halfvec_concat(halfvec, halfvec)
-- halfvec_eq(halfvec, halfvec)
-- halfvec_ge(halfvec, halfvec)
-- halfvec_gt(halfvec, halfvec)
-- halfvec_in(cstring, oid, integer)
-- halfvec_l2_squared_distance(halfvec, halfvec)
-- halfvec_le(halfvec, halfvec)
-- halfvec_lt(halfvec, halfvec)
-- halfvec_mul(halfvec, halfvec)
-- halfvec_ne(halfvec, halfvec)
-- halfvec_negative_inner_product(halfvec, halfvec)
-- halfvec_out(halfvec)
-- halfvec_recv(internal, oid, integer)
-- halfvec_send(halfvec)
-- halfvec_spherical_distance(halfvec, halfvec)
-- halfvec_sub(halfvec, halfvec)
-- halfvec_to_float4(halfvec, integer, boolean)
-- halfvec_to_sparsevec(halfvec, integer, boolean)
-- halfvec_to_vector(halfvec, integer, boolean)
-- halfvec_typmod_in(cstring[])
-- hamming_distance(bit, bit)
-- hnsw_bit_support(internal)
-- hnsw_halfvec_support(internal)
-- hnsw_sparsevec_support(internal)
-- hnswhandler(internal)
-- inner_product(vector, vector)
-- inner_product(halfvec, halfvec)
-- inner_product(sparsevec, sparsevec)
-- ivfflat_bit_support(internal)
-- ivfflat_halfvec_support(internal)
-- ivfflathandler(internal)
-- jaccard_distance(bit, bit)
-- l1_distance(halfvec, halfvec)
-- l1_distance(sparsevec, sparsevec)
-- l1_distance(vector, vector)
-- l2_distance(sparsevec, sparsevec)
-- l2_distance(halfvec, halfvec)
-- l2_distance(vector, vector)
-- l2_norm(halfvec)
-- l2_norm(sparsevec)
-- l2_normalize(vector)
-- l2_normalize(sparsevec)
-- l2_normalize(halfvec)
-- sparsevec(sparsevec, integer, boolean)
-- sparsevec_cmp(sparsevec, sparsevec)
-- sparsevec_eq(sparsevec, sparsevec)
-- sparsevec_ge(sparsevec, sparsevec)
-- sparsevec_gt(sparsevec, sparsevec)
-- sparsevec_in(cstring, oid, integer)
-- sparsevec_l2_squared_distance(sparsevec, sparsevec)
-- sparsevec_le(sparsevec, sparsevec)
-- sparsevec_lt(sparsevec, sparsevec)
-- sparsevec_ne(sparsevec, sparsevec)
-- sparsevec_negative_inner_product(sparsevec, sparsevec)
-- sparsevec_out(sparsevec)
-- sparsevec_recv(internal, oid, integer)
-- sparsevec_send(sparsevec)
-- sparsevec_to_halfvec(sparsevec, integer, boolean)
-- sparsevec_to_vector(sparsevec, integer, boolean)
-- sparsevec_typmod_in(cstring[])
-- subvector(vector, integer, integer)
-- subvector(halfvec, integer, integer)
-- sum(vector)
-- sum(halfvec)
-- vector(vector, integer, boolean)
-- vector_accum(double precision[], vector)
-- vector_add(vector, vector)
-- vector_avg(double precision[])
-- vector_cmp(vector, vector)
-- vector_combine(double precision[], double precision[])
-- vector_concat(vector, vector)
-- vector_dims(vector)
-- vector_dims(halfvec)
-- vector_eq(vector, vector)
-- vector_ge(vector, vector)
-- vector_gt(vector, vector)
-- vector_in(cstring, oid, integer)
-- vector_l2_squared_distance(vector, vector)
-- vector_le(vector, vector)
-- vector_lt(vector, vector)
-- vector_mul(vector, vector)
-- vector_ne(vector, vector)
-- vector_negative_inner_product(vector, vector)
-- vector_norm(vector)
-- vector_out(vector)
-- vector_recv(internal, oid, integer)
-- vector_send(vector)
-- vector_spherical_distance(vector, vector)
-- vector_sub(vector, vector)
-- vector_to_float4(vector, integer, boolean)
-- vector_to_halfvec(vector, integer, boolean)
-- vector_to_sparsevec(vector, integer, boolean)
-- vector_typmod_in(cstring[])
