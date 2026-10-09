'use client';

/**
 * 공용 회사 조회 팝업 — 삐용 단체를 찾아 하나 고른다(2026-10-09).
 *
 * 법무 서비스(S04)가 처음 쓰지만 법무 것이 아니다 — 세무 등 「회사를 삐용 단체로 지목하는」
 * 업무가 같이 쓴다. 그래서 `features/legal` 이 아니라 공용 자리(`components/`)에 있다.
 *
 * =============================================================================
 * ★★★ 돌려주는 것은 셋뿐이다 — 단체 ID · 단체코드 · 회사명 (`OrgPick`)
 * =============================================================================
 * 대표자명·상태·입주사 딱지는 **고를 때 보라고** 띄운다. 고른 뒤의 처리는 부르는 화면이
 * 한다 — ERP 입주사 정보나 법무 회사 정보가 필요하면 그 화면이 다시 읽는다. 팝업이 실어
 * 나른 값을 저장하면 그게 복사본이 된다(`domain/org-lookup.ts` 머리말).
 *
 * ★ **화면 코드가 없다.** 마크업·조회 재사용일 뿐이다. 부르는 화면이 자기 팝업 번호
 *   (`s04…p{n}`)를 붙인다 — 센터 관리의 `ModalShell` 과 같은 규칙이다.
 * ★★ **운영사만 쓸 수 있다.** 서버(`GET /org-lookup`)가 회사 세션을 403 으로 막는다.
 *    회사 사용자 화면에 이 팝업을 두지 않는다 — 자기 회사는 세션이 이미 안다.
 * ★ 삐용 단체 조회 규격이 아직 없어서 실연동(`BBIYONG_MOCK=false`)에서는 「아직 연결되지
 *   않았습니다」가 뜬다. 그 문구는 서버가 준다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  tenantLabel,
  toOrgPick,
  type OrgLookupItem,
  type OrgPick,
} from '@swonbiz/shared/domain/org-lookup';
import styles from './org-lookup.module.css';

interface Props {
  /** 제목. 부르는 화면의 말로 바꿀 수 있다(예: 「법인변경 회사 선택」). */
  title?: string;
  onClose: () => void;
  /** 고른 단체 — **셋뿐이다**(머리말). */
  onPick: (pick: OrgPick) => void;
}

type Load =
  | { state: 'loading' }
  | { state: 'ok'; items: OrgLookupItem[] }
  | { state: 'error'; message: string };

export function OrgLookupDialog({ title = '회사 조회', onClose, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [selected, setSelected] = useState<number | null>(null);
  /** 늦게 온 응답이 새 검색 결과를 덮지 않게 — 마지막 요청만 그린다. */
  const seq = useRef(0);

  const search = useCallback(async (q: string) => {
    const mine = ++seq.current;
    setLoad({ state: 'loading' });
    setSelected(null);
    try {
      const res = await fetch(`/api/org-lookup?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { orgs?: OrgLookupItem[]; message?: string };
      if (mine !== seq.current) return;
      if (!res.ok) {
        setLoad({ state: 'error', message: body.message ?? '회사를 불러오지 못했습니다' });
        return;
      }
      setLoad({ state: 'ok', items: body.orgs ?? [] });
    } catch {
      if (mine === seq.current) setLoad({ state: 'error', message: '서버에 연결할 수 없습니다' });
    }
  }, []);

  // 열 때 전부 띄운다 — 삐용이 「법무 서비스를 받은 회사」로 걸러 보낸다(회신 2026-10-09).
  useEffect(() => {
    void search('');
  }, [search]);

  const items = load.state === 'ok' ? load.items : [];
  const picked = items.find((o) => o.orgId === selected) ?? null;
  const pick = (item: OrgLookupItem) => onPick(toOrgPick(item));

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.desc}>삐용에 등록된 회사입니다. 회사명 일부로 찾을 수 있습니다.</p>

        <form
          className={styles.searchRow}
          onSubmit={(e) => {
            e.preventDefault();
            void search(query);
          }}
        >
          <input
            className={styles.input}
            placeholder="회사명"
            value={query}
            autoFocus
            maxLength={50}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSearch}`}>
            검색
          </button>
        </form>

        <div className={styles.list}>
          {load.state === 'loading' ? (
            <p className={styles.note}>불러오는 중…</p>
          ) : load.state === 'error' ? (
            <p className={styles.error} role="alert">
              {load.message}
            </p>
          ) : items.length === 0 ? (
            <p className={styles.note}>찾는 회사가 없습니다.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>단체코드</th>
                  <th>회사명</th>
                  <th>대표자</th>
                  <th>상태</th>
                  <th>구분</th>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr
                    key={o.orgId}
                    className={`${styles.row}${o.orgId === selected ? ` ${styles.rowOn}` : ''}`}
                    aria-selected={o.orgId === selected}
                    onClick={() => setSelected(o.orgId)}
                    onDoubleClick={() => pick(o)}
                  >
                    <td className={styles.code}>{o.orgCode}</td>
                    <td className={styles.name} title={o.orgName}>
                      {o.orgName}
                    </td>
                    <td>{o.repName ?? '—'}</td>
                    <td>{o.status ?? '—'}</td>
                    <td>
                      <span className={`${styles.badge} ${o.isTenant ? styles.badgeTenant : styles.badgeOther}`}>
                        {tenantLabel(o.isTenant)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.foot}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!picked}
            onClick={() => picked && pick(picked)}
          >
            선택
          </button>
        </div>
      </div>
    </div>
  );
}
