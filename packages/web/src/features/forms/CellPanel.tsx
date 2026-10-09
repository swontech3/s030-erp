'use client';

/**
 * 칸 속성 패널 — 편집 페이지 오른쪽. 레거시 `CellPropertiesPanel` 을 옮겼다.
 *
 * 위에서부터: 장 위 여백 · [고른 칸] 치수 · 글자 · 입력칸 넣기 · 테두리 · 정렬 · 글꼴 ·
 * **입력칸 이름표**.
 *
 * ★ 「데이터 필드 삽입」(레거시)은 「입력칸 넣기」가 됐다. 레거시는 데이터 원천(법인
 *   변경등기 등)의 칸 목록에서 골랐지만, 지금은 값을 손으로만 채우므로(결정 2026-10-07)
 *   **이름을 직접 정해** `{{이름}}` 을 넣는다. 이미 쓴 이름은 목록에서 고를 수 있다 —
 *   같은 이름은 뽑을 때 **한 칸**으로 채워진다.
 * ★ 이름표는 뽑을 때 입력칸 위에 보이는 이름이다. 비워 두면 자리표시 글자가 그대로 보인다.
 */
import { useState } from 'react';
import {
  DEFAULT_MARGIN_TOP,
  type Cell,
  type CellBorder,
  type InputField,
  type Page,
} from '@swonbiz/shared/domain/form-template';
import { cellAt, parseDimensionInput } from '@swonbiz/shared/domain/form-grid';
import codes from '@/features/codes/codes.module.css';
import styles from './forms.module.css';

interface Props {
  page: Page;
  /** 고른 사각형의 왼쪽 위 칸. 없으면 칸 속성을 감춘다. */
  sel: { row: number; col: number } | null;
  /** 고른 사각형의 **모든 칸**에 적용한다(덮인 자리는 빼고). */
  onCell: (patch: Partial<Cell>) => void;
  onColWidth: (cm: number) => void;
  onRowHeight: (cm: number) => void;
  onMarginTop: (cm: number) => void;
  fields: readonly InputField[];
  onInsertToken: (name: string) => void;
  onLabel: (name: string, label: string) => void;
}

/**
 * cm 입력 — 자기 글자를 들고 있다가 **확정할 수 있을 때만** 올려 보낸다.
 * ★ 그래야 「0.66」처럼 0 으로 시작하는 값을 칠 수 있다(`parseDimensionInput`).
 */
function DimInput({ value, onCommit, allowZero = false }: { value: number; onCommit: (n: number) => void; allowZero?: boolean }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  // 칸·장을 옮겨 값이 바뀌면 글자를 맞춘다. 내가 막 올려 보낸 값이면 치던 글자를 덮지 않는다.
  if (value !== prev) {
    setPrev(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <input
      type="number"
      className={styles.sideInput}
      step="0.1"
      min={allowZero ? '0' : '0.1'}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseDimensionInput(e.target.value, allowZero);
        if (n !== null) onCommit(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

/** 이름표 입력 — 칠 때마다 정의를 고치지 않고 **떠날 때** 확정한다(앞뒤 공백을 다듬기 때문). */
function LabelInput({ field, onLabel }: { field: InputField; onLabel: (name: string, label: string) => void }) {
  const initial = field.label === field.name ? '' : field.label;
  const [text, setText] = useState(initial);
  const [prev, setPrev] = useState(initial);
  if (initial !== prev) {
    setPrev(initial);
    setText(initial);
  }
  const commit = () => {
    if (text.trim() !== initial) onLabel(field.name, text);
  };
  return (
    <label>
      <span className={styles.small}>{`{{${field.name}}}`}</span>
      <input
        className={styles.sideInput}
        value={text}
        placeholder={field.name}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}

const EDGES: readonly { key: keyof CellBorder; label: string }[] = [
  { key: 'top', label: '위' },
  { key: 'right', label: '오른쪽' },
  { key: 'bottom', label: '아래' },
  { key: 'left', label: '왼쪽' },
];

export function CellPanel({
  page,
  sel,
  onCell,
  onColWidth,
  onRowHeight,
  onMarginTop,
  fields,
  onInsertToken,
  onLabel,
}: Props) {
  const cell = sel ? cellAt(page, sel.row, sel.col) : undefined;
  const [newToken, setNewToken] = useState('');

  const align = cell?.align ?? 'left';
  const valign = cell?.valign ?? 'middle';

  const insertNew = () => {
    const name = newToken.trim();
    // ★ `}` 는 자리표시를 끝내는 글자라 이름에 쓸 수 없다. `{` 도 막는다(읽기 헷갈린다).
    if (!name || /[{}]/.test(name)) return;
    onInsertToken(name);
    setNewToken('');
  };

  return (
    <aside className={styles.side}>
      <div className={styles.box}>
        <p className={styles.boxTitle}>이 장</p>
        <label>
          <span className={styles.small}>위 여백 (cm)</span>
          <DimInput value={page.marginTop ?? DEFAULT_MARGIN_TOP} onCommit={onMarginTop} allowZero />
        </label>
      </div>

      {sel === null ? (
        <p className={styles.sideEmpty}>칸을 고르세요 — 끌어서 여러 칸을 고르고, 두 번 눌러 바로 씁니다</p>
      ) : (
        <>
          <div className={styles.box}>
            <p className={styles.boxTitle}>
              {sel.row + 1}행 · {sel.col + 1}열
            </p>
            <div className={styles.row2}>
              <label>
                <span className={styles.small}>열 폭 (cm)</span>
                <DimInput value={page.colWidths[sel.col] ?? 3} onCommit={onColWidth} />
              </label>
              <label>
                <span className={styles.small}>행 높이 (cm)</span>
                <DimInput value={page.rowHeights[sel.row] ?? 1} onCommit={onRowHeight} />
              </label>
            </div>
          </div>

          <div className={styles.box}>
            <label>
              <span className={styles.small}>글자</span>
              <textarea
                className={styles.sideTextarea}
                value={cell?.text ?? ''}
                onChange={(e) => onCell({ text: e.target.value })}
              />
            </label>
            <div>
              <span className={styles.small}>입력칸 넣기 — 뽑을 때 손으로 채우는 칸</span>
              {fields.length > 0 ? (
                <select
                  className={styles.sideInput}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) onInsertToken(e.target.value);
                  }}
                >
                  <option value="">이미 쓴 입력칸에서 고르기 ▾</option>
                  {fields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label === f.name ? f.name : `${f.label} (${f.name})`}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className={styles.seg} style={{ marginTop: 6 }}>
                <input
                  className={styles.sideInput}
                  value={newToken}
                  placeholder="새 입력칸 이름 (예: 성명)"
                  onChange={(e) => setNewToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && insertNew()}
                />
                <button type="button" className={codes.btnXs} style={{ flex: '0 0 auto' }} onClick={insertNew}>
                  넣기
                </button>
              </div>
            </div>
          </div>

          <div className={styles.box}>
            <span className={styles.small}>테두리</span>
            <div className={styles.seg}>
              {EDGES.map(({ key, label }) => {
                const on = cell?.border?.[key] !== false;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`${codes.btnXs} ${on ? styles.segOn : ''}`}
                    onClick={() => {
                      const next: CellBorder = { ...cell?.border };
                      if (on) next[key] = false;
                      else delete next[key];
                      onCell({ border: Object.keys(next).length === 0 ? undefined : next });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className={styles.seg}>
              <button type="button" className={codes.btnXs} onClick={() => onCell({ border: undefined })}>
                전체
              </button>
              <button
                type="button"
                className={codes.btnXs}
                onClick={() => onCell({ border: { top: false, right: false, bottom: false, left: false } })}
              >
                무테
              </button>
            </div>
          </div>

          <div className={styles.box}>
            <span className={styles.small}>가로 정렬</span>
            <div className={styles.seg}>
              {(['left', 'center', 'right'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`${codes.btnXs} ${align === v ? styles.segOn : ''}`}
                  onClick={() => onCell({ align: v === 'left' ? undefined : v })}
                >
                  {v === 'left' ? '왼쪽' : v === 'center' ? '가운데' : '오른쪽'}
                </button>
              ))}
            </div>
            <span className={styles.small}>세로 정렬</span>
            <div className={styles.seg}>
              {(['top', 'middle', 'bottom'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`${codes.btnXs} ${valign === v ? styles.segOn : ''}`}
                  onClick={() => onCell({ valign: v === 'middle' ? undefined : v })}
                >
                  {v === 'top' ? '위' : v === 'middle' ? '가운데' : '아래'}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.box}>
            <div className={styles.row2}>
              <label>
                <span className={styles.small}>글꼴 크기 (pt)</span>
                <input
                  type="number"
                  className={styles.sideInput}
                  step="0.5"
                  min="4"
                  placeholder="기본"
                  value={cell?.fontSize ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') onCell({ fontSize: undefined });
                    else {
                      const n = Number(raw);
                      if (Number.isFinite(n) && n > 0) onCell({ fontSize: n });
                    }
                  }}
                />
              </label>
              <label className={styles.check} style={{ alignSelf: 'end', height: 32 }}>
                <input
                  type="checkbox"
                  checked={cell?.bold ?? false}
                  onChange={(e) => onCell({ bold: e.target.checked ? true : undefined })}
                />
                굵게
              </label>
            </div>
          </div>
        </>
      )}

      <div className={styles.box}>
        <p className={styles.boxTitle}>입력칸 이름표 · {fields.length}개</p>
        {fields.length === 0 ? (
          <p className={styles.note}>칸에 입력칸을 넣으면 여기 나옵니다.</p>
        ) : (
          <>
            <p className={styles.note}>뽑을 때 입력칸 위에 보이는 이름입니다. 비우면 자리표시 글자가 보입니다.</p>
            {fields.map((f) => (
              <LabelInput key={f.name} field={f} onLabel={onLabel} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
