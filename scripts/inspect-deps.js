// tb_s080_* 리네임/이동(옵션 A)이 무엇을 깨뜨리는지 조사한다. 읽기 전용.
// usage: node scripts/inspect-deps.js .env
const fs=require('fs');const {Client}=require('pg');
const env=Object.fromEntries(fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const c=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectionTimeoutMillis:10000});
const q=(s,p)=>c.query(s,p).then(r=>r.rows);
const show=(title,rows,fmt)=>{console.log('\n### '+title+' ('+rows.length+')');rows.forEach(r=>console.log('  '+fmt(r)));};
(async()=>{
await c.connect();

show('schemas', await q(`select nspname, (select count(*) from pg_class c where c.relnamespace=n.oid and c.relkind='r') tbls
 from pg_namespace n where nspname not like 'pg_%' and nspname<>'information_schema' order by 1`),
 r=>r.nspname.padEnd(28)+r.tbls+' tables');

show('_prisma_migrations', await q(`select migration_name, to_char(finished_at,'YYYY-MM-DD') d, rolled_back_at
 from public._prisma_migrations order by started_at`).catch(()=>[]),
 r=>r.d+'  '+r.migration_name+(r.rolled_back_at?'  [ROLLED BACK]':''));

show('views/matviews referencing tb_s080', await q(`select n.nspname, c.relname, c.relkind
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('v','m') and pg_get_viewdef(c.oid) ilike '%tb_s080%' order by 1,2`),
 r=>r.nspname+'.'+r.relname+' ('+r.relkind+')');

show('functions referencing tb_s080', await q(`select n.nspname, p.proname
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname not in ('pg_catalog','information_schema') and p.prosrc ilike '%tb_s080%' order by 1,2`),
 r=>r.nspname+'.'+r.proname);

show('triggers on tb_s080_*', await q(`select c.relname, t.tgname, pg_get_triggerdef(t.oid) def
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname like 'tb_s080%' and not t.tgisinternal order by 1,2`),
 r=>r.relname+'.'+r.tgname);

show('RLS enabled on tb_s080_*', await q(`select c.relname, c.relrowsecurity, c.relforcerowsecurity
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname like 'tb_s080%' and c.relrowsecurity order by 1`),
 r=>r.relname+'  rls='+r.relrowsecurity);

show('policies on tb_s080_*', await q(`select tablename, policyname, roles::text, cmd from pg_policies
 where schemaname='public' and tablename like 'tb_s080%' order by 1,2`),
 r=>r.tablename+'.'+r.policyname+'  '+r.roles+' '+r.cmd);

show('inbound FKs -> tb_s080_* from非tb_s080 tables', await q(`select cn.nspname||'.'||ch.relname src, con.conname, pn.nspname||'.'||pa.relname tgt
 from pg_constraint con
 join pg_class ch on ch.oid=con.conrelid join pg_namespace cn on cn.oid=ch.relnamespace
 join pg_class pa on pa.oid=con.confrelid join pg_namespace pn on pn.oid=pa.relnamespace
 where con.contype='f' and pa.relname like 'tb_s080%' and ch.relname not like 'tb_s080%' order by 1,2`),
 r=>r.src+' -> '+r.tgt+'  ('+r.conname+')');

show('outbound FKs tb_s080_* -> 非tb_s080', await q(`select cn.nspname||'.'||ch.relname src, con.conname, pn.nspname||'.'||pa.relname tgt
 from pg_constraint con
 join pg_class ch on ch.oid=con.conrelid join pg_namespace cn on cn.oid=ch.relnamespace
 join pg_class pa on pa.oid=con.confrelid join pg_namespace pn on pn.oid=pa.relnamespace
 where con.contype='f' and ch.relname like 'tb_s080%' and pa.relname not like 'tb_s080%' order by 1,2`),
 r=>r.src+' -> '+r.tgt+'  ('+r.conname+')');

show('publications containing tb_s080_* (realtime)', await q(`select pubname, schemaname, tablename from pg_publication_tables
 where tablename like 'tb_s080%' order by 1,3`).catch(()=>[]),
 r=>r.pubname+': '+r.schemaname+'.'+r.tablename);

show('grants on tb_s080_* to anon/authenticated/service_role', await q(`select table_name, grantee, string_agg(privilege_type,',' order by privilege_type) p
 from information_schema.role_table_grants
 where table_schema='public' and table_name like 'tb_s080%' and grantee in ('anon','authenticated','service_role')
 group by 1,2 order by 1,2`),
 r=>r.table_name.padEnd(34)+r.grantee.padEnd(16)+r.p);

show('row counts tb_s080_*', await q(`select relname, n_live_tup from pg_stat_user_tables
 where schemaname='public' and relname like 'tb_s080%' order by n_live_tup desc, relname`),
 r=>r.relname.padEnd(34)+r.n_live_tup);

await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
