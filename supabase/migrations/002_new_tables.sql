-- =============================================================================
-- 002_new_tables.sql
-- 신규 테이블 + 예약 배타 제약. 기존 앱(S-WonERP) 영향 없음 — 세션 테이블은
-- 신규 앱만 쓰고, 예약 EXCLUDE 제약은 기존 데이터가 이미 겹치지 않아야 통과한다.
--
-- ★ 지시 대비 정정 2건 (이유는 각 섹션 주석 참조):
--   1) tb_s030_session → tb_s080_auth_session — 접두어 통일(확정된 방향 위반 회피)
--   2) tb_s080_booking → tb_s080_reservations — 실제 테이블명(스키마에 booking 없음)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 사전 검증 — 예약 배타 제약을 걸기 전에 기존 데이터가 겹치지 않는지 확인
-- -----------------------------------------------------------------------------
-- 이 쿼리가 1행이라도 반환하면 EXCLUDE 추가 전에 데이터를 먼저 정리해야 한다.
-- 데이터가 시드 2행뿐이라 지금은 통과할 것으로 예상된다(SCHEMA_ANALYSIS.md §6.2).

DO $$
DECLARE
  overlap_count integer;
BEGIN
  SELECT count(*) INTO overlap_count
  FROM public.tb_s080_reservations a
  JOIN public.tb_s080_reservations b
    ON a.facility_id = b.facility_id
   AND a.reservation_id < b.reservation_id
   AND a.status = 'confirmed' AND b.status = 'confirmed'
   AND tsrange(a.start_at, a.end_at) && tsrange(b.start_at, b.end_at);

  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      '예약 데이터에 겹치는 confirmed 건 %건이 있다. EXCLUDE 제약을 걸기 전에 정리할 것.',
      overlap_count;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. tb_s080_auth_session — ERP 세션 (지시의 tb_s030_session에서 이름 정정)
-- -----------------------------------------------------------------------------
-- 정정 이유: 이번 지시의 "확정된 방향"이 "DB: tb_s080_* 확장"을 변경 불가로
-- 못박았다. tb_s030_* 접두어를 새로 쓰면 BACKEND_ANALYSIS.md §0이 경고한
-- "네 번째 계보"가 다시 생긴다. ERP 세션은 ERP 자체 자산이므로 위치가 같아야
-- 한다 — tb_s080_auth_session으로 만든다.
--
-- ★ 필드 정정 — bbiyong_access_encrypted 추가(지시 목록에는 없었다).
-- 이유: BBIYONG-AUTH.md §2.4 — 삐용 `/re-issue`는 access·refresh 토큰
-- **둘 다**를 요구하고, access·refresh·DB 세 곳의 memberId 일치를 검사한다.
-- refresh만 저장하면 갱신(SPEC 2 "토큰 갱신") 자체가 구현 불가능하다.
--
-- ★ erp_sid는 원문이 아니라 해시를 저장한다(삐용 token010.refresh_token_hash와
-- 같은 관례). 브라우저 쿠키에는 원문이 담기고, DB가 유출돼도 세션을 재구성할
-- 수 없다. 애플리케이션이 SHA-256(원문 sid)을 여기 저장한다.

CREATE TABLE public.tb_s080_auth_session (
  erp_sid                   text NOT NULL,             -- SHA-256(원문 세션ID) hex. 원문 저장 안 함
  bbiyong_member_id         integer NOT NULL,
  org_tp                    varchar(1) NOT NULL,        -- 삐용 orgTp: 'S'=운영사 / 그 외=입주사
  org_id                    integer NOT NULL,           -- 삐용 orgId
  bbiyong_access_encrypted  text NOT NULL,               -- AES-GCM 암호화. /re-issue 3자 일치 검사에 필요
  bbiyong_refresh_encrypted text NOT NULL,
  expires_at                timestamp(3) without time zone NOT NULL,   -- 삐용 refresh 만료와 동일(7일)
  created_at                timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_active_at            timestamp(3) without time zone,
  revoked_at                timestamp(3) without time zone,             -- 로그아웃·강제 만료. NULL=유효
  CONSTRAINT tb_s080_auth_session_pkey PRIMARY KEY (erp_sid)
);

COMMENT ON TABLE public.tb_s080_auth_session IS
  'ERP 세션 — 삐용 토큰은 여기에만 보관하고 브라우저에는 불투명 erp_sid만 내려간다.';
COMMENT ON COLUMN public.tb_s080_auth_session.erp_sid IS
  'SHA-256(브라우저 쿠키 원문 세션ID). 원문은 저장하지 않는다.';
COMMENT ON COLUMN public.tb_s080_auth_session.org_tp IS
  '삐용 로그인 응답의 orgTp. S=운영사(에스원비즈) / 그 외=입주사. 홈 분기(§3-4)의 1차 신호.';

CREATE INDEX idx_s080_auth_session_member ON public.tb_s080_auth_session USING btree (bbiyong_member_id);
CREATE INDEX idx_s080_auth_session_expires ON public.tb_s080_auth_session USING btree (expires_at);

-- -----------------------------------------------------------------------------
-- 2. tb_s080_reservations — 회의실 중복 예약 방지 EXCLUDE 제약
--    (지시의 "tb_s080_booking"에서 이름 정정 — 실제 테이블은 tb_s080_reservations.
--     스키마에 booking이라는 이름의 테이블은 존재하지 않는다.)
-- -----------------------------------------------------------------------------
-- SCHEMA_ANALYSIS.md C2 — 기존은 INDEX(facility_id, start_at, end_at)뿐이라
-- 인덱스일 뿐 제약이 아니다. 동시 요청에서 겹치는 예약이 통과할 수 있다.
-- 지금은 애플리케이션 레벨 SELECT...FOR UPDATE 잠금으로 막고 있다
-- (BACKEND_ANALYSIS.md §2-3 — 유효한 임시방편이며 이 제약을 넣은 뒤에도
-- 당장 제거할 필요는 없다).
--
-- ★ tsrange(start_at, end_at)를 쓴다 — 두 컬럼이 아직 timestamptz가 아니라
-- timestamp(3) without time zone이기 때문(C1 타임존 전환은 별도 후속 마이그레이션).
-- C1이 적용되면 이 제약을 DROP 후 tstzrange로 재생성해야 한다.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.tb_s080_reservations
  ADD CONSTRAINT tb_s080_reservations_no_overlap
  EXCLUDE USING gist (
    facility_id WITH =,
    tsrange(start_at, end_at) WITH &&
  )
  WHERE (status = 'confirmed');

COMMENT ON CONSTRAINT tb_s080_reservations_no_overlap ON public.tb_s080_reservations IS
  'BOOK-05/06 — 같은 시설의 confirmed 예약은 시간이 겹칠 수 없다. '
  '취소(status<>confirmed)는 검사 대상에서 제외. '
  '★ C1(timestamptz 전환) 적용 시 tsrange→tstzrange로 재생성 필요.';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- \d tb_s080_auth_session
-- \d tb_s080_reservations                         -- EXCLUDE 제약 확인
-- SELECT conname FROM pg_constraint
--   WHERE conrelid = 'tb_s080_reservations'::regclass AND contype = 'x';
--
-- 동시성 확인(선택): 같은 facility_id·겹치는 시간으로 두 트랜잭션을 동시에
-- INSERT 시도 — 하나는 성공, 하나는 23P01(exclusion_violation)로 실패해야 한다.

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- BEGIN;
-- ALTER TABLE public.tb_s080_reservations
--   DROP CONSTRAINT IF EXISTS tb_s080_reservations_no_overlap;
-- DROP TABLE IF EXISTS public.tb_s080_auth_session;
-- COMMIT;
