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
import { Button, Icon, Table, TableEmpty, TableHead, TableRow, tableCell } from '@/components/ds';
import { ListFrame, ListNote } from '@/components/patterns/ListFrame';
import { cf } from '@/features/facility/ModalShell';
import { BizPurposeError, loadBizPurposes, type BizPurposeItem } from './biz-purposes-model';
import { BizPurposeDetail } from './BizPurposeDetail';
import { PaneEmpty } from './LegalDetailPanes';
import styles from '@/features/codes/codes.module.css';
import ls from './corp-changes.module.css';

/** 오른쪽 상세 — 고른 문구 · 새 문구. `v` 는 저장 뒤 다시 그리려고 올린다. */
type Sel = { kind: 'item'; item: BizPurposeItem; v: number } | { kind: 'new'; v: number };

/*
 * ★ 2026-11-25 법무 일관성(삐용 기준) — 목록 = 공통 표(Table). 종전 <table> 은 자동 폭이었다 —
 *   사용여부 칸 96px 은 코드 관리 코드값 표의 사용여부 칸과 같은 값. 칸 사이 · 좌우 20 은 종전 표(첫/끝 칸 20)와 같다(.bpGrid).
 */
const BP_COLS = 'minmax(0, 1fr) 96px';

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
                {/* ★ 2026-11-25 일관성 — 오른쪽 끝 [초기화][조회](보통 단추) 다음 「n건」. [조회] 를 눌러야 적용(그대로) */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setInput('');
                    setQuery('');
                  }}
                >
                  초기화
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setQuery(input.trim())}>
                  조회
                </Button>
                <ListNote>{loading ? '' : `${items.length}건`}</ListNote>
              </>
            }
            actions={
              /* ★ 2026-11-25 일관성 — 등록 = 보통 단추 · 표 위 왼쪽 */
              <Button
                size="sm"
                variant="ghost"
                iconLeft={<Icon name="plus" size={16} />}
                onClick={() => setSel({ kind: 'new', v: Date.now() })}
              >
                문구 추가
              </Button>
            }
            listPadded
          >
            {error ? <p className={styles.error}>{error}</p> : null}

            <div className={styles.panelHead}>
              <div>
                {/* ★ 2026-11-25 일관성 — 구역 제목 = 왼쪽 4px 아쿠아 막대(글자에만) */}
                <h2 className={`${styles.panelTitle} ${ls.sectionTitle}`}>사업목적 문구</h2>
                <p className={styles.panelSub}>회사는 법인변경 화면의 [목록에서 고르기]로 「사용」 문구만 고릅니다.</p>
              </div>
            </div>

            <div className={styles.tableWrap}>
              {/* ★ 2026-11-25 일관성 — 공통 표(Table · 머리글 아쿠아). 칸 폭은 BP_COLS */}
              <Table cols={BP_COLS}>
                <TableHead sticky className={ls.bpGrid}>
                  <span>사업목적 문구</span>
                  <span className={tableCell.center}>사용여부</span>
                </TableHead>
                {/* ★ 「불러오는 중」과 「없음」을 가른다 — 둘을 섞으면 거짓을 보여 준다. */}
                {loading ? (
                  <TableEmpty>불러오는 중…</TableEmpty>
                ) : items.length === 0 ? (
                  <TableEmpty>{query === '' ? '사업목적 문구가 없습니다' : '조회 결과가 없습니다'}</TableEmpty>
                ) : (
                  items.map((i) => (
                    /* ★ 사용 안 함 줄 = 흐린 줄(muted)을 줄 전체 글자에(코드 관리 정한 것 8 과 같은 .rowOff) */
                    <TableRow
                      key={i.id}
                      selected={selId === i.id}
                      muted={!i.active}
                      className={`${ls.bpGrid}${i.active ? '' : ` ${ls.rowOff}`}`}
                      onClick={() => setSel({ kind: 'item', item: i, v: Date.now() })}
                    >
                      <span>{i.text}</span>
                      <span className={tableCell.center}>
                        <span className={`${styles.tag} ${i.active ? styles.tagOn : styles.tagOff}`}>
                          {i.active ? '사용' : '사용 안 함'}
                        </span>
                      </span>
                    </TableRow>
                  ))
                )}
              </Table>
            </div>

            <div className={styles.panelFoot}>
              <span>
                {/* ★ 2026-11-25 대표 결정(법무 정한 것 5) — 「문구 n개」를 뺐다(「사용 n개」는 그대로) */}
                {query === '' ? '' : `조회 ${items.length}개 · `}사용 {activeCount}개
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
