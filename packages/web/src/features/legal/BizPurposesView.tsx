'use client';

/**
 * 사업목적(s040300010) 본문 — 카탈로그 문구 목록 + 추가 · 수정(사용 끄기/켜기).
 *
 * ★ **시안이 없다.** 코드 관리(s030100030)의 오른쪽 패널을 그대로 쓴다 — 같은 CSS(`codes.module.css`)의
 *   제목 · 패널 · 검색 줄 · 표 · 아래 띠다. 분류가 없어서 왼쪽 목록은 없다(패널 하나가 폭 전체).
 * ★ 운영사 전용 화면이라 사용 끈 줄까지 늘 받는다(`includeInactive`) — 코드 관리처럼 「사용 안 함」
 *   딱지와 흐린 줄로 보인다.
 * ★ 검색은 **서버가** 한다([조회] — 코드 관리와 같이 눌러야 적용). 목록은 500줄에서 끊기므로
 *   (나중 법령 적재 대비) 화면에서 거르면 끊긴 뒤쪽을 못 찾는다.
 * ★ 지우기 버튼은 없다(결정 2026-10-11) — 수정 팝업의 「사용 안 함」.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Icon } from '@/components/ds';
import { cf } from '@/features/facility/ModalShell';
import { BizPurposeError, loadBizPurposes, type BizPurposeItem } from './biz-purposes-model';
import { BizPurposeDialog } from './BizPurposeDialog';
import styles from '@/features/codes/codes.module.css';

export function BizPurposesView() {
  const [items, setItems] = useState<BizPurposeItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  /** `undefined` = 닫힘, `null` = 신규. */
  const [dialog, setDialog] = useState<BizPurposeItem | null | undefined>(undefined);

  const refresh = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const page = await loadBizPurposes(q, true);
      setItems(page.items);
      setTruncated(page.truncated);
      setError(null);
    } catch (err) {
      setItems([]);
      setTruncated(false);
      setError(err instanceof BizPurposeError ? err.message : '사업목적을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(query);
  }, [query, refresh]);

  const activeCount = items.filter((i) => i.active).length;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>사업목적</h1>
      </div>

      <div className={styles.body}>
        <section className={styles.panel}>
          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>사업목적 문구</h2>
              <p className={styles.panelSub}>
                회사는 법인변경 화면의 [목록에서 고르기]로 「사용」 문구만 고릅니다.
              </p>
            </div>
            <div className={styles.actions}>
              <Button size="sm" variant="primary" onClick={() => setDialog(null)}>
                <Icon name="plus" size={16} />
                문구 추가
              </Button>
            </div>
          </div>

          <div className={styles.panelSearch}>
            <input
              className={`${cf.input} ${styles.panelSearchInput}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setQuery(input.trim())}
              placeholder="문구"
              aria-label="문구"
            />
            <button type="button" className={`${styles.btnXs} ${styles.searchBtn}`} onClick={() => setQuery(input.trim())}>
              조회
            </button>
            <button
              type="button"
              className={`${styles.btnXs} ${styles.searchBtn}`}
              onClick={() => {
                setInput('');
                setQuery('');
              }}
            >
              초기화
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>사업목적 문구</th>
                  <th className={styles.center}>사용여부</th>
                  <th className={styles.center}>동작</th>
                </tr>
              </thead>
              <tbody>
                {/* ★ 「불러오는 중」과 「없음」을 가른다 — 둘을 섞으면 거짓을 보여 준다. */}
                {loading ? (
                  <tr>
                    <td colSpan={3} className={styles.center}>
                      불러오는 중…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={3} className={styles.center}>
                      {query === '' ? '사업목적 문구가 없습니다' : '조회 결과가 없습니다'}
                    </td>
                  </tr>
                ) : (
                  items.map((i) => (
                    <tr key={i.id} className={i.active ? undefined : styles.rowOff}>
                      <td>{i.text}</td>
                      <td className={styles.center}>
                        <span className={`${styles.tag} ${i.active ? styles.tagOn : styles.tagOff}`}>
                          {i.active ? '사용' : '사용 안 함'}
                        </span>
                      </td>
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" className={styles.btnXs} onClick={() => setDialog(i)}>
                            수정
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.panelFoot}>
            <span>
              {query === '' ? '문구' : '조회'} {items.length}개 · 사용 {activeCount}개
            </span>
            {!loading && truncated ? (
              <span className={styles.panelFootSub}>앞의 {items.length}개만 보입니다 — 검색어로 좁히세요</span>
            ) : null}
          </div>
        </section>
      </div>

      {dialog !== undefined ? (
        <BizPurposeDialog
          item={dialog}
          onClose={() => setDialog(undefined)}
          onSaved={async () => {
            setDialog(undefined);
            await refresh(query);
          }}
        />
      ) : null}
    </div>
  );
}
