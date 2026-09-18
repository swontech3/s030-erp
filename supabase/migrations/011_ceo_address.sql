-- =============================================================================
-- 011_ceo_address.sql
--
-- 입주사에 **대표자 자택 주소** 3칸을 더한다. 계약 폼 섹션 1 의 「대표자 주소」가
-- 저장될 자리다(3-4 작업 C).
--
-- 근거: doc/CONTRACT_DATA_MODEL.md §C-2 ⑦ (정본). 이 파일과 어긋나면 그 문서를 따른다.
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 기존 address 를 쓰지 않는가 — 주소가 세 종류이기 때문이다
-- -----------------------------------------------------------------------------
--   대표자 자택 주소  계약 폼 입력. **계약서에 인쇄된다.** ERP 만 보관한다   ← 이 3칸
--   사업장 주소       건물 주소 + 계약호실. 화면 입력란이 없다.
--                     세금계산서와 삐용 org010.ADDRESS 로 가는 것은 **이쪽**이다
--   법인 등기 주소    등기부등본상 주소. ERP 는 다루지 않는다
--
-- `tb_s080_companies.address`(주석 「주소」)는 **사업장 주소 자리**다. 여기에 자택을
-- 넣으면 세금계산서와 삐용에 대표자 집 주소가 나간다 — 2026-09-18 에 tenant_registration
-- 의 sink 를 bbiyong→erp 로 바꾸며 막은 사고가 컬럼 단위로 되돌아온다.
-- `head_address`(본점)도 뜻이 다르다. 그래서 칸을 새로 만든다.
--
-- ★ 컬럼 3개만 더한다. 테이블을 새로 만들지 않는다.
-- ★ 기존 컬럼을 건드리지 않는다 — 레거시 데이터가 그대로 있고 뜻도 그대로다.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_companies
  ADD COLUMN IF NOT EXISTS ceo_zip_code       varchar(10),
  ADD COLUMN IF NOT EXISTS ceo_address        text,
  ADD COLUMN IF NOT EXISTS ceo_address_detail varchar(200);

COMMENT ON COLUMN public.tb_s080_companies.ceo_zip_code IS
  '대표자 자택 우편번호 — ★ 삐용에 보내지 않는다. 사업장 주소는 address 다';
COMMENT ON COLUMN public.tb_s080_companies.ceo_address IS
  '대표자 자택 기본주소 — 계약서 「주소」 행에 인쇄된다. ★ 회사 주소가 아니다';
COMMENT ON COLUMN public.tb_s080_companies.ceo_address_detail IS
  '대표자 자택 상세주소';

-- 사업장 주소 쪽에도 뜻을 박아 둔다. 주석이 없어서 두 주소가 섞였다.
COMMENT ON COLUMN public.tb_s080_companies.address IS
  '사업장 주소 — 세금계산서·삐용 org010.ADDRESS 가 쓰는 값. ★ 대표자 자택은 ceo_address 다';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- 1) 컬럼 3개가 생겼는지
--    SELECT column_name, data_type, coalesce(character_maximum_length,0) len
--      FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_companies'
--       AND column_name LIKE 'ceo_%' ORDER BY column_name;
--    -- ceo_address(text) · ceo_address_detail(varchar 200) · ceo_zip_code(varchar 10)
--
-- 2) 기존 주소 컬럼이 그대로인지 (건드리지 않았다)
--    SELECT count(*) FROM public.tb_s080_companies WHERE address IS NOT NULL;
--
-- 3) 주석이 붙었는지
--    SELECT column_name, col_description('public.tb_s080_companies'::regclass, ordinal_position)
--      FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_companies'
--       AND column_name IN ('address','ceo_address');
--
-- -----------------------------------------------------------------------------
-- 되돌리기 (적용 후에는 쓰지 말 것 — 값이 사라진다)
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.tb_s080_companies
--   DROP COLUMN IF EXISTS ceo_zip_code,
--   DROP COLUMN IF EXISTS ceo_address,
--   DROP COLUMN IF EXISTS ceo_address_detail;
