-- =============================================================================
-- 033 · 호실마다 「입주 가능 회사 수」 (2026-10-03)
-- =============================================================================
-- 왜 필요한가
-- -----------------------------------------------------------------------------
-- 한 호실에 몇 곳까지 들어갈 수 있는지가 **코드에 박혀 있었다**
-- (`packages/shared/src/domain/space-occupancy.ts`):
--
--     비상주(VR)  0곳이어야 고를 수 있다  ⇒ 1곳
--     그 외        1곳까지 있어도 고른다   ⇒ 2곳
--
-- 72실이 전부 같은 수를 쓸 이유가 없다 — 3인실과 자유석이 같은 2곳이었다. 이제
-- **호실마다 운영자가 정한다**(센터 관리 p3 호실 등록·수정 팝업).
--
-- ★ 세는 단위는 **회사**다. 한 회사가 같은 호실을 두 계약으로 잡아도 1곳이다
--   (`occupancyBySpace` 가 회사로 접는다). 그래서 칸 이름이 「건수」가 아니라
--   「입주 가능 회사 수」다 — 「건수」는 계약서 장수로 읽힌다.
--
-- ★ 비상주 특례는 **없앴다.** 규칙이 둘이면 운영자가 넣은 수가 50실에서 조용히
--   무시된다. 비상주 호실도 기본 1 이라 오늘 동작은 지금과 똑같고, 2 이상으로
--   올리는 것은 화면이 「같은 주소로 두 사업자가 등록됩니다」를 알린 뒤의 선택이다.
--
-- 기본값 1
-- -----------------------------------------------------------------------------
-- 72실 전부 1 로 들어간다(결정 2026-10-03). 살아 있는 계약은 Room 1 하나뿐이라
-- 조여도 걸리는 호실이 없다 — 다만 비상주가 아닌 호실은 지금 2곳까지 되던 것이
-- 1곳으로 **조여진다.** 더 받을 호실은 운영자가 p3 에서 올린다.
--
-- 영향 범위 — 칸 하나를 **더한다.** 기존 칸과 값은 건드리지 않는다.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_spaces
  ADD COLUMN IF NOT EXISTS max_companies integer NOT NULL DEFAULT 1;

-- ★ 0 이나 음수가 들어오면 그 호실은 **아무도 고를 수 없는 방**이 된다. 화면도
--   서버도 1 미만을 거절하지만, 마지막 자리를 DB 에 둔다.
ALTER TABLE public.tb_s080_spaces
  DROP CONSTRAINT IF EXISTS tb_s080_spaces_max_companies_chk;
ALTER TABLE public.tb_s080_spaces
  ADD CONSTRAINT tb_s080_spaces_max_companies_chk CHECK (max_companies >= 1);

COMMENT ON COLUMN public.tb_s080_spaces.max_companies IS
  '입주 가능 회사 수 — 살아 있는 계약(confirmed·draft)을 가진 회사를 몇 곳까지 받는가. 한 회사의 계약 여럿은 1곳이다.';

DO $$
DECLARE
  n text;
BEGIN
  SELECT string_agg(max_companies || '곳=' || c, ' · ' ORDER BY max_companies)
    INTO n
    FROM (SELECT max_companies, count(*)::int AS c FROM public.tb_s080_spaces GROUP BY max_companies) t;
  RAISE NOTICE '입주 가능 회사 수 분포: %', coalesce(n, '(호실 없음)');
END $$;

COMMIT;

-- =============================================================================
-- 확인
-- =============================================================================
-- 1) 분포        SELECT max_companies, count(*) FROM public.tb_s080_spaces GROUP BY 1;   -- 1곳=72
-- 2) 넘긴 호실   SELECT s.room_name, s.max_companies, count(DISTINCT k.company_id) AS n
--                  FROM public.tb_s080_spaces s
--                  JOIN public.tb_s080_contract_spaces cs ON cs.space_id = s.space_id
--                  JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
--                 WHERE k.status IN ('confirmed','draft')
--                 GROUP BY 1, 2 HAVING count(DISTINCT k.company_id) > s.max_companies;   -- 0행
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- ALTER TABLE public.tb_s080_spaces DROP CONSTRAINT IF EXISTS tb_s080_spaces_max_companies_chk;
-- ALTER TABLE public.tb_s080_spaces DROP COLUMN IF EXISTS max_companies;
