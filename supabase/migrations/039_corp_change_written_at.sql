-- =============================================================================
-- 039_corp_change_written_at.sql
--
-- 법인변경 건(tb_s080_corp_changes)의 submitted_at 을 written_at(작성완료 시각)으로 이름을 바꾼다.
-- (결정 2026-10-10, ★ 적용 전 승인 대기)
--
-- -----------------------------------------------------------------------------
-- 왜
-- -----------------------------------------------------------------------------
-- 진행 상태에서 「제출(A)」을 뺐다 — 제출은 상대 회사 연락이 없으면 확정할 수 없다. 그래서
-- 제출 시각(submitted_at)은 쓸 곳이 없다. 대신 날짜 줄에 **작성완료일**(P→E 시각)을 보여 줘야
-- 하는데 담을 칸이 없다. 안 쓰는 칸을 남기지 않고, 새 칸을 더하지 않고, 이름을 바꾼다.
--
--   · written_at — P→E(작성완료) 때 채운다. 서류수정(E→P) 뒤 다시 작성완료하면 바뀐다
--   · submit_snapshot 은 이름을 바꾸지 않는다 — P→E 때 남기는 「작성완료 당시 회사값」이다
--     (용도는 shared `corp-change-transition.ts` 머리말)
--
-- ★ 값은 그대로 옮겨진다(RENAME). 2026-10-10 개발 DB 에서 submitted_at 이 찬 행은 1건이고,
--   그 건(상태 A)은 별도 일회용 정리 파일(`scripts/oneoff/2026-10-10-drop-status-a-corp-change.sql`)
--   로 지운다. 그 파일을 먼저 돌리면 옮겨지는 값은 0건이다.
--
-- ★★ 레거시 S-WonERP(Prisma)가 같은 칸을 `submittedAt @map("submitted_at")` 으로 읽는다
--    (`prisma/schema.prisma` CorpChange). 레거시 앱이 이 DB 에 붙어 있으면 법인변경 읽기가 깨진다.
--
-- ★ 뷰 · 함수 · 정책이 이 칸을 읽지 않는다(2026-10-10 개발 DB 확인). RLS(erp_org_scope)는 org_id 만 본다.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_s080_corp_changes RENAME COLUMN submitted_at TO written_at;

COMMENT ON COLUMN public.tb_s080_corp_changes.written_at IS
  '작성완료(P→E) 시각. 다시 작성완료하면 바뀐다. 039 이전 이름은 submitted_at(제출 시각 — 제출 단계는 없앴다).';

COMMIT;

-- =============================================================================
-- 검증
-- =============================================================================
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'tb_s080_corp_changes' AND column_name IN ('submitted_at', 'written_at');
-- -- written_at 한 줄만
--
-- -----------------------------------------------------------------------------
-- 되돌리기
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.tb_s080_corp_changes RENAME COLUMN written_at TO submitted_at;
