/**
 * 법인변경 서류 출력(5-5) 검증 — 출력 값 · 주민번호 복호화 · 출력 이력을 **RLS 를 거쳐** 잰다.
 *
 * 사용: npm run verify:corp-change-print   (= npx tsx scripts/verify-corp-change-print.js)
 *
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — `packages/api/.env` 의 erp_app 이다(RLS 는 erp_app 으로만 잰다).
 * ★★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *    라우트가 쓰는 그 함수(`legal/corpChangeOps.ts` · `legal/corpChangePrint.ts`)를 스코프를 바꿔 가며 부른다.
 * ★ 양식은 **개발 DB 에 등록된 법무 양식을 그대로** 쓴다(읽기만 — 법인변경등록1 · 사임서 · 취임승낙서 등,
 *   2026-10-11). 없으면 해당 항목이 실패로 알린다.
 *
 * 시험 단체(다른 검증과 같은 대역): 990001 — 입주사 A(주식회사) · 990002 — 비입주사 B
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope, scopeOfSession } from '../packages/api/src/db/withCompanyScope.ts';
import { createCorpChange, transitionCorpChange } from '../packages/api/src/legal/corpChangeOps.ts';
import {
  listCorpChangePrints,
  readCorpChangePrint,
  recordCorpChangePrint,
} from '../packages/api/src/legal/corpChangePrint.ts';
import { parseFirstSave } from '../packages/shared/src/domain/corp-change-detail.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const PREFIX = 'v-ccp-';
const RRN_RESIGN = '9001011234567';
const RRN_APPOINT = '8505052345678';

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

/** 서류 이름으로 문서 · 장을 찾는다. */
const docOf = (r, name) => (r.ok ? r.value.documents.find((d) => d.name === name) : undefined);

async function main() {
  const c = await pool.connect();
  const createdIds = [];
  try {
    await c.query('BEGIN');
    try {
      const companyA = `${PREFIX}company-a`;
      const OP = session('operator', 1);
      const TA = session('tenant', ORG_A, companyA, 7101);
      const TB = session('tenant', ORG_B, null, 7201);
      const as = (s) => applyCompanyScope(c, scopeOfSession(s));
      const print = async (s, id, q = {}) => { await as(s); return readCorpChangePrint(c, s, id, q); };
      const press = async (s, id, from, to) => { await as(s); return transitionCorpChange(c, s, id, { from, to }); };

      // ── 바탕 — 시험 입주사 A(주식회사) ─────────────────────────────────
      await as(OP);
      const build = (await c.query(`SELECT build_id FROM public.tb_s080_buildings ORDER BY 1 LIMIT 1`)).rows[0].build_id;
      const used = new Set((await c.query(`SELECT link_org_code FROM public.tb_s080_companies WHERE link_org_code IS NOT NULL`)).rows.map((r) => r.link_org_code));
      const CODE_A = [...Array(99).keys()].map((n) => `Z${String(99 - n).padStart(2, '0')}`).find((z) => !used.has(z));
      await c.query(
        `INSERT INTO public.tb_s080_companies
           (company_id, build_id, company_name, corp_number, ceo_name, tel, address, head_zip_code, head_address, head_address_detail,
            ceo_zip_code, ceo_address, ceo_address_detail, member_type, updated_at, link_s020_org_id, link_org_code)
         VALUES ($1, $2, '시험입주사A', '110111-9900001', '김입주', '02-000-0001', '사업장주소', '06000', '서울 강남구 본점로 1', '3층',
                 '04524', '서울 중구 자택로 1', '101호', 'R', now(), $3, $4)`,
        [companyA, build, ORG_A, CODE_A],
      );
      const forms = (await c.query(`SELECT name FROM public.tb_s080_form_templates WHERE definition ? 'legal'`)).rows.map((r) => r.name);
      check('F0', '바탕 — 등록된 법무 양식(사임서 · 취임승낙서 · 법인변경등록1 포함)',
        ['사임서', '취임승낙서', '법인변경등록1'].every((n) => forms.includes(n)), forms.join(','));

      // ── 회사 A 의 임원 건(사임 1 · 취임 1) — 작성완료 전 ──────────────────
      await as(TA);
      const parsed = parseFirstSave({
        changeType: 'OFFICER',
        payload: { resolutionDate: '2026-10-01' },
        officers: [
          { name: '김사임', changeKind: 'RESIGN', position: '사내이사', effectiveDate: '2026-10-01', rrn: RRN_RESIGN },
          { name: '이취임', changeKind: 'APPOINT', position: '감사', effectiveDate: '2026-10-02', rrn: RRN_APPOINT },
        ],
      }, TA);
      const made = await createCorpChange(c, TA, parsed.value);
      const id = made.value.id;
      createdIds.push(id);

      const beforeE = await print(TA, id);
      check('P1', '서류작성중(P)에서는 출력 409', !beforeE.ok && beforeE.status === 409 && beforeE.error === 'not_printable');

      const pe = await press(TA, id, 'P', 'E');
      check('P2', '바탕 — 회사가 작성완료(P→E)', pe.ok && pe.value.status === 'E', pe.ok ? '' : pe.message);

      // ── 출력 값 ─────────────────────────────────────────────────────
      const r = await print(TA, id, { applyDate: '2026-10-11', writeDate: '2026-10-12' });
      check('P3', '작성완료 — 회사가 출력한다', r.ok, r.ok ? r.value.documents.map((d) => d.name).join(',') : r.message);

      const app = docOf(r, '법인변경등록1');
      const v = app?.sheets[0]?.values ?? {};
      check('P4', '건마다 서류 — 스냅샷 회사값 · 결의일 · 신청일 · 등기할 사항',
        v.companyName === '시험입주사A' && v.hqAddress === '서울 강남구 본점로 1 3층' && v.ceoPhone === '02-000-0001' &&
          v.resolutionDate === '2026년 10월 1일' && v.applyDate === '2026년 10월 11일' &&
          v.matterBody?.includes('사내이사 김사임 — 사임') && v.matterBody?.includes('감사 이취임 — 취임') && v.officerRrn === '',
        { companyName: v.companyName, hq: v.hqAddress, res: v.resolutionDate });

      const resign = docOf(r, '사임서');
      const appoint = docOf(r, '취임승낙서');
      const reelect = docOf(r, '사내이사 중임승낙서');
      check('P5', '★★ 주민번호 — 저장된 암호문을 출력 순간에 복호화해 그 임원 장에만(전체 13자리 · 하이픈)',
        resign?.sheets.length === 1 && resign.sheets[0].officerName === '김사임' && resign.sheets[0].values.officerRrn === '900101-1234567' &&
          appoint?.sheets.length === 1 && appoint.sheets[0].officerName === '이취임' && appoint.sheets[0].values.officerRrn === '850505-2345678',
        { resign: resign?.sheets.map((s) => s.officerName), appoint: appoint?.sheets.map((s) => s.officerName) });
      check('P6', '임원마다 서류 — 그 구분의 임원이 없으면 0장(중임승낙서)', reelect !== undefined && reelect.sheets.length === 0);
      check('P7', '★ 사임서 장에 취임 임원의 주민번호가 섞이지 않는다',
        !JSON.stringify(resign?.sheets ?? []).includes('850505') && !JSON.stringify(appoint?.sheets ?? []).includes('900101'));

      // ── 남의 건 · 운영사 ───────────────────────────────────────────────
      const byB = await print(TB, id);
      check('R1', '★★ 회사 B 는 A 의 건을 출력할 수 없다(404 — 없는 건과 같다)', !byB.ok && byB.status === 404);
      const byOp = await print(OP, id);
      check('R2', '운영사는 출력한다 — 같은 값', byOp.ok && docOf(byOp, '사임서')?.sheets[0]?.values.officerRrn === '900101-1234567');

      // ── 스냅샷 기준 — 작성완료 뒤 회사 정보가 바뀌어도 그때 값 ───────────────
      await as(OP);
      await c.query(`UPDATE public.tb_s080_companies SET company_name = '바뀐이름' WHERE company_id = $1`, [companyA]);
      const after = await print(TA, id);
      check('P8', '★ 작성완료 뒤 회사명이 바뀌어도 서류는 작성완료 당시 이름', docOf(after, '법인변경등록1')?.sheets[0]?.values.companyName === '시험입주사A');

      // ── 출력 이력 ──────────────────────────────────────────────────
      await as(TA);
      const resignForm = resign ? resign.formId : 'none';
      const rec = await recordCorpChangePrint(c, TA, id, { formId: resignForm, sheet: 0, applyDate: null, writeDate: '2026-10-12' });
      await as(OP);
      const logRow = (await c.query(`SELECT * FROM public.tb_s080_corp_change_prints WHERE corp_change_id = $1`, [id])).rows[0];
      check('H1', '★ 이력 한 줄 — 단체는 건의 것 · 이름은 서버가 찾은 것 · 역할 · 회원 ID',
        rec.ok && logRow?.org_id === ORG_A && logRow.form_name === '사임서' && logRow.officer_name === '김사임' &&
          logRow.printed_role === 'tenant' && logRow.printed_by === '7101',
        logRow ? { org: logRow.org_id, form: logRow.form_name, officer: logRow.officer_name } : rec);
      check('H2', '★★ 이력 줄에 주민번호가 없다', !JSON.stringify(logRow ?? {}).match(/900101|850505|rrn/i));

      await as(TB);
      const bRec = await recordCorpChangePrint(c, TB, id, { formId: resignForm, sheet: 0 });
      const bList = await listCorpChangePrints(c, id);
      const bSeen = (await c.query(`SELECT count(*)::int n FROM public.tb_s080_corp_change_prints WHERE corp_change_id = $1`, [id])).rows[0].n;
      check('H3', '★★ 회사 B — A 의 건에 기록 · 목록 모두 404, 이력 줄도 안 보인다(RLS)',
        !bRec.ok && bRec.status === 404 && !bList.ok && bList.status === 404 && bSeen === 0);

      await as(TA);
      const aList = await listCorpChangePrints(c, id);
      await as(OP);
      const opList = await listCorpChangePrints(c, id);
      check('H4', '회사 A · 운영사 — 이력 목록에 그 줄', aList.ok && aList.value.items.length === 1 && opList.ok && opList.value.items[0]?.formName === '사임서');

      await as(TA);
      const wrong = await recordCorpChangePrint(c, TA, id, { formId: resignForm, sheet: 5 });
      check('H5', '없는 장은 기록하지 않는다(400)', !wrong.ok && wrong.status === 400);

      // ── 상태 — 완료(C)도 출력 · 취소(X)는 409 ───────────────────────────
      const ec = await press(TA, id, 'E', 'C');
      const atC = await print(TA, id);
      check('S1', '완료(C)도 출력한다', ec.ok && atC.ok);
      const cx = await press(OP, id, 'C', 'X');
      const atX = await print(OP, id);
      check('S2', '취소(X)는 출력 409', cx.ok && !atX.ok && atX.status === 409);
    } finally {
      await c.query('ROLLBACK');
    }

    // ── 남은 것 없음 ──────────────────────────────────────────────────
    await c.query('BEGIN');
    await applyCompanyScope(c, scopeOfSession(session('operator', 1)));
    const left = (await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_corp_changes WHERE id = ANY($1) OR org_id IN ($2, $3))::int
            + (SELECT count(*) FROM public.tb_s080_corp_change_officers WHERE org_id IN ($2, $3))::int
            + (SELECT count(*) FROM public.tb_s080_corp_change_prints WHERE corp_change_id = ANY($1) OR org_id IN ($2, $3))::int
            + (SELECT count(*) FROM public.tb_s080_companies WHERE company_id LIKE $4)::int AS n`,
      [createdIds, ORG_A, ORG_B, `${PREFIX}%`],
    )).rows[0].n;
    await c.query('ROLLBACK');
    check('Z1', '롤백 후 — 시험 행(건 · 임원 · 이력 · 회사)이 남지 않았다', left === 0, String(left));
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
