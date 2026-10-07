-- =============================================================================
-- 036_bbiyong_link_retry.sql
--
-- 삐용 연동 실패를 **저절로 다시 보내기** 위한 두 칸. 회사와 구성원 양쪽에 같은 모양.
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 횟수를 세는가 — 영원히 두드리지 않기 위해서다
-- -----------------------------------------------------------------------------
-- 지금까지 「연동 대기」를 푸는 길은 **운영자가 그 계약 화면을 열어 [다시 시도] 를
-- 누르는 것** 하나였다. 다른 일 하다 보면 묻히고, 그동안 그 입주사는 삐용에
-- 로그인할 수 없다. 그래서 운영자가 ERP 를 쓰는 동안 **서버가 뒤에서 다시 보낸다**
-- (`companies/retrySweep.ts`).
--
-- 그 대가로 「영원히 재시도하는 행」이 생길 수 있다. 삐용이 영구히 거절하는 값
-- (이메일 겹침 · 권한 없음)이면 몇 번을 보내도 같은 답이 온다. 그걸 멈추는 근거가
-- 이 두 칸이다.
--
-- -----------------------------------------------------------------------------
-- ★★★ `link_retryable` — **삐용이 이미 알려 주는 값이다**
-- -----------------------------------------------------------------------------
-- 어댑터는 업무 실패에 `retryable` 을 붙여서 돌려준다(`bbiyong/types.ts`):
--
--     retryable: false   값·권한 문제 — 같은 조건으로 다시 보내면 같은 답이다
--                        (AUTHZ_DENY · 이메일 겹침 · 필수 칸 비었음 · 코드 소진)
--     retryable: true    삐용 장애 · 응답을 읽을 수 없음 — 다시 보내면 풀릴 수 있다
--
-- 2026-10-05 까지 그 값을 **버리고 문구만 저장했다.** 그래서 「잠깐 끊긴 것」과
-- 「값이 틀린 것」을 구분할 수 없었다. 이 칸이 그것을 보관한다.
--
-- ★★ **완벽하게 가려지지는 않는다.** 삐용이 **연락처 중복에 HTTP 500** 을 주는
--    결함이 있고(실측 2026-10-05, 삐용이 고치기로 했다), 500 은 규격 밖이라 ERP 가
--    「장애」(`retryable: true`)로 본다. 즉 **영구 실패가 재시도 가능으로 분류된다.**
--    그걸 받아 주는 것이 횟수 상한이다 — 5번 보내고 멈춘다.
--
-- ★ `link_retryable` 이 NULL 인 것은 「모른다」다(실패한 적이 없거나 036 이전 행).
--   재시도 판정은 **NULL 을 막지 않는다** — `false` 만 막는다(`retryPolicy.ts`).
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_companies
  ADD COLUMN IF NOT EXISTS link_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS link_retryable     boolean;

ALTER TABLE public.tb_s080_members
  ADD COLUMN IF NOT EXISTS link_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS link_retryable     boolean;

COMMENT ON COLUMN public.tb_s080_companies.link_attempt_count IS
  '삐용 연동을 연달아 실패한 횟수. 성공하면 0 으로 돌아간다. ★ 상한(5)에 닿으면 '
  '저절로 다시 보내지 않고 화면이 「손봐야 합니다」로 바뀐다 — 상한은 코드에 있다'
  '(bbiyong/retryPolicy.ts). 여기 숫자를 보고 사람이 판단하는 값이 아니다.';

COMMENT ON COLUMN public.tb_s080_companies.link_retryable IS
  '마지막 실패가 **다시 보내면 풀릴 종류인가**. 삐용 어댑터의 outcome.retryable 이다. '
  'false = 값·권한 문제(같은 답이 온다) → 한 번도 다시 보내지 않는다. true = 장애. '
  'NULL = 모른다(실패한 적 없음 또는 036 이전) → 막지 않는다. '
  '★ 삐용이 연락처 중복에 500 을 주는 결함 때문에 영구 실패가 true 로 분류될 수 있다 '
  '— 그래서 횟수 상한이 함께 있어야 한다.';

COMMENT ON COLUMN public.tb_s080_members.link_attempt_count IS
  '같은 뜻 — tb_s080_companies.link_attempt_count 참조.';
COMMENT ON COLUMN public.tb_s080_members.link_retryable IS
  '같은 뜻 — tb_s080_companies.link_retryable 참조.';

-- -----------------------------------------------------------------------------
-- 재시도 대상을 찾는 질의가 쓰는 색인
-- -----------------------------------------------------------------------------
-- ★ 묻어 돌리는 방식이라 **운영자가 요청할 때마다** 이 질의가 돈다(쿨다운 60초로
--   묶지만 그래도 자주다). 부분 색인으로 「아직 연결 안 된 회사」만 담는다 —
--   연결된 회사(대부분)는 색인에 들어가지도 않는다.
CREATE INDEX IF NOT EXISTS ix_s080_companies_link_pending
  ON public.tb_s080_companies (link_failed_at)
  WHERE link_s020_org_id IS NULL AND link_status = 'pending';

CREATE INDEX IF NOT EXISTS ix_s080_members_link_pending
  ON public.tb_s080_members (link_failed_at)
  WHERE link_failed_reason IS NOT NULL AND status = 'active';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- 1) 칸 2개 × 2표
--    SELECT table_name, column_name, data_type, column_default, is_nullable
--      FROM information_schema.columns
--     WHERE table_schema='public' AND table_name IN ('tb_s080_companies','tb_s080_members')
--       AND column_name IN ('link_attempt_count','link_retryable') ORDER BY 1,2;
--
-- 2) 색인 2개
--    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'
--     AND indexname IN ('ix_s080_companies_link_pending','ix_s080_members_link_pending');
--
-- 3) 기존 행은 전부 0 / NULL
--    SELECT count(*) FROM public.tb_s080_companies WHERE link_attempt_count <> 0;   -- 0
--    SELECT count(*) FROM public.tb_s080_members   WHERE link_retryable IS NOT NULL; -- 0
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- DROP INDEX IF EXISTS public.ix_s080_companies_link_pending;
-- DROP INDEX IF EXISTS public.ix_s080_members_link_pending;
-- ALTER TABLE public.tb_s080_companies
--   DROP COLUMN IF EXISTS link_attempt_count, DROP COLUMN IF EXISTS link_retryable;
-- ALTER TABLE public.tb_s080_members
--   DROP COLUMN IF EXISTS link_attempt_count, DROP COLUMN IF EXISTS link_retryable;
