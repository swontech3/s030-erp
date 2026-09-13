/**
 * Mock 계정용 조직 연결 시드 — 개발 DB 전용.
 *
 * MockBbiyongAuth 의 `tenant@test.com` 은 삐용 orgId 9001 이다. 그 값이
 * `tb_s080_companies.link_s020_org_id` 에 걸려 있어야 세션의 companyId 가 해석된다
 * (지시서 3장 "req.session.companyId 가 link_s020_org_id 역조회로 정확히 해석됨").
 *
 * ★ `noaccess@test.com`(orgId 9002)은 **일부러 연결하지 않는다.**
 *   companyId = null 이 예외가 아니라 빈 스코프(목록 0건)라는 것을 확인하는 계정이다.
 *
 * 멱등하다. 이미 연결돼 있으면 아무것도 하지 않는다.
 * 되돌리기: UPDATE tb_s080_companies SET link_s020_org_id = NULL WHERE link_s020_org_id = 9001;
 *
 * 사용: node scripts/seed-mock-link.js .env
 */
const fs = require('fs');
const { Client } = require('pg');

const MOCK_TENANT_ORG_ID = 9001;
const TARGET_COMPANY_NAME = '주식회사 비앤케이넷'; // MockBbiyongAuth 의 orgName 과 같아야 화면이 어색하지 않다

const env = Object.fromEntries(
  fs.readFileSync(process.argv[2] || '.env', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });

(async () => {
  await c.connect();
  const existing = await c.query(
    'SELECT company_id, company_name FROM tb_s080_companies WHERE link_s020_org_id = $1', [MOCK_TENANT_ORG_ID]);
  if (existing.rowCount > 0) {
    console.log(`이미 연결됨: org ${MOCK_TENANT_ORG_ID} → ${existing.rows[0].company_name} (${existing.rows[0].company_id})`);
    return c.end();
  }

  let target = await c.query(
    'SELECT company_id, company_name FROM tb_s080_companies WHERE company_name = $1 LIMIT 1', [TARGET_COMPANY_NAME]);

  // ★ 007(시험 데이터 정리)로 tb_s080_companies 가 비었다. 그전에는 레거시 데이터에
  //   이 회사가 있어서 "링크만" 하면 됐지만, 이제는 없으면 만들어야 한다.
  //   개발 DB 전용 시드다 — 업무 데이터가 아니라 Mock 계정을 띄우기 위한 자리다.
  if (target.rowCount === 0) {
    const build = await c.query('SELECT build_id FROM tb_s080_buildings LIMIT 1');
    if (build.rowCount === 0) {
      console.error('✘ 건물이 없다 — 건물·호실 데이터부터 있어야 한다');
      process.exitCode = 1;
      return c.end();
    }
    await c.query(
      `INSERT INTO tb_s080_companies
         (company_id, build_id, company_name, status, is_non_tenant, created_at, updated_at, created_by)
       VALUES ($1, $2, $3, 'O', false, now(), now(), 'seed-mock-link')`,
      ['MOCK_TENANT_9001', build.rows[0].build_id, TARGET_COMPANY_NAME]);
    console.log(`＋ 대상 회사가 없어 만들었다: ${TARGET_COMPANY_NAME} (MOCK_TENANT_9001)`);
    target = await c.query(
      'SELECT company_id, company_name FROM tb_s080_companies WHERE company_name = $1 LIMIT 1', [TARGET_COMPANY_NAME]);
  }

  const { company_id, company_name } = target.rows[0];
  await c.query(
    `UPDATE tb_s080_companies
        SET link_s020_org_id = $1, link_linked_at = now(), link_linked_by = 'seed-mock-link'
      WHERE company_id = $2`, [MOCK_TENANT_ORG_ID, company_id]);
  console.log(`✔ 연결: org ${MOCK_TENANT_ORG_ID} → ${company_name} (${company_id})`);
  await c.end();
})().catch(async e => {
  console.error('✘ 실패:', e.message);
  try { await c.end(); } catch {}
  process.exit(1);
});
