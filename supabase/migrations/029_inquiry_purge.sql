-- =============================================================================
-- 029_inquiry_purge.sql
--
-- 문의 관리(s030200080)의 **글 전체 삭제**가 표를 어떻게 남기는지 적는다.
-- 표도 컬럼도 늘지 않는다 — 028 의 컬럼을 그대로 쓰고, **뜻이 하나 늘었다.**
--
-- 명세: design/handoff/inquiry-board/04-data-model.md §5 · 03-thread.md §5
-- 구현: packages/api/src/db/inquiries.ts `purgeInquiry`
--
-- =============================================================================
-- ★★★ 지운 글의 행은 남는다 — 하지만 **개인정보는 남지 않는다** (2026-09-28 결정)
-- =============================================================================
-- 지운다 — name · phone · email · company_name · body · password_hash ·
--          **스레드 행 전체**(tb_s080_inquiry_messages) · 열람 토큰
-- 남긴다 — inquiry_id · type · created_at · deleted_at · agreed_at ·
--          **phone_digits 자리의 연락처 해시**
--
-- ★★ 왜 행을 지우지 않는가: 하루 3건 스팸 판정이 **지운 글도 세야** 한다
--    (04-data-model §4 마지막 줄). 행을 지우면 「지우고 다시 쓰기」로 한도를 넘길 수 있다.
--
-- ★★ 왜 숫자가 아니라 해시인가: 집계에 필요한 것은 「같은 사람인가」뿐이고, 번호 자체는
--    필요하지 않다. 그래서 `h:<HMAC-SHA256(ERP_ENCRYPTION_KEY, 숫자)>` 를 넣는다.
--    sha256(번호)로는 부족하다 — 휴대전화 후보가 1억 개뿐이라 전수 대입으로 되돌려진다.
--    키를 섞으면 키 없이는 후보를 만들 수 없다(`packages/api/src/lib/crypto.ts`).
--
-- ★ body 에 '(삭제됨)' 이 들어가는 것은 028 의 CHECK(1~1000자) 때문이다. 빈 문자열을
--   넣을 수 없어서 쓰는 자리표시이고, 지운 글은 목록·글 보기 어디에도 나오지 않는다.
-- ★ password_hash 는 'scrypt$deleted' 로 덮는다 — 형식이 깨진 값이라 verifyPassword 가
--   무엇을 넣어도 false 다. 고객이 쓰던 비밀번호를 남기지 않는다.
-- ★ **자동 삭제는 없다.** 6개월이 지나면 운영자 화면에 「보관 기간 지남」만 뜨고,
--   지우는 것은 사람이 한다(상담 중인 글이 배치에 사라지면 되돌릴 수 없다).
-- =============================================================================

BEGIN;

COMMENT ON COLUMN public.tb_s080_inquiries.phone_digits IS
  '연락처 숫자만. 하루 3건·1분 간격 판정이 표기 차이에 속지 않게 한다. '
  '★ 운영자가 지운 글에는 숫자 대신 연락처 해시(''h:''+HMAC-SHA256)가 들어 있다 — '
  '집계는 그대로 돌고 번호는 남지 않는다(029). 집계 SQL 은 둘을 함께 찾는다(= ANY).';

COMMENT ON COLUMN public.tb_s080_inquiries.deleted_at IS
  '운영자가 글 전체를 지운 시각(s030200080). **자동 삭제는 없다**(04-data-model §5). '
  '★ 이 값이 있는 행은 개인정보가 이미 지워진 껍데기다 — 남은 것은 type·created_at·'
  '연락처 해시뿐이고, 스레드 행은 함께 삭제됐다. 목록·글 보기·비밀번호 확인 모두 제외한다.';

COMMENT ON COLUMN public.tb_s080_inquiries.name IS
  '문의한 사람 이름. ★ 공개 목록에는 가린 이름(김**)만 나간다. '
  '운영자 화면(s030200080)에는 실명이 나간다 — 답해야 할 사람이다. '
  '★ 지운 글에는 ''(삭제)'' 가 들어 있다(029).';

COMMENT ON COLUMN public.tb_s080_inquiry_messages.edited_at IS
  '운영자가 글답변(text)을 고친 시각. 고객 화면에 「YYYY.MM.DD 수정됨」으로 날짜만 보인다. '
  '★ created_at 과 스레드 순서는 고쳐도 그대로다(03-thread §3) — 맨 아래로 옮기지 않는다. '
  '★ 같은 날 고쳐도 남긴다 — 고객이 이미 읽은 내용이 바뀌었을 수 있다.';

COMMIT;

-- =============================================================================
-- 검증 — 지운 글이 어떻게 남았는가
-- =============================================================================
-- SELECT inquiry_id, type, name, phone, email, company_name, body,
--        left(phone_digits, 2) AS digits_head, deleted_at
--   FROM public.tb_s080_inquiries WHERE deleted_at IS NOT NULL;
-- → name '(삭제)' · phone '' · body '(삭제됨)' · digits_head 'h:'
--
-- SELECT count(*) FROM public.tb_s080_inquiry_messages m
--   JOIN public.tb_s080_inquiries i USING (inquiry_id)
--  WHERE i.deleted_at IS NOT NULL;          -- → 0 (스레드는 함께 지운다)
--
-- =============================================================================
-- 되돌리기 — 주석뿐이므로 028 의 문구로 되돌리면 된다(데이터는 건드리지 않는다)
-- =============================================================================
