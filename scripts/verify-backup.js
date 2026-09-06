/**
 * 백업 복원 드릴 — 백업 파일이 실제로 복원되는지 확인한다.
 *
 * 임시 스키마를 만들어 DDL(외래키 제외)을 세우고, 백업 파일의 INSERT를
 * 그 스키마로 돌려 넣은 뒤 원본과 행수·내용 체크섬을 대조한다. 끝나면 DROP.
 * public 스키마는 읽기만 한다.
 *
 * 사용: node scripts/verify-backup.js .env <백업.sql>
 */
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');

const envPath = process.argv[2];
const bkPath = process.argv[3];
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = (s, p) => c.query(s, p).then(r => r.rows);
const id = n => '"' + n.replace(/"/g, '""') + '"';
const SCHEMA = 'bk_verify_' + Date.now().toString(36);

(async () => {
  await c.connect();
  console.log('임시 스키마:', SCHEMA);
  await c.query(`CREATE SCHEMA ${id(SCHEMA)}`);
  try {
    // 1) DDL — 컬럼 + PK/UNIQUE/CHECK. 외래키는 제외(적재 순서 의존을 피한다)
    const tables = await q(`SELECT c.relname, c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`);
    for (const t of tables) {
      const cols = await q(`SELECT a.attname, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull,
          pg_get_expr(d.adbin,d.adrelid) def, a.attidentity
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [t.oid]);
      const lines = cols.map(x => {
        let s = '  ' + id(x.attname) + ' ' + x.typ;
        if (x.attidentity) s += ' GENERATED ' + (x.attidentity === 'a' ? 'ALWAYS' : 'BY DEFAULT') + ' AS IDENTITY';
        else if (x.def && !/nextval\(/.test(x.def)) s += ' DEFAULT ' + x.def;
        if (x.attnotnull) s += ' NOT NULL';
        return s;
      });
      await c.query(`CREATE TABLE ${id(SCHEMA)}.${id(t.relname)} (\n${lines.join(',\n')}\n)`);
    }
    console.log('테이블 생성:', tables.length, '개 (외래키·인덱스 제외)');

    // 2) 백업 파일의 INSERT를 임시 스키마로 재대상화해 실행
    const sql = fs.readFileSync(bkPath, 'utf8');
    const stmts = sql.split(/\r?\n/).filter(l => l.startsWith('INSERT INTO public.'));
    console.log('백업 파일 INSERT 문:', stmts.length, '건');
    let ok = 0, fail = 0;
    for (const s of stmts) {
      const re = s.replace('INSERT INTO public.', `INSERT INTO ${id(SCHEMA)}.`)
                  .replace('NULL::public.', `NULL::${id(SCHEMA)}.`);
      try { await c.query(re); ok++; }
      catch (e) { fail++; if (fail <= 3) console.error('  실패:', e.message, '\n   ', s.slice(0, 120)); }
    }
    console.log(`INSERT 성공 ${ok} / 실패 ${fail}`);

    // 3) 원본과 대조 — 행수 + 내용 체크섬
    console.log('\n--- 원본 대조 ---');
    const rows = [];
    let mismatch = 0, totalSrc = 0;
    for (const t of tables) {
      const src = await q(`SELECT count(*)::int n FROM public.${id(t.relname)}`);
      const dst = await q(`SELECT count(*)::int n FROM ${id(SCHEMA)}.${id(t.relname)}`);
      totalSrc += src[0].n;
      let sumSrc = '-', sumDst = '-';
      if (src[0].n > 0) {
        const a = await q(`SELECT row_to_json(t)::text j FROM public.${id(t.relname)} t`);
        const b = await q(`SELECT row_to_json(t)::text j FROM ${id(SCHEMA)}.${id(t.relname)} t`);
        const h = arr => crypto.createHash('md5').update(arr.map(r => r.j).sort().join('\n')).digest('hex').slice(0, 8);
        sumSrc = h(a); sumDst = h(b);
      }
      const same = src[0].n === dst[0].n && sumSrc === sumDst;
      if (!same) mismatch++;
      if (src[0].n > 0 || dst[0].n > 0) rows.push({ table: t.relname, 원본: src[0].n, 복원: dst[0].n, 체크섬: sumSrc === sumDst ? `일치(${sumSrc})` : `★불일치 ${sumSrc}≠${sumDst}` });
    }
    console.table(rows);
    console.log(`\n결과: 테이블 ${tables.length}개 / 원본 ${totalSrc}행 / 불일치 ${mismatch}건`);
    console.log(mismatch === 0 && fail === 0 ? '★ 복원 검증 통과' : '★ 복원 검증 실패');
  } finally {
    await c.query(`DROP SCHEMA IF EXISTS ${id(SCHEMA)} CASCADE`);
    console.log('임시 스키마 삭제 완료:', SCHEMA);
    await c.end();
  }
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
