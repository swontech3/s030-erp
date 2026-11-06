/**
 * 일회용(2026-11-06) — 「본점이전(관할외) 등기신청서(유한회사)」 2장: 대표이사 성명 줄과 대리인 성명 줄의
 * 「(인)」을 같은 세로 위치에 둔다(결정 2026-11-06).
 *
 *   지금: 두 줄이 각각 7열을 걸친 한 칸이고 「(인)」 앞을 공백으로 띄웠다 — 이름 길이 · 빈칸에 따라 「(인)」이 밀린다.
 *   고침: 두 줄(10행 · 13행 — 0부터 세면 row 9 · 12)을 같은 열 경계로 나눈다.
 *     열 0~1(3.21cm) 「대표이사 성  명」/「대리인    성  명」(지금 글 그대로 — 「성 명」 자리 그대로)
 *     열 2~3(4.36cm) 이름 — `{{ceoName}}` / 빈칸
 *     열 4  (2.53cm) 「(인)」
 *     열 5~6(5.06cm) 「(전화 : {{ceoPhone}})」/「(전화 :             )」
 *   테두리: 원래 칸의 왼쪽 · 오른쪽 선을 맨 앞 · 맨 뒤 칸에 둔다(위 · 아래 없음 — 원래와 같다). 안쪽 경계는 선 없음.
 *   세로 정렬 · 글자 크기는 원래 칸 그대로(위 · 바탕 크기). 행 높이 · 다른 행 · 다른 장 · 자리표시 · 법무 표시는 그대로.
 *
 * 보기 — 고치기 전 · 뒤의 「(인)」 가로 위치(표 왼쪽에서 cm)를 값 있음 · 값 빔(종이, 빈칸 너비 포함) 두 경우로
 * 헤드리스 Chrome 에 그려 잰다(앱 인쇄 규칙 — `FormDocument` 와 같은 칸 · form-doc CSS · `inlineBlankWidths`).
 * 같은 어긋남이 다른 법무 신청서 · 신고서에도 있는지 같은 방식으로 재서 표로만 보인다(고치지 않는다).
 * 그림(PNG)을 <출력 폴더>에 남긴다(인자로 주면).
 *
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 한 트랜잭션으로 쓰고 되읽는다.
 *   멈추는 경우(아무것도 쓰지 않는다): 서식이 이름으로 정확히 1건이 아님 · 바꿀 칸 글자 · 테두리가 기대와 다름 ·
 *   이미 나눈 것 같음 · 고친 뒤 표 높이가 달라짐 · 고친 뒤 두 줄의 「(인)」 위치가 다름 · 양식이 보기 뒤에 바뀜(수정 시각) ·
 *   되읽은 값이 다름.
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다. Chrome 이 있어야 한다.
 *
 *   npx tsx scripts/oneoff/2026-11-06-ltd-hq-out-seal-align.mjs <admin.env> [출력 폴더]            (보기)
 *   npx tsx scripts/oneoff/2026-11-06-ltd-hq-out-seal-align.mjs <admin.env> [출력 폴더] --apply    (쓰기)
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
  console.error('사용법: npx tsx scripts/oneoff/2026-11-06-ltd-hq-out-seal-align.mjs <admin.env> [출력 폴더] [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const ACTOR = 'oneoff-2026-11-06';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TARGET = '본점이전(관할외) 등기신청서(유한회사)';
const PAGE = 1; // 2장
const SIDE = { top: false, right: true, bottom: false, left: true };
const ROWS = [
  {
    row: 9,
    before: '대표이사 성  명  {{ceoName}}                    (인)     (전화 : {{ceoPhone}})',
    label: '대표이사 성  명',
    name: '{{ceoName}}',
    phone: '(전화 : {{ceoPhone}})',
  },
  {
    row: 12,
    before: '대리인    성  명                                         (인)     (전화 :             )',
    label: '대리인    성  명',
    name: null,
    phone: '(전화 :             )',
  },
];
/** 같은 어긋남을 재 볼 다른 서식(고치지 않는다). */
const OTHERS = ['법인변경등록1', '설립등기신청서', '설립등기신청서(유한회사)', '인감·개인신고서'];
/** 「값 있음」 — 이름 · 전화만 실제 모양으로, 나머지는 짧은 글. */
const FILLED = { ceoName: '홍길동', ceoPhone: '02-123-4567' };
const sample = (k) => FILLED[k] ?? '가나다';

// ── 고친 칸 ────────────────────────────────────────────────────────────
function splitRow(cells, spec, base) {
  const keep = cells.filter((c) => c.row !== spec.row);
  const { valign, fontSize, bold } = base;
  const extra = { ...(valign ? { valign } : {}), ...(fontSize ? { fontSize } : {}), ...(bold ? { bold } : {}) };
  const none = { top: false, right: false, bottom: false, left: false };
  return [
    ...keep,
    { row: spec.row, col: 0, colSpan: 2, text: spec.label, border: { ...none, left: SIDE.left }, ...extra },
    { row: spec.row, col: 2, colSpan: 2, ...(spec.name ? { text: spec.name } : {}), border: none, ...extra },
    { row: spec.row, col: 4, text: '(인)', border: none, ...extra },
    { row: spec.row, col: 5, colSpan: 2, text: spec.phone, border: { ...none, right: SIDE.right }, ...extra },
  ];
}

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
  return `<section data-id="${esc(id)}" class="page"><table style="width:${w}cm;margin-top:${page.marginTop ?? DEFAULT_MARGIN_TOP}cm;font-family:'${font.family}'"><colgroup>${page.colWidths.map((cw) => `<col style="width:${cw}cm">`).join('')}</colgroup><tbody>${trs}</tbody></table></section>`;
}
const CSS = `body{margin:0;background:#fff} .page{width:210mm;height:297mm;box-sizing:border-box;padding:12mm 0;display:flex;flex-direction:column;align-items:center;overflow:hidden}
table{border-collapse:collapse;table-layout:fixed} td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5;color:#000} .blank{display:inline-block}`;
function chrome(dir, extra) {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=5000', ...extra], { maxBuffer: 1 << 28, timeout: 240000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
}
/** 장마다 — 표 높이(cm) · 「(인)」 마다 { 행, 가로 위치(표 왼쪽에서 cm) }. */
function measure(items) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${items.map((t) => pageHtml(t.id, t.page, t.values, t.font)).join('')}<script>
const cm=(p)=>p*2.54/96; const out={};
document.querySelectorAll('section').forEach((s)=>{
  const t=s.querySelector('table'); const L=t.getBoundingClientRect().left; const seals=[];
  const walk=document.createTreeWalker(t,NodeFilter.SHOW_TEXT); let n;
  while((n=walk.nextNode())){ let i=-1; while((i=n.data.indexOf('(인)',i+1))>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+3); const b=r.getBoundingClientRect();
    seals.push({row:+n.parentElement.closest('tr').dataset.row, x:+cm(b.left-L).toFixed(2), y:+cm(b.top).toFixed(2)}); } }
  out[s.dataset.id]={h:+cm(t.getBoundingClientRect().height).toFixed(3), seals};
});
document.body.setAttribute('data-out',encodeURIComponent(JSON.stringify(out)));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-align-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  const dom = chrome(dir, ['--dump-dom', 'file:///' + file.split(path.sep).join('/')]);
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return JSON.parse(decodeURIComponent(m[1]));
}
function shot(page, values, font, png) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-shot-'));
  const file = path.join(dir, 's.html');
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${pageHtml('x', page, values, font)}</body></html>`);
  chrome(dir, [`--screenshot=${png}`, '--window-size=794,1123', '--hide-scrollbars', 'file:///' + file.split(path.sep).join('/')]);
}
const filledOf = (def) => Object.fromEntries(definitionTokens(def).map((t) => [t, sample(t)]));

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
    const f = await load(TARGET);
    const page = f.def.pages[PAGE];
    if (!page) throw new Error(`「${TARGET}」 에 ${PAGE + 1}장이 없다`);
    for (const spec of ROWS) {
      const cells = page.cells.filter((x) => x.row === spec.row);
      if (cells.length !== 1) throw new Error(`${spec.row + 1}행 칸이 ${cells.length}개다 — 이미 나눈 것 같다`);
      const [cell] = cells;
      if (cell.col !== 0 || (cell.colSpan ?? 1) !== page.colWidths.length || (cell.rowSpan ?? 1) !== 1) throw new Error(`${spec.row + 1}행 칸 모양이 기대와 다르다`);
      if (cell.text !== spec.before) throw new Error(`${spec.row + 1}행 글자가 기대와 다르다`);
      if (JSON.stringify(cell.border) !== JSON.stringify(SIDE)) throw new Error(`${spec.row + 1}행 테두리가 기대와 다르다`);
    }
    if (page.colWidths.length !== 7) throw new Error('열이 7개가 아니다');

    // 고친 정의 — 원본 JSON 에서 그 장의 두 행만 바꾼 사본
    const next = structuredClone(f.raw);
    const rawPage = next.pages[PAGE];
    for (const spec of ROWS) {
      const base = page.cells.find((x) => x.row === spec.row);
      rawPage.cells = splitRow(rawPage.cells, spec, base);
    }
    const nextDef = parseDefinition(migrateDefinition(next));
    const nextPage = nextDef.pages[PAGE];
    if (JSON.stringify(definitionTokens(nextDef)) !== JSON.stringify(definitionTokens(f.def))) throw new Error('고친 뒤 자리표시가 달라졌다');

    // 재기 — 고치기 전 · 뒤, 값 있음 · 값 빔
    const others = [];
    for (const name of OTHERS) others.push(await load(name));
    const items = [];
    for (const [k, p, d] of [['전', page, f.def], ['뒤', nextPage, nextDef]]) {
      items.push({ id: `${TARGET}|${k}|값`, page: p, values: filledOf(d), font: d.font });
      items.push({ id: `${TARGET}|${k}|빔`, page: p, values: {}, font: d.font });
    }
    for (const o of others) o.def.pages.forEach((p, pi) => {
      items.push({ id: `${o.name}|${pi + 1}|값`, page: p, values: filledOf(o.def), font: o.def.font });
      items.push({ id: `${o.name}|${pi + 1}|빔`, page: p, values: {}, font: o.def.font });
    });
    const got = measure(items);

    const sealsAt = (id, rows) => got[id].seals.filter((s) => rows.includes(s.row));
    const view = [];
    for (const k of ['전', '뒤']) for (const mode of ['값', '빔']) {
      const s = sealsAt(`${TARGET}|${k}|${mode}`, ROWS.map((r) => r.row));
      const x = (row) => s.find((q) => q.row === row)?.x ?? null;
      view.push({ '': `고치기 ${k}`, 경우: mode === '값' ? '값 있음' : '값 빔', '대표이사 (인)': x(9), '대리인 (인)': x(12), 차이: x(9) === null || x(12) === null ? '-' : +(x(12) - x(9)).toFixed(2), '표 높이': got[`${TARGET}|${k}|${mode}`].h });
    }
    console.log(`\n■ 「${TARGET}」 ${PAGE + 1}장 — 「(인)」 가로 위치(표 왼쪽에서 cm)`);
    console.table(view);
    const after = view.filter((v) => v[''] === '고치기 뒤');
    if (after.some((v) => v.차이 !== 0)) throw new Error('고친 뒤에도 두 줄의 「(인)」 위치가 다르다');
    if (view.some((v) => v['표 높이'] !== view[0]['표 높이'])) throw new Error('고친 뒤 표 높이가 달라졌다');

    console.log('\n■ 고칠 칸(10행 · 13행 — 열 1~2 | 3~4 | 5 | 6~7, 열 폭 ' + page.colWidths.join(' · ') + ' cm)');
    console.table(nextPage.cells.filter((x) => ROWS.some((r) => r.row === x.row)).sort((a, b) => a.row - b.row || a.col - b.col)
      .map((x) => ({ 행: x.row + 1, 열: `${x.col + 1}~${x.col + (x.colSpan ?? 1)}`, 글: x.text ?? '', 테두리: Object.entries(x.border ?? {}).filter(([, v]) => v !== false).map(([e]) => e).join(',') || '없음' })));

    // 다른 서식 — 한 칸 안에서 「(인)」이 같은 장에 둘 이상인 경우만, 고치지 않는다
    const report = [];
    for (const o of others) o.def.pages.forEach((p, pi) => {
      for (const mode of ['값', '빔']) {
        const s = got[`${o.name}|${pi + 1}|${mode}`].seals;
        if (s.length < 2) continue;
        const xs = s.map((q) => q.x);
        report.push({ 서식: o.name, 장: pi + 1, 경우: mode === '값' ? '값 있음' : '값 빔', '(인) 가로 위치(cm, 위→아래)': xs.join(' · '), '가장 큰 차이': +(Math.max(...xs) - Math.min(...xs)).toFixed(2) });
      }
    });
    console.log('\n■ 다른 법무 신청서 · 신고서 — 같은 장의 「(인)」 가로 위치(고치지 않는다)');
    console.table(report);

    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      for (const [k, p, d] of [['before', page, f.def], ['after', nextPage, nextDef]]) {
        for (const [mode, values] of [['filled', filledOf(d)], ['empty', {}]]) {
          const png = path.resolve(outDir, `seal-align-${k}-${mode}.png`);
          shot(p, values, d.font, png);
          console.log('그림', png);
        }
      }
    }

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했다 — 쓰려면 --apply');
      return;
    }
    const { rows: cur } = await c.query(`SELECT updated_at FROM public.tb_s080_form_templates WHERE id = $1 FOR UPDATE`, [f.id]);
    if (cur.length !== 1 || cur[0].updated_at.toISOString() !== f.updatedAt) throw new Error(`「${TARGET}」 이 보기 뒤에 바뀌었다`);
    await c.query(`UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = $3 WHERE id = $1`, [f.id, JSON.stringify(next), ACTOR]);
    const back = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE id = $1`, [f.id])).rows[0].definition;
    if (JSON.stringify(migrateDefinition(back)) !== JSON.stringify(migrateDefinition(next))) throw new Error('되읽은 값이 다르다 — 되돌린다');
    await c.query('COMMIT');
    console.log(`\n적용했다 — 「${TARGET}」 ${PAGE + 1}장 10행 · 13행`);
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
