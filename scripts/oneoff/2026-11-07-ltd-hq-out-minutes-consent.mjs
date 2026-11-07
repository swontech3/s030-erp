/**
 * 일회용(2026-11-07) — 유한회사 타관할 본점이전 서식 둘 다듬기(결정 2026-11-07).
 *
 *   「사원총회 의사록(유한회사, 변경)」 1장
 *     · 출석 현황 표의 「출력 때 입력」 6칸(9~11행 — {{memberCount}}명 · {{unitsTotal}}좌 · {{votingMemberCount}}명 ·
 *       {{votingUnits}}좌 · {{attendMemberCount}}명 · {{attendUnits}}좌): 칸 안 가운데 정렬(선에 붙지 않게).
 *       글자 · 테두리 · 세로 정렬은 그대로, align 만 left → center.
 *     · 서명란 21행 「의장 대표이사」 줄을 23행 · 25행 「이사」 줄과 같은 열 경계로:
 *         지금  열 1~2 빈칸 | 3~5 「의장 대표이사」 | 6~10 {{ceoName}} | 11 「(인)」
 *         고침  열 1   빈칸 | 2~4 「의장 대표이사」 | 5~9  {{ceoName}} | 10 「(인)」 | 11 빈칸
 *       (이사 줄: 열 1~3 빈칸 | 4 「이사」 | 5~9 이름 | 10 「(인)」 | 11 빈칸). 「의장 대표이사」는 열 4 하나(1.96cm)에
 *       들어가지 않아(12pt 6자 ≈ 2.7cm) 열 2~4(4.04cm)에 둔다 — 글자 · 왼쪽 정렬 · 크기는 그대로.
 *       빈칸(열 11)은 이사 줄의 빈칸과 같은 모양(왼쪽 · 위).
 *     · 서명란 이름표 칸(21행 「의장 대표이사」 · 23행 · 25행 「이사」)을 오른쪽 정렬 — 이름 칸 바로 앞에 붙는다.
 *   「이사과반수동의서」 1장
 *     · 7행 문장 — 지금 「… 작성하고\n이사가 …」는 첫 줄이 칸 폭을 넘어 「작 / 성하고」처럼 낱말 가운데서 한 번 더
 *       넘어간다(3줄). 줄바꿈을 낱말 사이 「… 이 동의서를\n작성하고 이사가 기명날인 또는 서명한다.」로 옮겨
 *       2줄 · 낱말 가운데서 끊기지 않게 한다(렌더러 word-break 는 고치지 않는다 — 그 문장 글만). 정렬 · 크기 · 행 높이 그대로.
 *     · 서명란 10행 「대표이사」 줄을 12행 「이사」 줄과 같은 열 경계로(의사록과 같은 방법):
 *         지금  열 1~3 빈칸 | 4~6 「대표이사」 | 7~11 {{ceoName}} | 12 「(인)」
 *         고침  열 1~4 빈칸 | 5   「대표이사」 | 6~10 {{ceoName}} | 11 「(인)」 | 12 빈칸
 *       (이사 줄: 열 1~4 빈칸 | 5 「이사」 | 6~10 이름 | 11 「(인)」 | 12 빈칸). 「대표이사」는 열 5(1.98cm)에 한 줄로
 *       들어간다(재서 확인 — 두 줄이면 멈춘다). 글자 · 정렬 · 크기 · 굵기는 그대로, 빈칸은 이사 줄 빈칸과 같은 모양.
 *
 * 보기 — 고치기 전 · 뒤를 값 있음 · 값 빔(종이, 빈칸 너비 포함) 두 경우로 헤드리스 Chrome 에 그려 잰다
 * (앱 인쇄 규칙 — `FormDocument` 와 같은 칸 · form-doc CSS · `inlineBlankWidths`, 2026-11-06 일회용과 같은 그리기):
 *   6칸 글의 왼쪽 · 오른쪽 여백 · 서명란 이름 칸 시작 · 「(인)」 가로 위치 · 동의서 문장 줄 수 · 표 높이(넘침).
 * 그림(PNG)을 <출력 폴더>에 남긴다(인자로 주면).
 *
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 한 트랜잭션으로 둘 다 쓰고 되읽는다.
 *   멈추는 경우(아무것도 쓰지 않는다): 서식이 이름으로 정확히 1건이 아님 · 바꿀 칸 글자 · 모양이 기대와 다름(이미 고친 것 포함) ·
 *   고친 뒤 자리표시가 달라짐 · 고친 뒤 표 높이가 달라짐(넘침) · 고친 뒤 세 줄의 「(인)」 위치가 다름 · 동의서 두 줄의 「(인)」 위치가 다름 · 이름표 · 이름이 두 줄 ·
 *   동의서 문장이 1줄이거나 3줄 이상 · 양식이 보기 뒤에 바뀜(수정 시각) · 되읽은 값이 다름.
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다. Chrome 이 있어야 한다.
 *
 *   npx tsx scripts/oneoff/2026-11-07-ltd-hq-out-minutes-consent.mjs <admin.env> [출력 폴더]            (보기)
 *   npx tsx scripts/oneoff/2026-11-07-ltd-hq-out-minutes-consent.mjs <admin.env> [출력 폴더] --apply    (쓰기)
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
  console.error('사용법: npx tsx scripts/oneoff/2026-11-07-ltd-hq-out-minutes-consent.mjs <admin.env> [출력 폴더] [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const ACTOR = 'oneoff-2026-11-07';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIN = '사원총회 의사록(유한회사, 변경)';
const CON = '이사과반수동의서';

/** 의사록 — 가운데로 둘 6칸(행, 열, 글). */
const MANUAL = [
  [8, 1, '{{memberCount}}명'], [8, 10, '{{unitsTotal}}좌'],
  [9, 1, '{{votingMemberCount}}명'], [9, 10, '{{votingUnits}}좌'],
  [10, 1, '{{attendMemberCount}}명'], [10, 10, '{{attendUnits}}좌'],
];
const SIGN_ROW = 20;
const DIRECTOR_ROWS = [22, 24];
const NONE = { top: false, right: false, bottom: false, left: false };
/** 의사록 21행 — 지금 모양(열 · 걸침 · 글)과 고친 모양. */
const SIGN_BEFORE = [[0, 2, undefined], [2, 3, '의장 대표이사'], [5, 5, '{{ceoName}}'], [10, 1, '(인)']];
const SIGN_AFTER = [[0, 1, undefined], [1, 3, '의장 대표이사'], [4, 5, '{{ceoName}}'], [9, 1, '(인)'], [10, 1, undefined]];
/** 이사 줄 모양(맞출 기준) — 바뀌지 않았는지 본다. */
const DIRECTOR_SHAPE = [[0, 3], [3, 1], [4, 5], [9, 1], [10, 1]];

/** 동의서 7행. */
const CON_ROW = 6;
const CON_BEFORE = '위 사항에 대하여 이사 과반수가 동의하였음을 증명하기 위하여 이 동의서를 작성하고\n이사가 기명날인 또는 서명한다.';
const CON_AFTER = '위 사항에 대하여 이사 과반수가 동의하였음을 증명하기 위하여 이 동의서를\n작성하고 이사가 기명날인 또는 서명한다.';
/** 동의서 서명란 — 10행 대표이사 줄 지금 · 고친 모양, 12행 이사 줄(기준). */
const CON_SIGN_ROW = 9;
const CON_DIRECTOR_ROW = 11;
const CON_SIGN_BEFORE = [[0, 3, undefined], [3, 3, '대표이사'], [6, 5, '{{ceoName}}'], [11, 1, '(인)']];
const CON_SIGN_AFTER = [[0, 4, undefined], [4, 1, '대표이사'], [5, 5, '{{ceoName}}'], [10, 1, '(인)'], [11, 1, undefined]];
const CON_DIRECTOR_SHAPE = [[0, 4], [4, 1], [5, 5], [10, 1], [11, 1]];

/** 「값 있음」 — 실제 모양에 가까운 값. 나머지는 짧은 글. */
const FILLED = {
  companyName: '유한회사 가나다라마바사아자차카타', ceoName: '남궁가나다', directorName: '홍길동',
  memberCount: '2', unitsTotal: '10,000', votingMemberCount: '2', votingUnits: '10,000', attendMemberCount: '2', attendUnits: '10,000',
  newHqAddress: '서울특별시 강남구 테헤란로 123, 4층 401호(역삼동, 가나다빌딩)', resolutionDate: '2026년 11월 7일',
  relocationDate: '2026년 11월 7일', meetingEndTime: '10시 30분',
};
const sample = (k) => FILLED[k] ?? '가나다';

// ── 그리기 · 재기 — FormDocument 와 같은 칸(2026-11-06 일회용과 같은 그리기) ─────────────
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
    return `<td data-col="${c}" colspan="${x?.colSpan ?? 1}" rowspan="${x?.rowSpan ?? 1}" style="text-align:${x?.align ?? 'left'};vertical-align:${x?.valign ?? 'middle'};font-size:${x?.fontSize ?? font.size}pt;font-weight:${x?.bold ? 700 : 400};border-top:${edge(b?.top)};border-right:${edge(b?.right)};border-bottom:${edge(b?.bottom)};border-left:${edge(b?.left)}">${x?.text ? cellHtml(x.text, values, cellFit) : ''}</td>`;
  }).join('')}</tr>`).join('');
  const w = page.colWidths.reduce((a, b) => a + b, 0);
  return `<section data-id="${esc(id)}" class="page"><table style="width:${w}cm;margin-top:${page.marginTop ?? DEFAULT_MARGIN_TOP}cm;font-family:'${font.family}'"><colgroup>${page.colWidths.map((cw) => `<col style="width:${cw}cm">`).join('')}</colgroup><tbody>${trs}</tbody></table></section>`;
}
const CSS = `body{margin:0;background:#fff} .page{width:210mm;height:297mm;box-sizing:border-box;padding:12mm 0;display:flex;flex-direction:column;align-items:center;overflow:hidden}
table{border-collapse:collapse;table-layout:fixed} td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5;color:#000} .blank{display:inline-block}`;
function chrome(dir, extra) {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=5000', ...extra], { maxBuffer: 1 << 28, timeout: 240000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
}
/**
 * 장마다 — 표 높이(cm) · 칸마다 { 행, 열, 칸 왼쪽 · 오른쪽, 글 왼쪽 · 오른쪽(빈칸 포함), 줄 수 } · 「(인)」 가로 위치.
 * 위치는 모두 표 왼쪽에서 cm.
 */
function measure(items) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${items.map((t) => pageHtml(t.id, t.page, t.values, t.font)).join('')}<script>
const cm=(p)=>+(p*2.54/96).toFixed(2); const out={};
document.querySelectorAll('section').forEach((s)=>{
  const t=s.querySelector('table'); const L=t.getBoundingClientRect().left; const seals=[]; const cells=[];
  t.querySelectorAll('td').forEach((td)=>{
    const tb=td.getBoundingClientRect(); const r=document.createRange(); r.selectNodeContents(td);
    const rects=[...r.getClientRects()].filter((q)=>q.width>0);
    const tops=[...new Set(rects.map((q)=>Math.round(q.top)))];
    const xs=rects.map((q)=>q.left), xe=rects.map((q)=>q.right);
    cells.push({row:+td.parentElement.dataset.row, col:+td.dataset.col, cl:cm(tb.left-L), cr:cm(tb.right-L),
      tl:xs.length?cm(Math.min(...xs)-L):null, tr:xe.length?cm(Math.max(...xe)-L):null, lines:tops.length,
      over: td.scrollHeight>td.clientHeight+1});
  });
  const walk=document.createTreeWalker(t,NodeFilter.SHOW_TEXT); let n;
  while((n=walk.nextNode())){ let i=-1; while((i=n.data.indexOf('(인)',i+1))>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+3); const b=r.getBoundingClientRect();
    seals.push({row:+n.parentElement.closest('tr').dataset.row, x:cm(b.left-L)}); } }
  out[s.dataset.id]={h:+(t.getBoundingClientRect().height*2.54/96).toFixed(3), cells, seals};
});
document.body.setAttribute('data-out',encodeURIComponent(JSON.stringify(out)));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'min-con-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  const dom = chrome(dir, ['--dump-dom', 'file:///' + file.split(path.sep).join('/')]);
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return JSON.parse(decodeURIComponent(m[1]));
}
function shot(page, values, font, png) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'min-con-shot-'));
  const file = path.join(dir, 's.html');
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${pageHtml('x', page, values, font)}</body></html>`);
  chrome(dir, [`--screenshot=${png}`, '--window-size=794,1123', '--hide-scrollbars', 'file:///' + file.split(path.sep).join('/')]);
}
const filledOf = (def) => Object.fromEntries(definitionTokens(def).map((t) => [t, sample(t)]));
const shapeOf = (cells, row) => cells.filter((x) => x.row === row).sort((a, b) => a.col - b.col);

// ── 고치기 ──────────────────────────────────────────────────────────
function fixMinutes(raw, page) {
  for (const [row, col, text] of MANUAL) {
    const x = page.cells.find((c) => c.row === row && c.col === col);
    if (!x || x.text !== text) throw new Error(`의사록 ${row + 1}행 ${col + 1}열 글자가 기대와 다르다`);
    if (x.align !== 'left') throw new Error(`의사록 ${row + 1}행 ${col + 1}열 정렬이 left 가 아니다(${x.align}) — 이미 고친 것 같다`);
  }
  const sign = shapeOf(page.cells, SIGN_ROW);
  if (JSON.stringify(sign.map((x) => [x.col, x.colSpan ?? 1, x.text])) !== JSON.stringify(SIGN_BEFORE)) throw new Error('의사록 21행 서명 줄 모양이 기대와 다르다 — 이미 고친 것 같다');
  if (sign.some((x) => JSON.stringify(x.border) !== JSON.stringify(NONE) || (x.rowSpan ?? 1) !== 1)) throw new Error('의사록 21행 테두리 · 걸침이 기대와 다르다');
  for (const r of DIRECTOR_ROWS) {
    if (JSON.stringify(shapeOf(page.cells, r).map((x) => [x.col, x.colSpan ?? 1])) !== JSON.stringify(DIRECTOR_SHAPE)) throw new Error(`의사록 ${r + 1}행 이사 줄 모양이 기대와 다르다`);
  }
  if (page.colWidths.length !== 11) throw new Error('의사록 열이 11개가 아니다');

  for (const [row, col] of [[SIGN_ROW, 2], ...DIRECTOR_ROWS.map((r) => [r, 3])]) {
    const x = page.cells.find((c) => c.row === row && c.col === col);
    if (x.align !== 'left') throw new Error(`의사록 ${row + 1}행 이름표 정렬이 left 가 아니다(${x.align}) — 이미 고친 것 같다`);
  }

  const next = structuredClone(raw);
  const p = next.pages[0];
  for (const [row, col] of MANUAL) p.cells.find((c) => c.row === row && c.col === col).align = 'center';
  p.cells = reshapeRow(p.cells, SIGN_ROW, SIGN_AFTER, page.cells.find((c) => c.row === DIRECTOR_ROWS[0] && c.col === 10));
  // 이름표 칸 오른쪽 정렬 — 21행(고친 뒤 열 2~4) · 23행 · 25행(열 4)
  p.cells.find((c) => c.row === SIGN_ROW && c.text === '의장 대표이사').align = 'right';
  for (const r of DIRECTOR_ROWS) p.cells.find((c) => c.row === r && c.col === 3).align = 'right';
  return next;
}
/**
 * 서명 줄 하나를 새 열 경계로 — 글 있는 칸은 그 칸 모양 그대로 열 · 걸침만 바꾸고, 빈칸은 맨 앞 칸은 지금
 * 맨 앞 빈칸 모양, 그 밖은 `blank`(기준 줄 끝 빈칸) 모양.
 */
function reshapeRow(cells, row, after, blank) {
  const byText = new Map(shapeOf(cells, row).map((x) => [x.text, x]));
  const sized = after.map(([col, span, text]) => {
    if (text === undefined) {
      const base = col === 0 ? byText.get(undefined) : blank;
      const { text: _t, row: _r, col: _c, colSpan: _s, ...rest } = structuredClone(base);
      return { row, col, colSpan: span, ...rest };
    }
    return { ...structuredClone(byText.get(text)), col, colSpan: span };
  });
  return [...cells.filter((c) => c.row !== row), ...sized];
}
function fixConsent(raw, page) {
  const x = page.cells.find((c) => c.row === CON_ROW && c.col === 0);
  if (!x || x.text !== CON_BEFORE) throw new Error('동의서 7행 글자가 기대와 다르다 — 이미 고친 것 같다');
  if ((x.colSpan ?? 1) !== page.colWidths.length) throw new Error('동의서 7행이 한 칸(전체 열)이 아니다');
  const sign = shapeOf(page.cells, CON_SIGN_ROW);
  if (JSON.stringify(sign.map((c) => [c.col, c.colSpan ?? 1, c.text])) !== JSON.stringify(CON_SIGN_BEFORE)) throw new Error('동의서 10행 서명 줄 모양이 기대와 다르다 — 이미 고친 것 같다');
  if (sign.some((c) => JSON.stringify(c.border) !== JSON.stringify(NONE) || (c.rowSpan ?? 1) !== 1)) throw new Error('동의서 10행 테두리 · 걸침이 기대와 다르다');
  if (JSON.stringify(shapeOf(page.cells, CON_DIRECTOR_ROW).map((c) => [c.col, c.colSpan ?? 1])) !== JSON.stringify(CON_DIRECTOR_SHAPE)) throw new Error('동의서 12행 이사 줄 모양이 기대와 다르다');
  if (page.colWidths.length !== 12) throw new Error('동의서 열이 12개가 아니다');
  const next = structuredClone(raw);
  const p = next.pages[0];
  p.cells.find((c) => c.row === CON_ROW && c.col === 0).text = CON_AFTER;
  p.cells = reshapeRow(p.cells, CON_SIGN_ROW, CON_SIGN_AFTER, page.cells.find((c) => c.row === CON_DIRECTOR_ROW && c.col === 11));
  return next;
}

async function main() {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const load = async (name) => {
      const rows = (await c.query(`SELECT id, name, definition, updated_at FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [name])).rows;
      if (rows.length !== 1) throw new Error(`「${name}」 이 ${rows.length}건이다(1건이어야 한다)`);
      return { id: rows[0].id, name, raw: rows[0].definition, updatedAt: rows[0].updated_at.toISOString(), def: migrateDefinition(rows[0].definition) };
    };
    const forms = [await load(MIN), await load(CON)];
    const [m, k] = forms;
    if (m.def.pages.length !== 1 || k.def.pages.length !== 1) throw new Error('두 서식이 1장이 아니다');
    m.next = fixMinutes(m.raw, m.def.pages[0]);
    k.next = fixConsent(k.raw, k.def.pages[0]);
    for (const f of forms) {
      f.nextDef = parseDefinition(migrateDefinition(f.next));
      if (JSON.stringify(definitionTokens(f.nextDef)) !== JSON.stringify(definitionTokens(f.def))) throw new Error(`「${f.name}」 고친 뒤 자리표시가 달라졌다`);
    }

    const items = [];
    for (const f of forms) for (const [s, d] of [['전', f.def], ['뒤', f.nextDef]]) {
      items.push({ id: `${f.name}|${s}|값`, page: d.pages[0], values: filledOf(d), font: d.font });
      items.push({ id: `${f.name}|${s}|빔`, page: d.pages[0], values: {}, font: d.font });
    }
    const got = measure(items);
    const at = (id, row, col) => got[id].cells.find((x) => x.row === row && x.col === col);
    const modes = [['값', '값 있음'], ['빔', '값 빔']];

    // ① 의사록 6칸
    const t1 = [];
    for (const [s] of [['전'], ['뒤']]) for (const [mode, ml] of modes) for (const [row, col] of MANUAL) {
      const x = at(`${MIN}|${s}|${mode}`, row, col);
      t1.push({ '': `고치기 ${s}`, 경우: ml, 칸: `${row + 1}행 ${col + 1}열`, '칸 폭': +(x.cr - x.cl).toFixed(2), '왼쪽 여백': x.tl === null ? '-' : +(x.tl - x.cl).toFixed(2), '오른쪽 여백': x.tr === null ? '-' : +(x.cr - x.tr).toFixed(2), 넘침: x.over ? '있음' : '없음' });
    }
    console.log(`\n■ ① 「${MIN}」 출석 현황 6칸 — 글 왼쪽 · 오른쪽 여백(cm)`);
    console.table(t1);

    // ② 의사록 서명란
    const t2 = [];
    for (const [s] of [['전'], ['뒤']]) for (const [mode, ml] of modes) {
      const id = `${MIN}|${s}|${mode}`;
      const seal = (row) => got[id].seals.find((q) => q.row === row)?.x ?? null;
      /** 이름 칸 — 고치기 전 21행은 열 6(0부터 5), 그 밖은 열 5(0부터 4). 이름표 칸 — 전 21행 열 3, 뒤 21행 열 2, 이사 줄 열 4. */
      const nameCol = (row) => at(id, row, s === '전' && row === SIGN_ROW ? 5 : 4)?.cl ?? null;
      const labelCell = (row) => at(id, row, row !== SIGN_ROW ? 3 : s === '전' ? 2 : 1);
      for (const row of [SIGN_ROW, ...DIRECTOR_ROWS]) {
        const lb = labelCell(row);
        t2.push({ '': `고치기 ${s}`, 경우: ml, 줄: row === SIGN_ROW ? '21행 의장 대표이사' : `${row + 1}행 이사`, '이름표 글 끝': lb.tr, '이름표 줄 수': lb.lines, '이름 칸 시작': nameCol(row), '(인)': seal(row) });
      }
    }
    console.log(`\n■ ② 「${MIN}」 서명란 — 이름표 글 끝 · 이름 칸 시작 · 「(인)」 가로 위치(표 왼쪽에서 cm)`);
    console.table(t2);

    // ③ 동의서 문장
    const t3 = [];
    for (const [s] of [['전'], ['뒤']]) for (const [mode, ml] of modes) {
      const x = at(`${CON}|${s}|${mode}`, CON_ROW, 0);
      t3.push({ '': `고치기 ${s}`, 경우: ml, '줄 수': x.lines, 넘침: x.over ? '있음' : '없음' });
    }
    console.log(`\n■ ③ 「${CON}」 7행 문장 — 줄 수(줄바꿈 1개 + 줄 수 2 = 저절로 넘어간 곳 없음 = 낱말 가운데서 끊기지 않음)`);
    console.table(t3);

    // ④ 동의서 서명란
    const t5 = [];
    for (const [s] of [['전'], ['뒤']]) for (const [mode, ml] of modes) {
      const id = `${CON}|${s}|${mode}`;
      const seal = (row) => got[id].seals.find((q) => q.row === row)?.x ?? null;
      const label = (row) => at(id, row, row === CON_DIRECTOR_ROW || s === '뒤' ? 4 : 3);
      const name = (row) => at(id, row, row === CON_SIGN_ROW && s === '전' ? 6 : 5);
      for (const row of [CON_SIGN_ROW, CON_DIRECTOR_ROW]) t5.push({ '': `고치기 ${s}`, 경우: ml, 줄: row === CON_SIGN_ROW ? '10행 대표이사' : '12행 이사', '이름표 줄 수': label(row).lines, '이름 칸 시작': name(row).cl, '이름 줄 수': name(row).lines, '(인)': seal(row) });
    }
    console.log(`\n■ ④ 「${CON}」 서명란 — 이름 칸 시작 · 「(인)」 가로 위치(표 왼쪽에서 cm)`);
    console.table(t5);

    // 표 높이 — 넘침
    const t4 = forms.flatMap((f) => modes.map(([mode, ml]) => ({ 서식: f.name, 경우: ml, '전(cm)': got[`${f.name}|전|${mode}`].h, '뒤(cm)': got[`${f.name}|뒤|${mode}`].h })));
    console.log('\n■ 표 높이 — 같으면 넘침 없음');
    console.table(t4);

    // 멈춤 조건
    if (t4.some((r) => r['전(cm)'] !== r['뒤(cm)'])) throw new Error('고친 뒤 표 높이가 달라졌다(넘침)');
    for (const [mode] of modes) {
      const xs = [SIGN_ROW, ...DIRECTOR_ROWS].map((row) => got[`${MIN}|뒤|${mode}`].seals.find((q) => q.row === row)?.x);
      if (xs.some((v) => v === undefined) || new Set(xs).size !== 1) throw new Error('고친 뒤 세 줄의 「(인)」 위치가 다르다');
      const lines = at(`${CON}|뒤|${mode}`, CON_ROW, 0).lines;
      if (lines < 2 || lines > 2) throw new Error(`동의서 문장이 ${lines}줄이다(2줄이어야 한다)`);
      const cs = [CON_SIGN_ROW, CON_DIRECTOR_ROW].map((row) => got[`${CON}|뒤|${mode}`].seals.find((q) => q.row === row)?.x);
      if (cs.some((v) => v === undefined) || cs[0] !== cs[1]) throw new Error('고친 뒤 동의서 두 줄의 「(인)」 위치가 다르다');
    }
    if (t2.filter((r) => r[''] === '고치기 뒤').some((r) => r['이름표 줄 수'] !== 1)) throw new Error('고친 뒤 의사록 이름표가 한 줄이 아니다');
    if (t5.filter((r) => r[''] === '고치기 뒤').some((r) => r['이름표 줄 수'] !== 1 || r['이름 줄 수'] > 1)) throw new Error('고친 뒤 동의서 이름표 · 이름이 한 줄이 아니다');
    if (t1.filter((r) => r[''] === '고치기 뒤').some((r) => r.넘침 === '있음')) throw new Error('고친 뒤 6칸에 넘침이 있다');

    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      for (const [f, tag] of [[m, 'minutes'], [k, 'consent']]) for (const [s, d] of [['before', f.def], ['after', f.nextDef]]) {
        for (const [mode, values] of [['filled', filledOf(d)], ['empty', {}]]) {
          const png = path.resolve(outDir, `${tag}-${s}-${mode}.png`);
          shot(d.pages[0], values, d.font, png);
          console.log('그림', png);
        }
      }
    }

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했다 — 쓰려면 --apply');
      return;
    }
    for (const f of forms) {
      const { rows: cur } = await c.query(`SELECT updated_at FROM public.tb_s080_form_templates WHERE id = $1 FOR UPDATE`, [f.id]);
      if (cur.length !== 1 || cur[0].updated_at.toISOString() !== f.updatedAt) throw new Error(`「${f.name}」 이 보기 뒤에 바뀌었다`);
      await c.query(`UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = $3 WHERE id = $1`, [f.id, JSON.stringify(f.next), ACTOR]);
      const back = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE id = $1`, [f.id])).rows[0].definition;
      if (JSON.stringify(migrateDefinition(back)) !== JSON.stringify(migrateDefinition(f.next))) throw new Error(`「${f.name}」 되읽은 값이 다르다 — 되돌린다`);
    }
    await c.query('COMMIT');
    console.log(`\n적용했다 — 「${MIN}」 6칸 · 21 · 23 · 25행 · 「${CON}」 7행 · 10행`);
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
