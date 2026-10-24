/**
 * 표양식(s030100020) — 칸 편집 순수 함수.
 *
 * 레거시 `S-WonERP/src/lib/form-grid.ts` 를 **그대로** 옮겼다(행·열 더하기·빼기,
 * 병합·분할, 칸 고치기, 치수). 시험도 함께 옮겼다(`form-grid.test.ts`).
 *
 * ★ 모든 함수가 **새 장을 돌려준다** — 받은 장을 고치지 않는다. 편집기가 이전 상태와
 *   비교해 「저장하지 않은 변경」을 가르기 때문이다.
 *
 * ★★ 병합은 **왼쪽 위 칸(앵커)에만** 기록된다(`colSpan`·`rowSpan`). 덮인 자리에는 칸이
 *    없다. 행·열을 넣고 뺄 때 앵커의 자리와 걸침을 함께 고쳐야 표가 어긋나지 않는다.
 */
import type { Cell, Page } from './form-template.ts';

const rs = (c: Cell) => c.rowSpan ?? 1;
const cs = (c: Cell) => c.colSpan ?? 1;
const clone = (p: Page): Page => ({
  colWidths: [...p.colWidths],
  rowHeights: [...p.rowHeights],
  marginTop: p.marginTop,
  cells: p.cells.map((c) => ({ ...c, ...(c.border ? { border: { ...c.border } } : {}) })),
});

export function cellAt(page: Page, row: number, col: number): Cell | undefined {
  return page.cells.find((c) => c.row === row && c.col === col);
}

/** 병합에 **덮인** 자리들(`"행,열"`). 앵커 자신은 들어가지 않는다. */
export function coveredPositions(page: Page): Set<string> {
  const s = new Set<string>();
  for (const c of page.cells) {
    for (let r = c.row; r < c.row + rs(c); r++) {
      for (let k = c.col; k < c.col + cs(c); k++) {
        if (r === c.row && k === c.col) continue;
        s.add(`${r},${k}`);
      }
    }
  }
  return s;
}

export function addRow(page: Page, at: number): Page {
  const p = clone(page);
  p.rowHeights.splice(at, 0, 1);
  for (const c of p.cells) {
    if (c.row >= at) c.row += 1;
    else if (c.row + rs(c) - 1 >= at) c.rowSpan = rs(c) + 1; // 넣는 자리가 병합 안쪽
  }
  return p;
}

export function removeRow(page: Page, at: number): Page {
  if (page.rowHeights.length <= 1) return page;
  const p = clone(page);
  p.rowHeights.splice(at, 1);
  const next: Cell[] = [];
  for (const c of p.cells) {
    if (c.row === at) {
      // 앵커 행을 지우면 걸침만 줄고 자리는 그대로다. 걸침이 1 이면 칸이 사라진다.
      if (rs(c) > 1) {
        c.rowSpan = rs(c) - 1;
        next.push(c);
      }
    } else if (c.row > at) {
      c.row -= 1;
      next.push(c);
    } else {
      if (c.row + rs(c) - 1 >= at) c.rowSpan = rs(c) - 1; // 덮인 행을 지웠다
      next.push(c);
    }
  }
  p.cells = next.filter((c) => rs(c) >= 1 && cs(c) >= 1);
  return p;
}

export function addCol(page: Page, at: number): Page {
  const p = clone(page);
  p.colWidths.splice(at, 0, 2);
  for (const c of p.cells) {
    if (c.col >= at) c.col += 1;
    else if (c.col + cs(c) - 1 >= at) c.colSpan = cs(c) + 1;
  }
  return p;
}

export function removeCol(page: Page, at: number): Page {
  if (page.colWidths.length <= 1) return page;
  const p = clone(page);
  p.colWidths.splice(at, 1);
  const next: Cell[] = [];
  for (const c of p.cells) {
    if (c.col === at) {
      if (cs(c) > 1) {
        c.colSpan = cs(c) - 1;
        next.push(c);
      }
    } else if (c.col > at) {
      c.col -= 1;
      next.push(c);
    } else {
      if (c.col + cs(c) - 1 >= at) c.colSpan = cs(c) - 1;
      next.push(c);
    }
  }
  p.cells = next.filter((c) => rs(c) >= 1 && cs(c) >= 1);
  return p;
}

/** 아무 속성도 없는 칸 — 행을 남길 이유가 없다. */
function isDefaultCell(c: Cell): boolean {
  return (
    (c.rowSpan ?? 1) === 1 &&
    (c.colSpan ?? 1) === 1 &&
    !c.text &&
    c.bordered !== false &&
    c.border === undefined &&
    c.align === undefined &&
    c.valign === undefined &&
    c.fontSize === undefined &&
    !c.bold
  );
}

/** 사각형을 합친다 — 왼쪽 위 칸의 속성이 남고 안쪽 칸들은 지워진다. 인자 순서는 상관없다. */
export function mergeCells(page: Page, r0: number, c0: number, r1: number, c1: number): Page {
  const minR = Math.min(r0, r1);
  const maxR = Math.max(r0, r1);
  const minC = Math.min(c0, c1);
  const maxC = Math.max(c0, c1);
  if (minR === maxR && minC === maxC) return page;
  const p = clone(page);
  const anchorSrc = cellAt(p, minR, minC);
  const inRect = (c: Cell) => c.row >= minR && c.row <= maxR && c.col >= minC && c.col <= maxC;
  p.cells = p.cells.filter((c) => !inRect(c));
  p.cells.push({
    ...(anchorSrc ?? {}),
    row: minR,
    col: minC,
    colSpan: maxC - minC + 1,
    rowSpan: maxR - minR + 1,
  });
  return p;
}

export function splitCell(page: Page, row: number, col: number): Page {
  const p = clone(page);
  const a = p.cells.find((c) => c.row === row && c.col === col);
  if (a) {
    delete a.colSpan;
    delete a.rowSpan;
  }
  return p;
}

/**
 * 칸 하나를 고친다. 없던 자리면 칸을 만든다.
 * ★ 값이 `undefined` 인 속성은 **지운다** — `{ border: undefined }` 는 「테두리를 기본(실선)
 *   으로」라는 뜻이다. 남겨 두면 JSON 에는 안 나가도 `isDefaultCell` 이 빈 칸을 못 알아본다.
 */
export function updateCell(page: Page, row: number, col: number, patch: Partial<Cell>): Page {
  const p = clone(page);
  let a = p.cells.find((c) => c.row === row && c.col === col);
  if (!a) {
    a = { row, col };
    p.cells.push(a);
  }
  const target = a as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete target[k];
    else target[k] = v;
  }
  if (isDefaultCell(a)) p.cells = p.cells.filter((c) => c !== a);
  return p;
}

export function setColWidth(page: Page, col: number, cm: number): Page {
  const p = clone(page);
  if (col >= 0 && col < p.colWidths.length) p.colWidths[col] = cm;
  return p;
}

export function setRowHeight(page: Page, row: number, cm: number): Page {
  const p = clone(page);
  if (row >= 0 && row < p.rowHeights.length) p.rowHeights[row] = cm;
  return p;
}

export function setRowCount(page: Page, n: number): Page {
  const target = Math.max(1, Math.floor(n));
  let p = page;
  while (p.rowHeights.length < target) p = addRow(p, p.rowHeights.length);
  while (p.rowHeights.length > target) p = removeRow(p, p.rowHeights.length - 1);
  return p;
}

export function setColCount(page: Page, n: number): Page {
  const target = Math.max(1, Math.floor(n));
  let p = page;
  while (p.colWidths.length < target) p = addCol(p, p.colWidths.length);
  while (p.colWidths.length > target) p = removeCol(p, p.colWidths.length - 1);
  return p;
}

/**
 * 치수 입력칸(cm)의 확정 판정 — 적용할 수를 돌려주거나, 아직 확정하면 안 되는 상태
 * (빈칸·글자·「0」·「0.」 입력 중)면 `null`.
 *
 * ★ `null` 인 동안 화면은 자기 글자만 들고 있고 정의를 바꾸지 않는다. 그래야 「0.66」처럼
 *   0 으로 시작하는 1cm 미만 값을 칠 수 있다(레거시 `number-input.ts` 와 같다).
 * @param allowZero 위 여백처럼 0 을 받는 칸이면 true.
 */
export function parseDimensionInput(text: string, allowZero = false): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  if (Number.isNaN(n)) return null;
  if (allowZero ? n < 0 : n <= 0) return null;
  return n;
}
