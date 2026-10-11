'use client';

/**
 * 법인설립 상세 — 「출력 이력」 카드(043, 10-5). 읽기만 한다. 법인변경 카드(`CorpChangePrintHistory`)와 같다.
 *
 * ★ 회사는 자기 건, 운영사는 전체 — 서버(RLS)가 가른다. 이 화면은 받은 줄을 그린다.
 * ★ 「인쇄 창을 연」 기록이다 — 브라우저 인쇄 창에서 취소했는지는 모른다(043 머리말). 카드 아래에 적어 둔다.
 * ★ 누가 — 삐용 회원 ID 와 역할(운영사 · 회사)만 있다. 이름은 이 표에 없다.
 * ★ `reloadKey` 가 바뀌면 다시 읽는다 — 서류 출력 대화상자를 닫을 때 상세가 올린다.
 */
import { useEffect, useState } from 'react';
import type { IncorpPrintLogItem as PrintLogItem } from '@swonbiz/shared/domain/incorporation-print';
import styles from './corp-change-detail.module.css';

const ROLE: Readonly<Record<PrintLogItem['printedRole'], string>> = { operator: '운영사', tenant: '회사' };

export function IncorporationPrintHistory({ id, reloadKey }: { id: string; reloadKey: number }) {
  const [items, setItems] = useState<PrintLogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/legal/incorporations/${encodeURIComponent(id)}/prints`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { items?: PrintLogItem[]; message?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(body.message ?? '출력 이력을 불러오지 못했습니다');
          return;
        }
        setError(null);
        setItems(body.items ?? []);
      } catch {
        if (alive) setError('서버에 연결할 수 없습니다');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, reloadKey]);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>출력 이력</h2>
      </div>
      <div className={styles.sectionRule} />
      {error ? <p className={styles.modalErr}>{error}</p> : null}
      {items === null && !error ? <p className={styles.hint}>불러오는 중…</p> : null}
      {items && items.length === 0 ? <p className={styles.hint}>아직 출력한 서류가 없습니다.</p> : null}
      {items && items.length > 0 ? (
        <table className={styles.historyTable}>
          <thead>
            <tr>
              <th>일시</th>
              <th>서류</th>
              <th>사람</th>
              <th>신청일</th>
              <th>작성일</th>
              <th>누가</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>{it.printedAt}</td>
                <td>{it.formName}</td>
                <td>{it.personName ?? '—'}</td>
                <td>{it.applyDate ?? '—'}</td>
                <td>{it.writeDate ?? '—'}</td>
                <td>
                  {ROLE[it.printedRole] ?? it.printedRole} · {it.printedBy}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className={styles.hint} style={{ marginTop: 8 }}>
        [인쇄] 를 누른 기록입니다 — 인쇄 창에서 취소했는지는 남지 않습니다.
      </p>
    </section>
  );
}
