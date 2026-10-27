'use client';

/**
 * 자료 올리기(s050200010) 본문 — 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-a.js` 의 S05-02 ·
 * 결과서 `08-screen-report.md` S05-02 그대로. 1-2 범위(결정 2026-10-26):
 *
 *   작업할 달 줄 · 제목 + 배지 · 자료 카드 9장(4열) · 올린 파일 카드
 *   ★ 동작하는 카드는 「매입·매출 계산서」 하나다. 나머지 8장(삐용 경비 포함)은 「준비 중」 — 회색, [올리기] 막힘.
 *   ★ 1-2 에서 그리지 않는 것: 회색 안내 띠 · 「이번 달 없음」 · 「삐용 경비」 줄 · [보기] · 중복 의심 표 · 다음 단계 줄.
 *     짝 맞추기가 없어 「짝이 풀립니다」 문장도 뺐다.
 *
 * ★★ 이름 · 설명 · 선택지는 **API 가 준 코드 값으로만** 그린다(자료 종류 · 계산서 구분 · 뺀 줄 종류 · 사업자 유형).
 *    예외는 「삐용 경비」 카드 이름 하나다 — 자료 종류 코드가 아니다(1-2 는 「준비 중」으로만 그린다).
 * ★ 아이콘 집합(ERP 공용)에 시안의 landmark · banknote · inbox 가 없어 가까운 것으로 대신했다.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ds';
import t from '../common/tax.module.css';
import { TaxConfirmDialog } from '../common/TaxConfirmDialog';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar, monthShort, todayNote } from '../common/TaxMonthBar';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import {
  KIND_INVOICE,
  TaxUploadError,
  checkDelete,
  deleteFiles,
  loadUploads,
  previewUpload,
  shortStamp,
  spreadsheetMimeOf,
  uploadFile,
  won,
  type TaxUploadDeleteResult,
  type TaxUploadPreview,
  type TaxUploadsResponse,
} from './tax-uploads-model';

/** 카드 아이콘 — 시안 KINDS 의 icon(없는 것은 가까운 것으로). */
const KIND_ICON: Record<string, IconName> = {
  INVOICE: 'file-text',
  CARD: 'credit-card',
  CASH: 'wallet',
  BANK: 'building-2',
  NTAX: 'receipt',
  LTAX: 'receipt',
  SOCIAL: 'shield-check',
  LOAN: 'calculator',
};

type Confirm = { ids: string[]; names: string[]; check: TaxUploadDeleteResult } | null;

export function TaxUploadsView({ month }: { month: string }) {
  const [data, setData] = useState<TaxUploadsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [modalKind, setModalKind] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { message: toast, notify } = useTaxToast();

  const reload = useCallback(
    () =>
      loadUploads(month)
        .then((d) => {
          setData(d);
          setSel([]);
        })
        .catch((err: unknown) =>
          setLoadError(err instanceof TaxUploadError ? err.message : '자료 올리기를 불러오지 못했습니다'),
        ),
    [month],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  if (loadError) {
    return (
      <div className={t.page}>
        <TaxFormErrorBanner kind="failed" message={loadError} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className={t.page}>
        <p className={t.help}>불러오는 중…</p>
      </div>
    );
  }

  const kindName = (code: string) => data.codes.kinds.find((k) => k.code === code)?.name ?? code;
  const dirName = (code: string) => data.codes.invDirs.find((d) => d.code === code)?.name ?? code;
  const enabled = data.cards.filter((c) => c.enabled);
  const up = enabled.filter((c) => c.fileCount > 0 || c.unused).length;
  const left = enabled.length - up;

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /** [삭제] — 지우기 전 확인을 먼저 받아 확인 창에 빠질 줄 · 겹쳤을 수 있는 파일을 보인다. */
  const askDelete = async () => {
    setFailed(null);
    try {
      const check = await checkDelete(sel);
      const names = data.files.filter((f) => sel.includes(f.id)).map((f) => f.fileName);
      setConfirm({ ids: sel, names, check });
    } catch (err) {
      setFailed(err instanceof TaxUploadError ? err.message : '확인하지 못했습니다');
    }
  };
  const runDelete = async () => {
    if (!confirm) return;
    const ids = confirm.ids;
    setConfirm(null);
    try {
      await deleteFiles(ids);
      notify('파일을 지웠습니다');
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxUploadError ? err.message : '지우지 못했습니다');
    }
  };

  return (
    <div className={t.page}>
      <TaxMonthBar month={month} note={todayNote(data.bizTypeName)} />
      <div className={t.pageH}>
        <div>
          <h1>자료 올리기</h1>
          <p>
            {monthShort(month)} 자료를 엑셀로 올립니다. 은행·카드는 기관을 고르면 시스템 표준양식으로 바뀝니다. 날짜가 다른 달인
            줄은 그 달로 들어갑니다.
          </p>
        </div>
        <span className={`${t.badge} ${left ? t.bDoing : t.bDone}`}>
          {up}종 올림 · {left}종 남음
        </span>
      </div>

      <div className={t.grid4}>
        {data.cards.map((c) => {
          const k = data.codes.kinds.find((x) => x.code === c.kind);
          const isUp = c.enabled && c.fileCount > 0;
          let badge = <span className={`${t.badge} ${t.bTodo}`}>아직</span>;
          let sub = null;
          if (!c.enabled) badge = <span className={`${t.badge} ${t.bGray}`}>준비 중</span>;
          else if (isUp) badge = <span className={`${t.badge} ${t.bDone}`}>{c.fileCount}개 파일</span>;
          else if (c.unused) {
            badge = <span className={`${t.badge} ${t.bGray}`}>쓰지 않는 자료</span>;
            sub = (
              <Link href="/tax/settings" className={`${t.btn} ${t.btnLink}`} style={{ fontSize: 12 }}>
                세무 설정
              </Link>
            );
          }
          return (
            <div key={c.kind} className={`${t.card} ${t.kind} ${isUp ? t.kindUp : ''}`}>
              <span className={t.kindIc}>
                <Icon name={KIND_ICON[c.kind] ?? 'file-text'} size={16} />
              </span>
              <div>
                <div className={t.kindNm}>{k?.name ?? c.kind}</div>
                {k?.description ? <div className={t.kindDs}>{k.description}</div> : null}
              </div>
              <div className={t.kindFt}>
                <span className={t.row} style={{ gap: 6 }}>
                  {badge}
                  {sub}
                </span>
                <button
                  type="button"
                  className={`${t.btn} ${t.btnSm}`}
                  disabled={!c.enabled}
                  onClick={() => setModalKind(c.kind)}
                >
                  <Icon name="upload" size={16} />
                  올리기
                </button>
              </div>
            </div>
          );
        })}
        {/* 9번째 — 삐용 경비(S05-03 을 합침). 1-2 는 「준비 중」 */}
        <div className={`${t.card} ${t.kind}`}>
          <span className={t.kindIc}>
            <Icon name="package-open" size={16} />
          </span>
          <div>
            <div className={t.kindNm}>삐용 경비</div>
          </div>
          <div className={t.kindFt}>
            <span className={`${t.badge} ${t.bGray}`}>준비 중</span>
            <button type="button" className={`${t.btn} ${t.btnSm}`} disabled>
              <Icon name="rotate-ccw" size={16} />
              가져오기
            </button>
          </div>
        </div>
      </div>

      <div className={t.card}>
        <div className={`${t.cardPad} ${t.cardH}`} style={{ paddingBottom: 12 }}>
          <h2>올린 파일</h2>
          <span className={t.cardHSub}>같은 파일은 다시 올릴 수 없습니다</span>
        </div>
        <div className={t.tbar}>
          <button type="button" className={`${t.btn} ${t.btnSm} ${t.btnDanger}`} disabled={sel.length === 0} onClick={askDelete}>
            <Icon name="trash-2" size={16} />
            삭제{sel.length ? ` (${sel.length})` : ''}
          </button>
          <span className={t.sm}>{sel.length ? `${sel.length}개 선택` : '지울 파일을 줄에서 고르세요 · 여러 개 고를 수 있습니다'}</span>
        </div>
        {failed ? (
          <div style={{ padding: '0 16px 12px' }}>
            <TaxFormErrorBanner kind="failed" message={failed} />
          </div>
        ) : null}
        <div className={t.tblWrap}>
          <table className={t.tbl} style={{ borderTop: '1px solid var(--border)' }}>
            <colgroup>
              <col className={t.wChk} />
              <col style={{ width: 150 }} />
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 64 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="선택" />
                <th>자료</th>
                <th>기관 · 계좌</th>
                <th>파일 이름</th>
                <th className={t.num}>줄</th>
                <th>올린 때</th>
              </tr>
            </thead>
            <tbody>
              {data.files.length === 0 ? (
                <tr>
                  <td colSpan={6} className={t.empty}>
                    아직 올린 파일이 없습니다
                  </td>
                </tr>
              ) : (
                data.files.map((f) => {
                  const on = sel.includes(f.id);
                  return (
                    <tr key={f.id} className={`${t.clickable} ${on ? t.pick : ''}`} onClick={() => toggle(f.id)}>
                      <td>
                        <input
                          type="checkbox"
                          className={t.rowchk}
                          checked={on}
                          aria-label="선택"
                          onChange={() => toggle(f.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td>{kindName(f.kind)}</td>
                      <td className={`${t.mut} ${t.ell}`}>{dirName(f.direction)}</td>
                      <td className={t.ell} title={f.fileName}>
                        {f.fileName}
                      </td>
                      <td className={t.num}>{won(f.insertedCount)}</td>
                      <td className={`${t.mut} ${t.tnum}`}>{shortStamp(f.uploadedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalKind ? (
        <UploadModal
          month={month}
          kind={modalKind}
          data={data}
          onClose={() => setModalKind(null)}
          onDone={(msg) => {
            setModalKind(null);
            notify(msg);
            void reload();
          }}
        />
      ) : null}

      {confirm ? (
        <TaxConfirmDialog
          icon="trash-2"
          danger
          title={confirm.ids.length > 1 ? `파일 ${confirm.ids.length}개를 지우시겠습니까?` : '이 파일을 지우시겠습니까?'}
          okLabel="삭제"
          onCancel={() => setConfirm(null)}
          onOk={runDelete}
          body={
            <>
              {confirm.names.map((n, i) => (
                <span key={i}>
                  <b>{n}</b>
                  <br />
                </span>
              ))}
              {won(confirm.check.deletedRows)}줄이 빠집니다.
              {confirm.check.laterFilesWithSkips.length > 0 ? (
                <>
                  <br />
                  뒤에 올린 파일 {confirm.check.laterFilesWithSkips.map((f) => `「${f.fileName}」`).join(' · ')}과 겹쳤을 수
                  있습니다 — 그 파일에서 건너뛴 줄(최대{' '}
                  {won(confirm.check.laterFilesWithSkips.reduce((n, f) => n + f.skippedRows, 0))}줄)이 함께 빠질 수 있습니다.
                </>
              ) : null}
            </>
          }
        />
      ) : null}
      <TaxToast message={toast} />
    </div>
  );
}

/* ── 업로드 팝업(820px) — 결과서 S05-02 9 ─────────────────────────────────── */

interface ModalProps {
  month: string;
  kind: string;
  data: TaxUploadsResponse;
  onClose: () => void;
  onDone: (toast: string) => void;
}

type Picked = { file: File; mime: string; preview: TaxUploadPreview } | null;

function UploadModal({ month, kind: initialKind, data, onClose, onDone }: ModalProps) {
  const [kind, setKind] = useState(initialKind);
  const [picked, setPicked] = useState<Picked>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const k = data.codes.kinds.find((x) => x.code === kind);
  const canUse = data.cards.find((c) => c.kind === kind)?.enabled ?? false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setPicked(null);
    setError(null);
    const mime = spreadsheetMimeOf(file.name);
    if (!mime) {
      setError('엑셀 파일(.xlsx · .xls)만 올릴 수 있습니다');
      return;
    }
    setBusy(true);
    try {
      setPicked({ file, mime, preview: await previewUpload(kind, file, mime) });
    } catch (err) {
      setError(err instanceof TaxUploadError ? err.message : '파일을 확인하지 못했습니다');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (canUse && !busy) void pick(e.dataTransfer.files[0]);
  };

  const p = picked?.preview ?? null;
  const same = p?.sameFile ?? null;
  const ready = !!p && !same && p.toInsert > 0 && !busy;

  const doUpload = async () => {
    if (!picked || !p) return;
    setBusy(true);
    setError(null);
    try {
      await uploadFile(kind, picked.file, picked.mime);
      onDone(`올렸습니다 · ${p.byMonth.map((m) => `${monthShort(m.month)} ${won(m.count)}줄`).join(', ')}`);
    } catch (err) {
      setError(err instanceof TaxUploadError ? err.message : '올리지 못했습니다');
      setBusy(false);
    }
  };

  /** 뺀 줄 수 — 종류 이름은 코드 표(TAX_SKIP_REASON), 코드값 = `excluded` 의 키. 0 인 종류는 안 보인다. */
  const excludedOf = (code: string): number => (p ? ((p.excluded as unknown as Record<string, number>)[code] ?? 0) : 0);
  const skipped = p ? p.skipReasons.filter((s) => excludedOf(s.code) > 0) : [];
  const total = p ? p.byMonth.reduce((n, m) => n + m.count, 0) : 0;

  return (
    <div
      className={t.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${t.modal} ${t.modalLg}`} role="dialog" aria-modal="true" aria-label="자료 올리기">
        <div className={t.mH}>
          <div>
            <h3>자료 올리기</h3>
            {k?.description ? <p>{k.description}</p> : null}
          </div>
          <button type="button" className={t.iconBtn} aria-label="닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className={t.mB}>
          <div className={t.grid3}>
            <label className={t.field}>
              <span className={t.lab}>자료 종류</span>
              <select
                className={t.select}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPicked(null);
                  setError(null);
                }}
              >
                {data.cards.map((c) => (
                  <option key={c.kind} value={c.kind} disabled={!c.enabled}>
                    {data.codes.kinds.find((x) => x.code === c.kind)?.name ?? c.kind}
                    {c.enabled ? '' : ' (준비 중)'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className={`${t.drop} ${over ? t.dropOn : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <Icon name="file-text" size={24} style={{ color: 'var(--text-caption)' }} />
            <div style={{ fontSize: 14, color: 'var(--text-heading)', fontWeight: 700 }}>엑셀 파일을 끌어다 놓거나 고르세요</div>
            <div className={t.sm}>.xlsx · .xls · 한 번에 한 파일</div>
            <div className={t.row} style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className={`${t.btn} ${t.btnSm}`}
                disabled={!canUse || busy}
                onClick={() => input.current?.click()}
              >
                파일 고르기
              </button>
              <input
                ref={input}
                type="file"
                accept=".xls,.xlsx"
                hidden
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
            {picked ? <div className={t.sm}>{picked.file.name}</div> : null}
          </div>

          {busy && !p ? <p className={t.help}>파일을 확인하는 중…</p> : null}
          {error ? <TaxFormErrorBanner kind="failed" message={error} /> : null}

          {same ? (
            <div className={`${t.note} ${t.noteDanger}`} role="alert">
              <span>
                <Icon name="circle-alert" size={16} />
              </span>
              <span>
                <b>이미 올린 파일입니다.</b> {same.fileName} — {shortStamp(same.uploadedAt)}에 올렸습니다. 같은 파일은 다시 올릴 수
                없습니다. 고친 파일이면 올린 파일을 먼저 지우세요.
              </span>
            </div>
          ) : null}

          {p && !same ? (
            <>
              <div className={t.between}>
                <div className={t.secT}>표준양식으로 바꾼 결과</div>
                <span className={t.row}>
                  <span className={`${t.badge} ${t.bDone}`}>
                    {data.codes.invDirs.find((d) => d.code === p.direction)?.name ?? p.direction}
                  </span>
                  <span className={`${t.badge} ${t.bTodo}`}>전체 {won(p.totalRows)}줄</span>
                  {p.byMonth.map((m) =>
                    m.month === month ? (
                      <span key={m.month} className={`${t.badge} ${t.bDone}`}>
                        {monthShort(m.month)} {won(m.count)}줄
                      </span>
                    ) : (
                      <span key={m.month} className={`${t.badge} ${t.bTodo}`}>
                        {monthShort(m.month)} {won(m.count)}줄 → {monthShort(m.month)}에 넣음
                      </span>
                    ),
                  )}
                </span>
              </div>

              <div className={t.card}>
                <table className={t.tbl}>
                  <colgroup>
                    <col style={{ width: 90 }} />
                    <col />
                    <col style={{ width: 140 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>내용</th>
                      <th className={t.num}>금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.sample.map((r) => (
                      <tr key={r.approvalNo}>
                        <td className={t.tnum}>{r.writeDate.slice(5).replace('-', '.')}</td>
                        <td>{r.partnerName}</td>
                        <td className={t.num}>{won(r.totalAmount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3} className={t.sm} style={{ textAlign: 'center' }}>
                        … 앞 5줄만 보여 줍니다
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className={t.note}>
                <span>
                  <Icon name="info" size={16} />
                </span>
                <span>
                  넣을 줄 <b>{won(p.toInsert)}</b> · 이미 올린 승인번호라 건너뛸 줄 <b>{won(p.alreadyUploaded)}</b>
                  {skipped.length > 0
                    ? ` · 뺀 줄 ${skipped.map((s) => `${s.name} ${won(excludedOf(s.code))}`).join(' · ')}`
                    : ''}
                </span>
              </div>

              {p.warnings.map((w) => (
                <div key={w.code} className={`${t.note} ${t.noteWarn}`}>
                  <span>
                    <Icon name="triangle-alert" size={16} />
                  </span>
                  <span>{w.message}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>

        <div className={t.mF}>
          {p && !same && p.toInsert === 0 ? <span className={t.sm}>넣을 줄이 없습니다</span> : null}
          <span className={t.sp} />
          <button type="button" className={t.btn} onClick={onClose}>
            취소
          </button>
          <button type="button" className={`${t.btn} ${t.btnPrimary}`} disabled={!ready} onClick={doUpload}>
            {ready ? `${won(total)}줄 올리기` : '올리기'}
          </button>
        </div>
      </div>
    </div>
  );
}
