-- =============================================================================
-- 042_incorporation_org_scope.sql
--
-- 법인설립(010) — 설립 표를 **삐용 단체 ID** 로 가르고, 결정에 맞춰 칸을 고친다 (10-2, 2026-10-11)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 레거시 설립 표는 회사를 `tb_s080_companies`(company_id, FK)로 가리켰다. 결정(2026-10-11):
--   · 설립 건의 키 = 삐용 단체 ID. 입주 예정사도 운영사가 삐용에 먼저 등록한 단체로만 시작한다
--   · 법무는 ERP 에 쓰지 않는다 — 회사 행을 만들거나 고치지 않는다
--   · 상호(국문 · 영문) · 본점을 설립 건에 둔다 · 사업목적은 텍스트 칸 하나
--   · 금액 · 주식 수는 bigint(레거시 integer 는 21억에서 끝난다)
-- 037 이 법인변경 표에 한 것과 같은 방식이다(org_id + RLS erp_org_scope + 사람 표 복합 FK).
--
-- -----------------------------------------------------------------------------
-- 하는 일 · 영향
-- -----------------------------------------------------------------------------
--   0. 안전장치 — 설립 건 · 사람 표가 **0건**일 때만 진행한다(아니면 스스로 멈춘다)
--   ① tb_s080_incorporations
--      · company_id 를 지운다(FK · 인덱스 함께). 대신 org_id(NOT NULL) · org_code(표시용)
--      · submitted_at → written_at(작성완료 시각, 039 와 같은 이름) · submit_snapshot(jsonb) 더함
--      · 상호 name_ko · name_en, 본점 head_zip_code · head_address · head_address_detail, 사업목적 purposes 더함
--      · capital_amount · par_value · units_authorized · units_issued → bigint
--      · (operator_id, org_id) 인덱스 · (id, org_id) UNIQUE(사람 표 복합 FK 의 짝)
--   ② tb_s080_incorp_persons — org_id(NOT NULL) + 부모 건과 같은 단체임을 복합 FK 로 묶는다 ·
--      units_subscribed → bigint
--   ③ RLS — 두 표 모두 `erp_is_operator() OR org_id = erp_current_org_id()` (037 과 같은 정책 · FORCE)
--   ④ erp_app 권한은 그대로(읽기 · 넣기 · 고치기 · 지우기 — 삭제는 P · X 건만, 앱이 막는다)
--
-- ★ 그대로 두는 것: tb_s080_incorp_purposes(결정 5 — 쓰지 않는다. RLS 꺼짐 · erp_app 4권한 그대로,
--   부모 FK CASCADE 그대로) · entity_type · establishment_method · company_type_position · contract_id ·
--   planned_date · persons 의 member_id · rrn_iv(ERP 암호화는 rrn_cipher 한 칸, rrn_iv 는 늘 NULL — 037 임원과 같다)
-- ★ 레거시 S-WonERP(Prisma)는 company_id 를 읽는다 — 레거시 앱이 붙어 있으면 설립 화면이 깨진다(037 과 같은 사정).
--
-- 되돌리기: 0건일 때만 의미가 있다 — 정책 · FK · 칸을 지우고 company_id(text NOT NULL, FK)를 다시 단다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 안전장치 — 두 표가 비어 있어야 한다
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n_inc     integer;
  n_persons integer;
BEGIN
  SELECT count(*) INTO n_inc     FROM public.tb_s080_incorporations;
  SELECT count(*) INTO n_persons FROM public.tb_s080_incorp_persons;
  IF n_inc > 0 OR n_persons > 0 THEN
    RAISE EXCEPTION '042 중단 — 설립 건 % 건 · 사람 % 건이 있다. company_id 를 org_id 로 옮길 규칙을 먼저 정한다',
      n_inc, n_persons;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 설립 건
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s080_incorporations
  DROP COLUMN IF EXISTS company_id;

ALTER TABLE public.tb_s080_incorporations RENAME COLUMN submitted_at TO written_at;

ALTER TABLE public.tb_s080_incorporations
  ADD COLUMN IF NOT EXISTS org_id              integer NOT NULL,
  ADD COLUMN IF NOT EXISTS org_code            varchar(3),
  ADD COLUMN IF NOT EXISTS submit_snapshot     jsonb,
  ADD COLUMN IF NOT EXISTS name_ko             text,
  ADD COLUMN IF NOT EXISTS name_en             text,
  ADD COLUMN IF NOT EXISTS head_zip_code       varchar(10),
  ADD COLUMN IF NOT EXISTS head_address        text,
  ADD COLUMN IF NOT EXISTS head_address_detail varchar(200),
  ADD COLUMN IF NOT EXISTS purposes            text;

ALTER TABLE public.tb_s080_incorporations
  ALTER COLUMN capital_amount   TYPE bigint,
  ALTER COLUMN par_value        TYPE bigint,
  ALTER COLUMN units_authorized TYPE bigint,
  ALTER COLUMN units_issued     TYPE bigint;

COMMENT ON COLUMN public.tb_s080_incorporations.org_id IS
  '삐용 단체 ID — 이 설립 건의 회사. ★ RLS 가 이 칸으로 가른다(erp_current_org_id). '
  '입주 예정사도 운영사가 삐용에 먼저 등록한 단체다(결정 2026-10-11). ERP 회사표를 가리키지 않는다.';
COMMENT ON COLUMN public.tb_s080_incorporations.org_code IS '삐용 단체코드 — 표시용(판정은 org_id).';
COMMENT ON COLUMN public.tb_s080_incorporations.written_at IS
  '작성완료(P→E) 시각. 서류수정(E→P) 뒤 다시 작성완료하면 바뀐다(039 와 같은 뜻).';
COMMENT ON COLUMN public.tb_s080_incorporations.submit_snapshot IS
  '작성완료 시점 기록 — 서류에 들어간 값. 주민번호는 넣지 않는다. NULL = 아직 작성완료하지 않았다.';
COMMENT ON COLUMN public.tb_s080_incorporations.name_ko IS '설립할 회사의 국문 상호 — 「주식회사」를 뺀 이름.';
COMMENT ON COLUMN public.tb_s080_incorporations.purposes IS
  '사업목적 — 한 줄에 하나(최대 20줄, 앱이 막는다). tb_s080_incorp_purposes 는 쓰지 않는다.';

DROP INDEX IF EXISTS public.tb_s080_incorporations_operator_id_company_id_idx;
CREATE INDEX IF NOT EXISTS tb_s080_incorporations_operator_id_org_id_idx
  ON public.tb_s080_incorporations (operator_id, org_id);

ALTER TABLE public.tb_s080_incorporations
  DROP CONSTRAINT IF EXISTS ux_s080_incorporations_id_org;
ALTER TABLE public.tb_s080_incorporations
  ADD CONSTRAINT ux_s080_incorporations_id_org UNIQUE (id, org_id);

-- -----------------------------------------------------------------------------
-- 2. 사람(발기인 · 이사 · 감사 · 대표이사) — 단체 ID 를 달고 부모와 묶는다
-- -----------------------------------------------------------------------------
-- ★ 037 임원과 같은 두 겹: RLS 가 남의 단체 사람을 안 보이게 하고, 복합 FK 가 「부모 건과 다른 단체의
--   사람」이라는 행 자체를 만들 수 없게 한다(레거시 persons/[pid] 는 그 사람이 그 건 소속인지 보지 않았다).
ALTER TABLE public.tb_s080_incorp_persons
  ADD COLUMN IF NOT EXISTS org_id integer NOT NULL;

ALTER TABLE public.tb_s080_incorp_persons
  ALTER COLUMN units_subscribed TYPE bigint;

COMMENT ON COLUMN public.tb_s080_incorp_persons.org_id IS
  '삐용 단체 ID — 부모 건(incorporation_id)의 org_id 와 같다(복합 FK). RLS 가 이 칸으로 가른다.';

ALTER TABLE public.tb_s080_incorp_persons
  DROP CONSTRAINT IF EXISTS fk_s080_incorp_persons_inc_org;
ALTER TABLE public.tb_s080_incorp_persons
  ADD CONSTRAINT fk_s080_incorp_persons_inc_org
  FOREIGN KEY (incorporation_id, org_id)
  REFERENCES public.tb_s080_incorporations (id, org_id)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 3. RLS — 운영사는 전부, 회사는 자기 단체만 (037 과 같은 정책)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tb_s080_incorporations', 'tb_s080_incorp_persons'] LOOP
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
-- 검증 — scripts/verify-042.js (적용 전: --dry-run 으로 롤백 안에서 돌려 본다)
-- =============================================================================
