/**
 * ERP 공통 목록 틀 — 검색 조건 → 버튼 줄 → 목록 (대표 지시 2026-11-15).
 *
 * ★ 배치는 세무 「거래처」(s05 · `features/tax/vendors`)와 같다 — 검색 조건 상자 / 상자 밖 버튼 줄 / 목록 상자.
 *   화면이 셸 `.main` 높이를 채우고(height 100% · 최소 520px) 목록 상자만 남는 높이를 받아 그 안에서 스크롤한다.
 *   ★ 세무 파일은 가져다 쓰지 않는다(세무 폴더는 읽기만) — 같은 값을 여기 따로 적었다.
 * ★ 틀은 자리만 정한다. 조건 칸 · 버튼 · 목록 칸의 모양과 동작은 부르는 화면의 것 그대로다.
 * ★ 색은 기존 토큰만.
 *
 * 쓰는 곳: 법인설립 · 법인변경 · 사업목적 목록 · 청구(s030200070).
 */
import type { ReactNode } from 'react';
import styles from './ListFrame.module.css';

export interface ListFrameProps {
  /** 맨 위 제목 줄(있으면). 삐용 안에서 숨기는 표시는 부르는 쪽이 붙인다. */
  head?: ReactNode;
  /** 검색 조건 상자 안 */
  search: ReactNode;
  /** 검색 상자와 버튼 줄 사이(있으면) — 검색 결과의 총괄표 등(청구 화면, 2026-11-15) */
  summary?: ReactNode;
  /** 버튼 줄 */
  actions: ReactNode;
  /** 목록 상자 안. 스크롤할 부분은 `ListScroll` 로 감싼다. */
  children: ReactNode;
  /** 목록 상자 안쪽 여백 20px — 상자 안 머리 · 표 · 꼬리를 화면이 직접 배치할 때 */
  listPadded?: boolean;
}

export function ListFrame({ head, search, summary, actions, children, listPadded = false }: ListFrameProps) {
  return (
    <div className={styles.frame}>
      {head ?? null}
      <div className={styles.search}>{search}</div>
      {summary ?? null}
      <div className={styles.actions}>{actions}</div>
      <div className={`${styles.list}${listPadded ? ` ${styles.listPadded}` : ''}`}>{children}</div>
    </div>
  );
}

/** 목록 상자 안에서 스크롤하는 부분 */
export function ListScroll({ children }: { children: ReactNode }) {
  return <div className={styles.scroll}>{children}</div>;
}

/** 줄 안에서 남는 폭을 차지한다 — 뒤의 것을 오른쪽 끝으로 */
export function ListSpacer() {
  return <span className={styles.spacer} />;
}

/** 버튼 줄의 작은 안내 글(건수 등) */
export function ListNote({ children }: { children: ReactNode }) {
  return <span className={styles.note}>{children}</span>;
}
