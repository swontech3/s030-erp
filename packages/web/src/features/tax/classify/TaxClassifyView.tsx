'use client';

/**
 * 매출 · 매입 항목 지정(s050300010, 옛 이름 거래 분류) 본문 — 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-05 ·
 * `tax-screens-d.js` 의 「전체」 보기 · 결과서 `08-screen-report.md` S05-05 그대로. 1-3 범위(결정 2026-10-27):
 *
 *   작업할 달 줄 · 제목 + 배지 「지정 건 / 전체 매입 완료」 · 회색 안내 띠 · 표 카드(탭 → 목록 위 버튼 줄 → 표)
 *   탭(결정 2026-10-28 — 옛 「확인할 줄만 / 전체」 + 「남은 줄 / 모두」 두 줄 칩을 합침):
 *   「미지정 건」: 항목이 빈 매입 줄(계산서 · 카드 · 현금 매입, 1-4)에 항목 붙이기 — [확정 (N)] · 항목 선택 + [선택한 줄에 붙이기]
 *   「지정 건」: 확정한 매입 줄 — [고치기 (N)] → 다시 [확정 (N)]
 *   「이번 달 자료 전체」(주소 view=all): 거른 계산서 · 카드 · 현금 읽기만 — 자료 종류 칩 · [엑셀 내려받기] + 기간 · 파일 띠 [모두 보기]
 *   ★ 미지정 · 지정 탭은 같은 서버 응답(view=left)을 화면에서 나눠 보일 뿐 — 숫자는 서버가 센 left · total(지정 = total − left).
 *
 * ★ 뒤 단계(그리지 않음): 은행 · 짝 남은 금액 줄, 입금 항목(현금 매출은 매출 계산서처럼 항목 없음), 「입금·출금 섞임」 막기,
 *   은행 줄 안내 문구, 다음 단계 줄.
 * ★ 줄은 「자료 종류:id」(`classifyRowKey`)로 가리킨다 — 표가 셋이라 id 만으로는 갈리지 않는다(1-4). 확정 본문에 kind 를 싣는다.
 * ★★ 항목 이름 · 풀이 · 계산서 구분 · 사업자 유형 · 자료 종류 이름은 **API 가 준 코드 값으로만** 그린다. 카드 · 현금 칩 · 출처는
 *    자료 종류 코드(TAX_KIND) 이름(판단 16, 1-4). 예외는 아직 자료가 없는 칩 「삐용 경비 · 은행(짝 없는 줄)」 — 시안 글자 그대로.
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
  classifyRowKey,
  withEulReul,
  type ClassifyKind,
  type ClassifyView,
  type TaxClassifyRow,
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

/** 아직 자료가 없는 자료 종류 칩 — 시안 글자(결정 2026-10-27). 매입 · 매출은 계산서 구분 이름, 카드 · 현금은 자료 종류 이름. */
const LATER_KIND_LABEL: Partial<Record<ClassifyKind, string>> = {
  PPIYONG: '삐용 경비',
  BANK: '은행(짝 없는 줄)',
};

/** 설명 문구 — N 은 서버가 센 그 달 매입 줄 수(계산서 · 카드 · 현금 매입, 1-4 「다르게 해야 할 곳」 5). */
const desc = (total: number) =>
  `이번 달 매입 ${total}줄(계산서 · 카드 · 현금)에 「무엇에 쓴 돈인지」 골라 주세요. 다 고르면 손익 · 부가세에 반영됩니다.`;

/** 탭 — 미지정 · 지정은 view=left, 이번 달 자료 전체는 view=all. */
type ClassifyTab = 'todo' | 'done' | 'all';

interface Props {
  month: string;
  initialView: ClassifyView;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
}

export function TaxClassifyView({ month, initialView, fileId: initialFile }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<ClassifyTab>(initialView === 'all' ? 'all' : 'todo');
  const view: ClassifyView = tab === 'all' ? 'all' : 'left';
  const [kind, setKind] = useState<ClassifyKind>('all');
  const [fileId, setFileId] = useState<string | null>(initialFile);
  /** 기간 직접 지정 — null 이면 작업할 달. */
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<TaxClassifyResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        .catch((err: unknown) =>
          setLoadError(err instanceof TaxClassifyError ? err.message : '매출 · 매입 항목 지정을 불러오지 못했습니다'),
        ),
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
  const kindName = (code: string) => data.codes.kinds.find((k) => k.code === code)?.name ?? code;
  const canClassify = data.bizType !== null && data.codes.items.length > 0;
  /** 출처 칸 — 계산서는 「매입 계산서」, 카드는 별칭(없으면 「끝 4821」), 현금은 자료 종류 이름. ★ 카드는 끝 4자리만. */
  const sourceOf = (r: TaxClassifyRow) =>
    r.kind === 'CARD'
      ? (r.cardAlias ?? `${kindName('CARD')} · 끝 ${r.cardLast4}`)
      : r.kind === 'CASH'
        ? kindName('CASH')
        : `${dirName(r.direction)} 계산서`;
  /** 내용 칸 — 현금은 품명(거래처 글이 있으면 뒤에), 나머지는 거래처 이름. */
  const contentOf = (r: TaxClassifyRow) =>
    r.kind === 'CASH' ? `${r.description ?? ''}${r.vendorName ? ` · ${r.vendorName}` : ''}` : r.vendorName;
  const isLeft = view === 'left';
  const doneCount = data.counts.total - data.counts.left;

  /** 탭 바꾸기 — 고른 줄은 지운다. 미지정 · 지정으로 가면 파일 거르기를 푼다(시안 `c-view`). */
  const changeTab = (next: ClassifyTab) => {
    setTab(next);
    setSel([]);
    if (next !== 'all' && fileId) {
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

  /* ── 「미지정 건」 · 「지정 건」 ── */
  const plan = classifyPlan(data.rows, sel, picks, editing);
  const leftRows = data.rows.filter((r) => (tab === 'todo' ? r.itemCode === null : r.itemCode !== null));
  const toggle = (key: string) => setSel((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));

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
      const picked = data.rows.filter((x) => sel.includes(classifyRowKey(x)));
      const r = await confirmRows(picked.map((x) => ({ kind: x.kind, id: x.id, itemCode: bulk })));
      const name = itemName(bulk);
      notify(`${r.confirmed}줄에 「${name}」${withEulReul(name).slice(name.length)} 붙였습니다`);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxClassifyError ? err.message : '붙이지 못했습니다');
    }
  };

  const tabs: [ClassifyTab, string, number][] = [
    ['todo', '미지정 건', data.counts.left],
    ['done', '지정 건', doneCount],
    ['all', '이번 달 자료 전체', data.counts.kinds.all],
  ];
  const tabBar = (
    <div className={t.tabs} role="tablist" style={{ padding: '0 16px' }}>
      {tabs.map(([k, label, n]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={tab === k}
          className={`${t.tab} ${tab === k ? t.tabOn : ''}`}
          onClick={() => changeTab(k)}
        >
          {label} ({n})
        </button>
      ))}
    </div>
  );

  const kindLabel = (k: ClassifyKind) =>
    k === 'all'
      ? '전체'
      : k === TAX_INV_DIR_PURCHASE || k === TAX_INV_DIR_SALES
        ? dirName(k)
        : (LATER_KIND_LABEL[k] ?? kindName(k));

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
          <h1>매출 · 매입 항목 지정</h1>
          <p>{desc(data.counts.total)}</p>
        </div>
        {isLeft ? (
          <span className={`${t.badge} ${data.counts.left ? t.bDoing : t.bDone}`}>
            {doneCount} / {data.counts.total} 완료
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
        {tabBar}

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
              {tab === 'done' ? (
                <button
                  type="button"
                  className={`${t.btn} ${t.btnSm}`}
                  disabled={!canClassify || plan.reopen.length === 0}
                  onClick={reopen}
                >
                  고치기{plan.reopen.length ? ` (${plan.reopen.length})` : ''}
                </button>
              ) : null}
              <span className={t.tbarSep} />
              {tab === 'done' ? (
                <span className={t.sm}>줄을 골라 [고치기]로 항목을 바꾼 뒤 다시 [확정]하세요</span>
              ) : sel.length ? (
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
                    선택한 줄에 붙이기 ({sel.length})
                  </button>
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
                    <th>무엇에 쓴 돈인가요?</th>
                  </tr>
                </thead>
                <tbody>
                  {leftRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={t.empty}>
                        {tab === 'todo' ? (
                          <>
                            <Icon name="circle-check" size={18} /> 이번 달 정리를 마쳤습니다
                          </>
                        ) : (
                          '해당하는 줄이 없습니다'
                        )}
                      </td>
                    </tr>
                  ) : (
                    leftRows.map((r) => {
                      const rk = classifyRowKey(r);
                      const on = sel.includes(rk);
                      const open = r.itemCode === null || editing.has(rk);
                      const pick = picks[rk];
                      const value = pick ?? (editing.has(rk) ? (r.itemCode ?? '') : (r.suggestedItemCode ?? ''));
                      const suggested = !pick && !editing.has(rk) && !!r.suggestedItemCode;
                      return (
                        <tr key={rk} className={`${t.clickable} ${on ? t.pick : ''}`} onClick={() => toggle(rk)}>
                          <td>
                            <input
                              type="checkbox"
                              className={t.rowchk}
                              checked={on}
                              aria-label="선택"
                              onChange={() => toggle(rk)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td className={t.tnum}>{shortDate(r.writeDate)}</td>
                          <td className={`${t.mut} ${t.ell}`} title={sourceOf(r)}>
                            {sourceOf(r)}
                          </td>
                          <td className={t.ell} title={contentOf(r)}>
                            {contentOf(r)}
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
                                  onChange={(e) => setPicks((p) => ({ ...p, [rk]: e.target.value }))}
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
            <div className={t.cardPad} style={{ paddingTop: 14, paddingBottom: 14 }}>
              <span className={t.chips}>
                {CLASSIFY_KINDS.map((k) => (
                  <button key={k} type="button" className={`${t.chip} ${kind === k ? t.chipOn : ''}`} onClick={() => setKind(k)}>
                    {kindLabel(k)} <b>{data.counts.kinds[k]}</b>
                  </button>
                ))}
              </span>
            </div>
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
                      <tr key={classifyRowKey(r)}>
                        <td className={t.tnum}>{shortDate(r.writeDate)}</td>
                        <td className={`${t.mut} ${t.ell}`} title={sourceOf(r)}>
                          {r.kind === 'INVOICE' ? dirName(r.direction) : sourceOf(r)}
                        </td>
                        <td className={t.ell} title={contentOf(r)}>
                          {contentOf(r)}
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
