'use client';

/**
 * 거래처(s050100020) 본문 — 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-06 ·
 * 결과서 `08-screen-report.md` S05-06 그대로(결정 2026-10-26 「가」).
 *
 *   안내 줄(달 선택 없음) · 제목 · (같은 사업자번호가 있으면) 주황 띠 + [둘 다 고르기] ·
 *   표 카드 — 검색칸 + 칩 「전체 · 주거래처 · 일반」(처음은 전체) → 목록 위 버튼 줄 → 표
 *   팝업: 거래처 고치기(480) · 거래처 N곳 합치기(480) · 지우기 확인
 *
 * ★ [삭제] 는 시안에 없던 것(대표 결정 2026-10-27) — 고른 곳이 모두 거래 0건(**전체 기간**, totalCount)일 때만 눌린다.
 *   거래가 있으면 흐리게 + 「합치기를 쓰세요」 안내. 서버도 같은 조건으로 409 를 낸다.
 *
 * ★★ 구분 이름(주거래처 · 일반) · 자료 종류 · 계산서 구분은 **API 가 준 코드 값으로만** 그린다.
 * ★ 「처음 생긴 자료」는 계산서면 「{구분 이름} 계산서」(매출 계산서), 그 밖은 자료 종류 이름(결정 2026-10-26).
 * ★ 사업자번호 끝자리가 틀리면 **주황 경고만** — 저장은 된다(결정 3, 결과서의 빨간 막음과 다르다).
 * ★ 아이콘 집합(ERP 공용)에 시안의 star · merge 가 없어 sparkles · copy-plus 로 대신했다.
 */
import { useCallback, useEffect, useState } from 'react';
import { digitsOnly, formatBizNumber, isBizNumberChecksumOk, isBizNumberLength } from '@swonbiz/shared/domain/tax-number';
import { TAX_KIND_INVOICE, TAX_VENDOR_GENERAL, TAX_VENDOR_MAIN, withRo } from '@swonbiz/shared/domain/tax-uploads';
import { Icon } from '@/components/ds';
import t from '../common/tax.module.css';
import { TaxConfirmDialog } from '../common/TaxConfirmDialog';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { monthShort } from '../common/TaxMonthBar';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import {
  TaxVendorError,
  deleteVendors,
  editVendor,
  loadVendors,
  mergeVendors,
  setVendorType,
  type TaxVendorView,
  type TaxVendorsResponse,
} from './tax-vendors-model';

type Filter = 'all' | typeof TAX_VENDOR_MAIN | typeof TAX_VENDOR_GENERAL;
type Modal =
  | { kind: 'edit'; vendor: TaxVendorView }
  | { kind: 'merge'; ids: string[] }
  | { kind: 'delete'; ids: string[] }
  | null;

const bizView = (biz: string | null) => (biz ? formatBizNumber(biz) : null);

export function TaxVendorsView({ month }: { month: string }) {
  const [data, setData] = useState<TaxVendorsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  /** 고른 순서 그대로 — 합치기 창은 먼저 고른 곳을 처음 골라 둔다. */
  const [sel, setSel] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { message: toast, notify } = useTaxToast();

  const reload = useCallback(
    () =>
      loadVendors(month)
        .then(setData)
        .catch((err: unknown) => setLoadError(err instanceof TaxVendorError ? err.message : '거래처를 불러오지 못했습니다')),
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

  const tpName = (code: string) => data.codes.vendorTps.find((c) => c.code === code)?.name ?? code;
  const firstOf = (v: TaxVendorView) => {
    if (v.firstKind === TAX_KIND_INVOICE && v.firstDirection) {
      return `${data.codes.invDirs.find((d) => d.code === v.firstDirection)?.name ?? v.firstDirection} 계산서`;
    }
    return data.codes.kinds.find((k) => k.code === v.firstKind)?.name ?? v.firstKind;
  };
  const byId = (id: string) => data.vendors.find((v) => v.id === id);

  const qq = q.trim();
  const qDigits = digitsOnly(qq);
  const list = data.vendors.filter(
    (v) =>
      (filter === 'all' || v.vendorTp === filter) &&
      (!qq || v.name.includes(qq) || (qDigits !== '' && (v.bizNo ?? '').includes(qDigits))),
  );
  const nMain = data.vendors.filter((v) => v.vendorTp === TAX_VENDOR_MAIN).length;
  const dup = data.sameBizNoGroups[0] ?? null;

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  /** 고른 곳 중 거래가 있는 곳 — 전체 기간 기준. */
  const selHasDeals = sel.some((id) => (byId(id)?.totalCount ?? 0) > 0);
  const DELETE_BLOCKED = '거래가 있는 거래처는 지울 수 없습니다 — 합치기를 쓰세요';

  const runDelete = async (ids: string[]) => {
    setModal(null);
    setFailed(null);
    try {
      const r = await deleteVendors(ids);
      setSel([]);
      notify(`${r.deleted}곳을 지웠습니다`);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxVendorError ? err.message : '지우지 못했습니다');
    }
  };

  const changeType = async (tp: string) => {
    setFailed(null);
    try {
      await setVendorType(sel, tp);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxVendorError ? err.message : '바꾸지 못했습니다');
    }
  };

  const afterModal = async (msg: string) => {
    setModal(null);
    setSel([]);
    notify(msg);
    await reload();
  };

  return (
    <div className={t.page}>
      <div className={t.ctx}>
        <span className={t.ctxNote}>
          거래처는 달과 상관없이 하나의 목록입니다 · 「{monthShort(month)} 거래」는 작업할 달 기준
        </span>
      </div>
      <div className={t.pageH}>
        <div>
          <h1>거래처</h1>
          <p>
            자료를 올리면 거래처가 자동으로 생깁니다. 이름·사업자번호를 고치고, 같은 곳을 하나로 합치고, 자주 거래하는 곳을
            주거래처로 표시합니다.
          </p>
        </div>
      </div>

      {dup ? (
        <div className={`${t.note} ${t.noteWarn}`}>
          <span>
            <Icon name="copy" size={16} />
          </span>
          <span style={{ flex: 1 }}>
            <b>사업자번호가 같은 거래처가 있습니다.</b> {dup.map((id) => `「${byId(id)?.name ?? ''}」`).join(' · ')} — 같은 곳이면
            하나로 합치세요.
          </span>
          <button type="button" className={`${t.btn} ${t.btnSm}`} onClick={() => setSel(dup)}>
            둘 다 고르기
          </button>
        </div>
      ) : null}

      <div className={t.card}>
        <div className={`${t.cardPad} ${t.row}`} style={{ paddingBottom: 12, gap: 12 }}>
          <input
            className={t.input}
            style={{ width: 240 }}
            placeholder="거래처명 · 사업자번호"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className={t.chips}>
            <button type="button" className={`${t.chip} ${filter === 'all' ? t.chipOn : ''}`} onClick={() => setFilter('all')}>
              전체 <b>{data.vendors.length}</b>
            </button>
            <button
              type="button"
              className={`${t.chip} ${filter === TAX_VENDOR_MAIN ? t.chipOn : ''}`}
              onClick={() => setFilter(TAX_VENDOR_MAIN)}
            >
              {tpName(TAX_VENDOR_MAIN)} <b>{nMain}</b>
            </button>
            <button
              type="button"
              className={`${t.chip} ${filter === TAX_VENDOR_GENERAL ? t.chipOn : ''}`}
              onClick={() => setFilter(TAX_VENDOR_GENERAL)}
            >
              {tpName(TAX_VENDOR_GENERAL)} <b>{data.vendors.length - nMain}</b>
            </button>
          </span>
        </div>
        <div className={t.tbar}>
          <button
            type="button"
            className={`${t.btn} ${t.btnSm} ${t.btnDanger}`}
            disabled={!sel.length || selHasDeals}
            title={selHasDeals ? DELETE_BLOCKED : undefined}
            onClick={() => setModal({ kind: 'delete', ids: sel })}
          >
            <Icon name="trash-2" size={16} />
            삭제
          </button>
          <button
            type="button"
            className={`${t.btn} ${t.btnSm}`}
            disabled={sel.length !== 1}
            onClick={() => {
              const v = byId(sel[0] ?? '');
              if (v) setModal({ kind: 'edit', vendor: v });
            }}
          >
            <Icon name="pencil-line" size={16} />
            고치기
          </button>
          <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!sel.length} onClick={() => changeType(TAX_VENDOR_MAIN)}>
            <Icon name="sparkles" size={16} />
            {withRo(tpName(TAX_VENDOR_MAIN))}
          </button>
          <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!sel.length} onClick={() => changeType(TAX_VENDOR_GENERAL)}>
            {withRo(tpName(TAX_VENDOR_GENERAL))}
          </button>
          <button
            type="button"
            className={`${t.btn} ${t.btnSm}`}
            disabled={sel.length < 2}
            onClick={() => setModal({ kind: 'merge', ids: sel })}
          >
            <Icon name="copy-plus" size={16} />
            합치기{sel.length >= 2 ? ` (${sel.length})` : ''}
          </button>
          <span className={t.sm}>
            {sel.length ? `${sel.length}곳 선택` : '줄을 고르세요 · 고치기는 한 곳, 합치기는 두 곳 이상'}
            {selHasDeals ? ` · ${DELETE_BLOCKED}` : ''}
          </span>
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
              <col />
              <col style={{ width: 140 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 160 }} />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="선택" />
                <th>거래처명</th>
                <th>사업자번호</th>
                <th>구분</th>
                <th className={t.num}>{monthShort(month)} 거래</th>
                <th>처음 생긴 자료</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} className={t.empty}>
                    찾는 거래처가 없습니다
                  </td>
                </tr>
              ) : (
                list.map((v) => {
                  const on = sel.includes(v.id);
                  return (
                    <tr key={v.id} className={`${t.clickable} ${on ? t.pick : ''}`} onClick={() => toggle(v.id)}>
                      <td>
                        <input
                          type="checkbox"
                          className={t.rowchk}
                          checked={on}
                          aria-label="선택"
                          onChange={() => toggle(v.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className={t.ell} style={{ fontWeight: 700 }} title={v.name}>
                        {v.name}
                      </td>
                      <td className={t.tnum}>{bizView(v.bizNo) ?? <span style={{ color: 'var(--text-caption)' }}>없음</span>}</td>
                      <td>
                        {v.vendorTp === TAX_VENDOR_MAIN ? (
                          <span className={`${t.badge} ${t.bDone}`}>
                            <Icon name="sparkles" size={16} />
                            {tpName(v.vendorTp)}
                          </span>
                        ) : (
                          <span className={`${t.badge} ${t.bGray}`}>{tpName(v.vendorTp)}</span>
                        )}
                      </td>
                      <td className={t.num}>{v.monthCount}건</td>
                      <td className={t.mut}>{firstOf(v)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.kind === 'edit' ? (
        <EditModal vendor={modal.vendor} onClose={() => setModal(null)} onDone={() => afterModal('거래처를 고쳤습니다')} />
      ) : null}
      {modal?.kind === 'merge' ? (
        <MergeModal
          vendors={modal.ids.map((id) => byId(id)).filter((v): v is TaxVendorView => !!v)}
          firstOf={firstOf}
          onClose={() => setModal(null)}
          onDone={(name) => afterModal(`「${name}」${withRo(name).slice(name.length)} 합쳤습니다`)}
        />
      ) : null}
      {modal?.kind === 'delete' ? (
        <TaxConfirmDialog
          icon="trash-2"
          danger
          title={`${modal.ids.length}곳을 지웁니다`}
          okLabel="삭제"
          onCancel={() => setModal(null)}
          onOk={() => runDelete(modal.ids)}
          body={modal.ids.map((id) => byId(id)?.name ?? '').join(' · ')}
        />
      ) : null}
      <TaxToast message={toast} />
    </div>
  );
}

/* ── 팝업 공통 틀(480px) ──────────────────────────────────────────────────── */

function Frame({ title, sub, onClose, children, footer }: {
  title: string;
  sub: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className={t.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${t.modal} ${t.modalSmW}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className={t.mH}>
          <div>
            <h3>{title}</h3>
            <p>{sub}</p>
          </div>
          <button type="button" className={t.iconBtn} aria-label="닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className={t.mB}>{children}</div>
        <div className={t.mF}>
          <span className={t.sp} />
          {footer}
        </div>
      </div>
    </div>
  );
}

/* ── 9-1 거래처 고치기 ───────────────────────────────────────────────────── */

function EditModal({ vendor, onClose, onDone }: { vendor: TaxVendorView; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(vendor.name);
  const [biz, setBiz] = useState(bizView(vendor.bizNo) ?? '');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = digitsOnly(biz);
  // ★ 끝자리 경고 — 10자리일 때만, 저장은 막지 않는다(결정 3)
  const checksumWarn = isBizNumberLength(d) && !isBizNumberChecksumOk(d);

  const save = async () => {
    setBusy(true);
    setFailed(null);
    try {
      await editVendor(vendor.id, name, biz);
      onDone();
    } catch (err) {
      if (err instanceof TaxVendorError && err.errors.length) {
        setErrs(Object.fromEntries(err.errors.map((e) => [e.field, e.message])));
      } else setFailed(err instanceof TaxVendorError ? err.message : '저장하지 못했습니다');
      setBusy(false);
    }
  };

  return (
    <Frame
      title="거래처 고치기"
      sub="고친 이름은 모든 달의 자료에 함께 바뀝니다"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={t.btn} onClick={onClose}>
            취소
          </button>
          <button type="button" className={`${t.btn} ${t.btnPrimary}`} disabled={busy} onClick={save}>
            저장
          </button>
        </>
      }
    >
      <label className={t.field}>
        <span className={t.lab}>거래처명</span>
        <input
          className={`${t.input} ${errs.name ? t.isErr : ''}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrs((m) => ({ ...m, name: '' }));
          }}
        />
        {errs.name ? <span className={t.errT}>{errs.name}</span> : null}
      </label>
      <label className={t.field}>
        <span className={t.lab}>사업자번호</span>
        <input
          className={`${t.input} ${t.tnum} ${errs.bizNo ? t.isErr : ''}`}
          placeholder="000-00-00000"
          value={biz}
          onChange={(e) => {
            setBiz(e.target.value);
            setErrs((m) => ({ ...m, bizNo: '' }));
          }}
        />
        {errs.bizNo ? (
          <span className={t.errT}>{errs.bizNo}</span>
        ) : checksumWarn ? (
          <span className={t.warnT}>사업자번호 끝자리 검증 번호가 맞지 않습니다 — 그대로 저장할 수 있습니다</span>
        ) : null}
      </label>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}
    </Frame>
  );
}

/* ── 9-2 거래처 N곳 합치기 ───────────────────────────────────────────────── */

function MergeModal({ vendors, firstOf, onClose, onDone }: {
  vendors: TaxVendorView[];
  firstOf: (v: TaxVendorView) => string;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [keep, setKeep] = useState(vendors[0]?.id ?? '');
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const kept = vendors.find((v) => v.id === keep);
    if (!kept) return;
    setBusy(true);
    setFailed(null);
    try {
      await mergeVendors(keep, vendors.filter((v) => v.id !== keep).map((v) => v.id));
      onDone(kept.name);
    } catch (err) {
      setFailed(err instanceof TaxVendorError ? err.message : '합치지 못했습니다');
      setBusy(false);
    }
  };

  return (
    <Frame
      title={`거래처 ${vendors.length}곳 합치기`}
      sub="남길 이름을 고르세요. 나머지 거래처의 자료는 모두 이 이름으로 옮겨집니다"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={t.btn} onClick={onClose}>
            취소
          </button>
          <button type="button" className={`${t.btn} ${t.btnPrimary}`} disabled={busy} onClick={run}>
            합치기
          </button>
        </>
      }
    >
      <div className={`${t.note} ${t.noteDanger}`}>
        <span>
          <Icon name="circle-alert" size={16} />
        </span>
        <span>
          <b>되돌릴 수 없습니다.</b> 합친 뒤에는 다시 나눌 수 없습니다. {vendors.map((v) => `${v.name} ${v.totalCount}건`).join(' · ')}
        </span>
      </div>
      <div className={t.cands}>
        {vendors.map((v) => (
          <label key={v.id} className={`${t.cand} ${keep === v.id ? t.candOn : ''}`}>
            <input type="radio" name="keep" checked={keep === v.id} onChange={() => setKeep(v.id)} />
            <span>
              <span className={t.candT}>{v.name}</span>
              <span className={t.sm} style={{ display: 'block' }}>
                {[bizView(v.bizNo), firstOf(v)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className={t.tnum}>{v.totalCount}건</span>
          </label>
        ))}
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}
    </Frame>
  );
}
