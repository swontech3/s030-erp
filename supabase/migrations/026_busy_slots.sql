-- =============================================================================
-- 026_busy_slots.sql
--
-- 입주사에게 **남의 예약 자리**를 보여 주기 위한 조회 하나.
--   public.erp_busy_slots(facility_id, from, to) → (facility_id, day, start_time, end_time)
--
-- =============================================================================
-- ★★★ 왜 필요한가 — 잡힌 칸이 **빈 칸으로** 보였다
-- =============================================================================
-- 003 의 RLS(`erp_company_scope`)는 입주사 세션에 **자기 회사 예약만** 보여 준다.
-- 그래서 남이 잡아 둔 시간이 주간 그리드에서 빈 칸으로 보이고, 눌러서 예약하면
-- 서버가 409(이미 예약된 시간)로 막았다 — 눌러 보고서야 알았다.
--
-- 그 칸을 잠그려면 「그 시간이 차 있다」는 사실만 알면 된다. **누가** 잡았는지는
-- 알 필요가 없고, 알려 주면 안 된다.
--
-- =============================================================================
-- ★★★ 왜 함수인가 — 앱에서 운영자 스코프로 읽지 않는다
-- =============================================================================
-- 같은 일을 앱에서도 할 수 있다: `withCompanyScope({ role: 'operator' })` 로 한 번 더
-- 읽고 시각만 골라 내려보내면 된다. 그러면 **그 트랜잭션 안에서 예약 표 전체가 열린다** —
-- 지금 SELECT 가 시각만 고르고 있을 뿐이다. 나중에 누가 회사명을 JOIN 하거나, 그 스코프를
-- 재활용해 다른 조회를 하나 더 붙이면 이름이 새고, 코드 리뷰에서만 걸린다.
--
-- 함수로 두면 **DB 가 시각 넷 말고는 돌려줄 수 없다.** SECURITY DEFINER 로 RLS 를
-- 지나가는 자리를 이 함수 하나로 좁히고, 그 함수의 반환형이 곧 「무엇까지 새도 되는가」다.
-- `scripts/verify-booking.js` 8절이 반환형에 company·title·member 가 없는지 본다.
--
-- ★ SECURITY DEFINER 의 규칙 셋:
--   ① `SET search_path` 를 박는다 — 호출자가 앞에 스키마를 끼워 남의 함수를 부르게 할 수
--      없게 한다. 이 함수의 유일한 방어선이다.
--   ② 입력을 그대로 쓰지 않는다 — 여기서는 동적 SQL 이 아예 없다(정적 SELECT + 파라미터).
--   ③ 권한을 좁힌다 — PUBLIC 에서 회수하고 `erp_app` 에만 EXECUTE 를 준다.
--
-- =============================================================================
-- 무엇을 자리로 보는가
-- =============================================================================
-- ★ `status <> 'cancelled'` — 확정과 종료가 자리를 잡는다. 취소는 빈 칸이다.
--   (배타 제약은 confirmed 에만 걸리지만, 종료된 예약도 그 시간을 **썼다**. 그 칸을
--    비워 두면 지난 시간의 그리드가 실제와 달라진다.)
-- ★ 취소·종료를 여기서 고르는 것은 「자리를 잡는가」의 판정이라 **화면 규칙이 아니다** —
--   겹침을 판정하는 배타 제약과 같은 층에 둔다.
--
-- ★★ 운영자에게는 이 함수를 쓰지 않는다. 운영자는 예약을 전부 상세로 보므로 같은 것을
--    두 번 내려보낼 이유가 없다(`routes/booking.ts` 의 GET /reservations).
--
-- 사용: node scripts/apply-migration.js .env supabase/migrations/026_busy_slots.sql
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.erp_busy_slots(text, date, date);

CREATE FUNCTION public.erp_busy_slots(
  p_facility_id text,
  p_from        date,
  p_to          date
)
RETURNS TABLE (
  facility_id text,
  day         text,
  start_time  text,
  end_time    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- ★ 여기서 고르는 네 칸이 곧 「새도 되는 것」의 전부다. 칼럼을 더하지 않는다.
  SELECT r.facility_id,
         to_char(r.start_at, 'YYYY-MM-DD'),
         to_char(r.start_at, 'HH24:MI'),
         to_char(r.end_at,   'HH24:MI')
    FROM public.tb_s080_reservations r
   WHERE (p_facility_id IS NULL OR r.facility_id = p_facility_id)
     AND r.status <> 'cancelled'
     AND r.start_at >= p_from
     AND r.start_at <  (p_to + interval '1 day')
   ORDER BY r.start_at
$$;

-- ★ 권한을 좁힌다 — 기본값(PUBLIC 에 EXECUTE)을 그대로 두지 않는다.
REVOKE ALL ON FUNCTION public.erp_busy_slots(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erp_busy_slots(text, date, date) TO erp_app;

COMMENT ON FUNCTION public.erp_busy_slots(text, date, date) IS
  '입주사 화면이 남의 예약 자리를 「예약됨」으로 잠그기 위한 조회. 회의실·날짜·시작·종료 시각만 돌려준다 — 회사명·제목·예약자는 돌려주지 않는다. SECURITY DEFINER 로 RLS(003)를 지나가므로 반환 칼럼을 늘리면 안 된다.';

COMMIT;

-- =============================================================================
-- 되돌리기
-- =============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.erp_busy_slots(text, date, date);
-- COMMIT;
-- ★ 되돌리면 입주사 화면에서 남의 예약이 다시 **빈 칸**으로 보인다(그리고 눌러야 409).
