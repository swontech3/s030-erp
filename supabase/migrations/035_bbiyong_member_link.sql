-- =============================================================================
-- 035_bbiyong_member_link.sql
--
-- 삐용 **직원정보 연동**(`POST /rest/v1/s021100010/erp-member`, 규격 2026-10-05)의
-- 자리를 만든다. 담는 것은 셋이다 — 삐용 회원번호 · 실패 사유 · 대표자 정본.
--
-- -----------------------------------------------------------------------------
-- ① 왜 `user_id` 를 재활용하지 않는가
-- -----------------------------------------------------------------------------
-- `tb_s080_members.user_id` 는 **레거시 칸**이고 타입이 `text` 다(삐용 회원번호는
-- 정수다). 지금 전 행이 NULL 이지만 레거시 앱이 그 칸을 무엇으로 쓰려 했는지가
-- 주석에 「연결 사용자 ID」로만 남아 있다. 거기에 삐용 번호를 넣으면 **같은 칸이 두
-- 가지를 뜻하게 되고**, 둘 중 하나가 틀렸을 때 어느 쪽인지 알 방법이 없다.
-- 그래서 칸을 따로 만든다 — `link_` 접두사는 「삐용 쪽 식별자」라는 뜻이고
-- `tb_s080_companies.link_s020_org_id` 와 같은 어휘다.
--
-- ★ UNIQUE 다. 한 삐용 회원이 ERP 구성원 두 행에 붙으면 그 회원의 수정·삭제가
--   **어느 행 기준인지 갈린다.** `link_s020_org_id` 의 UNIQUE(001)와 같은 이유다.
-- ★ **FK 는 없다.** 삐용 회원표는 다른 DB 에 있다(연동 상대다).
--
-- -----------------------------------------------------------------------------
-- ② 왜 실패 사유를 적는가 — 저장을 되돌리지 않기 때문이다
-- -----------------------------------------------------------------------------
-- 구성원 저장도 회사 등록과 같은 규칙이다(결정 2026-10-05): ERP 저장은 커밋하고,
-- 삐용 호출은 **그 뒤에** 한다. 삐용이 죽어도 구성원 명부는 고칠 수 있어야 한다.
--
-- 그 대가로 「ERP 엔 있는데 삐용엔 없는 직원」이 존재한다. 적어 두지 않으면 아무도
-- 모르고 지나가고, 그 직원은 영원히 삐용에 로그인할 수 없다.
--
-- ★ 재시도 버튼은 **만들지 않는다**(한 업무는 한 화면에서). 회원번호가 없는 행은
--   다음 저장에서 자동으로 다시 `I` 로 나간다 — 계약 폼의 [저장]이 곧 재시도다.
--
-- -----------------------------------------------------------------------------
-- ③ 대표자 정본은 구성원 표다
-- -----------------------------------------------------------------------------
-- 삐용에서 **대표는 회사 등록으로만 생기고 지울 수 없다.** 고치는 길은 `U` 하나뿐이고
-- `U` 는 회원번호가 필수다. 그래서 「그 회사의 대표가 누구인가」가 한 행으로 정해져야
-- 한다 — 활성 대표가 둘이면 어느 번호로 보낼지 갈린다.
--
-- ★ 걸기 전에 지금 걸리는 행을 세어 봤다(2026-10-05): 활성 대표가 둘 이상인 회사는
--   **없다.** 에스원3DP 가 대표 행 3개(활성 1 · 비활성 2)로 가장 많고, 부분 색인이
--   활성만 보므로 통과한다. 비활성 대표 행은 예약 이력 때문에 남겨 둔 것이다
--   (`replaceMembers` 는 지우지 않고 `inactive` 로 둔다).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 삐용 회원번호 · 실패 사유
-- -----------------------------------------------------------------------------
ALTER TABLE public.tb_s080_members
  ADD COLUMN IF NOT EXISTS link_s020_member_id integer,
  ADD COLUMN IF NOT EXISTS link_failed_reason  text,
  ADD COLUMN IF NOT EXISTS link_failed_at      timestamp(3) without time zone;

COMMENT ON COLUMN public.tb_s080_members.link_s020_member_id IS
  '삐용 회원번호 — erp-member 응답의 data.memberId, 또는 회사 등록 응답의 data.memberId'
  '(대표). ★ 이 값이 있으면 수정은 U, 없으면 신규 I 다 — 「ERP 에서 새 행인가」가 아니라 '
  '「삐용에 번호가 있는가」로 가른다. 그래서 회사 등록 전에 저장된 직원도 다음 저장에서 '
  '따라붙는다. ★ user_id 를 재활용하지 않았다(레거시 칸 · 타입이 text 다). ★ FK 없음 — '
  '삐용 회원표는 다른 DB 다.';

COMMENT ON COLUMN public.tb_s080_members.link_failed_reason IS
  '마지막 삐용 연동 실패 사유 — **운영자에게 그대로 보여주는 문구**다. 삐용 내부 메시지를 '
  '그대로 넣지 않는다. 성공하면 비워진다. ★ 재시도 버튼은 없다 — 다음 저장이 재시도다.';

COMMENT ON COLUMN public.tb_s080_members.link_failed_at IS
  '마지막 실패 시각. updated_at 은 구성원을 고칠 때마다 바뀌어 「언제부터 대기인가」를 '
  '말하지 못한다(031 의 link_failed_at 과 같은 이유).';

-- ★ 한 삐용 회원이 ERP 두 행에 붙지 않게. NULL 은 다수 허용(아직 안 보낸 행).
ALTER TABLE public.tb_s080_members
  DROP CONSTRAINT IF EXISTS ux_s080_members_link_member_id;
ALTER TABLE public.tb_s080_members
  ADD CONSTRAINT ux_s080_members_link_member_id UNIQUE (link_s020_member_id);

-- -----------------------------------------------------------------------------
-- 대표자 정본 — 한 회사에 활성 대표는 하나
-- -----------------------------------------------------------------------------
-- ★ `is_representative` 는 **「여부」가 아니라 코드다** — `'C'` 대표 / `'M'` 직원
--   (`shared/domain/member-payload.ts` 의 `MEMBER_ROLE`). `'Y'` 를 넣으면 조용히
--   「직원이 아닌 무언가」가 된다.
--
-- ★★ 부분 UNIQUE **색인**이다(제약이 아니다). 부분 제약은 Postgres 에 없고, 제약으로
--    걸려면 비활성 대표 행까지 유일해져야 한다 — 예약 이력 때문에 남겨 둔 행들이
--    전부 걸린다.
--
-- ★★★ 이 색인은 **트랜잭션 중간 상태도 본다**(색인은 지연시킬 수 없다). 그래서
--    `replaceMembers` 는 행을 쓰기 **전에** 그 회사의 다른 활성 대표를 먼저 `'M'` 으로
--    내린다 — 대표가 1행에서 2행으로 옮겨가는 저장이 중간에 「대표 둘」을 지나가기
--    때문이다. 그 전처리가 사라지면 이 색인이 멀쩡한 저장을 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS ux_s080_members_one_active_rep
  ON public.tb_s080_members (company_id)
  WHERE is_representative = 'C' AND status = 'active';

COMMENT ON INDEX public.ux_s080_members_one_active_rep IS
  '한 입주사의 활성 대표는 하나 — 삐용 대표 수정(U)이 보낼 회원번호를 가리는 근거다. '
  '비활성 대표 행은 여럿 허용한다(예약 이력 때문에 지우지 않고 inactive 로 둔다).';

-- -----------------------------------------------------------------------------
-- 회사 표의 대표자 칸은 「사본」이다
-- -----------------------------------------------------------------------------
-- 계약 폼 섹션 3 의 1행이 섹션 1 「대표자」를 실시간 미러링하고, 저장도 양쪽에 같은
-- 값이 들어간다. 삐용에 **보내는 근거는 구성원 행**이다 — 회원번호가 거기에만 있다.
COMMENT ON COLUMN public.tb_s080_companies.ceo_name IS
  '대표자명 — ★ **사본이다.** 정본은 tb_s080_members 의 활성 대표 행(is_representative=''C'')'
  '이고, 삐용 회원번호(link_s020_member_id)도 그 행에만 있다. 계약서·세금계산서가 이 칸을 '
  '읽기 때문에 남겨 둔다(계약 폼 섹션 1 이 쓰고, 섹션 3 1행이 같은 값을 미러링한다). '
  '둘이 어긋나면 구성원 행을 믿는다.';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- 1) 컬럼 3개
--    SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='tb_s080_members'
--       AND column_name LIKE 'link_%' ORDER BY 1;
--    -- link_failed_at · link_failed_reason · link_s020_member_id(integer)
--
-- 2) UNIQUE 제약과 부분 색인
--    SELECT conname FROM pg_constraint
--     WHERE conrelid='public.tb_s080_members'::regclass
--       AND conname='ux_s080_members_link_member_id';            -- 1행
--    SELECT indexdef FROM pg_indexes
--     WHERE schemaname='public' AND indexname='ux_s080_members_one_active_rep';
--
-- 3) 활성 대표가 둘 이상인 회사 — 없어야 한다(색인이 이미 보장한다)
--    SELECT company_id, count(*) FROM public.tb_s080_members
--     WHERE is_representative='C' AND status='active'
--     GROUP BY 1 HAVING count(*) > 1;                            -- 0행
--
-- 4) erp_app 권한은 테이블 단위라 새 컬럼에 자동으로 따라온다. 확인만:
--    SELECT has_table_privilege('erp_app','public.tb_s080_members','UPDATE');  -- t
--
-- -----------------------------------------------------------------------------
-- 되돌리기 (적용 후에는 쓰지 말 것 — 받아 둔 삐용 회원번호가 사라진다)
-- -----------------------------------------------------------------------------
-- DROP INDEX IF EXISTS public.ux_s080_members_one_active_rep;
-- ALTER TABLE public.tb_s080_members
--   DROP CONSTRAINT IF EXISTS ux_s080_members_link_member_id,
--   DROP COLUMN IF EXISTS link_s020_member_id,
--   DROP COLUMN IF EXISTS link_failed_reason,
--   DROP COLUMN IF EXISTS link_failed_at;
