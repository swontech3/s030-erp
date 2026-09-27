-- =============================================================================
-- 028_inquiry.sql
--
-- 문의상담 게시판 (s0300500070 · p1 · p2) — **로그인 없는 공개 게시판**.
--   ① tb_s080_inquiries                원글
--   ② tb_s080_inquiry_messages         스레드 (운영자 답변 · 전화 기록 · 고객 추가 질문)
--   ③ tb_s080_inquiry_tokens           열람 토큰 (비밀번호를 맞춘 사람)
--   ④ tb_s080_inquiry_unlock_attempts  비밀번호 시도 기록 (10분 5회 제한)
--   ⑤ 코드 마스터 QU_ST(문의상태) · QU_TP(문의유형)
--
-- 명세: design/handoff/inquiry-board/04-data-model.md
--
-- =============================================================================
-- ★★★ RLS 를 걸지 않는다 — **회사 스코프가 없는 표다**
-- =============================================================================
-- 003 의 `erp_company_scope` 는 「이 행이 어느 입주사 것인가」로 판정한다. 문의는
-- 입주 **전** 사람이 로그인 없이 남기는 글이라 회사가 없다. 정책을 걸면 GUC 가 없는
-- 공개 요청이 전부 0건을 보고(fail-closed), 정책을 통과시키려고 운영자 스코프로 열면
-- 오히려 공개 라우트에 운영자 권한을 쥐여 주게 된다.
--
-- 그래서 이 표의 보호는 **RLS 가 아니라 세 가지**다:
--   · 목록 응답에 이름·연락처·이메일·본문을 **담지 않는다**(라우트가 고르는 컬럼)
--   · 원글 전체는 **비밀번호를 맞춘 사람에게만**(③ 토큰)
--   · 비밀번호는 **해시만** 저장하고 시도를 센다(④)
-- 같은 이유로 `tb_s080_facilities` 에도 RLS 가 없다 — 회사로 가를 것이 없는 표다.
--
-- =============================================================================
-- ★★ 왜 표를 넷이나 만드는가
-- =============================================================================
-- ③④ 를 메모리에 두면 API 가 재시작될 때마다 읽던 사람이 비밀번호를 다시 치고,
-- **시도 제한이 함께 초기화된다** — 재시작이 공격자에게 유리해진다. 둘 다 DB 다
-- (2026-09-27 결정). 만료된 행은 다음 요청이 지운다(청소 배치를 따로 두지 않는다).
--
-- ★ 비밀번호는 `scrypt` 로 해시한다(같은 결정). 알고리즘·파라미터를 문자열 앞에
--   적어 두므로 나중에 argon2 로 갈아도 **옛 해시를 그대로 검증**할 수 있다.
-- =============================================================================

BEGIN;

-- ── ① 원글 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_s080_inquiries (
  inquiry_id    text PRIMARY KEY,
  build_id      text NOT NULL,
  -- 코드 마스터 QU_TP 의 code. 표시 이름은 코드에서 가져온다 — 화면에 문자열을 박지 않는다
  type          text NOT NULL,
  name          text NOT NULL,
  -- ★ 목록 응답에 절대 넣지 않는다(04-data-model §4). 가린 이름은 서버가 만든다
  phone         text NOT NULL,
  -- 숫자만. 스팸 판정이 `010-1234-5678` 과 `01012345678` 을 같게 봐야 한다(§4)
  phone_digits  text NOT NULL,
  email         text NOT NULL,
  company_name  text,
  body          text NOT NULL,
  -- 「알고리즘$파라미터$salt$hash」. 평문·가역 암호화 금지(§4)
  password_hash text NOT NULL,
  agreed_at     timestamp NOT NULL,
  created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 운영자가 보관 기간 처리로 지운 시각. **자동 삭제는 없다**(§5)
  deleted_at    timestamp,
  CONSTRAINT tb_s080_inquiries_body_len CHECK (char_length(body) BETWEEN 1 AND 1000)
);

-- 목록은 등록일 내림차순 한 가지다(02-screens §2 「정렬」)
CREATE INDEX IF NOT EXISTS ix_inquiries_created ON public.tb_s080_inquiries (created_at DESC);
-- 스팸 판정 — 같은 연락처의 오늘 몇 건 · 직전 등록이 언제
CREATE INDEX IF NOT EXISTS ix_inquiries_phone_created ON public.tb_s080_inquiries (phone_digits, created_at DESC);

COMMENT ON TABLE public.tb_s080_inquiries IS
  '문의상담 원글(s0300500070). 공개 게시판이라 RLS 가 없다 — 보호는 응답 모양과 비밀번호다.';
COMMENT ON COLUMN public.tb_s080_inquiries.phone_digits IS
  '연락처 숫자만. 하루 3건·1분 간격 판정이 표기 차이에 속지 않게 한다.';

-- ── ② 스레드 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_s080_inquiry_messages (
  message_id    text PRIMARY KEY,
  inquiry_id    text NOT NULL REFERENCES public.tb_s080_inquiries(inquiry_id) ON DELETE CASCADE,
  -- text 운영자 글답변 · phone 전화 답변 기록(본문 없음) · customer 고객 추가 질문
  kind          text NOT NULL,
  body          text,
  operator_id   text,
  -- 표시용 스냅샷 — 담당자 이름이 바뀌어도 당시 이름을 유지한다(04-data-model §2)
  operator_name text,
  created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- text 만. 고치면 「2026.10.02 수정됨」으로 보인다(03-thread §3)
  edited_at     timestamp,
  CONSTRAINT tb_s080_inquiry_messages_kind CHECK (kind IN ('text', 'phone', 'customer')),
  -- ★ phone 은 본문이 없고 나머지는 있어야 한다. 「본문 없는 답변」이 조용히 들어오지 않게
  CONSTRAINT tb_s080_inquiry_messages_body CHECK (
    (kind = 'phone' AND body IS NULL) OR
    (kind <> 'phone' AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 1000)
  ),
  -- 삭제 컬럼을 두지 않는다 — 메시지 단위 삭제 기능이 없다(03-thread §5)
  CONSTRAINT tb_s080_inquiry_messages_edited CHECK (edited_at IS NULL OR kind = 'text')
);

CREATE INDEX IF NOT EXISTS ix_inquiry_messages_thread
  ON public.tb_s080_inquiry_messages (inquiry_id, created_at);

COMMENT ON TABLE public.tb_s080_inquiry_messages IS
  '문의 스레드. 상태(접수·답변완료)는 저장하지 않고 **마지막 글로 판정**한다(03-thread §2).';

-- ── ③ 열람 토큰 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_s080_inquiry_tokens (
  -- ★ 원문이 아니라 SHA-256 해시다. 세션(erp_sid)과 같은 규칙 — DB 가 새도 토큰은 못 쓴다
  token_hash text PRIMARY KEY,
  inquiry_id text NOT NULL REFERENCES public.tb_s080_inquiries(inquiry_id) ON DELETE CASCADE,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_inquiry_tokens_expires ON public.tb_s080_inquiry_tokens (expires_at);

COMMENT ON TABLE public.tb_s080_inquiry_tokens IS
  '비밀번호를 맞춘 사람에게 준 열람 토큰(30분). ★ 글 하나에만 유효하다 — 다른 글에 쓰면 401.';

-- ── ④ 비밀번호 시도 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_s080_inquiry_unlock_attempts (
  attempt_id text PRIMARY KEY,
  inquiry_id text NOT NULL REFERENCES public.tb_s080_inquiries(inquiry_id) ON DELETE CASCADE,
  -- 프록시(Next)가 넘겨 준 클라이언트 IP. 못 받으면 'unknown' — 그때는 글 단위 제한이 된다
  client_ip  text NOT NULL,
  tried_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_inquiry_attempts_window
  ON public.tb_s080_inquiry_unlock_attempts (inquiry_id, client_ip, tried_at DESC);

COMMENT ON TABLE public.tb_s080_inquiry_unlock_attempts IS
  '비밀번호 실패 기록. 10분 5회를 넘으면 잠근다(04-data-model §4) — 4자 비밀번호의 전제다.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_inquiries              TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_inquiry_messages       TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_inquiry_tokens         TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tb_s080_inquiry_unlock_attempts TO erp_app;

-- =============================================================================
-- ⑤ 코드 마스터 — 화면에 문자열을 박지 않는다
-- =============================================================================
-- ★ 이미 있는 `ASK_TP`(문의종류: 문의하기·방문상담)·`ASK_METHOD`(유선·이메일·게시판)는
--   레거시 상담관리의 것이고 **뜻이 다르다.** 재사용하지 않고 새로 만든다.
-- ★ `use_tp` 는 상속이 아니라 독립 파티션이다(`doc/CODE_MASTER_ANALYSIS.md` §B-1).
--   둘 다 공통 `000` 이다.
INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_QU_ST', '1', 'QU_ST', '문의상태',
        '문의상담 게시판(s0300500070)의 상태. ★ 저장 컬럼이 아니다 — 스레드의 마지막 글로 '
        '판정한 결과를 이 코드로 표시한다(03-thread.md §2)',
        false, CURRENT_TIMESTAMP),
       ('cm_1_QU_TP', '1', 'QU_TP', '문의유형',
        '문의상담 게시판의 유형. ★ 목록의 제목이 이 이름이다 — 제목 칸이 따로 없다',
        false, CURRENT_TIMESTAMP)
ON CONFLICT (code_id) DO NOTHING;

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_QU_ST_000', '1', 'QU_ST', '000', '공통', '단일 파티션. 문의상담이 쓴다', false),
       ('cc_1_QU_TP_000', '1', 'QU_TP', '000', '공통', '단일 파티션. 문의상담이 쓴다', false)
ON CONFLICT (code_category_id) DO NOTHING;

INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, use_tp, sort_order, is_active, is_system, updated_at)
VALUES ('cl_1_QU_ST_R', '1', 'QU_ST', 'R', '접수',     '000', 1, true, false, CURRENT_TIMESTAMP),
       ('cl_1_QU_ST_A', '1', 'QU_ST', 'A', '답변완료', '000', 2, true, false, CURRENT_TIMESTAMP),
       -- 순서가 화면의 버튼 순서다(02-screens §3 문의 유형 5개)
       ('cl_1_QU_TP_O', '1', 'QU_TP', 'O', '입주문의',       '000', 1, true, false, CURRENT_TIMESTAMP),
       ('cl_1_QU_TP_L', '1', 'QU_TP', 'L', '법무설립문의',   '000', 2, true, false, CURRENT_TIMESTAMP),
       ('cl_1_QU_TP_T', '1', 'QU_TP', 'T', '세무문의',       '000', 3, true, false, CURRENT_TIMESTAMP),
       ('cl_1_QU_TP_R', '1', 'QU_TP', 'R', '연구소설립문의', '000', 4, true, false, CURRENT_TIMESTAMP),
       ('cl_1_QU_TP_E', '1', 'QU_TP', 'E', '기타',           '000', 5, true, false, CURRENT_TIMESTAMP)
ON CONFLICT (line_id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- SELECT category, code, name FROM public.tb_s080_codes_line
--  WHERE category IN ('QU_ST','QU_TP') ORDER BY category, sort_order;
--
-- =============================================================================
-- 되돌리기 — 문의 글이 전부 사라진다. 지우기 전에 행이 있는지 먼저 본다
-- =============================================================================
-- DROP TABLE IF EXISTS public.tb_s080_inquiry_unlock_attempts;
-- DROP TABLE IF EXISTS public.tb_s080_inquiry_tokens;
-- DROP TABLE IF EXISTS public.tb_s080_inquiry_messages;
-- DROP TABLE IF EXISTS public.tb_s080_inquiries;
-- DELETE FROM public.tb_s080_codes_line      WHERE category IN ('QU_ST','QU_TP');
-- DELETE FROM public.tb_s080_code_categories WHERE category IN ('QU_ST','QU_TP');
-- DELETE FROM public.tb_s080_code_masters    WHERE category IN ('QU_ST','QU_TP');
