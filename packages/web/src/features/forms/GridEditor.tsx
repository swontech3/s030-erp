'use client';

/**
 * 칸 편집기 — 한 장을 종이 모양 그대로 그리고, 끌어서 고르고, 두 번 눌러 바로 쓴다.
 *
 * ★ 레거시 `GridEditor` 를 옮겼다. 종이 모양은 문서(`form-doc.module.css`)와 **같은 규칙**
 *   이다 — 편집기에서 보이는 것이 종이에 나가는 것이다.
 * ★ 자리표시(`{{이름}}`)는 **글자 그대로** 보인다. 편집기는 무엇을 넣었는지 보여 주는 곳이다.
 *
 * ★ 바로 쓰기 입력은 칸 높이(행 높이 합, cm)를 그대로 받는다. 레거시는 절대위치로 칸을
 *   덮었다 — 표에 절대위치를 섞지 않는다(`forms.module.css` 의 `.inlineEdit`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_MARGIN_TOP, type Page } from '@swonbiz/shared/domain/form-template';
import { cellAt, coveredPositions } from '@swonbiz/shared/domain/form-grid';
import { cellClass } from './FormDocument';
import doc from './form-doc.module.css';
import styles from './forms.module.css';

export type Selection = { r0: number; c0: number; r1: number; c1: number };

export function normSel(sel: Selection) {
  return {
    minR: Math.min(sel.r0, sel.r1),
    maxR: Math.max(sel.r0, sel.r1),
    minC: Math.min(sel.c0, sel.c1),
    maxC: Math.max(sel.c0, sel.c1),
  };
}

const edge = (on?: boolean) => (on === false ? 'none' : '1px solid #000');

interface Props {
  page: Page;
  fontFamily: string;
  fontSize: number;
  selection: Selection | null;
  onSelectionChange: (sel: Selection) => void;
  onCellText: (row: number, col: number, text: string) => void;
}

export function GridEditor({ page, fontFamily, fontSize, selection, onSelectionChange, onCellText }: Props) {
  const covered = coveredPositions(page);
  const tableWidth = page.colWidths.reduce((a, b) => a + b, 0);

  const dragging = useRef(false);
  const anchor = useRef<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [editText, setEditText] = useState('');

  /* 표 밖에서 손을 떼도 끌기를 끝낸다. */
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const onDown = useCallback(
    (r: number, c: number, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging.current = true;
      anchor.current = { r, c };
      onSelectionChange({ r0: r, c0: c, r1: r, c1: c });
    },
    [onSelectionChange],
  );

  const onEnter = useCallback(
    (r: number, c: number) => {
      if (!dragging.current || !anchor.current) return;
      onSelectionChange({ r0: anchor.current.r, c0: anchor.current.c, r1: r, c1: c });
    },
    [onSelectionChange],
  );

  const commit = () => {
    if (!editing) return;
    onCellText(editing.r, editing.c, editText);
    setEditing(null);
    setEditText('');
  };

  const sel = selection ? normSel(selection) : null;
  const isSelected = (r: number, c: number) =>
    sel !== null && r >= sel.minR && r <= sel.maxR && c >= sel.minC && c <= sel.maxC;

  return (
    <div className={`${doc.root} ${styles.grid}`} style={{ fontFamily }}>
      <section className={doc.page}>
        <table
          className={doc.table}
          style={{ width: `${tableWidth}cm`, marginTop: `${page.marginTop ?? DEFAULT_MARGIN_TOP}cm` }}
        >
          <colgroup>
            {page.colWidths.map((w, i) => (
              <col key={i} style={{ width: `${w}cm` }} />
            ))}
          </colgroup>
          <tbody>
            {page.rowHeights.map((h, r) => (
              <tr key={r} style={{ height: `${h}cm` }}>
                {page.colWidths.map((_, c) => {
                  if (covered.has(`${r},${c}`)) return null;
                  const cell = cellAt(page, r, c);
                  const b = cell?.border;
                  const rowSpan = cell?.rowSpan ?? 1;
                  const isEditing = editing?.r === r && editing?.c === c;
                  /* 바로 쓰기 입력의 높이 = 이 칸이 걸친 행 높이의 합. */
                  const spanHeight = page.rowHeights.slice(r, r + rowSpan).reduce((a, x) => a + x, 0);
                  return (
                    <td
                      key={c}
                      className={`${cellClass(cell?.align, cell?.valign)} ${isSelected(r, c) ? styles.cellSel : ''}`}
                      colSpan={cell?.colSpan ?? 1}
                      rowSpan={rowSpan}
                      style={{
                        fontSize: `${cell?.fontSize ?? fontSize}pt`,
                        fontWeight: cell?.bold ? 700 : 400,
                        borderTop: edge(b?.top),
                        borderRight: edge(b?.right),
                        borderBottom: edge(b?.bottom),
                        borderLeft: edge(b?.left),
                      }}
                      onMouseDown={(e) => onDown(r, c, e)}
                      onMouseEnter={() => onEnter(r, c)}
                      onDoubleClick={() => {
                        setEditing({ r, c });
                        setEditText(cell?.text ?? '');
                      }}
                    >
                      {isEditing ? (
                        <textarea
                          className={styles.inlineEdit}
                          style={{ height: `${spanHeight}cm` }}
                          value={editText}
                          autoFocus
                          onChange={(e) => setEditText(e.target.value)}
                          onBlur={commit}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            // Esc 는 버리고, Enter 는 확정한다. 줄바꿈은 Shift+Enter.
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditing(null);
                              setEditText('');
                            } else if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              commit();
                            }
                          }}
                        />
                      ) : (
                        (cell?.text ?? '')
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
