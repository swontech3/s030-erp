'use client';

/**
 * 매출 · 매입 항목 지정(s050300010, 옛 이름 거래 분류) 본문 — 2026-11-08 대표 수정 ⑤ 로 짜임을 바꿨다.
 *
 *   ① 검색조건(카드) — 년월(세무 공통 연도 · 월) · 구분 · 출처 · 계정과목. 바꾸면 바로 걸러진다. 파일로 들어왔으면 오른쪽에 파일 안내 + [모두 보기]
 *   ② 버튼 줄(카드 밖) — 왼쪽 [수정] [확정] (+ 고른 미지정 줄이 있으면 항목 선택 + [선택한 줄에 붙이기]) · 오른쪽 [엑셀 내려받기]
 *   ③ 목록(카드) — 날짜 · 출처 · 사용처 · 내용 · 금액 · 계정과목. 목록만 스크롤 · 머리 줄 고정(거래처 꼴 —
 *      `pageFill` · `listCard` · `listScroll` · `tblSticky`)
 *
 * ★ 탭(미지정 건 · 지정 건 · 이번 달 자료 전체) · 자료 종류 칩 · 기간 직접 지정 · 설명 글 · 「오늘 … · 사업자 유형」을 없앴다.
 * ★ 검색조건 라벨(구분 · 출처 · 계정과목)은 지웠다(2026-11-08 거래처와 같게) — 선택 상자 첫 줄 「구분 전체」 · 「출처 전체」 · 「계정과목 전체」로 뜻을 보인다.
 * ★ 같은 날 추가 수정: 「무엇에 쓴 돈인가요?」 → 「계정과목」. 검색조건 「계정과목」(그 회사 출금 항목 TAX_ITEM_OUT, 고르면 그 계정과목으로
 *   확정된 줄만 — 서버 `filterClassifyRows`). 설명 · 안내 문구(항목 목록 안내 띠 · 「지난번 항목을 골라 두었습니다」)를 지웠다 —
 *   남기는 글은 「세무 설정 먼저」 띠 · 오류 · 빈 목록 · 파일 띠 · 토스트처럼 무엇을 해야 하는지(무슨 일이 일어났는지) 알리는 것만.
 *   구분 · 출처 선택지는 코드 TAX_CLS_STATUS · TAX_CLS_SOURCE(222)를 API 가 준 그대로(켜진 것만) — 「전체」는 첫 줄.
 * ★ 버튼은 고른 줄 기준(구분이 「전체」여도 같다): 미지정 줄을 고르면 [확정], 지정 줄을 고르면 [수정]이 켜진다.
 *   [수정]은 옛 [고치기] — 그 줄을 화면 안에서만 선택 칸으로 다시 열고, 다시 [확정]하면 덮는다. 매출 줄은 고를 수 없다(「—」).
 *   확정 · 수정 · 지난번 항목 골라 두기 · 붙이기 규칙은 그대로 — 탭으로 나뉘어 있던 것을 한 목록에서 할 뿐이다(shared `classifyPlan`).
 * ★ 카드 줄 「내용」(222) — 열린 줄(미지정 · 수정 중)에서 입력 칸, [확정] 때 항목과 함께 저장. 현금은 품명을 보이기만, 계산서는 「—」.
 * ★★ 항목 이름 · 풀이 · 계산서 구분 · 자료 종류 · 구분 · 출처 이름은 **API 가 준 코드 값으로만** 그린다.
 * ★ 사업자 유형이 없으면(세무 설정 전) 항목 선택 · 확정 · 붙이기를 막고 안내한다(결정 2026-10-27). 목록 · 엑셀은 된다.
 * ★ 파일로 들어오면 기간 거르기를 걸지 않는다(결정) — 구분 · 출처는 그대로 걸린다.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CARD_NOTE_MAX,
  classifyBulk,
  classifyContentOf,
  classifyPlaceOf,
  classifyPlan,
  classifyRowKey,
  classifySourceLabel,
  withEulReul,
  type ClassifyKind,
  type ClassifyStatus,
  type TaxClassifyRow,
} from '@swonbiz/shared/domain/tax-classify';
import { TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES } from '@swonbiz/shared/domain/tax-uploads';
import { Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxEmpty } from '../common/TaxEmpty';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
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

/** 목록에 없는 값. */
const DASH = '—';
const FILTER_STYLE = { height: 32, width: 'auto', minWidth: 110 } as const;

interface Props {
  month: string;
  /** 자료 올리기 [보기]로 들어온 파일. */
  fileId: string | null;
  /** 처음 구분 — 주소 `?status=`(부가세 조회 비고 [항목지정]은 미지정 L, 11-08 ⑦). 없으면 전체. */
  initialStatus?: ClassifyStatus;
}

export function TaxClassifyView({ month, fileId, initialStatus = 'all' }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<ClassifyStatus>(initialStatus);
  const [kind, setKind] = useState<ClassifyKind>('all');
  /** 계정과목 — 빈 글이면 전체. */
  const [item, setItem] = useState('');
  const [data, setData] = useState<TaxClassifyResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  /** 줄마다 고른 항목(확정 전). */
  const [picks, setPicks] = useState<Record<string, string>>({});
  /** 카드 줄마다 고쳐 쓴 내용(확정 전). */
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** [수정]으로 다시 연 줄 — 화면 안에서만. */
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const { message: toast, notify } = useTaxToast();

  const query: ClassifyQuery = { month, status, kind, from: null, to: null, fileId, item: item || null };
  const key = JSON.stringify(query);

  const reload = useCallback(
    () =>
      loadClassify(JSON.parse(key) as ClassifyQuery)
        .then((d) => {
          setData(d);
          setLoadError(null);
          setSel([]);
          setPicks({});
          setNotes({});
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

  const itemName = (code: string) => data.codes.itemNames.find((i) => i.code === code)?.name ?? code;
  const canClassify = data.bizType !== null && data.codes.items.length > 0;
  const names = { invDirs: data.codes.invDirs, kinds: data.codes.kinds };
  const isSales = (r: TaxClassifyRow) => r.direction !== TAX_INV_DIR_PURCHASE;

  const plan = classifyPlan(data.rows, sel, picks, editing, notes);
  const bulkRows = classifyBulk(data.rows, sel, bulk || '-', editing, notes);
  const toggle = (rk: string) => setSel((s) => (s.includes(rk) ? s.filter((x) => x !== rk) : [...s, rk]));

  const runConfirm = async () => {
    setFailed(null);
    try {
      const r = await confirmRows(plan.confirm);
      notify(`${r.confirmed}줄을 확정했습니다${plan.skipped ? ` · ${plan.skipped}줄은 계정과목이 없어 건너뜀` : ''}`);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxClassifyError ? err.message : '확정하지 못했습니다');
    }
  };
  const reopen = () => setEditing((e) => new Set([...e, ...plan.reopen]));
  const runBulk = async () => {
    setFailed(null);
    try {
      const r = await confirmRows(classifyBulk(data.rows, sel, bulk, editing, notes));
      const name = itemName(bulk);
      notify(`${r.confirmed}줄에 「${name}」${withEulReul(name).slice(name.length)} 붙였습니다`);
      await reload();
    } catch (err) {
      setFailed(err instanceof TaxClassifyError ? err.message : '붙이지 못했습니다');
    }
  };
  /** [모두 보기] — 파일 거르기를 푼다(주소에서 파일을 빼면 새로 그린다). */
  const clearFile = () => router.replace(`${pathname}?month=${month}`);

  const itemOptions = (
    <>
      <option value="">계정과목 고르기</option>
      {data.codes.items.map((i) => (
        <option key={i.code} value={i.code}>
          {i.description ? `${i.name} — ${i.description}` : i.name}
        </option>
      ))}
    </>
  );

  const fileNote = data.file ? (
    <span className={t.row} style={{ gap: 8, flexWrap: 'nowrap' }}>
      <Icon name="file-text" size={16} />
      <span className={t.ell} style={{ maxWidth: 260 }} title={data.file.fileName}>
        「{data.file.fileName}」 파일로 들어온 줄만 보는 중
      </span>
      <button type="button" className={`${t.btn} ${t.btnSm}`} onClick={clearFile}>
        모두 보기
      </button>
    </span>
  ) : null;

  return (
    <div className={`${t.page} ${t.pageFill}`}>
      {/* ① 검색조건 — 바꾸면 바로 걸러진다 */}
      <div className={`${t.card} ${t.secLow}`}>
        <TaxMonthBar month={month} note={fileNote}>
          <select
            className={t.select}
            style={FILTER_STYLE}
            aria-label="구분"
            value={status}
            onChange={(e) => setStatus(e.target.value as ClassifyStatus)}
          >
            <option value="all">구분 전체</option>
            {data.codes.statuses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className={t.select}
            style={FILTER_STYLE}
            aria-label="출처"
            value={kind}
            onChange={(e) => setKind(e.target.value as ClassifyKind)}
          >
            <option value="all">출처 전체</option>
            {data.codes.sources.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className={t.select}
            style={{ ...FILTER_STYLE, maxWidth: 200 }}
            aria-label="계정과목"
            value={item}
            onChange={(e) => setItem(e.target.value)}
          >
            <option value="">계정과목 전체</option>
            {data.codes.items.map((i) => (
              <option key={i.code} value={i.code}>
                {i.name}
              </option>
            ))}
          </select>
        </TaxMonthBar>
      </div>

      {canClassify ? null : (
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
      )}

      {/* ② 버튼 — 고른 줄 기준 */}
      <div className={`${t.tbar} ${t.tbarOut}`}>
        <button
          type="button"
          className={`${t.btn} ${t.btnSm}`}
          disabled={!canClassify || plan.reopen.length === 0}
          onClick={reopen}
        >
          <Icon name="pencil-line" size={16} />
          수정{plan.reopen.length ? ` (${plan.reopen.length})` : ''}
        </button>
        <button
          type="button"
          className={`${t.btn} ${t.btnSm} ${t.btnPrimary}`}
          disabled={!canClassify || plan.confirm.length === 0}
          onClick={runConfirm}
        >
          <Icon name="check" size={16} />
          확정{plan.confirm.length ? ` (${plan.confirm.length})` : ''}
        </button>
        {bulkRows.length ? (
          <>
            <span className={t.tbarSep} />
            <select
              className={t.select}
              style={{ height: 32, width: 220 }}
              value={bulk}
              disabled={!canClassify}
              aria-label="여러 줄 한 번에 — 계정과목"
              onChange={(e) => setBulk(e.target.value)}
            >
              {itemOptions}
            </select>
            <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!canClassify || !bulk} onClick={runBulk}>
              선택한 줄에 붙이기 ({bulkRows.length})
            </button>
          </>
        ) : null}
        <span className={t.sp} />
        <ExcelDownloadButton href={exportHref(query)} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      {/* ③ 목록 — 목록만 스크롤 · 머리 줄 고정 */}
      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          <table className={`${t.tbl} ${t.tblSticky}`}>
            <colgroup>
              <col className={t.wChk} />
              <col style={{ width: 64 }} />
              <col style={{ width: 120 }} />
              <col />
              <col style={{ width: 180 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 260 }} />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="선택" />
                <th>날짜</th>
                <th>출처</th>
                <th>사용처</th>
                <th>내용</th>
                <th className={t.num}>금액</th>
                <th>계정과목</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className={t.empty}>
                    {status === 'L' && kind === 'all' && !item && !fileId ? (
                      <TaxEmpty icon="circle-check" lead="이번 달 정리를 마쳤습니다" />
                    ) : (
                      <TaxEmpty icon="file-pen-line" lead="해당하는 줄이 없습니다" />
                    )}
                  </td>
                </tr>
              ) : (
                data.rows.map((r) => {
                  const rk = classifyRowKey(r);
                  const sales = isSales(r);
                  const on = sel.includes(rk);
                  const open = !sales && (r.itemCode === null || editing.has(rk));
                  const pick = picks[rk];
                  const value = pick ?? (editing.has(rk) ? (r.itemCode ?? '') : (r.suggestedItemCode ?? ''));
                  const source = classifySourceLabel(r, names);
                  const place = classifyPlaceOf(r);
                  const content = classifyContentOf(r);
                  return (
                    <tr
                      key={rk}
                      className={`${sales ? '' : t.clickable} ${on ? t.pick : ''}`}
                      onClick={sales ? undefined : () => toggle(rk)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className={t.rowchk}
                          checked={on}
                          disabled={sales}
                          aria-label="선택"
                          onChange={() => toggle(rk)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className={t.tnum}>{shortDate(r.writeDate)}</td>
                      <td className={`${t.mut} ${t.ell}`} title={source}>
                        {source}
                      </td>
                      <td className={t.ell} title={place ?? undefined}>
                        {place ?? <span className={t.mut}>{DASH}</span>}
                      </td>
                      <td className={r.kind === 'CARD' && open ? undefined : t.ell} title={content ?? undefined}>
                        {r.kind === 'CARD' && open ? (
                          <input
                            className={t.input}
                            style={{ width: '100%', height: 36 }}
                            maxLength={CARD_NOTE_MAX}
                            placeholder="사용 내용"
                            aria-label="내용"
                            value={notes[rk] ?? r.note ?? ''}
                            disabled={!canClassify}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setNotes((n) => ({ ...n, [rk]: e.target.value }))}
                          />
                        ) : (
                          (content ?? <span className={t.mut}>{DASH}</span>)
                        )}
                      </td>
                      <td className={t.num}>
                        {r.direction === TAX_INV_DIR_SALES ? '+' : ''}
                        {won(r.totalAmount)}
                      </td>
                      <td>
                        {sales ? (
                          <span className={t.mut}>{DASH}</span>
                        ) : open ? (
                          <div onClick={(e) => e.stopPropagation()}>
                            <select
                              className={t.select}
                              style={{ width: '100%', height: 36 }}
                              value={value}
                              disabled={!canClassify}
                              aria-label="계정과목"
                              onChange={(e) => setPicks((p) => ({ ...p, [rk]: e.target.value }))}
                            >
                              {itemOptions}
                            </select>
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
      </div>

      <TaxToast message={toast} />
    </div>
  );
}
