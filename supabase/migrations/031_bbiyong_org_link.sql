-- =============================================================================
-- 031_bbiyong_org_link.sql
--
-- 삐용 회사 등록(3-2)의 **상태와 단체코드**를 담을 자리.
--
-- 001 이 만든 연결 3칸(`link_s020_org_id` · `link_linked_at` · `link_linked_by`)은
-- 「연결됐다」만 표현할 수 있다. 3-2 는 그것으로 모자란다 — **연결이 아직 안 된 이유**를
-- 남겨야 하기 때문이다.
--
-- -----------------------------------------------------------------------------
-- ★★ 왜 「실패」를 남기는가 — 계약 확정을 되돌리지 않기 때문이다
-- -----------------------------------------------------------------------------
-- 계약 확정은 계약·청구서·예치금을 한 트랜잭션으로 만든다. 삐용 회사 생성은 그
-- 트랜잭션 **밖에서**, 커밋한 뒤에 한다(대표 결정 2026-09-30):
--
--   · 삐용 장애로 계약 확정이 막히면 운영 업무가 멈춘다
--   · 삐용이 회사를 만든 뒤 ERP 커밋이 실패하면 **삐용에 고아 회사**가 남는다.
--     삭제 규격이 확인되지 않아 되돌릴 방법이 없다
--   · HTTP 왕복 동안 계약·청구 행의 락을 잡고 있게 된다
--
-- 그 대가로 **「계약은 확정됐는데 삐용 연결은 아직」인 상태가 존재한다.** 그 상태를
-- 적어 두지 않으면 아무도 모르고 지나간다 — 그 회사 대표는 영원히 로그인할 수 없고,
-- 그 사실은 대표가 전화할 때나 드러난다. 그래서 컬럼으로 남기고 화면에 띄운다.
--
-- -----------------------------------------------------------------------------
-- ★ 단체코드 컬럼이 없어서 3-4 가 표시를 못 했다
-- -----------------------------------------------------------------------------
-- `link_s020_org_id` 는 삐용 조직 **ID**(정수)이지 코드가 아니다. 사람이 읽는 값은
-- `Z01` 쪽이고, 그 칸이 없어서 3-4 는 「값도 화면도 없는 것을 지어내지 않았다」며
-- 표시를 3-2 로 넘겼다(ROADMAP). 그 칸을 여기서 만든다.
--
-- ★ 컬럼 4개만 더한다. 전부 nullable — 기존 행(레거시 입주사)은 그대로 NULL 이고
--   그 상태가 「연동 대상이 아니다」라는 뜻이다.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_companies
  ADD COLUMN IF NOT EXISTS link_org_code      varchar(3),
  ADD COLUMN IF NOT EXISTS link_status        varchar(10),
  ADD COLUMN IF NOT EXISTS link_failed_reason text,
  ADD COLUMN IF NOT EXISTS link_failed_at     timestamp(3) without time zone;

COMMENT ON COLUMN public.tb_s080_companies.link_org_code IS
  '삐용 단체코드 — ERP 가 발급한 Z01~Z99. ★ 삐용이 이 Z 접두사로 「ERP 가 만든 회사」를 '
  '알아본다(회신 5). 삐용 부서코드가 이 코드를 접두사로 물려받으므로 함부로 바꿀 수 없다.';

COMMENT ON COLUMN public.tb_s080_companies.link_status IS
  '삐용 연동 상태 — NULL:대상 아님(계약 확정 전) / pending:확정됐으나 연결 실패, 재시도 필요 '
  '/ linked:연결됨. ★ 판정의 진실원은 link_s020_org_id 다 — 이 컬럼은 「왜 아직 아닌가」를 '
  '말하기 위한 것이다. 둘이 어긋나면 link_s020_org_id 를 믿는다.';

COMMENT ON COLUMN public.tb_s080_companies.link_failed_reason IS
  '마지막 실패 사유 — **운영자에게 그대로 보여주는 문구**다. 삐용 내부 메시지를 그대로 '
  '넣지 않는다(AUTHZ_DENY 는 「삐용 권한관리에서 ERP 담당 역할을 받으세요」로 번역한다).';

COMMENT ON COLUMN public.tb_s080_companies.link_failed_at IS
  '마지막 실패 시각 — 「언제부터 대기 상태인가」를 본다. updated_at 은 입주사 정보를 '
  '고칠 때마다 바뀌므로 그것으로는 알 수 없다.';

-- -----------------------------------------------------------------------------
-- 단체코드는 유일해야 한다
-- -----------------------------------------------------------------------------
-- ★ 같은 코드를 두 입주사가 들면 채번이 그 코드를 다시 발급하고, 삐용에서 중복으로
--   거부되는 것이 **매번** 반복된다. NULL 은 다수 허용(아직 발급 안 됨).
--   `link_s020_org_id` 의 UNIQUE(001)와 같은 이유·같은 모양이다.
ALTER TABLE public.tb_s080_companies
  DROP CONSTRAINT IF EXISTS ux_s080_companies_link_org_code;
ALTER TABLE public.tb_s080_companies
  ADD CONSTRAINT ux_s080_companies_link_org_code UNIQUE (link_org_code);

-- -----------------------------------------------------------------------------
-- 어휘를 DB 에서도 못 박는다 (느슨한 CHECK — NULL 허용)
-- -----------------------------------------------------------------------------
-- ★ 애플리케이션이 이미 검사하지만, 컬럼 뜻을 읽는 사람이 값의 범위를 여기서 본다.
ALTER TABLE public.tb_s080_companies
  DROP CONSTRAINT IF EXISTS ck_s080_companies_link_status;
ALTER TABLE public.tb_s080_companies
  ADD CONSTRAINT ck_s080_companies_link_status
  CHECK (link_status IS NULL OR link_status IN ('pending', 'linked'));

-- ★ Z + 숫자 2자리. 삐용 규격은 「영문/숫자 3자리」지만 ERP 가 발급하는 것은 Z 대역뿐이다
--   — 이 제약이 「사람이 손으로 아무 코드나 넣는 것」을 막는다.
ALTER TABLE public.tb_s080_companies
  DROP CONSTRAINT IF EXISTS ck_s080_companies_link_org_code;
ALTER TABLE public.tb_s080_companies
  ADD CONSTRAINT ck_s080_companies_link_org_code
  CHECK (link_org_code IS NULL OR link_org_code ~ '^Z[0-9]{2}$');

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- 1) 컬럼 4개
--    SELECT column_name, data_type, coalesce(character_maximum_length,0) len
--      FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_companies'
--       AND column_name LIKE 'link_%' ORDER BY column_name;
--    -- link_failed_at · link_failed_reason · link_linked_at · link_linked_by
--    -- · link_org_code(varchar 3) · link_s020_org_id · link_status(varchar 10)
--
-- 2) 제약 3개
--    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid='public.tb_s080_companies'::regclass
--       AND conname IN ('ux_s080_companies_link_org_code',
--                       'ck_s080_companies_link_status',
--                       'ck_s080_companies_link_org_code');
--
-- 3) 기존 행은 전부 NULL (연동 대상 아님)
--    SELECT count(*) FROM public.tb_s080_companies WHERE link_status IS NOT NULL;  -- 0
--
-- 4) erp_app 이 새 컬럼을 읽고 쓸 수 있는지 — 컬럼 단위 GRANT 가 아니라 테이블
--    단위이므로 자동으로 따라온다. 확인만 한다:
--    SELECT has_table_privilege('erp_app','public.tb_s080_companies','UPDATE');  -- t
--
-- -----------------------------------------------------------------------------
-- 되돌리기 (적용 후에는 쓰지 말 것 — 발급된 단체코드가 사라진다)
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.tb_s080_companies
--   DROP CONSTRAINT IF EXISTS ux_s080_companies_link_org_code,
--   DROP CONSTRAINT IF EXISTS ck_s080_companies_link_status,
--   DROP CONSTRAINT IF EXISTS ck_s080_companies_link_org_code,
--   DROP COLUMN IF EXISTS link_org_code,
--   DROP COLUMN IF EXISTS link_status,
--   DROP COLUMN IF EXISTS link_failed_reason,
--   DROP COLUMN IF EXISTS link_failed_at;
