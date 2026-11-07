/**
 * 일회용(2026-10-31) — 법무 표양식 「정관(유한회사)」 등록(유한회사 설립 1단계, 결정 2026-10-31).
 *
 * ★ 본문: `doc/법무_유한회사_정관_초안.md` §3 의 36조 그대로(`2026-10-31-ltd-articles.json` — 조마다 `from` = 지금
 *   주식회사 정관의 조). 글자는 그 파일 그대로 옮기고, 번호 항목(「1.」)만 지금 정관처럼 앞에 세 칸을 띄운다.
 * ★ 모양: 지금 표양식 「정관」(법인설립 · 주식회사)을 **읽어서 따른다** — 표지 장은 그대로 복사, 본문은 조마다
 *   `from` 조의 제목 행 · 본문 행 칸 모양(글자 크기 · 굵기 · 테두리 · 맞춤)을 쓴다. 장 머리 · 장 앞 빈 줄 · 말미
 *   (사원 머리 · 날짜 · 서명란)도 지금 정관의 것을 쓴다. 지금 정관은 사람이 손본 모양(2026-10-13)이라 다시 그리지 않는다.
 *   · 제6조의 `{{articlesMemberTable}}` 은 제2조 목적 목록과 같은 들여 쓴 칸(왼쪽 빈 열)에 둔다
 *   · 말미의 「발기인」 → 「사원」 · `{{articlesFounderList}}` → `{{articlesMemberSignList}}`
 * ★ 행 높이 — 헤드리스 Chrome 으로 최대 값(사업목적 20줄 · 사원 2명)을 넣어 잰다(10-12 스크립트와 같은 규칙).
 *   지금 정관과 글자가 같은 행은 지금 높이보다 낮추지 않는다(사람이 늘린 높이를 지킨다).
 * ★ 장 나누기 — 조(제목 + 본문)는 장을 넘기지 않는다. 장 머리(와 그 앞뒤 빈 줄)는 다음 조와 붙여 둔다.
 * ★ 법무 표시: 법인설립 · 건마다 · 회사 형태 유한회사(`companyType: 'A'`) — 유한회사 건에만 뜬다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 한 트랜잭션으로 쓴다. 같은 이름이 있으면 아무것도 쓰지 않고 멈춘다.
 *   정의는 shared `parseDefinition` 을 통과해야 한다. 쓰는 표: `tb_s080_form_templates` 한 줄(넣기만).
 *
 *   npx tsx scripts/oneoff/2026-10-31-ltd-articles-form.mjs <admin.env>              (보기)
 *   npx tsx scripts/oneoff/2026-10-31-ltd-articles-form.mjs <admin.env> --apply      (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseDefinition, definitionTokens } from '../../packages/shared/src/domain/form-template.ts';
import { INCORP_PRINT_FIELDS, buildIncorpCasePrintValues } from '../../packages/shared/src/domain/incorporation-print.ts';
import { buildIncorporationSnapshot, parseIncorpInfo } from '../../packages/shared/src/domain/incorporation-detail.ts';
import { INCORP_LTD_MEMBER_MAX, INCORP_PURPOSE_MAX } from '../../packages/shared/src/domain/incorporation.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-10-31-ltd-articles-form.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FROM_NAME = '정관';
const NAME = '정관(유한회사)';
const MARK = { domain: 'incorporation', unit: 'case', companyType: 'A' };

/** 종이 안쪽 높이(cm) — A4 29.7 에서 위아래 12mm(10-12 스크립트와 같다). */
const PAGE_INNER_CM = 29.7 - 1.2 * 2;
const NO = { top: false, right: false, bottom: false, left: false };
const ALL = { top: true, right: true, bottom: true, left: true };
const LABELS = Object.fromEntries(INCORP_PRINT_FIELDS.map((f) => [f.name, f.label]));
const ARTICLES = JSON.parse(fs.readFileSync(path.join(HERE, '2026-10-31-ltd-articles.json'), 'utf8'));
const ITEM = /^\s*\d+\./;

// =============================================================================
// 최대 값 — 사업목적 20줄 · 사원 2명(긴 이름 · 주소)
// =============================================================================
const PURPOSE_SAMPLES = ['소프트웨어 개발 및 공급업', '전자상거래 소매업(통신판매업)', '경영 컨설팅업', '정보통신 관련 연구개발 및 기술용역업', '광고 대행업 및 광고물 제작업', '부동산 임대업', '교육 서비스업(온라인 강의 포함)', '수출입업 및 무역 대행업', '데이터베이스 구축 및 온라인 정보 제공업', '인공지능 관련 소프트웨어 개발업'];
const ADDR = { zipCode: '06164', address: '서울 강남구 테헤란로 123', addressDetail: '4층 401호 (역삼동, 에스원비즈빌딩)' };
function worstValues() {
  const info = parseIncorpInfo({
    nameKo: '유한회사 가나다라마바사아자차카타', nameEn: 'Ganadara Global Solutions', hq: ADDR,
    capitalAmount: 999_990_000, parValue: 10_000, fiscalStart: '01-01', fiscalEnd: '12-31', plannedDate: '2026-12-31',
    purposes: Array.from({ length: INCORP_PURPOSE_MAX }, (_, i) => PURPOSE_SAMPLES[i % PURPOSE_SAMPLES.length]).join('\n'),
  });
  if (!info.ok) throw new Error('표본 설립 정보가 틀렸다');
  const P = (name, units, roles) => ({ name, isFounder: true, isDirector: roles.includes('D'), isAuditor: false, isRepresentative: roles.includes('R'), unitsSubscribed: units, appointmentDate: '2026-12-31', ...ADDR, rrn: '9001011234567' });
  const persons = [P('남궁가나다', 50_000, 'DR'), P('선우라마바', 49_999, 'D')].slice(0, INCORP_LTD_MEMBER_MAX);
  const snapshot = buildIncorporationSnapshot(info.value, persons.map((p, i) => ({ ...p, id: `p${i}`, rrnMasked: null, sortOrder: i + 1 })), 'A');
  return buildIncorpCasePrintValues({ snapshot, persons, setting: null, taxSetting: null, methodName: '유한회사 발기설립', inputs: { applyDate: '2026-12-31', writeDate: '2026-12-31' } });
}
const fill = (t, values) => t.replace(/\{\{([^}]+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);

// =============================================================================
// 지금 정관 읽기 — 정의의 장 → 행(10-12 스크립트의 행 모양), 그리고 조 · 장 머리 · 말미로 나눈다
// =============================================================================
function defPageRows(p) {
  return p.rowHeights.map((h, r) => ({
    h,
    cells: p.cells.filter((c) => c.row === r).map((c) => ({ col: c.col, span: c.colSpan ?? 1, rowSpan: c.rowSpan, text: c.text, align: c.align, valign: c.valign, fontSize: c.fontSize, bold: c.bold, border: c.border })),
  }));
}
const textOf = (row) => row.cells.find((c) => c.text)?.text ?? null;
const isBlank = (row) => textOf(row) === null;
const isHead = (row) => /^제\s*\d+\s*장/.test(textOf(row) ?? '') && row.cells.some((c) => c.bold);
const titleNo = (row) => {
  const c = row.cells.find((x) => x.text);
  const m = c?.bold ? /^제(\d+)조 \(/.exec(c.text) : null;
  return m ? Number(m[1]) : null;
};

function readOld(def) {
  const cols = def.pages[1].colWidths;
  for (const p of def.pages.slice(1)) if (JSON.stringify(p.colWidths) !== JSON.stringify(cols)) throw new Error('지금 정관 본문 장들의 열 폭이 다르다');
  const rows = def.pages.slice(1).flatMap(defPageRows);
  const articles = new Map(); // 조 → { title, body[] }
  const heads = []; // { row, gapBefore, gapAfter }
  let tail = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const no = titleNo(r);
    if (no !== null) {
      const body = [];
      while (i + 1 < rows.length && !isBlank(rows[i + 1]) && !isHead(rows[i + 1]) && titleNo(rows[i + 1]) === null && textOf(rows[i + 1]) !== '발기인') body.push(rows[++i]);
      articles.set(no, { title: r, body });
    } else if (isHead(r)) {
      heads.push({ row: r, gapBefore: i > 0 && isBlank(rows[i - 1]) ? rows[i - 1] : null, gapAfter: i + 1 < rows.length && isBlank(rows[i + 1]) ? rows[i + 1] : null });
    } else if (textOf(r) === '발기인' && tail === null) {
      tail = rows.slice(i);
      break;
    }
  }
  if (articles.size !== 53) throw new Error(`지금 정관의 조가 ${articles.size}개다(53개여야 한다)`);
  if (!tail) throw new Error('지금 정관의 말미(발기인)를 찾지 못했다');
  return { cover: def.pages[0], cols, articles, heads, tail };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const withText = (row, text) => ({ ...clone(row), cells: row.cells.map((c) => (c.text ? { ...clone(c), text } : clone(c))) });

/** 새 정관의 블록들 — 장 머리 블록(빈 줄 포함) · 조 블록 · 말미 블록. `keep` = 지금과 글자가 같은 행(높이를 낮추지 않는다). */
function buildBlocks(old) {
  const blocks = [];
  const [firstHead, ...otherHeads] = old.heads;
  const plainHead = otherHeads.find((h) => h.row.cells.find((c) => c.text)?.fontSize === firstHead.row.cells.find((c) => c.text)?.fontSize) ?? otherHeads[0];
  const purposeRow = old.articles.get(2).body.find((r) => textOf(r) === '{{articlesPurposeList}}');
  if (!purposeRow) throw new Error('지금 정관 제2조의 목적 목록 행이 없다');
  for (const it of ARTICLES.items) {
    if (it.head) {
      if (it.first) {
        // 첫 장 머리 — 지금 글자(「제 1 장　총　칙」)와 뒤 빈 줄 그대로
        blocks.push({ kind: 'head', rows: [clone(firstHead.row), ...(firstHead.gapAfter ? [clone(firstHead.gapAfter)] : [])], keep: [true, true] });
      } else {
        const rows = [...(plainHead.gapBefore ? [clone(plainHead.gapBefore)] : []), withText(plainHead.row, it.head)];
        blocks.push({ kind: 'head', rows, keep: rows.map(() => false) });
      }
      continue;
    }
    const src = old.articles.get(it.from);
    if (!src) throw new Error(`제${it.no}조 — 지금 정관에 제${it.from}조가 없다`);
    const titleText = `제${it.no}조 (${it.title})`;
    const placeholders = it.lines.filter((l) => /^\{\{(articlesPurposeList|articlesMemberTable)\}\}$/.test(l));
    const bodyText = it.lines.filter((l) => !placeholders.includes(l)).map((l) => (ITEM.test(l) ? `   ${l}` : l)).join('\n');
    const bodyStyle = src.body.find((r) => textOf(r) !== '{{articlesPurposeList}}') ?? src.body[0];
    const rows = [withText(src.title, titleText)];
    const keep = [titleText === textOf(src.title)];
    if (bodyText) {
      rows.push(withText(bodyStyle, bodyText));
      keep.push(bodyText === textOf(bodyStyle));
    }
    for (const ph of placeholders) {
      // 목적 목록 · 사원별 출자좌수 — 들여 쓴 칸(제2조 목적 행의 모양), 글자 크기는 이 조의 본문 크기
      const row = withText(purposeRow, ph);
      const size = bodyStyle?.cells.find((c) => c.text)?.fontSize;
      for (const c of row.cells) if (c.text && size) c.fontSize = size;
      rows.push(row);
      keep.push(ph === '{{articlesPurposeList}}' && it.from === 2);
    }
    blocks.push({ kind: 'article', no: it.no, rows, keep });
  }
  const tail = old.tail.map((r) => {
    const t = textOf(r);
    if (t === '발기인') return withText(r, '사원');
    if (t === '{{articlesFounderList}}') return withText(r, '{{articlesMemberSignList}}');
    return clone(r);
  });
  blocks.push({ kind: 'tail', rows: tail, keep: tail.map((r) => textOf(r) !== '{{articlesMemberSignList}}') });
  return blocks;
}

// =============================================================================
// 재기 — 10-12 스크립트와 같은 규칙(행 높이 0 으로 그려 글자가 차지하는 높이만 읽는다)
// =============================================================================
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function tableHtml(id, cols, rows, values, fontSize, family) {
  const n = cols.length;
  const covered = new Set();
  const trs = rows.map((r, ri) => {
    const tds = [];
    const anchors = new Map(r.cells.map((c) => [c.col, c]));
    for (let ci = 0; ci < n; ci++) {
      if (covered.has(`${ri}:${ci}`)) continue;
      const c = anchors.get(ci);
      if (!c) { tds.push('<td style="border:0"></td>'); continue; }
      const span = c.span === 'all' ? n - ci : c.span ?? 1;
      const rs = c.rowSpan ?? 1;
      for (let a = 0; a < rs; a++) for (let b = 0; b < span; b++) if (a || b) covered.add(`${ri + a}:${ci + b}`);
      const bd = c.border ?? {};
      const side = (k) => (bd[k] === false ? '0' : '1px solid #000');
      tds.push(`<td colspan="${span}" rowspan="${rs}" style="border-top:${side('top')};border-right:${side('right')};border-bottom:${side('bottom')};border-left:${side('left')};text-align:${c.align ?? 'left'};vertical-align:${c.valign ?? 'middle'};font-size:${c.fontSize ?? fontSize}pt;font-weight:${c.bold ? 700 : 400}">${esc(fill(c.text ?? '', values))}</td>`);
      ci += span - 1;
    }
    return `<tr style="height:0">${tds.join('')}</tr>`;
  });
  return `<table data-id="${id}" style="width:${cols.reduce((a, b) => a + b, 0)}cm;font-family:'${family}'"><colgroup>${cols.map((w) => `<col style="width:${w}cm">`).join('')}</colgroup><tbody>${trs.join('')}</tbody></table>`;
}
function measureAll(tables) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0} table{border-collapse:collapse;table-layout:fixed;margin-bottom:40px}
td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5}
</style></head><body>${tables.map((t) => tableHtml(t.id, t.cols, t.rows, t.values, t.fontSize, t.family)).join('')}<script>
const cm=(p)=>p*2.54/96; const out=[];
document.querySelectorAll('table').forEach((t)=>out.push(t.dataset.id+'='+[...t.querySelectorAll('tr')].map((tr)=>cm(tr.getBoundingClientRect().height).toFixed(3)).join(',')));
document.body.setAttribute('data-out',out.join(';'));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltd-articles-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=3000', '--dump-dom', 'file:///' + file.split(path.sep).join('/')], { maxBuffer: 1 << 26, timeout: 90000 }).toString('utf8');
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return Object.fromEntries(m[1].split(';').map((s) => { const [id, list] = s.split('='); return [id, list.split(',').map(Number)]; }));
}
const roundUp = (h) => Math.ceil((h + 0.01) * 100 - 1e-9) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => n.toFixed(2);

/** 행 → 정의의 장. 칸이 없는 자리는 테두리 없는 빈 칸(엔진은 빈 자리에 선을 긋는다). */
function toPage(cols, rows, heights, marginTop) {
  const n = cols.length;
  const covered = new Set();
  const cells = [];
  rows.forEach((r, ri) => {
    for (const c of r.cells) {
      const span = c.span === 'all' ? n - c.col : c.span ?? 1;
      const rowSpan = c.rowSpan ?? 1;
      for (let a = 0; a < rowSpan; a++) for (let b = 0; b < span; b++) covered.add(`${ri + a}:${c.col + b}`);
      const cell = { row: ri, col: c.col };
      if (span > 1) cell.colSpan = span;
      if (rowSpan > 1) cell.rowSpan = rowSpan;
      if (c.text) cell.text = c.text;
      cell.border = c.border ?? ALL;
      if (c.align && c.align !== 'left') cell.align = c.align;
      if (c.valign && c.valign !== 'middle') cell.valign = c.valign;
      if (c.fontSize) cell.fontSize = c.fontSize;
      if (c.bold) cell.bold = true;
      cells.push(cell);
    }
  });
  rows.forEach((_, ri) => {
    for (let ci = 0; ci < n; ci++) if (!covered.has(`${ri}:${ci}`)) cells.push({ row: ri, col: ci, border: NO });
  });
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return { colWidths: cols, rowHeights: heights.map((h) => Math.max(0.01, +h.toFixed(2))), marginTop, cells };
}

/** 장 나누기 — 장 머리 블록은 다음 블록과 붙인다. 블록은 장을 넘기지 않는다. */
function paginate(blocks, usable) {
  const pages = [];
  let cur = { rows: [], heights: [] };
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    let rows = blocks[i].rows;
    let hs = blocks[i].heights;
    if (blocks[i].kind === 'head' && i + 1 < blocks.length) { rows = [...rows, ...blocks[i + 1].rows]; hs = [...hs, ...blocks[i + 1].heights]; i++; }
    const h = sum(hs);
    if (h > usable) throw new Error(`한 장보다 큰 블록(${fmt(h)}cm)`);
    if (used + h > usable && cur.rows.length) { pages.push(cur); cur = { rows: [], heights: [] }; used = 0; }
    // 장 맨 위의 빈 줄은 뺀다(장 머리 앞 간격은 장 가운데에서만 뜻이 있다)
    while (cur.rows.length === 0 && rows.length && isBlank(rows[0])) { hs = hs.slice(1); rows = rows.slice(1); }
    cur.rows.push(...rows); cur.heights.push(...hs); used += sum(hs);
  }
  if (cur.rows.length) pages.push(cur);
  return pages;
}

// =============================================================================
// 보기 · 쓰기
// =============================================================================
(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const from = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [FROM_NAME])).rows;
    if (from.length !== 1) throw new Error(`「${FROM_NAME}」 양식이 ${from.length}개다(1개여야 한다)`);
    const oldDef = from[0].definition;
    if (oldDef.legal?.domain !== 'incorporation') throw new Error(`「${FROM_NAME}」 이 법인설립 양식이 아니다`);
    const old = readOld(oldDef);
    const marginTop = oldDef.pages[1].marginTop ?? 0.8;
    const usable = PAGE_INNER_CM - marginTop;
    const family = oldDef.font.family;
    const values = worstValues();
    const problems = [];

    const blocks = buildBlocks(old);
    const measured = measureAll(blocks.map((b, i) => ({ id: `b${i}`, cols: old.cols, rows: b.rows, values, fontSize: oldDef.font.size, family })));
    blocks.forEach((b, i) => {
      b.heights = b.rows.map((r, j) => (isBlank(r) ? r.h : Math.max(b.keep[j] ? r.h : 0, roundUp(measured[`b${i}`][j]))));
    });
    const body = paginate(blocks, usable);
    const pages = [clone(old.cover), ...body.map((p) => toPage(old.cols, p.rows, p.heights, marginTop))];
    const def = parseDefinition({ version: 2, font: oldDef.font, legal: MARK, pages });
    def.manualFields = definitionTokens(def).map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);

    // 대조 — 36조 제목 · 본문이 정의에 다 있나, 지금 정관의 주식회사 말이 남지 않았나
    const texts = def.pages.flatMap((p) => p.cells).map((x) => x.text).filter(Boolean);
    const all = texts.join('\n');
    for (const it of ARTICLES.items.filter((x) => x.no)) {
      if (!texts.includes(`제${it.no}조 (${it.title})`)) problems.push(`제${it.no}조 제목이 없다`);
      for (const l of it.lines) if (!all.includes(l)) problems.push(`제${it.no}조 줄이 없다: ${l.slice(0, 30)}`);
    }
    for (const w of ['주주', '주식', '발기인', '이사회', '주권', '사채', '공고']) if (all.includes(w)) problems.push(`지금 정관의 말 「${w}」이 남았다`);
    const tokens = definitionTokens(def);
    const unknown = tokens.filter((t) => !LABELS[t]);
    if (unknown.length) problems.push(`이름표 밖 자리표시 ${unknown.join(',')}`);
    for (const t of ['capitalAmount', 'contributionUnitAmount', 'articlesMemberTable', 'articlesMemberSignList']) if (!tokens.includes(t)) problems.push(`자리표시 ${t} 이 없다`);

    console.log(`■ ${NAME}  (법인설립 · 건마다 · 유한회사 · ${family} ${def.font.size}pt) — 모양: 표양식 「${FROM_NAME}」`);
    console.log(`  본문: ${ARTICLES.source}`);
    def.pages.forEach((p, pi) => {
      const h = sum(p.rowHeights) + (p.marginTop ?? 0);
      const fits = h <= PAGE_INNER_CM + 1e-9;
      if (!fits) problems.push(`${pi + 1}장: 높이 넘침(${fmt(h)}cm)`);
      const nos = p.cells.map((x) => /^제(\d+)조 \(/.exec(x.text ?? '')?.[1]).filter(Boolean);
      console.log(`  ${pi + 1}장 — 행 ${p.rowHeights.length}개 · 높이 ${fmt(sum(p.rowHeights))} + 위 여백 ${p.marginTop ?? 0} = ${fmt(h)} / ${fmt(PAGE_INNER_CM)}cm${nos.length ? ` · 제${nos[0]}조~제${nos[nos.length - 1]}조` : pi === 0 ? ' · 표지' : ''}${fits ? '' : ' ★ 넘침'}`);
    });
    console.log(`  자리표시 ${tokens.length}개: ${tokens.join(' · ')}`);
    console.log(`  법무 표시: ${JSON.stringify(def.legal)}`);
    console.log(`  최대 값: 사업목적 ${INCORP_PURPOSE_MAX}줄 · 사원 ${INCORP_LTD_MEMBER_MAX}명`);

    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT 1 FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [NAME]);
    if (rows.length) problems.push(`이미 있는 이름: ${NAME}`);
    if (problems.length) throw new Error(problems.join(' / '));
    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 1건. 쓰려면 --apply');
      return;
    }
    await c.query(
      `INSERT INTO public.tb_s080_form_templates
         (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
       VALUES ($1, 1, $2, $3, 'T', $4::jsonb, now(), now(), 'oneoff-2026-10-31', 'oneoff-2026-10-31')`,
      [randomUUID(), NAME, '법인설립(유한회사) — doc/법무_유한회사_정관_초안.md 36조 · 모양은 표양식 「정관」(2026-10-31)', JSON.stringify(def)],
    );
    await c.query('COMMIT');
    console.log('\n썼습니다 — 1건');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
