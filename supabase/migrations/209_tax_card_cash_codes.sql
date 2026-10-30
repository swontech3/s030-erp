-- =============================================================================
-- 209_tax_card_cash_codes.sql
--
-- 세무(S05) 카드 사용 내역 · 현금 경비가 쓰는 코드와 대응표 두 줄 (1-4 멈춤 2, 2026-10-30, ★ 적용 전 승인 대기)
--
--   분류              이름              코드값                                              쓰는 곳
--   TAX_PAY_METHOD    지급방법          CASH 현금 · TRANSFER 계좌이체(직원 정산) ·          tb_s050_cash_txns.pay_method
--                                       OWNER 대표 개인 돈
--   TAX_PROOF         증빙              RECEIPT 영수증 · SIMPLE 간이영수증 ·                tb_s050_cash_txns.proof
--                                       CASHRCPT 현금영수증 · PCARD 개인카드 영수증 · NONE 없음
--   TAX_CARD_DEDUCT   카드 공제 여부    Y 공제 · N 불공제                                   tb_s050_card_txns.vat_deduct
--   TAX_SKIP_REASON   뺀 줄 종류(205)   + noCardNo · noDescription · noAmount ·             미리보기 · 올리기 응답의 뺀 줄 수
--                                       bothAmounts · badPayMethod (순서 8~12)
--                                       · badDate 이름 「작성일이 날짜가 아님」→「날짜가 맞지 않음」(205 이름 그대로일 때만)
--   TAX_KIND          자료 종류(202)    CARD · CASH 설명만 고침(옛 문구였을 때만)          자료 올리기 카드 설명
--
-- ★ 결정(2026-10-30 대표):
--   - 13 분류 이름 · 코드값은 설계 보고의 제안대로. 12 증빙 목록에 현금영수증을 더한다
--   - 17 카드 설명 「홈택스 사업용 신용카드 사용내역 엑셀 그대로 올립니다」 · CASH 의 옛 이름 「거래 분류」 → 「매출 · 매입 항목 지정」
--     (결과서 S05-02 의 CASH 문구와 같다). ★ 설명이 206 의 옛 문구 그대로일 때만 고친다 — 코드 관리에서 고친 설명은 덮지 않는다
--   - 18 현금 양식의 항목 · 지급방법 · 증빙은 **코드 표 이름**으로 코드값을 찾는다 — 대응표에 바꾸기표를 두지 않는다.
--     양식(내려받기)의 목록 시트도 같은 이름을 쓰므로 코드 관리에서 이름을 고치면 양식과 변환이 함께 바뀐다
--   - 15 현금 양식은 1줄 안내 문구 · 2줄 제목 줄(header_row 2)
--   - 14 드롭다운 없이 「항목 목록」 시트(+ 지급방법 · 증빙 목록) — 양식 시트는 이 대응표의 제목 줄과 같아야 한다
-- ★ 고정 코드(지우기 · 코드값 바꾸기 막기는 code-usage.ts 의 `PINNED_CODES` 몫 — 적용 뒤 더한다):
--   - TAX_CARD_DEDUCT Y · N — 208 CHECK 와 대응표 바꾸기표가 기댄다
--   - TAX_PAY_METHOD TRANSFER — 뒤 단계 은행 짝 맞추기가 「직원 정산」 줄을 이 값으로 찾는다
--   - TAX_SKIP_REASON 새 5개 — 코드값이 API 응답의 뺀 줄 키와 같아야 화면이 이름을 찾는다(205 와 같은 이유)
--   TAX_PROOF · TAX_PAY_METHOD 의 나머지는 고정이 아니다(코드 관리에서 더하고 고칠 수 있다). `is_system` 은 쓰지 않는다.
-- ★ 날짜 · 금액이 틀린 줄은 205 의 badDate · badAmount 를 그대로 쓴다(새 코드값을 만들지 않는다). badDate 이름은 카드 · 현금에도
--   맞게 「날짜가 맞지 않음」으로 바꾼다(멈춤 2 판단 4) — 코드 관리에서 이미 고친 이름은 덮지 않는다.
-- ★ 카드 공제 여부 칸이 「공제 · 불공제」가 아니면 줄을 빼지 않고 공제 여부를 비워서 넣고 경고한다(멈춤 2 판단 3) —
--   그래서 「공제 여부를 알 수 없음」은 뺀 줄 종류가 아니다.
--
-- 대응표 줄의 모양(tb_s050_import_maps.columns) — 칸 번호는 엑셀처럼 1부터:
--   HOMETAX_BIZ_CARD  useDate · cardNo · merchantBizNo · merchantName · supplyAmount · taxAmount · nontaxAmount ·
--                     totalAmount · deductNote   칸 번호
--                     vatDeduct { col, values }  원본 글자 → TAX_CARD_DEDUCT 코드값. values 에 없는 글자는 공제 여부를 비우고 경고
--                     ★ 1줄은 「총 사용금액」 한 칸뿐, 2줄이 제목 줄. 카드사 · 가맹점유형 · 업태 · 업종 칸은 읽지 않는다(결정 2)
--   TAX_CASH_STD      useDate · description · vendorName · item · salesAmount · purchaseAmount · payMethod · proof  칸 번호
--
-- 하는 일 · 영향: 코드 세 표(tb_s080_code_masters · tb_s080_code_categories · tb_s080_codes_line)에 줄을 **더하고**,
--   TAX_KIND 두 줄의 설명만 고치고(옛 문구일 때만), 203 의 대응표에 두 줄을 넣는다.
--   기존 분류 · 코드값 · 표 구조 · 권한은 바꾸지 않는다. 다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 · 같은 분류 이름이 **다른 줄로** 이미 있으면 멈춘다(202 · 204 · 205 · 207 과 같은 이유)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regclass('public.tb_s050_card_txns') IS NULL OR to_regclass('public.tb_s050_cash_txns') IS NULL THEN
    RAISE EXCEPTION '209 — tb_s050_card_txns · tb_s050_cash_txns 가 없다. 208 을 먼저 적용할 것';
  END IF;
  -- 205 의 7줄이 있어야 한다(다시 돌릴 때는 209 가 더한 6줄이 함께 있어도 된다)
  IF (SELECT count(*) FROM public.tb_s080_codes_line
       WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' AND use_tp = '000'
         AND code IN ('nonGeneral', 'noBizNo', 'badAmount', 'noApproval', 'dupInFile', 'otherClass', 'badDate')) <> 7 THEN
    RAISE EXCEPTION '209 — TAX_SKIP_REASON 의 205 코드값 7줄이 있어야 한다. 205 를 먼저 적용할 것';
  END IF;

  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1'
     AND category IN ('TAX_PAY_METHOD', 'TAX_PROOF', 'TAX_CARD_DEDUCT')
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '209 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 분류(머리)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_TAX_PAY_METHOD', '1', 'TAX_PAY_METHOD', '지급방법',
        '세무(S05) 현금 경비의 지급방법. 현금 경비 양식의 「지급방법 목록」 시트가 이 이름을 쓴다. ★ TRANSFER 는 고정 — 은행 짝 맞추기가 직원 정산 줄을 이 값으로 찾는다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_PROOF', '1', 'TAX_PROOF', '증빙',
        '세무(S05) 현금 경비의 증빙(선택). 현금 경비 양식의 「증빙 목록」 시트가 이 이름을 쓴다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_CARD_DEDUCT', '1', 'TAX_CARD_DEDUCT', '카드 공제 여부',
        '세무(S05) 카드 사용 내역의 부가세 공제 여부(홈택스 「공제여부결정」). ★ 고정 코드 — 208 CHECK 와 대응표 바꾸기표가 코드값(Y · N)에 기댄다',
        false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 파티션 — 모두 공통(000) 하나
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_TAX_PAY_METHOD_000',  '1', 'TAX_PAY_METHOD',  '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_PROOF_000',       '1', 'TAX_PROOF',       '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_CARD_DEDUCT_000', '1', 'TAX_CARD_DEDUCT', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. 코드값 — 순서(sort_order)가 양식 목록 시트 · 화면의 순서다
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  -- 지급방법
  ('cl_1_TAX_PAY_METHOD_CASH',     '1', 'TAX_PAY_METHOD',  'CASH',     '현금',                NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_PAY_METHOD_TRANSFER', '1', 'TAX_PAY_METHOD',  'TRANSFER', '계좌이체(직원 정산)', NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_PAY_METHOD_OWNER',    '1', 'TAX_PAY_METHOD',  'OWNER',    '대표 개인 돈',        NULL, '000', 3, true, false, CURRENT_TIMESTAMP),
  -- 증빙
  ('cl_1_TAX_PROOF_RECEIPT',       '1', 'TAX_PROOF',       'RECEIPT',  '영수증',              NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_PROOF_SIMPLE',        '1', 'TAX_PROOF',       'SIMPLE',   '간이영수증',          NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_PROOF_CASHRCPT',      '1', 'TAX_PROOF',       'CASHRCPT', '현금영수증',          NULL, '000', 3, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_PROOF_PCARD',         '1', 'TAX_PROOF',       'PCARD',    '개인카드 영수증',     NULL, '000', 4, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_PROOF_NONE',          '1', 'TAX_PROOF',       'NONE',     '없음',                NULL, '000', 5, true, false, CURRENT_TIMESTAMP),
  -- 카드 공제 여부
  ('cl_1_TAX_CARD_DEDUCT_Y',       '1', 'TAX_CARD_DEDUCT', 'Y',        '공제',                NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_CARD_DEDUCT_N',       '1', 'TAX_CARD_DEDUCT', 'N',        '불공제',              NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  -- 뺀 줄 종류(205 의 7개 뒤) — 코드값 = API 응답의 뺀 줄 키
  ('cl_1_TAX_SKIP_REASON_noCardNo',      '1', 'TAX_SKIP_REASON', 'noCardNo',      '카드번호 없음',                  NULL, '000', 8,  true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noDescription', '1', 'TAX_SKIP_REASON', 'noDescription', '품명 없음',                      NULL, '000', 9,  true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noAmount',      '1', 'TAX_SKIP_REASON', 'noAmount',      '매출액 · 매입액이 모두 빔',      NULL, '000', 10, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_bothAmounts',   '1', 'TAX_SKIP_REASON', 'bothAmounts',   '매출액 · 매입액을 모두 적음',    NULL, '000', 11, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_badPayMethod',  '1', 'TAX_SKIP_REASON', 'badPayMethod',  '지급방법이 비었거나 목록에 없음', NULL, '000', 12, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

-- 205 badDate 이름 — 205 이름 그대로일 때만
UPDATE public.tb_s080_codes_line
   SET name = '날짜가 맞지 않음', updated_at = CURRENT_TIMESTAMP
 WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' AND use_tp = '000' AND code = 'badDate'
   AND name = '작성일이 날짜가 아님';

-- -----------------------------------------------------------------------------
-- 4. 자료 카드 설명 — 206 의 옛 문구 그대로일 때만(코드 관리에서 고친 설명은 덮지 않는다)
-- -----------------------------------------------------------------------------
UPDATE public.tb_s080_codes_line AS l
   SET description = d.new_desc,
       updated_at  = CURRENT_TIMESTAMP
  FROM (VALUES
    ('CARD', '카드사 사이트에서 받은 엑셀. 카드사를 고르면 표준양식으로 바뀝니다',
             '홈택스 사업용 신용카드 사용내역 엑셀 그대로 올립니다'),
    ('CASH', '표준양식. 항목 칸을 비워 두면 거래 분류에서 붙입니다',
             '표준양식. 항목 칸을 비워 두면 매출 · 매입 항목 지정에서 붙입니다')
  ) AS d(code, old_desc, new_desc)
 WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.use_tp = '000' AND l.code = d.code
   AND l.description = d.old_desc;

-- -----------------------------------------------------------------------------
-- 5. 대응표 두 줄
-- -----------------------------------------------------------------------------
-- ★ 카드 — 원본 샘플(doc/data-src/ 사업용신용카드 세액공제내역 xls)에서 확인한 모양: 시트 1장 · 1줄은 「총 사용금액」
--   한 칸 · 2줄째가 제목 줄 · 14칸 · 날짜 글자 YYYY-MM-DD · 금액 숫자 · 카드번호 16자리 그대로(★ 앱이 끝 4자리만 남긴다).
--   승인번호 · 결제일 · 적용월 칸은 없다.
-- ★ 현금 — 세무가 내려주는 표준 양식. 1줄 안내 문구 · 2줄 제목 줄 · 8칸. 대표 현금 경비 파일(1줄 제목 · 「사용일시」 ·
--   「품   명」)은 이 양식이 아니다 — 그 파일은 양식을 정하는 참고용이었다.
INSERT INTO public.tb_s050_import_maps (id, kind, name, header_row, header_signature, columns)
VALUES
  (
    'HOMETAX_BIZ_CARD', 'CARD', '홈택스 사업용 신용카드 사용내역', 2,
    ARRAY['승인일자', '카드사', '카드번호', '가맹점사업자번호', '가맹점명', '공급가액', '세액', '비과세', '합계',
          '가맹점유형', '업태', '업종', '공제여부결정', '비고']::text[],
    '{
       "useDate":       1,
       "cardNo":        3,
       "merchantBizNo": 4,
       "merchantName":  5,
       "supplyAmount":  6,
       "taxAmount":     7,
       "nontaxAmount":  8,
       "totalAmount":   9,
       "vatDeduct":     { "col": 13, "values": { "공제": "Y", "불공제": "N" } },
       "deductNote":    14
     }'::jsonb
  ),
  (
    'TAX_CASH_STD', 'CASH', '현금 경비 표준 양식', 2,
    ARRAY['날짜', '품명', '거래처', '항목', '매출액', '매입액', '지급방법', '증빙']::text[],
    '{
       "useDate":        1,
       "description":    2,
       "vendorName":     3,
       "item":           4,
       "salesAmount":    5,
       "purchaseAmount": 6,
       "payMethod":      7,
       "proof":          8
     }'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-209.js (node scripts/verify-209.js .env packages/api/.env), 그다음 verify-208
-- =============================================================================
-- SELECT category, count(*) FROM public.tb_s080_codes_line
--  WHERE category IN ('TAX_PAY_METHOD','TAX_PROOF','TAX_CARD_DEDUCT','TAX_SKIP_REASON') GROUP BY 1 ORDER BY 1;
--   -- TAX_CARD_DEDUCT 2 · TAX_PAY_METHOD 3 · TAX_PROOF 5 · TAX_SKIP_REASON 12
-- SELECT id, kind, header_row, cardinality(header_signature) FROM public.tb_s050_import_maps ORDER BY id;
--   -- HOMETAX_BIZ_CARD CARD 2 14 · HOMETAX_TAX_INVOICE INVOICE 6 33 · TAX_CASH_STD CASH 2 8
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 카드 · 현금 줄이 이 코드를 쓰고 있으면 먼저 본다(코드에는 FK 가 없어 막아 주지 않는다.
--   대응표는 올린 파일이 가리키면 RESTRICT 로 막힌다 — 카드 · 현금 파일을 먼저 지운다)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s050_import_maps WHERE id IN ('HOMETAX_BIZ_CARD', 'TAX_CASH_STD');
-- UPDATE public.tb_s080_codes_line SET description = '카드사 사이트에서 받은 엑셀. 카드사를 고르면 표준양식으로 바뀝니다', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_KIND' AND code = 'CARD' AND description = '홈택스 사업용 신용카드 사용내역 엑셀 그대로 올립니다';
-- UPDATE public.tb_s080_codes_line SET description = '표준양식. 항목 칸을 비워 두면 거래 분류에서 붙입니다', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_KIND' AND code = 'CASH' AND description = '표준양식. 항목 칸을 비워 두면 매출 · 매입 항목 지정에서 붙입니다';
-- DELETE FROM public.tb_s080_codes_line      WHERE category = 'TAX_SKIP_REASON'
--   AND code IN ('noCardNo','noDescription','noAmount','bothAmounts','badPayMethod');
-- UPDATE public.tb_s080_codes_line SET name = '작성일이 날짜가 아님', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' AND code = 'badDate' AND name = '날짜가 맞지 않음';
-- DELETE FROM public.tb_s080_codes_line      WHERE category IN ('TAX_PAY_METHOD','TAX_PROOF','TAX_CARD_DEDUCT');
-- DELETE FROM public.tb_s080_code_categories WHERE category IN ('TAX_PAY_METHOD','TAX_PROOF','TAX_CARD_DEDUCT');
-- DELETE FROM public.tb_s080_code_masters    WHERE category IN ('TAX_PAY_METHOD','TAX_PROOF','TAX_CARD_DEDUCT');
-- COMMIT;
