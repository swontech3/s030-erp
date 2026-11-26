'use client';

/**
 * 법인변경 상세 — 「출력 이력」 카드(040, 2026-10-11). 읽기만 한다.
 *
 * ★ 회사는 자기 건, 운영사는 전체 — 서버(RLS)가 가른다. 이 화면은 받은 줄을 그린다.
 * ★ 「인쇄 창을 연」 기록이다 — 브라우저 인쇄 창에서 취소했는지는 모른다(040 머리말). 카드 아래에 적어 둔다.
 * ★ 누가 — 삐용 회원 ID 와 역할(운영사 · 회사)만 있다. 이름은 이 표에 없다.
 * ★ `reloadKey` 가 바뀌면 다시 읽는다 — 서류 출력 대화상자를 닫을 때 상세가 올린다.
 */
import { useEffect, useState } from 'react';
import type { PrintLogItem } from '@swonbiz/shared/domain/corp-change-print';
import { Table, TableHead, TableRow } from '@/components/ds';
import styles from './corp-change-detail.module.css';

/*
 * ★ 2026-11-25 법무 일관성 — 표 = 공통 Table(머리글 아쿠아). 종전 <table> 은 칸 폭을 정하지 않은 자동 폭이라 같은 값이 없다 —
 *   일시 · 신청일 · 작성일은 날짜 글자 폭, 서류 · 누가는 남는 폭을 나눠 가진다(보고 「정할 것」).
 */
const HISTORY_COLS = '150px minmax(0, 1.6fr) minmax(0, 0.8fr) 110px 110px minmax(0, 1.2fr)';

const ROLE: Readonly<Record<PrintLogItem['printedRole'], string>> = { operator: '운영사', tenant: '회사' };

export function CorpChangePrintHistory({ id, reloadKey }: { id: string; reloadKey: number }) {
  const [items, setItems] = useState<PrintLogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/legal/corp-changes/${encodeURIComponent(id)}/prints`, { cache: 'no-store' });
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
        <Table cols={HISTORY_COLS} dense>
          <TableHead>
            <span>일시</span>
            <span>서류</span>
            <span>임원</span>
            <span>신청일</span>
            <span>작성일</span>
            <span>누가</span>
          </TableHead>
          {items.map((it, i) => (
            <TableRow key={i}>
              <span className={styles.tabular}>{it.printedAt}</span>
              <span>{it.formName}</span>
              <span>{it.officerName ?? '—'}</span>
              <span className={styles.tabular}>{it.applyDate ?? '—'}</span>
              <span className={styles.tabular}>{it.writeDate ?? '—'}</span>
              <span>
                {ROLE[it.printedRole] ?? it.printedRole} · {it.printedBy}
              </span>
            </TableRow>
          ))}
        </Table>
      ) : null}
      <p className={styles.hint} style={{ marginTop: 8 }}>
        [인쇄] 를 누른 기록입니다 — 인쇄 창에서 취소했는지는 남지 않습니다.
      </p>
    </section>
  );
}
