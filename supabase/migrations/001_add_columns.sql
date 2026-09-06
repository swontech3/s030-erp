-- =============================================================================
-- 001_add_columns.sql
-- 무해한 컬럼 추가 — 전부 nullable 또는 신규 테이블. 기존 앱(S-WonERP) 영향 없음.
-- 대상 DB: public 스키마 (tb_s080_* 확장 — D1 철회, 이동하지 않는다)
-- 선행조건: pg_dump 백업 완료. 데이터는 시드 약 370행(SCHEMA_ANALYSIS.md §6.2).
-- 되돌리기: 파일 하단 ROLLBACK 블록 참조.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. tb_s080_companies — 삐용 조직 연결 (ORG_ARCHITECTURE.md §1-5 / ACL-01′)
-- -----------------------------------------------------------------------------
-- FK를 걸지 않는다 — 스키마 경계(지시서 3장 "✗ 삐용 DB 직접 조회·조인·외래키").
-- 삐용 org_id는 정수 하나로만 참조한다. 선례: tb_s090_org010.link_s020_org_id.

ALTER TABLE public.tb_s080_companies
  ADD COLUMN link_s020_org_id integer,
  ADD COLUMN link_linked_at   timestamp(3) without time zone,
  ADD COLUMN link_linked_by   text;

COMMENT ON COLUMN public.tb_s080_companies.link_s020_org_id IS
  '삐용(s02) 조직 ID. FK 없음(스키마 경계, tb_s020_t001은 별도 스키마). '
  '운영사가 화면에서 수기 연결한다. UNIQUE — 한 삐용 org는 입주사 하나에만 연결 가능.';
COMMENT ON COLUMN public.tb_s080_companies.link_linked_at IS '삐용 조직 연결 시각(감사)';
COMMENT ON COLUMN public.tb_s080_companies.link_linked_by IS '연결한 운영사 직원 식별자(감사)';

-- 격리의 마지막 방어선 — 한 삐용 org가 두 입주사에 붙으면 스코프 해석이
-- 두 회사를 돌려주고 격리가 조용히 무너진다(ORG_ARCHITECTURE.md §1-4).
-- NULL은 다수 허용(연결 안 된 입주사), 값은 유일해야 한다.
ALTER TABLE public.tb_s080_companies
  ADD CONSTRAINT ux_s080_companies_link_s020_org UNIQUE (link_s020_org_id);

-- -----------------------------------------------------------------------------
-- 2. tb_s080_contracts — 계약 확장 컬럼 4종 (지시 항목 그대로)
-- -----------------------------------------------------------------------------
-- ★ deposit_amount는 추가하지 않는다 — 기존 `deposit` 컬럼(NOT NULL DEFAULT 0)이
--   이미 있고 lib/contract-settlement.ts 정산 로직이 이 컬럼을 읽는다.
--   새로 만들면 같은 뜻의 컬럼이 두 개가 되어 정산 로직이 조용히 0을 읽는다.

ALTER TABLE public.tb_s080_contracts
  ADD COLUMN billing_start_date       date,
  ADD COLUMN deposit_return_status    varchar(1),
  ADD COLUMN biz_info_snapshot        jsonb,
  ADD COLUMN renewed_from_contract_id text;

COMMENT ON COLUMN public.tb_s080_contracts.billing_start_date IS
  'CSCH-01 무상기간 — 청구 시작일. NULL이면 start_date부터 청구(무상기간 없음). '
  '소급 입력 불가 검증은 애플리케이션 책임.';
COMMENT ON COLUMN public.tb_s080_contracts.deposit_return_status IS
  'CSCH-02 보증금 반환 상태. H:보유 / R:반환 / D:차감 / P:일부차감. '
  '금액은 기존 deposit 컬럼, 상태만 여기.';
COMMENT ON COLUMN public.tb_s080_contracts.biz_info_snapshot IS
  'CSCH-03 계약 시점 사업자정보 스냅샷(세금계산서 법적 요건). '
  'jsonb 단일 컬럼 — {bizNumber, companyName, ceoName, address, businessType, '
  'businessItem, takenAt} 형태를 권장하되 스키마는 애플리케이션이 검증한다.';
COMMENT ON COLUMN public.tb_s080_contracts.renewed_from_contract_id IS
  'CSCH-04 재계약 이력 — 이 계약이 어느 계약을 갱신한 것인지(자기참조 FK).';

-- deposit_return_status 어휘를 코드 레벨에서 못박는다(느슨한 CHECK — NULL 허용)
ALTER TABLE public.tb_s080_contracts
  ADD CONSTRAINT ck_s080_contracts_deposit_return_status
  CHECK (deposit_return_status IS NULL OR deposit_return_status IN ('H','R','D','P'));

-- 자기참조 FK. ON DELETE SET NULL — 원본 계약이 사라져도 재계약 이력 자체는
-- 끊어질 뿐 이 계약 삭제를 막지 않는다(계약은 소프트 상태 전이만 하므로
-- 실제 DELETE가 거의 없는 이 시스템에서는 안전한 선택).
ALTER TABLE public.tb_s080_contracts
  ADD CONSTRAINT tb_s080_contracts_renewed_from_fkey
  FOREIGN KEY (renewed_from_contract_id)
  REFERENCES public.tb_s080_contracts(contract_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 3. tb_s080_contract_status_history — 상태 이력 (CONT-11, 신규 테이블)
-- -----------------------------------------------------------------------------
-- 지금은 계약 행에 상태를 덮어쓰기만 해서 이력이 남지 않는다
-- (BACKEND_ANALYSIS.md §1-8 — cancel/midterm 라우트가 status를 직접 UPDATE).

CREATE TABLE public.tb_s080_contract_status_history (
  history_id  text NOT NULL,
  contract_id text NOT NULL,
  from_status varchar(1),              -- NULL = 최초 생성(계약 등록)
  to_status   varchar(1) NOT NULL,
  changed_by  text,                    -- 갱신자 식별자 (created_by/updated_by와 같은 관례)
  changed_at  timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT tb_s080_contract_status_history_pkey PRIMARY KEY (history_id),
  CONSTRAINT tb_s080_contract_status_history_contract_id_fkey
    FOREIGN KEY (contract_id) REFERENCES public.tb_s080_contracts(contract_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

COMMENT ON TABLE public.tb_s080_contract_status_history IS
  '계약 상태 전이 이력(CONT-11). 계약 행은 현재 상태만 갖고, 이 테이블이 감사 이력을 갖는다.';

CREATE INDEX idx_s080_contract_status_history_contract_id
  ON public.tb_s080_contract_status_history USING btree (contract_id, changed_at DESC);

-- -----------------------------------------------------------------------------
-- 4. end_date 인덱스 — 만료 임박 조회 (C9, CONT-16 / TNNT-03 / DASH-03)
-- -----------------------------------------------------------------------------
-- 기존에는 build_id 인덱스만 있었다(SCHEMA_ANALYSIS.md §3.3 C9).

CREATE INDEX IF NOT EXISTS idx_s080_contracts_end_date
  ON public.tb_s080_contracts USING btree (end_date);

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- node scripts/rowcounts.js .env      -- 행 수가 이동 전과 같은지
-- node scripts/inspect-deps.js .env   -- 제약·인덱스 정합
--
-- 수동 확인:
--   SELECT count(*) FROM tb_s080_companies WHERE link_s020_org_id IS NOT NULL;  -- 0이어야 정상(아직 연결 없음)
--   \d tb_s080_contracts       -- 신규 컬럼 4개 확인
--   \d tb_s080_contract_status_history

-- =============================================================================
-- ROLLBACK (필요시 역순 실행)
-- =============================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.tb_s080_contract_status_history;
-- DROP INDEX IF EXISTS idx_s080_contracts_end_date;
-- ALTER TABLE public.tb_s080_contracts
--   DROP CONSTRAINT IF EXISTS tb_s080_contracts_renewed_from_fkey,
--   DROP CONSTRAINT IF EXISTS ck_s080_contracts_deposit_return_status,
--   DROP COLUMN IF EXISTS billing_start_date,
--   DROP COLUMN IF EXISTS deposit_return_status,
--   DROP COLUMN IF EXISTS biz_info_snapshot,
--   DROP COLUMN IF EXISTS renewed_from_contract_id;
-- ALTER TABLE public.tb_s080_companies
--   DROP CONSTRAINT IF EXISTS ux_s080_companies_link_s020_org,
--   DROP COLUMN IF EXISTS link_s020_org_id,
--   DROP COLUMN IF EXISTS link_linked_at,
--   DROP COLUMN IF EXISTS link_linked_by;
-- COMMIT;
