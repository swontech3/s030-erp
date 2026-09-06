const fs=require('fs');const {Client}=require('pg');
const env=Object.fromEntries(fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const c=new Client({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectionTimeoutMillis:10000});
const q=(s,p)=>c.query(s,p).then(r=>r.rows);
const id=n=>/^[a-z_][a-z0-9_]*$/.test(n)?n:'"'+n+'"';
(async()=>{
await c.connect();
const out=[];
out.push('-- SwonBiz ERP :: existing public schema (structure only, no data)');
out.push('-- source  : '+env.DB_HOST+':'+env.DB_PORT+'/'+env.DB_NAME);
out.push('-- server  : '+(await q('select version() v'))[0].v);
out.push('-- taken   : '+new Date().toISOString());
out.push('');

// enums
const enums=await q(`select t.typname, string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) labels
 from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
 where n.nspname='public' group by t.typname order by 1`);
if(enums.length){out.push('-- ============ ENUM TYPES ============');enums.forEach(e=>out.push(`CREATE TYPE ${id(e.typname)} AS ENUM (${e.labels});`));out.push('');}

const tables=await q(`select c.relname, obj_description(c.oid) cmt, c.oid
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' order by 1`);
out.push('-- ============ TABLES ('+tables.length+') ============');
for(const t of tables){
  const cols=await q(`select a.attname, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull,
     pg_get_expr(d.adbin,d.adrelid) def, a.attidentity, col_description(a.attrelid,a.attnum) cmt
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid=$1 and a.attnum>0 and not a.attisdropped order by a.attnum`,[t.oid]);
  const cons=await q(`select conname, pg_get_constraintdef(oid) def, contype from pg_constraint where conrelid=$1 order by contype, conname`,[t.oid]);
  out.push('');
  out.push('-- ---------------------------------------------------------------');
  out.push(`CREATE TABLE ${id(t.relname)} (`);
  const lines=cols.map(x=>{
    let s='    '+id(x.attname).padEnd(28)+' '+x.typ;
    if(x.attidentity)s+=' GENERATED '+(x.attidentity==='a'?'ALWAYS':'BY DEFAULT')+' AS IDENTITY';
    if(x.def)s+=' DEFAULT '+x.def;
    if(x.attnotnull)s+=' NOT NULL';
    return s;
  });
  cons.forEach(k=>lines.push('    CONSTRAINT '+id(k.conname)+' '+k.def));
  out.push(lines.join(',\n'));
  out.push(');');
  if(t.cmt)out.push(`COMMENT ON TABLE ${id(t.relname)} IS ${JSON.stringify(t.cmt).replace(/'/g,"''").replace(/^"|"$/g,"'")};`);
  cols.filter(x=>x.cmt).forEach(x=>out.push(`COMMENT ON COLUMN ${id(t.relname)}.${id(x.attname)} IS '${String(x.cmt).replace(/'/g,"''")}';`));
  const idx=await q(`select indexdef, indexname from pg_indexes where schemaname='public' and tablename=$1 order by indexname`,[t.relname]);
  const pkuq=new Set(cons.filter(k=>k.contype==='p'||k.contype==='u').map(k=>k.conname));
  idx.filter(i=>!pkuq.has(i.indexname)).forEach(i=>out.push(i.indexdef+';'));
}

const views=await q(`select table_name, view_definition from information_schema.views where table_schema='public' order by 1`);
if(views.length){out.push('');out.push('-- ============ VIEWS ============');views.forEach(v=>out.push(`CREATE OR REPLACE VIEW ${id(v.table_name)} AS\n${v.view_definition}`));}

const seqs=await q(`select sequence_name, data_type, start_value, increment from information_schema.sequences where sequence_schema='public' order by 1`);
if(seqs.length){out.push('');out.push('-- ============ SEQUENCES ============');seqs.forEach(s=>out.push(`-- ${s.sequence_name}  ${s.data_type} start ${s.start_value} inc ${s.increment}`));}

const fns=await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`);
if(fns.length){out.push('');out.push('-- ============ FUNCTIONS ============');fns.forEach(f=>out.push(`-- ${f.proname}(${f.args})`));}

const trg=await q(`select c.relname tbl, t.tgname, pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1,2`);
if(trg.length){out.push('');out.push('-- ============ TRIGGERS ============');trg.forEach(t=>out.push(t.def+';'));}

fs.writeFileSync(process.argv[3],out.join('\n')+'\n','utf8');
console.log('written',process.argv[3],out.join('\n').length,'bytes; tables='+tables.length+' enums='+enums.length+' views='+views.length+' triggers='+trg.length);
await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
