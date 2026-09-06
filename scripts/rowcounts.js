const fs=require('fs');const {Client}=require('pg');
const env=Object.fromEntries(fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const c=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectionTimeoutMillis:10000});
(async()=>{
await c.connect();
const t=(await c.query(`select c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' order by 1`)).rows;
console.log('name'.padEnd(34)+'rows'.padStart(8)+'   rls');
for(const r of t){
  const n=(await c.query(`select count(*)::int n from public."${r.relname}"`)).rows[0].n;
  console.log(r.relname.padEnd(34)+String(n).padStart(8)+'   '+(r.rls?'ON':'off'));
}
console.log('\n-- 삐용 tb_s020_t001 / tb_s090_t001 --');
for(const s of ['tb_s020_t001','tb_s090_t001']){
  const ts=(await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind='r' order by 1`,[s])).rows;
  for(const r of ts){const n=(await c.query(`select count(*)::int n from "${s}"."${r.relname}"`)).rows[0].n;console.log((s+'.'+r.relname).padEnd(46)+String(n).padStart(6));}
}
await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
