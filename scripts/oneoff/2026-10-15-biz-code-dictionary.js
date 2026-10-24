/**
 * 일회용(2026-10-15, 해마다 다시 돌린다) — 업종 사전 적재(047 의 두 표).
 *
 * 원본(★ git 에 없다 — 그 PC 의 doc/data-src/ 에 둔다. 홈택스 기준(단순)경비율 조회에서 받는다):
 *   --linkage=<xlsx>  업종코드-표준산업분류 연계표   (기본: doc/data-src/업종코드-표준산업분류 연계표.xlsx)
 *   --rates=<xls>     귀속연도 업종코드(경비율) 엑셀 (기본: doc/data-src/2025년 귀속 업종코드.xls) — 업태 표기 · 대조(★ 없으면 멈춘다)
 *
 * 사용자 결정(2026-10-15):
 *   · 기준 키 = 업종코드 6자리. 종목 · KSIC 는 연계표에서, 귀속연도는 연계표 머리줄에서
 *   · 업태(2026-10-18 세무 방 결정): 같은 업종코드가 경비율 엑셀에 있으면 경비율 엑셀의 업태명,
 *     연계표에만 있는 코드는 연계표 대분류 그대로
 *   · 종목은 세세분류를 「, 」로 잇는다. 701206 · 701302 도 연계표 값 그대로(손대지 않는다)
 *   · 경비율 엑셀에만 있고 연계표에 없는 코드는 넣지 않고 목록만 찍는다
 *   · 덮어쓰기(최신 한 벌). 새 원본에서 빠진 코드 · 연계는 지우지 않고 active = false
 *   · is_main 은 연계표에 「업종코드의 대표 KSIC」 표시가 있을 때만 — 없으면 NULL.
 *     연계표의 「메인」 칸은 KSIC 쪽에서 본 표시라(같은 KSIC 에 이어진 업종코드들 가운데 하나에 붙는다)
 *     업종코드의 대표 KSIC 가 아니다 → 넣지 않는다. 보기에 그 근거 숫자를 찍는다
 *
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 쓴다(한 트랜잭션). 원본 머리줄 모양이 다르면 멈춘다.
 * ★ 047 을 먼저 적용해야 --apply 가 돈다(보기는 표가 없어도 돈다 — 전부 「새로 생김」으로 보인다).
 * ★ 엑셀 라이브러리가 없어서 xlsx(zip+XML) · xls(BIFF8) 를 여기서 직접 읽는다.
 *
 *   node scripts/oneoff/2026-10-15-biz-code-dictionary.js .env                 (보기)
 *   node scripts/oneoff/2026-10-15-biz-code-dictionary.js .env --all           (보기, 안 맞는 줄 전부)
 *   node scripts/oneoff/2026-10-15-biz-code-dictionary.js .env --apply         (쓰기)
 */
const fs = require('fs');
const zlib = require('zlib');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `=${d}`).split('=').slice(1).join('=');
const LINKAGE = arg('linkage', 'doc/data-src/업종코드-표준산업분류 연계표.xlsx');
const RATES = arg('rates', 'doc/data-src/2025년 귀속 업종코드.xls');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-15-biz-code-dictionary.js <.env> [--apply] [--all] [--linkage=xlsx] [--rates=xls]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

// ── xlsx: zip 중앙 디렉터리 → 공유 문자열 + 첫 시트 → { 행번호: { 열글자: 값 } } ──────────────
function readXlsx(file) {
  const b = fs.readFileSync(file);
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error(`${file}: zip 이 아닙니다`);
  const z = {};
  for (let i = 0, p = b.readUInt32LE(e + 16), n = b.readUInt16LE(e + 10); i < n; i++) {
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), fl = b.readUInt16LE(p + 28);
    const xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.slice(p + 46, p + 46 + fl).toString();
    const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const data = b.slice(start, start + size);
    z[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + fl + xl + cl;
  }
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const sst = (z['xl/sharedStrings.xml'] || '').toString().split('<si>').slice(1)
    .map((si) => dec((si.match(/<t[^>]*>([^<]*)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  const rows = {};
  for (const r of z['xl/worksheets/sheet1.xml'].toString().split('<row ').slice(1)) {
    const o = (rows[+r.match(/r="(\d+)"/)[1]] = {});
    for (const c of r.split('<c ').slice(1)) {
      const t = (c.match(/t="(\w+)"/) || [])[1];
      let v = (c.match(/<v>([^<]*)<\/v>/) || [])[1];
      if (v === undefined) continue;
      o[c.match(/r="([A-Z]+)\d+"/)[1]] = t === 's' ? sst[+v] : dec(v);
    }
  }
  return rows;
}

// ── xls(BIFF8): 복합 문서에서 Workbook 스트림 → 첫 시트 → { 행: { 열번호: 값 } } (0부터) ──────
function readXls(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0xe011cfd0) throw new Error(`${file}: xls(복합 문서)가 아닙니다`);
  const ss = 1 << b.readUInt16LE(0x1e), mss = 1 << b.readUInt16LE(0x20), cutoff = b.readUInt32LE(0x38);
  const sec = (i) => b.slice(512 + i * ss, 512 + (i + 1) * ss);
  const difat = [];
  for (let i = 0; i < 109; i++) difat.push(b.readUInt32LE(0x4c + i * 4));
  for (let d = b.readUInt32LE(0x44); d < 0xfffffffa;) { const s = sec(d); for (let i = 0; i < ss / 4 - 1; i++) difat.push(s.readUInt32LE(i * 4)); d = s.readUInt32LE(ss - 4); }
  const fat = [];
  for (const f of difat.slice(0, b.readUInt32LE(0x2c))) { const s = sec(f); for (let i = 0; i < ss / 4; i++) fat.push(s.readUInt32LE(i * 4)); }
  const chain = (st) => { const out = []; for (let i = st; i < 0xfffffffa; i = fat[i]) { out.push(sec(i)); if (out.length > fat.length) throw new Error('xls FAT 순환'); } return Buffer.concat(out); };
  const dir = chain(b.readUInt32LE(0x30));
  const ents = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    ents.push({ name: dir.slice(o, o + Math.max(0, dir.readUInt16LE(o + 64) - 2)).toString('utf16le'), type: dir[o + 66], start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) });
  }
  const ent = ents.find((x) => x.type === 2 && (x.name === 'Workbook' || x.name === 'Book'));
  if (!ent) throw new Error(`${file}: Workbook 스트림이 없습니다`);
  let w;
  if (ent.size >= cutoff) w = chain(ent.start).slice(0, ent.size);
  else {
    const mini = chain(ents[0].start), mf = chain(b.readUInt32LE(0x3c)), out = [];
    for (let i = ent.start; i < 0xfffffffa; i = mf.readUInt32LE(i * 4)) out.push(mini.slice(i * mss, (i + 1) * mss));
    w = Buffer.concat(out).slice(0, ent.size);
  }
  const recs = [];
  for (let p = 0; p + 4 <= w.length; p += 4 + w.readUInt16LE(p + 2)) recs.push({ id: w.readUInt16LE(p), off: p, d: w.slice(p + 4, p + 4 + w.readUInt16LE(p + 2)) });
  const str = (d, p, cch, wide) => (wide ? d.slice(p, p + cch * 2).toString('utf16le') : d.slice(p, p + cch).toString('latin1'));
  const rk = (v) => { let n; if (v & 2) n = v >> 2; else { const t = Buffer.alloc(8); t.writeInt32LE(v & 0xfffffffc, 4); n = t.readDoubleLE(0); } return v & 1 ? n / 100 : n; };
  const sst = [];
  let sheetPos = null;
  for (let i = 0; i < recs.length; i++) {
    const { id, d } = recs[i];
    if (id === 0x85 && sheetPos === null) sheetPos = d.readUInt32LE(0);
    if (id !== 0xfc) continue;
    // SST — 글자가 CONTINUE 레코드에 걸쳐 이어질 수 있다(이어지는 첫 바이트는 새 압축 플래그)
    const parts = [d];
    while (recs[i + 1] && recs[i + 1].id === 0x3c) parts.push(recs[++i].d);
    let pi = 0, p = 8;
    const step = () => { if (p >= parts[pi].length) { pi++; p = 0; } };
    for (let k = 0, n = d.readUInt32LE(4); k < n; k++) {
      step();
      let cch = parts[pi].readUInt16LE(p), fl = parts[pi][p + 2], s = '';
      p += 3;
      let skip = 0;
      if (fl & 8) { skip += parts[pi].readUInt16LE(p) * 4; p += 2; }
      if (fl & 4) { skip += parts[pi].readUInt32LE(p); p += 4; }
      while (cch > 0) {
        if (p >= parts[pi].length) { pi++; p = 0; fl = parts[pi][p]; p += 1; }
        const wide = fl & 1, take = Math.min(cch, Math.floor((parts[pi].length - p) / (wide ? 2 : 1)));
        s += str(parts[pi], p, take, wide);
        p += take * (wide ? 2 : 1);
        cch -= take;
      }
      while (skip > 0) { step(); const t = Math.min(skip, parts[pi].length - p); p += t; skip -= t; }
      sst.push(s);
    }
  }
  const rows = {};
  const put = (r, c, v) => { (rows[r] = rows[r] || {})[c] = v; };
  for (let i = recs.findIndex((r) => r.off === sheetPos) + 1; i > 0 && i < recs.length && recs[i].id !== 0x0a; i++) {
    const { id, d } = recs[i];
    if (id === 0xfd) put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)]);
    else if (id === 0x203) put(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
    else if (id === 0x27e) put(d.readUInt16LE(0), d.readUInt16LE(2), rk(d.readInt32LE(6)));
    else if (id === 0xbd) { for (let k = 0; 6 + k * 6 + 6 <= d.length; k++) put(d.readUInt16LE(0), d.readUInt16LE(2) + k, rk(d.readInt32LE(6 + k * 6))); }
    else if (id === 0x204) put(d.readUInt16LE(0), d.readUInt16LE(2), str(d, 9, d.readUInt16LE(6), d[8] & 1));
  }
  return rows;
}

// ── 연계표 읽기 ────────────────────────────────────────────────────────────────
const L = readXlsx(LINKAGE);
const H = L[5] || {};
const HEAD = { C: '귀속', D: '대분류', E: '대분류', L: '세세분류', N: '표준산업', W: '세세분류', Y: '메인' };
for (const [col, word] of Object.entries(HEAD)) {
  if (!String(H[col] || '').includes(word)) throw new Error(`연계표 머리줄(5행) ${col} 칸이 「${H[col]}」 — 「${word}」가 있어야 합니다. 원본 모양이 바뀌었으면 스크립트를 고쳐야 합니다`);
}
const yearM = String(H.C).match(/(\d{4})\s*년\s*귀속/);
if (!yearM) throw new Error(`연계표 머리줄에서 귀속연도를 못 찾았습니다: ${JSON.stringify(H.C)}`);
const TAX_YEAR = +yearM[1];

const src = Object.keys(L).map(Number).filter((n) => n >= 6).sort((a, b) => a - b).map((n) => ({ row: n, ...L[n] }));
const noBiz = src.filter((r) => !r.C);                         // 업종코드 없는 KSIC 줄 — 넣지 않는다
const badBiz = src.filter((r) => r.C && !/^\d{6}$/.test(r.C));
if (badBiz.length) throw new Error(`업종코드가 6자리가 아닌 줄: ${badBiz.map((r) => `${r.row}행 ${r.C}`).join(', ')}`);

const biz = new Map();   // biz_code → { biz_type, items[], links: Map(ksic → link) }
const dupLinks = [], noKsic = [], badKsic = [], mismatchMajor = [], mismatchName = [];
for (const r of src.filter((x) => x.C)) {
  let b = biz.get(r.C);
  if (!b) biz.set(r.C, (b = { biz_code: r.C, link_type: r.E, items: [], links: new Map(), rows: [] }));
  b.rows.push(r);
  if (r.E !== b.link_type) throw new Error(`${r.C}: 같은 업종코드에 업태가 둘(「${b.link_type}」 / 「${r.E}」)`);
  if (r.L && !b.items.includes(r.L)) b.items.push(r.L);
  const raw = String(r.N || '');
  if (!raw) { noKsic.push(r); continue; }
  const m = raw.match(/^(\d{5})(\+?)$/);
  if (!m) { badKsic.push(r); continue; }
  if (b.links.has(m[1])) { dupLinks.push(r); continue; }
  b.links.set(m[1], { ksic_code: m[1], ksic_name: r.W, ksic_plus: m[2] === '+', main_mark: r.Y || null });
  if (r.D !== r.O) mismatchMajor.push(r);
  if (r.L !== r.W) mismatchName.push(r);
}
for (const b of biz.values()) b.item_name = b.items.join(', ');

// ── 경비율 엑셀(업태 표기 · 대조) ───────────────────────────────────────────────
if (!fs.existsSync(RATES)) throw new Error(`경비율 엑셀 ${RATES} 이 없습니다 — 업태 표기를 정할 수 없어 멈춥니다`);
let rates = null;
{
  const X = readXls(RATES);
  const h = X[0] || {};
  if (h[0] !== '귀속연도' || h[1] !== '업종코드' || h[2] !== '업태명' || h[5] !== '세세분류') {
    throw new Error(`경비율 엑셀 머리줄이 다릅니다: ${JSON.stringify(h).slice(0, 200)}`);
  }
  rates = new Map();
  for (const r of Object.keys(X).map(Number).filter((n) => n >= 1)) rates.set(String(X[r][1]), { year: X[r][0], up: X[r][2], item: X[r][5] });
}
for (const b of biz.values()) b.biz_type = rates.has(b.biz_code) ? rates.get(b.biz_code).up : b.link_type;

// ── 출력 ──────────────────────────────────────────────────────────────────────
const cut = (s, n = 40) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const list = (title, arr, fmt) => {
  console.log(`\n  ${title}: ${arr.length}`);
  for (const x of ALL ? arr : arr.slice(0, 20)) console.log(`    ${fmt(x)}`);
  if (!ALL && arr.length > 20) console.log(`    … 나머지 ${arr.length - 20} (--all 로 전부)`);
};
const nLinks = [...biz.values()].reduce((s, b) => s + b.links.size, 0);

console.log(`원본: ${LINKAGE}`);
console.log(`귀속연도: ${TAX_YEAR}`);
console.log(`연계표 자료 줄: ${src.length}  (업종코드 없는 KSIC 줄 ${noBiz.length} · 중복 연계 ${dupLinks.length} · KSIC 없음 ${noKsic.length} · KSIC 모양 이상 ${badKsic.length})`);
console.log(`\n■ 넣을 건수 — 업종 사전 ${biz.size}줄 · 업종–KSIC 연계 ${nLinks}줄`);
const multi = [...biz.values()].filter((b) => b.links.size > 1);
console.log(`  KSIC 2개 이상에 이어진 업종코드 ${multi.length} · 「+」(인적용역) 연계 ${[...biz.values()].reduce((s, b) => s + [...b.links.values()].filter((l) => l.ksic_plus).length, 0)}`);
console.log(`  종목이 세세분류 여럿을 「, 」로 이은 코드 ${[...biz.values()].filter((b) => b.items.length > 1).length}`);

console.log('\n■ 샘플 10줄 (업종코드 | 업태 | 종목 | KSIC)');
const picks = [...biz.values()];
const sample = [0, 1, 2].map((i) => picks[i])
  .concat(multi.slice(0, 2), picks.filter((b) => !b.links.size).slice(0, 1), picks.filter((b) => [...b.links.values()].some((l) => l.ksic_plus)).slice(0, 1))
  .concat(['722000', '701201', '525101'].map((c) => biz.get(c)).filter(Boolean)).slice(0, 10);
for (const b of sample) {
  const ks = [...b.links.values()].map((l) => `${l.ksic_code}${l.ksic_plus ? '+' : ''} ${l.ksic_name}`).join(' / ') || '(연계 없음)';
  console.log(`  ${b.biz_code} | ${cut(b.biz_type, 20)} | ${cut(b.item_name, 36)} | ${cut(ks, 70)}`);
}

console.log('\n■ 업종코드와 KSIC 가 안 맞는 줄');
list('대분류가 다름(업종코드 쪽 ≠ KSIC 쪽)', mismatchMajor, (r) => `${r.C} ${r.D} ${cut(r.L, 24)}  ↔  ${r.N} ${r.O} ${cut(r.W, 24)}`);
const spaceOnly = mismatchName.filter((r) => r.L.replace(/\s/g, '') === r.W.replace(/\s/g, ''));
list(`세세분류 이름이 다름(띄어쓰기만 다른 ${spaceOnly.length} 포함)`, mismatchName.filter((r) => !spaceOnly.includes(r)), (r) => `${r.C} 「${cut(r.L, 30)}」  ↔  ${r.N} 「${cut(r.W, 30)}」`);
list('KSIC 없음(사전에는 넣고 연계는 0줄)', noKsic, (r) => `${r.C} ${r.L} — KSIC 칸 「${r.W || ''}」, 세부설명 「${r.Z || ''}」`);
list('업종코드 없는 KSIC 줄(넣지 않음)', noBiz, (r) => `${r.row}행 ${r.N} ${r.W} — ${r.Z || ''}`);
list('중복 연계(앞 줄만 넣음)', dupLinks, (r) => `${r.row}행 ${r.C}–${r.N} 「${r.W}」`);
if (badKsic.length) list('KSIC 모양 이상(넣지 않음)', badKsic, (r) => `${r.row}행 ${r.C} 「${r.N}」`);

// 「메인」 칸 — 어느 쪽 표시인지(is_main 을 비워 두는 근거)
const byKsic = new Map();
for (const b of biz.values()) for (const l of b.links.values()) (byKsic.get(l.ksic_code) || byKsic.set(l.ksic_code, []).get(l.ksic_code)).push(l);
const marked = [...biz.values()].flatMap((b) => [...b.links.values()]).filter((l) => l.main_mark);
console.log(`\n■ 연계표 「메인」 칸: 표시 ${marked.length}줄 (값 ${[...new Set(marked.map((l) => l.main_mark))].join('·')})`);
console.log(`  KSIC 2개 이상인 업종코드 ${multi.length} 중 「메인」이 한 줄에만 붙은 것 ${multi.filter((b) => [...b.links.values()].filter((l) => l.main_mark).length === 1).length}`);
console.log(`  업종코드 2개 이상에 이어진 KSIC ${[...byKsic.values()].filter((v) => v.length > 1).length} 중 「메인」이 붙은 것 ${[...byKsic.values()].filter((v) => v.length > 1 && v.some((l) => l.main_mark)).length}`);
console.log(`  업종코드 1개에만 이어진 KSIC 에 붙은 「메인」 ${[...byKsic.values()].filter((v) => v.length === 1 && v[0].main_mark).length}`);
console.log('  → KSIC 쪽 표시로 보고 is_main 은 모두 NULL 로 넣는다');

if (rates) {
  const yrs = [...new Set([...rates.values()].map((v) => v.year))].join(',');
  const onlyRates = [...rates.keys()].filter((k) => !biz.has(k));
  const onlyLink = [...biz.keys()].filter((k) => !rates.has(k));
  console.log(`\n■ 경비율 엑셀(${RATES}, 귀속 ${yrs}, ${rates.size}개)과 대조`);
  list('경비율에만 있고 연계표에 없는 업종코드(넣지 않음 — 없어진 업종인지 확인용)', onlyRates, (k) => `${k} ${rates.get(k).up} / ${rates.get(k).item}`);
  list('연계표에만 있는 업종코드(넣음)', onlyLink, (k) => `${k} ${cut(biz.get(k).item_name, 50)}`);
  const both = [...rates.keys()].filter((k) => biz.has(k));
  const upDiff = both.filter((k) => rates.get(k).up !== biz.get(k).link_type);
  const upSpace = upDiff.filter((k) => rates.get(k).up.replace(/\s/g, '') === biz.get(k).link_type.replace(/\s/g, ''));
  console.log(`\n  업태 이름이 다름: ${upDiff.length} (띄어쓰기만 다른 것 ${upSpace.length}) — 경비율 표기로 넣는다`);
  for (const k of upDiff.filter((x) => !upSpace.includes(x)).slice(0, ALL ? undefined : 20)) console.log(`    ${k} 경비율「${rates.get(k).up}」 / 연계표「${biz.get(k).link_type}」`);
  console.log(`  업태를 연계표 그대로 넣는 코드(경비율에 없음) ${onlyLink.length}`);
  const norm = (s) => s.replace(/\s/g, '').replace(/ㆍ/g, '·');
  list('종목 이름이 다름(띄어쓰기 · 가운뎃점 무시)', both.filter((k) => norm(rates.get(k).item) !== norm(biz.get(k).item_name)), (k) => `${k} 경비율「${cut(rates.get(k).item, 40)}」 / 연계표「${cut(biz.get(k).item_name, 40)}」`);
}

// ── DB 와 대조 · 쓰기 ───────────────────────────────────────────────────────────
(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const { rows: [{ ok }] } = await c.query("SELECT to_regclass('public.tb_s080_biz_code') IS NOT NULL AND to_regclass('public.tb_s080_biz_code_ksic') IS NOT NULL AS ok");
    if (!ok) {
      console.log('\n■ DB: 047 이 적용되지 않았다(표 없음) — 전부 「새로 생김」');
      if (APPLY) throw new Error('047 을 먼저 적용하세요 — 아무것도 쓰지 않았습니다');
      console.log('\n보기만 했습니다. 쓰려면 047 적용 뒤 --apply.');
      return;
    }
    await c.query('BEGIN');
    const { rows: oldBiz } = await c.query('SELECT biz_code, biz_type, item_name, active FROM public.tb_s080_biz_code FOR UPDATE');
    const { rows: oldLink } = await c.query('SELECT biz_code, ksic_code, ksic_name, ksic_plus, active FROM public.tb_s080_biz_code_ksic FOR UPDATE');
    const ob = new Map(oldBiz.map((r) => [r.biz_code, r]));
    const ol = new Map(oldLink.map((r) => [`${r.biz_code}|${r.ksic_code}`, r]));
    const added = [], changed = [], removed = oldBiz.filter((r) => r.active && !biz.has(r.biz_code));
    for (const b of biz.values()) {
      const o = ob.get(b.biz_code);
      if (!o) added.push(b);
      else if (o.biz_type !== b.biz_type || o.item_name !== b.item_name || !o.active) changed.push(b);
    }
    const newLinks = new Map();
    for (const b of biz.values()) for (const l of b.links.values()) newLinks.set(`${b.biz_code}|${l.ksic_code}`, { biz_code: b.biz_code, ...l });
    const lAdded = [...newLinks.keys()].filter((k) => !ol.has(k));
    const lChanged = [...newLinks.entries()].filter(([k, l]) => ol.has(k) && (ol.get(k).ksic_name !== l.ksic_name || ol.get(k).ksic_plus !== l.ksic_plus || !ol.get(k).active));
    const lRemoved = oldLink.filter((r) => r.active && !newLinks.has(`${r.biz_code}|${r.ksic_code}`));
    console.log(`\n■ DB 와 대조(지금 사전 ${oldBiz.length}줄 · 연계 ${oldLink.length}줄)`);
    console.log(`  업종코드 — 새로 생김 ${added.length} · 바뀜 ${changed.length} · 빠짐(사용 안 함으로) ${removed.length}`);
    console.log(`  연계     — 새로 생김 ${lAdded.length} · 바뀜 ${lChanged.length} · 빠짐(사용 안 함으로) ${lRemoved.length}`);
    for (const b of changed.slice(0, ALL ? undefined : 20)) { const o = ob.get(b.biz_code); console.log(`    바뀜 ${b.biz_code}: 「${cut(o.item_name)}」→「${cut(b.item_name)}」${o.active ? '' : ' (다시 사용)'}`); }
    for (const r of removed.slice(0, ALL ? undefined : 20)) console.log(`    빠짐 ${r.biz_code} ${cut(r.item_name)}`);

    if (!APPLY) { await c.query('ROLLBACK'); console.log('\n보기만 했습니다. 쓰려면 --apply.'); return; }

    const now = new Date();
    for (const b of biz.values()) {
      await c.query(
        `INSERT INTO public.tb_s080_biz_code (biz_code, biz_type, item_name, tax_year, loaded_at, active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (biz_code) DO UPDATE SET biz_type = EXCLUDED.biz_type, item_name = EXCLUDED.item_name,
           tax_year = EXCLUDED.tax_year, loaded_at = EXCLUDED.loaded_at, active = true`,
        [b.biz_code, b.biz_type, b.item_name, TAX_YEAR, now],
      );
    }
    for (const l of newLinks.values()) {
      await c.query(
        `INSERT INTO public.tb_s080_biz_code_ksic (biz_code, ksic_code, ksic_name, ksic_plus, is_main, tax_year, loaded_at, active)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, true)
         ON CONFLICT (biz_code, ksic_code) DO UPDATE SET ksic_name = EXCLUDED.ksic_name, ksic_plus = EXCLUDED.ksic_plus,
           is_main = NULL, tax_year = EXCLUDED.tax_year, loaded_at = EXCLUDED.loaded_at, active = true`,
        [l.biz_code, l.ksic_code, l.ksic_name, l.ksic_plus, TAX_YEAR, now],
      );
    }
    if (removed.length) await c.query('UPDATE public.tb_s080_biz_code SET active = false WHERE biz_code = ANY($1)', [removed.map((r) => r.biz_code)]);
    for (const r of lRemoved) await c.query('UPDATE public.tb_s080_biz_code_ksic SET active = false WHERE biz_code = $1 AND ksic_code = $2', [r.biz_code, r.ksic_code]);
    await c.query('COMMIT');
    const { rows: [n] } = await c.query(`SELECT (SELECT count(*) FROM public.tb_s080_biz_code WHERE active)::int AS b,
      (SELECT count(*) FROM public.tb_s080_biz_code_ksic WHERE active)::int AS l`);
    console.log(`\n✔ 썼습니다 — 사용 중 사전 ${n.b}줄 · 연계 ${n.l}줄 (귀속 ${TAX_YEAR})`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
