'use client';

/**
 * 법인설립 [서류 출력] 대화상자(10-5, 2026-10-11) — 상세(s040100020)의 작성완료 · 완료 건.
 * ★ 법인변경 대화상자(`CorpChangePrintDialog`)와 같은 모양 · 같은 규칙이다. 다른 것: 임원마다 · 발기인마다 서류의 장,
 *   양식이 정한 안내(`notice` — 조사보고인이 없을 때 「해당 사람 없음」, 결정 4).
 *
 * 왼쪽 서류 목록(임원마다 서류는 임원별 장) → 가운데 미리보기 → [인쇄]. 서류는 **하나씩** 인쇄한다(결정 G).
 *
 * ★★ 값은 서버가 만든다(`GET /legal/incorporations/:id/print`) — 이 화면은 그리기만 한다. 서류 이름은
 *    양식 이름, 어느 서류가 뜨는지는 양식의 법무 표시다(결정 A). 미리보기와 종이는 같은 컴포넌트
 *    (`FormDocument`)다 — 미리보기는 빈 자리표시를 이름표로 흐리게, 종이는 빈칸.
 * ★★ 출력 직전 입력은 신청일 · 작성일뿐이다(Q8). 내용을 고치려면 [서류수정](E→P)으로 간다.
 *    날짜를 바꾸면 서버에 다시 묻는다 — 날짜 글자 모양도 서버 한 곳에서 만든다.
 * ★★ 응답에 주민번호 평문이 있다(Q4). 이 화면은 값을 **어디에도 남기지 않는다** — 상태로만 들고,
 *    대화상자를 닫으면 사라진다(인쇄용 포털도 함께 내려간다). 저장소 · 콘솔에 쓰지 않는다.
 * ★ 「기본 양식입니다 …」 안내는 대화상자에만 있다 — 종이(포털)에는 나가지 않는다(사용자 지시 2026-10-11).
 * ★ [인쇄] 를 누르면 출력 이력(043)을 한 줄 남긴다 — 양식 id 와 장 번호만 보낸다(이름은 서버가 찾는다).
 *   **결과를 기다리지 않는다** — 기록이 실패해도 인쇄는 한다(결정 2026-10-11, 실패는 서버 로그).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { INCORP_PRINT_FIELDS, type IncorporationPrintResponse } from '@swonbiz/shared/domain/incorporation-print';
import type { FormDefinition } from '@swonbiz/shared/domain/form-template';
import { Icon } from '@/components/ds';
import { FormDocument } from '@/features/forms/FormDocument';
import { FormPrintPortal, printFormDocument } from '@/features/forms/FormPrintPortal';
import { PRINT_NOTICE } from './CorpChangePrintDialog';
import styles from './corp-change-detail.module.css';

type PrintData = IncorporationPrintResponse<FormDefinition>;

/** 사람의 「오늘」 — 브라우저 시간대의 날짜(`YYYY-MM-DD`). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 자리표시 이름표 — 미리보기에서 빈 칸을 흐리게 보일 때 쓴다. */
const LABELS: Readonly<Record<string, string>> = Object.fromEntries(INCORP_PRINT_FIELDS.map((f) => [f.name, f.label]));


/** 출력 이력 한 줄 — 기다리지 않는다. 실패도 화면에 알리지 않는다(서버 로그에 남는다). */
function recordPrint(id: string, body: { formId: string; sheet: number; applyDate: string; writeDate: string }) {
  void fetch(`/api/legal/incorporations/${encodeURIComponent(id)}/prints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, applyDate: body.applyDate || null, writeDate: body.writeDate || null }),
    keepalive: true,
  }).catch(() => undefined);
}

interface Pick {
  doc: number;
  sheet: number;
}

export function IncorporationPrintDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [applyDate, setApplyDate] = useState(localToday);
  const [writeDate, setWriteDate] = useState(localToday);
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<Pick>({ doc: 0, sheet: 0 });
  const seq = useRef(0);

  /* 열 때 · 날짜를 바꿀 때 — 늦게 온 옛 응답은 버린다. */
  useEffect(() => {
    const mine = ++seq.current;
    const q = new URLSearchParams();
    if (applyDate) q.set('applyDate', applyDate);
    if (writeDate) q.set('writeDate', writeDate);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/legal/incorporations/${encodeURIComponent(id)}/print?${q}`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as Partial<PrintData> & { message?: string };
        if (mine !== seq.current) return;
        if (!res.ok) {
          setData(null);
          setError(body.message ?? '서류를 불러오지 못했습니다');
          return;
        }
        setError(null);
        setData(body as PrintData);
      } catch {
        if (mine === seq.current) setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    })();
  }, [id, applyDate, writeDate]);

  /* 고른 장이 없어졌으면(서류 목록이 바뀜) 첫 장으로. */
  const docs = useMemo(() => data?.documents ?? [], [data]);
  const doc = docs[pick.doc];
  const sheet = doc?.sheets[pick.sheet];
  useEffect(() => {
    if (docs.length > 0 && !sheet) {
      const first = docs.findIndex((d) => d.sheets.length > 0);
      setPick({ doc: Math.max(0, first), sheet: 0 });
    }
  }, [docs, sheet]);

  const title = doc ? `${doc.name}${sheet?.personName ? ` · ${sheet.personName}` : ''}` : '서류 출력';

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className={styles.printPanel} role="dialog" aria-modal="true" aria-label="서류 출력">
        <div className={styles.printHead}>
          <h2 className={styles.printTitle}>서류 출력</h2>
          <label className={styles.printDate}>
            <span className={styles.label}>신청일</span>
            <input type="date" className={styles.input} value={applyDate} onChange={(e) => setApplyDate(e.target.value)} />
          </label>
          <label className={styles.printDate}>
            <span className={styles.label}>작성일</span>
            <input type="date" className={styles.input} value={writeDate} onChange={(e) => setWriteDate(e.target.value)} />
          </label>
          <div className={styles.printActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={loading || !sheet}
              onClick={() => {
                if (doc) recordPrint(id, { formId: doc.formId, sheet: pick.sheet, applyDate, writeDate });
                printFormDocument();
              }}
            >
              <Icon name="printer" size={16} />
              인쇄
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        {/* ★ 화면 안내 — 대화상자에만 있다. 종이(포털)에는 나가지 않는다. */}
        <div className={`${styles.banner} ${styles.bannerInfo}`} role="note">
          <Icon name="info" size={16} />
          <span>{PRINT_NOTICE}</span>
        </div>

        <div className={styles.printBody}>
          <nav className={styles.printList} aria-label="서류">
            {docs.length === 0 && !loading && !error ? (
              <p className={styles.hint}>
                이 건에 뜨는 서류가 없습니다. 표양식 관리에서 양식에 「법무 서류로 쓴다」 표시(업무: 법인설립)를 붙여 주세요.
              </p>
            ) : null}
            {docs.map((d, di) => (
              <div key={d.formId} className={styles.printDoc}>
                {d.unit === 'case' ? (
                  <button
                    type="button"
                    className={`${styles.printItem} ${pick.doc === di ? styles.printItemOn : ''}`}
                    onClick={() => setPick({ doc: di, sheet: 0 })}
                  >
                    <Icon name="file-text" size={14} />
                    {d.name}
                  </button>
                ) : null}
                {d.unit === 'case' && d.notice ? <span className={styles.printNone}>해당 사람 없음</span> : null}
                {d.unit === 'case' ? null : (
                  <>
                    <span className={styles.printDocName}>
                      <Icon name="users" size={14} />
                      {d.name}
                    </span>
                    {d.sheets.length === 0 ? <span className={styles.printNone}>해당 사람 없음</span> : null}
                    {d.sheets.map((s, si) => (
                      <button
                        key={si}
                        type="button"
                        className={`${styles.printItem} ${styles.printItemSub} ${pick.doc === di && pick.sheet === si ? styles.printItemOn : ''}`}
                        onClick={() => setPick({ doc: di, sheet: si })}
                      >
                        {s.personName}
                      </button>
                    ))}
                  </>
                )}
              </div>
            ))}
          </nav>

          <div className={styles.printPreview} aria-label={title}>
            {error ? <p className={styles.modalErr}>{error}</p> : null}
            {/* 양식이 정한 안내(조사보고인 없음 등) — 화면에만, 종이에는 나가지 않는다 */}
            {doc?.notice ? (
              <div className={`${styles.banner} ${styles.bannerWarning}`} role="note" style={{ marginBottom: 12 }}>
                <Icon name="triangle-alert" size={16} />
                <span>{doc.notice}</span>
              </div>
            ) : null}
            {loading && !data ? <p className={styles.hint}>불러오는 중…</p> : null}
            {doc && sheet ? <FormDocument definition={doc.definition} values={sheet.values} labels={LABELS} showEmpty /> : null}
          </div>
        </div>
      </div>

      {/* 종이에 나갈 문서 — 고른 장 하나. 대화상자를 닫으면 함께 내려간다. */}
      {doc && sheet ? <FormPrintPortal definition={doc.definition} values={sheet.values} /> : null}
    </div>
  );
}
