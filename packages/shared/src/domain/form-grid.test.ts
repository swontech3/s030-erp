import { describe, it, expect } from 'vitest';
import type { Page } from './form-template.ts';
import {
  cellAt,
  coveredPositions,
  addRow,
  removeRow,
  addCol,
  removeCol,
  mergeCells,
  splitCell,
  updateCell,
  setColWidth,
  setRowHeight,
  setRowCount,
  setColCount,
  parseDimensionInput,
} from './form-grid.ts';

/**
 * 칸 편집 — 레거시 `S-WonERP/src/lib/form-grid.test.ts` 를 옮겼다(같은 기대값).
 * 아래 「새 규칙」 묶음만 새로 썼다.
 */

function page(rows: number, cols: number, cells: Page['cells'] = []): Page {
  return {
    colWidths: Array(cols).fill(2),
    rowHeights: Array(rows).fill(1),
    marginTop: 1.2,
    cells,
  };
}

describe('cellAt / coveredPositions', () => {
  it('앵커 위치 셀 반환, 덮인 위치는 covered', () => {
    const p = page(3, 3, [{ row: 0, col: 0, colSpan: 2, rowSpan: 2, text: 'M' }]);
    expect(cellAt(p, 0, 0)?.text).toBe('M');
    expect(cellAt(p, 0, 1)).toBeUndefined();
    const cov = coveredPositions(p);
    expect(cov.has('0,1')).toBe(true);
    expect(cov.has('1,0')).toBe(true);
    expect(cov.has('1,1')).toBe(true);
    expect(cov.has('0,0')).toBe(false);
  });
});

describe('addRow', () => {
  it('아래 행은 row+1, rowHeights 길이 동기', () => {
    const r = addRow(page(2, 2, [{ row: 1, col: 0, text: 'B' }]), 1);
    expect(r.rowHeights).toHaveLength(3);
    expect(cellAt(r, 2, 0)?.text).toBe('B');
  });
  it('삽입 지점을 가로지르는 병합은 rowSpan+1', () => {
    const r = addRow(page(3, 1, [{ row: 0, col: 0, rowSpan: 3, text: 'M' }]), 1);
    expect(cellAt(r, 0, 0)?.rowSpan).toBe(4);
  });
});

describe('removeRow', () => {
  it('행 1개면 변화 없음(가드)', () => {
    const p = page(1, 2);
    expect(removeRow(p, 0)).toEqual(p);
  });
  it('단일행 셀 삭제 + 아래 행 row-1', () => {
    const r = removeRow(
      page(3, 1, [
        { row: 1, col: 0, text: 'DEL' },
        { row: 2, col: 0, text: 'C' },
      ]),
      1,
    );
    expect(r.rowHeights).toHaveLength(2);
    expect(cellAt(r, 1, 0)?.text).toBe('C');
    expect(r.cells.find((c) => c.text === 'DEL')).toBeUndefined();
  });
  it('앵커 행 삭제 시 rowSpan-1 (앵커는 같은 인덱스 유지)', () => {
    expect(cellAt(removeRow(page(3, 1, [{ row: 0, col: 0, rowSpan: 3, text: 'M' }]), 0), 0, 0)?.rowSpan).toBe(2);
  });
  it('덮인 행 삭제 시 rowSpan-1', () => {
    expect(cellAt(removeRow(page(3, 1, [{ row: 0, col: 0, rowSpan: 3, text: 'M' }]), 2), 0, 0)?.rowSpan).toBe(2);
  });
});

describe('addCol / removeCol', () => {
  it('addCol: 오른쪽 열 col+1, colWidths 동기', () => {
    const r = addCol(page(2, 2, [{ row: 0, col: 1, text: 'R' }]), 1);
    expect(r.colWidths).toHaveLength(3);
    expect(cellAt(r, 0, 2)?.text).toBe('R');
  });
  it('addCol: 가로지르는 병합은 colSpan+1', () => {
    expect(cellAt(addCol(page(1, 3, [{ row: 0, col: 0, colSpan: 3, text: 'M' }]), 1), 0, 0)?.colSpan).toBe(4);
  });
  it('removeCol: 열 1개면 가드', () => {
    const p = page(2, 1);
    expect(removeCol(p, 0)).toEqual(p);
  });
  it('removeCol: 앵커 열 삭제 시 colSpan-1', () => {
    expect(cellAt(removeCol(page(1, 3, [{ row: 0, col: 0, colSpan: 3, text: 'M' }]), 0), 0, 0)?.colSpan).toBe(2);
  });
  it('removeCol: 단일열 셀 삭제 + 오른쪽 col-1', () => {
    const r = removeCol(
      page(1, 3, [
        { row: 0, col: 1, text: 'DEL' },
        { row: 0, col: 2, text: 'C' },
      ]),
      1,
    );
    expect(cellAt(r, 0, 1)?.text).toBe('C');
    expect(r.cells.find((c) => c.text === 'DEL')).toBeUndefined();
  });
  it('removeCol: 덮인(non-anchor) 열 삭제 시 colSpan-1', () => {
    expect(cellAt(removeCol(page(1, 3, [{ row: 0, col: 0, colSpan: 3 }]), 2), 0, 0)?.colSpan).toBe(2);
  });
});

describe('mergeCells / splitCell', () => {
  it('범위 병합: 좌상단 앵커 + span, 내부 셀 제거', () => {
    const r = mergeCells(
      page(2, 2, [
        { row: 0, col: 0, text: 'TL' },
        { row: 1, col: 1, text: 'X' },
      ]),
      0,
      0,
      1,
      1,
    );
    const a = cellAt(r, 0, 0)!;
    expect(a.text).toBe('TL');
    expect(a.colSpan).toBe(2);
    expect(a.rowSpan).toBe(2);
    expect(r.cells).toHaveLength(1);
  });
  it('정규화: 인자 순서 무관(r1<r0 등)', () => {
    expect(cellAt(mergeCells(page(2, 2), 1, 1, 0, 0), 0, 0)?.rowSpan).toBe(2);
  });
  it('splitCell: span 1,1 복원', () => {
    const a = cellAt(splitCell(page(2, 2, [{ row: 0, col: 0, colSpan: 2, rowSpan: 2, text: 'M' }]), 0, 0), 0, 0)!;
    expect(a.colSpan ?? 1).toBe(1);
    expect(a.rowSpan ?? 1).toBe(1);
  });
});

describe('updateCell / 치수', () => {
  it('빈 위치 텍스트 입력 시 앵커 생성', () => {
    expect(cellAt(updateCell(page(2, 2), 0, 1, { text: 'hi' }), 0, 1)?.text).toBe('hi');
  });
  it('기본-빈셀이 되면 제거', () => {
    expect(cellAt(updateCell(page(2, 2, [{ row: 0, col: 0, text: 'x' }]), 0, 0, { text: '' }), 0, 0)).toBeUndefined();
  });
  it('setColWidth/setRowHeight', () => {
    expect(setColWidth(page(1, 2), 1, 5.5).colWidths[1]).toBe(5.5);
    expect(setRowHeight(page(2, 1), 0, 0.7).rowHeights[0]).toBe(0.7);
  });
  it('updateCell: 텍스트 지워도 병합셀(span>1)은 제거되지 않음', () => {
    const c = cellAt(updateCell(page(2, 2, [{ row: 0, col: 0, colSpan: 2, rowSpan: 2, text: 'M' }]), 0, 0, { text: '' }), 0, 0);
    expect(c?.colSpan).toBe(2);
    expect(c?.rowSpan).toBe(2);
  });
});

describe('setRowCount / setColCount', () => {
  it('늘리기: 부족분 끝에 추가', () => {
    expect(setRowCount(page(2, 2), 4).rowHeights).toHaveLength(4);
  });
  it('줄이기: 끝에서 제거', () => {
    expect(setRowCount(page(4, 2), 2).rowHeights).toHaveLength(2);
  });
  it('같으면 변화 없음', () => {
    expect(setRowCount(page(3, 2), 3).rowHeights).toHaveLength(3);
  });
  it('n<1은 1로 가드', () => {
    expect(setRowCount(page(3, 2), 0).rowHeights).toHaveLength(1);
  });
  it('setColCount 동일', () => {
    expect(setColCount(page(2, 2), 5).colWidths).toHaveLength(5);
    expect(setColCount(page(2, 5), 2).colWidths).toHaveLength(2);
  });
  it('updateCell border 셀은 기본-빈셀 아님(미제거)', () => {
    expect(cellAt(updateCell(page(2, 2, [{ row: 0, col: 0, border: { bottom: false } }]), 0, 0, { border: { bottom: false } }), 0, 0)).toBeDefined();
  });
});

describe('새 규칙 (2026-10-07)', () => {
  it('★ updateCell 에 undefined 를 주면 그 속성을 지운다 — 테두리를 기본으로 돌리면 빈 칸이 사라진다', () => {
    const r = updateCell(page(2, 2, [{ row: 0, col: 0, border: { top: false } }]), 0, 0, { border: undefined });
    expect(cellAt(r, 0, 0)).toBeUndefined();
  });
  it('★ 받은 장을 고치지 않는다 — 테두리 객체까지 복사한다', () => {
    const p = page(1, 1, [{ row: 0, col: 0, border: { top: false } }]);
    const r = addRow(p, 0);
    r.cells[0]!.border!.top = true;
    expect(p.cells[0]!.border!.top).toBe(false);
  });
  it('parseDimensionInput — 입력 중인 「0.」은 아직 확정하지 않는다', () => {
    expect(parseDimensionInput('0.')).toBeNull();
    expect(parseDimensionInput('0')).toBeNull();
    expect(parseDimensionInput('0.66')).toBe(0.66);
    expect(parseDimensionInput('')).toBeNull();
    expect(parseDimensionInput('abc')).toBeNull();
    expect(parseDimensionInput('0', true)).toBe(0);
    expect(parseDimensionInput('-1', true)).toBeNull();
  });
});
