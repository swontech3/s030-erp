'use client';

/**
 * 거래처(s050100020) 본문 — 시안 S05-06 을 2026-11-07 대표 수정 ③ 으로 바꾼 것.
 *
 *   검색 조건 카드(검색어 · 구분 · 종료여부 — 바꾸면 바로 걸러짐. 2026-11-08 라벨을 지우고 검색칸은 안쪽 안내 글,
 *   선택 상자는 첫 줄 「구분 전체」 · 「종료여부 전체」로 뜻을 보인다) ·
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
 * ★ 2026-11-26 세무 일관성(삐용 기준) — 표 = 공통 Table(머리글 아쿠아) · 버튼 줄 단추 = 공통 Button 보통(40px) · 엑셀 = 같은 꼴(.btn) ·
 *   검색 조건은 바꾸면 바로 걸러짐 그대로, 오른쪽 끝에 「n건」 · 거래처 수정 팝업 = 공통 Dialog([저장] 주 · [취소] 보통) ·
 *   거래종료 확인 = TaxConfirmDialog(공통 Dialog)
 */

/** 표 칸 폭 — 선택 · 거래처명 · 사업자번호 · 구분 · 종료여부 · 첫 거래월(종전 colgroup 값 그대로 · 선택 칸은 Table 칸 사이 12px 를 뺀 값) */
const VENDOR_COLS = '20px minmax(0,1fr) 140px 120px 100px 110px';
import { useCallback, useEffect, useState } from 'react';
import { digitsOnly, formatBizNumber, isBizNumberChecksumOk, isBizNumberLength } from '@swonbiz/shared/domain/tax-number';
import { TAX_VENDOR_GENERAL, TAX_VENDOR_MAIN, filterVendors, withRo, type VendorClosedFilter } from '@swonbiz/shared/domain/tax-uploads';
import { Button, Dialog, Icon, Table, TableEmpty, TableHead, TableRow, tableCell } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import { ListNote, ListSpacer } from '@/components/patterns/ListFrame';
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
  ['all', '종료여부 전체'],
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
        <div className={t.row} style={{ gap: 12, alignItems: 'center' }}>
          <input
            className={t.input}
            style={{ width: 240 }}
            placeholder="거래처명 · 사업자번호"
            aria-label="검색어"
            value={query.q}
            onChange={(e) => patchQuery({ q: e.target.value })}
          />
          <select
            className={t.select}
            style={{ width: 150 }}
            aria-label="구분"
            value={query.tp ?? ''}
            onChange={(e) => patchQuery({ tp: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">구분 전체</option>
            {[TAX_VENDOR_MAIN, TAX_VENDOR_GENERAL].map((code) => (
              <option key={code} value={code}>
                {tpName(code)}
              </option>
            ))}
          </select>
          <select
            className={t.select}
            style={{ width: 150 }}
            aria-label="종료여부"
            value={query.closed}
            onChange={(e) => patchQuery({ closed: e.target.value as VendorClosedFilter })}
          >
            {CLOSED_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          {/* ★ 2026-11-26 세무 일관성 ④ — 바꾸면 바로 걸러짐(그대로) · 오른쪽 끝 「n건」 */}
          <ListSpacer />
          <ListNote>{list.length}건</ListNote>
        </div>
      </div>

      <div className={`${t.tbar} ${t.tbarOut}`}>
        {/* ★ 2026-11-26 세무 일관성 ③ — 버튼 줄 단추 = 공통 Button 보통(sm 40px) · 자리는 그대로 */}
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon name="pencil-line" size={16} />}
          disabled={sel.length !== 1}
          onClick={() => {
            const v = byId(sel[0] ?? '');
            if (v) setModal({ kind: 'edit', vendor: v });
          }}
        >
          수정
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon name="circle-x" size={16} />}
          disabled={openSel.length === 0}
          onClick={() => setModal({ kind: 'close', ids: openSel })}
        >
          거래종료
        </Button>
        <span className={t.sp} />
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Icon name="sparkles" size={16} />}
          disabled={!sel.length}
          onClick={() => changeType(TAX_VENDOR_MAIN)}
        >
          {withRo(tpName(TAX_VENDOR_MAIN))}
        </Button>
        <Button variant="ghost" size="sm" disabled={!sel.length} onClick={() => changeType(TAX_VENDOR_GENERAL)}>
          {withRo(tpName(TAX_VENDOR_GENERAL))}
        </Button>
        <ExcelDownloadButton href={exportHref(query)} className={t.btn} onError={setFailed} />
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          {/* ★ 2026-11-26 세무 일관성 ① — 표 = 공통 Table(머리글 아쿠아 · 머리 고정). 줄을 누르면 고름(그대로) */}
          <Table cols={VENDOR_COLS}>
            <TableHead sticky>
              <span aria-label="선택" />
              <span>거래처명</span>
              <span>사업자번호</span>
              <span>구분</span>
              <span>종료여부</span>
              <span>첫 거래월</span>
            </TableHead>
            {list.length === 0 ? (
              <TableEmpty>
                <TaxEmpty icon="building-2" lead="찾는 거래처가 없습니다" />
              </TableEmpty>
            ) : (
              list.map((v) => {
                const on = sel.includes(v.id);
                return (
                  <TableRow key={v.id} selected={on} onClick={() => toggle(v.id)}>
                    <span className={t.cellChk}>
                      <input
                        type="checkbox"
                        className={t.rowchk}
                        checked={on}
                        aria-label="선택"
                        onChange={() => toggle(v.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </span>
                    <span className={tableCell.ellipsis} style={{ fontWeight: 700 }} title={v.name}>
                      {v.name}
                    </span>
                    <span className={t.tnum}>{bizView(v.bizNo) ?? <span style={{ color: 'var(--text-caption)' }}>없음</span>}</span>
                    <span>
                      {v.vendorTp === TAX_VENDOR_MAIN ? (
                        <span className={`${t.badge} ${t.bDone}`}>
                          <Icon name="sparkles" size={16} />
                          {tpName(v.vendorTp)}
                        </span>
                      ) : (
                        <span className={`${t.badge} ${t.bGray}`}>{tpName(v.vendorTp)}</span>
                      )}
                    </span>
                    <span>{v.closed ? <span className={`${t.badge} ${t.bGray}`}>종료</span> : '거래 중'}</span>
                    <span className={`${t.mutT} ${t.tnum}`}>{v.firstMonth ?? '—'}</span>
                  </TableRow>
                );
              })
            )}
          </Table>
        </div>
      </div>

      {modal?.kind === 'edit' ? (
        <EditModal vendor={modal.vendor} onClose={() => setModal(null)} onDone={() => afterModal('거래처를 수정했습니다')} />
      ) : null}
      {modal?.kind === 'close' ? (
        <TaxConfirmDialog
          question={`${modal.ids.length}곳의 거래를 종료하시겠습니까?`}
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
    /* ★ 2026-11-26 세무 일관성 ⑤ — 공통 Dialog(아쿠아 제목줄 · 아래 가운데 [저장](주) [취소](보통)) · 종전 부제목 한 줄은 본문 첫 줄 */
    <Dialog
      open
      title="거래처 수정"
      description="고친 이름은 모든 달의 자료에 함께 바뀝니다"
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            저장
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            취소
          </Button>
        </>
      }
    >
      <div className={t.dlgBody}>
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
      </div>
    </Dialog>
  );
}
