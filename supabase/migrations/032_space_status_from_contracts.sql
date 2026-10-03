-- =============================================================================
-- 032 · 호실상태를 계약에 맞춰 **한 번 바로잡는다** (2026-10-03)
-- =============================================================================
-- 왜 필요한가
-- -----------------------------------------------------------------------------
-- `tb_s080_spaces.status`(코드 `ROOM_ST`)를 바꾸는 코드가 지금까지 **하나도 없었다.**
-- 계약을 확정해도, 끝내도 아무도 건드리지 않아 **72실 전부 `E`(공실)** 로 남아 있었다 —
-- 확정 계약이 살아 있는 Room 1 까지 공실이었다.
--
-- 이제부터는 계약이 바꾼다(`packages/api/src/db/spaceStatus.ts`). 이 마이그레이션은
-- 그 규칙을 **과거 데이터에 한 번 적용**하는 것이고, 같은 계산식을 쓴다:
--
--     확정(confirmed) 이 하나라도 있으면   → 'O' 입주중
--     아니고 대기(draft) 가 있으면         → 'R' 예약중
--     그 외(종료·취소·계약 없음)           → 'E' 공실
--
-- ★ 센 쪽을 쓴다(확정 > 대기 > 없음). 재계약처럼 둘이 겹치는 동안 「예약중」으로
--   내려가면 지금 사람이 들어 있는 방이 비어 보인다.
--
-- ★ 되돌리기: 아래 ROLLBACK 절은 **전부 'E' 로 되돌린다.** 옛 값이 전부 'E' 였기
--   때문이고(실측), 그래서 손실 없이 되돌아간다.
--
-- 영향 범위 — `tb_s080_spaces.status` 한 칸뿐이다. 스키마는 바뀌지 않는다.
-- =============================================================================

BEGIN;

-- 적용 전 상태를 로그에 남긴다(`apply-migration.js` 가 notice 를 찍는다).
DO $$
DECLARE
  n_before text;
BEGIN
  SELECT string_agg(status || '=' || c, ' · ' ORDER BY status)
    INTO n_before
    FROM (SELECT status, count(*)::int AS c FROM public.tb_s080_spaces GROUP BY status) t;
  RAISE NOTICE '적용 전 호실상태: %', coalesce(n_before, '(호실 없음)');
END $$;

UPDATE public.tb_s080_spaces s
   SET status = x.next,
       updated_at = now(),
       updated_by = 'migration-032'
  FROM (
    SELECT sp.space_id,
           CASE
             WHEN bool_or(k.status = 'confirmed') THEN 'O'
             WHEN bool_or(k.status = 'draft')     THEN 'R'
             ELSE 'E'
           END AS next
      FROM public.tb_s080_spaces sp
      LEFT JOIN public.tb_s080_contract_spaces cs ON cs.space_id = sp.space_id
      LEFT JOIN public.tb_s080_contracts       k  ON k.contract_id = cs.contract_id
     GROUP BY sp.space_id
  ) x
 WHERE s.space_id = x.space_id
   AND s.status IS DISTINCT FROM x.next;

DO $$
DECLARE
  n_after text;
BEGIN
  SELECT string_agg(status || '=' || c, ' · ' ORDER BY status)
    INTO n_after
    FROM (SELECT status, count(*)::int AS c FROM public.tb_s080_spaces GROUP BY status) t;
  RAISE NOTICE '적용 후 호실상태: %', coalesce(n_after, '(호실 없음)');
END $$;

COMMIT;

-- =============================================================================
-- 확인
-- =============================================================================
-- 1) 어긋난 호실이 0 인가
--    SELECT count(*) FROM public.tb_s080_spaces s
--      JOIN LATERAL (
--        SELECT CASE WHEN bool_or(k.status='confirmed') THEN 'O'
--                    WHEN bool_or(k.status='draft')     THEN 'R'
--                    ELSE 'E' END AS next
--          FROM public.tb_s080_contract_spaces cs
--          LEFT JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
--         WHERE cs.space_id = s.space_id
--      ) x ON true
--     WHERE s.status IS DISTINCT FROM x.next;            -- 0
-- 2) 분포       SELECT status, count(*) FROM public.tb_s080_spaces GROUP BY 1;
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- UPDATE public.tb_s080_spaces SET status = 'E' WHERE status <> 'E';
