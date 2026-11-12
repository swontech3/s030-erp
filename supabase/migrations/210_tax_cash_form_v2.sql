-- =============================================================================
-- 210_tax_cash_form_v2.sql
--
-- 세무(S05) 현금 경비 표준 양식 다시 만들기 — 구분 + 금액 한 칸 · 결제방법 (1-4 보완, 2026-10-31)
--
--   고치는 것            전                                         후
--   대응표 TAX_CASH_STD  1줄 안내 · 2줄 제목                        1줄 제목(안내는 「안내」 시트로)
--                        날짜 · 품명 · 거래처 · 항목 · 매출액 ·      날짜 · 구분 · 품명 · 거래처 · 항목 · 금액 ·
--                        매입액 · 지급방법 · 증빙                    결제방법 · 증빙
--   TAX_PAY_METHOD       분류 이름 「지급방법」                     「결제방법」(설명의 시트 이름도)
--                        TRANSFER 「계좌이체(직원 정산)」            「계좌이체」 — 「직원 정산」 뜻은 설명 칸
--   TAX_SKIP_REASON      noAmount 「매출액 · 매입액이 모두 빔」      「금액이 빔」
--                        bothAmounts 「매출액 · 매입액을 모두 적음」 지운다(두 칸이 없어 생기지 않는다)
--                        badPayMethod 「지급방법이 …」(12)          「결제방법이 비었거나 목록에 없음」(11)
--                        —                                          + badDirection 「구분이 비었거나 목록에 없음」(12)
--
-- ★ 결정(2026-10-31 대표):
--   - 매출액 · 매입액 두 칸 → 구분(TAX_INV_DIR 이름 「매입」 · 「매출」) + 금액 한 칸. 구분이 비었거나 목록에 없으면 뺀 줄
--   - 결제방법 이름 · 계좌이체 이름. 코드값(CASH · TRANSFER · OWNER)은 그대로 — TRANSFER 는 고정(은행 짝 맞추기)
--   - 대표 기존 파일(매출액 · 매입액 두 칸) 모양은 받지 않는다. 드롭다운은 이번에 하지 않는다(라이선스 문제로 미룸)
--   - bothAmounts 는 지운다(고정 코드 목록 code-usage.ts 에서도 뺀다). 뺀 줄 종류는 담는 칸이 없어 남는 자료가 없다
-- ★ 이름 · 설명은 **209 가 넣은 그대로일 때만** 고친다 — 코드 관리에서 이미 고친 이름은 덮지 않는다(209 와 같은 방식).
--   대응표 줄은 앱의 변환과 짝이라 늘 새 모양으로 바꾼다(올린 파일 표가 이 줄을 가리켜도 된다 — 줄은 그대로, 값만 바뀐다).
-- ★ 표 구조는 바꾸지 않는다 — 현금 줄 표(208)는 처음부터 구분(direction) · 금액(amount) 한 칸씩이다. 칸 설명(COMMENT)만 고친다.
--
-- 대응표 줄의 모양(tb_s050_import_maps.columns) — 칸 번호는 엑셀처럼 1부터:
--   TAX_CASH_STD  useDate · direction · description · vendorName · item · amount · payMethod · proof  칸 번호
--
-- 하는 일 · 영향: 대응표 한 줄 고침 · 코드 머리 한 줄 · 코드값 4줄 고침(옛 값일 때만) · 1줄 지움 · 1줄 더함 · 칸 설명 셋.
--   다시 돌려도 같은 결과다.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 — 209 를 먼저
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tb_s050_import_maps WHERE id = 'TAX_CASH_STD') THEN
    RAISE EXCEPTION '210 — 대응표 TAX_CASH_STD 가 없다. 209 를 먼저 적용할 것';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = 'TAX_PAY_METHOD') THEN
    RAISE EXCEPTION '210 — 코드 분류 TAX_PAY_METHOD 가 없다. 209 를 먼저 적용할 것';
  END IF;
  IF (SELECT count(*) FROM public.tb_s080_codes_line
       WHERE build_id = '1' AND category = 'TAX_INV_DIR' AND use_tp = '000' AND code IN ('P', 'S')) <> 2 THEN
    RAISE EXCEPTION '210 — 구분 코드 TAX_INV_DIR P · S 가 없다. 204 를 먼저 적용할 것';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 대응표 — 1줄 제목 · 8칸
-- -----------------------------------------------------------------------------
UPDATE public.tb_s050_import_maps
   SET header_row       = 1,
       header_signature = ARRAY['날짜', '구분', '품명', '거래처', '항목', '금액', '결제방법', '증빙']::text[],
       columns          = '{
         "useDate":     1,
         "direction":   2,
         "description": 3,
         "vendorName":  4,
         "item":        5,
         "amount":      6,
         "payMethod":   7,
         "proof":       8
       }'::jsonb
 WHERE id = 'TAX_CASH_STD';

-- -----------------------------------------------------------------------------
-- 2. 결제방법 — 분류 이름 · 설명, TRANSFER 이름 · 설명 (209 그대로일 때만)
-- -----------------------------------------------------------------------------
UPDATE public.tb_s080_code_masters
   SET name        = '결제방법',
       description = '세무(S05) 현금 경비의 결제방법. 현금 경비 양식의 「결제방법 목록」 시트가 이 이름을 쓴다. ★ TRANSFER 는 고정 — 은행 짝 맞추기가 직원 정산 줄을 이 값으로 찾는다',
       updated_at  = CURRENT_TIMESTAMP
 WHERE build_id = '1' AND category = 'TAX_PAY_METHOD' AND name = '지급방법';

UPDATE public.tb_s080_codes_line
   SET name        = '계좌이체',
       description = '직원 정산 — 직원이 먼저 낸 돈을 회사 통장에서 이체해 돌려준 것',
       updated_at  = CURRENT_TIMESTAMP
 WHERE build_id = '1' AND category = 'TAX_PAY_METHOD' AND use_tp = '000' AND code = 'TRANSFER'
   AND name = '계좌이체(직원 정산)';

-- -----------------------------------------------------------------------------
-- 3. 뺀 줄 종류 — bothAmounts 지움 · 이름 둘(209 그대로일 때만) · badPayMethod 순서 11 · badDirection 더함(12)
-- -----------------------------------------------------------------------------
DELETE FROM public.tb_s080_codes_line
 WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' AND use_tp = '000' AND code = 'bothAmounts';

UPDATE public.tb_s080_codes_line AS l
   SET name       = d.new_name,
       updated_at = CURRENT_TIMESTAMP
  FROM (VALUES
    ('noAmount',     '매출액 · 매입액이 모두 빔',        '금액이 빔'),
    ('badPayMethod', '지급방법이 비었거나 목록에 없음',  '결제방법이 비었거나 목록에 없음')
  ) AS d(code, old_name, new_name)
 WHERE l.build_id = '1' AND l.category = 'TAX_SKIP_REASON' AND l.use_tp = '000' AND l.code = d.code
   AND l.name = d.old_name;

UPDATE public.tb_s080_codes_line
   SET sort_order = 11, updated_at = CURRENT_TIMESTAMP
 WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' AND use_tp = '000' AND code = 'badPayMethod' AND sort_order <> 11;

INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_SKIP_REASON_badDirection', '1', 'TAX_SKIP_REASON', 'badDirection', '구분이 비었거나 목록에 없음', NULL, '000', 12, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. 현금 줄 표 칸 설명(208) — 새 양식 칸 이름으로
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN public.tb_s050_cash_txns.direction IS '코드 TAX_INV_DIR(000) 코드값. P 매입 · S 매출(양식의 구분 칸).';
COMMENT ON COLUMN public.tb_s050_cash_txns.amount IS '금액(원, 0 보다 큼) — 양식의 금액 칸.';
COMMENT ON COLUMN public.tb_s050_cash_txns.pay_method IS
  '결제방법 — 코드 TAX_PAY_METHOD(000) 코드값. TRANSFER(계좌이체 · 직원 정산) 줄은 뒤 단계 은행 짝 맞추기에서 이체 줄과 짝이 된다.';

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-210.js (node scripts/verify-210.js .env packages/api/.env), 그다음 verify-209 · verify-208
-- =============================================================================
-- SELECT id, header_row, header_signature FROM public.tb_s050_import_maps WHERE id = 'TAX_CASH_STD';
--   -- TAX_CASH_STD 1 {날짜,구분,품명,거래처,항목,금액,결제방법,증빙}
-- SELECT sort_order, code, name FROM public.tb_s080_codes_line WHERE category = 'TAX_SKIP_REASON' ORDER BY sort_order;
--   -- 12줄 · bothAmounts 없음 · 11 badPayMethod · 12 badDirection
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — ★ 앱(새 양식 변환)을 먼저 되돌린다. 새 양식으로 올린 현금 줄은 그대로 남는다(표 구조가 같다)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.tb_s050_import_maps SET header_row = 2,
--   header_signature = ARRAY['날짜', '품명', '거래처', '항목', '매출액', '매입액', '지급방법', '증빙']::text[],
--   columns = '{"useDate":1,"description":2,"vendorName":3,"item":4,"salesAmount":5,"purchaseAmount":6,"payMethod":7,"proof":8}'::jsonb
--  WHERE id = 'TAX_CASH_STD';
-- DELETE FROM public.tb_s080_codes_line WHERE category = 'TAX_SKIP_REASON' AND code = 'badDirection';
-- UPDATE public.tb_s080_codes_line SET sort_order = 12 WHERE category = 'TAX_SKIP_REASON' AND code = 'badPayMethod';
-- INSERT INTO public.tb_s080_codes_line (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
-- VALUES ('cl_1_TAX_SKIP_REASON_bothAmounts', '1', 'TAX_SKIP_REASON', 'bothAmounts', '매출액 · 매입액을 모두 적음', NULL, '000', 11, true, false, CURRENT_TIMESTAMP)
-- ON CONFLICT (line_id) DO NOTHING;
-- UPDATE public.tb_s080_codes_line SET name = '매출액 · 매입액이 모두 빔' WHERE category = 'TAX_SKIP_REASON' AND code = 'noAmount' AND name = '금액이 빔';
-- UPDATE public.tb_s080_codes_line SET name = '지급방법이 비었거나 목록에 없음' WHERE category = 'TAX_SKIP_REASON' AND code = 'badPayMethod' AND name = '결제방법이 비었거나 목록에 없음';
-- UPDATE public.tb_s080_codes_line SET name = '계좌이체(직원 정산)', description = NULL WHERE category = 'TAX_PAY_METHOD' AND code = 'TRANSFER' AND name = '계좌이체';
-- UPDATE public.tb_s080_code_masters SET name = '지급방법',
--   description = '세무(S05) 현금 경비의 지급방법. 현금 경비 양식의 「지급방법 목록」 시트가 이 이름을 쓴다. ★ TRANSFER 는 고정 — 은행 짝 맞추기가 직원 정산 줄을 이 값으로 찾는다'
--  WHERE category = 'TAX_PAY_METHOD' AND name = '결제방법';
-- COMMIT;
