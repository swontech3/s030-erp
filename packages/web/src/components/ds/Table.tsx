/**
 * Table — 공통 표 (2026-11-25 입주관리 일관성 · 대표 지시 「공통 표 부품을 만들고 대상 화면에서 쓴다」).
 * DS 원본에는 Table 부품 파일이 없다 — 시안 03-components.md 「Table」(CSS Grid · <table> 쓰지 않음)을 따른다.
 *
 * 쓰는 법
 *   <Table cols="120px minmax(0,1fr) 100px">
 *     <TableHead><span>회사</span><span>호실</span><span className={tableCell.right}>금액</span></TableHead>
 *     {rows.map((r) => <TableRow key={r.id} onClick={…} selected={…}>…</TableRow>)}
 *     {rows.length === 0 ? <TableEmpty>목록이 없습니다.</TableEmpty> : null}
 *   </Table>
 *
 * ★ 머리글 색 = 삐용 목록 표 머리글 : 아쿠아 옅은 바탕(--color-accent-bg) · 진한 아쿠아 글자(--color-primary-hover) ·
 *   아래 1px 아쿠아 선(--color-primary). 높이 44 · 12px/700 은 시안 Table 그대로
 * ★ 칸 폭은 cols(grid-template-columns) 하나로 정한다. 머리 · 줄이 같은 값을 쓰므로 세로줄이 맞는다.
 *   줄마다 다른 폭이 필요하면 className 으로 grid-template-columns 를 덮는다(그때도 머리 · 줄에 같이)
 * ★ 머리 · 줄의 색 · 선은 이 부품만 정한다 — 부르는 화면은 칸 안의 글자 모양만 정한다
 * ★ 색은 토큰만.
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import styles from './Table.module.css';

/** 칸 정렬 — 칸(span)에 붙인다 */
export const tableCell = { left: styles.left, center: styles.center, right: styles.right, ellipsis: styles.ellipsis };

export interface TableProps {
  /** grid-template-columns */
  cols: string;
  /** 줄 높이를 낮춘다(44px) — 긴 목록 */
  dense?: boolean;
  className?: string;
  children: ReactNode;
}

export function Table({ cols, dense = false, className, children }: TableProps) {
  return (
    <div
      role="table"
      className={`${styles.table}${dense ? ` ${styles.dense}` : ''}${className ? ` ${className}` : ''}`}
      style={{ '--table-cols': cols } as CSSProperties}
    >
      {children}
    </div>
  );
}

export interface TableHeadProps {
  /** 스크롤 상자 안에서 머리를 위에 붙인다 */
  sticky?: boolean;
  className?: string;
  children: ReactNode;
}

export function TableHead({ sticky = false, className, children }: TableHeadProps) {
  return (
    <div role="row" className={`${styles.head}${sticky ? ` ${styles.sticky}` : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}

export interface TableRowProps {
  onClick?: () => void;
  selected?: boolean;
  /** 흐리게(취소 · 해지 등) */
  muted?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function TableRow({ onClick, selected = false, muted = false, className, title, children }: TableRowProps) {
  const cls = `${styles.row}${onClick ? ` ${styles.clickable}` : ''}${selected ? ` ${styles.selected}` : ''}${
    muted ? ` ${styles.muted}` : ''
  }${className ? ` ${className}` : ''}`;
  if (!onClick) {
    return (
      <div role="row" className={cls} title={title}>
        {children}
      </div>
    );
  }
  return (
    <div
      role="row"
      className={cls}
      title={title}
      tabIndex={0}
      aria-selected={selected}
      onClick={onClick}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}

/** 빈 목록 · 불러오는 중 안내 — 표 폭 전체 */
export function TableEmpty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
