'use client';

/**
 * 「사업목적 고르기」 팝업 — 카탈로그에서 문구를 여러 개 골라 **문구만** 넘긴다(30-5, 2026-10-11).
 *
 * 법인변경(목적변경)이 처음 쓰고, 법인설립이 같이 쓴다. 둘 다 법무 서비스라 `features/legal` 에 둔다.
 *
 * =============================================================================
 * ★★★ 돌려주는 것은 문구 배열뿐이다 — `onPick(texts)`
 * =============================================================================
 * 카탈로그 줄의 id 도, 업종코드 · KSIC · 인허가도 넘기지 않는다(지금은 문구만 — 결정 2026-10-11).
 * 받은 문구를 어디에 어떻게 넣을지는 부르는 화면이 정한다(법인변경은 `appendPurposeLines` 로 줄 덧붙이기).
 *
 * ★ 누가 부르나 — 운영사 · 회사 모두. 목록은 `GET /legal/biz-purposes` 이고 **사용 중인 문구만** 받는다
 *   (`includeInactive` 를 보내지 않는다 — 운영사도 끈 문구는 고르지 않는다).
 * ★ 카탈로그를 고치는 버튼은 없다 — 고치는 자리는 030 화면 하나다(한 업무는 한 화면).
 * ★ **화면 코드가 없다**(공용 회사 조회 팝업과 같다) — 부르는 화면이 자기 `p{n}` 를 붙인다.
 *
 * =============================================================================
 * ★ 나중에 붙일 자리 (결정 2026-10-11 — 지금은 자리만)
 * =============================================================================
 *   · 탭: 지금은 「전체」 하나. 「추천」(RAG 제안) 탭은 `TABS` 에 한 줄 더하고 그 탭의 목록 읽기를 붙인다
 *   · 분류 필터: 법령 적재로 분류가 생기면 검색 줄의 `filters` 자리에 넣는다. 지금은 비어 있다
 * 탭이 늘어도 넘기는 것은 같다 — 문구 배열.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BizPurposeError, loadBizPurposes, type BizPurposeItem } from './biz-purposes-model';
import base from '@/components/org-lookup/org-lookup.module.css';
import styles from './biz-purpose-picker.module.css';

/** 탭 — 지금은 「전체」 하나(머리말). */
const TABS = [{ key: 'all', label: '전체' }] as const;
type TabKey = (typeof TABS)[number]['key'];

interface Props {
  /** 제목. 부르는 화면의 말로 바꿀 수 있다. */
  title?: string;
  /**
   * 이미 적혀 있는 문구 — 같은 문구(앞뒤 공백 무시)는 「추가됨」으로 보이고 고를 수 없다.
   * ★ 보여 주기만 한다. 실제로 건너뛰는 것은 부르는 화면의 몫이다(`appendPurposeLines`).
   */
  existing?: readonly string[];
  onClose: () => void;
  /** 고른 문구 — 고른 순서. */
  onPick: (texts: string[]) => void;
}

type Load =
  | { state: 'loading' }
  | { state: 'ok'; items: BizPurposeItem[]; truncated: boolean }
  | { state: 'error'; message: string };

export function BizPurposePickerDialog({ title = '사업목적 고르기', existing = [], onClose, onPick }: Props) {
  const [tab, setTab] = useState<TabKey>('all');
  const [query, setQuery] = useState('');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  /** 고른 줄의 id. ★ 검색을 바꿔도 유지한다 — 여러 번 찾아 모아 담을 수 있게. 넘길 때는 문구로 바꾼다. */
  const [checked, setChecked] = useState<Map<string, string>>(new Map());
  /** 늦게 온 응답이 새 검색 결과를 덮지 않게 — 마지막 요청만 그린다. */
  const seq = useRef(0);

  const have = useMemo(() => new Set(existing.map((t) => t.trim()).filter((t) => t !== '')), [existing]);

  const search = useCallback(async (q: string) => {
    const mine = ++seq.current;
    setLoad({ state: 'loading' });
    try {
      const page = await loadBizPurposes(q, false);
      if (mine === seq.current) setLoad({ state: 'ok', items: page.items, truncated: page.truncated });
    } catch (err) {
      if (mine === seq.current) {
        setLoad({ state: 'error', message: err instanceof BizPurposeError ? err.message : '사업목적을 불러오지 못했습니다' });
      }
    }
  }, []);

  // 열 때 전부 띄운다 — 지금은 문구가 적다. 많아지면 500줄에서 끊기고 아래에 안내가 뜬다.
  useEffect(() => {
    void search('');
  }, [search]);

  const items = load.state === 'ok' ? load.items : [];
  const toggle = (item: BizPurposeItem) =>
    setChecked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item.text);
      return next;
    });

  /** 나중 분류 필터 자리(머리말) — 지금은 비어 있다. */
  const filters: ReactNode = null;

  return (
    <div
      className={base.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className={base.modal} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className={base.title}>{title}</h2>
        <p className={base.desc}>고른 문구는 사업목적 칸 끝에 한 줄씩 붙습니다. 이미 적힌 문구는 고를 수 없습니다.</p>

        <div className={styles.tabs} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tab}${tab === t.key ? ` ${styles.tabOn}` : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form
          className={base.searchRow}
          onSubmit={(e) => {
            e.preventDefault();
            void search(query);
          }}
        >
          {filters}
          <input
            className={base.input}
            placeholder="문구"
            value={query}
            autoFocus
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className={`${base.btn} ${base.btnGhost} ${base.btnSearch}`}>
            검색
          </button>
        </form>

        <div className={base.list}>
          {load.state === 'loading' ? (
            <p className={base.note}>불러오는 중…</p>
          ) : load.state === 'error' ? (
            <p className={base.error} role="alert">
              {load.message}
            </p>
          ) : items.length === 0 ? (
            <p className={base.note}>찾는 문구가 없습니다.</p>
          ) : (
            <table className={base.table}>
              <thead>
                <tr>
                  <th className={styles.checkCell} aria-label="고르기" />
                  <th>사업목적 문구</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const done = have.has(i.text.trim());
                  return (
                    <tr
                      key={i.id}
                      className={done ? styles.rowDone : `${base.row}${checked.has(i.id) ? ` ${base.rowOn}` : ''}`}
                      onClick={() => !done && toggle(i)}
                    >
                      <td className={styles.checkCell}>
                        {done ? null : (
                          <input
                            type="checkbox"
                            checked={checked.has(i.id)}
                            onChange={() => toggle(i)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={i.text}
                          />
                        )}
                      </td>
                      <td>
                        {i.text} {done ? <span className={styles.done}>추가됨</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className={styles.count}>
          {checked.size}개 고름
          {load.state === 'ok' && load.truncated ? ` · 앞의 ${items.length}개만 보입니다 — 검색어로 좁히세요` : ''}
        </p>

        <div className={base.foot}>
          <button type="button" className={`${base.btn} ${base.btnGhost}`} onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className={`${base.btn} ${base.btnPrimary}`}
            disabled={checked.size === 0}
            onClick={() => onPick([...checked.values()])}
          >
            선택
          </button>
        </div>
      </div>
    </div>
  );
}
