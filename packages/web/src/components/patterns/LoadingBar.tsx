/**
 * ERP 공통 로딩바 — 오른쪽 상세 칸 맨 위의 가는 진행 막대(대표 지시 2026-11-15).
 *
 * ★ 왼쪽 목록 · 오른쪽 상세 화면에서 상세를 **받아 오는 동안** 「불러오는 중」 글자 대신 쓴다.
 *   부르는 쪽이 상세 칸의 첫 자식으로 둔다. 받는 동안만 그린다(끝나면 부르는 쪽이 빼낸다).
 * ★ 얼마나 남았는지는 모른다 — 막대가 좌우로 흐르기만 한다(값 없는 progressbar).
 * ★ 색은 기존 토큰만 — 바탕 `--color-accent-bg`, 흐르는 줄 `--color-primary`.
 */
import styles from './LoadingBar.module.css';

export function LoadingBar() {
  return <div className={styles.bar} role="progressbar" aria-label="불러오는 중" aria-busy="true" />;
}
