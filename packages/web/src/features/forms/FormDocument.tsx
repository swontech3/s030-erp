'use client';

/**
 * 표양식 문서 그리기 — 미리보기와 인쇄가 **같은 컴포넌트**를 쓴다.
 *
 * ★ 레거시 `FormTemplateRenderer` 를 옮겼다. 칸 하나하나의 모양(테두리 4변 · 정렬 ·
 *   글꼴 크기 · 굵게 · 병합)은 그대로다.
 *
 * ★★ 두 벌로 그리지 않는다 — 미리보기와 종이가 다르면 미리보기가 거짓말을 한다.
 *    다른 것은 하나뿐이다: `showEmpty` 가 켜져 있으면 **아직 채우지 않은 자리표시**를
 *    이름표로 흐리게 보인다(화면). 꺼져 있으면 빈칸이다(종이).
 *
 * ★ 인쇄는 `FormPrintPortal` 이 이 컴포넌트를 body 로 포털해서 한다(계약서와 같은 방식).
 */
import type { Ref } from 'react';
import { DEFAULT_MARGIN_TOP, splitTokens, type FormDefinition, type Page } from '@swonbiz/shared/domain/form-template';
import { cellAt, coveredPositions } from '@swonbiz/shared/domain/form-grid';
import styles from './form-doc.module.css';

interface Props {
  definition: FormDefinition;
  /** 자리표시 값. 키는 자리표시 이름이다. */
  values: Readonly<Record<string, string>>;
  /** 이름표 — 비어 있는 자리표시를 화면에 보일 때 쓴다. */
  labels?: Readonly<Record<string, string>>;
  /** ★ 화면 미리보기면 true, 종이면 false. */
  showEmpty: boolean;
  rootRef?: Ref<HTMLDivElement>;
}

const edge = (on?: boolean) => (on === false ? 'none' : '1px solid #000');

export function cellClass(align?: string, valign?: string): string {
  return [
    styles.td,
    align === 'center' ? styles.ac : align === 'right' ? styles.ar : styles.al,
    valign === 'top' ? styles.vt : valign === 'bottom' ? styles.vb : styles.vm,
  ].join(' ');
}

function CellText({
  text,
  values,
  labels,
  showEmpty,
}: {
  text: string;
  values: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
  showEmpty: boolean;
}) {
  return (
    <>
      {splitTokens(text).map((p, i) => {
        if (p.kind === 'text') return p.text;
        const v = values[p.name] ?? '';
        if (v !== '') return <span key={i}>{v}</span>;
        // ★ 종이에는 아무것도 내보내지 않는다 — 지어낸 글자를 넣지 않는다.
        if (!showEmpty) return null;
        return (
          <span key={i} className={styles.empty}>
            {labels[p.name] ?? p.name}
          </span>
        );
      })}
    </>
  );
}

function PageTable({
  page,
  fontSize,
  values,
  labels,
  showEmpty,
}: {
  page: Page;
  fontSize: number;
  values: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
  showEmpty: boolean;
}) {
  const covered = coveredPositions(page);
  const tableWidth = page.colWidths.reduce((a, b) => a + b, 0);
  return (
    <table
      className={styles.table}
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
              return (
                <td
                  key={c}
                  className={cellClass(cell?.align, cell?.valign)}
                  colSpan={cell?.colSpan ?? 1}
                  rowSpan={cell?.rowSpan ?? 1}
                  style={{
                    fontSize: `${cell?.fontSize ?? fontSize}pt`,
                    fontWeight: cell?.bold ? 700 : 400,
                    borderTop: edge(b?.top),
                    borderRight: edge(b?.right),
                    borderBottom: edge(b?.bottom),
                    borderLeft: edge(b?.left),
                  }}
                >
                  {cell?.text ? (
                    <CellText text={cell.text} values={values} labels={labels} showEmpty={showEmpty} />
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FormDocument({ definition, values, labels = {}, showEmpty, rootRef }: Props) {
  return (
    <div ref={rootRef} className={styles.root} style={{ fontFamily: definition.font.family }}>
      {definition.pages.map((page, i) => (
        <section key={i} className={styles.page} data-form-page="1">
          <PageTable
            page={page}
            fontSize={definition.font.size}
            values={values}
            labels={labels}
            showEmpty={showEmpty}
          />
        </section>
      ))}
    </div>
  );
}
