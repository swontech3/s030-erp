-- =============================================================================
-- 213_tax_bank_codes.sql
--
-- 세무(S05) 은행 거래내역 · 이체 내역이 쓰는 코드와 대응표 네 줄 (1-5 멈춤 2, 2026-11-01, ★ 적용 전 승인 대기)
--
--   분류              이름              코드값                                              쓰는 곳
--   TAX_BANK_FILE     은행 파일 종류    TXN 거래내역 · XFER 이체 내역                       tb_s050_upload_files.bank_file_tp ·
--                                                                                         tb_s050_import_maps.bank_file_tp
--   TAX_SKIP_REASON   뺀 줄 종류(205)   + bothInOut · noBalance · xferNotDone ·              미리보기 · 올리기 응답의 뺀 줄 수
--                                       otherAccount · noToAccount (순서 13~17)
--   TAX_KIND          자료 종류(202)    BANK 설명만 고침(206 문구 그대로일 때만)            자료 올리기 카드 설명
--
--   대응표(tb_s050_import_maps, kind BANK) 네 줄 — 국민 004 · 우리 020 · 하나 081 거래내역 · 우리 020 이체 결과
--
-- ★ 결정(2026-11-01 대표, 설계 보고 12번 답):
--   - 국민 이체 내역(샘플에 받는 사람 칸 없음) · 하나 이체 내역(샘플 없음)은 이번에 뺀다 → 이체 대응표는 우리 020 하나.
--     건별 상세 샘플이 생기면 대응표 줄만 더한다(표 · 코드는 그대로)
--   - 하나 거래내역은 지금 샘플(자료 2줄)로 간다. 하나 파일에는 계좌번호가 없다 → accountNo null(앱이 경고하고 받는다, 9)
--   - 이체 파일에 고른 계좌가 아닌 출금계좌 줄이 있으면 그 줄만 뺀다(10) → otherAccount
--   - TAX_KIND BANK 설명 「통장 거래내역 · 이체 내역 엑셀. 계좌를 고릅니다」(206 문구 그대로일 때만)
-- ★ 새 뺀 줄 종류 다섯(이름은 설계 보고 8번 제안을 다듬은 것 — 대표 확인 대기):
--     bothInOut    입금 · 출금이 모두 있음          거래내역 — 한 줄에 입금 · 출금 둘 다 0 보다 큼
--     noBalance    잔액이 없음                       거래내역 — 잔액 칸이 비었거나 숫자가 아님(개수 맞추기 열쇠라 꼭 필요)
--     xferNotDone  처리완료가 아닌 이체              이체 — 「이체결과」가 처리완료가 아님
--     otherAccount 고른 계좌가 아닌 줄               이체 — 출금계좌번호가 고른 계좌와 다름
--     noToAccount  받는 은행 · 계좌 · 받는분이 빔    이체 — 셋 중 하나라도 비었거나 받는 계좌 숫자가 4자리 미만
--   날짜 · 금액은 205 · 209 의 badDate 「날짜가 맞지 않음」(거래일시 · 이체일시도) · badAmount · noAmount 를 그대로 쓴다.
--   ★ noAmount 의 지금 이름은 210 이 고친 「금액이 빔」 — 은행에도 맞아 고치지 않는다.
-- ★ 고정 코드(지우기 · 코드값 바꾸기 막기는 code-usage.ts 의 `PINNED_CODES` 몫 — 적용 뒤 더한다):
--   - TAX_BANK_FILE TXN · XFER — 212 CHECK 두 곳과 대응표 줄이 기댄다
--   - TAX_SKIP_REASON 새 5개 — 코드값이 API 응답의 뺀 줄 키와 같아야 화면이 이름을 찾는다(205 와 같은 이유)
--   `is_system` 은 쓰지 않는다(209 와 같이 false).
--
-- 대응표 줄의 모양(columns) — 칸 번호는 엑셀처럼 1부터, 그 은행 파일에 없는 칸은 null:
--   거래내역 TXN  seq(No — 숫자가 아닌 마지막 줄 = 합계 줄) · txnAt · description(적요) · counterparty(상대) ·
--                 myNote(내 통장 표시, 국민만) · memo · inAmount · outAmount · balance  칸 번호
--                 accountNo { row, label, stopAt }  파일 머리의 계좌번호 자리 — 그 줄 첫 칸의 「label : 번호」에서 숫자만,
--                 stopAt 이 있으면 그 글자 앞까지(우리 「… 예금주 : …」). 파일에 없으면 null(하나)
--   이체 XFER     seq · xferAt · fromAccount(출금계좌번호) · toBank · toAccount · amount · holder(받는분) ·
--                 toMemo(받는분 통장표시) · fromMemo(보내는분 통장표시)  칸 번호
--                 done { col, values }  그 칸 글자가 values 중 하나여야 넣는다(아니면 xferNotDone)
--   ★ 수수료 · 이체일시는 저장하지 않는다(15) — 이체일시는 짝 찾기(±60초)에만 쓴다. 수수료 칸은 읽지 않는다(12 — 이체금액만 견줌)
--
-- 하는 일 · 영향: 코드 세 표(tb_s080_code_masters · tb_s080_code_categories · tb_s080_codes_line)에 줄을 **더하고**,
--   TAX_KIND BANK 설명만 고치고(206 문구일 때만), 212 의 칸을 채운 대응표 네 줄을 넣는다.
--   기존 분류 · 코드값 · 대응표 세 줄 · 표 구조 · 권한은 바꾸지 않는다. 다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 · 같은 분류 이름이 **다른 줄로** 이미 있으면 멈춘다(202 · 204 · 205 · 207 · 209 와 같은 이유)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regclass('public.tb_s050_bank_txns') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'tb_s050_import_maps' AND column_name = 'bank_file_tp') THEN
    RAISE EXCEPTION '213 — tb_s050_bank_txns · 대응표 은행 칸이 없다. 212 를 먼저 적용할 것';
  END IF;
  -- 210 뒤의 12줄이 있어야 한다(다시 돌릴 때는 213 이 더한 5줄이 함께 있어도 된다)
  IF (SELECT count(*) FROM public.tb_s080_codes_line
       WHERE build_id = '1' AND category = 'TAX_SKIP_REASON' AND use_tp = '000'
         AND code IN ('nonGeneral', 'noBizNo', 'badAmount', 'noApproval', 'dupInFile', 'otherClass', 'badDate',
                      'noCardNo', 'noDescription', 'noAmount', 'badPayMethod', 'badDirection')) <> 12 THEN
    RAISE EXCEPTION '213 — TAX_SKIP_REASON 의 205 · 209 · 210 코드값 12줄이 있어야 한다. 210 을 먼저 적용할 것';
  END IF;
  -- 대응표가 가리킬 은행 코드 셋(202)
  IF (SELECT count(*) FROM public.tb_s080_codes_line
       WHERE build_id = '1' AND category = 'BANK' AND use_tp = '000' AND code IN ('004', '020', '081')) <> 3 THEN
    RAISE EXCEPTION '213 — 코드 BANK 004 · 020 · 081 이 있어야 한다. 202 를 먼저 적용할 것';
  END IF;

  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1' AND category = 'TAX_BANK_FILE' AND code_id <> 'cm_1_TAX_BANK_FILE';
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '213 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 분류(머리) · 파티션
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_TAX_BANK_FILE', '1', 'TAX_BANK_FILE', '은행 파일 종류',
        '세무(S05) 은행 입출금 자료의 파일 종류. ★ 고정 코드 — 212 CHECK(올린 파일 · 대응표)가 코드값(TXN · XFER)에 기댄다',
        false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_TAX_BANK_FILE_000', '1', 'TAX_BANK_FILE', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 코드값
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  -- 은행 파일 종류 — 업로드 창의 선택지 순서
  ('cl_1_TAX_BANK_FILE_TXN',  '1', 'TAX_BANK_FILE', 'TXN',  '거래내역',  NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_BANK_FILE_XFER', '1', 'TAX_BANK_FILE', 'XFER', '이체 내역', NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  -- 뺀 줄 종류(있던 12개 뒤) — 코드값 = API 응답의 뺀 줄 키
  ('cl_1_TAX_SKIP_REASON_bothInOut',    '1', 'TAX_SKIP_REASON', 'bothInOut',    '입금 · 출금이 모두 있음',       NULL, '000', 13, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noBalance',    '1', 'TAX_SKIP_REASON', 'noBalance',    '잔액이 없음',                   NULL, '000', 14, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_xferNotDone',  '1', 'TAX_SKIP_REASON', 'xferNotDone',  '처리완료가 아닌 이체',          NULL, '000', 15, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_otherAccount', '1', 'TAX_SKIP_REASON', 'otherAccount', '고른 계좌가 아닌 줄',           NULL, '000', 16, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_SKIP_REASON_noToAccount',  '1', 'TAX_SKIP_REASON', 'noToAccount',  '받는 은행 · 계좌 · 받는분이 빔', NULL, '000', 17, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. 자료 카드 설명 — 206 문구 그대로일 때만(코드 관리에서 고친 설명은 덮지 않는다)
-- -----------------------------------------------------------------------------
UPDATE public.tb_s080_codes_line
   SET description = '통장 거래내역 · 이체 내역 엑셀. 계좌를 고릅니다',
       updated_at  = CURRENT_TIMESTAMP
 WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000' AND code = 'BANK'
   AND description = '통장 거래내역 엑셀. 은행과 계좌를 고릅니다';

-- -----------------------------------------------------------------------------
-- 4. 대응표 네 줄 — 원본 샘플(doc/data-src/)에서 확인한 모양(2026-11-01 설계 보고 1번)
-- -----------------------------------------------------------------------------
-- ★ 국민 거래내역 — 시트 1장 · 1~6줄 머리(1줄 첫 칸 「계좌번호 : …」) · 7줄 제목 11칸 · 거래일시 글자 yyyy.mm.dd hh:mm:ss ·
--   금액 숫자(안 쓰는 쪽 0) · 합계 줄 없음
-- ★ 우리 거래내역 — 1줄 제목 글 · 2줄 첫 칸 「계좌번호 : … 예금주 : …」 · 3줄 조회기간 · 4줄 제목 10칸 · 마지막 줄 합계(No 빔)
-- ★ 하나 거래내역 — 1줄 제목 글 · 2줄 제목 11칸 · 거래일시 yyyy-mm-dd hh:mm:ss · 안 쓰는 쪽 금액은 빈 칸 · 마지막 줄 합계 ·
--   ★ 계좌번호가 파일에 없다
-- ★ 우리 이체 결과 — 1줄 제목 글 · 2줄 제목 15칸 · 이체일시 yyyy.mm.dd hh:mm:ss · 마지막 줄 합계 · 「이체결과」 처리완료
INSERT INTO public.tb_s050_import_maps (id, kind, name, header_row, header_signature, columns, bank_code, bank_file_tp)
VALUES
  (
    'BANK_004_TXN', 'BANK', '국민은행 거래내역', 7,
    ARRAY['No', '거래일시', '보낸분/받는분', '출금액(원)', '입금액(원)', '잔액(원)', '내 통장 표시', '메모', '적요', '처리점', '구분']::text[],
    '{
       "seq":          1,
       "txnAt":        2,
       "counterparty": 3,
       "outAmount":    4,
       "inAmount":     5,
       "balance":      6,
       "myNote":       7,
       "memo":         8,
       "description":  9,
       "accountNo":    { "row": 1, "label": "계좌번호", "stopAt": null }
     }'::jsonb,
    '004', 'TXN'
  ),
  (
    'BANK_020_TXN', 'BANK', '우리은행 거래내역', 4,
    ARRAY['No.', '거래일시', '적요', '기재내용', '지급(원)', '입금(원)', '거래후 잔액(원)', '취급점', '메모', '수표·어음·증권금액(원)']::text[],
    '{
       "seq":          1,
       "txnAt":        2,
       "description":  3,
       "counterparty": 4,
       "outAmount":    5,
       "inAmount":     6,
       "balance":      7,
       "myNote":       null,
       "memo":         9,
       "accountNo":    { "row": 2, "label": "계좌번호", "stopAt": "예금주" }
     }'::jsonb,
    '020', 'TXN'
  ),
  (
    'BANK_081_TXN', 'BANK', '하나은행 거래내역', 2,
    ARRAY['No', '거래일시', '적요', '메모', '의뢰인/수취인', '입금', '출금', '거래후잔액', '구분', '거래점', '거래특이사항']::text[],
    '{
       "seq":          1,
       "txnAt":        2,
       "description":  3,
       "memo":         4,
       "counterparty": 5,
       "inAmount":     6,
       "outAmount":    7,
       "balance":      8,
       "myNote":       null,
       "accountNo":    null
     }'::jsonb,
    '081', 'TXN'
  ),
  (
    'BANK_020_XFER', 'BANK', '우리은행 이체 결과', 2,
    ARRAY['No.', '이체일시', '출금계좌번호', '입금은행', '입금계좌번호', '이체금액(원)', '수수료(원)', '수수료후불여부', '받는분',
          '받는분 통장표시', '보내는분 통장표시', '이체결과', '처리내용', '전문(타행)번호', '집금(CMS)번호']::text[],
    '{
       "seq":         1,
       "xferAt":      2,
       "fromAccount": 3,
       "toBank":      4,
       "toAccount":   5,
       "amount":      6,
       "holder":      9,
       "toMemo":      10,
       "fromMemo":    11,
       "done":        { "col": 12, "values": ["처리완료"] }
     }'::jsonb,
    '020', 'XFER'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-213.js (node scripts/verify-213.js .env packages/api/.env), 그다음 verify-212
--   적용 전 시험: node scripts/verify-213.js .env packages/api/.env --dry-run <212> <213>  (늘 ROLLBACK)
--   verify-209 의 M1(대응표 줄 수)도 함께 고친다 — 은행 네 줄이 더해졌다.
-- =============================================================================
-- SELECT category, count(*) FROM public.tb_s080_codes_line
--  WHERE category IN ('TAX_BANK_FILE','TAX_SKIP_REASON') GROUP BY 1 ORDER BY 1;    -- TAX_BANK_FILE 2 · TAX_SKIP_REASON 17
-- SELECT id, kind, bank_code, bank_file_tp, header_row, cardinality(header_signature) FROM public.tb_s050_import_maps ORDER BY id;
--   -- BANK_004_TXN 004 TXN 7 11 · BANK_020_TXN 020 TXN 4 10 · BANK_020_XFER 020 XFER 2 15 · BANK_081_TXN 081 TXN 2 11 · (있던 셋)
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 은행 파일이 대응표를 가리키면 RESTRICT 로 막힌다(은행 파일을 먼저 지운다 — 212 되돌리기 참고)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s050_import_maps WHERE id IN ('BANK_004_TXN', 'BANK_020_TXN', 'BANK_081_TXN', 'BANK_020_XFER');
-- UPDATE public.tb_s080_codes_line SET description = '통장 거래내역 엑셀. 은행과 계좌를 고릅니다', updated_at = CURRENT_TIMESTAMP
--  WHERE build_id = '1' AND category = 'TAX_KIND' AND code = 'BANK' AND description = '통장 거래내역 · 이체 내역 엑셀. 계좌를 고릅니다';
-- DELETE FROM public.tb_s080_codes_line WHERE category = 'TAX_SKIP_REASON'
--   AND code IN ('bothInOut','noBalance','xferNotDone','otherAccount','noToAccount');
-- DELETE FROM public.tb_s080_codes_line      WHERE category = 'TAX_BANK_FILE';
-- DELETE FROM public.tb_s080_code_categories WHERE category = 'TAX_BANK_FILE';
-- DELETE FROM public.tb_s080_code_masters    WHERE category = 'TAX_BANK_FILE';
-- COMMIT;
