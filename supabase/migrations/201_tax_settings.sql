-- =============================================================================
-- 201_tax_settings.sql
--
-- 세무(S05) 세무 설정(s050100010) — 표 둘 (1-1 멈춤 2, 2026-10-25, ★ 적용 전 승인 대기)
--
--   ① tb_s050_settings      세무 설정 — 회사(삐용 단체)당 1줄
--   ② tb_s050_fin_accounts  사업용 계좌 · 카드 — 한 표, 구분(kind)으로 나눈다
--
-- -----------------------------------------------------------------------------
-- ★★★ 회사 키는 삐용 단체 ID(org_id)다 — 037 법무 표와 같은 RLS(erp_org_scope)
-- -----------------------------------------------------------------------------
-- 운영사는 RLS 로는 전부 보인다(`withCompanyScope` 가 운영사에게 단체 ID 를 싣지 않는다).
-- 그래서 세무 API 는 **모든 조회 · 저장에 `org_id = 세션 단체 ID` 를 직접 건다**(운영사도 자기 단체만).
-- RLS 는 두 번째 겹이다 — 회사 세션이 남의 단체 줄을 보거나 넣는 것을 DB 가 한 번 더 막는다.
--
-- -----------------------------------------------------------------------------
-- ★★ 회사 기본정보(상호 · 사업자번호 · 법인번호 …)는 여기 두지 않는다
-- -----------------------------------------------------------------------------
-- ERP 입주사 표 · 법무 회사 정보 표에 있고(삐용과 동기화된 값), 세무는 법무 `readCompanySource` 로
-- 읽는다(멈춤 3). 세무 표에 사본을 두면 삐용에서 고쳐도 세무만 옛 값을 들고 있게 된다.
--
-- -----------------------------------------------------------------------------
-- ★★ 기관 코드는 두 칸이다 — bank_code(은행) · card_co_code(카드사)
-- -----------------------------------------------------------------------------
-- 코드 지우기 막기(`packages/shared/src/domain/code-usage.ts` 의 `CODE_USAGE`)는 한 줄이
-- (분류, 파티션, 표, 칸) 하나이고, 세는 쪽(`api/src/db/codes.ts` `countCodeUsage`)은
-- `WHERE <칸> = 코드` 로 **표 전체를 센다** — 「kind = 'B' 인 줄만」 같은 조건을 둘 자리가 없다.
-- 한 칸에 BANK · CARD_COMPANY 를 같이 선언하면 두 분류의 코드값이 겹칠 때 남의 분류 줄까지
-- 세어 **안 쓰는 코드를 못 지우게** 된다. 그래서 칸을 나누고, kind 에 맞는 칸만 채우도록 CHECK 를 건다.
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   ① 새 표 둘만 만든다. **기존 표 · 칸 · 자료 · 권한은 건드리지 않는다**
--   ② FK 없음 — 계좌 · 카드 지우기 막기(올린 자료가 가리키면 RESTRICT)는 1-2 에서 건다
--   ③ RLS ENABLE + FORCE + erp_org_scope(037 과 같은 정책)
--   ④ erp_app: settings = 읽기 · 넣기 · 고치기(지우기 없음) / fin_accounts = 읽기 · 넣기 · 고치기 · 지우기
--      anon · authenticated · PUBLIC 은 아무 권한 없음
--
-- 코드 표(TAX_WH_CYCLE · TAX_KIND · TAX_BIZ_TP · TAX_FIN_KIND · BANK · CARD_COMPANY)는 202 가 넣는다.
-- 코드 칸에 FK 는 없다(ERP 공통 — 업무 표에서 코드표로 가는 FK 는 0건, code-usage.ts 머리말).
-- =============================================================================

BEGIN;

-- 037 의 단체 ID 함수가 있어야 정책을 만들 수 있다. 없으면 여기서 멈춘다(반쯤 만들어지지 않게).
DO $$
BEGIN
  IF to_regprocedure('public.erp_current_org_id()') IS NULL
     OR to_regprocedure('public.erp_is_operator()') IS NULL THEN
    RAISE EXCEPTION '201 — erp_current_org_id() · erp_is_operator() 가 없다. 003 · 037 을 먼저 적용할 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 세무 설정 — 회사당 1줄
-- -----------------------------------------------------------------------------
-- ★ 줄이 없으면 「아직 설정 안 함」이다. 첫 [저장] 때 생긴다.
-- ★ 세무사 메일 「최대 3」은 서버만 검사한다(DB 는 강제하지 않는다). 이름 · 메일이 둘 다 빈 줄은
--   서버가 버리고 저장한다.
CREATE TABLE IF NOT EXISTS public.tb_s050_settings (
  org_id            integer PRIMARY KEY,
  biz_type          varchar(10) NOT NULL,
  withholding_cycle varchar(10) NOT NULL DEFAULT 'M',
  tax_emails        jsonb NOT NULL DEFAULT '[]'::jsonb
                    CONSTRAINT ck_s050_settings_tax_emails_array CHECK (jsonb_typeof(tax_emails) = 'array'),
  unused_kinds      text[] NOT NULL DEFAULT '{}',
  created_at        timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        text,
  updated_by        text
);

COMMENT ON TABLE public.tb_s050_settings IS
  '세무(S05) 세무 설정 — 삐용 단체 1곳당 1줄(s050100010). 회사 기본정보는 두지 않는다(ERP · 법무 표가 정본).';
COMMENT ON COLUMN public.tb_s050_settings.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_settings.biz_type IS '사업자 유형 — 코드 TAX_BIZ_TP(000) 코드값.';
COMMENT ON COLUMN public.tb_s050_settings.withholding_cycle IS '원천세 신고 주기 — 코드 TAX_WH_CYCLE(000) 코드값. 기본 M(매월).';
COMMENT ON COLUMN public.tb_s050_settings.tax_emails IS
  '세무사 메일 목록 — [{ "name": 이름 · 역할(선택), "email": 메일(필수) }]. 최대 3은 서버만 검사한다.';
COMMENT ON COLUMN public.tb_s050_settings.unused_kinds IS
  '쓰지 않는 자료 — 코드 TAX_KIND(000) 코드값 목록. ★ 목록 칸이라 코드 지우기 막기가 세지 못한다 — TAX_KIND 는 고정 코드로 막는다.';
COMMENT ON COLUMN public.tb_s050_settings.created_by IS '삐용 회원 ID(s020MemberId).';
COMMENT ON COLUMN public.tb_s050_settings.updated_by IS '삐용 회원 ID(s020MemberId).';

-- -----------------------------------------------------------------------------
-- 2. 사업용 계좌 · 카드 — 한 표, kind 로 나눈다
-- -----------------------------------------------------------------------------
-- ★★ 카드 전체 번호 · 유효기간은 저장하지 않는다 — 카드는 끝 4자리뿐이다.
-- ★ 번호는 숫자만 저장한다. 은행(B) 계좌번호 10~14자리 · 카드(C) 끝 4자리 — kind 에 따라 DB 가 검사한다.
--   하이픈은 화면이 보여 줄 때만 붙인다.
-- ★ kind 값(B · C)은 코드 TAX_FIN_KIND 의 코드값이다. 번호 검사가 kind 에 기대므로 고정 코드다.
-- ★ 별칭(alias)은 코드가 아니다 — 회사가 붙이는 자유 글.
CREATE TABLE IF NOT EXISTS public.tb_s050_fin_accounts (
  id           text PRIMARY KEY,
  org_id       integer NOT NULL,
  kind         varchar(10) NOT NULL
               CONSTRAINT ck_s050_fin_accounts_kind CHECK (kind IN ('B', 'C')),
  bank_code    varchar(10),
  card_co_code varchar(10),
  number       varchar(14) NOT NULL,
  alias        varchar(50),
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   smallint NOT NULL DEFAULT 0,
  created_at   timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   text,
  updated_by   text,
  CONSTRAINT ck_s050_fin_accounts_inst CHECK (
    (kind = 'B' AND bank_code IS NOT NULL AND card_co_code IS NULL) OR
    (kind = 'C' AND card_co_code IS NOT NULL AND bank_code IS NULL)
  ),
  CONSTRAINT ck_s050_fin_accounts_number CHECK (
    (kind = 'B' AND number ~ '^[0-9]{10,14}$') OR
    (kind = 'C' AND number ~ '^[0-9]{4}$')
  )
);

COMMENT ON TABLE public.tb_s050_fin_accounts IS
  '세무(S05) 사업용 계좌 · 카드 — 구분(kind) B 은행 · C 카드. 카드는 끝 4자리만(전체 번호 · 유효기간 없음).';
COMMENT ON COLUMN public.tb_s050_fin_accounts.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s050_fin_accounts.kind IS '구분 — 코드 TAX_FIN_KIND(000) 코드값. B 은행 · C 카드.';
COMMENT ON COLUMN public.tb_s050_fin_accounts.bank_code IS '은행 — 코드 BANK(000) 코드값. kind = B 일 때만 채운다.';
COMMENT ON COLUMN public.tb_s050_fin_accounts.card_co_code IS '카드사 — 코드 CARD_COMPANY(000) 코드값. kind = C 일 때만 채운다.';
COMMENT ON COLUMN public.tb_s050_fin_accounts.number IS '번호(숫자만) — B 계좌번호 10~14자리 · C 카드 끝 4자리.';
COMMENT ON COLUMN public.tb_s050_fin_accounts.alias IS '별칭 — 회사가 붙이는 자유 글(코드 아님).';
COMMENT ON COLUMN public.tb_s050_fin_accounts.is_active IS '사용 여부 — false 면 목록에서 숨긴다(「사용 안 함」).';
COMMENT ON COLUMN public.tb_s050_fin_accounts.created_by IS '삐용 회원 ID(s020MemberId).';
COMMENT ON COLUMN public.tb_s050_fin_accounts.updated_by IS '삐용 회원 ID(s020MemberId).';

CREATE INDEX IF NOT EXISTS ix_s050_fin_accounts_org
  ON public.tb_s050_fin_accounts (org_id, kind, sort_order);

-- -----------------------------------------------------------------------------
-- 3. RLS — 운영사는 전부, 회사는 자기 단체만 (037 과 같은 정책)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tb_s050_settings', 'tb_s050_fin_accounts'] LOOP
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
-- 4. 권한 — 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙였을 수 있는 것을 먼저 거둔 뒤 준다(040 과 같다)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tb_s050_settings     FROM PUBLIC, anon, authenticated, erp_app;
REVOKE ALL ON public.tb_s050_fin_accounts FROM PUBLIC, anon, authenticated, erp_app;
GRANT SELECT, INSERT, UPDATE         ON public.tb_s050_settings     TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s050_fin_accounts TO erp_app;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-201.js (node scripts/verify-201.js .env packages/api/.env)
-- =============================================================================
-- SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--  WHERE relname IN ('tb_s050_settings', 'tb_s050_fin_accounts');          -- 둘 다 t, t
-- SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants
--  WHERE grantee = 'erp_app' AND table_name LIKE 'tb_s050_%' GROUP BY 1;
--   -- tb_s050_fin_accounts : DELETE,INSERT,SELECT,UPDATE / tb_s050_settings : INSERT,SELECT,UPDATE
-- node scripts/check-grants.js .env                                         -- anon · authenticated 0건 그대로
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 새 표 둘만 지운다(기존 표 · 권한은 건드린 것이 없다). 자료가 있으면 함께 사라진다
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS public.tb_s050_fin_accounts;
-- DROP TABLE IF EXISTS public.tb_s050_settings;
-- COMMIT;
