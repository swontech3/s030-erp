-- =============================================================================
-- 206_tax_kind_descriptions.sql
--
-- 세무(S05) 자료 올리기 — 자료 카드 설명 (1-2 멈춤 3-B, 2026-10-27 대표 지시)
--
--   분류       칸            쓰는 곳
--   TAX_KIND   description   자료 올리기 카드의 설명 줄(API `codes.kinds[].description`). 비어 있으면 카드에 설명이 안 보인다
--
-- ★ 문구는 결과서 `doc/tax-service/tax-service/08-screen-report.md` S05-02 「자료 카드」 표의 설명 그대로
--   (시안 `prototypes/s05-tax/tax-data.js` KINDS 의 desc 와 같다). 4대보험 줄 끝의 「(기관 선택 없음 — 한 곳에서
--   받는 파일)」은 결과서의 풀이라 넣지 않았다 — 시안 카드에도 없다.
-- ★ **비어 있는 설명만 채운다** — 코드 관리에서 이미 적은 설명(NULL 도 빈 글자도 아닌 것)은 덮지 않는다.
--   설명은 앞으로도 코드 관리에서 고친다.
--
-- 하는 일 · 영향: tb_s080_codes_line 의 TAX_KIND 8줄의 description 만 고친다. 다른 칸 · 다른 분류 ·
--   표 구조 · 권한은 바꾸지 않는다. 다시 돌려도 같은 결과다(이미 채워진 줄은 건드리지 않는다).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 202 의 TAX_KIND 8줄이 있어야 한다 — 없으면 멈춘다
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.tb_s080_codes_line
   WHERE build_id = '1' AND category = 'TAX_KIND' AND use_tp = '000'
     AND code IN ('INVOICE', 'CARD', 'CASH', 'BANK', 'NTAX', 'LTAX', 'SOCIAL', 'LOAN');
  IF n <> 8 THEN
    RAISE EXCEPTION '206 — TAX_KIND 코드값 8줄이 있어야 한다(지금 %줄). 202 를 먼저 적용할 것', n;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. 설명 — 비어 있는 줄만
-- -----------------------------------------------------------------------------
UPDATE public.tb_s080_codes_line AS l
   SET description = d.description,
       updated_at  = CURRENT_TIMESTAMP
  FROM (VALUES
    ('INVOICE', '홈택스 전자세금계산서·계산서 목록 엑셀 그대로 올립니다'),
    ('CARD',    '카드사 사이트에서 받은 엑셀. 카드사를 고르면 표준양식으로 바뀝니다'),
    ('CASH',    '표준양식. 항목 칸을 비워 두면 거래 분류에서 붙입니다'),
    ('BANK',    '통장 거래내역 엑셀. 은행과 계좌를 고릅니다'),
    ('NTAX',    '홈택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다'),
    ('LTAX',    '위택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다'),
    ('SOCIAL',  '4대사회보험 정보연계센터에서 내려받은 고지 내역 파일을 올립니다'),
    ('LOAN',    '표준양식. 원금·이자 칸을 따로 적습니다 — 이자만 비용입니다')
  ) AS d(code, description)
 WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.use_tp = '000' AND l.code = d.code
   AND (l.description IS NULL OR btrim(l.description) = '');

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- SELECT code, description FROM public.tb_s080_codes_line
--  WHERE category = 'TAX_KIND' ORDER BY sort_order;   -- 8줄 모두 설명이 차 있다
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — 이 파일이 넣은 문구와 **같은** 설명만 비운다(그 뒤 코드 관리에서 고친 설명은 남는다)
-- -----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.tb_s080_codes_line AS l SET description = NULL, updated_at = CURRENT_TIMESTAMP
--   FROM (VALUES ('INVOICE','홈택스 전자세금계산서·계산서 목록 엑셀 그대로 올립니다'), … 위 8줄 …) AS d(code, description)
--  WHERE l.build_id = '1' AND l.category = 'TAX_KIND' AND l.code = d.code AND l.description = d.description;
-- COMMIT;
