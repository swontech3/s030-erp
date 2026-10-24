/**
 * 일회용(2026-10-24) — 옛 .env 세 개를 새 폴더의 네 파일로 나눠 담는다(환경 파일 한 폴더, 단계 2).
 *
 * 사용자 결정(2026-10-24):
 *   · 새 폴더 SWONBIZ_ENV_DIR (없으면 C:\workspace\env\) — packages/shared/src/envFiles.js 와 같은 규칙
 *   · common  = BBIYONG_SYSTEM · BBIYONG_BASE_URL
 *   · erp-api = API 서버 칸. 겹친 칸(SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · DATA_GO_KR_KEY)은 **api 쪽 값**
 *   · erp-web = 화면 칸
 *   · admin   = 관리자(postgres) 접속 · SUPABASE_ANON_KEY · LAW_API_OC
 *   · 구글 키 파일은 새 폴더로 **복사만**(원본 그대로), GOOGLE_APPLICATION_CREDENTIALS 는 그 절대경로로
 *
 * ★ **값은 화면에 내지 않는다.** 칸 이름 · 어느 파일에서 어느 파일로 가는지만 보인다.
 * ★ 옛 .env 는 읽기만 한다 — 고치거나 지우지 않는다(지우는 것은 사용자, 새 방식 확인 뒤).
 * ★ 하나라도 어긋나면 아무것도 쓰지 않고 멈춘다:
 *   새 폴더에 네 파일 중 하나라도 이미 있음 · 구글 키 복사 자리에 파일이 이미 있음 · 원본 키 파일 없음 ·
 *   표에 없는 칸 · 읽는 방법에 따라 값이 달라지는 칸(따옴표 · $ · # — 아래 「읽는 방법」) ·
 *   써 놓은 파일을 다시 읽었을 때 값이 다름
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 쓴다.
 *
 *   node scripts/oneoff/2026-10-24-env-split.mjs            (보기)
 *   node scripts/oneoff/2026-10-24-env-split.mjs --apply    (쓰기)
 *
 * 읽는 방법: API 는 `process.loadEnvFile`(Node 파서 — 따옴표를 푼다)로, 스크립트는 `=` 뒤를 날것 그대로,
 * 화면(Next)은 `$변수` 를 펼쳐서 읽어 왔다. 새 읽기 함수는 Node 파서 하나다. 세 방법이 같은 값을 내는
 * 칸만 옮긴다 — 다르면 어느 값이 맞는지 사람이 정해야 한다.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { envDir } from '../../packages/shared/src/envFiles.js';

const APPLY = process.argv.includes('--apply');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const OLD = {
  root: join(ROOT, '.env'),
  api: join(ROOT, 'packages/api/.env'),
  web: join(ROOT, 'packages/web/.env'),
};

/** 칸 → [새 파일, 어느 옛 파일에서]. 순서가 곧 새 파일 안의 순서다. */
const PLAN = [
  ['BBIYONG_SYSTEM', 'common', 'api'],
  ['BBIYONG_BASE_URL', 'common', 'api'],

  ['BBIYONG_MOCK', 'erp-api', 'api'],
  ['BBIYONG_ACL_MODE', 'erp-api', 'api'],
  ['NODE_ENV', 'erp-api', 'api'],
  ['ERP_DATABASE_URL', 'erp-api', 'api'],
  ['ERP_ENCRYPTION_KEY', 'erp-api', 'api'],
  ['SUPABASE_URL', 'erp-api', 'api'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'erp-api', 'api'],
  ['GOOGLE_APPLICATION_CREDENTIALS', 'erp-api', 'api'],
  ['DATA_GO_KR_KEY', 'erp-api', 'api'],
  ['PORT', 'erp-api', 'api'],

  ['NEXT_PUBLIC_BBIYONG_WEB_URL', 'erp-web', 'web'],
  ['API_BASE_URL', 'erp-web', 'web'],
  ['ERP_PUBLIC_ORIGIN', 'erp-web', 'web'],

  ['DB_HOST', 'admin', 'root'],
  ['DB_PORT', 'admin', 'root'],
  ['DB_USER', 'admin', 'root'],
  ['DB_PASSWORD', 'admin', 'root'],
  ['DB_NAME', 'admin', 'root'],
  ['SUPABASE_ANON_KEY', 'admin', 'root'],
  ['LAW_API_OC', 'admin', 'api'],
];

/** 옮기지 않고 버리는 칸 — api 쪽 값이 정본(결정 2026-10-24). */
const DROP = new Set(['root:SUPABASE_URL', 'root:SUPABASE_SERVICE_ROLE_KEY', 'root:DATA_GO_KR_KEY']);

const FILES = ['common', 'erp-api', 'erp-web', 'admin'];

const problems = [];

// ---------------------------------------------------------------- 옛 파일 읽기
function readOld(tag) {
  const path = OLD[tag];
  if (!existsSync(path)) {
    problems.push(`옛 파일이 없다: ${path}`);
    return { parsed: {}, raw: {} };
  }
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  // 스크립트들이 써 온 날것 읽기(=` 뒤를 trim) — 비교용
  const raw = Object.fromEntries(
    text.split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim().replace(/^export\s+/, ''), l.slice(i + 1).trim()]; }),
  );
  return { parsed: parseEnv(text), raw };
}
const old = { root: readOld('root'), api: readOld('api'), web: readOld('web') };

// ---------------------------------------------------------------- 표에 없는 칸
const planned = new Set(PLAN.map(([k, , from]) => `${from}:${k}`));
for (const tag of Object.keys(old)) {
  for (const k of Object.keys(old[tag].parsed)) {
    const id = `${tag}:${k}`;
    if (!planned.has(id) && !DROP.has(id)) problems.push(`표에 없는 칸: ${k} (${tag})`);
  }
}

// ---------------------------------------------------------------- 칸마다 새 값
const newDir = envDir();
const out = Object.fromEntries(FILES.map((f) => [f, []]));
const rows = [];
let keyCopy = null;

for (const [k, file, from] of PLAN) {
  const src = old[from];
  if (!(k in src.parsed)) {
    rows.push([k, from, '—', '옛 파일에 없음 → 쓰지 않는다']);
    continue;
  }
  let value = src.parsed[k];
  const notes = [];

  // 읽는 방법에 따라 값이 달라지는가 — 스크립트(root)는 날것, 화면(web)은 $ 펼침
  if (from === 'root' && src.raw[k] !== value) {
    problems.push(`읽는 방법에 따라 값이 다르다: ${k} (root — 스크립트는 날것으로 읽어 왔다)`);
    notes.push('★ 읽는 방법에 따라 다름');
  }
  if (from === 'web' && value.includes('$')) {
    problems.push(`읽는 방법에 따라 값이 다를 수 있다: ${k} (web — Next 는 $ 를 펼친다)`);
    notes.push('★ $ 가 있음');
  }

  if (k === 'GOOGLE_APPLICATION_CREDENTIALS') {
    // env.ts 와 같은 규칙 — 상대경로는 packages/api 기준
    const from_ = resolve(ROOT, 'packages/api', value);
    const to = join(newDir, basename(from_));
    if (!existsSync(from_)) problems.push('구글 키 원본 파일이 없다(GOOGLE_APPLICATION_CREDENTIALS 가 가리키는 곳)');
    if (existsSync(to)) problems.push(`구글 키 복사 자리에 파일이 이미 있다: ${join(newDir, '(원본 파일 이름)')}`);
    keyCopy = { from: from_, to };
    value = to;
    notes.push(`키 파일 복사 → ${join(newDir, '(원본 파일 이름)')} · 값은 그 절대경로`);
  }

  if (from === 'api' && k in old.root.parsed && DROP.has(`root:${k}`)) {
    notes.push(`루트에도 있음(루트 값은 버린다 — 두 값 ${old.root.parsed[k] === value ? '같음' : '다름'})`);
  }

  out[file].push([k, value]);
  rows.push([k, from, `${file}.env`, notes.join(' · ')]);
}
for (const id of DROP) {
  const [tag, k] = id.split(':');
  if (k in old[tag].parsed) rows.push([k, tag, '(버림)', 'api 쪽 값이 정본']);
}

// ---------------------------------------------------------------- 새 파일 글 만들기
function quote(k, v) {
  if (/^[^\s#'"`\\$]*$/.test(v)) return v;
  if (!v.includes("'") && !v.includes('\n')) return `'${v}'`;
  if (!v.includes('`')) return `\`${v}\``;
  problems.push(`값을 안전하게 적을 수 없다: ${k}`);
  return '';
}
const texts = {};
for (const f of FILES) {
  const body = out[f].map(([k, v]) => `${k}=${quote(k, v)}`).join('\n');
  texts[f] = `# ${f}.env — 2026-10-24 일회용 스크립트(scripts/oneoff/2026-10-24-env-split.mjs)가 옛 .env 에서 나눠 담았다.\n`
    + `# 칸 설명은 저장소의 env.example/${f}.env 에 있다.\n${body}${body ? '\n' : ''}`;
  // 다시 읽어 같은 값인지 — 값은 내지 않고 칸 이름만
  const back = parseEnv(texts[f]);
  for (const [k, v] of out[f]) if (back[k] !== v) problems.push(`다시 읽은 값이 다르다: ${k} (${f}.env)`);
  if (Object.keys(back).length !== out[f].length) problems.push(`다시 읽은 칸 수가 다르다: ${f}.env`);
}

// ---------------------------------------------------------------- 새 폴더 상태
const dirExists = existsSync(newDir);
for (const f of FILES) {
  if (existsSync(join(newDir, `${f}.env`))) problems.push(`새 폴더에 파일이 이미 있다: ${join(newDir, `${f}.env`)}`);
}

// ---------------------------------------------------------------- 보이기
console.log(`새 폴더: ${newDir} (${dirExists ? '있음' : '없음 — --apply 때 만든다'})`);
console.log(`옛 파일: ${Object.values(OLD).join(' · ')} — 읽기만 한다\n`);
const w = Math.max(...rows.map((r) => r[0].length));
console.log(`${'칸'.padEnd(w)}  옛 파일  →  새 파일       비고`);
for (const [k, from, to, note] of rows) console.log(`${k.padEnd(w)}  ${from.padEnd(6)}  →  ${to.padEnd(12)}  ${note}`);
console.log('');
for (const f of FILES) console.log(`${f}.env: ${out[f].length}칸`);

if (problems.length > 0) {
  console.log('\n★ 멈춘다 — 아무것도 쓰지 않았다:');
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}

if (!APPLY) {
  console.log('\n보기만 했다. 쓰려면 --apply.');
  process.exit(0);
}

// ---------------------------------------------------------------- 쓰기
mkdirSync(newDir, { recursive: true });
for (const f of FILES) writeFileSync(join(newDir, `${f}.env`), texts[f], { flag: 'wx' });
if (keyCopy) copyFileSync(keyCopy.from, keyCopy.to, 1 /* COPYFILE_EXCL */);
console.log(`\n썼다: ${FILES.map((f) => `${f}.env`).join(' · ')}${keyCopy ? ' · 구글 키 파일 복사' : ''} — 옛 .env 는 그대로다.`);
