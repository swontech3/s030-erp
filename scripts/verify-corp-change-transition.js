/**
 * 법인변경 상세(s040200011, 4단계) 검증 — 상태 전이 · 삭제 · 작성완료 스냅샷을 **RLS 를 거쳐** 잰다.
 * 흐름은 P → E → C, 취소 X(2026-10-10 제출(A) 삭제). 완료 취소(C→E)는 운영사만 · 완료일을 비운다.
 * [작성완료] 한 번(저장 → 검증 → P→E, W1~W4) · 대표주소 변경의 변경 전 주소 = 대표자 자택(K1~K3)도 본다.
 *
 * 사용: npm run verify:corp-change-transition   (= npx tsx scripts/verify-corp-change-transition.js)
 *
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — `packages/api/.env` 의 erp_app 이다(RLS 는 erp_app 으로만 잰다).
 * ★★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *    라우트가 쓰는 그 함수(`legal/corpChangeOps.ts`)를 스코프를 바꿔 가며 부른다.
 *
 * ★ 「동시 전이」는 한 연결 안에서 **상태를 먼저 바꿔 두고 낡은 from 으로 누르는 것**으로 잰다. 두 연결로
 *   진짜 동시에 누르려면 시험 행을 커밋해야 한다 — 시험 데이터는 롤백 트랜잭션 안에서만(결정). 잠금
 *   (`FOR UPDATE`)을 거는지는 라우트 시험(`corpChanges.test.ts`)이 SQL 로 본다.
 *
 * 시험 단체(실제 삐용 번호 · mock 9001~9199 와 겹치지 않는 대역 — 상세 검증과 같다):
 *   990001 — 입주사 A · 990002 — 비입주사 B
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope, scopeOfSession } from '../packages/api/src/db/withCompanyScope.ts';
import {
  addOfficer,
  createCorpChange,
  deleteCorpChangeOp,
  editOfficer,
  readCorpChangeDetail,
  saveCorpChangePayload,
  transitionCorpChange,
} from '../packages/api/src/legal/corpChangeOps.ts';
import { parseFirstSave } from '../packages/shared/src/domain/corp-change-detail.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const PREFIX = 'v-cct-';
const RRN = '9001011234567';

const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const session = (role, s020OrgId, companyId = null, s020MemberId = 7001) => ({
  erpSid: 'verify',
  s020MemberId,
  s020OrgId,
  companyId,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

async function main() {
  const c = await pool.connect();
  const createdIds = [];
  try {
    await c.query('BEGIN');
    try {
      const companyA = `${PREFIX}company-a`;
      const OP = session('operator', 1);
      const TA = session('tenant', ORG_A, companyA);
      const TB = session('tenant', ORG_B, null);
      const as = (s) => applyCompanyScope(c, scopeOfSession(s));
      const attempt = async (fn) => {
        await c.query('SAVEPOINT sp');
        try {
          const value = await fn();
          await c.query('RELEASE SAVEPOINT sp');
          return { threw: null, value };
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT sp');
          return { threw: e, value: null };
        }
      };
      /** 운영사 스코프로 건 한 줄을 읽는다(검사용). */
      const rowOf = async (id) => {
        await as(OP);
        return (await c.query(
          `SELECT status, status_before_cancel, cancel_reason, cancelled_at, written_at, completed_at, submit_snapshot
             FROM public.tb_s080_corp_changes WHERE id = $1`,
          [id],
        )).rows[0];
      };
      const press = async (s, id, from, to, cancelReason) => {
        await as(s);
        return transitionCorpChange(c, s, id, { from, to, ...(cancelReason === undefined ? {} : { cancelReason }) });
      };
      const firstSave = async (s, body) => {
        await as(s);
        const parsed = parseFirstSave(body, s);
        const r = parsed.ok ? await createCorpChange(c, s, parsed.value) : parsed;
        if (r.ok) createdIds.push(r.value.id);
        return r;
      };

      // ── 바탕 — 시험 입주사 A ─────────────────────────────────────────
      await as(OP);
      const build = (await c.query(`SELECT build_id FROM public.tb_s080_buildings ORDER BY 1 LIMIT 1`)).rows[0].build_id;
      const used = new Set((await c.query(`SELECT link_org_code FROM public.tb_s080_companies WHERE link_org_code IS NOT NULL`)).rows.map((r) => r.link_org_code));
      const CODE_A = [...Array(99).keys()].map((n) => `Z${String(99 - n).padStart(2, '0')}`).find((z) => !used.has(z));
      await c.query(
        `INSERT INTO public.tb_s080_companies
           (company_id, build_id, company_name, corp_number, ceo_name, address, head_zip_code, head_address,
            ceo_zip_code, ceo_address, ceo_address_detail, member_type, updated_at, link_s020_org_id, link_org_code)
         VALUES ($1, $2, '시험입주사A', '110111-9900001', '김입주', '사업장주소', '06000', '서울 강남구 본점로 1',
                 '04524', '서울 중구 자택로 1', '101호', 'R', now(), $3, $4)`,
        [companyA, build, ORG_A, CODE_A],
      );

      // ── 회사 A 의 임원 건 — 작성완료(스냅샷 · 작성완료일) · 완료 · 완료 취소 ─────────────
      const a1 = (await firstSave(TA, {
        changeType: 'OFFICER',
        payload: { resolutionDate: '2026-10-01' },
        officers: [{ name: '김임원', changeKind: 'APPOINT', position: '', effectiveDate: '2026-10-01', rrn: '900101-1234567' }],
      })).value.id;

      const failPE = await press(TA, a1, 'P', 'E');
      const v1 = await rowOf(a1);
      check('V1', '★ P→E 검증 실패 — 400 · 칸별 오류(저장된 임원) · 상태 · 스냅샷 · 작성완료일 불변',
        !failPE.ok && failPE.status === 400 && failPE.errors?.[0]?.field === 'officers.0.position' &&
          v1.status === 'P' && v1.submit_snapshot === null && v1.written_at === null,
        failPE.errors);

      await as(TA);
      const officerId = (await c.query(`SELECT id FROM public.tb_s080_corp_change_officers WHERE corp_change_id = $1`, [a1])).rows[0].id;
      await editOfficer(c, TA, a1, officerId, { name: '김임원', changeKind: 'APPOINT', position: '이사', effectiveDate: '2026-10-01', rrn: '' });

      // 원자성 — 작성완료 UPDATE(상태 + 스냅샷 + 작성완료일) 뒤에 실패하면 셋 다 남지 않는다
      await as(TA);
      let afterUpdate = false;
      const failing = {
        query: (sql, params) => {
          if (afterUpdate) return Promise.reject(new Error('시험 — 전이 뒤 읽기에서 실패'));
          if (/UPDATE public\.tb_s080_corp_changes SET status/.test(sql)) afterUpdate = true;
          return c.query(sql, params);
        },
      };
      const midFail = await attempt(() => transitionCorpChange(failing, TA, a1, { from: 'P', to: 'E' }));
      const afterFail = await rowOf(a1);
      check('T1', '★ 원자성 — 작성완료(상태+스냅샷+작성완료일)를 쓴 뒤 같은 트랜잭션이 실패하면 모두 되돌아간다',
        midFail.threw !== null && afterUpdate && afterFail.status === 'P' && afterFail.submit_snapshot === null && afterFail.written_at === null,
        { threw: midFail.threw?.message, status: afterFail.status });

      const okPE = await press(TA, a1, 'P', 'E');
      const s1 = await rowOf(a1);
      const snapJson = JSON.stringify(s1.submit_snapshot);
      await as(OP);
      const cipher = (await c.query(`SELECT rrn_cipher FROM public.tb_s080_corp_change_officers WHERE id = $1`, [officerId])).rows[0].rrn_cipher;
      check('V2', '회사 — 고친 뒤 P→E 통과 · 새 상세의 버튼은 [서류수정 · 완료]',
        okPE.ok && okPE.value.status === 'E' && JSON.stringify(okPE.value.availableTransitions) === '["P","C"]' && !okPE.value.editable,
        okPE.value?.availableTransitions ?? okPE);
      check('S1', '★★ 작성완료(P→E) 때 스냅샷이 생긴다 — 주민번호 없음(평문 · 암호문 · 마스킹 · rrn 칸 모두)',
        s1.status === 'E' && s1.submit_snapshot !== null &&
          !snapJson.includes(RRN) && !snapJson.includes('900101') && !snapJson.includes(cipher) && !/rrn/i.test(snapJson),
        s1.submit_snapshot?.officers);
      check('S2', '★ 스냅샷 회사값 = ERP 입주사 정보(변경 전) · 변경 내용 · 임원 · 작성완료일(written_at)',
        s1.submit_snapshot?.company?.name === '시험입주사A' && s1.submit_snapshot.company.corpNumber === '110111-9900001' &&
          s1.submit_snapshot.company.ceoHome?.address === '서울 중구 자택로 1' && s1.submit_snapshot.company.head?.address === '서울 강남구 본점로 1' &&
          s1.submit_snapshot.payload?.resolutionDate === '2026-10-01' && s1.submit_snapshot.officers?.[0]?.position === '이사' &&
          s1.written_at !== null && okPE.value.writtenOn !== null,
        s1.submit_snapshot?.company);

      // 회사 B 는 A 의 건을 못 건드린다
      const bPress = await press(TB, a1, 'E', 'C');
      const bDel = await (async () => { await as(TB); return deleteCorpChangeOp(c, TB, a1, 'E'); })();
      await as(TB);
      const bRaw = await c.query(`UPDATE public.tb_s080_corp_changes SET status = 'C' WHERE id = $1`, [a1]);
      check('R1', '★ 회사 B 는 A 의 건을 전이 · 삭제 못 한다(404 · SQL 직접 0건 · 상태 불변)',
        !bPress.ok && bPress.status === 404 && !bDel.ok && bDel.status === 404 && bRaw.rowCount === 0 && (await rowOf(a1)).status === 'E');

      // 회사 세션 — 취소 · 삭제는 403
      const tX = await press(TA, a1, 'E', 'X');
      await as(TA);
      const tDel = await deleteCorpChangeOp(c, TA, a1, 'E');
      check('R2', '★★ 회사 세션 — 취소 · 삭제는 403 · 상태 불변',
        [tX, tDel].every((r) => !r.ok && r.status === 403) && (await rowOf(a1)).status === 'E',
        [tX, tDel].map((r) => r.status));

      // 동시 전이 — 운영사가 E 를 보고 완료를 누르려는데, 그새 다른 사람이 서류수정(E→P)으로 돌렸다
      const back = await press(OP, a1, 'E', 'P');
      const staleC = await press(OP, a1, 'E', 'C');
      const s2 = await rowOf(a1);
      check('C1', '★ 상태가 이미 바뀌었으면 409 · 아무것도 쓰지 않는다 · E→P 뒤에도 스냅샷 · 작성완료일은 남는다',
        back.ok && !staleC.ok && staleC.status === 409 && staleC.error === 'stale_status' && s2.status === 'P' && s2.completed_at === null &&
          JSON.stringify(s2.submit_snapshot) === snapJson && s2.written_at !== null,
        staleC);

      // 다시 작성완료 — 새 스냅샷 · 새 작성완료일
      await as(TA);
      await saveCorpChangePayload(c, TA, a1, { payload: { resolutionDate: '2026-10-05' } });
      const again = await press(TA, a1, 'P', 'E');
      const s3 = await rowOf(a1);
      check('S3', '다시 작성완료 — 스냅샷 · 작성완료일을 새 것으로 바꾼다',
        again.ok && s3.submit_snapshot?.payload?.resolutionDate === '2026-10-05' && s3.written_at !== null);

      // 완료(E→C) — 회사도 누른다
      const done = await press(TA, a1, 'E', 'C');
      const s4 = await rowOf(a1);
      const tUndo = await press(TA, a1, 'C', 'E');
      check('C2', '★ 완료(E→C) — 회사도 · completed_at 기록 · 회사에게 버튼 없음 · 완료 취소(C→E)는 회사 403',
        done.ok && s4.status === 'C' && s4.completed_at !== null && done.value.availableTransitions.length === 0 &&
          done.value.completedOn !== null && !tUndo.ok && tUndo.status === 403 && (await rowOf(a1)).status === 'C',
        { done: done.value?.availableTransitions, undo: tUndo.status });

      // 완료 취소(C→E) — 운영사만 · 완료일을 비운다
      const undo = await press(OP, a1, 'C', 'E');
      const s5 = await rowOf(a1);
      check('U1', '★ 완료 취소(C→E) — 운영사 · completed_at 을 비운다 · 작성완료일 · 스냅샷은 그대로',
        undo.ok && s5.status === 'E' && s5.completed_at === null && undo.value.completedOn === null &&
          s5.written_at !== null && JSON.stringify(s5.submit_snapshot) === JSON.stringify(s3.submit_snapshot),
        s5);

      await press(OP, a1, 'E', 'C');
      const afterDone = await press(OP, a1, 'C', 'P');
      await as(OP);
      const delDone = await deleteCorpChangeOp(c, OP, a1, 'C');
      const toA = await press(OP, a1, 'C', 'A');
      check('C3', '완료 건 — C→P 409 · 삭제 409 · 제출(A)은 모르는 상태(400)',
        !afterDone.ok && afterDone.status === 409 && !delDone.ok && delDone.status === 409 && !toA.ok && toA.status === 400);

      // ── [작성완료] 한 번 — 저장 → 검증 → P→E (결정 2026-10-10) ───────────────────
      // 화면(`CorpChangeDetail.complete`)과 같은 순서로 부른다: 저장(PATCH · 첫 저장)이 실패하면 전이를 보내지
      // 않고, 저장이 되면 전이를 누른다(검증은 저장된 값으로).
      const completeOnce = async (s, id, body) => {
        await as(s);
        const saved = await saveCorpChangePayload(c, s, id, body);
        if (!saved.ok) return { saved, moved: null };
        return { saved, moved: await press(s, id, 'P', 'E') };
      };
      const w = (await firstSave(TB, { changeType: 'NAME', payload: { newName: '처음' } })).value.id;
      const w1 = await completeOnce(TB, w, { payload: { newName: '날짜없음' } });
      const w1row = await rowOf(w);
      await as(OP);
      const w1payload = (await c.query(`SELECT payload FROM public.tb_s080_corp_changes WHERE id = $1`, [w])).rows[0].payload;
      check('W1', '★ 작성완료 — 검증 실패면 입력은 저장된 채 P 그대로 · 칸별 오류(결의일)',
        w1.saved.ok && !w1.moved.ok && w1.moved.status === 400 && w1.moved.errors?.[0]?.field === 'resolutionDate' &&
          w1row.status === 'P' && w1payload.newName === '날짜없음' && w1row.written_at === null,
        w1.moved.errors);
      const w2 = await completeOnce(TB, w, { payload: { newName: 3, resolutionDate: '2026-10-01' } });
      await as(OP);
      const w2payload = (await c.query(`SELECT payload FROM public.tb_s080_corp_changes WHERE id = $1`, [w])).rows[0].payload;
      check('W2', '★ 작성완료 — 저장이 형식 오류(400)면 아무것도 바뀌지 않는다(전이를 보내지 않는다)',
        !w2.saved.ok && w2.saved.status === 400 && w2.moved === null && w2payload.newName === '날짜없음' && (await rowOf(w)).status === 'P',
        w2.saved);
      const w3 = await completeOnce(TB, w, { payload: { newName: '통과', resolutionDate: '2026-10-01' } });
      const w3row = await rowOf(w);
      check('W3', '★ 작성완료 — 통과하면 저장 + P→E · 작성완료일 · 스냅샷에 방금 저장한 값',
        w3.saved.ok && w3.moved.ok && w3row.status === 'E' && w3row.written_at !== null && w3row.submit_snapshot?.payload?.newName === '통과',
        w3row.status);

      // 임시 모드 — 첫 저장 + 전이. 검증이 실패해도 건은 P 로 생긴다
      const fresh = await firstSave(TB, { changeType: 'NAME', payload: { newName: '새 건' } });
      const freshMove = await press(TB, fresh.value.id, 'P', 'E');
      check('W4', '임시 모드 작성완료 — 검증 실패여도 건은 P 로 저장된다(화면은 그 건으로 옮겨 오류를 보인다)',
        fresh.ok && !freshMove.ok && freshMove.status === 400 && (await rowOf(fresh.value.id)).status === 'P');

      // ── 대표주소 변경 — 「변경 전 주소」 = 기본정보의 대표자 자택 ─────────────────
      const CEO_PAYLOAD = { newCeoAddress: { zipCode: '04000', address: '서울 새집로 1' }, moveInDate: '2026-10-01' };
      const k = (await firstSave(TB, { changeType: 'CEO_ADDR', payload: CEO_PAYLOAD })).value.id;
      const k1 = await completeOnce(TB, k, { payload: CEO_PAYLOAD });
      check('K1', '★ 비입주사 — 대표자 자택 주소가 없으면 작성완료 거절(company.ceo) · P 그대로',
        !k1.moved.ok && k1.moved.status === 400 && k1.moved.errors?.[0]?.field === 'company.ceo' && (await rowOf(k)).status === 'P',
        k1.moved.errors);
      const k2 = await completeOnce(TB, k, {
        payload: CEO_PAYLOAD,
        company: { legalName: '주식회사 시험비입주', ceoZipCode: '05000', ceoAddress: '서울 옛집로 2' },
      });
      const k2row = await rowOf(k);
      check('K2', '비입주사 — 같은 [작성완료] 로 자택 주소를 저장하면 통과 · 스냅샷의 변경 전 값 = 그 자택',
        k2.saved.ok && k2.moved.ok && k2row.status === 'E' && k2row.submit_snapshot?.company?.ceoHome?.address === '서울 옛집로 2',
        k2row.submit_snapshot?.company?.ceoHome);
      const ka = (await firstSave(TA, { changeType: 'CEO_ADDR', payload: CEO_PAYLOAD })).value.id;
      const ka1 = await completeOnce(TA, ka, { payload: CEO_PAYLOAD });
      check('K3', '입주사 — ERP 의 대표자 자택이 있으면 통과(변경 전 값 = ERP)',
        ka1.moved.ok && (await rowOf(ka)).submit_snapshot?.company?.ceoHome?.address === '서울 중구 자택로 1');

      // ── 취소 · 복원 ──────────────────────────────────────────────────
      const b1 = (await firstSave(OP, { changeType: 'NAME', orgId: ORG_B, orgCode: 'Z92', payload: { newName: '새상호', resolutionDate: '2026-10-01' } })).value.id;
      await press(OP, b1, 'P', 'E');
      const cancel = await press(OP, b1, 'E', 'X', '  고객 요청  ');
      const x1 = await rowOf(b1);
      await as(TB);
      const bSees = await readCorpChangeDetail(c, TB, b1);
      check('X1', '★ 취소 — 직전 상태 · 시각 · 사유 기록 · 회사도 사유를 본다(버튼은 없다)',
        cancel.ok && x1.status === 'X' && x1.status_before_cancel === 'E' && x1.cancelled_at !== null && x1.cancel_reason === '고객 요청' &&
          bSees.ok && bSees.value.cancelReason === '고객 요청' && bSees.value.availableTransitions.length === 0 && !bSees.value.canDelete,
        x1);
      const wrongRestore = await press(OP, b1, 'X', 'P');
      const tRestore = await press(TB, b1, 'X', 'E');
      check('X2', '★ 복원 — 취소 직전이 아닌 상태로는 409 · 회사는 403',
        !wrongRestore.ok && wrongRestore.status === 409 && wrongRestore.error === 'restore_target' && !tRestore.ok && tRestore.status === 403);
      const restore = await press(OP, b1, 'X', 'E');
      const x2 = await rowOf(b1);
      check('X3', '복원 — 직전 상태로 · 취소 칸 셋을 비운다',
        restore.ok && x2.status === 'E' && x2.status_before_cancel === null && x2.cancelled_at === null && x2.cancel_reason === null, x2);

      // ── 삭제 ────────────────────────────────────────────────────────
      await as(OP);
      const delE = await deleteCorpChangeOp(c, OP, b1, 'E');
      check('D1', '★ 진행 중(E) 삭제는 409', !delE.ok && delE.status === 409 && (await rowOf(b1)).status === 'E');
      await press(OP, b1, 'E', 'X');
      await as(OP);
      const delStale = await deleteCorpChangeOp(c, OP, b1, 'E');
      const delX = await deleteCorpChangeOp(c, OP, b1, 'X');
      check('D2', '취소(X) 건 삭제 — 본 상태가 낡으면 409, 맞으면 지운다',
        !delStale.ok && delStale.status === 409 && delX.ok && (await rowOf(b1)) === undefined);

      const a2 = (await firstSave(TA, {
        changeType: 'OFFICER',
        payload: {},
        officers: [{ name: '하나', changeKind: 'APPOINT', position: '이사' }, { name: '둘', changeKind: 'RESIGN', position: '감사' }],
      })).value.id;
      await as(TA);
      const tDelP = await deleteCorpChangeOp(c, TA, a2, 'P');
      await as(OP);
      const delP = await deleteCorpChangeOp(c, OP, a2, 'P');
      const leftOfficers = (await c.query(`SELECT count(*)::int AS n FROM public.tb_s080_corp_change_officers WHERE corp_change_id = $1`, [a2])).rows[0].n;
      check('D3', '★ 작성중(P) 삭제 — 회사는 403 · 운영사는 지운다 · 임원도 함께',
        !tDelP.ok && tDelP.status === 403 && delP.ok && leftOfficers === 0 && (await rowOf(a2)) === undefined, { leftOfficers });

      // 회사 B 가 A 의 P 건을 지우려 하면 404
      const a3 = (await firstSave(TA, { changeType: 'NAME', payload: {} })).value.id;
      await as(TB);
      const bDelP = await deleteCorpChangeOp(c, TB, a3, 'P');
      check('D4', '★ 회사 B 는 A 의 건을 못 지운다(404)', !bDelP.ok && bDelP.status === 404 && (await rowOf(a3))?.status === 'P');
    } finally {
      await c.query('ROLLBACK');
    }

    // ── 남은 것 없음 ──────────────────────────────────────────────────
    await c.query('BEGIN');
    await applyCompanyScope(c, scopeOfSession(session('operator', 1)));
    const left = (await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_corp_changes WHERE id = ANY($1) OR org_id IN ($2, $3))::int
            + (SELECT count(*) FROM public.tb_s080_corp_change_officers WHERE org_id IN ($2, $3))::int
            + (SELECT count(*) FROM public.tb_s080_companies WHERE company_id LIKE $4)::int
            + (SELECT count(*) FROM public.tb_s080_legal_orgs WHERE org_id IN ($2, $3))::int AS n`,
      [createdIds, ORG_A, ORG_B, `${PREFIX}%`],
    )).rows[0].n;
    await c.query('ROLLBACK');
    check('Z1', '롤백 후 — 시험 행이 남지 않았다', left === 0, String(left));
  } finally {
    c.release();
  }
}

main()
  .then(async () => {
    await closePool();
    console.table(results);
    const failed = results.filter((r) => r.결과 !== '통과').length;
    console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error('✘ 실행 실패:', e.message);
    await closePool().catch(() => {});
    process.exit(2);
  });
