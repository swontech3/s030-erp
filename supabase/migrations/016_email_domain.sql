-- =============================================================================
-- 016_email_domain.sql
--
-- 이메일 도메인을 **코드 테이블로 옮긴다.** 지금까지는 화면 상수였다.
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 — 시안에만 있던 하드코딩이었다
-- -----------------------------------------------------------------------------
-- 조사 당시 코드 마스터에도 라인에도 이메일 도메인이 **하나도 없었다**
-- (`doc/LEGACY_DATA_SURVEY.md` §C-3 ④ — `@`·`naver`·`gmail` 류로 찾아 0행).
-- 그래서 계약 폼은 `form-model.ts` 의 `EMAIL_DOMAINS` 배열을 썼다.
--
-- 배열이면 도메인 하나 늘리는 데 **배포가 필요하다.** 입주사가 쓰는 도메인은
-- 운영자가 늘리고 줄이는 값이지 개발자가 정할 값이 아니다. 013 으로 카테고리 구조가
-- 정리돼 이제 마이그레이션 한 본이면 옮길 수 있다.
--
-- -----------------------------------------------------------------------------
-- ★ code 와 name 을 **둘 다 도메인 문자열**로 둔다
-- -----------------------------------------------------------------------------
-- 다른 카테고리는 `R1` → 「1인실」처럼 식별자와 표시명이 다르다. 도메인은 아니다 —
-- 화면이 필요한 값이 곧 표시되는 글자다(`joinEmail(mailId, domain)` 이 그대로 붙인다).
-- 짧은 식별자를 따로 두면 코드→도메인 매핑이 한 겹 더 생기고, 그 매핑이 어긋나면
-- **메일 주소가 틀리게 저장된다.** 값이 하나뿐인 것을 둘로 나누지 않는다.
--
-- ★ `is_system = false` 다. 운영자가 추가·삭제할 값이다. 다른 시드 코드(계약구분 등)와
--   다른 점이고, 코드관리 화면이 생기면 여기가 편집 대상이 된다.
--
-- ★ 「선택하세요」와 「직접입력」은 **넣지 않는다.** 그 둘은 코드가 아니라 Select 의
--   조작 장치다(placeholder 와 옵트인). 화면이 앞뒤에 붙인다.
-- =============================================================================

BEGIN;

INSERT INTO public.tb_s080_code_masters
  (code_id, build_id, category, name, description, is_system, updated_at)
VALUES ('cm_1_EMAIL_DOMAIN', '1', 'EMAIL_DOMAIN', '이메일 도메인',
        '계약 폼 섹션 1 대표자 이메일 · 섹션 3 입주자 사용자의 도메인 Select. '
        'code 와 name 이 둘 다 도메인 문자열이다',
        false, CURRENT_TIMESTAMP);

INSERT INTO public.tb_s080_code_categories
  (code_category_id, build_id, category, use_tp, name, description, is_system)
VALUES ('cc_1_EMAIL_DOMAIN_000', '1', 'EMAIL_DOMAIN', '000', '공통',
        '계약 폼 섹션 1·3 이 함께 쓴다', false);

-- 시안 2차 목록 그대로다. ★ 예시 입주사 도메인(`bridgelab.co.kr`)은 넣지 않는다 —
-- 1차 시안에 있었으나 기본 선택으로 남으면 그대로 저장돼 오등록이 난다.
INSERT INTO public.tb_s080_codes_line
  (line_id, build_id, category, code, name, use_tp, sort_order, is_active, is_system, updated_at)
VALUES ('cl_1_EMAIL_DOMAIN_naver',   '1', 'EMAIL_DOMAIN', 'naver.com',   'naver.com',   '000', 1, true, false, CURRENT_TIMESTAMP),
       ('cl_1_EMAIL_DOMAIN_gmail',   '1', 'EMAIL_DOMAIN', 'gmail.com',   'gmail.com',   '000', 2, true, false, CURRENT_TIMESTAMP),
       ('cl_1_EMAIL_DOMAIN_daum',    '1', 'EMAIL_DOMAIN', 'daum.net',    'daum.net',    '000', 3, true, false, CURRENT_TIMESTAMP),
       ('cl_1_EMAIL_DOMAIN_hanmail', '1', 'EMAIL_DOMAIN', 'hanmail.net', 'hanmail.net', '000', 4, true, false, CURRENT_TIMESTAMP),
       ('cl_1_EMAIL_DOMAIN_nate',    '1', 'EMAIL_DOMAIN', 'nate.com',    'nate.com',    '000', 5, true, false, CURRENT_TIMESTAMP);

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- node scripts/verify-016.js .env
--
-- 1) 5행이 순서대로 들어갔는지
--    SELECT code, name, sort_order FROM public.tb_s080_codes_line
--     WHERE category='EMAIL_DOMAIN' ORDER BY sort_order;
-- 2) code 와 name 이 같은지 (다르면 메일 주소가 틀리게 저장된다)
--    SELECT count(*) FROM public.tb_s080_codes_line
--     WHERE category='EMAIL_DOMAIN' AND code <> name;      -- 0 이어야 한다
--
-- -----------------------------------------------------------------------------
-- 되돌리기 — ★ 화면 상수도 함께 되돌려야 한다
-- -----------------------------------------------------------------------------
-- 이 마이그레이션만 되돌리면 도메인 Select 가 **빈 목록**이 된다. form-model.ts 의
-- EMAIL_DOMAINS 상수를 같이 살려야 한다(커밋 참조).
--
-- DELETE FROM public.tb_s080_codes_line      WHERE category='EMAIL_DOMAIN';
-- DELETE FROM public.tb_s080_code_categories WHERE category='EMAIL_DOMAIN';
-- DELETE FROM public.tb_s080_code_masters    WHERE category='EMAIL_DOMAIN';
