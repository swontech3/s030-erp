-- =============================================================================
-- 007_purge_test_data.sql
--
-- 시험 트랜잭션 데이터 정리 + 호실 상태값 초기화.
--
-- 새 시스템을 만드는 중이라 기존 트랜잭션 데이터는 전부 시험 데이터다.
-- companies 9건 중 3건이 유효한 사업자번호와 청구 1~12건을 갖고 있어
-- 실데이터 의심으로 멈추고 확인받았다 — 전부 시험 데이터로 확정(2026-09-13).
--
-- 적용: 2026-09-13. 백업을 먼저 떴다(저장소 밖, pg_dump public 스키마 280KB).
-- 근거: doc/CONTRACT_DATA_MODEL.md §C-2 ⑤
--
-- ★ 004_rename_tenant.sql 에 의존하지 않는다 — tenant_id/operator_id 를 건드리지 않는다.
-- =============================================================================
-- 삭제 순서는 FK 의존을 따른다 — 참조하는 쪽부터.
-- DROP TABLE 이 아니라 DELETE 다. 구조 변경은 008 이다.
-- 코드 테이블(code_masters·codes_line)과 호실(spaces·buildings·floors)은 건드리지 않는다.
-- =============================================================================
BEGIN;

DELETE FROM public.tb_s080_payments;                  -- 5  (→invoices RESTRICT, →companies RESTRICT)
DELETE FROM public.tb_s080_invoice_lines;             -- 31 (→invoices CASCADE, 명시적으로 먼저)
DELETE FROM public.tb_s080_invoices;                  -- 31 (→companies·contracts RESTRICT)
DELETE FROM public.tb_s080_settlements;               -- 0
DELETE FROM public.tb_s080_incorp_persons;            -- 12 (→incorporations CASCADE)
DELETE FROM public.tb_s080_incorp_purposes;           -- 11 (→incorporations CASCADE)
DELETE FROM public.tb_s080_incorporations;            -- 7  (→companies RESTRICT)
DELETE FROM public.tb_s080_corp_change_officers;      -- 0  (→corp_changes CASCADE)
DELETE FROM public.tb_s080_corp_changes;              -- 10 (company_id 에 FK 없음 — 고아 방지)
DELETE FROM public.tb_s080_reservations;              -- 2  (→companies SET NULL, →members SET NULL)
DELETE FROM public.tb_s080_members;                   -- 5  (→companies RESTRICT)
DELETE FROM public.tb_s080_contract_status_history;   -- 0  (→contracts CASCADE)
DELETE FROM public.tb_s080_contracts;                 -- 5
DELETE FROM public.tb_s080_companies;                 -- 9

-- 호실 상태값 초기화 — NOT NULL 제약을 유지한 채 기본값 'E'(공실)로.
-- 레거시 S-WonERP(Prisma)가 이 컬럼을 non-null 로 읽으므로 NULL 로 바꾸지 않는다.
-- ★ 호실 상태의 정본은 이제 계약이다(doc/CONTRACT_DATA_MODEL.md §C-2 ⑤).
--   이 컬럼은 레거시 호환으로만 남는다. 새 코드는 읽지 않는다.
UPDATE public.tb_s080_spaces SET status = 'E' WHERE status <> 'E';   -- 6건

COMMIT;
