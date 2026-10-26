-- =============================================================================
-- 203_tax_uploads.sql
--
-- 세무(S05) 자료 올리기(s050200010) · 거래처(s050100020) — 표 넷 (1-2 멈춤 2, 2026-10-26, ★ 적용 전 승인 대기)
--
--   ① tb_s050_upload_files  올린 파일 기록 — 원본은 보관하지 않고 지문(SHA-256)만
--   ② tb_s050_vendors       거래처 — 주거래처(M) / 일반(G) 한 표
--   ③ tb_s050_invoices      세금계산서 줄(표준 양식) — 1차는 홈택스 전자세금계산서 매입 · 매출만
--   ④ tb_s050_import_maps   대응표 — 기관 파일의 어느 칸이 표준 양식의 어느 칸인지(공용, 회사 칸 없음)
--
-- -----------------------------------------------------------------------------
-- ★★★ 회사 키는 삐용 단체 ID(org_id)다 — 201 과 같은 RLS(erp_org_scope), ①②③만
-- -----------------------------------------------------------------------------
-- 운영사는 RLS 로는 전부 보인다. 그래서 세무 API 는 **모든 조회 · 저장에 `org_id = 세션 단체 ID` 를 직접 건다**
-- (운영사도 자기 단체만). RLS 는 두 번째 겹이다.
-- ④ 대응표는 회사 자료가 아니라 RLS 가 없다. erp_app 은 읽기만 한다 — 줄은 마이그레이션(204)이 넣는다
-- (운영사 대응표 화면은 나중).
--
-- -----------------------------------------------------------------------------
-- ★★ 중복 막기 — 두 겹
-- -----------------------------------------------------------------------------
--   같은 파일      (org_id, file_hash) UNIQUE — 「이미 올린 파일입니다」
--   같은 계산서    (org_id, approval_no) UNIQUE — 겹치는 파일(1~8 뒤 1~10)은 앱이 ON CONFLICT DO NOTHING 으로 건너뛴다.
--                  「중복 의심 넣기/빼기」 표는 계산서에 두지 않는다(결정 4)
--
-- -----------------------------------------------------------------------------
-- ★★ FK 둘 — 파일을 지우면 줄도 지워지고, 계산서가 가리키는 거래처는 지워지지 않는다
-- -----------------------------------------------------------------------------
--   invoices (org_id, file_id)   → upload_files (org_id, id)  ON DELETE CASCADE   파일 지우기 = 그 파일로 들어온 줄 지우기
--   invoices (org_id, vendor_id) → vendors (org_id, id)       ON DELETE RESTRICT  합치기에서 줄 옮기기를 빠뜨리면 DB 가 지우기를 막는다
--   upload_files.map_id → import_maps                         ON DELETE RESTRICT  쓰인 대응표는 못 지운다
-- ★ 계산서 FK 둘은 **단체까지 묶는다**(부모 표에 UNIQUE (org_id, id)). FK 검사는 RLS 를 거치지 않아서,
--   id 만 걸면 회사 A 의 계산서가 회사 B 의 파일 · 거래처 id 를 가리켜도 DB 가 받아 준다.
-- 코드 칸에는 FK 가 없다(ERP 공통 — 업무 표에서 코드표로 가는 FK 는 0건). 앱이 코드값에 기대는 칸(direction ·
-- vendor_tp)만 201 의 kind 처럼 CHECK 로 값을 묶는다.
--
-- -----------------------------------------------------------------------------
-- ★★ 거래처 — 업로드가 사용자 값을 덮지 않는다
-- -----------------------------------------------------------------------------
-- 업로드는 거래처를 **새로 만들거나(세금계산서면 주거래처 M) 일반 → 주거래처로 올리기만** 한다.
-- 이미 있는 거래처의 이름 · 사업자번호는 업로드가 고치지 않는다 — 그래서 그 둘에는 「고쳤음」 칸이 없다.
-- 구분은 사용자가 [주거래처로] · [일반으로] 를 누르면 tp_set_by_user = true 가 되고, 그 뒤로 업로드가 바꾸지 않는다.
-- 같은 사업자번호 거래처는 허용한다(결정 8 — 시안의 「사업자번호가 같은 거래처」 띠). 그래서 biz_no 에 UNIQUE 가 없고,
-- 업로드는 **먼저 생긴 곳**(created_at, id 순)에 붙인다 — 색인 ix_s050_vendors_biz_no.
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① 새 표 넷만 만든다. **기존 표 · 칸 · 자료 · 권한은 건드리지 않는다** (201 의 두 표도 그대로)
--   ② RLS ENABLE + FORCE + erp_org_scope — ①②③. ④는 RLS 없음
--   ③ erp_app: upload_files = 읽기 · 넣기 · 지우기 / vendors = 읽기 · 넣기 · 고치기 · 지우기 /
--      invoices = 읽기 · 넣기 · vendor_id 만 고치기(합치기) / import_maps = 읽기만
--      anon · authenticated · PUBLIC 은 아무 권한 없음
--
-- 코드(TAX_INV_DIR · TAX_INV_CLASS · TAX_INV_TYPE · TAX_VENDOR_TP)와 대응표 한 줄은 204 가 넣는다.
-- =============================================================================

BEGIN;

-- 037 의 단체 ID 함수가 있어야 정책을 만들 수 있다. 없으면 여기서 멈춘다(반쯤 만들어지지 않게).
DO $$
BEGIN
  IF to_regprocedure('public.erp_current_org_id()') IS NULL
     OR to_regprocedure('public.erp_is_operator()') IS NULL THEN
    RAISE EXCEPTION '203 — erp_current_org_id() · erp_is_operator() 가 없다. 003 · 037 을 먼저 적용할 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 대응표 — 공용(회사 칸 없음)
-- -----------------------------------------------------------------------------
-- ★ 칸은 **이름이 아니라 번호**로 가리킨다 — 홈택스 목록에는 「상호 · 대표자명 · 주소 · 종사업장번호」가
--   공급자 쪽과 공급받는자 쪽에 한 번씩, 같은 이름으로 두 번 있다.
-- ★ 번호는 엑셀처럼 **1부터** 센다(줄 · 칸 모두). header_signature 는 제목 줄 전체 — 이것과 똑같아야
--   이 양식으로 인정한다(칸이 하나 늘거나 이름이 바뀌면 막는다).
CREATE TABLE IF NOT EXISTS public.tb_s050_import_maps (
  id               text PRIMARY KEY,
  kind             varchar(10) NOT NULL,
  name             varchar(100) NOT NULL,
  header_row       smallint NOT NULL CONSTRAINT ck_s050_import_maps_header_row CHECK (header_row >= 1),
  header_signature text[] NOT NULL
                   CONSTRAINT ck_s050_import_maps_signature CHECK (cardinality(header_signature) >= 1),
  columns          jsonb NOT NULL
                   CONSTRAINT ck_s050_import_maps_columns_object CHECK (jsonb_typeof(columns) = 'object'),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.tb_s050_import_maps IS
  '세무(S05) 대응표 — 기관 파일 한 양식 = 1줄. 공용(회사 칸 · RLS 없음), erp_app 은 읽기만. 줄은 마이그레이션이 넣는다.';
COMMENT ON COLUMN public.tb_s050_import_maps.kind IS '자료 종류 — 코드 TAX_KIND(000) 코드값.';
COMMENT ON COLUMN public.tb_s050_import_maps.header_row IS '제목 줄 번호(1부터).';
COMMENT ON COLUMN public.tb_s050_import_maps.header_signature IS '제목 줄의 칸 이름 전체(왼쪽부터). 파일과 똑같아야 이 양식으로 인정한다.';
COMMENT ON COLUMN public.tb_s050_import_maps.columns IS
  '표준 칸 → 원본 칸 번호(1부터) · 값 바꾸기표. 같은 이름 칸이 있어 이름이 아니라 번호로 가리킨다. 모양은 204 머리말.';
COMMENT ON COLUMN public.tb_s050_import_maps.is_active IS 'false 면 이 양식으로 올리기를 받지 않는다.';

-- -----------------------------------------------------------------------------
-- 2. 올린 파일 — 원본은 보관하지 않는다(결정 10)
-- -----------------------------------------------------------------------------
-- ★ 상한 5MB · 10,000줄(결정 11) — 서버가 먼저 막고, DB 가 한 번 더 막는다.
-- ★ 「작업 달」 칸이 없다 — 한 파일이 여러 달에 걸칠 수 있어, 달은 줄(작성일)로 센다.
CREATE TABLE IF NOT EXISTS public.tb_s050_upload_files (
  id             text PRIMARY KEY,
  org_id         integer NOT NULL,
  kind           varchar(10) NOT NULL,
  map_id         text NOT NULL
                 CONSTRAINT fk_s050_upload_files_map REFERENCES public.tb_s050_import_maps (id) ON DELETE RESTRICT,
  direction      varchar(10) NOT NULL
                 CONSTRAINT ck_s050_upload_files_direction CHECK (direction IN ('P', 'S')),
  file_name      varchar(255) NOT NULL,
  file_hash      char(64) NOT NULL
                 CONSTRAINT ck_s050_upload_files_hash CHECK (file_hash ~ '^[0-9a-f]{64}$'),
  file_size      integer NOT NULL
                 CONSTRAINT ck_s050_upload_files_size CHECK (file_size BETWEEN 1 AND 5242880),
  row_count      integer NOT NULL
                 CONSTRAINT ck_s050_upload_files_rows CHECK (row_count BETWEEN 0 AND 10000),
  inserted_count integer NOT NULL
                 CONSTRAINT ck_s050_upload_files_inserted CHECK (inserted_count BETWEEN 0 AND row_count),
  uploaded_at    timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_by    text,
  CONSTRAINT uq_s050_upload_files_hash UNIQUE (org_id, file_hash),
  -- 계산서 FK 가 단체까지 묶어 가리키는 자리(파일 머리말)
  CONSTRAINT uq_s050_upload_files_org_id UNIQUE (org_id, id)
);

COMMENT ON TABLE public.tb_s050_upload_files IS
  '세무(S05) 올린 파일 기록(s050200010). 원본은 보관하지 않고 지문(SHA-256)만. 같은 파일은 (org_id, file_hash) 로 막는다.';
COMMENT ON COLUMN public.tb_s050_upload_files.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_upload_files.kind IS '자료 종류 — 코드 TAX_KIND(000) 코드값.';
COMMENT ON COLUMN public.tb_s050_upload_files.map_id IS '어느 대응표로 읽었나(tb_s050_import_maps.id).';
COMMENT ON COLUMN public.tb_s050_upload_files.direction IS '계산서 구분 — 코드 TAX_INV_DIR(000) 코드값. P 매입 · S 매출.';
COMMENT ON COLUMN public.tb_s050_upload_files.file_hash IS '파일 바이트의 SHA-256(소문자 16진수 64자).';
COMMENT ON COLUMN public.tb_s050_upload_files.file_size IS '바이트. 상한 5MB.';
COMMENT ON COLUMN public.tb_s050_upload_files.row_count IS '파일의 자료 줄 수(제목 줄 아래). 상한 10,000.';
COMMENT ON COLUMN public.tb_s050_upload_files.inserted_count IS
  '새로 들어간 줄 수. 나머지는 승인번호 중복 · 수정·취소 · 사업자번호 빈 줄로 넣지 않은 것.';
COMMENT ON COLUMN public.tb_s050_upload_files.uploaded_by IS '삐용 회원 ID(s020MemberId).';

CREATE INDEX IF NOT EXISTS ix_s050_upload_files_org
  ON public.tb_s050_upload_files (org_id, uploaded_at DESC);

-- -----------------------------------------------------------------------------
-- 3. 거래처
-- -----------------------------------------------------------------------------
-- ★ 사업자번호는 숫자 10자리만 저장한다(하이픈은 화면이 붙인다). 끝자리 검증 번호는 **경고만**(결정 3) —
--   DB 는 자리 수만 본다.
-- ★ biz_no 는 비울 수 있다 — 시안의 고치기 창이 사업자번호를 필수로 두지 않는다. 업로드는 번호 없는 줄로
--   거래처를 만들지 않는다(결정 2).
CREATE TABLE IF NOT EXISTS public.tb_s050_vendors (
  id              text PRIMARY KEY,
  org_id          integer NOT NULL,
  name            varchar(100) NOT NULL
                  CONSTRAINT ck_s050_vendors_name CHECK (btrim(name) <> ''),
  biz_no          varchar(10)
                  CONSTRAINT ck_s050_vendors_biz_no CHECK (biz_no ~ '^[0-9]{10}$'),
  vendor_tp       varchar(10) NOT NULL
                  CONSTRAINT ck_s050_vendors_tp CHECK (vendor_tp IN ('M', 'G')),
  tp_set_by_user  boolean NOT NULL DEFAULT false,
  first_kind      varchar(10) NOT NULL,
  first_direction varchar(10)
                  CONSTRAINT ck_s050_vendors_first_direction CHECK (first_direction IN ('P', 'S')),
  created_at      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      text,
  updated_by      text,
  -- 계산서 FK 가 단체까지 묶어 가리키는 자리(파일 머리말)
  CONSTRAINT uq_s050_vendors_org_id UNIQUE (org_id, id)
);

COMMENT ON TABLE public.tb_s050_vendors IS
  '세무(S05) 거래처(s050100020) — 매입 · 매출로 나누지 않는 한 목록. 업로드 때 사업자번호로 자동으로 생긴다.';
COMMENT ON COLUMN public.tb_s050_vendors.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_vendors.name IS '거래처명. 업로드는 이미 있는 거래처의 이름을 고치지 않는다.';
COMMENT ON COLUMN public.tb_s050_vendors.biz_no IS
  '사업자번호(숫자 10자리). 같은 번호 거래처를 허용한다 — 업로드는 먼저 생긴 곳에 붙인다.';
COMMENT ON COLUMN public.tb_s050_vendors.vendor_tp IS '구분 — 코드 TAX_VENDOR_TP(000) 코드값. M 주거래처 · G 일반.';
COMMENT ON COLUMN public.tb_s050_vendors.tp_set_by_user IS
  '사용자가 구분을 정했으면 true — 그 뒤로 업로드가 구분을 바꾸지 않는다.';
COMMENT ON COLUMN public.tb_s050_vendors.first_kind IS '처음 생긴 자료 — 코드 TAX_KIND(000) 코드값.';
COMMENT ON COLUMN public.tb_s050_vendors.first_direction IS '처음 생긴 자료가 계산서면 그 구분 — 코드 TAX_INV_DIR(000).';
COMMENT ON COLUMN public.tb_s050_vendors.created_by IS '삐용 회원 ID(s020MemberId).';
COMMENT ON COLUMN public.tb_s050_vendors.updated_by IS '삐용 회원 ID(s020MemberId).';

-- 업로드가 「같은 사업자번호의 먼저 생긴 곳」을 찾는 색인
CREATE INDEX IF NOT EXISTS ix_s050_vendors_biz_no
  ON public.tb_s050_vendors (org_id, biz_no, created_at, id);

-- -----------------------------------------------------------------------------
-- 4. 세금계산서 줄 — 표준 양식
-- -----------------------------------------------------------------------------
-- ★ 거래처명 · 사업자번호는 파일에 적힌 그대로 둔다(_src). 화면은 거래처 표의 이름을 보인다 —
--   「고친 이름은 모든 달의 자료에 함께 바뀝니다」.
-- ★ 사업자번호가 빈 줄 · 수정 · 취소 줄(세부 종류가 「일반」이 아님)은 앱이 넣지 않는다(결정 2 · 6).
--   그래서 vendor_id · partner_biz_no_src 는 필수다.
CREATE TABLE IF NOT EXISTS public.tb_s050_invoices (
  id                 text PRIMARY KEY,
  org_id             integer NOT NULL,
  file_id            text NOT NULL,
  vendor_id          text NOT NULL,
  direction          varchar(10) NOT NULL
                     CONSTRAINT ck_s050_invoices_direction CHECK (direction IN ('P', 'S')),
  approval_no        varchar(40) NOT NULL
                     CONSTRAINT ck_s050_invoices_approval_no CHECK (btrim(approval_no) <> ''),
  write_date         date NOT NULL,
  partner_name_src   varchar(200) NOT NULL,
  partner_biz_no_src varchar(10) NOT NULL
                     CONSTRAINT ck_s050_invoices_biz_no CHECK (partner_biz_no_src ~ '^[0-9]{10}$'),
  supply_amount      bigint NOT NULL,
  tax_amount         bigint NOT NULL,
  total_amount       bigint NOT NULL,
  inv_class          varchar(10) NOT NULL,
  inv_type           varchar(10) NOT NULL,
  created_at         timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_s050_invoices_approval_no UNIQUE (org_id, approval_no),
  -- ★ 단체까지 묶는다 — 남의 단체 파일 · 거래처를 가리킬 수 없다(파일 머리말)
  CONSTRAINT fk_s050_invoices_file FOREIGN KEY (org_id, file_id)
    REFERENCES public.tb_s050_upload_files (org_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_s050_invoices_vendor FOREIGN KEY (org_id, vendor_id)
    REFERENCES public.tb_s050_vendors (org_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.tb_s050_invoices IS
  '세무(S05) 세금계산서 줄(표준 양식) — 1차는 홈택스 전자세금계산서 매입 · 매출. 같은 계산서는 (org_id, approval_no) 로 한 번만.';
COMMENT ON COLUMN public.tb_s050_invoices.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_invoices.file_id IS '들어온 파일. 파일을 지우면 이 줄도 지워진다(CASCADE).';
COMMENT ON COLUMN public.tb_s050_invoices.vendor_id IS '거래처. 가리키는 줄이 있으면 거래처를 지울 수 없다(RESTRICT) — 합치기는 먼저 옮긴다.';
COMMENT ON COLUMN public.tb_s050_invoices.direction IS '계산서 구분 — 코드 TAX_INV_DIR(000) 코드값. P 매입 · S 매출.';
COMMENT ON COLUMN public.tb_s050_invoices.approval_no IS '승인번호 — 파일에 적힌 그대로(앞뒤 공백만 걷음).';
COMMENT ON COLUMN public.tb_s050_invoices.write_date IS '작성일(공급 시기). 어느 달 자료인지 이 날짜로 정한다.';
COMMENT ON COLUMN public.tb_s050_invoices.partner_name_src IS '상대방 상호 — 파일에 적힌 그대로.';
COMMENT ON COLUMN public.tb_s050_invoices.partner_biz_no_src IS '상대방 사업자번호 — 파일 값의 숫자만.';
COMMENT ON COLUMN public.tb_s050_invoices.supply_amount IS '공급가액(원).';
COMMENT ON COLUMN public.tb_s050_invoices.tax_amount IS '세액(원).';
COMMENT ON COLUMN public.tb_s050_invoices.total_amount IS '합계금액(원).';
COMMENT ON COLUMN public.tb_s050_invoices.inv_class IS '종류 — 코드 TAX_INV_CLASS(000) 코드값.';
COMMENT ON COLUMN public.tb_s050_invoices.inv_type IS '세부 종류 — 코드 TAX_INV_TYPE(000) 코드값. 1차는 일반만 들어온다.';

CREATE INDEX IF NOT EXISTS ix_s050_invoices_org_date
  ON public.tb_s050_invoices (org_id, write_date);
CREATE INDEX IF NOT EXISTS ix_s050_invoices_vendor
  ON public.tb_s050_invoices (org_id, vendor_id);
CREATE INDEX IF NOT EXISTS ix_s050_invoices_file
  ON public.tb_s050_invoices (file_id);

-- -----------------------------------------------------------------------------
-- 5. RLS — 운영사는 전부, 회사는 자기 단체만 (201 과 같은 정책). 대응표는 없음
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tb_s050_upload_files', 'tb_s050_vendors', 'tb_s050_invoices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS erp_org_scope ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY erp_org_scope ON public.%I FOR ALL '
      'USING (public.erp_is_operator() OR org_id = public.erp_current_org_id()) '
      'WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id())', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6. 권한 — 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 준다(201 과 같다)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tb_s050_import_maps  FROM PUBLIC, anon, authenticated, erp_app;
REVOKE ALL ON public.tb_s050_upload_files FROM PUBLIC, anon, authenticated, erp_app;
REVOKE ALL ON public.tb_s050_vendors      FROM PUBLIC, anon, authenticated, erp_app;
REVOKE ALL ON public.tb_s050_invoices     FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT                         ON public.tb_s050_import_maps  TO erp_app;
GRANT SELECT, INSERT, DELETE         ON public.tb_s050_upload_files TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s050_vendors      TO erp_app;
GRANT SELECT, INSERT                 ON public.tb_s050_invoices     TO erp_app;
-- 계산서 줄은 합치기 때 거래처만 옮긴다 — 금액 · 승인번호는 고칠 수 없다
GRANT UPDATE (vendor_id)             ON public.tb_s050_invoices     TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-203.js (node scripts/verify-203.js .env packages/api/.env)
--   ★ 204 를 적용한 뒤 돌린다 — 시험 파일 줄이 204 의 대응표 줄(HOMETAX_TAX_INVOICE)을 가리킨다.
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('tb_s050_upload_files', 'tb_s050_vendors', 'tb_s050_invoices', 'tb_s050_import_maps');
--   -- 앞의 셋 t, t / import_maps f, f
-- node scripts/check-grants.js .env                                         -- anon · authenticated 0건 그대로
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 새 표 넷만 지운다(기존 표 · 권한은 건드린 것이 없다). 자료가 있으면 함께 사라진다.
--   204 를 적용했으면 204 의 되돌리기(코드 줄)를 먼저 돌린다. 대응표 줄은 이 표와 함께 사라진다.
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS public.tb_s050_invoices;
-- DROP TABLE IF EXISTS public.tb_s050_vendors;
-- DROP TABLE IF EXISTS public.tb_s050_upload_files;
-- DROP TABLE IF EXISTS public.tb_s050_import_maps;
-- COMMIT;
