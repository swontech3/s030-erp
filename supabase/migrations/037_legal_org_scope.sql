-- =============================================================================
-- 037_legal_org_scope.sql
--
-- 법무 서비스(S04) 기초 — 법무 표를 **삐용 단체 ID** 로 가른다 (결정 2026-10-09).
--
-- -----------------------------------------------------------------------------
-- ★★★ 왜 회사 번호(company_id)가 아니라 삐용 단체 ID 인가
-- -----------------------------------------------------------------------------
-- 법무의 손님은 입주사만이 아니다. 운영사가 삐용에 등록한 **비입주사**도 로그인해서
-- 자기 법인변경 서류를 뽑는다. 비입주사는 `tb_s080_companies` 에 행이 없으므로
-- 세션의 `companyId` 가 null 이고, 기존 장치(`app.current_company_id`)로는 아무것도
-- 볼 수 없다. 두 쪽이 공통으로 가진 것은 삐용 단체 ID(`s020OrgId`) 하나뿐이다.
--
--   · 회사 정본 = 삐용 단체. 법무는 회사를 만들지 않는다
--   · 입주사 여부는 **저장하지 않는다** — 읽을 때 `tb_s080_companies.link_s020_org_id`
--     에 그 단체가 있으면 입주사다(퇴실한 입주사도 입주사로 본다)
--   · 입주사 정보는 ERP 에서 읽기만 한다. 비입주사 정보만 `tb_s080_legal_orgs` 에 둔다
--
-- -----------------------------------------------------------------------------
-- 하는 일
-- -----------------------------------------------------------------------------
--   ① tb_s080_corp_changes — 회사 사본 칸 · company_id · is_member 를 **지운다**.
--      org_id(NOT NULL) · org_code · submit_snapshot 을 더한다.
--   ② tb_s080_corp_change_officers — org_id 를 더하고 부모 건과 같은 단체임을 FK 로 묶는다
--   ③ tb_s080_legal_orgs — 비입주사 법무 정보(회사당 1행). 회사명은 없다(삐용에서 온다)
--   ④ erp_current_org_id() — RLS 판정용. `withCompanyScope` 가 `app.current_org_id` 를 넣는다
--   ⑤ RLS — 셋 모두 `erp_is_operator() OR org_id = erp_current_org_id()`
--
-- ★★ 지우는 칸이 있다. **두 표가 0건일 때만** 진행한다 — 행이 있으면 아래 DO 블록이
--    멈춘다(회사 사본을 org_id 로 옮길 규칙이 없다. 손으로 정할 일이다).
--
-- ★ 이번 범위 밖(다음 단계): 법인설립 표(`tb_s080_incorporations` 등)는 아직
--   company_id 그대로다 — 법인설립은 법인변경 다음이다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 안전장치 — 두 표가 비어 있어야 한다
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n_changes  integer;
  n_officers integer;
BEGIN
  SELECT count(*) INTO n_changes  FROM public.tb_s080_corp_changes;
  SELECT count(*) INTO n_officers FROM public.tb_s080_corp_change_officers;
  IF n_changes > 0 OR n_officers > 0 THEN
    RAISE EXCEPTION '037 중단 — 법인변경 % 건 · 임원 % 건이 있다. 회사 사본을 지우기 전에 옮길 규칙을 먼저 정한다',
      n_changes, n_officers;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. RLS 판정 함수 — 삐용 단체 ID
-- -----------------------------------------------------------------------------
-- ★ 003 의 erp_current_company_id() 와 같은 모양이다. GUC 가 없으면 NULL → 아무것도
--   안 보인다(fail-closed). 숫자가 아닌 값이 들어오면 캐스트가 실패해 **쿼리가 실패한다**
--   — 그것도 닫힌 쪽이다.
CREATE OR REPLACE FUNCTION public.erp_current_org_id() RETURNS integer
  LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '')::integer
$$;

COMMENT ON FUNCTION public.erp_current_org_id() IS
  'RLS 판정용 — 삐용 단체 ID. Fastify 의 withCompanyScope 가 트랜잭션마다 '
  'set_config(''app.current_org_id'', …, true) 로 넣는다. 법무 표(S04)가 이것으로 갈린다.';

-- ★ 006 과 같은 처리 — 함수의 기본 EXECUTE 는 PUBLIC 에 열린다. 닫고 erp_app 에만 준다.
REVOKE ALL ON FUNCTION public.erp_current_org_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_current_org_id() TO erp_app;

-- -----------------------------------------------------------------------------
-- 2. 법인변경 건 — 회사 사본을 지우고 단체 ID 를 단다
-- -----------------------------------------------------------------------------
-- ★ 지우는 칸: 회사명 · 법인번호 · 사업자번호 · 대표 · 전화 · 본점 3칸 · company_id · is_member.
--   레거시는 건을 만들 때 회사 정보를 **복사**해 두었다. 이제 입주사는 ERP 를 읽고,
--   비입주사는 tb_s080_legal_orgs 를 읽는다 — 복사본이 있으면 둘이 갈린다.
-- ★ company_id 를 지우면 그 칸의 인덱스(`…_operator_id_company_id_idx`)도 함께 사라진다.
ALTER TABLE public.tb_s080_corp_changes
  DROP COLUMN IF EXISTS company_name,
  DROP COLUMN IF EXISTS corp_number,
  DROP COLUMN IF EXISTS biz_number,
  DROP COLUMN IF EXISTS ceo_name,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS hq_zip_code,
  DROP COLUMN IF EXISTS hq_address,
  DROP COLUMN IF EXISTS hq_address_detail,
  DROP COLUMN IF EXISTS company_id,
  DROP COLUMN IF EXISTS is_member;

ALTER TABLE public.tb_s080_corp_changes
  ADD COLUMN IF NOT EXISTS org_id          integer NOT NULL,
  ADD COLUMN IF NOT EXISTS org_code        varchar(3),
  ADD COLUMN IF NOT EXISTS submit_snapshot jsonb;

COMMENT ON COLUMN public.tb_s080_corp_changes.org_id IS
  '삐용 단체 ID — 이 건의 회사. ★ RLS 가 이 칸으로 가른다(erp_current_org_id). '
  '입주사 여부는 저장하지 않는다 — tb_s080_companies.link_s020_org_id 에 있으면 입주사다.';
COMMENT ON COLUMN public.tb_s080_corp_changes.org_code IS
  '삐용 단체코드 — **표시용**이다. 판정에 쓰지 않는다(판정은 org_id).';
COMMENT ON COLUMN public.tb_s080_corp_changes.submit_snapshot IS
  '제출 시점 기록 — 변경 전 값과 서류에 들어간 값. 회사 정보는 복사하지 않고 읽으므로, '
  '상호변경이 끝나 ERP 회사명이 바뀌면 변경 전 이름이 사라진다. 그것을 제출할 때 여기 남긴다. '
  'NULL = 아직 제출하지 않았다.';

CREATE INDEX IF NOT EXISTS tb_s080_corp_changes_operator_id_org_id_idx
  ON public.tb_s080_corp_changes (operator_id, org_id);

-- ★ 임원이 부모 건과 **같은 단체**임을 DB 가 묶는 데 쓰는 짝. id 가 PK 라 늘 유일하지만,
--   복합 FK 는 참조 대상에 그 두 칸의 UNIQUE 를 요구한다.
ALTER TABLE public.tb_s080_corp_changes
  DROP CONSTRAINT IF EXISTS ux_s080_corp_changes_id_org;
ALTER TABLE public.tb_s080_corp_changes
  ADD CONSTRAINT ux_s080_corp_changes_id_org UNIQUE (id, org_id);

-- -----------------------------------------------------------------------------
-- 3. 임원 — 단체 ID 를 달고 부모와 묶는다
-- -----------------------------------------------------------------------------
-- ★★ 레거시 결함(임원 IDOR): `officers/[oid]` 수정·삭제가 그 임원이 그 건 소속인지 보지
--    않았다. 여기서 두 겹으로 막는다 — ① RLS 가 남의 단체 임원을 아예 안 보이게 하고
--    ② 복합 FK 가 「부모 건과 다른 단체의 임원」이라는 행 자체를 만들 수 없게 한다.
ALTER TABLE public.tb_s080_corp_change_officers
  ADD COLUMN IF NOT EXISTS org_id integer NOT NULL;

COMMENT ON COLUMN public.tb_s080_corp_change_officers.org_id IS
  '삐용 단체 ID — 부모 건(corp_change_id)의 org_id 와 같다(복합 FK). RLS 가 이 칸으로 가른다.';

ALTER TABLE public.tb_s080_corp_change_officers
  DROP CONSTRAINT IF EXISTS fk_s080_corp_change_officers_change_org;
ALTER TABLE public.tb_s080_corp_change_officers
  ADD CONSTRAINT fk_s080_corp_change_officers_change_org
  FOREIGN KEY (corp_change_id, org_id)
  REFERENCES public.tb_s080_corp_changes (id, org_id)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 4. 비입주사 법무 정보 — 회사당 1행
-- -----------------------------------------------------------------------------
-- ★★ **회사명 칸이 없다.** 회사명은 삐용 단체에서 온다(정본). 여기 두면 삐용에서 이름이
--    바뀌어도 법무 서류만 옛 이름을 들고 있게 된다.
-- ★★ **입주사 행을 여기 두지 않는다.** 입주사는 tb_s080_companies 를 읽는다(복사 금지).
--    그 판정은 저장하지 않으므로 이 표가 막지는 못한다 — 쓰는 코드가 지킨다.
-- ★ 칸 이름은 tb_s080_companies 와 맞췄다 — 본점은 head_*, 대표 자택은 ceo_*(011).
--   서류를 그리는 코드가 두 출처를 같은 이름으로 읽게 하기 위해서다.
CREATE TABLE IF NOT EXISTS public.tb_s080_legal_orgs (
  org_id              integer PRIMARY KEY,
  corp_number         varchar(20),
  biz_number          varchar(20),
  ceo_name            varchar(50),
  tel                 varchar(30),
  head_zip_code       varchar(10),
  head_address        text,
  head_address_detail varchar(200),
  ceo_zip_code        varchar(10),
  ceo_address         text,
  ceo_address_detail  varchar(200),
  created_at          timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          text,
  updated_by          text
);

COMMENT ON TABLE public.tb_s080_legal_orgs IS
  '비입주사 법무 정보 — 삐용 단체 1곳당 1행. 회사명은 없다(삐용 단체가 정본). '
  '입주사는 이 표가 아니라 tb_s080_companies 를 읽는다(복사 금지, 결정 2026-10-09).';
COMMENT ON COLUMN public.tb_s080_legal_orgs.org_id IS '삐용 단체 ID. RLS 가 이 칸으로 가른다.';
COMMENT ON COLUMN public.tb_s080_legal_orgs.head_address IS '본점 주소.';
COMMENT ON COLUMN public.tb_s080_legal_orgs.ceo_address IS
  '대표자 자택 주소 — 대표 주소 변경 등기에 쓴다. 본점과 섞지 않는다(011 과 같은 구분).';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_legal_orgs TO erp_app;

-- -----------------------------------------------------------------------------
-- 5. RLS — 운영사는 전부, 회사는 자기 단체만
-- -----------------------------------------------------------------------------
-- ★ FORCE 는 표 주인(postgres)에게도 정책을 건다. erp_app 은 주인이 아니라 ENABLE 로
--   충분하지만 021·024 와 같게 둔다 — 누가 주인으로 접속해도 같은 규칙이다.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tb_s080_corp_changes', 'tb_s080_corp_change_officers', 'tb_s080_legal_orgs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS erp_org_scope ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY erp_org_scope ON public.%I FOR ALL '
      'USING (public.erp_is_operator() OR org_id = public.erp_current_org_id()) '
      'WITH CHECK (public.erp_is_operator() OR org_id = public.erp_current_org_id())', t);
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-037.js (적용 전: --dry-run 으로 롤백 안에서 돌려 본다)
-- =============================================================================
-- 1) 칸
--    SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tb_s080_corp_changes' ORDER BY ordinal_position;
--    -- company_name · company_id · is_member 가 없고 org_id · org_code · submit_snapshot 이 있다
-- 2) RLS
--    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--     WHERE relname IN ('tb_s080_corp_changes','tb_s080_corp_change_officers','tb_s080_legal_orgs');
--    -- 셋 다 t, t
-- 3) 함수 권한
--    SELECT has_function_privilege('erp_app', 'public.erp_current_org_id()', 'EXECUTE');  -- t
--    SELECT has_function_privilege('anon',    'public.erp_current_org_id()', 'EXECUTE');  -- f
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 지운 회사 사본 칸은 **빈 칸으로** 돌아온다(0건에서 지웠으므로 잃은 값은 없다)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DROP POLICY IF EXISTS erp_org_scope ON public.tb_s080_corp_changes;
-- DROP POLICY IF EXISTS erp_org_scope ON public.tb_s080_corp_change_officers;
-- ALTER TABLE public.tb_s080_corp_changes         NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_s080_corp_change_officers NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
-- DROP TABLE IF EXISTS public.tb_s080_legal_orgs;
-- ALTER TABLE public.tb_s080_corp_change_officers
--   DROP CONSTRAINT IF EXISTS fk_s080_corp_change_officers_change_org, DROP COLUMN IF EXISTS org_id;
-- ALTER TABLE public.tb_s080_corp_changes
--   DROP CONSTRAINT IF EXISTS ux_s080_corp_changes_id_org,
--   DROP COLUMN IF EXISTS org_id, DROP COLUMN IF EXISTS org_code, DROP COLUMN IF EXISTS submit_snapshot,
--   ADD COLUMN company_id text, ADD COLUMN is_member boolean NOT NULL DEFAULT true,
--   ADD COLUMN company_name text NOT NULL DEFAULT '', ADD COLUMN corp_number text, ADD COLUMN biz_number text,
--   ADD COLUMN ceo_name text, ADD COLUMN phone text, ADD COLUMN hq_zip_code varchar,
--   ADD COLUMN hq_address text, ADD COLUMN hq_address_detail varchar;
-- CREATE INDEX tb_s080_corp_changes_operator_id_company_id_idx ON public.tb_s080_corp_changes (operator_id, company_id);
-- DROP FUNCTION IF EXISTS public.erp_current_org_id();
-- COMMIT;
