-- =============================================================================
-- 일회용 정리 — 개발 DB 의 상태 A(서류제출) 법인변경 건을 지운다 (2026-10-10, ★ 적용 전 승인 대기)
--
-- 진행 상태에서 「제출(A)」을 뺐다(결정 2026-10-10). A 인 건은 갈 수 있는 전이가 없다.
-- 개발 DB 에 1건 있고 시험 자료다 — 지운다(사용자 결정).
--
--   대상: e1be16f8-0a43-4df0-8893-dc08bbc06c15 · 상호변경(NAME) · 단체 9003(Z99) · 임원 0명
--
-- ★ 039 마이그레이션과 섞지 않는다 — 운영계에서 돌 일이 없는 개발 DB 정리다.
-- ★ postgres(또는 운영사 스코프)로 돌린다. 대상이 **그 1건뿐**이 아니면 아무것도 지우지 않고 멈춘다.
-- ★ 임원은 FK(ON DELETE CASCADE)로 함께 지워지지만, 앱과 같은 순서로 먼저 지운다.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  n_a   int;
  n_hit int;
BEGIN
  SELECT count(*) INTO n_a FROM public.tb_s080_corp_changes WHERE status = 'A';
  SELECT count(*) INTO n_hit FROM public.tb_s080_corp_changes
   WHERE status = 'A' AND id = 'e1be16f8-0a43-4df0-8893-dc08bbc06c15';
  IF n_a <> 1 OR n_hit <> 1 THEN
    RAISE EXCEPTION '대상이 그 1건이 아니다 — 상태 A %건, 대상 일치 %건. 지우지 않는다', n_a, n_hit;
  END IF;
END $$;

DELETE FROM public.tb_s080_corp_change_officers
 WHERE corp_change_id = 'e1be16f8-0a43-4df0-8893-dc08bbc06c15';
DELETE FROM public.tb_s080_corp_changes
 WHERE id = 'e1be16f8-0a43-4df0-8893-dc08bbc06c15' AND status = 'A';

COMMIT;

-- 확인: SELECT count(*) FROM public.tb_s080_corp_changes WHERE status = 'A';  -- 0
