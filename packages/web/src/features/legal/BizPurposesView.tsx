'use client';

/**
 * 사업목적(s040300010) 본문 — 카탈로그 문구 목록 + 추가 · 수정(사용 끄기/켜기).
 *
 * ★ **시안이 없다.** 코드 관리(s030100030)의 오른쪽 패널을 그대로 쓴다 — 같은 CSS(`codes.module.css`)의
 *   제목 · 패널 · 검색 줄 · 표 · 아래 띠다.
 * ★ 운영사 전용 화면이라 사용 끈 줄까지 늘 받는다(`includeInactive`) — 코드 관리처럼 「사용 안 함」
 *   딱지와 흐린 줄로 보인다.
 * ★ 검색은 **서버가** 한다([조회] — 코드 관리와 같이 눌러야 적용). 목록은 500줄에서 끊기므로
 *   (나중 법령 적재 대비) 화면에서 거르면 끊긴 뒤쪽을 못 찾는다.
 * ★ 지우기 버튼은 없다(결정 2026-10-11) — 상세의 「사용 안 함」.
 *
 * ★★ 2026-11-16 대표 지시 — **왼쪽 목록 5 : 오른쪽 상세 5**(청구 화면과 같은 틀). 옛 수정 창(`BizPurposeDialog`)을
 *    오른쪽 상세(`BizPurposeDetail`)로 옮겼다 — 칸 · 안내 · 저장은 그대로. 줄을 누르면 그 문구를, [문구 추가] 는 빈 상세를
 *    오른쪽에 연다. 처음엔 「왼쪽에서 고르세요」. 줄마다 있던 [수정] 단추(「동작」 칸)는 줄 누름으로 바뀌어 뺐다.
 *    저장하면 목록을 다시 받고 그 문구를 고른 채로 둔다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Icon } from '@/components/ds';
import { ListFrame } from '@/components/patterns/ListFrame';
import { cf } from '@/features/facility/ModalShell';
import { BizPurposeError, loadBizPurposes, type BizPurposeItem } from './biz-purposes-model';
import { BizPurposeDetail } from './BizPurposeDetail';
import { PaneEmpty } from './LegalDetailPanes';
import styles from '@/features/codes/codes.module.css';
import ls from './corp-changes.module.css';

/** 오른쪽 상세 — 고른 문구 · 새 문구. `v` 는 저장 뒤 다시 그리려고 올린다. */
type Sel = { kind: 'item'; item: BizPurposeItem; v: number } | { kind: 'new'; v: number };

export function BizPurposesView() {
  const [items, setItems] = useState<BizPurposeItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<Sel | null>(null);

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
  const selId = sel?.kind === 'item' ? sel.item.id : null;

  return (
    /*
      ★ 2026-11-16 — 왼쪽 목록 5 : 오른쪽 상세 5. 왼쪽은 공통 목록 틀(검색 → 버튼 줄 → 목록) 그대로다.
    */
    <div className={ls.splitPage}>
      <div className={styles.head} data-page-title>
        <h1 className={styles.title}>사업목적</h1>
      </div>
      <div className={`${ls.split} ${ls.splitHalf}`}>
        <div className={`${ls.splitLeft} ${ls.dense}`}>
          <ListFrame
            search={
              <>
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
              </>
            }
            actions={
              <Button size="sm" variant="primary" onClick={() => setSel({ kind: 'new', v: Date.now() })}>
                <Icon name="plus" size={16} />
                문구 추가
              </Button>
            }
            listPadded
          >
            {error ? <p className={styles.error}>{error}</p> : null}

            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>사업목적 문구</h2>
                <p className={styles.panelSub}>회사는 법인변경 화면의 [목록에서 고르기]로 「사용」 문구만 고릅니다.</p>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>사업목적 문구</th>
                    <th className={styles.center}>사용여부</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ★ 「불러오는 중」과 「없음」을 가른다 — 둘을 섞으면 거짓을 보여 준다. */}
                  {loading ? (
                    <tr>
                      <td colSpan={2} className={styles.center}>
                        불러오는 중…
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={2} className={styles.center}>
                        {query === '' ? '사업목적 문구가 없습니다' : '조회 결과가 없습니다'}
                      </td>
                    </tr>
                  ) : (
                    items.map((i) => (
                      <tr
                        key={i.id}
                        tabIndex={0}
                        aria-selected={selId === i.id}
                        className={`${ls.bpRow}${i.active ? '' : ` ${styles.rowOff}`}${selId === i.id ? ` ${ls.bpRowOn}` : ''}`}
                        onClick={() => setSel({ kind: 'item', item: i, v: Date.now() })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setSel({ kind: 'item', item: i, v: Date.now() });
                        }}
                      >
                        <td>{i.text}</td>
                        <td className={styles.center}>
                          <span className={`${styles.tag} ${i.active ? styles.tagOn : styles.tagOff}`}>
                            {i.active ? '사용' : '사용 안 함'}
                          </span>
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
          </ListFrame>
        </div>

        {/* 오른쪽 상세 — 처음엔 「왼쪽에서 고르세요」. 목록에 있는 줄이라 받아 올 것이 없다(로딩바 없음). */}
        <div className={ls.splitRight} data-legal-detail={sel === null ? '' : sel.kind === 'new' ? 'new' : sel.item.id}>
          {sel === null ? (
            <PaneEmpty lead="왼쪽에서 고르세요" sub="문구 줄을 누르면 여기에서 고칩니다 — 새 문구는 [문구 추가]" />
          ) : (
            <BizPurposeDetail
              // ★ 다른 줄 · 저장 뒤에는 입력 칸을 새로 채운다.
              key={`${sel.kind === 'item' ? sel.item.id : 'new'}:${sel.v}`}
              item={sel.kind === 'item' ? sel.item : null}
              onClose={() => setSel(null)}
              onSaved={async (saved) => {
                setSel({ kind: 'item', item: saved, v: Date.now() });
                await refresh(query);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
