-- =============================================================================
-- 020_contract_files.sql
--
-- 첨부 서류(CONT-17)를 위해 `tb_cm_file` 을 **쓸 수 있는 상태로** 만든다.
--   ① 실물 없는 레거시 48행을 지운다
--   ② `storage_url` 컬럼을 **삭제한다** — 만료되는 값을 DB 에 두지 않는다
--   ③ RLS 를 켜고 운영사 전용 정책을 건다
--   ④ (target_type, target_id, file_purpose) 유일 인덱스 — 종류당 한 장
--
-- -----------------------------------------------------------------------------
-- ① 왜 48행을 지우나 — **실물이 없는 기록이다**
-- -----------------------------------------------------------------------------
-- 적용 전 확인한 사실 셋:
--   · `storage.objects` 의 `erp-files` 버킷에 **0건**이다. 48행이 가리키는 파일이 없다
--   · 48행의 `storage_url` 은 전부 `tmbyagqkygggtmimtwpq.supabase.co` —
--     **다른 클라우드 프로젝트**다. 이 인스턴스(192.168.0.14)의 것이 아니다
--   · `target_id` 48건 중 `tb_s080_companies` 에 있는 회사는 **0건**이다
-- 즉 어느 화면에서도 열 수 없고, 어느 회사에도 붙지 않는 기록이다. 남겨 두면
-- 「등록 2/3」 같은 건수만 틀리게 만든다.
--
-- ★ 백업: C:\Users\Swontech\swonbiz-db-backup\tb_cm_file-20260920-pre-cont17.sql
--   (pg_dump -t public.tb_cm_file · COPY 데이터 48행 확인)
--   **되돌리려면 이 파일이 유일한 원본이다.**
--
-- -----------------------------------------------------------------------------
-- ② 왜 `storage_url` 을 지우나 — 레거시 결함 ②
-- -----------------------------------------------------------------------------
-- 레거시는 **비공개 버킷에 공개 URL(`/object/public/...`)을 저장**했다. 둘 중 하나다:
-- 링크가 열리면 인증 없이 신분증이 열리는 것이고, 안 열리면 DB 에 죽은 값이 쌓이는
-- 것이다. 실제로는 후자였다(48행 전부 열리지 않는다).
--
-- 옳은 방식은 **볼 때마다 서명 URL 을 만드는 것**이다. 서명 URL 은 만료되므로
-- 저장하면 안 된다 — 저장하는 순간 «언젠가 죽는 값»이 된다.
-- 그래서 컬럼을 **남겨 두지 않고 지운다.** NULL 허용으로 두면 언젠가 누가 채운다.
-- 경로(`storage_path`)만 있으면 서명 URL 은 언제든 다시 만들 수 있다.
--
-- ★ 이 컬럼은 NOT NULL 이었다. 남겨 두면 INSERT 마다 거짓말을 적어야 한다.
--
-- -----------------------------------------------------------------------------
-- ③ 왜 RLS 인가 — 레거시 결함 ⑤, 그리고 **여기 들어가는 것이 신분증이다**
-- -----------------------------------------------------------------------------
-- `tb_cm_file` 은 지금 **RLS 가 꺼져 있고 정책이 하나도 없다.** `erp_app` 이
-- SELECT·INSERT·UPDATE·DELETE 를 다 갖고 있으므로, 라우트에서 역할 검사를 한 줄
-- 빠뜨리면 **입주사 세션이 다른 입주사의 신분증 목록을 그대로 본다.**
--
-- 라우트도 막고(`routes/files.ts` 의 403) DB 도 막는다. 두 겹으로 막는 이유는
-- 한쪽이 뚫렸을 때 다른 쪽이 남기 때문이다. 이 표에 들어가는 것이 주민등록증·
-- 사업자등록증이라 그 값이 크다.
--
-- ★ `tb_s080_companies` 보다 **더 좁게** 건다. 그쪽 읽기 정책은 `USING (true)` 이고
--   라우트가 403 을 낸다. 여기서는 읽기부터 `erp_is_operator()` 로 막는다 —
--   입주사가 파일 **목록**만 봐도 「저 회사가 무슨 서류를 냈는지」가 새기 때문이다.
--
-- -----------------------------------------------------------------------------
-- ④ 왜 유일 인덱스인가 — 「같은 종류 재업로드」의 뜻을 DB 에 새긴다
-- -----------------------------------------------------------------------------
-- 한 회사의 한 서류 종류는 **한 장**이다. 새로 올리면 옛것을 지우고 바꾼다.
-- 애플리케이션만 그 규칙을 알면, 동시에 두 번 올렸을 때 두 행이 남고 화면은 그중
-- 하나만 보여준다 — 나머지 한 장은 **아무도 지울 수 없는 파일**이 된다.
-- =============================================================================

BEGIN;

-- ── ① 실물 없는 레거시 기록 ────────────────────────────────────────────────
-- 48행 전부다. WHERE 를 붙이지 않는 것이 아니라, 붙일 기준이 없다 —
-- 전부 같은 이유로 죽어 있다(위 ① 참조).
DELETE FROM public.tb_cm_file;

-- ── ② 만료되는 값을 DB 에 두지 않는다 ──────────────────────────────────────
ALTER TABLE public.tb_cm_file DROP COLUMN IF EXISTS storage_url;

COMMENT ON COLUMN public.tb_cm_file.storage_path IS
  '버킷 erp-files 안의 경로. ★ URL 을 저장하지 않는다 — 서명 URL 은 만료된다. 볼 때마다 이 경로로 새로 만든다.';

-- ── ③ 운영사 전용 ──────────────────────────────────────────────────────────
ALTER TABLE public.tb_cm_file ENABLE ROW LEVEL SECURITY;

-- ★ FORCE 까지 건다. 테이블 소유자(postgres)도 정책을 거치게 한다 — 스크립트가
--   postgres 로 붙어 무심코 남의 행을 건드리는 것을 막는다.
ALTER TABLE public.tb_cm_file FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_files_operator_only ON public.tb_cm_file;
CREATE POLICY erp_files_operator_only ON public.tb_cm_file
  FOR ALL
  USING (public.erp_is_operator())
  WITH CHECK (public.erp_is_operator());

-- ── ④ 한 회사 · 한 종류 · 한 장 ────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS tb_cm_file_target_purpose_uk
  ON public.tb_cm_file (target_type, target_id, file_purpose);

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- node scripts/verify-020.js .env
--
-- 1) 48행이 사라졌는지        SELECT count(*) FROM public.tb_cm_file;              -- 0
-- 2) storage_url 이 없는지    \d public.tb_cm_file
-- 3) RLS 가 켜졌는지          SELECT relrowsecurity, relforcerowsecurity
--                               FROM pg_class WHERE oid='public.tb_cm_file'::regclass;
-- 4) 정책이 하나인지          SELECT policyname, qual FROM pg_policies
--                               WHERE tablename='tb_cm_file';
-- 5) 유일 인덱스가 실제로 막는지 — 같은 (COMPANY, id, CEO_ID) 두 번 INSERT 하면
--    두 번째가 23505 로 튕겨야 한다. verify-020.js 가 트랜잭션 안에서 해보고 롤백한다.
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — ★ 지운 48행은 이 스크립트로 돌아오지 않는다
-- -----------------------------------------------------------------------------
-- 구조만 되돌린다. 데이터는 백업에서 복원한다(위 ① 의 경로).
--
-- DROP INDEX IF EXISTS public.tb_cm_file_target_purpose_uk;
-- DROP POLICY IF EXISTS erp_files_operator_only ON public.tb_cm_file;
-- ALTER TABLE public.tb_cm_file NO FORCE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_cm_file DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tb_cm_file ADD COLUMN storage_url text;
-- -- ★ NOT NULL 로 되돌리려면 먼저 값을 채워야 한다. 채울 값이 없으면 그대로 둔다.
