/**
 * 법인변경 상세(s040200011, 3단계) 검증 — 첫 저장(새 건) · 임시 모드 · 상세 · 변경 내용 · 임원 · 회사
 * 정보를 **RLS 를 거쳐** 잰다. 첫 저장의 원자성(형식 오류 · DB 도중 실패)도 본다.
 *
 * 사용: npm run verify:corp-change-detail   (= npx tsx scripts/verify-corp-change-detail.js)
 *
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — `packages/api/.env` 의 erp_app 이다. RLS 는 erp_app 으로
 *    접속해서만 잴 수 있다(postgres 는 bypassrls — `verify-037.js` 머리말).
 * ★★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *    스코프를 `applyCompanyScope(scopeOfSession(세션))` 으로 바꿔 가며 **라우트가 쓰는 그 함수**
 *    (`legal/corpChangeOps.ts`)를 부른다. 거절이 예외로 나는 자리(RLS)는 SAVEPOINT 로 감싼다.
 *
 * 시험 단체(실제 삐용 번호 · mock 9001~9199 와 겹치지 않는 대역):
 *   990001 — 입주사 A (시험 입주사 줄, link_org_code 는 비어 있는 Z## 하나 — 031 의 CHECK · UNIQUE)
 *   990002 — 비입주사 B
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope, scopeOfSession } from '../packages/api/src/db/withCompanyScope.ts';
import { listCorpChanges, insertCorpChange } from '../packages/api/src/db/corpChanges.ts';
import { decrypt } from '../packages/api/src/lib/crypto.ts';
import {
  addOfficer,
  createCorpChange,
  editOfficer,
  readCorpChangeDetail,
  readCorpChangeDraft,
  removeOfficer,
  saveCompanyInfo,
  saveCorpChangePayload,
} from '../packages/api/src/legal/corpChangeOps.ts';
import { parseCreateBody, parseFirstSave, parseOrgTarget } from '../packages/shared/src/domain/corp-change-detail.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const PREFIX = 'v-ccd-';
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

const ALL = { from: null, to: null, changeType: null, status: null, tenancy: null, includeCancelled: true };

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
      /** RLS 거절처럼 예외가 나는 자리 — 트랜잭션을 살려 두려고 SAVEPOINT 로 감싼다. */
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

      // ── 바탕 — 운영사 스코프로 시험 입주사 A 를 만든다 ───────────────────────
      await as(OP);
      const build = (await c.query(`SELECT build_id FROM public.tb_s080_buildings ORDER BY 1 LIMIT 1`)).rows[0].build_id;
      const used = new Set((await c.query(`SELECT link_org_code FROM public.tb_s080_companies WHERE link_org_code IS NOT NULL`)).rows.map((r) => r.link_org_code));
      const CODE_A = [...Array(99).keys()].map((n) => `Z${String(99 - n).padStart(2, '0')}`).find((z) => !used.has(z));
      await c.query(
        `INSERT INTO public.tb_s080_companies
           (company_id, build_id, company_name, ceo_name, address, ceo_zip_code, ceo_address, ceo_address_detail,
            member_type, updated_at, link_s020_org_id, link_org_code)
         VALUES ($1, $2, '시험입주사A', '김입주', '사업장주소(쓰면 안 됨)', '04524', '서울 중구 자택로 1', '101호',
                 'R', now(), $3, $4)`,
        [companyA, build, ORG_A, CODE_A],
      );

      // ── 첫 저장 = 새 건 (결정 2026-10-10 — [새 건] 대화상자는 아무것도 쓰지 않는다) ─────────
      /** 라우트와 같은 순서 — 본문을 다 읽고(`parseFirstSave`), 통과하면 한 번에 넣는다. */
      const firstSave = async (s, body) => {
        const parsed = parseFirstSave(body, s);
        return parsed.ok ? createCorpChange(c, s, parsed.value) : parsed;
      };
      const countOf = async (org) => {
        await as(OP);
        const r = (await c.query(
          `SELECT (SELECT count(*) FROM public.tb_s080_corp_changes WHERE org_id = $1)::int AS changes,
                  (SELECT count(*) FROM public.tb_s080_corp_change_officers WHERE org_id = $1)::int AS officers`,
          [org],
        )).rows[0];
        return `${r.changes}/${r.officers}`;
      };

      const opA = await firstSave(OP, { changeType: 'OFFICER', orgId: ORG_A, orgCode: CODE_A, payload: { resolutionDate: '2026-10-01' } });
      const opB = await firstSave(OP, { changeType: 'NAME', orgId: ORG_B, orgCode: 'Z92', payload: { newName: '새상호' } });
      const b1Row = opB.ok ? (await c.query(`SELECT payload FROM public.tb_s080_corp_changes WHERE id = $1`, [opB.value.id])).rows[0] : null;
      check('N1', '운영사 — 첫 저장에 건 + 변경 내용이 함께 들어간다(회사 A · B)', opA.ok && opB.ok && b1Row?.payload?.newName === '새상호', b1Row);
      const a1 = opA.value.id;
      const b1 = opB.value.id;
      createdIds.push(a1, b1);

      await as(TA);
      const taNew = await firstSave(TA, { changeType: 'CEO_ADDR', payload: { moveInDate: '2026-10-01' } });
      const a2 = taNew.value.id;
      createdIds.push(a2);
      const a2row = (await c.query(`SELECT org_id, org_code, status, payload FROM public.tb_s080_corp_changes WHERE id = $1`, [a2])).rows[0];
      check('N2', '회사 A 세션 — 자기 단체 · 상태 P · 단체코드는 ERP 에서 · 변경 내용 저장',
        a2row?.org_id === ORG_A && a2row.status === 'P' && a2row.org_code === CODE_A && a2row.payload.moveInDate === '2026-10-01', a2row);

      const beforeB = await countOf(ORG_B);
      await as(TA);
      const forged = await firstSave(TA, { changeType: 'NAME', orgId: ORG_B, payload: {} });
      check('N3', '★ 회사 A 가 B 의 단체 ID 로 첫 저장 — 403 · 아무것도 생기지 않는다',
        !forged.ok && forged.status === 403 && (await countOf(ORG_B)) === beforeB, forged);
      await as(TA);
      const rlsInsert = await attempt(() =>
        insertCorpChange(c, { id: `${PREFIX}forged`, changeType: 'NAME', status: 'P', orgId: ORG_B, orgCode: null, payload: {}, actor: 'v' }),
      );
      check('N4', '★ 코드를 건너뛰어도 RLS(WITH CHECK)가 거절', rlsInsert.threw !== null && /row-level security/i.test(rlsInsert.threw.message), rlsInsert.threw?.message ?? '들어갔다');

      // ── 첫 저장 — 임원까지 한 요청 · 한 트랜잭션 ─────────────────────────
      await as(TA);
      const withOfficers = await firstSave(TA, {
        changeType: 'OFFICER',
        payload: {},
        officers: [
          { name: '첫임원', changeKind: 'APPOINT', position: '이사', rrn: '900101-1234567' },
          { name: '둘째', changeKind: 'RESIGN' },
        ],
      });
      const a4 = withOfficers.value?.id;
      if (a4) createdIds.push(a4);
      const a4Officers = a4
        ? (await c.query(`SELECT org_id, name, rrn_cipher, rrn_iv, rrn_masked FROM public.tb_s080_corp_change_officers WHERE corp_change_id = $1 ORDER BY sort_order`, [a4])).rows
        : [];
      check('F1', '★ 첫 저장 — 임원도 같이 · 단체는 건의 것 · 주민번호 암호화(평문 없음)',
        withOfficers.ok && a4Officers.length === 2 && a4Officers.every((o) => o.org_id === ORG_A) &&
          /^v1\./.test(a4Officers[0].rrn_cipher) && a4Officers[0].rrn_iv === null && a4Officers[1].rrn_cipher === null &&
          !JSON.stringify(a4Officers).includes(RRN) && !JSON.stringify(withOfficers).includes(RRN),
        a4Officers.map((o) => ({ name: o.name, masked: o.rrn_masked })));

      const beforeA = await countOf(ORG_A);
      await as(TA);
      const badOne = await firstSave(TA, {
        changeType: 'OFFICER',
        payload: { resolutionDate: '2026-10-01' },
        officers: [{ name: '정상', rrn: '900101-1234567' }, { name: '형식오류', rrn: '900101-12345' }],
      });
      check('F2', '★ 원자성(형식) — 임원 하나가 형식 오류면 건도 임원도 생기지 않는다(400 · 칸별 오류)',
        !badOne.ok && badOne.status === 400 && badOne.errors?.[0]?.field === 'officers.1.rrn' && (await countOf(ORG_A)) === beforeA,
        { errors: badOne.errors, count: beforeA });

      // DB 가 도중에 거절하는 경우 — 두 번째 임원을 넣을 때 실패시킨다. 라우트의 트랜잭션이 하는
      // 것처럼 되돌린 뒤(여기서는 SAVEPOINT), 건도 첫 임원도 남지 않아야 한다.
      await as(TA);
      let officerInserts = 0;
      const failing = {
        query: (sql, params) => {
          if (/INSERT INTO public\.tb_s080_corp_change_officers/.test(sql) && ++officerInserts === 2) {
            return Promise.reject(new Error('시험 — 두 번째 임원에서 실패'));
          }
          return c.query(sql, params);
        },
      };
      const midFail = await attempt(async () => {
        const parsed = parseFirstSave({ changeType: 'OFFICER', payload: {}, officers: [{ name: '하나' }, { name: '둘' }] }, TA);
        return createCorpChange(failing, TA, parsed.value);
      });
      check('F3', '★ 원자성(DB 도중 실패) — 되돌리면 건도 첫 임원도 남지 않는다',
        midFail.threw !== null && officerInserts === 2 && (await countOf(ORG_A)) === beforeA, midFail.threw?.message);

      // ── 임시 모드 읽기 — 건을 읽지 않고 기본정보만 ───────────────────────
      await as(TA);
      const draftA = await readCorpChangeDraft(c, TA, parseCreateBody({ changeType: 'HQ' }, TA).value);
      const draftForged = parseCreateBody({ changeType: 'HQ', orgId: String(ORG_B) }, TA);
      await as(TB);
      const draftB = await readCorpChangeDraft(c, TB, parseCreateBody({ changeType: 'NAME' }, TB).value);
      check('D1', '임시 모드 — 자기 회사 기본정보(입주사 = ERP) · 남의 단체 주소는 403',
        draftA.ok && draftA.value.company.isTenant && draftA.value.company.displayName === '시험입주사A' &&
          draftA.value.orgCode === CODE_A && draftB.ok && !draftB.value.company.isTenant &&
          !draftForged.ok && draftForged.status === 403,
        { a: draftA.value?.company.displayName, b: draftB.value?.company.displayName });

      // ── 읽기 — 남의 건은 404 ───────────────────────────────────────────
      await as(TA);
      const aReadsB = await readCorpChangeDetail(c, b1);
      check('R1', '★ 회사 A 는 B 의 건을 못 읽는다(404)', !aReadsB.ok && aReadsB.status === 404, aReadsB);
      await as(TB);
      const bReadsA = await readCorpChangeDetail(c, a1);
      const bList = (await listCorpChanges(c, ALL)).filter((i) => i.id === a1 || i.id === a2);
      check('R2', '★ 회사 B 는 A 의 건을 못 읽는다(404 · 목록 0건)', !bReadsA.ok && bReadsA.status === 404 && bList.length === 0);
      await as(OP);
      const opReads = [await readCorpChangeDetail(c, a1), await readCorpChangeDetail(c, b1)];
      check('R3', '운영사는 둘 다 읽는다', opReads.every((r) => r.ok));

      // ── 임원 · 주민번호 ─────────────────────────────────────────────────
      await as(TA);
      const added = await addOfficer(c, TA, a1, { name: '김임원', changeKind: 'APPOINT', position: '이사', rrn: '900101-1234567' });
      const o1 = added.value?.id;
      const stored = (await c.query(
        `SELECT rrn_cipher, rrn_iv, rrn_masked, name, position, address FROM public.tb_s080_corp_change_officers WHERE id = $1`,
        [o1],
      )).rows[0];
      check('P1', '★ 주민번호 — 암호화 저장(v1 덩어리) · rrn_iv NULL · 마스킹 앞 7자리',
        stored && /^v1\./.test(stored.rrn_cipher) && stored.rrn_iv === null && stored.rrn_masked === '900101-1******',
        { iv: stored?.rrn_iv, masked: stored?.rrn_masked });
      check('P2', '★ 저장된 칸 어디에도 평문이 없다 · ERP 키로 풀면 원래 번호', !JSON.stringify(stored).includes(RRN) && decrypt(stored.rrn_cipher) === RRN);
      const detailA = await readCorpChangeDetail(c, a1);
      const detailJson = JSON.stringify(detailA.value);
      check('P3', '★ 응답(추가 · 상세)에 평문 · 암호문이 없다 — 마스킹만',
        !JSON.stringify(added.value).includes(RRN) && !detailJson.includes(RRN) && !detailJson.includes(stored.rrn_cipher) &&
          detailA.value.officers[0]?.rrnMasked === '900101-1******');
      const badRrn = await addOfficer(c, TA, a1, { name: '박', rrn: '900101-12345' });
      check('P4', '★ 주민번호 형식 오류는 저장 거절(400)', !badRrn.ok && badRrn.status === 400, badRrn);
      const keep = await editOfficer(c, TA, a1, o1, { name: '김임원', changeKind: 'REELECT', position: '대표이사', rrn: '' });
      const after = (await c.query(`SELECT rrn_cipher, change_kind FROM public.tb_s080_corp_change_officers WHERE id = $1`, [o1])).rows[0];
      check('P5', '수정 때 주민번호를 비우면 그대로', keep.ok && after.rrn_cipher === stored.rrn_cipher && after.change_kind === 'REELECT');

      // 다른 건의 임원 ID — 같은 회사 A 의 두 번째 임원변경 건
      await as(OP);
      const opA3 = await firstSave(OP, { changeType: 'OFFICER', orgId: ORG_A, orgCode: CODE_A, payload: {} });
      const a3 = opA3.value.id;
      createdIds.push(a3);
      await as(TA);
      const crossEdit = await editOfficer(c, TA, a3, o1, { name: '바꿔치기' });
      const crossDel = await removeOfficer(c, TA, a3, o1);
      const stillThere = (await c.query(`SELECT name FROM public.tb_s080_corp_change_officers WHERE id = $1`, [o1])).rows[0];
      check('I1', '★ 다른 건의 임원 ID 로 수정 · 삭제 불가(404) — 같은 회사 안에서도', !crossEdit.ok && crossEdit.status === 404 && !crossDel.ok && crossDel.status === 404 && stillThere?.name === '김임원', stillThere);

      await as(TB);
      const bEdit = await editOfficer(c, TB, a1, o1, { name: '남의회사' });
      const bDel = await removeOfficer(c, TB, a1, o1);
      const bAdd = await addOfficer(c, TB, a1, { name: '남의회사' });
      const bRaw = await c.query(`UPDATE public.tb_s080_corp_change_officers SET name = '직접' WHERE id = $1`, [o1]);
      check('I2', '★ 회사 B 는 A 의 임원을 못 읽고 못 고친다(404 · SQL 직접 0건)',
        [bEdit, bDel, bAdd].every((r) => !r.ok && r.status === 404) && bRaw.rowCount === 0);
      const bPayload = await saveCorpChangePayload(c, TB, a1, { payload: { resolutionDate: '2026-10-01' } });
      check('I3', '회사 B 는 A 의 변경 내용도 못 고친다(404)', !bPayload.ok && bPayload.status === 404);

      // ── 변경 내용 · 상태 ────────────────────────────────────────────────
      await as(TA);
      const savedP = await saveCorpChangePayload(c, TA, a1, { payload: { resolutionDate: '2026-10-01' } });
      check('S1', '서류작성중(P) — 변경 내용 저장', savedP.ok && savedP.value.payload.resolutionDate === '2026-10-01');
      for (const [code, st] of [['S2', 'A'], ['S3', 'C']]) {
        await as(OP);
        await c.query(`UPDATE public.tb_s080_corp_changes SET status = $2 WHERE id = $1`, [a1, st]);
        await as(TA);
        const p = await saveCorpChangePayload(c, TA, a1, { payload: { resolutionDate: '2026-10-02' } });
        const o = await addOfficer(c, TA, a1, { name: '늦은임원' });
        const e = await editOfficer(c, TA, a1, o1, { name: '늦은수정' });
        const d = await removeOfficer(c, TA, a1, o1);
        check(code, `★ ${st === 'A' ? '제출(A)' : '완료(C)'} 건 — 변경 내용 · 임원 추가 · 수정 · 삭제 모두 409`,
          [p, o, e, d].every((r) => !r.ok && r.status === 409), [p, o, e, d].map((r) => r.status));
      }

      // ── 기본정보 — 비입주사 법무 회사 정보는 단체 기준(건과 무관) ───────────────
      const targetOf = (s, orgId) => {
        const t = parseOrgTarget(orgId, undefined, s);
        return t.ok ? t.value : t;
      };
      const tenantInfo = await saveCompanyInfo(c, TA, targetOf(TA), { legalName: '덮어쓰기' });
      check('C1', '★ 입주사 단체 — 법무 회사 정보 저장 거절(409, ERP 에 쓰지 않는다)', !tenantInfo.ok && tenantInfo.status === 409);
      const d2 = await readCorpChangeDetail(c, a2);
      check('C2', '★ 입주사 기본정보 = ERP 읽기 · 대표주소 기본값 출처는 대표자 자택(사업장 주소 아님)',
        d2.ok && d2.value.company.isTenant && d2.value.company.displayName === '시험입주사A' &&
          d2.value.company.ceo.address === '서울 중구 자택로 1' && d2.value.company.memberTypeName === '주식회사',
        d2.value?.company);

      await as(TB);
      const bInfo = await saveCompanyInfo(c, TB, targetOf(TB), {
        legalName: '주식회사 시험비입주', ceoName: '박비입주', memberType: 'A', headZipCode: '06000', headAddress: '서울 강남구',
      });
      const badType = await saveCompanyInfo(c, TB, targetOf(TB), { memberType: 'P' });
      const lo = (await c.query(`SELECT org_id, legal_name, member_type FROM public.tb_s080_legal_orgs WHERE org_id = $1`, [ORG_B])).rows[0];
      check('C3', '비입주사 — 법무 회사 정보 만들기(회사당 1행, 건 없이 단체로) · 회사유형은 002 만', bInfo.ok && lo?.legal_name === '주식회사 시험비입주' && lo.member_type === 'A' && !badType.ok && badType.status === 400, lo);
      const d1 = await readCorpChangeDetail(c, b1);
      const bListed = (await listCorpChanges(c, ALL)).find((i) => i.id === b1);
      check('C4', '회사명 = 등기상 상호(상세 · 목록) · 회사유형 이름은 코드표',
        d1.ok && d1.value.company.displayName === '주식회사 시험비입주' && d1.value.company.memberTypeName === '유한회사' &&
          bListed?.companyName === '주식회사 시험비입주',
        { detail: d1.value?.company.displayName, list: bListed?.companyName });
      await as(TA);
      const aTargetsB = targetOf(TA, ORG_B);
      const aBypass = await attempt(() => saveCompanyInfo(c, TA, { orgId: ORG_B, orgCode: null }, { legalName: '남의회사' }));
      const aRawB = await c.query(`UPDATE public.tb_s080_legal_orgs SET legal_name = '직접' WHERE org_id = $1`, [ORG_B]);
      await as(OP);
      const stillB = (await c.query(`SELECT legal_name FROM public.tb_s080_legal_orgs WHERE org_id = $1`, [ORG_B])).rows[0];
      check('C5', '★ 회사 A 는 B 의 회사 정보를 못 고친다(코드 403 · 건너뛰어도 RLS 거절 · SQL 직접 0건)',
        aTargetsB.ok === false && aTargetsB.status === 403 && aBypass.threw !== null && /row-level security/i.test(aBypass.threw.message) &&
          aRawB.rowCount === 0 && stillB?.legal_name === '주식회사 시험비입주',
        { bypass: aBypass.threw?.message ?? '통과했다', legal: stillB?.legal_name });
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
