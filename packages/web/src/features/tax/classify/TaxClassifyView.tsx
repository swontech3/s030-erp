'use client';

/**
 * 거래 분류(s050300010) 본문 — 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-05 ·
 * `tax-screens-d.js` 의 「전체」 보기 · 결과서 `08-screen-report.md` S05-05 그대로. 1-3 범위(결정 2026-10-27):
 *
 *   작업할 달 줄 · 제목 + 배지 「N줄 남음 / N줄」 · 회색 안내 띠 · 표 카드(보기 칩 → 칩 → 목록 위 버튼 줄 → 표)
 *   「확인할 줄만」: 항목이 빈 매입 계산서에 항목 붙이기 — [확정 (N)] · [고치기 (N)] · 항목 선택 + [선택한 줄에 붙이기]
 *   「전체」: 거른 매입 · 매출 읽기만 — 자료 종류 칩 · [엑셀 내려받기] + 기간 · 파일 띠 [모두 보기]
 *
 * ★ 뒤 단계(그리지 않음): 은행 · 현금 · 짝 남은 금액 줄, 입금 항목, 「입금·출금 섞임」 막기, 은행 줄 안내 문구, 다음 단계 줄.
 * ★★ 항목 이름 · 풀이 · 계산서 구분 · 사업자 유형 이름은 **API 가 준 코드 값으로만** 그린다. 예외는 아직 자료가 없는
 *    자료 종류 칩 「카드 · 현금 · 삐용 경비 · 은행(짝 없는 줄)」 — 시안 글자 그대로(결정 2026-10-27, 그 자료 단계에서 코드 표로).
 * ★ 사업자 유형이 없으면(세무 설정 전) 항목 선택 · 확정 · 붙이기를 막고 안내한다(결정 2026-10-27). 「전체」 보기 · 엑셀은 된다.
 * ★ 거래처 기억 — 서버가 준 「골라 둔 항목」을 선택 칸에 미리 넣기만. 확정은 사업주가 [확정]으로.
 * ★ [고치기]는 화면 안에서만 — 다시 [확정]하면 덮는다(결정). 고른 값 · 고치기 중 표시는 다시 불러오면 지운다.
 * ★ 파일로 들어오면 기간 거르기를 걸지 않는다(결정) — 그동안 기간 칸은 숨긴다.
 * ★ 아이콘 집합(ERP 공용)에 시안의 filter 가 없어 file-text 로 대신했다.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CLASSIFY_KINDS,
  classifyPlan,
  withEulReul,
  type ClassifyKind,
  type ClassifyView,
} from '@swonbiz/shared/domain/tax-classify';
import { TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES } from '@swonbiz/shared/domain/tax-uploads';
import { Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar, monthLabel, todayNote } from '../common/TaxMonthBar';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import { won } from '../uploads/tax-uploads-model';
import {
  TaxClassifyError,
  confirmRows,
  exportHref,
  loadClassify,
  shortDate,
  type ClassifyQuery,
  type TaxClassifyResponse,
} from './tax-classify-model';

/** 아직 자료가 없는 자료 종류 칩 — 시안 글자(결정 2026-10-27). 매입 · 매출은 코드 이름. */
const LATER_KIND_LABEL: Partial<Record<ClassifyKind, string>> = {
  CARD: '카드',
  CASH: '현금',
  PPIYONG: '삐용 경비',
  BANK: '은행(짝 없는 줄)',
};

const LEFT_DESC =
  '항목이 빈 매입 계산서, 짝 맞추기에서 짝이 없던 은행 줄, 은행 줄에 남은 금액(짝 남은 금액), 항목 칸이 빈 현금 경비에 항목을 붙입니다. 모르면 「잘 모름 — 세무사에게 묻기」를 고르세요.';
const ALL_DESC =
  '전체 보기 — 그 달 매입 · 매출 · 카드 · 현금 · 삐용 경비 · 은행(짝 없는 줄)을 모두 봅니다. 항목은 「확인할 줄만」 보기에서 붙입니다.';

interface Props {
  month: string;
  initialView: ClassifyView;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
}

export function TaxClassifyView({ month, initialView, fileId: initialFile }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<ClassifyView>(initialView);
  const [kind, setKind] = useState<ClassifyKind>('all');
  const [fileId, setFileId] = useState<string | null>(initialFile);
  /** 기간 직접 지정 — null 이면 작업할 달. */
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<TaxClassifyResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 「확인할 줄만」의 칩 — 남은 줄(처음) / 모두. */
  const [onlyLeft, setOnlyLeft] = useState(true);
  const [sel, setSel] = useState<string[]>([]);
  /** 줄마다 고른 항목(확정 전). */
  const [picks, setPicks] = useState<Record<string, string>>({});
  /** [고치기]로 다시 연 줄 — 화면 안에서만. */
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const { message: toast, notify } = useTaxToast();

  const query: ClassifyQuery = {
    month,
    view,
    kind: view === 'all' ? kind : 'all',
    from: fileId || view === 'left' ? null : (period?.from ?? null),
    to: fileId || view === 'left' ? null : (period?.to ?? null),
    fileId: view === 'all' ? fileId : null,
  };
  const key = JSON.stringify(query);

  const reload = useCallback(
    () =>
      loadClassify(JSON.parse(key) as ClassifyQuery)
        .then((d) => {
          setData(d);
          setLoadError(null);
          setSel([]);
          setPicks({});
          setEditing(new Set());
          setBulk('');
        })
        .catch((err: unknown) => setLoadError(err instanceof TaxClassifyError ? err.message : '거래 분류를 불러오지 못했습니다')),
    [key],
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

  const dirName = (code: string) => data.codes.invDirs.find((d) => d.code === code)?.name ?? code;
  const itemName = (code: string) => data.codes.itemNames.find((i) => i.code === code)?.name ?? code;
  const canClassify = data.bizType !== null && data.codes.items.length > 0;
  const isLeft = view === 'left';

  /** 보기 바꾸기 — 「확인할 줄만」으로 가면 파일 거르기를 푼다(시안 `c-view`). */
  const changeView = (v: ClassifyView) => {
    setView(v);
    if (v === 'left' && fileId) {
      setFileId(null);
      router.replace(`${pathname}?month=${month}`);
    }
  };
  /** [모두 보기] — 파일 띠를 푼다. */
  const clearFile = () => {
    setFileId(null);
    router.replace(`${pathname}?month=${month}&view=all`);
  };

  const itemOptions = (
    <>
      <option value="">출금 항목 고르기</option>
      {data.codes.items.map((i) => (
        <option key={i.code} value={i.code}>
          {i.description ? `${i.name} — ${i.description}` : i.name}
        </option>
      ))}
    </>
  );

  /* ── 「확인할 줄만」 ── */
  const plan = classifyPlan(data.rows, sel, picks, editing);
  const leftRows = data.rows.filter((r) => !onlyLeft || r.itemCode === null || editing.has(r.id));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const runConfirm = async () => {
    setFailed(null);
    try {
      const r = await confirmRows(plan.confirm);
      notify(`${r.confirmed}줄을 확정했습니다${plan.skipped ? ` · ${plan.skipped}줄은 항목이 없어 건너뜀` : ''}`);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxClassifyError ? err.message : '확정하지 못했습니다');
    }
  };
  const reopen = () => setEditing((e) => new Set([...e, ...plan.reopen]));
  const runBulk = async () => {
    setFailed(null);
    try {
      const r = await confirmRows(sel.map((id) => ({ id, itemCode: bulk })));
      const name = itemName(bulk);
      notify(`${r.confirmed}줄에 「${name}」${withEulReul(name).slice(name.length)} 붙였습니다`);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxClassifyError ? err.message : '붙이지 못했습니다');
    }
  };

  const viewChips = (
    <span className={t.chips} style={{ marginRight: 12 }}>
      <button type="button" className={`${t.chip} ${isLeft ? t.chipOn : ''}`} onClick={() => changeView('left')}>
        확인할 줄만
      </button>
      <button type="button" className={`${t.chip} ${!isLeft ? t.chipOn : ''}`} onClick={() => changeView('all')}>
        전체
      </button>
    </span>
  );

  const kindLabel = (k: ClassifyKind) =>
    k === 'all' ? '전체' : k === TAX_INV_DIR_PURCHASE || k === TAX_INV_DIR_SALES ? dirName(k) : (LATER_KIND_LABEL[k] ?? k);

  const errorBanner = failed ? (
    <div style={{ padding: '0 16px 12px' }}>
      <TaxFormErrorBanner kind="failed" message={failed} />
    </div>
  ) : null;

  return (
    <div className={t.page}>
      <TaxMonthBar month={month} note={todayNote(data.bizTypeName)} />
      <div className={t.pageH}>
        <div>
          <h1>거래 분류</h1>
          <p>{isLeft ? LEFT_DESC : ALL_DESC}</p>
        </div>
        {isLeft ? (
          <span className={`${t.badge} ${data.counts.left ? t.bDoing : t.bDone}`}>
            {data.counts.left}줄 남음 / {data.counts.total}줄
          </span>
        ) : null}
      </div>

      {isLeft ? (
        canClassify ? (
          <div className={t.note}>
            <span>
              <Icon name="info" size={16} />
            </span>
            <span>
              항목 목록은 공통 코드 표에서 불러옵니다 — 지금은{' '}
              <b>
                {data.bizTypeName}용 출금 항목 {data.codes.items.length}개
              </b>{' '}
              — {data.bizType === 'I'
                ? '「사업과 무관」은 대표 인출로 처리합니다.'
                : '「사업과 무관」은 세무사가 처리 방법을 정합니다.'}{' '}
              같은 거래처는 지난번 항목을 골라 두지만, 확정은 직접 합니다.
            </span>
          </div>
        ) : (
          <div className={t.note}>
            <span>
              <Icon name="info" size={16} />
            </span>
            <span style={{ flex: 1 }}>세무 설정에서 사업자 유형을 먼저 고르세요 — 사업자 유형에 따라 출금 항목 목록이 다릅니다.</span>
            <Link href="/tax/settings" className={`${t.btn} ${t.btnSm}`}>
              <Icon name="settings" size={16} />
              세무 설정
            </Link>
          </div>
        )
      ) : null}

      {!isLeft && data.file ? (
        <div className={`${t.note} ${t.noteInfo}`} style={{ alignItems: 'center' }}>
          <span>
            <Icon name="file-text" size={16} />
          </span>
          <span style={{ flex: 1 }}>
            <b>
              「{data.file.fileName}」 파일로 들어온 {data.counts.kinds.all}줄만 보는 중
            </b>
          </span>
          <button type="button" className={`${t.btn} ${t.btnSm}`} onClick={clearFile}>
            모두 보기
          </button>
        </div>
      ) : null}

      <div className={t.card}>
        <div className={t.cardPad} style={{ paddingTop: 14, paddingBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {viewChips}
          <span className={t.chips}>
            {isLeft ? (
              <>
                <button type="button" className={`${t.chip} ${onlyLeft ? t.chipOn : ''}`} onClick={() => setOnlyLeft(true)}>
                  남은 줄 <b>{data.counts.left}</b>
                </button>
                <button type="button" className={`${t.chip} ${!onlyLeft ? t.chipOn : ''}`} onClick={() => setOnlyLeft(false)}>
                  모두 <b>{data.counts.total}</b>
                </button>
              </>
            ) : (
              CLASSIFY_KINDS.map((k) => (
                <button key={k} type="button" className={`${t.chip} ${kind === k ? t.chipOn : ''}`} onClick={() => setKind(k)}>
                  {kindLabel(k)} <b>{data.counts.kinds[k]}</b>
                </button>
              ))
            )}
          </span>
        </div>

        {isLeft ? (
          <>
            <div className={t.tbar}>
              <button
                type="button"
                className={`${t.btn} ${t.btnSm} ${t.btnPrimary}`}
                disabled={!canClassify || plan.confirm.length === 0}
                onClick={runConfirm}
              >
                확정{plan.confirm.length ? ` (${plan.confirm.length})` : ''}
              </button>
              <button
                type="button"
                className={`${t.btn} ${t.btnSm}`}
                disabled={!canClassify || plan.reopen.length === 0}
                onClick={reopen}
              >
                고치기{plan.reopen.length ? ` (${plan.reopen.length})` : ''}
              </button>
              <span className={t.tbarSep} />
              {sel.length ? (
                <>
                  <select
                    className={t.select}
                    style={{ height: 32, width: 220 }}
                    value={bulk}
                    disabled={!canClassify}
                    aria-label="여러 줄 한 번에 — 항목"
                    onChange={(e) => setBulk(e.target.value)}
                  >
                    {itemOptions}
                  </select>
                  <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!canClassify || !bulk} onClick={runBulk}>
                    선택한 줄에 붙이기
                  </button>
                  <span className={t.sm}>{sel.length}줄 선택</span>
                </>
              ) : (
                <span className={t.sm}>줄을 고르세요 · 여러 줄을 골라 한 번에 확정하거나 같은 항목을 붙일 수 있습니다</span>
              )}
            </div>
            {errorBanner}
            <div className={t.tblWrap}>
              <table className={t.tbl} style={{ borderTop: '1px solid var(--border)' }}>
                <colgroup>
                  <col className={t.wChk} />
                  <col style={{ width: 64 }} />
                  <col style={{ width: 110 }} />
                  <col />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 300 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th aria-label="선택" />
                    <th>날짜</th>
                    <th>출처</th>
                    <th>내용</th>
                    <th className={t.num}>금액</th>
                    <th>항목</th>
                  </tr>
                </thead>
                <tbody>
                  {leftRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={t.empty}>
                        <Icon name="circle-check" size={18} /> 남은 줄이 없습니다
                      </td>
                    </tr>
                  ) : (
                    leftRows.map((r) => {
                      const on = sel.includes(r.id);
                      const open = r.itemCode === null || editing.has(r.id);
                      const pick = picks[r.id];
                      const value = pick ?? (editing.has(r.id) ? (r.itemCode ?? '') : (r.suggestedItemCode ?? ''));
                      const suggested = !pick && !editing.has(r.id) && !!r.suggestedItemCode;
                      return (
                        <tr key={r.id} className={`${t.clickable} ${on ? t.pick : ''}`} onClick={() => toggle(r.id)}>
                          <td>
                            <input
                              type="checkbox"
                              className={t.rowchk}
                              checked={on}
                              aria-label="선택"
                              onChange={() => toggle(r.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className={t.tnum}>{shortDate(r.writeDate)}</td>
                          <td className={`${t.mut} ${t.ell}`}>{dirName(r.direction)} 계산서</td>
                          <td className={t.ell} title={r.vendorName}>
                            {r.vendorName}
                          </td>
                          <td className={t.num}>{won(r.totalAmount)}</td>
                          <td>
                            {open ? (
                              <div onClick={(e) => e.stopPropagation()}>
                                <select
                                  className={t.select}
                                  style={{ width: '100%', height: 36 }}
                                  value={value}
                                  disabled={!canClassify}
                                  aria-label="항목"
                                  onChange={(e) => setPicks((p) => ({ ...p, [r.id]: e.target.value }))}
                                >
                                  {itemOptions}
                                </select>
                                {suggested ? (
                                  <div className={t.sm} style={{ marginTop: 3 }}>
                                    지난번 항목을 골라 두었습니다
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <span style={{ fontWeight: 700 }}>{itemName(r.itemCode!)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className={t.tbar}>
              <ExcelDownloadButton href={exportHref(query)} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
              {fileId ? null : (
                <span className={t.row} style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <span className={t.sm}>기간</span>
                  <select
                    className={t.select}
                    style={{ height: 32, width: 'auto' }}
                    value={period ? 'c' : 'm'}
                    aria-label="기간"
                    onChange={(e) =>
                      setPeriod(e.target.value === 'c' ? { from: `${month}-01`, to: lastDayOf(month) } : null)
                    }
                  >
                    <option value="m">작업할 달 ({monthLabel(month)})</option>
                    <option value="c">기간 직접 지정</option>
                  </select>
                  {period ? (
                    <>
                      <input
                        type="date"
                        className={t.input}
                        style={{ height: 32, width: 150 }}
                        value={period.from}
                        aria-label="시작"
                        onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })}
                      />
                      <span className={t.sm}>~</span>
                      <input
                        type="date"
                        className={t.input}
                        style={{ height: 32, width: 150 }}
                        value={period.to}
                        aria-label="끝"
                        onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })}
                      />
                    </>
                  ) : null}
                </span>
              )}
              <span className={t.sm}>지금 걸린 거르기 결과만 내려받습니다</span>
            </div>
            {errorBanner}
            <div className={t.tblWrap}>
              <table className={t.tbl} style={{ borderTop: '1px solid var(--border)' }}>
                <colgroup>
                  <col style={{ width: 64 }} />
                  <col style={{ width: 110 }} />
                  <col />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 220 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>자료</th>
                    <th>내용</th>
                    <th className={t.num}>금액</th>
                    <th>항목 · 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className={t.empty}>
                        해당하는 줄이 없습니다
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className={t.tnum}>{shortDate(r.writeDate)}</td>
                        <td className={t.mut}>{dirName(r.direction)}</td>
                        <td className={t.ell} title={r.vendorName}>
                          {r.vendorName}
                        </td>
                        <td className={t.num}>
                          {r.direction === TAX_INV_DIR_SALES ? '+' : ''}
                          {won(r.totalAmount)}
                        </td>
                        <td>
                          {r.direction === TAX_INV_DIR_SALES ? (
                            <span>{dirName(r.direction)}</span>
                          ) : r.itemCode ? (
                            <span style={{ fontWeight: 700 }}>{itemName(r.itemCode)}</span>
                          ) : (
                            <span className={`${t.badge} ${t.bDoing}`}>분류 필요</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <TaxToast message={toast} />
    </div>
  );
}

/** 달의 마지막 날(`YYYY-MM-DD`) — 「기간 직접 지정」의 처음 끝 날짜. */
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
