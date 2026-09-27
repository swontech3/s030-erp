-- =============================================================================
-- 025_reservation_status.sql
--
-- 회의실 예약의 **상태 어휘**와 **시간 순서**를 DB 가 막게 한다.
--   ① ck_s080_reservations_status  status ∈ (confirmed · cancelled · completed)
--   ② ck_s080_reservations_range   start_at < end_at
--
-- =============================================================================
-- ★★★ 왜 CHECK 이 필요한가 — 오타 하나로 **중복 방지가 풀린다**
-- =============================================================================
-- 002 가 만든 배타 제약은 `status = 'confirmed'` 에서만 걸린다.
--
--   EXCLUDE USING gist (facility_id WITH =, tsrange(start_at, end_at) WITH &&)
--     WHERE (status = 'confirmed')
--
-- 그래서 `confirmd` 처럼 잘못 적힌 상태의 예약은 **아무와도 다투지 않고** 같은 회의실
-- 같은 시간에 몇 건이든 들어간다. 그 예약은 화면에도 「확정」으로 안 보이고, 그 자리는
-- 비어 있는 것으로 보인다 — 두 팀이 같은 방에 들어간 뒤에야 안다.
-- 2026-09-27 확인: 이 표의 status 에는 CHECK 이 **없었고**, `'헛소리'` 가 그대로 들어갔다.
--
-- ★★ 시작 > 종료도 같은 자리에서 새어 나갔다. 확정 예약은 배타 인덱스가 `tsrange` 를
--    만들다 22000 으로 막아 주지만, **취소·종료 상태에는 인덱스가 걸리지 않아** 뒤집힌
--    시간이 그대로 저장됐다. 그 행은 이용 시간이 음수가 되어 하루 한도 계산을 깨뜨린다.
--
-- =============================================================================
-- 어휘 — 셋뿐이다. 「신청」은 나중에 넣을 수 있게 자리를 남겼다
-- =============================================================================
--   confirmed  확정 — 자리를 잡는다(배타 제약이 이 값에만 걸린다)
--   cancelled  취소 — 소프트 취소. `cancelled_at`·`cancel_reason` 을 남긴다
--   completed  종료 — 시간이 지나 운영자가 닫았다. **자동 배치는 없다**
--
-- ★★ 「신청」(`requested`)을 넣으려면 ① 이 CHECK 에 값을 더하고 ② shared 의
--    `RESERVATION_STATUS` 를 같이 늘리고 ③ **배타 제약에 넣을지 정해야 한다** —
--    신청이 자리를 잡아 두는가가 그 결정이다. 지금은 승인 절차가 없어 넣지 않았다.
--    두 곳(여기와 shared)이 갈리면 화면이 넣는 값이 DB 에서 막힌다.
--
-- ★ 상태 전이는 앱이 정한다(확정 → 취소 / 확정 → 종료). DB 는 어휘만 지킨다 —
--   전이를 트리거로 박으면 운영자가 손으로 고쳐야 하는 날 손댈 수 없다.
--
-- =============================================================================
-- 건드리지 않은 것
-- =============================================================================
-- ★ `company_id` 는 **nullable 그대로**다. 운영자가 외부 손님 건을 대신 잡으면 비운다
--   (그 예약은 RLS 때문에 운영사에게만 보인다 — 003 주석). 입주사 예약에 입주사를
--   반드시 채우는 것은 **앱의 규칙**이고, 라우트가 세션에서 넣는다. NOT NULL 로 박으면
--   외부 건을 넣을 길이 사라진다.
-- ★ 계약(`contract_id`) 칸을 만들지 않았다. 예약은 계약 없이도 서고, 요금은 예약 행의
--   `usage_fee` 에 남는다. 청구로 넘기는 길은 021 이 이미 열어 두었다
--   (`tb_s080_invoices.contract_id` 가 NULL 을 받는다) — 자리만 있고 잇지는 않았다.
--
-- 적용 시점 예약 건수: 0 (007 이 레거시 2행을 지웠다). 그래서 **되돌림 없이 붙는다** —
-- 어휘 밖 값이 이미 들어 있으면 CHECK 추가가 실패하므로, 그때는 그 행을 먼저 본다.
--
-- 사용: node scripts/apply-migration.js .env supabase/migrations/025_reservation_status.sql
-- =============================================================================

BEGIN;

-- ① 상태 어휘 ----------------------------------------------------------------
ALTER TABLE public.tb_s080_reservations
  DROP CONSTRAINT IF EXISTS ck_s080_reservations_status;

ALTER TABLE public.tb_s080_reservations
  ADD CONSTRAINT ck_s080_reservations_status
  CHECK (status IN ('confirmed', 'cancelled', 'completed'));

-- ② 시간 순서 ----------------------------------------------------------------
ALTER TABLE public.tb_s080_reservations
  DROP CONSTRAINT IF EXISTS ck_s080_reservations_range;

ALTER TABLE public.tb_s080_reservations
  ADD CONSTRAINT ck_s080_reservations_range
  CHECK (start_at < end_at);

COMMENT ON COLUMN public.tb_s080_reservations.status IS
  '확정 confirmed / 취소 cancelled / 종료 completed. 어휘는 025 의 CHECK 와 shared 의 RESERVATION_STATUS 가 같이 지킨다. 배타 제약은 confirmed 에만 걸린다.';

COMMENT ON COLUMN public.tb_s080_reservations.company_id IS
  '예약한 입주사. 운영자가 외부 건을 대신 잡으면 NULL — 그 예약은 RLS 때문에 운영사에게만 보인다.';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
--   node scripts/verify-booking.js        ← 이 마이그레이션을 보는 검증
--   node scripts/verify-001-003.js .env   ← V6·V7·V7b 배타 제약이 그대로인지
--
-- 1) 어휘 밖 값이 막히는지
--    INSERT ... status='헛소리'   → 23514
-- 2) 뒤집힌 시간이 막히는지 (취소 상태여도)
--    INSERT ... status='cancelled', start_at > end_at   → 23514
-- 3) 붙는 예약(10~11 · 11~12)이 여전히 통과하는지 → 성공해야 한다
--
-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- ALTER TABLE public.tb_s080_reservations
--   DROP CONSTRAINT IF EXISTS ck_s080_reservations_status,
--   DROP CONSTRAINT IF EXISTS ck_s080_reservations_range;
-- COMMIT;
