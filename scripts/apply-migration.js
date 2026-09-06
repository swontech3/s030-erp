/**
 * 마이그레이션 파일 1개를 적용한다. psql이 없는 환경용.
 * 파일 안에 BEGIN/COMMIT이 들어 있으므로 파일 전체를 한 번에 보낸다.
 * 사용: node scripts/apply-migration.js .env supabase/migrations/001_add_columns.sql
 */
const fs = require('fs');
const { Client } = require('pg');
const env = Object.fromEntries(
  fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const file = process.argv[3];
const sql = fs.readFileSync(file, 'utf8');
const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
c.on('notice', n => console.log('  [notice]', n.message));
(async () => {
  await c.connect();
  const who = await c.query('SELECT current_user, current_database()');
  console.log(`적용: ${file}`);
  console.log(`접속: ${who.rows[0].current_user}@${env.DB_HOST}:${env.DB_PORT}/${who.rows[0].current_database}`);
  const t0 = Date.now();
  await c.query(sql);
  console.log(`✔ 적용 완료 (${Date.now() - t0}ms)`);
  await c.end();
})().catch(async e => {
  console.error('✘ 적용 실패:', e.message);
  if (e.position) console.error('  position:', e.position);
  if (e.detail) console.error('  detail  :', e.detail);
  if (e.hint) console.error('  hint    :', e.hint);
  try { await c.end(); } catch {}
  process.exit(1);
});
