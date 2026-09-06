/**
 * 권한 점검 — public 스키마에 anon·authenticated 권한이 하나라도 남아 있으면 실패.
 *
 * 왜 필요한가: Supabase 대시보드·Studio 에서 테이블을 만들면 생성자가
 * supabase_admin 이 되고, supabase_admin 의 기본 권한(ALTER DEFAULT PRIVILEGES)은
 * 지금도 anon·authenticated 에 전권을 준다. 그 테이블은 만들어지는 즉시
 * anon 키로 PostgREST 를 통해 밖에서 읽힌다.
 * 003 은 postgres 가 만든 객체만 막을 수 있다 — 나머지는 이 점검으로 잡는다.
 *
 * 규약: 마이그레이션은 항상 postgres 역할로 적용한다
 *       (doc/SWONBIZ_PROJECT_STRUCTURE.md §9). 이 스크립트는 그 규약이
 *       지켜졌는지 확인하는 물건이다. 페이즈마다 돌린다.
 *
 * 사용: node scripts/check-grants.js [.env]
 * 종료코드: 0 = 깨끗함 / 1 = 권한 남아 있음 / 2 = 실행 실패
 */
const fs = require('fs');
const { Client } = require('pg');

const env = Object.fromEntries(
  fs.readFileSync(process.argv[2] || '.env', 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const c = new Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER,
  password: env.DB_PASSWORD, database: env.DB_NAME,
});
const q = (s, p) => c.query(s, p).then(r => r.rows);

(async () => {
  await c.connect();

  const tables = await q(`SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS priv
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee IN ('anon','authenticated')
    GROUP BY 1,2 ORDER BY 1,2`);

  const seqs = await q(`SELECT object_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS priv
    FROM information_schema.usage_privileges
    WHERE object_schema='public' AND object_type='SEQUENCE' AND grantee IN ('anon','authenticated')
    GROUP BY 1,2 ORDER BY 1,2`);

  // supabase_admin 이 만들 테이블에 걸릴 기본 권한 — 구멍이 열려 있는지
  const defacl = await q(`SELECT pg_get_userbyid(d.defaclrole) AS creator, array_to_string(d.defaclacl,' ') AS acl
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
    WHERE n.nspname='public' AND d.defaclobjtype='r'`);
  const openDefault = defacl.filter(r => /(^|\s)(anon|authenticated)=/.test(r.acl)).map(r => r.creator);

  const total = (await q(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`))[0].n;

  if (tables.length === 0 && seqs.length === 0) {
    console.log(`OK  public ${total}테이블 — anon·authenticated 권한 0건`);
  } else {
    console.log(`NG  anon·authenticated 권한이 남아 있다 (테이블 ${tables.length}건, 시퀀스 ${seqs.length}건)`);
    for (const r of tables) console.log(`    ${r.grantee.padEnd(14)} ${r.table_name} : ${r.priv}`);
    for (const r of seqs) console.log(`    ${r.grantee.padEnd(14)} ${r.object_name} (시퀀스) : ${r.priv}`);
    console.log('    → 이 객체를 누가 만들었는지 확인할 것. supabase_admin(대시보드·Studio)이면 규약 위반이다.');
    console.log('    → 조치: REVOKE ALL ON <테이블> FROM anon, authenticated;');
  }

  if (openDefault.length) {
    console.log(`WARN 기본 권한이 열려 있는 생성자: ${openDefault.join(', ')}`);
    console.log('     이 역할이 public 에 테이블을 만들면 anon·authenticated 가 자동으로 전권을 받는다.');
    console.log('     (003 은 postgres 것만 닫았다. supabase_admin 것은 플랫폼 소유라 건드리지 않는다 — 이 점검으로 잡는다.)');
  }

  await c.end();
  process.exit(tables.length + seqs.length > 0 ? 1 : 0);
})().catch(e => { console.error('CHECK FAILED:', e.message); process.exit(2); });
