/**
 * 일회용(2026-11-06) — 법무 신청서 · 신고서 넷: 대표이사(신고인 본인) 줄과 대리인 줄의 「(인)」을 같은 세로 위치에 둔다
 * (결정 2026-11-06 — 「본점이전(관할외) 등기신청서(유한회사)」(`2026-11-06-ltd-hq-out-seal-align.mjs`)와 같은 방법).
 *
 *   두 줄을 같은 열 경계로 나눈다: 성명 글 | 이름 | 「(인)」 | 전화. 글은 그대로다(「(인)」 앞을 띄우던 공백만 칸 경계가 대신한다).
 *   테두리: 원래 칸의 왼쪽 · 오른쪽 선을 맨 앞 · 맨 뒤 칸에. 안쪽 경계는 선 없음. 세로 정렬 · 글자 크기는 원래 칸 그대로.
 *
 *   1. 「설립등기신청서」 · 「설립등기신청서(유한회사)」 3장 11행 · 14행 — 본점이전(관할외)와 같은 글 · 열 → 같은 경계
 *      열 1~2 성명 글(3.21cm) | 열 3~4 이름(4.36cm) | 열 5 「(인)」(2.53cm) | 열 6~7 전화(5.06cm)
 *   2. 「법인변경등록1」 2장 6행 — 신청인 ~ 귀중 11줄이 **한 칸**(6.72cm, 테두리 4변, 세로 가운데)이다. 두 줄만 나눌 수 없어
 *      줄마다 행으로 푼다: 위 여백 행 + 11줄(줄마다 9pt × 1.5 = 0.476cm) + 아래 여백 행 = 6.72cm(여백은 위아래 같게 —
 *      세로 가운데 그대로). 테두리는 바깥 4변만. 대표이사(5줄째) · 대리인(8줄째)만 열로 나눈다:
 *      열 1 성명 글(3.04cm) | 열 2~3 이름(4.55cm) | 열 4 「(인)」(2.52cm) | 열 5~6 전화(5.04cm). 다른 줄은 한 칸 그대로(글 그대로).
 *      아래 행은 번호만 밀린다(12행 늘어남). 6행에 겹쳐 숨은 옛 칸(열 2~6)은 그대로 둔다(위 여백 행이 덮는다).
 *   3. 「인감·개인신고서」 1장 16행 · 17행(신고인 본인 · 대리인) — 이름 자리표시가 없다:
 *      열 1~5 성명 글(7.74cm, 앞 공백 그대로 — 「성 명」 자리 그대로) | 열 6 「(인)#」/「(인)*」(4.31cm) | 열 7~11 전화(5.05cm).
 *      ★ 31행(인감(개인) 신고인 성명 (인)**)은 다른 칸이라 고치지 않는다.
 *
 * 보기 — 고치기 전 · 뒤의 「(인)」 위치(표 왼쪽에서 가로 cm · 세로 cm)와 표 높이를 값 있음 · 값 빔(종이, 빈칸 너비 포함)
 * 두 경우로 헤드리스 Chrome 에 그려 잰다(앱 인쇄 규칙 — `FormDocument` 와 같은 칸 · form-doc CSS · `inlineBlankWidths`).
 * 그림(PNG)을 <출력 폴더>에 남긴다(인자로 주면).
 *
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 한 트랜잭션으로 쓰고 되읽는다.
 *   멈추는 경우(아무것도 쓰지 않는다): 서식이 이름으로 정확히 1건이 아님 · 바꿀 칸 글자 · 테두리 · 높이가 기대와 다름 ·
 *   이미 나눈 것 같음 · 자리표시가 달라짐 · 고친 뒤 두 줄의 「(인)」 가로 위치가 다름 · 표 높이가 달라짐 · 장 높이를 넘음 ·
 *   칸 밖으로 넘침 · 「(인)」 세로 위치가 0.15cm 넘게 움직임 · 양식이 보기 뒤에 바뀜(수정 시각) · 되읽은 값이 다름.
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다. Chrome 이 있어야 한다.
 *
 *   npx tsx scripts/oneoff/2026-11-06-legal-seal-align.mjs <admin.env> [출력 폴더]            (보기)
 *   npx tsx scripts/oneoff/2026-11-06-legal-seal-align.mjs <admin.env> [출력 폴더] --apply    (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import {
  DEFAULT_MARGIN_TOP,
  definitionTokens,
  fitRowsOf,
  inlineBlankWidths,
  migrateDefinition,
  parseDefinition,
  splitTokens,
} from '../../packages/shared/src/domain/form-template.ts';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [envPath, outDir] = args;
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-06-legal-seal-align.mjs <admin.env> [출력 폴더] [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const ACTOR = 'oneoff-2026-11-06';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SIDE = { top: false, right: true, bottom: false, left: true };
const NONE = { top: false, right: false, bottom: false, left: false };
const LINE_CM = (9 * 1.5 * 2.54) / 72; // 9pt × 줄 간격 1.5
const MAX_Y_SHIFT_CM = 0.15;

/** 한 줄을 나눈 칸들 — parts: [시작 열, 걸침, 글|null]. 맨 앞 · 맨 뒤 칸에 왼쪽 · 오른쪽 선. */
function partsToCells(row, parts, extra, side) {
  return parts.map(([col, span, text], i) => ({
    row, col, ...(span > 1 ? { colSpan: span } : {}), ...(text ? { text } : {}),
    border: { ...NONE, ...(i === 0 && side.left ? { left: true } : {}), ...(i === parts.length - 1 && side.right ? { right: true } : {}) },
    ...extra,
  }));
}
const extraOf = (c) => ({ ...(c.valign ? { valign: c.valign } : {}), ...(c.fontSize ? { fontSize: c.fontSize } : {}), ...(c.bold ? { bold: c.bold } : {}) });

// ── 서식마다 ─────────────────────────────────────────────────────────────
/** 한 칸짜리 줄 두 개를 나눈다(설립등기신청서 · 인감·개인신고서). */
function rowSplitSpec(name, page, cols, rows) {
  return {
    name, page,
    check(p) {
      if (JSON.stringify(p.colWidths) !== JSON.stringify(cols)) throw new Error(`「${name}」 열 폭이 기대와 다르다`);
      for (const r of rows) {
        const cells = p.cells.filter((x) => x.row === r.row);
        if (cells.length !== 1) throw new Error(`「${name}」 ${r.row + 1}행 칸이 ${cells.length}개다 — 이미 나눈 것 같다`);
        const [c] = cells;
        if (c.col !== 0 || (c.colSpan ?? 1) !== cols.length || (c.rowSpan ?? 1) !== 1) throw new Error(`「${name}」 ${r.row + 1}행 칸 모양이 기대와 다르다`);
        if (c.text !== r.before) throw new Error(`「${name}」 ${r.row + 1}행 글자가 기대와 다르다`);
        if (JSON.stringify(c.border) !== JSON.stringify(SIDE)) throw new Error(`「${name}」 ${r.row + 1}행 테두리가 기대와 다르다`);
      }
    },
    apply(raw, p) {
      for (const r of rows) {
        const base = p.cells.find((x) => x.row === r.row);
        raw.cells = [...raw.cells.filter((x) => x.row !== r.row), ...partsToCells(r.row, r.parts, extraOf(base), SIDE)];
      }
    },
    sealRows: (p) => rows.map((r) => r.row),
    changedRows: rows.map((r) => r.row),
  };
}

const APPLY_COLS = [2.52, 0.69, 1.83, 2.53, 2.53, 2.53, 2.53];
const applyRows = [
  {
    row: 10,
    before: '대표이사 성  명  {{ceoName}}                    (인)     (전화 : {{ceoPhone}})',
    parts: [[0, 2, '대표이사 성  명'], [2, 2, '{{ceoName}}'], [4, 1, '(인)'], [5, 2, '(전화 : {{ceoPhone}})']],
  },
  {
    row: 13,
    before: '대리인    성  명                                         (인)     (전화 :             )',
    parts: [[0, 2, '대리인    성  명'], [2, 2, null], [4, 1, '(인)'], [5, 2, '(전화 :             )']],
  },
];

const SEAL_COLS = [0.31, 3.32, 0.59, 1.04, 2.48, 4.31, 1.12, 0.7, 2.02, 0.5, 0.71];
const sealRows = [
  {
    row: 15,
    before: '               신고인   본  인   성   명                          (인)# (전화 :                )',
    parts: [[0, 5, '               신고인   본  인   성   명'], [5, 1, '(인)#'], [6, 5, '(전화 :                )']],
  },
  {
    row: 16,
    before: '                        대리인   성   명                          (인)* (전화 :                )',
    parts: [[0, 5, '                        대리인   성   명'], [5, 1, '(인)*'], [6, 5, '(전화 :                )']],
  },
];

/** 법인변경등록1 2장 6행 — 한 칸 11줄을 줄마다 행으로. */
const CORP = {
  name: '법인변경등록1', page: 1, row: 5, height: 6.72,
  cols: [3.04, 2.02, 2.53, 2.52, 2.52, 2.52],
  lines: [
    '                                                                                                                      {{applyDate}}',
    '신청인       상  호  {{companyName}}',
    '                본  점  {{hqAddress}}',
    '',
    '대표이사   성  명   {{ceoName}}                         (인)     (전화 : {{ceoPhone}} )',
    '               주  소   {{ceoAddress}}',
    '',
    '대리인     성  명                                                 (인)     (전화 :                       )',
    '              주  소  ',
    '',
    '                                              지방법원      등기소  귀중',
  ],
  split: {
    4: [[0, 1, '대표이사   성  명'], [1, 2, '{{ceoName}}'], [3, 1, '(인)'], [4, 2, '(전화 : {{ceoPhone}} )']],
    7: [[0, 1, '대리인     성  명'], [1, 2, null], [3, 1, '(인)'], [4, 2, '(전화 :                       )']],
  },
};
const corpSpec = {
  name: CORP.name, page: CORP.page,
  check(p) {
    if (JSON.stringify(p.colWidths) !== JSON.stringify(CORP.cols)) throw new Error(`「${CORP.name}」 열 폭이 기대와 다르다`);
    if (p.rowHeights[CORP.row] !== CORP.height) throw new Error(`「${CORP.name}」 ${CORP.row + 1}행 높이가 기대와 다르다 — 이미 나눈 것 같다`);
    const c = p.cells.find((x) => x.row === CORP.row && x.col === 0);
    if (!c || c.text !== CORP.lines.join('\n') || (c.colSpan ?? 1) !== 6 || (c.rowSpan ?? 1) !== 1) throw new Error(`「${CORP.name}」 ${CORP.row + 1}행 글자 · 모양이 기대와 다르다`);
    if (c.border !== undefined || c.valign !== undefined || c.align !== undefined || c.fontSize !== undefined) throw new Error(`「${CORP.name}」 ${CORP.row + 1}행 테두리 · 정렬이 기대와 다르다`);
    if (p.cells.some((x) => (x.rowSpan ?? 1) > 1)) throw new Error(`「${CORP.name}」 행을 걸친 칸이 있다`);
  },
  apply(raw) {
    const n = CORP.lines.length;
    const add = n + 2 - 1; // 위 여백 + 줄 + 아래 여백 − 원래 1행
    const pad = +((CORP.height - n * LINE_CM) / 2).toFixed(3);
    const last = +(CORP.height - pad - n * LINE_CM).toFixed(3);
    if (pad <= 0) throw new Error('여백이 없다');
    const R = CORP.row;
    // 아래 행 번호 밀기 · 6행의 큰 칸 빼기(겹쳐 숨은 옛 칸 열 2~6 은 그대로 — 위 여백 행이 덮는다)
    raw.cells = raw.cells
      .filter((x) => !(x.row === R && x.col === 0))
      .map((x) => (x.row > R ? { ...x, row: x.row + add } : x));
    const full = (row, text, border) => ({ row, col: 0, colSpan: 6, ...(text ? { text } : {}), border, valign: 'top' });
    raw.cells.push(full(R, null, { ...NONE, top: true, left: true, right: true }));
    CORP.lines.forEach((text, i) => {
      const row = R + 1 + i;
      if (CORP.split[i]) raw.cells.push(...partsToCells(row, CORP.split[i], { valign: 'top' }, { left: true, right: true }));
      else raw.cells.push(full(row, text, { ...NONE, left: true, right: true }));
    });
    raw.cells.push(full(R + n + 1, null, { ...NONE, bottom: true, left: true, right: true }));
    raw.rowHeights = [...raw.rowHeights.slice(0, R), pad, ...CORP.lines.map(() => +LINE_CM.toFixed(3)), last, ...raw.rowHeights.slice(R + 1)];
    const sum = raw.rowHeights.slice(R, R + n + 2).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - CORP.height) > 0.005) throw new Error(`나눈 행 높이 합 ${sum} ≠ ${CORP.height}`);
  },
  sealRows: (p) => (p.rowHeights.length > 11 ? [CORP.row + 1 + 4, CORP.row + 1 + 7] : [CORP.row]),
};

const SPECS = [
  rowSplitSpec('설립등기신청서', 2, APPLY_COLS, applyRows),
  rowSplitSpec('설립등기신청서(유한회사)', 2, APPLY_COLS, applyRows),
  corpSpec,
  rowSplitSpec('인감·개인신고서', 0, SEAL_COLS, sealRows),
];
const FILLED = { ceoName: '홍길동', ceoPhone: '02-123-4567' };
const filledOf = (def) => Object.fromEntries(definitionTokens(def).map((t) => [t, FILLED[t] ?? '가나다']));

// ── 그리기 · 재기 — FormDocument 와 같은 칸 ────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function cellHtml(text, values, fit) {
  const pieces = splitTokens(text);
  const widths = inlineBlankWidths(pieces, fit);
  return pieces.map((p, i) => {
    if (p.kind === 'text') return esc(p.text);
    const v = values[p.name] ?? '';
    if (v !== '') return `<span>${esc(v)}</span>`;
    return widths[i] ? `<span class="blank" style="width:${widths[i]}em"></span>` : '';
  }).join('');
}
function pageHtml(id, page, values, font) {
  const covered = new Set();
  for (const c of page.cells) for (let a = 0; a < (c.rowSpan ?? 1); a++) for (let b = 0; b < (c.colSpan ?? 1); b++) if (a || b) covered.add(`${c.row + a},${c.col + b}`);
  const at = new Map(page.cells.map((c) => [`${c.row},${c.col}`, c]));
  const fit = fitRowsOf(page);
  const edge = (on) => (on === false ? 'none' : '1px solid #000');
  const trs = page.rowHeights.map((h, r) => `<tr data-row="${r}"${fit.has(r) ? '' : ` style="height:${h}cm"`}>${page.colWidths.map((_, c) => {
    if (covered.has(`${r},${c}`)) return '';
    const x = at.get(`${r},${c}`);
    const b = x?.border;
    const cellFit = { widthCm: page.colWidths.slice(c, c + (x?.colSpan ?? 1)).reduce((s, w) => s + w, 0), fontPt: x?.fontSize ?? font.size };
    return `<td colspan="${x?.colSpan ?? 1}" rowspan="${x?.rowSpan ?? 1}" style="text-align:${x?.align ?? 'left'};vertical-align:${x?.valign ?? 'middle'};font-size:${x?.fontSize ?? font.size}pt;font-weight:${x?.bold ? 700 : 400};border-top:${edge(b?.top)};border-right:${edge(b?.right)};border-bottom:${edge(b?.bottom)};border-left:${edge(b?.left)}">${x?.text ? cellHtml(x.text, values, cellFit) : ''}</td>`;
  }).join('')}</tr>`).join('');
  const w = page.colWidths.reduce((a, b) => a + b, 0);
  return `<section data-id="${esc(id)}" data-mt="${page.marginTop ?? DEFAULT_MARGIN_TOP}" class="page"><table style="width:${w}cm;margin-top:${page.marginTop ?? DEFAULT_MARGIN_TOP}cm;font-family:'${font.family}'"><colgroup>${page.colWidths.map((cw) => `<col style="width:${cw}cm">`).join('')}</colgroup><tbody>${trs}</tbody></table></section>`;
}
const CSS = `body{margin:0;background:#fff} .page{width:210mm;height:297mm;box-sizing:border-box;padding:12mm 0;display:flex;flex-direction:column;align-items:center;overflow:hidden}
table{border-collapse:collapse;table-layout:fixed} td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5;color:#000} .blank{display:inline-block}`;
function chrome(dir, extra) {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=5000', ...extra], { maxBuffer: 1 << 28, timeout: 240000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
}
/** 장마다 — 표 높이 · 쓸 높이 · 「(인)」 { 행, x, y }(표 왼쪽 · 위에서 cm) · 칸 밖으로 넘친 칸 수. */
function measure(items) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${items.map((t) => pageHtml(t.id, t.page, t.values, t.font)).join('')}<script>
const cm=(p)=>p*2.54/96; const out={};
document.querySelectorAll('section').forEach((s)=>{
  const t=s.querySelector('table'); const T=t.getBoundingClientRect(); const seals=[]; let over=0;
  const walk=document.createTreeWalker(t,NodeFilter.SHOW_TEXT); let n;
  while((n=walk.nextNode())){ let i=-1; while((i=n.data.indexOf('(인)',i+1))>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+3); const b=r.getBoundingClientRect();
    seals.push({row:+n.parentElement.closest('tr').dataset.row, x:+cm(b.left-T.left).toFixed(2), y:+cm(b.top-T.top).toFixed(2)}); } }
  t.querySelectorAll('td').forEach((td)=>{ if(td.scrollWidth>td.clientWidth+1) over++; });
  out[s.dataset.id]={h:+cm(T.height).toFixed(3), avail:+(29.7-2.4-(+s.dataset.mt)).toFixed(2), seals, over};
});
document.body.setAttribute('data-out',encodeURIComponent(JSON.stringify(out)));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-seal-align-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  const dom = chrome(dir, ['--dump-dom', 'file:///' + file.split(path.sep).join('/')]);
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return JSON.parse(decodeURIComponent(m[1]));
}
function shot(page, values, font, png) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-seal-shot-'));
  const file = path.join(dir, 's.html');
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${pageHtml('x', page, values, font)}</body></html>`);
  chrome(dir, [`--screenshot=${png}`, '--window-size=794,1123', '--hide-scrollbars', 'file:///' + file.split(path.sep).join('/')]);
}

async function main() {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const work = [];
    for (const spec of SPECS) {
      const rows = (await c.query(`SELECT id, name, definition, updated_at FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [spec.name])).rows;
      if (rows.length !== 1) throw new Error(`「${spec.name}」 이 ${rows.length}건이다(1건이어야 한다)`);
      const r = rows[0];
      const def = migrateDefinition(r.definition);
      const page = def.pages[spec.page];
      if (!page) throw new Error(`「${spec.name}」 에 ${spec.page + 1}장이 없다`);
      spec.check(page);
      const next = structuredClone(r.definition);
      spec.apply(next.pages[spec.page], page);
      const nextDef = parseDefinition(migrateDefinition(next));
      if (JSON.stringify(definitionTokens(nextDef)) !== JSON.stringify(definitionTokens(def))) throw new Error(`「${spec.name}」 고친 뒤 자리표시가 달라졌다`);
      work.push({ spec, id: r.id, updatedAt: r.updated_at.toISOString(), def, next, nextDef });
    }

    const items = [];
    for (const w of work) for (const [k, d] of [['전', w.def], ['뒤', w.nextDef]]) {
      items.push({ id: `${w.spec.name}|${k}|값`, page: d.pages[w.spec.page], values: filledOf(d), font: d.font });
      items.push({ id: `${w.spec.name}|${k}|빔`, page: d.pages[w.spec.page], values: {}, font: d.font });
    }
    const got = measure(items);

    const view = [];
    const problems = [];
    for (const w of work) for (const mode of ['값', '빔']) {
      const pick = (k, d) => {
        const m = got[`${w.spec.name}|${k}|${mode}`];
        const rows = w.spec.sealRows(d.pages[w.spec.page]);
        return { m, seals: m.seals.filter((s) => rows.includes(s.row)).slice(0, 2) };
      };
      const b = pick('전', w.def);
      const a = pick('뒤', w.nextDef);
      const ax = a.seals.map((s) => s.x);
      const dy = a.seals.map((s, i) => (b.seals[i] ? Math.abs(s.y - b.seals[i].y) : null));
      view.push({
        서식: w.spec.name, 장: w.spec.page + 1, 경우: mode === '값' ? '값 있음' : '값 빔',
        '전 (인) 가로': b.seals.map((s) => s.x).join(' · '), '뒤 (인) 가로': ax.join(' · '), '뒤 차이': ax.length === 2 ? +(ax[1] - ax[0]).toFixed(2) : '-',
        '세로 움직임': dy.map((v) => (v === null ? '-' : v.toFixed(2))).join(' · '),
        '표 높이 전→뒤': `${b.m.h} → ${a.m.h}`, 쓸높이: a.m.avail, '넘친 칸': a.m.over,
      });
      if (ax.length !== 2 || ax[0] !== ax[1]) problems.push(`「${w.spec.name}」 ${mode} — 고친 뒤 두 「(인)」 가로 위치가 다르다`);
      if (Math.abs(a.m.h - b.m.h) > 0.01) problems.push(`「${w.spec.name}」 ${mode} — 표 높이가 달라졌다(${b.m.h} → ${a.m.h})`);
      if (a.m.h > a.m.avail) problems.push(`「${w.spec.name}」 ${mode} — 장 높이를 넘는다`);
      if (a.m.over > b.m.over) problems.push(`「${w.spec.name}」 ${mode} — 칸 밖으로 넘친 칸이 늘었다`);
      if (dy.some((v) => v === null || v > MAX_Y_SHIFT_CM)) problems.push(`「${w.spec.name}」 ${mode} — 「(인)」 세로 위치가 ${MAX_Y_SHIFT_CM}cm 넘게 움직였다`);
    }
    console.log('\n■ 「(인)」 위치(표 왼쪽에서 가로 cm — 대표이사(본인) · 대리인) · 표 높이(cm)');
    console.table(view);

    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      for (const w of work) for (const [k, d] of [['before', w.def], ['after', w.nextDef]]) for (const [mode, values] of [['filled', filledOf(d)], ['empty', {}]]) {
        const png = path.resolve(outDir, `${w.spec.name.replace(/[\\/:*?"<>|() ,·]/g, '_')}-${k}-${mode}.png`);
        shot(d.pages[w.spec.page], values, d.font, png);
        console.log('그림', png);
      }
    }
    if (problems.length) throw new Error(`확인에 걸렸다:\n  ${problems.join('\n  ')}`);

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했다 — 쓰려면 --apply');
      return;
    }
    for (const w of work) {
      const { rows: cur } = await c.query(`SELECT updated_at FROM public.tb_s080_form_templates WHERE id = $1 FOR UPDATE`, [w.id]);
      if (cur.length !== 1 || cur[0].updated_at.toISOString() !== w.updatedAt) throw new Error(`「${w.spec.name}」 이 보기 뒤에 바뀌었다`);
      await c.query(`UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = $3 WHERE id = $1`, [w.id, JSON.stringify(w.next), ACTOR]);
    }
    const after = [];
    for (const w of work) {
      const back = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE id = $1`, [w.id])).rows[0].definition;
      const d = migrateDefinition(back);
      if (JSON.stringify(d) !== JSON.stringify(migrateDefinition(w.next))) throw new Error(`「${w.spec.name}」 되읽은 값이 다르다 — 되돌린다`);
      const p = d.pages[w.spec.page];
      after.push({ 서식: w.spec.name, 장: w.spec.page + 1, 행수: p.rowHeights.length, '칸 수': p.cells.length, 자리표시: definitionTokens(d).length, '장 수': d.pages.length });
    }
    console.table(after);
    await c.query('COMMIT');
    console.log(`\n적용했다 — 서식 ${work.length}건`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error('✘ 멈춤:', e.message, '(아무것도 쓰지 않았다)');
  process.exit(1);
});
