// 옵션 A: public.tb_s080_* → tb_s030_t001.tb_s030_* 이동·리네임 SQL 생성. 읽기 전용(생성만).
// usage: node scripts/gen-move-sql.js .env > migrations/001_move_erp_to_s030.sql
const fs=require('fs');const {Client}=require('pg');
const env=Object.fromEntries(fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const c=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectionTimeoutMillis:10000});
const q=(s,p)=>c.query(s,p).then(r=>r.rows);
const NEW='tb_s030_t001', ren=n=>n.replace(/^tb_s080_/,'tb_s030_');
const o=[];const w=s=>o.push(s);
(async()=>{
await c.connect();
const tables=(await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname like 'tb_s080%' order by 1`)).map(r=>r.relname);

w('-- 옵션 A — ERP 테이블을 전용 스키마로 이동하고 접두어를 s030으로 맞춘다.');
w('-- 생성: node scripts/gen-move-sql.js .env   (생성 시각 '+new Date().toISOString()+')');
w('-- 전제: Prisma 앱이 이 테이블들의 유일한 소유자이며, 앱 소스의 tb_s080 하드코딩이 0건임을 확인했을 것.');
w('-- 실행 전 반드시 백업: pg_dump -n public -Fc > before_move.dump');
w('');
w('BEGIN;');
w('');
w('CREATE SCHEMA IF NOT EXISTS '+NEW+';');
w('COMMENT ON SCHEMA '+NEW+" IS 'SwonBiz ERP (S03) — 입주계약·예약·청구·법무';");
w('');
w('-- 1) 스키마 이동 ('+tables.length+'개). 인덱스·제약·소유 시퀀스는 함께 따라온다.');
tables.forEach(t=>w('ALTER TABLE public.'+t+' SET SCHEMA '+NEW+';'));
w('');
w('-- 2) 테이블 리네임 (tb_s080_ → tb_s030_)');
tables.forEach(t=>w('ALTER TABLE '+NEW+'.'+t+' RENAME TO '+ren(t)+';'));
w('');

// 이동 대상 테이블에 붙은 제약·인덱스·시퀀스 이름도 정리
const oids=(await q(`select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname like 'tb_s080%'`));
const cons=[],idx=[],seqs=[];
for(const t of oids){
  (await q(`select conname from pg_constraint where conrelid=$1 and conname like '%tb_s080%' order by 1`,[t.oid]))
    .forEach(r=>cons.push([ren(t.relname),r.conname]));
  (await q(`select c2.relname from pg_index i join pg_class c2 on c2.oid=i.indexrelid
     where i.indrelid=$1 and c2.relname like '%tb_s080%'
       and not exists (select 1 from pg_constraint x where x.conindid=i.indexrelid) order by 1`,[t.oid]))
    .forEach(r=>idx.push(r.relname));
}
(await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='S' and c.relname like '%tb_s080%' order by 1`)).forEach(r=>seqs.push(r.relname));

w('-- 3) 제약 이름 정리 ('+cons.length+'개)');
cons.length?cons.forEach(([t,n])=>w('ALTER TABLE '+NEW+'.'+t+' RENAME CONSTRAINT "'+n+'" TO "'+ren(n)+'";')):w('--   (없음)');
w('');
w('-- 4) 인덱스 이름 정리 ('+idx.length+'개)');
idx.length?idx.forEach(n=>w('ALTER INDEX '+NEW+'."'+n+'" RENAME TO "'+ren(n)+'";')):w('--   (없음)');
w('');
w('-- 5) 시퀀스 이름 정리 ('+seqs.length+'개)');
seqs.length?seqs.forEach(n=>w('ALTER SEQUENCE '+NEW+'."'+n+'" RENAME TO "'+ren(n)+'";')):w('--   (없음)');
w('');
w('-- 6) 권한. public에 걸려 있던 Supabase 기본 grant는 새 스키마로 따라오지 않는다.');
w('--    RLS가 전면 off인 현 상태를 새 스키마로 복제하지 않는다 — 서버(service_role)만 준다.');
w('GRANT USAGE ON SCHEMA '+NEW+' TO service_role;');
w('GRANT ALL ON ALL TABLES IN SCHEMA '+NEW+' TO service_role;');
w('GRANT ALL ON ALL SEQUENCES IN SCHEMA '+NEW+' TO service_role;');
w('ALTER DEFAULT PRIVILEGES IN SCHEMA '+NEW+' GRANT ALL ON TABLES TO service_role;');
w('ALTER DEFAULT PRIVILEGES IN SCHEMA '+NEW+' GRANT ALL ON SEQUENCES TO service_role;');
w('--    anon / authenticated 에는 아무것도 주지 않는다. PostgREST 직접 노출을 끊는 것이 목적이다.');
w('');
w('COMMIT;');
w('');
w('-- 롤백 (COMMIT 전이라면 ROLLBACK; 이후라면 아래 역순 실행)');
w('-- BEGIN;');
tables.forEach(t=>w('--   ALTER TABLE '+NEW+'.'+ren(t)+' RENAME TO '+t+';'));
tables.forEach(t=>w('--   ALTER TABLE '+NEW+'.'+t+' SET SCHEMA public;'));
w('-- COMMIT;');
console.log(o.join('\n'));
await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
