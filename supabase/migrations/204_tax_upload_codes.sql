-- =============================================================================
-- 204_tax_upload_codes.sql
--
-- 세무(S05) 자료 올리기 · 거래처가 쓰는 코드 — 분류 넷 · 파티션 공통(000) · 코드값 6 — 와
-- 대응표 한 줄(홈택스 전자세금계산서 목록) (1-2 멈춤 2, 2026-10-26, ★ 적용 전 승인 대기)
--
--   분류            이름                코드값                    쓰는 곳
--   TAX_INV_DIR     계산서 구분         P 매입 · S 매출            tb_s050_upload_files · tb_s050_invoices.direction,
--                                                                 tb_s050_vendors.first_direction
--   TAX_INV_CLASS   계산서 종류         TAX 세금계산서             tb_s050_invoices.inv_class
--   TAX_INV_TYPE    계산서 세부 종류    GEN 일반                   tb_s050_invoices.inv_type
--   TAX_VENDOR_TP   거래처 구분         M 주거래처 · G 일반        tb_s050_vendors.vendor_tp
--
-- ★ 고정 코드 — 넷 모두 앱이 코드값에 기댄다(매입 · 매출 판정 · 대응표의 값 바꾸기 · 수정 · 취소 거르기 ·
--   주거래처 승격). 지우기 · 코드값 바꾸기 막기는 code-usage.ts 의 `PINNED_CODES` 몫이다(203 · 204 적용 뒤
--   더한다 — 202 와 같은 순서). `is_system` 은 쓰지 않는다(202 와 같이 false).
-- ★ 계산서 종류(TAX_INV_CLASS)는 1차에 세금계산서 하나다 — 계산서(면세)는 1차 밖이라 넣지 않았다.
-- ★ 계산서 세부 종류(TAX_INV_TYPE)는 「일반」 하나다 — 원본 샘플에 수정 · 취소 건이 없어 그 값을 모른다.
--   「일반」이 아닌 줄은 앱이 넣지 않고 「수정 · 취소 N줄은 아직 넣지 않습니다」로 알린다(결정 6).
--
-- 대응표 줄의 모양(tb_s050_import_maps.columns) — 칸 번호는 엑셀처럼 1부터:
--   ownBizNo      { row, label }       우리 회사 사업자번호 — 그 줄에서 label 칸 오른쪽의 첫 값(결정 5)
--   writeDate · approvalNo · totalAmount · supplyAmount · taxAmount   칸 번호
--   supplier · buyer   { bizNo, name } 공급자 · 공급받는자 쪽 칸 번호. 우리 번호가 공급자 쪽이면 매출(S),
--                                      공급받는자 쪽이면 매입(P). 상대방은 그 반대쪽이다
--   invClass · invType { col, values } 원본 글자 → 코드값. values 에 없는 글자는 그 줄을 넣지 않는다
-- ★ 원본 글자 비교 · 제목 줄 비교는 앞뒤 공백을 걷고 한다.
--
-- 하는 일 · 영향: 코드 세 표(tb_s080_code_masters · tb_s080_code_categories · tb_s080_codes_line)에
--   줄을 **더하기만** 하고, 203 의 대응표에 한 줄을 넣는다. 기존 분류 · 코드값 · 표 구조 · 권한은 바꾸지 않는다.
--   다시 돌려도 같은 결과다(ON CONFLICT DO NOTHING — 202 와 같은 방식).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 앞 단계 확인 · 같은 분류 이름이 **다른 줄로** 이미 있으면 멈춘다(202 와 같은 이유)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  hit text;
BEGIN
  IF to_regclass('public.tb_s050_import_maps') IS NULL THEN
    RAISE EXCEPTION '204 — tb_s050_import_maps 가 없다. 203 을 먼저 적용할 것';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tb_s080_codes_line
                  WHERE build_id = '1' AND category = 'TAX_KIND' AND code = 'INVOICE') THEN
    RAISE EXCEPTION '204 — 코드 TAX_KIND / INVOICE 가 없다. 202 를 먼저 적용할 것';
  END IF;

  SELECT string_agg(category || '(' || code_id || ')', ', ') INTO hit
    FROM public.tb_s080_code_masters
   WHERE build_id = '1'
     AND category IN ('TAX_INV_DIR', 'TAX_INV_CLASS', 'TAX_INV_TYPE', 'TAX_VENDOR_TP')
     AND code_id <> 'cm_1_' || category;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '204 — 같은 이름의 코드 분류가 이미 있다: %. 기존 분류를 쓸지 정한 뒤 다시 돌릴 것', hit;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 분류(머리)
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_TAX_INV_DIR', '1', 'TAX_INV_DIR', '계산서 구분',
        '세무(S05) 계산서의 매입 · 매출. ★ 고정 코드 — 우리 회사 사업자번호로 매입 · 매출을 판정할 때 코드값(P · S)에 기댄다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_INV_CLASS', '1', 'TAX_INV_CLASS', '계산서 종류',
        '세무(S05) 계산서 종류. ★ 고정 코드 — 대응표가 원본 글자를 이 코드값으로 바꾼다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_INV_TYPE', '1', 'TAX_INV_TYPE', '계산서 세부 종류',
        '세무(S05) 계산서 세부 종류. ★ 고정 코드 — 대응표가 원본 글자를 이 코드값으로 바꾸고, 「일반」이 아닌 줄은 넣지 않는다',
        false, CURRENT_TIMESTAMP),
       ('cm_1_TAX_VENDOR_TP', '1', 'TAX_VENDOR_TP', '거래처 구분',
        '세무(S05) 거래처 구분. ★ 고정 코드 — 업로드가 세금계산서 거래처를 주거래처(M)로 만들고 올린다',
        false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 파티션 — 모두 공통(000) 하나
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_TAX_INV_DIR_000',   '1', 'TAX_INV_DIR',   '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_INV_CLASS_000', '1', 'TAX_INV_CLASS', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_INV_TYPE_000',  '1', 'TAX_INV_TYPE',  '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false),
       ('cc_1_TAX_VENDOR_TP_000', '1', 'TAX_VENDOR_TP', '000', '공통', '단일 파티션. 세무(S05)가 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. 코드값 — 순서(sort_order)가 화면의 선택지 · 칩 순서다
-- -----------------------------------------------------------------------------
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, description, use_tp, sort_order, is_active, is_system, updated_at)
VALUES
  ('cl_1_TAX_INV_DIR_P',     '1', 'TAX_INV_DIR',   'P',   '매입',       NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_INV_DIR_S',     '1', 'TAX_INV_DIR',   'S',   '매출',       NULL, '000', 2, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_INV_CLASS_TAX', '1', 'TAX_INV_CLASS', 'TAX', '세금계산서', NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_INV_TYPE_GEN',  '1', 'TAX_INV_TYPE',  'GEN', '일반',       NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  -- 거래처 구분 — 칩 순서(전체 · 주거래처 · 일반)
  ('cl_1_TAX_VENDOR_TP_M',   '1', 'TAX_VENDOR_TP', 'M',   '주거래처',   NULL, '000', 1, true, false, CURRENT_TIMESTAMP),
  ('cl_1_TAX_VENDOR_TP_G',   '1', 'TAX_VENDOR_TP', 'G',   '일반',       NULL, '000', 2, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. 대응표 — 홈택스 전자세금계산서 목록(매입 · 매출 같은 양식)
-- -----------------------------------------------------------------------------
-- ★ 원본 샘플(doc/data-src/ 매입 · 매출 목록 xls)에서 확인한 모양: 시트 1장 · 1줄에 우리 회사 정보 ·
--   6줄째가 제목 줄 · 33칸 · 한 줄 = 세금계산서 한 장(품목은 대표 품목 하나).
INSERT INTO public.tb_s050_import_maps (id, kind, name, header_row, header_signature, columns)
VALUES (
  'HOMETAX_TAX_INVOICE', 'INVOICE', '홈택스 전자세금계산서 목록', 6,
  ARRAY[
    '작성일자', '승인번호', '발급일자', '전송일자',
    '공급자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소',
    '공급받는자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소',
    '합계금액', '공급가액', '세액',
    '전자세금계산서분류', '전자세금계산서종류', '발급유형', '비고', '영수/청구 구분',
    '공급자 이메일', '공급받는자 이메일1', '공급받는자 이메일2',
    '품목일자', '품목명', '품목규격', '품목수량', '품목단가', '품목공급가액', '품목세액', '품목비고'
  ]::text[],
  '{
     "ownBizNo":     { "row": 1, "label": "사업자 등록번호" },
     "writeDate":    1,
     "approvalNo":   2,
     "supplier":     { "bizNo": 5,  "name": 7 },
     "buyer":        { "bizNo": 10, "name": 12 },
     "totalAmount":  15,
     "supplyAmount": 16,
     "taxAmount":    17,
     "invClass":     { "col": 18, "values": { "세금계산서": "TAX" } },
     "invType":      { "col": 19, "values": { "일반": "GEN" } }
   }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증 — scripts/verify-204.js (node scripts/verify-204.js .env packages/api/.env)
-- =============================================================================
-- SELECT category, count(*) FROM public.tb_s080_codes_line
--  WHERE category IN ('TAX_INV_DIR','TAX_INV_CLASS','TAX_INV_TYPE','TAX_VENDOR_TP')
--  GROUP BY 1 ORDER BY 1;   -- TAX_INV_CLASS 1 · TAX_INV_DIR 2 · TAX_INV_TYPE 1 · TAX_VENDOR_TP 2
-- SELECT id, header_row, cardinality(header_signature) FROM public.tb_s050_import_maps;  -- HOMETAX_TAX_INVOICE · 6 · 33
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 세무 표(203)에 이 코드 · 대응표를 쓰는 줄이 있으면 먼저 본다
--   (코드에는 FK 가 없어 막아 주지 않는다. 대응표는 올린 파일이 가리키면 RESTRICT 로 막힌다)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.tb_s050_import_maps    WHERE id = 'HOMETAX_TAX_INVOICE';
-- DELETE FROM public.tb_s080_codes_line      WHERE category IN ('TAX_INV_DIR','TAX_INV_CLASS','TAX_INV_TYPE','TAX_VENDOR_TP');
-- DELETE FROM public.tb_s080_code_categories WHERE category IN ('TAX_INV_DIR','TAX_INV_CLASS','TAX_INV_TYPE','TAX_VENDOR_TP');
-- DELETE FROM public.tb_s080_code_masters    WHERE category IN ('TAX_INV_DIR','TAX_INV_CLASS','TAX_INV_TYPE','TAX_VENDOR_TP');
-- COMMIT;
