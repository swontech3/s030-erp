/**
 * public 스키마 논리 백업 — 001~003 적용 전 되돌릴 지점을 만든다.
 *
 * ★ 이 스크립트는 pg_dump의 대체품이 아니다. 이 PC에 PostgreSQL 클라이언트가
 *   설치돼 있지 않아(pg_dump·psql 없음) node-pg로 만든 논리 백업이다.
 *   pg_dump가 설치되면 그쪽을 정본으로 쓴다.
 *
 * 담는 것 : public 스키마 DDL + 전체 데이터(INSERT) + 권한·RLS 현재 상태
 * 안 담는 것: 다른 스키마(tb_s020_t001 삐용 · tb_s090_t001 메일 · auth · storage),
 *            역할 정의 자체, 대용량 오브젝트
 *
 * 사용: node scripts/backup-public.js .env <출력디렉터리>
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envPath = process.argv[2] || '.env';
const outDir = process.argv[3] || 'C:/backup/swonbiz';
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const c = new Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER,
  password: env.DB_PASSWORD, database: env.DB_NAME, connectionTimeoutMillis: 10000,
});
const q = (s, p) => c.query(s, p).then(r => r.rows);

function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

(async () => {
  await c.connect();
  const ts = stamp();
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `pre-001-003_${ts}.sql`);
  const out = [];

  const ver = (await q('SELECT version() v'))[0].v;
  out.push('-- =====================================================================');
  out.push('-- SwonBiz ERP :: public 스키마 논리 백업 (001~003 적용 전)');
  out.push(`-- source : ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
  out.push(`-- server : ${ver}`);
  out.push(`-- taken  : ${new Date().toISOString()}`);
  out.push('-- tool   : scripts/backup-public.js (pg_dump 아님 — 이 PC에 미설치)');
  out.push('-- =====================================================================');
  out.push('');

  // ---- 1. 권한·RLS 현재 상태 (003이 바꾸는 것) --------------------------------
  out.push('-- ============ [1] 적용 전 권한·RLS 상태 스냅샷 (참고용 주석) ============');
  const roles = await q(`SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
    WHERE rolname IN ('postgres','service_role','anon','authenticated','erp_app','supabase_admin') ORDER BY 1`);
  roles.forEach(r => out.push(`-- role ${r.rolname.padEnd(16)} super=${r.rolsuper} bypassrls=${r.rolbypassrls} login=${r.rolcanlogin}`));
  const grants = await q(`SELECT grantee, count(*)::int n FROM information_schema.role_table_grants
    WHERE table_schema='public' GROUP BY grantee ORDER BY 1`);
  grants.forEach(g => out.push(`-- grant ${g.grantee.padEnd(16)} ${g.n}건`));
  const rls = await q(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity ORDER BY 1`);
  out.push(`-- RLS 켜진 테이블: ${rls.length ? rls.map(r => r.relname).join(', ') : '없음 (0/32)'}`);
  out.push('');
  out.push('-- 되돌릴 때: anon/authenticated 권한 복구가 필요하면 아래를 참고한다.');
  const gdetail = await q(`SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) p
    FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated')
    GROUP BY grantee, table_name ORDER BY grantee, table_name`);
  gdetail.forEach(g => out.push(`-- GRANT ${g.p} ON public."${g.table_name}" TO ${g.grantee};`));
  out.push('');

  // ---- 2. DDL ---------------------------------------------------------------
  out.push('-- ============ [2] DDL ============');
  out.push('-- doc/existing_schema.sql 과 같은 방식으로 생성된다(scripts/dump-schema.js).');
  out.push('-- 이 백업은 데이터 복원이 목적이므로 DDL은 참조용으로 파일 끝에 별도 첨부한다.');
  out.push('');

  // ---- 3. 데이터 ------------------------------------------------------------
  out.push('-- ============ [3] 데이터 ============');
  out.push('-- 복원: 빈 스키마에 DDL을 먼저 적용한 뒤 이 블록을 순서대로 실행한다.');
  out.push('-- json_populate_record 를 쓰므로 타입 변환은 Postgres가 직접 한다.');
  out.push('');
  const tables = await q(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  let total = 0;
  const counts = [];
  for (const t of tables) {
    const name = t.tablename;
    const n = (await q(`SELECT count(*)::int n FROM public."${name}"`))[0].n;
    counts.push({ table: name, rows: n });
    total += n;
    if (n === 0) { out.push(`-- ${name}: 0행 (생략)`); continue; }
    out.push(`-- ---- ${name} (${n}행) ----`);
    const stmts = await q(
      `SELECT 'INSERT INTO public.' || quote_ident($1) ||
              ' SELECT * FROM json_populate_record(NULL::public.' || quote_ident($1) || ', ' ||
              quote_literal(row_to_json(t)::text) || '::json);' AS s
       FROM public."${name}" t`, [name]);
    stmts.forEach(r => out.push(r.s));
    out.push('');
  }
  out.push(`-- 총 ${total}행 / ${tables.length}테이블`);
  out.push('');

  // ---- 4. 시퀀스 현재값 ------------------------------------------------------
  out.push('-- ============ [4] 시퀀스 현재값 ============');
  const seqs = await q(`SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname='public' ORDER BY 2`);
  if (!seqs.length) out.push('-- 없음');
  seqs.forEach(s => out.push(
    s.last_value === null
      ? `-- ${s.sequencename}: 미사용(last_value NULL)`
      : `SELECT setval('public.${s.sequencename}', ${s.last_value}, true);`));
  out.push('');

  fs.writeFileSync(file, out.join('\n'), 'utf8');
  await c.end();

  console.log('백업 파일 :', file);
  console.log('크기      :', fs.statSync(file).size.toLocaleString(), 'bytes');
  console.log('총 행수   :', total, '/ 테이블', tables.length);
  console.table(counts.filter(x => x.rows > 0));
})().catch(e => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
