/**
 * 세무 설정(s050100010) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다.
 *
 * 사용: npm run verify:tax-settings   (= npx tsx scripts/verify-tax-settings.js)
 *
 * ★★ 표 구조 · RLS · 번호 CHECK 는 `scripts/verify-201.js` 가 잰다 — 여기서 다시 재지 않는다. 여기는 그 위의
 *    앱 처리다: 운영사 세션도 자기 단체만 · 저장 뒤 계좌 id 유지 · 빠진 줄 지우기 · 남의 단체 id 404 ·
 *    회사 세션 A 가 B 의 줄을 보거나 고칠 수 없음 · 코드 설명 · 회사 정보 출처.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — `packages/api/.env` 의 erp_app. 라우트가 쓰는 그 처리
 *    (`routes/taxSettings.ts` 의 `readTaxSettingsOp` · `saveTaxSettingsOp`)를 그대로 부른다.
 * ★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 단체는 verify-037 · 040 · 201 과 같은 대역(990001 · 990002).
 * ★ 회사 정보 예시(입주사 · 법무)는 개발 DB 의 기존 줄을 **읽기만** 한다 — 번호 값은 찍지 않고 자리수만 찍는다.
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { codeSetsOf, loadTaxCodes, readTaxSettingsOp, saveTaxSettingsOp } from '../packages/api/src/routes/taxSettings.ts';
import { parseTaxSettingsSave } from '../packages/shared/src/domain/tax-settings.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const ACTOR = 'v-tax';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const OPERATOR = { role: 'operator', companyId: null, orgId: ORG_A };
const tenant = (orgId) => ({ role: 'tenant', companyId: null, orgId });

/** 같은 트랜잭션 안에서 실패할 수 있는 일 — 실패하면 그 자리까지만 되돌린다. */
async function attempt(c, fn) {
  await c.query('SAVEPOINT s');
  try {
    const value = await fn();
    await c.query('RELEASE SAVEPOINT s');
    return { value, code: null };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    return { value: null, code: e.code ?? e.message };
  }
}

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const codes = codeSetsOf(await loadTaxCodes(c));
      const parse = (body) => {
        const r = parseTaxSettingsSave(body, codes);
        if (!r.ok) throw new Error(`시험 본문이 틀렸다: ${JSON.stringify(r.errors)}`);
        return r.value;
      };
      const rowsOf = async (orgId) =>
        (await c.query(`SELECT id, alias FROM public.tb_s050_fin_accounts WHERE org_id = $1 ORDER BY kind, sort_order`, [orgId])).rows;

      // ── 두 단체에 저장 (운영사 스코프) ──
      const saveA = await saveTaxSettingsOp(c, ORG_A, parse({
        bizType: 'C', withholdingCycle: 'H', unusedKinds: ['SOCIAL'],
        taxEmails: [{ name: '김세무', email: 'tax@example.com' }],
        finAccounts: [
          { kind: 'B', bankCode: '004', number: '123-456-7890', alias: 'A 주거래' },
          { kind: 'B', bankCode: '081', number: '98765432101', alias: 'A 급여' },
          { kind: 'C', cardCoCode: 'KB', number: '1234', alias: 'A 법인카드' },
        ],
      }), ACTOR);
      const saveB = await saveTaxSettingsOp(c, ORG_B, parse({
        bizType: 'I', withholdingCycle: 'M', unusedKinds: [], taxEmails: [],
        finAccounts: [{ kind: 'C', cardCoCode: 'WOORI', number: '5678', alias: 'B 카드' }],
      }), ACTOR);
      check('T1', '두 단체 저장 — 계좌번호는 숫자만 저장', saveA.ok && saveB.ok &&
        saveA.data.finAccounts.find((a) => a.alias === 'A 주거래')?.number === '1234567890', saveA.ok ? saveA.data.finAccounts.map((a) => a.number) : saveA);

      // ── ★ 운영사 세션도 자기 단체 줄만 ──
      const readA = await readTaxSettingsOp(c, ORG_A);
      const aIds = (await rowsOf(ORG_A)).map((r) => r.id).sort().join();
      const bIds = (await rowsOf(ORG_B)).map((r) => r.id);
      check('T2', '★★ 운영사 스코프로 A 를 읽으면 A 줄만(B 의 계좌 · 카드 · 설정이 섞이지 않는다)',
        readA.finAccounts.map((a) => a.id).sort().join() === aIds && readA.finAccounts.length === 3 &&
        !readA.finAccounts.some((a) => bIds.includes(a.id)) && readA.settings.bizType === 'C' && readA.settings.withholdingCycle === 'H',
        { 읽음: readA.finAccounts.map((a) => a.alias), 설정: readA.settings.bizType });

      // ── 저장 뒤 id 유지 · 빠진 줄 지우기 ──
      const keep = readA.finAccounts.find((a) => a.alias === 'A 주거래');
      const dropped = readA.finAccounts.find((a) => a.alias === 'A 급여');
      const card = readA.finAccounts.find((a) => a.alias === 'A 법인카드');
      const resave = await saveTaxSettingsOp(c, ORG_A, parse({
        bizType: 'C', withholdingCycle: 'M', unusedKinds: [], taxEmails: [],
        finAccounts: [
          { kind: 'C', cardCoCode: 'KB', number: '1234', alias: 'A 법인카드', id: card.id, isActive: false },
          { id: keep.id, kind: 'B', bankCode: '004', number: '1234567890', alias: 'A 주거래(고침)' },
          { kind: 'B', bankCode: '020', number: '11122233344', alias: 'A 새 계좌' },
        ],
      }), ACTOR);
      const afterA = await rowsOf(ORG_A);
      check('T3', '★ 저장 뒤 있는 줄의 id 가 그대로 · 값은 고쳐진다',
        resave.ok && afterA.some((r) => r.id === keep.id && r.alias === 'A 주거래(고침)') && afterA.some((r) => r.id === card.id),
        afterA.map((r) => r.alias));
      check('T4', '★ 보낸 목록에 없는 줄은 지워지고 새 줄은 새 id 로 들어간다',
        !afterA.some((r) => r.id === dropped.id) && afterA.length === 3 &&
        afterA.some((r) => r.alias === 'A 새 계좌' && r.id !== keep.id && r.id !== dropped.id), afterA.map((r) => r.alias));
      const cardRow = resave.ok ? resave.data.finAccounts.find((a) => a.id === card.id) : null;
      check('T5', '사용 안 함 · 원천세 주기 · 빈 메일 목록이 저장된다',
        resave.ok && cardRow?.isActive === false && resave.data.settings.withholdingCycle === 'M' && resave.data.settings.taxEmails.length === 0,
        { card: cardRow?.isActive, cycle: resave.ok && resave.data.settings.withholdingCycle });

      // ── 남의 단체 id 는 404 — 아무것도 쓰지 않는다 ──
      const bBefore = await rowsOf(ORG_B);
      const aBefore = await rowsOf(ORG_A);
      const steal = await saveTaxSettingsOp(c, ORG_A, parse({
        bizType: 'I', withholdingCycle: 'H', unusedKinds: [], taxEmails: [],
        finAccounts: [{ id: bBefore[0].id, kind: 'C', cardCoCode: 'KB', number: '0000', alias: '가로챔' }],
      }), ACTOR);
      check('T6', '★ 운영사 세션이라도 B 의 계좌 id 를 A 저장에 실으면 404 · A · B 모두 그대로',
        !steal.ok && steal.status === 404 &&
        JSON.stringify(await rowsOf(ORG_B)) === JSON.stringify(bBefore) && JSON.stringify(await rowsOf(ORG_A)) === JSON.stringify(aBefore) &&
        (await readTaxSettingsOp(c, ORG_A)).settings.bizType === 'C', steal);
      const ghost = await saveTaxSettingsOp(c, ORG_A, parse({
        bizType: 'C', withholdingCycle: 'M', unusedKinds: [], taxEmails: [],
        finAccounts: [{ id: 'v-tax-none', kind: 'B', bankCode: '004', number: '1234567890' }],
      }), ACTOR);
      check('T7', '없는 id 도 404', !ghost.ok && ghost.status === 404, ghost);

      // ── 회사 세션 A 는 B 의 줄을 보거나 고칠 수 없다 ──
      await applyCompanyScope(c, tenant(ORG_A));
      const tenantSeesB = await readTaxSettingsOp(c, ORG_B);
      check('T8', '★ 회사 A 스코프로 B 를 읽어도 비어 있다(RLS) — 설정 없음 · 계좌 0',
        tenantSeesB.settings.saved === false && tenantSeesB.finAccounts.length === 0, tenantSeesB.settings);
      const tenantWritesB = await attempt(c, () => saveTaxSettingsOp(c, ORG_B, parse({
        bizType: 'C', withholdingCycle: 'M', unusedKinds: [], taxEmails: [],
        finAccounts: [{ kind: 'B', bankCode: '004', number: '1234567890' }],
      }), ACTOR));
      check('T9', '★ 회사 A 스코프로 B 에 저장하면 DB 가 막는다(42501)', tenantWritesB.code === '42501', tenantWritesB.code ?? tenantWritesB.value);
      const tenantSteal = await saveTaxSettingsOp(c, ORG_A, parse({
        bizType: 'C', withholdingCycle: 'M', unusedKinds: [], taxEmails: [],
        finAccounts: [{ id: bBefore[0].id, kind: 'C', cardCoCode: 'KB', number: '0000' }],
      }), ACTOR);
      check('T10', '★ 회사 A 가 B 의 계좌 id 를 실으면 404', !tenantSteal.ok && tenantSteal.status === 404, tenantSteal);
      const tenantReadA = await readTaxSettingsOp(c, ORG_A);
      check('T11', '회사 A 스코프로 자기 단체는 읽힌다', tenantReadA.settings.saved && tenantReadA.finAccounts.length === 3,
        tenantReadA.finAccounts.length);

      await applyCompanyScope(c, OPERATOR);
      check('T12', 'B 의 줄은 처음 그대로', JSON.stringify(await rowsOf(ORG_B)) === JSON.stringify(bBefore));

      // ── 코드 · 회사 정보 ──
      const wh = readA.codes.withholdingCycles;
      check('T13', '코드 — 이름과 설명(원천세 주기 안내 문구) · 은행 3 · 카드사 2 · 자료 종류 8',
        wh.length === 2 && wh.every((o) => o.description) && readA.codes.banks.length === 3 &&
        readA.codes.cardCompanies.length === 2 && readA.codes.kinds.length === 8, wh);
      check('T14', '회사 정보 — 줄이 없는 단체는 source none · 번호 비움(회사명은 라우트가 세션 값으로)',
        readA.company.source === 'none' && readA.company.bizNumber === null && readA.company.corpNumber === null, readA.company);

      const tenantOrg = (await c.query(
        `SELECT link_s020_org_id o FROM public.tb_s080_companies WHERE link_s020_org_id IS NOT NULL ORDER BY link_s020_org_id LIMIT 1`)).rows[0]?.o;
      const legalOrg = (await c.query(
        `SELECT lo.org_id o FROM public.tb_s080_legal_orgs lo
          WHERE NOT EXISTS (SELECT 1 FROM public.tb_s080_companies co WHERE co.link_s020_org_id = lo.org_id)
          ORDER BY lo.org_id LIMIT 1`)).rows[0]?.o;
      const shape = (co) => ({ source: co.source, name: co.name ? '있음' : null,
        bizNumber: co.bizNumber ? `${co.bizNumber.length}자리 숫자` : null, corpNumber: co.corpNumber ? `${co.corpNumber.length}자리 숫자` : null });
      if (tenantOrg) {
        const co = (await readTaxSettingsOp(c, tenantOrg)).company;
        check('T15', '회사 정보 — 입주사 단체는 source tenant · 번호는 숫자만',
          co.source === 'tenant' && [co.bizNumber, co.corpNumber].every((v) => v === null || /^\d+$/.test(v)), { org: tenantOrg, ...shape(co) });
      } else check('T15', '회사 정보 — 입주사 단체 예시', false, '개발 DB 에 연결된 입주사가 없다');
      if (legalOrg) {
        const co = (await readTaxSettingsOp(c, legalOrg)).company;
        check('T16', '회사 정보 — 법무 비입주사 단체는 source legal · 번호는 숫자만',
          co.source === 'legal' && [co.bizNumber, co.corpNumber].every((v) => v === null || /^\d+$/.test(v)), { org: legalOrg, ...shape(co) });
      } else check('T16', '회사 정보 — 법무 비입주사 예시', false, '개발 DB 에 법무 회사 정보 줄이 없다');
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const n = async (t) =>
        (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1::int[])`, [[ORG_A, ORG_B]])).rows[0].n;
      const s = await n('tb_s050_settings');
      const f = await n('tb_s050_fin_accounts');
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', s === 0 && f === 0, `설정 ${s} · 계좌 카드 ${f}`);
    } finally {
      await c.query('ROLLBACK');
    }
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
