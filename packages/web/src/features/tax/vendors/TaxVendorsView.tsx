'use client';

/**
 * 거래처(s050100020) 본문 — 시안 S05-06 을 2026-11-07 대표 수정 ③ 으로 바꾼 것.
 *
 *   검색 조건 카드(검색어 · 구분 · 종료여부 — ERP 목록 화면처럼 라벨 + 칸, 바꾸면 바로 걸러짐) ·
 *   버튼 줄(카드 밖 — 왼쪽 [수정] [거래종료] · 오른쪽 끝 [주거래처로] [일반으로] [엑셀 내려받기]) · 목록 카드(표만)
 * ★ 2026-11-07 — 목록만 스크롤 · 머리 줄 고정(세무 목록 화면의 기준). ERP 센터 관리(s030100010)와 같은 꼴:
 *   화면이 셸 높이를 채우고(`pageFill`) 목록 카드만 남는 높이를 받아 안에서 스크롤한다(`listCard` · `listScroll` · `tblSticky`).
 *   팝업: 거래처 수정(480, 거래 중 / 거래 종료) · 거래종료 확인
 *
 * ★ 2026-11-07: 맨 위 안내 · 설명 · 같은 사업자번호 띠를 지웠고, 합치기 · 삭제를 없앴다(화면 · 팝업 · API).
 *   목록 칸은 거래처명 · 사업자번호 · 구분 · 종료여부 · 첫 거래월 — 「N월 거래」 · 「처음 생긴 자료」를 뺐다.
 * ★ 거르기는 엑셀과 같은 shared `filterVendors`. 종료여부 처음 값은 「거래 중」.
 * ★★ 구분 이름(주거래처 · 일반)은 **API 가 준 코드 값으로만** 그린다.
 * ★ 사업자번호 끝자리가 틀리면 **주황 경고만** — 저장은 된다(결정 3).
 * ★ 아이콘 집합(ERP 공용)에 시안의 star 가 없어 sparkles 로 대신했다.
 */
import { useCallback, useEffect, useState } from 'react';
import { digitsOnly, formatBizNumber, isBizNumberChecksumOk, isBizNumberLength } from '@swonbiz/shared/domain/tax-number';
import { TAX_VENDOR_GENERAL, TAX_VENDOR_MAIN, filterVendors, withRo, type VendorClosedFilter } from '@swonbiz/shared/domain/tax-uploads';
import { Button, Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxEmpty } from '../common/TaxEmpty';
import { TaxConfirmDialog } from '../common/TaxConfirmDialog';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import {
  TaxVendorError,
  closeVendors,
  editVendor,
  exportHref,
  loadVendors,
  setVendorType,
  type TaxVendorView,
  type TaxVendorsResponse,
  type VendorQuery,
} from './tax-vendors-model';

type Modal = { kind: 'edit'; vendor: TaxVendorView } | { kind: 'close'; ids: string[] } | null;

const bizView = (biz: string | null) => (biz ? formatBizNumber(biz) : null);
const CLOSED_OPTIONS: [VendorClosedFilter, string][] = [
  ['all', '전체'],
  ['open', '거래 중'],
  ['closed', '종료'],
];

export function TaxVendorsView() {
  const [data, setData] = useState<TaxVendorsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState<VendorQuery>({ q: '', tp: null, closed: 'open' });
  const [sel, setSel] = useState<string[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { message: toast, notify } = useTaxToast();

  const reload = useCallback(
    () =>
      loadVendors()
        .then(setData)
        .catch((err: unknown) => setLoadError(err instanceof TaxVendorError ? err.message : '거래처를 불러오지 못했습니다')),
    [],
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
  const byId = (id: string) => data.vendors.find((v) => v.id === id);
  const list = filterVendors(data.vendors, query);
  const openSel = sel.filter((id) => byId(id)?.closed === false);

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const patchQuery = (p: Partial<VendorQuery>) => setQuery((q) => ({ ...q, ...p }));

  const changeType = async (tp: string) => {
    setFailed(null);
    try {
      await setVendorType(sel, tp);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxVendorError ? err.message : '바꾸지 못했습니다');
    }
  };

  const runClose = async (ids: string[]) => {
    setModal(null);
    setFailed(null);
    try {
      const r = await closeVendors(ids);
      setSel([]);
      notify(`${r.closed}곳의 거래를 종료했습니다`);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxVendorError ? err.message : '거래를 종료하지 못했습니다');
    }
  };

  const afterModal = async (msg: string) => {
    setModal(null);
    setSel([]);
    notify(msg);
    await reload();
  };

  return (
    <div className={`${t.page} ${t.pageFill}`}>
      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.row} style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className={t.field}>
            <span className={t.lab}>검색어</span>
            <input
              className={t.input}
              style={{ width: 240 }}
              placeholder="거래처명 · 사업자번호"
              value={query.q}
              onChange={(e) => patchQuery({ q: e.target.value })}
            />
          </label>
          <label className={t.field}>
            <span className={t.lab}>구분</span>
            <select
              className={t.select}
              style={{ width: 150 }}
              value={query.tp ?? ''}
              onChange={(e) => patchQuery({ tp: e.target.value === '' ? null : e.target.value })}
            >
              <option value="">전체</option>
              {[TAX_VENDOR_MAIN, TAX_VENDOR_GENERAL].map((code) => (
                <option key={code} value={code}>
                  {tpName(code)}
                </option>
              ))}
            </select>
          </label>
          <label className={t.field}>
            <span className={t.lab}>종료여부</span>
            <select
              className={t.select}
              style={{ width: 150 }}
              value={query.closed}
              onChange={(e) => patchQuery({ closed: e.target.value as VendorClosedFilter })}
            >
              {CLOSED_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={`${t.tbar} ${t.tbarOut}`}>
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
          수정
        </button>
        <button
          type="button"
          className={`${t.btn} ${t.btnSm}`}
          disabled={openSel.length === 0}
          onClick={() => setModal({ kind: 'close', ids: openSel })}
        >
          <Icon name="circle-x" size={16} />
          거래종료
        </button>
        <span className={t.sp} />
        <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!sel.length} onClick={() => changeType(TAX_VENDOR_MAIN)}>
          <Icon name="sparkles" size={16} />
          {withRo(tpName(TAX_VENDOR_MAIN))}
        </button>
        <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!sel.length} onClick={() => changeType(TAX_VENDOR_GENERAL)}>
          {withRo(tpName(TAX_VENDOR_GENERAL))}
        </button>
        <ExcelDownloadButton href={exportHref(query)} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          <table className={`${t.tbl} ${t.tblSticky}`}>
            <colgroup>
              <col className={t.wChk} />
              <col />
              <col style={{ width: 140 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="선택" />
                <th>거래처명</th>
                <th>사업자번호</th>
                <th>구분</th>
                <th>종료여부</th>
                <th>첫 거래월</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} className={t.empty}>
                    <TaxEmpty icon="building-2" lead="찾는 거래처가 없습니다" />
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
                      <td>{v.closed ? <span className={`${t.badge} ${t.bGray}`}>종료</span> : '거래 중'}</td>
                      <td className={`${t.mut} ${t.tnum}`}>{v.firstMonth ?? '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.kind === 'edit' ? (
        <EditModal vendor={modal.vendor} onClose={() => setModal(null)} onDone={() => afterModal('거래처를 수정했습니다')} />
      ) : null}
      {modal?.kind === 'close' ? (
        <TaxConfirmDialog
          icon="circle-x"
          title={`${modal.ids.length}곳의 거래를 종료하시겠습니까?`}
          okLabel="거래종료"
          onCancel={() => setModal(null)}
          onOk={() => runClose(modal.ids)}
          body={
            <>
              {modal.ids.map((id) => byId(id)?.name ?? '').join(' · ')}
              <br />
              지우지 않고 「종료」로 표시합니다. [수정]에서 「거래 중」으로 되돌릴 수 있습니다.
            </>
          }
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

/* ── 9-1 거래처 수정 ─────────────────────────────────────────────────────── */

function EditModal({ vendor, onClose, onDone }: { vendor: TaxVendorView; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(vendor.name);
  const [biz, setBiz] = useState(bizView(vendor.bizNo) ?? '');
  const [closed, setClosed] = useState(vendor.closed);
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
      await editVendor(vendor.id, name, biz, closed);
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
      title="거래처 수정"
      sub="고친 이름은 모든 달의 자료에 함께 바뀝니다"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            저장
          </Button>
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
      <div className={t.field}>
        <span className={t.lab}>거래 상태</span>
        <span className={t.row} style={{ gap: 24 }}>
          <label className={t.chk}>
            <input type="radio" name="vendor-closed" checked={!closed} onChange={() => setClosed(false)} />
            거래 중
          </label>
          <label className={t.chk}>
            <input type="radio" name="vendor-closed" checked={closed} onChange={() => setClosed(true)} />
            거래 종료
          </label>
        </span>
        {errs.closed ? <span className={t.errT}>{errs.closed}</span> : null}
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}
    </Frame>
  );
}
