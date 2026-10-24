/**
 * `2026-10-11-legal-form-drafts.mjs` 의 도우미 — 워드(docx) 한 장을 표양식 정의(version 2)로 옮긴다. 읽기만 한다.
 *
 * 옮기는 규칙(사임서를 손으로 옮긴 방식과 같다):
 *   · 모든 표의 열 경계를 합쳐 **한 장짜리 격자** 하나를 만든다. 0.1cm 안의 경계는 하나로 본다
 *     (서명 줄 표들이 0.06cm 씩 어긋나 생기는 실 같은 열을 없앤다)
 *   · 표 밖 문단 = 모든 열을 덮는 **테두리 없는 행**. 표 칸 = 그 칸이 덮는 열을 colSpan 으로
 *   · 칸 테두리 = 원문 tcBorders 의 single 만 켠다. 바탕색 · 밑줄 · 선 색/굵기는 엔진에 없어 버린다(수용)
 *   · 행 높이(cm) = 문단: 앞 간격 + 줄 수 × 「정확히」 줄 간격 / 표 행: 원문 행 높이와 칸 안 문단 합 중 큰 것
 *   · 굵기 = 칸(문단)의 글자가 **전부** 굵을 때만 굵게. 일부만 굵으면 보고하고 보통으로 둔다
 * 각 행에 「엔진 최소 높이」(줄 수 × 1.5 × 글자 크기, 어림)를 함께 둔다 — 줄일 때 그 아래로 내리지 않는다.
 */
import { execFileSync } from 'node:child_process';

const TW = 567; // twip / cm
const BODY_CM = 17.35; // 원문 본문 폭(21 − 1.8 × 2)
const pt2cm = (pt) => (pt * 2.54) / 72;
const r2 = (n) => Math.round(n * 100) / 100;
const attr = (s, n) => { const m = (s || '').match(new RegExp(`${n}="([^"]*)"`)); return m ? m[1] : null; };
const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const NO = { top: false, right: false, bottom: false, left: false };

function runs(p) {
  return [...p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((m) => {
    const r = m[0];
    const sz = Number(attr(r.match(/<w:sz [^>]*>/)?.[0], 'w:val') || 20) / 2;
    let text = '';
    for (const t of r.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:br\/>|<w:tab\/>/g)) {
      text += t[0] === '<w:br/>' ? '\n' : t[0] === '<w:tab/>' ? '\t' : decode(t[1]);
    }
    return { text, sz, b: /<w:b\/>/.test(r) };
  });
}

function para(p) {
  const rs = runs(p).filter((r) => r.text !== '');
  const sp = p.match(/<w:spacing w:after[^>]*>/)?.[0] || '';
  const jc = attr(p.match(/<w:jc [^>]*>/)?.[0], 'w:val');
  const boldAll = rs.length > 0 && rs.every((r) => r.b);
  return {
    text: rs.map((r) => r.text).join(''),
    size: rs.length ? Math.max(...rs.map((r) => r.sz)) : null,
    boldAll,
    boldSome: rs.some((r) => r.b) && !boldAll,
    align: jc === 'center' ? 'center' : jc === 'right' ? 'right' : 'left',
    before: Number(attr(sp, 'w:before') || 0) / TW,
    after: Number(attr(sp, 'w:after') || 0) / TW,
    exact: attr(sp, 'w:lineRule') === 'exact' ? Number(attr(sp, 'w:line')) / TW : null,
  };
}

function lineCount(text, size, widthCm) {
  let n = 0;
  for (const seg of text.split('\n')) {
    let w = 0;
    for (const ch of seg) w += /[ㄱ-힣一-鿿]/.test(ch) ? pt2cm(size) : pt2cm(size) * 0.55;
    n += Math.max(1, Math.ceil(w / Math.max(0.5, widthCm)));
  }
  return n;
}

function paraHeights(pp, widthCm) {
  const size = pp.size ?? 10.5;
  const lines = pp.text === '' ? 1 : lineCount(pp.text, size, widthCm);
  return {
    src: pp.before + pp.after + lines * (pp.exact ?? pt2cm(size) * 1.2),
    min: pp.text === '' ? 0 : lines * 1.5 * pt2cm(size),
  };
}

/**
 * docx → `{ colWidths, rows: [{ height, min, blank, cells }], notes }`. 칸의 `row` 는 아직 없다(행 순서가 곧 번호).
 * @param bodySize 양식 기본 글자 크기 — 이 크기와 같은 칸은 fontSize 를 적지 않는다.
 */
export function convertDocx(file, bodySize = 10.5) {
  const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { maxBuffer: 1 << 26 }).toString('utf8');
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)[1];
  const blocks = [...body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)].map((m) => m[0]);

  const bounds = [0, BODY_CM];
  for (const b of blocks.filter((x) => x.startsWith('<w:tbl>'))) {
    let acc = 0;
    for (const g of b.matchAll(/<w:gridCol w:w="(\d+)"/g)) { acc += Number(g[1]) / TW; bounds.push(acc); }
  }
  const edges = [];
  for (const v of bounds.sort((a, b) => a - b)) if (!edges.length || v - edges[edges.length - 1] > 0.1) edges.push(v);
  edges[edges.length - 1] = BODY_CM;
  const snap = (x) => edges.reduce((best, e, i) => (Math.abs(e - x) < Math.abs(edges[best] - x) ? i : best), 0);
  const colWidths = edges.slice(1).map((e, i) => r2(e - edges[i]));
  const C = colWidths.length;
  const notes = [];
  const style = (cell, pp) => {
    if (pp.size && pp.size !== bodySize) cell.fontSize = pp.size;
    if (pp.boldAll) cell.bold = true;
    if (pp.boldSome) notes.push(`일부만 굵던 글자 → 보통: ${JSON.stringify(pp.text.slice(0, 40))}`);
  };

  const rows = [];
  for (const b of blocks) {
    if (!b.startsWith('<w:tbl>')) {
      const pp = para(b);
      const h = paraHeights(pp, BODY_CM);
      const cell = { col: 0, colSpan: C, border: { ...NO } };
      if (pp.text) {
        Object.assign(cell, { text: pp.text, align: pp.align, valign: pp.before > 0.3 ? 'bottom' : 'middle' });
        style(cell, pp);
      }
      rows.push({ height: h.src, min: Math.min(h.min, h.src), blank: !pp.text, cells: [cell] });
      continue;
    }
    const grid = [...b.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((g) => Number(g[1]) / TW);
    const gx = [0];
    for (const g of grid) gx.push(gx[gx.length - 1] + g);
    for (const tr of b.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
      const trH = Number(attr(tr[0].match(/<w:trHeight [^>]*>/)?.[0], 'w:val') || 0) / TW;
      let gi = 0, content = 0, min = 0;
      const cells = [];
      for (const tcm of tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)) {
        const tc = tcm[0];
        const span = Number(attr(tc.match(/<w:gridSpan [^>]*>/)?.[0], 'w:val') || 1);
        const c0 = snap(gx[gi]), c1 = snap(gx[gi + span]);
        gi += span;
        const ps = [...tc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => para(m[0])).filter((p) => p.text !== '');
        const bd = tc.match(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/)?.[1] || '';
        const edge = (n) => new RegExp(`<w:${n} w:val="single"`).test(bd);
        const va = attr(tc.match(/<w:vAlign [^>]*>/)?.[0], 'w:val');
        const cell = {
          col: c0,
          ...(c1 - c0 > 1 ? { colSpan: c1 - c0 } : {}),
          align: ps[0]?.align ?? 'left',
          valign: va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : 'top',
          border: { top: edge('top'), right: edge('right'), bottom: edge('bottom'), left: edge('left') },
        };
        if (ps.length) {
          cell.text = ps.map((p) => p.text).join('\n');
          style(cell, { ...ps[0], size: Math.max(...ps.map((p) => p.size ?? bodySize)), boldAll: ps.every((p) => p.boldAll), boldSome: ps.some((p) => p.boldSome), text: cell.text });
          let c = 0, m = 0;
          for (const p of ps) { const h = paraHeights(p, edges[c1] - edges[c0] - 0.1); c += h.src; m += h.min; }
          content = Math.max(content, c);
          min = Math.max(min, m);
        }
        cells.push(cell);
      }
      const height = Math.max(trH, content);
      rows.push({ height, min: Math.min(min, height), blank: false, cells });
    }
  }
  return { colWidths, rows, notes };
}

/**
 * 1장에 넣기 — 사용자 지시(2026-10-11) 순서대로, 넘칠 때만:
 *   1) 행 높이 · 문단 앞 간격 — 글자가 든 행의 「원문 높이 − 최소 높이」를 같은 비율로 줄인다
 *   2) 빈 줄 행 — 그래도 넘치면 빈 줄 행을 같은 비율로 줄이고, 다 써도 넘치면 지운다
 *   3) 글자 크기 — 그래도 넘치면 기본 글자 크기를 0.5pt 씩(최소 9.5pt) 내린다(부르는 쪽이 다시 옮긴다)
 * 돌려주는 것: 고친 rows · 한 일 목록 · 넘침 여부. 높이는 0.01cm 로 자른다.
 */
export function fitOnePage(rows, targetCm) {
  const steps = [];
  const sum = () => rows.reduce((a, r) => a + r.height, 0);
  let over = sum() - targetCm;
  if (over > 0) {
    const text = rows.filter((r) => !r.blank);
    const room = text.reduce((a, r) => a + (r.height - r.min), 0);
    const cut = Math.min(over, room);
    const f = room > 0 ? cut / room : 0;
    for (const r of text) r.height -= (r.height - r.min) * f;
    steps.push(`1) 글자 행 여유(${r2(room)}cm)의 ${Math.round(f * 100)}% — ${r2(cut)}cm 줄임`);
    over = sum() - targetCm;
  }
  if (over > 0) {
    const blanks = rows.filter((r) => r.blank);
    const room = blanks.reduce((a, r) => a + r.height, 0);
    const cut = Math.min(over, room);
    const f = room > 0 ? cut / room : 0;
    for (const r of blanks) r.height -= r.height * f;
    steps.push(`2) 빈 줄 행(${r2(room)}cm)의 ${Math.round(f * 100)}% — ${r2(cut)}cm 줄임`);
    over = sum() - targetCm;
  }
  for (const r of rows) r.height = Math.max(0.01, Math.floor(r.height * 100) / 100);
  return { rows: rows.filter((r) => !(r.blank && r.height <= 0.01)), steps, overflow: over > 0.001 };
}

/** rows → 표양식 장 하나. 칸에 행 번호를 붙인다. */
export function toPage(colWidths, rows, marginTop) {
  return {
    colWidths,
    rowHeights: rows.map((r) => r2(r.height)),
    marginTop,
    cells: rows.flatMap((r, i) => r.cells.map((c) => ({ row: i, ...c }))),
  };
}
