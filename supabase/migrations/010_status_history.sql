-- =============================================================================
-- 010_status_history.sql
--
-- 계약 상태 이력 테이블을 새 상태 어휘에 맞추고, 운영사 전용으로 잠근다.
-- 페이즈 4 의 CONT-11(상태 전이 이력)이 이 테이블에 쓰기 시작하기 직전 작업이다.
--
-- 근거: doc/CONTRACT_DATA_MODEL.md (정본). 이 파일과 어긋나면 그 문서를 따른다.
--
-- -----------------------------------------------------------------------------
-- ★ 왜 필요한가 1 — varchar(1) 에는 'confirmed' 가 안 들어간다
-- -----------------------------------------------------------------------------
-- 001 이 이 테이블을 만들 때 레거시 상태값이 한 글자였다(CONTRACT_ST: A/P/C/S/E).
-- 그래서 from_status·to_status 를 varchar(1) 로 잡았다.
--
-- 008 이 계약의 상태 어휘를 네 가지로 바꾸면서 tb_s080_contracts.status 를
-- varchar(20) 으로 넓혔는데, **이력 테이블은 건드리지 않았다.**
--
--   draft(5) · confirmed(9) · terminated(10) · cancelled(9)
--
-- 네 값이 전부 varchar(1) 을 넘는다. 이대로 두면 계약을 확정하는 첫 순간
-- `22001 value too long for type character varying(1)` 로 죽는다.
-- 상태 전이는 되는데 이력만 실패하는 것이 아니라, 같은 트랜잭션이라 **전이 자체가
-- 실패한다.** 그 편이 낫다 — 이력 없는 전이가 조용히 쌓이는 것보다.
--
-- -----------------------------------------------------------------------------
-- ★ 왜 필요한가 2 — 이 테이블에는 RLS 가 없다
-- -----------------------------------------------------------------------------
-- 003 이 RLS 를 건 것은 6테이블(contracts · invoices · payments · settlements ·
-- members · reservations)이고 008 이 contract_spaces 를 더했다. **이 테이블은 그
-- 어느 목록에도 없다.** 그런데 003 은 erp_app 에게 ALL TABLES 권한을 줬다.
--
-- 즉 지금 구조 그대로 이력이 쌓이면 **입주사 세션이 남의 계약 이력을 전부 읽는다.**
-- 새는 값은 contract_id · 상태 전이 시각 · 변경자다. 계약 본문은 아니지만
-- "어느 회사가 언제 계약을 취소했는지"가 그대로 드러난다.
--
-- 지금은 0행이라 아무 일도 없다. 그래서 지금이 가장 싸다.
--
-- -----------------------------------------------------------------------------
-- ★★ 정책을 운영사 전용으로 두는 이유 — company_id 를 넣지 않았다
-- -----------------------------------------------------------------------------
-- 008 이 contract_spaces 에서 쓴 방식은 company_id 를 denormalize 하고 복합 FK 로
-- 어긋남을 막는 것이었다. 여기서는 **그렇게 하지 않는다.**
--
--   계약 등록은 운영사 전용 업무다. 입주사가 계약 상태 이력을 보는 화면이 없다.
--   입주사가 보지 않는 표에 회사별 스코프를 만드는 것은 **쓰지 않는 장치**다.
--   쓰지 않는 방어 장치는 맞는지 틀리는지 확인할 기회가 없어 조용히 썩는다.
--
-- ★ 나중에 입주사가 자기 계약 이력을 보는 화면이 생기면 **그때 정책을 손본다.**
--   그때 필요한 것은 두 가지다.
--     1) company_id 컬럼 추가 + 계약에서 채워 넣기(백필)
--        — 그 시점에 이미 쌓인 행이 있으므로 백필이 필요하다. 지금은 0행이라 공짜다
--     2) 아래 정책을 008 의 contract_spaces 와 같은 모양으로 교체
--          USING (erp_is_operator() OR company_id = erp_current_company_id())
--   이 주석이 그때의 인수인계다.
--
-- -----------------------------------------------------------------------------
-- contract_type 은 이 파일에 없다
-- -----------------------------------------------------------------------------
-- ROADMAP 이 예고했던 `010_contract_type.sql` 은 **만들지 않는다.**
-- 계약서 2종(이용·전대차)은 계약 유형을 고르는 것이 아니라 계약 1건에서 둘 다
-- 찍는 것이기 때문이다(design/handoff/tenant-contract/06-contracts.md).
-- CONT-12 는 그 결정으로 닫았다 — doc/CONTRACT_DATA_MODEL.md §C-1 「전대차 비상주 특례」.
--
-- -----------------------------------------------------------------------------
-- 안전성
-- -----------------------------------------------------------------------------
-- 이 테이블은 현재 0행이다(007 이 비웠고 그 뒤로 쓰는 코드가 없다).
-- ALTER COLUMN TYPE 은 행이 없으면 테이블 재작성 비용도 0이다.
-- varchar(1) → varchar(20) 은 **넓히는 방향**이라 기존 값이 잘릴 일이 없다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. 상태 컬럼을 새 어휘에 맞게 넓힌다
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s080_contract_status_history
  ALTER COLUMN from_status TYPE varchar(20);
ALTER TABLE public.tb_s080_contract_status_history
  ALTER COLUMN to_status   TYPE varchar(20);

-- 계약 테이블의 ck_s080_contracts_status 와 같은 어휘를 이력에도 강제한다.
-- ★ 감사 이력이라 잘못 들어간 값을 나중에 고칠 수 없다. 들어오는 자리에서 막는다.
-- ★ from_status 는 NULL 을 허용한다 — 최초 생성(계약 등록)에는 이전 상태가 없다.
ALTER TABLE public.tb_s080_contract_status_history
  ADD CONSTRAINT ck_s080_contract_status_history_from
  CHECK (from_status IS NULL OR from_status IN ('draft','confirmed','terminated','cancelled'));
ALTER TABLE public.tb_s080_contract_status_history
  ADD CONSTRAINT ck_s080_contract_status_history_to
  CHECK (to_status IN ('draft','confirmed','terminated','cancelled'));

COMMENT ON COLUMN public.tb_s080_contract_status_history.from_status IS
  '이전 상태. NULL 이면 최초 생성(계약 등록)이다. '
  '★ 010 부터 varchar(20) — 008 이 바꾼 새 어휘(draft/confirmed/terminated/cancelled)를 담는다.';
COMMENT ON COLUMN public.tb_s080_contract_status_history.to_status IS
  '전이 후 상태. ★ 010 부터 varchar(20).';

-- -----------------------------------------------------------------------------
-- 2. RLS — 운영사 전용
-- -----------------------------------------------------------------------------
-- 003 의 패턴을 따르되 회사 스코프 없이 운영사만 통과시킨다(위 ★★ 참조).
-- 입주사 세션은 0행을 본다. 예외가 아니라 0건이다 — 이 시스템의 fail-closed 관례다.
ALTER TABLE public.tb_s080_contract_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY erp_operator_only ON public.tb_s080_contract_status_history
  USING (erp_is_operator())
  WITH CHECK (erp_is_operator());

COMMENT ON TABLE public.tb_s080_contract_status_history IS
  '계약 상태 전이 이력(CONT-11). 계약 행은 현재 상태만 갖고, 이 테이블이 감사 이력을 갖는다. '
  '★ 010 부터 RLS 운영사 전용이다 — 계약 등록이 운영사 업무라 입주사가 볼 화면이 없다. '
  '입주사가 자기 계약 이력을 보는 화면이 생기면 company_id 를 추가하고(백필 필요) '
  '정책을 008 의 contract_spaces 와 같은 회사 스코프로 교체한다.';

-- -----------------------------------------------------------------------------
-- 3. 권한 — 003 의 ALL TABLES 로 이미 있지만 명시적으로 준다
--    (그 기본권한이 나중에 바뀌어도 이 테이블은 동작해야 한다. 008 과 같은 관례)
-- -----------------------------------------------------------------------------
-- ★ DELETE 를 주지 않는다. 감사 이력은 지우는 것이 아니다.
GRANT SELECT, INSERT ON public.tb_s080_contract_status_history TO erp_app;
REVOKE UPDATE, DELETE ON public.tb_s080_contract_status_history FROM erp_app;

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- 1) 폭이 넓어졌는지
--    SELECT column_name, character_maximum_length FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_contract_status_history'
--       AND column_name IN ('from_status','to_status');
--    → 둘 다 20
--
-- 2) 실제로 'confirmed' 가 들어가는지 (넣고 되돌린다)
--    BEGIN;
--      INSERT INTO tb_s080_contract_status_history(history_id, contract_id, from_status, to_status)
--      VALUES ('probe', (SELECT contract_id FROM tb_s080_contracts LIMIT 1), 'draft', 'confirmed');
--    ROLLBACK;
--    → 오류 없이 1행. 계약이 0건이면 이 검증은 계약을 만든 뒤에 한다
--
-- 3) 어휘 밖의 값이 막히는지
--    INSERT ... to_status='A'   → 23514 check constraint 위반
--
-- 4) 입주사 세션이 0행을 보는지
--    SELECT set_config('app.current_role','tenant',false);
--    SELECT set_config('app.current_company_id','아무거나',false);
--    SELECT count(*) FROM tb_s080_contract_status_history;   → 0
--    (운영사: app.current_role='operator' 로 두면 전부 보인다)
--
-- 5) erp_app 이 지우지 못하는지
--    DELETE FROM tb_s080_contract_status_history;   → 42501 권한 없음
-- =============================================================================

-- =============================================================================
-- ROLLBACK — 되돌릴 수 있다. 다만 varchar(20) 로 들어간 값이 이미 있으면
-- 1 로 좁히는 순간 22001 로 실패한다. 그때는 행을 먼저 비워야 한다.
-- =============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS erp_operator_only ON public.tb_s080_contract_status_history;
-- ALTER TABLE public.tb_s080_contract_status_history DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_s080_contract_status_history
--   DROP CONSTRAINT IF EXISTS ck_s080_contract_status_history_from,
--   DROP CONSTRAINT IF EXISTS ck_s080_contract_status_history_to;
-- ALTER TABLE public.tb_s080_contract_status_history
--   ALTER COLUMN from_status TYPE varchar(1),
--   ALTER COLUMN to_status   TYPE varchar(1);
-- GRANT UPDATE, DELETE ON public.tb_s080_contract_status_history TO erp_app;
-- COMMIT;
