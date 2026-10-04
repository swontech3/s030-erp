-- =============================================================================
-- 034_reservation_overlap_scope.sql
--
-- 회의실 예약의 **배타 제약 범위**를 넓힌다.
--   확정만 → **취소가 아닌 전부**(확정 + 종료)
--
-- =============================================================================
-- ★★★ 왜 — 「차 있다」를 판정하는 곳이 둘이고, 선이 갈려 있었다
-- =============================================================================
-- 002 가 만든 배타 제약은 확정에만 걸렸다:
--
--   EXCLUDE USING gist (facility_id WITH =, tsrange(start_at, end_at) WITH &&)
--     WHERE (status = 'confirmed')
--
-- 그런데 입주사 화면에 「차 있음」을 칠해 주는 026 의 `erp_busy_slots` 는 이렇게 본다:
--
--   WHERE r.status <> 'cancelled'          -- 확정 + 종료
--
-- **화면은 종료된 자리를 차 있다고 보여 주는데 DB 는 그 위에 겹쳐 넣는 것을 막지
-- 않았다.** 한 가지 판정이 두 벌이고 선이 다른 상태다.
--
-- 2026-10-04 실측(넣어 보고 전부 되돌렸다):
--   확정 위에 확정        막힘 23P01      ← 유일하게 막히던 것
--   취소 위에 확정        들어감          ← **의도된 것**. 취소했으니 자리가 비었다
--   종료 위에 확정        들어감          ← 구멍
--   종료 위에 종료        들어감          ← 구멍
--   확정을 종료로 바꾼 뒤 **같은 시간**에 확정   들어감   ← 구멍
-- 그 결과 `erp_busy_slots` 가 같은 자리를 **두 줄**로 돌려준다(20:00~21:00 이 2건).
--
-- ★ 노출 경로가 실제로 있다 — `reservation-rules.ts` 의 `if (operator) return ok` 때문에
--   **운영자는 지난 시각에도 예약을 넣을 수 있다.** 종료된 예약이 쌓이는 자리가 바로
--   과거다. 겹쳐 넣으면 같은 방 같은 시간에 두 건이 기록으로 남는다.
--
-- =============================================================================
-- ★★ 왜 `status <> 'cancelled'` 인가 — 026 과 **글자 그대로 같은 식**이다
-- =============================================================================
-- `IN ('confirmed','completed')` 로 적어도 오늘은 같은 집합이다. 그런데 그러면
-- 026 과 **식이 달라** 앞으로도 둘을 짝지어 고쳤는지 사람이 챙겨야 한다. 같은 질문에는
-- 같은 문장을 쓴다 — 그래야 갈라질 자리가 없다.
--
-- ★ 그래서 나중에 「신청(requested)」 같은 상태가 생기면 **자동으로 자리를 잡는다.**
--   틀려도 안전한 쪽으로 틀리는 방향이다 — 못 잡아서 두 팀이 같은 방에 들어가는 것보다
--   잡아서 「이미 예약된 시간입니다」가 뜨는 편이 낫다. 025 머리말은 그때 배타 제약에
--   넣을지 **정하라**고 했는데, 이제 기본값이 「넣는다」이고 빼려면 명시해야 한다.
--
-- ★ 취소는 그대로 빠진다. 취소한 자리는 비어 있어야 하고, 그게 이 기능의 전부다.
--
-- =============================================================================
-- ★★ 왜 DROP 하고 다시 ADD 하는가 — ALTER 로는 못 바꾼다
-- =============================================================================
-- EXCLUDE 제약의 `WHERE` 절(인덱스 술어)은 고칠 수 없다. `ALTER CONSTRAINT` 로 바꿀 수
-- 있는 것은 지연 속성뿐이고, `NOT VALID` 로 검사를 미루는 길은 CHECK·FK 전용이다.
-- 그래서 **DROP → ADD** 뿐이고, ADD 가 gist 인덱스를 새로 만들며 기존 행을 전부 본다.
--
-- ★ **한 트랜잭션 안에서** 한다. 그래야 그 사이에 겹침이 들어올 창이 없다.
--   ADD 는 ACCESS EXCLUSIVE 를 잡지만 적용 시점 예약이 5행이라 즉시 끝난다.
--
-- ★ 적용 전에 확인했다 — 새 범위에서 다투는 행이 **0건**이라 ADD 가 실패하지 않는다.
--   지금 겹쳐 있는 유일한 한 쌍은 종료(06:30~07:00) ↔ **취소**(05:00~07:00)이고,
--   취소는 범위에서 빠지므로 다투지 않는다. 아래 「확인」 ①이 그 질의다.
--
-- 사용: node scripts/apply-migration.js .env supabase/migrations/034_reservation_overlap_scope.sql
-- =============================================================================

BEGIN;

-- 들어온 상태에서 다투는 쌍이 있으면 **여기서 멈춘다.** ADD 가 실패하면 메시지가
-- 「conflicting key value」뿐이라 어느 두 건인지 알 수 없다. 먼저 사람 말로 알린다.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.tb_s080_reservations a
    JOIN public.tb_s080_reservations b
      ON a.facility_id = b.facility_id
     AND a.reservation_id < b.reservation_id
     AND tsrange(a.start_at, a.end_at) && tsrange(b.start_at, b.end_at)
   WHERE a.status <> 'cancelled' AND b.status <> 'cancelled';

  IF n > 0 THEN
    RAISE EXCEPTION
      '새 범위에서 겹치는 예약이 % 쌍 있다. 아래 「확인 ①」 질의로 찾아 먼저 정리할 것', n;
  END IF;
END $$;

ALTER TABLE public.tb_s080_reservations
  DROP CONSTRAINT IF EXISTS tb_s080_reservations_no_overlap;

ALTER TABLE public.tb_s080_reservations
  ADD CONSTRAINT tb_s080_reservations_no_overlap
  EXCLUDE USING gist (facility_id WITH =, tsrange(start_at, end_at) WITH &&)
  WHERE (status <> 'cancelled');

COMMENT ON CONSTRAINT tb_s080_reservations_no_overlap ON public.tb_s080_reservations IS
  '같은 회의실 · 겹치는 시간을 막는다. ★ 범위는 취소가 아닌 전부(확정 + 종료)이고, '
  '026 erp_busy_slots 의 WHERE 와 **같은 식**이다 — 「차 있다」의 판정은 한 선이어야 한다(034). '
  '취소는 빠진다. 겹치면 23P01 이고 라우트가 409 OVERLAP 으로 옮긴다.';

-- 025 가 남긴 설명이 더 이상 맞지 않는다 — 「confirmed 에만 걸린다」였다.
COMMENT ON COLUMN public.tb_s080_reservations.status IS
  '확정 confirmed / 취소 cancelled / 종료 completed. 어휘는 025 의 CHECK 와 shared 의 '
  'RESERVATION_STATUS 가 같이 지킨다. ★ 배타 제약은 **취소가 아닌 전부**에 걸린다(034) — '
  '종료된 예약도 자리를 잡는다. 상태를 더하면 기본값이 「자리를 잡는다」이고, 빼려면 '
  '034 의 WHERE 와 026 의 erp_busy_slots 를 **함께** 고쳐야 한다.';

COMMIT;

-- =============================================================================
-- 확인
-- =============================================================================
-- ① 새 범위에서 겹치는 쌍 (0행이어야 한다 — 적용 전에도 이 질의로 본다)
--    SELECT a.reservation_id, a.status, b.reservation_id, b.status, a.facility_id,
--           a.start_at, a.end_at, b.start_at, b.end_at
--      FROM public.tb_s080_reservations a
--      JOIN public.tb_s080_reservations b
--        ON a.facility_id = b.facility_id AND a.reservation_id < b.reservation_id
--       AND tsrange(a.start_at, a.end_at) && tsrange(b.start_at, b.end_at)
--     WHERE a.status <> 'cancelled' AND b.status <> 'cancelled';
--
-- ② 제약 정의
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'tb_s080_reservations_no_overlap';
--    → EXCLUDE USING gist (...) WHERE ((status <> 'cancelled'::text))
--
-- ③ 026 과 같은 선인가 — 두 식이 같은 글자여야 한다
--    SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'erp_busy_slots';
--    → WHERE ... r.status <> 'cancelled'
--
-- ④ 실제로 막는가 — npx tsx scripts/verify-booking.js
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- ALTER TABLE public.tb_s080_reservations DROP CONSTRAINT tb_s080_reservations_no_overlap;
-- ALTER TABLE public.tb_s080_reservations
--   ADD CONSTRAINT tb_s080_reservations_no_overlap
--   EXCLUDE USING gist (facility_id WITH =, tsrange(start_at, end_at) WITH &&)
--   WHERE (status = 'confirmed');
-- COMMIT;
-- ★ 되돌리면 종료된 자리 위에 다시 겹쳐 들어간다. 되돌릴 일이 생기면 026 의
--   erp_busy_slots 도 'confirmed' 로 함께 좁혀야 두 선이 맞는다.
