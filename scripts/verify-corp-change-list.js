/**
 * 법인변경 목록(s040200010, 2단계) 검증 — **RLS 를 거쳐** 무엇이 보이는가.
 *
 * 사용: npx tsx scripts/verify-corp-change-list.js
 *
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — `packages/api/.env` 의 erp_app 이다. RLS 는
 *    erp_app 으로 접속해서만 잴 수 있다(postgres 는 bypassrls — `verify-037.js` 머리말).
 * ★★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다.
 *    넣을 때는 운영사 스코프, 셀 때는 `applyCompanyScope(scopeOfSession(세션))` 으로 스코프를
 *    바꿔 가며 **라우트가 쓰는 그 함수**(`listCorpChanges`)를 부른다.
 *
 * 시험 단체(실제 삐용 번호 · mock 9001~9199 와 겹치지 않는 대역):
 *   990001 — 입주사 A (시험 입주사 줄을 만들어 link_s020_org_id 로 잇는다)
 *   990002 — 비입주사 B (법무 회사 정보에 대표자만)
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope, scopeOfSession } from '../packages/api/src/db/withCompanyScope.ts';
import { listCorpChanges } from '../packages/api/src/db/corpChanges.ts';
import { corpChangeCompanyLabel } from '../packages/shared/src/domain/corp-change-list.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const PREFIX = 'v-ccl-';

const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const ALL = { from: null, to: null, changeType: null, status: null, tenancy: null, includeCancelled: false };

const session = (role, s020OrgId, companyId = null) => ({ role, s020OrgId, companyId });

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      // ── 넣기 — 운영사 스코프 ──────────────────────────────────────────
      await applyCompanyScope(c, scopeOfSession(session('operator', 1)));
      const operatorId = (await c.query(`SELECT operator_id FROM public.tb_s080_tenant010 ORDER BY 1 LIMIT 1`)).rows[0].operator_id;
      const build = (await c.query(`SELECT build_id FROM public.tb_s080_buildings ORDER BY 1 LIMIT 1`)).rows[0].build_id;
      const companyA = `${PREFIX}company-a`;
      await c.query(
        `INSERT INTO public.tb_s080_companies (company_id, build_id, company_name, ceo_name, updated_at, link_s020_org_id)
         VALUES ($1, $2, '시험입주사A', '김입주', now(), $3)`,
        [companyA, build, ORG_A],
      );
      await c.query(`INSERT INTO public.tb_s080_legal_orgs (org_id, ceo_name) VALUES ($1, '박비입주')`, [ORG_B]);

      const rows = [
        // id 끝자리, 단체, 코드, 구분, 상태, 등록 시각
        ['a1', ORG_A, null, 'NAME', 'P', '2026-10-01 09:00'],
        ['a2', ORG_A, null, 'HQ', 'E', '2026-10-05 23:59:59.999'],
        ['ax', ORG_A, null, 'OFFICER', 'X', '2026-10-06 10:00'],
        ['b1', ORG_B, 'Z96', 'CEO_ADDR', 'A', '2026-10-06 00:00'],
        ['b2', ORG_B, null, 'PURPOSE', 'C', '2026-10-09 12:00'],
      ];
      for (const [k, org, code, type, st, at] of rows) {
        await c.query(
          `INSERT INTO public.tb_s080_corp_changes (id, change_type, status, created_at, updated_at, operator_id, org_id, org_code)
           VALUES ($1, $2, $3, $4::timestamp, now(), $5, $6, $7)`,
          [`${PREFIX}${k}`, type, st, at, operatorId, org, code],
        );
      }

      /** 이 스코프로 목록을 본다 — 시험 행만 남긴다(다른 자료가 섞여도 판정이 흔들리지 않게). */
      const listAs = async (s, f = {}) => {
        await applyCompanyScope(c, scopeOfSession(s));
        const items = await listCorpChanges(c, { ...ALL, ...f });
        return items.filter((i) => i.id.startsWith(PREFIX));
      };
      const ids = (items) => items.map((i) => i.id.slice(PREFIX.length)).sort().join(',');

      // ── RLS ─────────────────────────────────────────────────────────
      const opAll = await listAs(session('operator', 1), { includeCancelled: true });
      check('L1', '★ 운영사 — 두 회사 건 전부(취소 포함)', ids(opAll) === 'a1,a2,ax,b1,b2', ids(opAll));

      const aAll = await listAs(session('tenant', ORG_A, companyA), { includeCancelled: true });
      check('L2', '★ 회사 A 세션 — A 건만', ids(aAll) === 'a1,a2,ax', ids(aAll));

      const bAll = await listAs(session('tenant', ORG_B, null), { includeCancelled: true });
      check('L3', '★ 회사 B(비입주사, 회사 번호 없음) 세션 — B 건만', ids(bAll) === 'b1,b2', ids(bAll));

      await applyCompanyScope(c, { role: 'tenant', companyId: companyA }); // 단체 ID 를 빠뜨린 스코프
      const noOrg = (await listCorpChanges(c, { ...ALL, includeCancelled: true })).filter((i) => i.id.startsWith(PREFIX));
      check('L4', '단체 ID 없는 회사 스코프 — 0건(닫힌 쪽)', noOrg.length === 0, ids(noOrg));

      // ── 딱지 · 회사 · 대표자 ────────────────────────────────────────
      const a1 = opAll.find((i) => i.id === `${PREFIX}a1`);
      const b1 = opAll.find((i) => i.id === `${PREFIX}b1`);
      const b2 = opAll.find((i) => i.id === `${PREFIX}b2`);
      check('T1', '★ 입주사 딱지 — link_s020_org_id 로 판정', a1.isTenant === true && b1.isTenant === false,
        { a1: a1.isTenant, b1: b1.isTenant });
      check('T2', '입주사 — 회사명 · 대표자를 ERP 입주사 정보에서 읽는다',
        a1.companyName === '시험입주사A' && a1.ceoName === '김입주', { name: a1.companyName, ceo: a1.ceoName });
      check('T3', '비입주사 — 대표자는 법무 회사 정보, 회사명은 없다', b1.companyName === null && b1.ceoName === '박비입주',
        { name: b1.companyName, ceo: b1.ceoName });
      check('T4', '회사 열 — 회사명 → 단체코드 → 「단체 {ID}」',
        corpChangeCompanyLabel(a1) === '시험입주사A' && corpChangeCompanyLabel(b1) === 'Z96' &&
          corpChangeCompanyLabel(b2) === `단체 ${ORG_B}`,
        [corpChangeCompanyLabel(a1), corpChangeCompanyLabel(b1), corpChangeCompanyLabel(b2)]);
      const aSees = aAll.find((i) => i.id === `${PREFIX}a1`);
      check('T5', '회사 A 세션에서도 자기 입주사 딱지 · 회사명이 보인다', aSees.isTenant && aSees.companyName === '시험입주사A');

      // ── 필터 ────────────────────────────────────────────────────────
      const op = session('operator', 1);
      const def = await listAs(op);
      check('F1', '★ 기본 — 취소 제외', ids(def) === 'a1,a2,b1,b2', ids(def));
      const ten = await listAs(op, { tenancy: 'tenant' });
      check('F2', '입주 여부 — 입주사', ids(ten) === 'a1,a2', ids(ten));
      const non = await listAs(op, { tenancy: 'nontenant' });
      check('F3', '입주 여부 — 비입주사', ids(non) === 'b1,b2', ids(non));
      const st = await listAs(op, { status: 'E' });
      check('F4', '진행 상태 — E', ids(st) === 'a2', ids(st));
      const ty = await listAs(op, { changeType: 'OFFICER', includeCancelled: true });
      check('F5', '변경 구분 — 임원(취소 건 포함)', ids(ty) === 'ax', ids(ty));
      const tyNoX = await listAs(op, { changeType: 'OFFICER' });
      check('F6', '변경 구분 — 임원(취소 제외면 0건)', tyNoX.length === 0, ids(tyNoX));
      const day = await listAs(op, { from: '2026-10-05', to: '2026-10-05' });
      check('F7', '★ 작업일자 하루 — 23:59:59.999 까지 들어온다', ids(day) === 'a2', ids(day));
      const range = await listAs(op, { from: '2026-10-06', to: '2026-10-09', includeCancelled: true });
      check('F8', '작업일자 범위 — 끝 날 포함', ids(range) === 'ax,b1,b2', ids(range));
      const combo = await listAs(op, { from: '2026-10-01', to: '2026-10-31', tenancy: 'nontenant', status: 'A' });
      check('F9', '조합 — 기간 · 비입주사 · 서류제출', ids(combo) === 'b1', ids(combo));
      const aNon = await listAs(session('tenant', ORG_A, companyA), { tenancy: 'nontenant' });
      check('F10', '회사 A 세션 + 비입주사 필터 — 0건(RLS 와 필터가 함께 건다)', aNon.length === 0, ids(aNon));

      const order = def.map((i) => i.id.slice(PREFIX.length)).join(',');
      check('F11', '새 건이 위', order === 'b2,b1,a2,a1', order);
      check('F12', '등록일은 YYYY-MM-DD', def.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.createdOn)), def.map((i) => i.createdOn));
    } finally {
      await c.query('ROLLBACK');
    }

    // ── 남은 것 없음 ──────────────────────────────────────────────────
    await c.query('BEGIN');
    await applyCompanyScope(c, scopeOfSession(session('operator', 1)));
    const left = (await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_corp_changes WHERE id LIKE $1)::int
            + (SELECT count(*) FROM public.tb_s080_companies WHERE company_id LIKE $1)::int
            + (SELECT count(*) FROM public.tb_s080_legal_orgs WHERE org_id IN ($2, $3))::int AS n`,
      [`${PREFIX}%`, ORG_A, ORG_B],
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
