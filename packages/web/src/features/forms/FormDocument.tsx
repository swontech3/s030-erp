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
 *    법무 서류 종이(`inlineBlanks`)는 글과 함께 있는 빈 자리표시를 일정 너비 빈칸으로 찍는다.
 *
 * ★ 인쇄는 `FormPrintPortal` 이 이 컴포넌트를 body 로 포털해서 한다(계약서와 같은 방식).
 */
import type { Ref } from 'react';
import {
  DEFAULT_MARGIN_TOP,
  fitRowsOf,
  inlineBlankWidths,
  splitTokens,
  type FormDefinition,
  type Page,
} from '@swonbiz/shared/domain/form-template';
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
  /** 미리보기에서도 비어 있으면 이름표 없이 빈칸으로 둘 자리표시 이름. */
  blankWhenEmpty?: readonly string[];
  /**
   * ★ 법무 서류 종이면 true — 글과 함께 있는 빈 자리표시를 일정 너비 빈칸으로 찍는다(`inlineBlankWidths`,
   *   결정 2026-11-06). 미리보기(`showEmpty`)에는 쓰지 않는다. 일반 서류(표양식 관리)는 켜지 않는다.
   */
  inlineBlanks?: boolean;
  rootRef?: Ref<HTMLDivElement>;
}

const NONE: readonly string[] = [];

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
  blankWhenEmpty,
  inlineBlanks,
  fit,
}: {
  text: string;
  values: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
  showEmpty: boolean;
  blankWhenEmpty: readonly string[];
  inlineBlanks: boolean;
  /** 칸 폭(cm) · 글자 크기(pt) — 빈칸을 칸에 맞춰 줄인다(`inlineBlankWidths`). */
  fit: { widthCm: number; fontPt: number };
}) {
  const pieces = splitTokens(text);
  const widths = inlineBlanks && !showEmpty ? inlineBlankWidths(pieces, fit) : null;
  return (
    <>
      {pieces.map((p, i) => {
        if (p.kind === 'text') return p.text;
        const v = values[p.name] ?? '';
        if (v !== '') return <span key={i}>{v}</span>;
        // ★ 법무 서류 종이 — 글과 함께 있는 빈 자리표시는 일정 너비 빈칸(손으로 적을 자리, 결정 2026-11-06).
        //   글자는 넣지 않는다.
        const w = widths?.[i];
        if (w) return <span key={i} className={styles.blank} style={{ width: `${w}em` }} />;
        // ★ 종이에는 아무것도 내보내지 않는다 — 지어낸 글자를 넣지 않는다.
        if (!showEmpty || blankWhenEmpty.includes(p.name)) return null;
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
  blankWhenEmpty,
  inlineBlanks,
}: {
  page: Page;
  fontSize: number;
  values: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
  showEmpty: boolean;
  blankWhenEmpty: readonly string[];
  inlineBlanks: boolean;
}) {
  const covered = coveredPositions(page);
  // ★ 「내용에 맞춤」 행은 높이를 못 박지 않는다 — 표의 행은 내용만큼 자란다(결정 2026-11-05).
  const fit = fitRowsOf(page);
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
          <tr key={r} style={fit.has(r) ? undefined : { height: `${h}cm` }}>
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
                    <CellText
                      text={cell.text}
                      values={values}
                      labels={labels}
                      showEmpty={showEmpty}
                      blankWhenEmpty={blankWhenEmpty}
                      inlineBlanks={inlineBlanks}
                      fit={{
                        widthCm: page.colWidths.slice(c, c + (cell.colSpan ?? 1)).reduce((a, b) => a + b, 0),
                        fontPt: cell.fontSize ?? fontSize,
                      }}
                    />
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

export function FormDocument({ definition, values, labels = {}, showEmpty, blankWhenEmpty = NONE, inlineBlanks = false, rootRef }: Props) {
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
            blankWhenEmpty={blankWhenEmpty}
            inlineBlanks={inlineBlanks}
          />
        </section>
      ))}
    </div>
  );
}
