-- =============================================================================
-- 215_tax_pay_social_loan_codes.sql
--
-- 세무(S05) 국세 · 지방세 · 4대보험 · 대출이 쓰는 코드와 대응표 여섯 줄 (1-6 멈춤 2, 2026-11-01, ★ 적용 전 승인 대기)
--
--   분류              이름              코드값                                              쓰는 곳
--   TAX_SOCIAL_INS    4대보험 종류      NP 국민연금 · HI 건강보험 · LTC 장기요양 ·            tb_s050_social_ins.ins_tp ·
--                                       EI 고용보험 · IA 산재보험                            tb_s050_upload_files.social_ins_tp ·
--                                                                                         tb_s050_import_maps.social_ins_tps
--   TAX_TAX_NOEXP     비용이 아닌 세목  8개 — 코드 이름 = 파일의 세목 글자                   국세 · 지방세 비용 판정(읽을 때)
--   TAX_LOAN_TP       대출 거래 구분    D 실행 · R 상환                                     tb_s050_loan_txns.txn_tp
--   TAX_SKIP_REASON   뺀 줄 종류(205)   + noPayNo · dupPayNo · noMemberName · noLoanAmount   미리보기 · 올리기 응답의 뺀 줄 수
--                                       (순서 18~21)
--
--   대응표(tb_s050_import_maps) 여섯 줄 — HOMETAX_NTAX_PAY 국세 · WETAX_LTAX_PAY 지방세 · SOCIAL_HI 건강(장기요양 포함) ·
--     SOCIAL_NP 국민연금 · SOCIAL_EI_IA 고용 · 산재(제목 줄이 같아 한 줄) · BANK_020_LOAN 우리은행 대출
--
-- ★ 결정(2026-11-01 대표, 설계 보고 9번 답 19):
--   - 비용이 아닌 세목 첫 목록(코드 이름 = 파일 글자): 근로소득세(갑) · 사업소득세 · 지방소득세 특별징수분 · 부가가치세 ·
--     법인세 · 종합소득세 · 지방소득세 법인소득분 · 지방소득세 종합소득분. 목록에 없으면 비용이다.
--     처음 보는 세목(목록에도 없고 그 단체에서 처음)은 미리보기에 「처음 보는 세목」 경고(앱 몫 — 코드는 더하지 않는다)
--     ★ 앞 넷은 샘플에서 확인한 글자, 뒤 넷(법인세 등)은 샘플에 없어 실제 홈택스 · 위택스 글자와 같은지 확인 못 함 —
--       다르면 코드 관리에서 이름만 고친다
--   - 코드값(W_LABOR 등)은 이 마이그레이션이 지은 이름이다 — 앱은 코드값이 아니라 **이름**으로 견준다
-- ★ 새 뺀 줄 종류 넷 — 날짜 · 금액은 있던 badDate 「날짜가 맞지 않음」 · badAmount 「금액이 숫자가 아님」 · noAmount 「금액이 빔」을 쓴다:
--     noPayNo       납부번호 없음                국세 · 지방세 — 전자납부번호 · 납세번호가 빔
--     dupPayNo      파일 안에서 겹친 납부번호    국세 · 지방세 — 한 파일에 같은 납부번호가 두 번(있던 dupInFile 은 「…승인번호」)
--     noMemberName  가입자 이름 없음             4대보험 — 이름 칸이 빔
--     noLoanAmount  원금 · 이자 · 수수료가 모두 0  대출 — 세 칸이 모두 0(214 CHECK 와 같은 뜻)
-- ★ 고정 코드(지우기 · 코드값 바꾸기 막기는 code-usage.ts 의 `PINNED_CODES` 몫 — 적용 뒤 더한다):
--   - TAX_SOCIAL_INS 다섯 · TAX_LOAN_TP 둘 — 214 CHECK 가 코드값에 기댄다
--   - TAX_SKIP_REASON 새 4개 — 코드값이 API 응답의 뺀 줄 키와 같아야 화면이 이름을 찾는다(205 와 같은 이유)
--   - TAX_TAX_NOEXP 는 고정이 아니다 — 코드 관리에서 더하고 지운다(이름으로 견주므로)
--   `is_system` 은 쓰지 않는다(209 · 213 과 같이 false).
-- ★ TAX_KIND(202) 의 NTAX · LTAX · SOCIAL · LOAN 은 이미 있다 — 더하지 않는다. 설명은 SOCIAL · LOAN 둘만 고친다
--   (206 문구 그대로일 때만, 2026-11-01 대표 승인 A — 샘플이 통합징수포털 CSV · 은행 대출거래내역이라 206 문구와 맞지 않는다)
--
-- 대응표 줄의 모양(columns) — 칸 번호는 엑셀처럼 1부터, 그 파일에 없는 칸은 null:
--   국세 · 지방세  payDate · taxItem · amount · payNo · office · penalty(국세 가산금) · belongMonth(지방세 과세대상 —
--                  「YYYY년 MM월 귀속분」에서 연월만) · payMethod(지방세)  칸 번호
--   4대보험       seq(순번) · memberNo(가입자 번호 — 끝 4자리만 남긴다) · name · payBase(보수월액)  칸 번호
--                  lines { 파일 보험 종류: { 줄 보험 종류: 금액 칸 } } — 고른 보험 종류의 줄만 만든다.
--                  건강 HI 는 한 줄에서 HI(고지보험료 14) · LTC(고지보험료 27) 두 줄. 고용 EI · 산재 IA 는 같은 칸(결정보험료 5)
--                  ★ 3번째 칸(주민번호)은 어디에도 적지 않는다 — 앱이 읽지 않는다
--   대출          seq · txnDate · drawAmount(거래원금) · balance · repayAmount(원금상환) · interest(정상이자) ·
--                  lateInterest(연체이자) · refundInterest(환출이자) · fee · txnType  칸 번호
--                  loanNo { row, label, stopAt }  파일 머리의 대출번호 자리(213 의 accountNo 와 같은 모양) — 끝 4자리만 남긴다
--
-- 하는 일 · 영향: 코드 세 표(tb_s080_code_masters · tb_s080_code_categories · tb_s080_codes_line)에 줄을 **더하고**,
--   TAX_KIND SOCIAL · LOAN 설명만 고치고(206 문구일 때만), 214 의 칸을 채운 대응표 여섯 줄을 넣는다.
--   기존 분류 · 코드값(설명 둘 말고) · 대응표 일곱 줄 · 표 구조 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 · 같은 분류 이름이 **다른 줄로** 이미 있으면 멈춘다(202 · 204 · 205 · 207 · 209 · 213 과 같은 이유)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regclass('public.tb_s050_tax_payments') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'tb_s050_import_maps' AND column_name = 'social_ins_tps') THEN
    RAISE EXCEPTION '215 — 납부 표 · 대응표 4대보험 칸이 없다. 214 를 먼저 적용할 것';
  END IF;
  -- 213 뒤의 17줄이 있어야 한다(다시 돌릴 때는 215 가 더한 4줄이 함께 있어도 된다)
  IF (SELECT count(*) FROM public.tb_s080_codes_line
       WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' AND use_tp = '000'
         AND code IN ('nonGeneral', 'noBizNo', 'badAmount', 'noApproval', 'dupInFile', 'otherClass', 'badDate',
                      'noCardNo', 'noDescription', 'noAmount', 'badPayMethod', 'badDirection',
                      'bothInOut', 'noBalance', 'xferNotDone', 'otherAccount', 'noToAccount')) <> 17 THEN
    RAISE EXCEPTION '215 — TAX_SKIP_REASON 의 205 · 209 · 210 · 213 코드값 17줄이 있어야 한다. 213 을 먼저 적용할 것';
  END IF;
  -- 대출 대응표가 가리킬 은행 코드(202)
  IF NOT EXISTS (SELECT 1 FROM public.tb_s080_codes_line
                  WHERE build_id = '1' AND category = 'BANK' AND use_tp = '000' AND code = '020') THEN
    RAISE EXCEPTION '215 — 코드 BANK 020 이 있어야 한다. 202 를 먼저 적용할 것';
  END IF;

  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1' AND category IN ('TAX_SOCIAL_INS', 'TAX_TAX_NOEXP', 'TAX_LOAN_TP')
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '215 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 분류(머리) · 파티션
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES
  ('cm_1_TAX_SOCIAL_INS', '1', 'TAX_SOCIAL_INS', '4대보험 종류',
   '세무(S05) 4대보험 자료의 보험 종류. ★ 고정 코드 — 214 CHECK(4대보험 줄 · 올린 파일 · 대응표)가 코드값(NP · HI · LTC · EI · IA)에 기댄다',
   false, CURRENT_TIMESTAMP),
  ('cm_1_TAX_TAX_NOEXP', '1', 'TAX_TAX_NOEXP', '비용이 아닌 세목',
   '세무(S05) 국세 · 지방세 납부 중 비용에 넣지 않는 세목. 코드 이름 = 홈택스 · 위택스 파일의 세목 글자 그대로(이름으로 견준다). 목록에 없는 세목은 비용',
   false, CURRENT_TIMESTAMP),
  ('cm_1_TAX_LOAN_TP', '1', 'TAX_LOAN_TP', '대출 거래 구분',
   '세무(S05) 대출 거래의 실행 · 상환. ★ 고정 코드 — 214 CHECK(대출 줄)가 코드값(D · R)에 기댄다',
   false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES
  ('cc_1_TAX_SOCIAL_INS_000', '1', 'TAX_SOCIAL_INS', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
  ('cc_1_TAX_TAX_NOEXP_000',  '1', 'TAX_TAX_NOEXP',  '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
  ('cc_1_TAX_LOAN_TP_000',    '1', 'TAX_LOAN_TP',    '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 코드값
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  -- 4대보험 종류 — 업로드 창 · 미리보기의 순서(장기요양은 건강 파일에서 나온다)
  ('cl_1_TAX_SOCIAL_INS_NP',  '1', 'TAX_SOCIAL_INS', 'NP',  '국민연금', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SOCIAL_INS_HI',  '1', 'TAX_SOCIAL_INS', 'HI',  '건강보험', NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SOCIAL_INS_LTC', '1', 'TAX_SOCIAL_INS', 'LTC', '장기요양', NULL, '000', 3, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SOCIAL_INS_EI',  '1', 'TAX_SOCIAL_INS', 'EI',  '고용보험', NULL, '000', 4, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SOCIAL_INS_IA',  '1', 'TAX_SOCIAL_INS', 'IA',  '산재보험', NULL, '000', 5, true, false, CURRENT_TIMESTAMP),
  -- 비용이 아닌 세목 — 대표가 준 순서(2026-11-01 결정 19)
  ('cl_1_TAX_TAX_NOEXP_W_LABOR', '1', 'TAX_TAX_NOEXP', 'W_LABOR', '근로소득세(갑)',         NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_TAX_NOEXP_W_BIZ',   '1', 'TAX_TAX_NOEXP', 'W_BIZ',   '사업소득세',             NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_TAX_NOEXP_L_WH',    '1', 'TAX_TAX_NOEXP', 'L_WH',    '지방소득세 특별징수분',  NULL, '000', 3, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_TAX_NOEXP_VAT',     '1', 'TAX_TAX_NOEXP', 'VAT',     '부가가치세',             NULL, '000', 4, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_TAX_NOEXP_CIT',     '1', 'TAX_TAX_NOEXP', 'CIT',     '법인세',                 NULL, '000', 5, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_TAX_NOEXP_PIT',     '1', 'TAX_TAX_NOEXP', 'PIT',     '종합소득세',             NULL, '000', 6, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_TAX_NOEXP_L_CIT',   '1', 'TAX_TAX_NOEXP', 'L_CIT',   '지방소득세 법인소득분',  NULL, '000', 7, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_TAX_NOEXP_L_PIT',   '1', 'TAX_TAX_NOEXP', 'L_PIT',   '지방소득세 종합소득분',  NULL, '000', 8, true, false, CURRENT_TIMESTAMP),
  -- 대출 거래 구분
  ('cl_1_TAX_LOAN_TP_D', '1', 'TAX_LOAN_TP', 'D', '실행', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_LOAN_TP_R', '1', 'TAX_LOAN_TP', 'R', '상환', NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  -- 뺀 줄 종류(있던 17개 뒤) — 코드값 = API 응답의 뺀 줄 키
  ('cl_1_TAX_SKIP_REASON_noPayNo',      '1', 'TAX_SKIP_REASON', 'noPayNo',      '납부번호 없음',                NULL, '000', 18, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_dupPayNo',     '1', 'TAX_SKIP_REASON', 'dupPayNo',     '파일 안에서 겹친 납부번호',    NULL, '000', 19, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noMemberName', '1', 'TAX_SKIP_REASON', 'noMemberName', '가입자 이름 없음',             NULL, '000', 20, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noLoanAmount', '1', 'TAX_SKIP_REASON', 'noLoanAmount', '원금 · 이자 · 수수료가 모두 0', NULL, '000', 21, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. 자료 카드 설명 — 206 문구 그대로일 때만(코드 관리에서 고친 설명은 덮지 않는다, 2026-11-01 대표 승인 A)
-- -----------------------------------------------------------------------------
UPDATE public.tb_s080_codes_line AS l
   SET description = d.new_desc,
       updated_at  = CURRENT_TIMESTAMP
  FROM (VALUES
    ('SOCIAL', '4대사회보험 정보연계센터에서 내려받은 고지 내역 파일을 올립니다',
               '사회보험 통합징수포털 가입자별 고지 내역 CSV. 보험 종류와 고지 연월을 고릅니다'),
    ('LOAN',   '표준양식. 원금·이자 칸을 따로 적습니다 — 이자만 비용입니다',
               '은행 대출거래내역 엑셀. 원금 · 이자를 나눠 읽습니다 — 이자만 비용입니다')
  ) AS d(code, old_desc, new_desc)
 WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.use_tp = '000' AND l.code = d.code
   AND l.description = d.old_desc;

-- -----------------------------------------------------------------------------
-- 4. 대응표 여섯 줄 — 원본 샘플(doc/data-src/)에서 확인한 모양(2026-11-01 설계 보고 1번)
-- -----------------------------------------------------------------------------
-- ★ 국세(홈택스 국세납부현황.xls) — 시트 1장 · 1줄 빔 · 2줄 제목 13칸 · 납부일자 글자 yyyy-mm-dd · 금액 숫자 · 합계 줄 · 셀 합치기 없음
-- ★ 지방세(위택스 지방세납부현황.xls) — 1줄 제목 글 · 2줄 총 건수 · 총 금액 · 3줄 제목(A 빔, 납세번호 B~E 합침 → 제목 13칸 중 빈 칸 넷) ·
--   납부일자 yyyy.mm.dd · 납부금액 쉼표 글자 · 과세대상 「YYYY년 MM월 귀속분」
-- ★ 4대보험(통합징수포털 CSV, cp949) — 1~6줄 빔 · 7줄 제목 · 모든 값 글자 · 합계 줄 없음. 건강 31칸(건강 · 요양 두 묶음) ·
--   연금 7칸 · 고용 · 산재 7칸(제목이 글자까지 같다 — 올릴 때 보험 종류를 고른다)
-- ★ 대출(우리은행_대출내역.xlsx) — 1줄 제목 글 · 2줄 첫 칸 「대출 계좌번호 : …」 · 3줄 제목 13칸 · 거래일 yyyy.mm.dd · 금액 숫자 · 합계 줄 없음
INSERT INTO public.tb_s050_import_maps (id, kind, name, header_row, header_signature, columns, bank_code, bank_file_tp, social_ins_tps)
VALUES
  (
    'HOMETAX_NTAX_PAY', 'NTAX', '홈택스 국세 납부내역', 2,
    ARRAY['납부일자', '세목', '납세자명', '납부세액', '전자납부번호', '귀속연도', '수납관서', '내국세액', '교육세액', '방위세액',
          '농어촌특별세액', '가산금', '비고']::text[],
    '{
       "payDate":     1,
       "taxItem":     2,
       "amount":      4,
       "payNo":       5,
       "office":      7,
       "penalty":     12,
       "belongMonth": null,
       "payMethod":   null
     }'::jsonb,
    NULL, NULL, NULL
  ),
  (
    'WETAX_LTAX_PAY', 'LTAX', '위택스 지방세 납부내역', 3,
    ARRAY['', '납세번호', '', '', '', '세목', '구분', '납세자', '납부일자', '납부금액', '납부기관', '납부방법', '과세대상']::text[],
    '{
       "payNo":       2,
       "taxItem":     6,
       "payDate":     9,
       "amount":      10,
       "office":      11,
       "payMethod":   12,
       "belongMonth": 13,
       "penalty":     null
     }'::jsonb,
    NULL, NULL, NULL
  ),
  (
    'SOCIAL_HI', 'SOCIAL', '건강보험 고지 내역(장기요양 포함)', 7,
    ARRAY['순번', '증번호', '주민번호', '성명', '보수월액',
          '구분', '산출보험료', '정산보험료', '정산사유', '정산적용기간', '감면사유', '연말정산', '환급금이자', '고지보험료', '회계', '영업소기호', '직종', '취득일/상실일',
          '구분', '산출보험료', '정산보험료', '정산사유', '정산적용기간', '감면사유', '연말정산', '환급금이자', '고지보험료', '회계', '영업소기호', '직종', '취득일/상실일']::text[],
    '{
       "seq":      1,
       "memberNo": 2,
       "name":     4,
       "payBase":  5,
       "lines":    { "HI": { "HI": 14, "LTC": 27 } }
     }'::jsonb,
    NULL, NULL, ARRAY['HI']::text[]
  ),
  (
    'SOCIAL_NP', 'SOCIAL', '국민연금 고지 내역', 7,
    ARRAY['순번', '국민연금번호', '주민번호', '가입자명', '정산사유', '정산적용기간', '결정보험료']::text[],
    '{
       "seq":      1,
       "memberNo": 2,
       "name":     4,
       "payBase":  null,
       "lines":    { "NP": { "NP": 7 } }
     }'::jsonb,
    NULL, NULL, ARRAY['NP']::text[]
  ),
  (
    'SOCIAL_EI_IA', 'SOCIAL', '고용 · 산재보험 고지 내역', 7,
    ARRAY['순번', '원부번호', '주민번호', '가입자명', '결정보험료', '월평균보수월액', '비고']::text[],
    '{
       "seq":      1,
       "memberNo": 2,
       "name":     4,
       "payBase":  6,
       "lines":    { "EI": { "EI": 5 }, "IA": { "IA": 5 } }
     }'::jsonb,
    NULL, NULL, ARRAY['EI', 'IA']::text[]
  ),
  (
    'BANK_020_LOAN', 'LOAN', '우리은행 대출거래내역', 3,
    ARRAY['No.', '거래일', '거래원금(원)', '대출잔액(원)', '원금상환', '정상이자(원)', '연체이자(원)', '환출이자(원)', '수수료(원)',
          '거래종류', '최종이수일', '다음 납입일', '거래점']::text[],
    '{
       "seq":            1,
       "txnDate":        2,
       "drawAmount":     3,
       "balance":        4,
       "repayAmount":    5,
       "interest":       6,
       "lateInterest":   7,
       "refundInterest": 8,
       "fee":            9,
       "txnType":        10,
       "loanNo":         { "row": 2, "label": "대출 계좌번호", "stopAt": null }
     }'::jsonb,
    '020', NULL, NULL
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-215.js (node scripts/verify-215.js .env packages/api/.env), 그다음 verify-214
--   적용 전 시험: node scripts/verify-215.js .env packages/api/.env --dry-run <214> <215>  (늘 ROLLBACK)
--   verify-213 의 C3(뺀 줄 종류 17개) · M2(은행 말고 대응표 셋)도 함께 고친다 — 뺀 줄 4개 · 대응표 여섯 줄이 더해졌다.
-- =============================================================================
-- SELECT category, count(*) FROM public.tb_s080_codes_line
--  WHERE category IN ('TAX_SOCIAL_INS','TAX_TAX_NOEXP','TAX_LOAN_TP','TAX_SKIP_REASON') GROUP BY 1 ORDER BY 1;
--   -- TAX_LOAN_TP 2 · TAX_SKIP_REASON 21 · TAX_SOCIAL_INS 5 · TAX_TAX_NOEXP 8
-- SELECT id, kind, bank_code, social_ins_tps, header_row, cardinality(header_signature) FROM public.tb_s050_import_maps ORDER BY id;
--   -- BANK_020_LOAN LOAN 020 - 3 13 · HOMETAX_NTAX_PAY NTAX 2 13 · SOCIAL_EI_IA {EI,IA} 7 7 · SOCIAL_HI {HI} 7 31 ·
--   -- SOCIAL_NP {NP} 7 7 · WETAX_LTAX_PAY LTAX 3 13 · (있던 일곱)
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 새 종류 파일이 대응표를 가리키면 RESTRICT 로 막힌다(파일을 먼저 지운다 — 214 되돌리기 참고)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.tb_s080_codes_line SET description = '4대사회보험 정보연계센터에서 내려받은 고지 내역 파일을 올립니다', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_KIND' AND code = 'SOCIAL' AND description = '사회보험 통합징수포털 가입자별 고지 내역 CSV. 보험 종류와 고지 연월을 고릅니다';
-- UPDATE public.tb_s080_codes_line SET description = '표준양식. 원금·이자 칸을 따로 적습니다 — 이자만 비용입니다', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_KIND' AND code = 'LOAN' AND description = '은행 대출거래내역 엑셀. 원금 · 이자를 나눠 읽습니다 — 이자만 비용입니다';
-- DELETE FROM public.tb_s050_import_maps
--  WHERE id IN ('HOMETAX_NTAX_PAY', 'WETAX_LTAX_PAY', 'SOCIAL_HI', 'SOCIAL_NP', 'SOCIAL_EI_IA', 'BANK_020_LOAN');
-- DELETE FROM public.tb_s080_codes_line WHERE category = 'TAX_SKIP_REASON'
--   AND code IN ('noPayNo', 'dupPayNo', 'noMemberName', 'noLoanAmount');
-- DELETE FROM public.tb_s080_codes_line      WHERE category IN ('TAX_SOCIAL_INS', 'TAX_TAX_NOEXP', 'TAX_LOAN_TP');
-- DELETE FROM public.tb_s080_code_categories WHERE category IN ('TAX_SOCIAL_INS', 'TAX_TAX_NOEXP', 'TAX_LOAN_TP');
-- DELETE FROM public.tb_s080_code_masters    WHERE category IN ('TAX_SOCIAL_INS', 'TAX_TAX_NOEXP', 'TAX_LOAN_TP');
-- COMMIT;
