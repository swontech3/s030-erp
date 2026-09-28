-- =============================================================================
-- 030_inquiry_type_names.sql
--
-- 문의유형(`QU_TP`) 세 가지의 **이름만** 고친다 (사용자 지시 2026-09-28).
--
--   L  법무설립문의   → 법무서비스문의
--   T  세무문의       → 세무서비스문의
--   E  기타           → 기타문의
--
-- ★★ `code` 는 그대로다(L·T·E). 이미 등록된 문의의 `type` 컬럼이 그 값을 들고 있으므로
--    코드를 바꾸면 옛 글의 제목이 빈 칸이 된다 — 바꾸는 것은 표시 이름뿐이다.
-- ★★ 화면에는 이름이 박혀 있지 않다. 고객 목록·검색·문의하기 버튼과 운영자 목록·
--    필터가 모두 `/inquiries/codes` 로 읽으므로, 이 UPDATE 한 번이 다섯 자리에 반영된다
--    (확인: `grep -r '법무설립문의' packages/*/src` → 0건).
-- ★ `sort_order` 도 그대로다 — 화면의 버튼 순서가 곧 이 순서다(02-screens §3).
-- =============================================================================

BEGIN;

UPDATE public.tb_s080_codes_line
   SET name = '법무서비스문의', updated_at = CURRENT_TIMESTAMP
 WHERE line_id = 'cl_1_QU_TP_L' AND category = 'QU_TP';

UPDATE public.tb_s080_codes_line
   SET name = '세무서비스문의', updated_at = CURRENT_TIMESTAMP
 WHERE line_id = 'cl_1_QU_TP_T' AND category = 'QU_TP';

UPDATE public.tb_s080_codes_line
   SET name = '기타문의', updated_at = CURRENT_TIMESTAMP
 WHERE line_id = 'cl_1_QU_TP_E' AND category = 'QU_TP';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- SELECT code, name, sort_order FROM public.tb_s080_codes_line
--  WHERE category = 'QU_TP' ORDER BY sort_order;
-- → O 입주문의 / L 법무서비스문의 / T 세무서비스문의 / R 연구소설립문의 / E 기타문의
--
-- =============================================================================
-- 되돌리기 — 이름만 되돌린다(028 의 값)
-- =============================================================================
-- UPDATE public.tb_s080_codes_line SET name = '법무설립문의' WHERE line_id = 'cl_1_QU_TP_L';
-- UPDATE public.tb_s080_codes_line SET name = '세무문의'     WHERE line_id = 'cl_1_QU_TP_T';
-- UPDATE public.tb_s080_codes_line SET name = '기타'         WHERE line_id = 'cl_1_QU_TP_E';
