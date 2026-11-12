-- =============================================================================
-- 202_tax_codes.sql
--
-- 세무(S05) 세무 설정이 쓰는 코드 — 분류 여섯 · 파티션 공통(000) · 코드값 19 (1-1 멈춤 2, 2026-10-25,
-- ★ 적용 전 승인 대기). 화면에 이름 · 선택지를 박지 않는다 — 코드 관리(s030100030)에서 고친다.
--
--   분류            이름              코드값                                          쓰는 곳
--   TAX_WH_CYCLE    원천세 신고 주기  M 매월 · H 반기 (설명 칸에 안내 문구)            tb_s050_settings.withholding_cycle
--   TAX_KIND        세무 자료 종류    INVOICE · CARD · CASH · BANK · NTAX · LTAX ·      tb_s050_settings.unused_kinds(목록)
--                                     SOCIAL · LOAN (시안 KINDS 8종)
--   TAX_BIZ_TP      사업자 유형       I 개인 일반과세자 · C 법인                       tb_s050_settings.biz_type
--   TAX_FIN_KIND    계좌·카드 구분    B 은행 · C 카드                                  tb_s050_fin_accounts.kind
--   BANK            은행              004 국민은행 · 020 우리은행 · 081 하나은행        tb_s050_fin_accounts.bank_code
--                                     (금융결제원 은행 번호)
--   CARD_COMPANY    카드사            KB 국민카드 · WOORI 우리카드                     tb_s050_fin_accounts.card_co_code
--
-- ★★ BANK · CARD_COMPANY 는 **공통 이름**이다(세무 전용 TAX_ 를 붙이지 않는다) — ERP · 법무가
--    나중에 같은 분류를 쓴다. 지금 저장소(마이그레이션 · 코드 · 문서)에는 은행 · 카드사 분류가 없다.
--    개발 DB 에 같은 이름의 분류가 이미 있는지는 실측하지 않았다 → 아래 0번이 **다른 줄로** 있으면 멈춘다.
--
-- ★ 고정 코드 — TAX_WH_CYCLE(M · H) · TAX_KIND(8종) · TAX_FIN_KIND(B · C)는 앱이 코드값에 기댄다
--   (마감일 계산 · 목록 칸 · 번호 검사). 지우기 · 코드값 바꾸기 막기는 code-usage.ts 의 `PINNED_CODES`
--   몫이다(201 적용 뒤 더한다 — 그 전에 더하면 verify-codes 가 없는 표를 가리킨다고 실패한다).
--   `is_system` 은 쓰지 않는다(코드 관리가 2026-10-03 에 그 차단을 걷어냈다) — 028 처럼 false.
-- ★ 코드값 설명(description)은 TAX_WH_CYCLE 에만 채운다. 기존 `listCodes` 는 설명을 읽지 않는다 —
--   세무 라우트 안의 새 조회가 읽는다(멈춤 3). listCodes 는 고치지 않는다.
--
-- 하는 일 · 영향: 코드 세 표(tb_s080_code_masters · tb_s080_code_categories · tb_s080_codes_line)에
--   줄을 **더하기만** 한다. 기존 분류 · 코드값 · 표 구조 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING — 028 과 같은 방식).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 같은 분류 이름이 **다른 줄로** 이미 있으면 멈춘다
-- -----------------------------------------------------------------------------
-- 머리 표는 (build_id, category) 가 UNIQUE 라, 다른 code_id 로 이미 있으면 아래 INSERT 가 그 UNIQUE 에
-- 걸려 이유를 알기 어려운 오류로 죽는다. 먼저 보고 알아볼 수 있는 문구로 멈춘다.
-- 이 파일이 넣은 줄(같은 code_id)이면 통과한다 — 다시 돌릴 수 있다.
DO $$
DECLARE
  hit text;
BEGIN
  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1'
     AND category IN ('TAX_WH_CYCLE', 'TAX_KIND', 'TAX_BIZ_TP', 'TAX_FIN_KIND', 'BANK', 'CARD_COMPANY')
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '202 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 분류(머리)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_TAX_WH_CYCLE', '1', 'TAX_WH_CYCLE', '원천세 신고 주기',
        '세무(S05) 세무 설정의 원천세 신고 주기. ★ 고정 코드 — 원천세 마감일 · 신고자료 만드는 때가 코드값(M · H)에 기댄다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_KIND', '1', 'TAX_KIND', '세무 자료 종류',
        '세무(S05) 자료 올리기의 자료 종류 8종. ★ 고정 코드 — 세무 설정 「쓰지 않는 자료」가 목록 칸에 담아 지우기 막기가 세지 못한다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_BIZ_TP', '1', 'TAX_BIZ_TP', '사업자 유형',
        '세무(S05) 세무 설정의 사업자 유형. 분류 항목 · 부가세 신고 기간 · 마감일이 이 값에 따라 바뀐다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_FIN_KIND', '1', 'TAX_FIN_KIND', '계좌·카드 구분',
        '세무(S05) 사업용 계좌 · 카드 구분. ★ 고정 코드 — 번호 검사(DB CHECK)가 코드값(B · C)에 기댄다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_BANK', '1', 'BANK', '은행',
        '은행(공통). 코드값은 금융결제원 은행 번호. 세무(S05) 사업용 계좌가 처음 쓴다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_CARD_COMPANY', '1', 'CARD_COMPANY', '카드사',
        '카드사(공통). 세무(S05) 사업용 카드가 처음 쓴다',
        false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 파티션 — 모두 공통(000) 하나
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_TAX_WH_CYCLE_000', '1', 'TAX_WH_CYCLE', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_KIND_000',     '1', 'TAX_KIND',     '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_BIZ_TP_000',   '1', 'TAX_BIZ_TP',   '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_FIN_KIND_000', '1', 'TAX_FIN_KIND', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_BANK_000',         '1', 'BANK',         '000', '공통', '단일 파티션. 세무(S05)가 처음 쓴다', false),
       ('cc_1_CARD_COMPANY_000', '1', 'CARD_COMPANY', '000', '공통', '단일 파티션. 세무(S05)가 처음 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. 코드값 — 순서(sort_order)가 화면의 선택지 순서다
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  -- 원천세 신고 주기 — 설명이 선택지 옆 안내 문구다(08-screen-report S05-11)
  ('cl_1_TAX_WH_CYCLE_M', '1', 'TAX_WH_CYCLE', 'M', '매월', '다음 달 10일까지 냅니다', '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_WH_CYCLE_H', '1', 'TAX_WH_CYCLE', 'H', '반기', '세무서 승인을 받은 회사만. 6개월 치를 묶어 1월·7월에 냅니다', '000', 2, true, false, CURRENT_TIMESTAMP),
  -- 세무 자료 종류 — 시안 tax-data.js KINDS 순서
  ('cl_1_TAX_KIND_INVOICE', '1', 'TAX_KIND', 'INVOICE', '매입·매출 계산서', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_KIND_CARD',    '1', 'TAX_KIND', 'CARD',    '카드 사용 내역',   NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_KIND_CASH',    '1', 'TAX_KIND', 'CASH',    '현금 경비',        NULL, '000', 3, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_KIND_BANK',    '1', 'TAX_KIND', 'BANK',    '은행 입출금',      NULL, '000', 4, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_KIND_NTAX',    '1', 'TAX_KIND', 'NTAX',    '국세 납부',        NULL, '000', 5, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_KIND_LTAX',    '1', 'TAX_KIND', 'LTAX',    '지방세 납부',      NULL, '000', 6, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_KIND_SOCIAL',  '1', 'TAX_KIND', 'SOCIAL',  '4대보험',          NULL, '000', 7, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_KIND_LOAN',    '1', 'TAX_KIND', 'LOAN',    '대출 내역',        NULL, '000', 8, true, false, CURRENT_TIMESTAMP),
  -- 사업자 유형
  ('cl_1_TAX_BIZ_TP_I', '1', 'TAX_BIZ_TP', 'I', '개인 일반과세자', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_BIZ_TP_C', '1', 'TAX_BIZ_TP', 'C', '법인',            NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  -- 계좌 · 카드 구분
  ('cl_1_TAX_FIN_KIND_B', '1', 'TAX_FIN_KIND', 'B', '은행', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_FIN_KIND_C', '1', 'TAX_FIN_KIND', 'C', '카드', NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  -- 은행(공통) — 시안 BANKS
  ('cl_1_BANK_004', '1', 'BANK', '004', '국민은행', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_BANK_020', '1', 'BANK', '020', '우리은행', NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_BANK_081', '1', 'BANK', '081', '하나은행', NULL, '000', 3, true, false, CURRENT_TIMESTAMP),
  -- 카드사(공통) — 시안 CARDCOS
  ('cl_1_CARD_COMPANY_KB',    '1', 'CARD_COMPANY', 'KB',    '국민카드', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_CARD_COMPANY_WOORI', '1', 'CARD_COMPANY', 'WOORI', '우리카드', NULL, '000', 2, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-202.js (node scripts/verify-202.js .env packages/api/.env)
-- =============================================================================
-- SELECT category, count(*) FROM public.tb_s080_codes_line
--  WHERE category IN ('TAX_WH_CYCLE','TAX_KIND','TAX_BIZ_TP','TAX_FIN_KIND','BANK','CARD_COMPANY')
--  GROUP BY 1 ORDER BY 1;   -- BANK 3 · CARD_COMPANY 2 · TAX_BIZ_TP 2 · TAX_FIN_KIND 2 · TAX_KIND 8 · TAX_WH_CYCLE 2
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 세무 표(201)에 이 코드를 쓰는 줄이 있으면 먼저 본다(FK 가 없어 막아 주지 않는다)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s080_codes_line      WHERE category IN ('TAX_WH_CYCLE','TAX_KIND','TAX_BIZ_TP','TAX_FIN_KIND','BANK','CARD_COMPANY');
-- DELETE FROM public.tb_s080_code_categories WHERE category IN ('TAX_WH_CYCLE','TAX_KIND','TAX_BIZ_TP','TAX_FIN_KIND','BANK','CARD_COMPANY');
-- DELETE FROM public.tb_s080_code_masters    WHERE category IN ('TAX_WH_CYCLE','TAX_KIND','TAX_BIZ_TP','TAX_FIN_KIND','BANK','CARD_COMPANY');
-- COMMIT;
