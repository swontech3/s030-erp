'use client';

/**
 * 자료 올리기(s050200010) 본문 — 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-a.js` 의 S05-02 ·
 * 결과서 `08-screen-report.md` S05-02.
 *
 * ★★ 2026-11-07 대표 수정 ④ — 화면 짜임을 바꿨다. 테두리 있는 세 섹션, 위 둘은 낮게(올린 파일이 많이 보이게):
 *   ① 년월 검색조건 — 연도 · 월 선택 + 「등록현황 : N종 / M종」(파일이 하나라도 있는 자료 수 / 올릴 수 있는 자료 수, `uploadSummary`)
 *   ② 파일 올리기 — 카드 3행: 제목 · [파일 첨부] / 등록현황 · 오른쪽 [양식받기](현금 경비만, 2026-11-08) (`uploadCountLabel` — 정해진 파일
 *      「등록 / 올려야 할」, 은행 · 대출은 「N건」) / 설명 한 줄(작은 회색, 넘치면 …). 카드를 누르면 ③ 이 그 자료의 파일만, 다시 누르면 전체.
 *   ③ 올린 파일 — 거래처 목록 꼴(`pageFill` · `listCard` · `listScroll` · `tblSticky`): 목록만 스크롤 · 머리 줄 고정.
 *      줄 고르기 · 위쪽 버튼 줄 없음 — 칸 끝 「작업」에 줄마다 [보기] · [삭제].
 *   ★ 4대보험 카드는 뺐다(인사 시스템으로 넘김 — 서버가 카드로 싣지 않는다). 이미 올린 4대보험 파일은 ③ 에 그대로 보인다.
 *   ★ 「개인 경비」(전 삐용 경비)는 자료 종류 코드가 아니라 화면 글자다(준비 중, 대표 결정 2026-11-07).
 *
 * ★ 여러 파일 올리기(④): 은행 말고는 [파일 첨부]에서 여러 파일을 한 번에 고르고, 은행은 올리기 창에서 [행 추가] — 한 줄 = 계좌 ·
 *   파일 종류 · 파일. 미리보기 · 같은 파일 막기 · 오류 안내는 파일마다 지금 규칙 그대로, 한 팝업에서 파일별로 보이고 [올리기] 한 번.
 *   - 올릴 수 있는 파일만 올린다(오류 · 같은 파일 · 넣을 줄 0 인 파일은 빠짐, 대표 결정 2026-11-07). 하나씩 차례로 보낸다.
 *   - 은행은 거래내역을 먼저, 이체 내역을 뒤에 보낸다. 같은 창에 같은 계좌 거래내역이 있는 이체 줄은 미리보기를 미룬다 —
 *     서버의 짝 찾기가 그 계좌 거래내역이 DB 에 있어야 돌기 때문이다. 덧붙인 줄 수는 올린 뒤 서버 결과로 알린다(대표 결정 2026-11-07).
 *
 * ★ [보기] — 계산서 · 카드 · 현금은 항목 지정 「이번 달 자료 전체」 + 그 파일 줄만(`/tax/classify?month=&view=all&file=`),
 *   국세 · 지방세 · 4대보험 · 대출은 세금 · 4대보험 · 대출의 그 탭으로(`/tax/payments?month=&file=`). 은행은 받을 화면이 없어 막는다(`viewHrefOf`).
 * ★ [삭제] — 줄마다. 지우기 전 확인을 먼저 받아 확인 팝업 한 번에 빠질 줄 · 겹쳤을 수 있는 파일을 보인다(지금 규칙 그대로).
 * ★ 은행 올리기 — 계좌(세무 설정 은행 계좌, 「사용 안 함」 제외) · 파일 종류(코드 TAX_BANK_FILE). 계좌가 없으면 「등록된 계좌가 없습니다 ·
 *   [세무 설정에서 추가]」. 그 은행의 대응표가 없는 파일 종류는 막고 안내. ★ 받는 계좌번호 · 카드번호는 끝 4자리만(서버가 그것만 준다).
 *
 * ★★ 이름 · 설명 · 선택지는 **API 가 준 코드 값으로만** 그린다(자료 종류 이름 · 설명은 코드 TAX_KIND — 221 에서 바꿈).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import { uploadCountLabel, uploadSummary } from '@swonbiz/shared/domain/tax-uploads';
import t from '../common/tax.module.css';
import { TaxEmpty } from '../common/TaxEmpty';
import { TaxConfirmDialog } from '../common/TaxConfirmDialog';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar, monthShort } from '../common/TaxMonthBar';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import {
  BANK_FILE_TXN,
  BANK_FILE_XFER,
  KIND_BANK,
  KIND_CASH,
  PAY_KINDS,
  TaxUploadError,
  checkDelete,
  deleteFiles,
  loadUploads,
  previewUpload,
  shortDateTime,
  shortStamp,
  spreadsheetMimeOf,
  templateHref,
  uploadFile,
  viewHrefOf,
  won,
  type BankChoice,
  type TaxUploadDeleteResult,
  type TaxUploadPreview,
  type TaxUploadsResponse,
} from './tax-uploads-model';

/** 「개인 경비」 카드 — 자료 종류 코드가 아니다(화면 글자, 준비 중). 삐용의 결재 완료건을 자동으로 잇는다. */
const PERSONAL_NAME = '개인 경비';
const PERSONAL_DESC = '삐용의 결재 완료건 자동 연계';

type Confirm = { ids: string[]; names: string[]; check: TaxUploadDeleteResult } | null;
/** 올리기 창 — 은행은 빈 줄 하나로, 나머지는 [파일 첨부]에서 고른 파일들로 연다. */
type Modal = { kind: string; files: File[] } | null;

/** 카드 안의 버튼 — 눌러도 카드 고르기(목록 거르기)가 같이 일어나지 않게. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export function TaxUploadsView({ month }: { month: string }) {
  const router = useRouter();
  const [data, setData] = useState<TaxUploadsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { message: toast, notify } = useTaxToast();
  const picker = useRef<HTMLInputElement>(null);
  const pickKind = useRef<string | null>(null);

  const reload = useCallback(
    () =>
      loadUploads(month)
        .then(setData)
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
  const bankFileName = (code: string) => data.codes.bankFileTps.find((x) => x.code === code)?.name ?? code;
  /** 「국민은행 · 운영 통장」 — 별칭이 없으면(지웠거나 비움) 계좌번호. 은행 이름은 코드 표(BANK). */
  const accountLabel = (a: { bankCode: string; accountNo: string; alias: string | null }) =>
    `${data.codes.banks.find((b) => b.code === a.bankCode)?.name ?? a.bankCode} · ${a.alias ?? a.accountNo}`;
  const dirName = (code: string | null) => (code ? (data.codes.invDirs.find((d) => d.code === code)?.name ?? code) : '—');
  /** 「건강보험 · 9월 고지」 — 이미 올린 4대보험 파일(1-6). 보험 이름은 코드 표(TAX_SOCIAL_INS). */
  const socialLabel = (x: { insTp: string; noticeMonth: string }) =>
    `${data.codes.socialInsTps.find((c) => c.code === x.insTp)?.name ?? x.insTp} · ${monthShort(x.noticeMonth)} 고지`;
  const summary = uploadSummary(data.cards);
  const files = filterKind ? data.files.filter((f) => f.kind === filterKind) : data.files;

  const toggleFilter = (kind: string) => setFilterKind((k) => (k === kind ? null : kind));
  const onCardKey = (kind: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFilter(kind);
    }
  };
  /** [파일 첨부] — 은행은 올리기 창을 빈 줄 하나로 열고, 나머지는 파일 고르기(여러 파일)부터. */
  const attach = (kind: string) => {
    setFailed(null);
    if (kind === KIND_BANK) {
      setModal({ kind, files: [] });
      return;
    }
    pickKind.current = kind;
    picker.current?.click();
  };

  /** [삭제] — 지우기 전 확인을 먼저 받아 확인 팝업에 빠질 줄 · 겹쳤을 수 있는 파일을 보인다. */
  const askDelete = async (id: string) => {
    setFailed(null);
    try {
      const check = await checkDelete([id]);
      const names = data.files.filter((f) => f.id === id).map((f) => f.fileName);
      setConfirm({ ids: [id], names, check });
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
    <div className={`${t.page} ${t.pageFill}`}>
      {/* ① 년월 검색조건 */}
      <div className={`${t.card} ${t.secLow}`}>
        <TaxMonthBar month={month} note={`등록현황 : ${summary.done}종 / ${summary.total}종`} />
      </div>

      {/* ② 파일 올리기 — 카드를 누르면 ③ 이 그 자료의 파일만 */}
      <div className={`${t.card} ${t.secLow}`}>
        <div className={t.grid4}>
          {data.cards.map((c) => {
            const k = data.codes.kinds.find((x) => x.code === c.kind);
            const on = filterKind === c.kind;
            return (
              <div
                key={c.kind}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                className={`${t.card} ${t.kindCard} ${on ? t.kindOn : ''}`}
                onClick={() => toggleFilter(c.kind)}
                onKeyDown={onCardKey(c.kind)}
              >
                <div className={t.kindHead}>
                  <span className={t.kindNm} title={k?.name ?? c.kind}>
                    {k?.name ?? c.kind}
                  </span>
                  <button
                    type="button"
                    className={`${t.btn} ${t.btnSm}`}
                    disabled={!c.enabled}
                    onClick={(e) => {
                      stop(e);
                      attach(c.kind);
                    }}
                    onKeyDown={stop}
                  >
                    <Icon name="upload" size={16} />
                    파일 첨부
                  </button>
                </div>
                {/* 2행 — 등록현황 · 오른쪽에 [양식받기](현금 경비만, 2026-11-08 대표 수정) */}
                <div className={`${t.kindCnt} ${t.kindCntRow}`}>
                  <span className={t.kindCntTxt}>
                    {c.enabled ? uploadCountLabel(c.kind, c.fileCount) : <span className={`${t.badge} ${t.bGray}`}>준비 중</span>}
                  </span>
                  {c.enabled && c.kind === KIND_CASH ? (
                    // [양식받기] — 마우스를 올리면 이 칸의 title 「표준양식 받기」가 보인다
                    <span onClick={stop} onKeyDown={stop} role="presentation" title="표준양식 받기" style={{ display: 'inline-flex' }}>
                      <ExcelDownloadButton
                        href={templateHref(c.kind)}
                        className={`${t.btn} ${t.tplBtn}`}
                        label="양식받기"
                        onError={setFailed}
                      />
                    </span>
                  ) : null}
                </div>
                <div className={t.kindDs} title={k?.description ?? ''}>
                  {k?.description ?? ' '}
                </div>
              </div>
            );
          })}
          {/* 개인 경비(전 삐용 경비) — 준비 중. 자료 종류 코드가 아니어서 고르기(목록 거르기)도 없다 */}
          <div className={`${t.card} ${t.kindCard} ${t.kindOff}`}>
            <div className={t.kindHead}>
              <span className={t.kindNm}>{PERSONAL_NAME}</span>
              <button type="button" className={`${t.btn} ${t.btnSm}`} disabled>
                <Icon name="rotate-ccw" size={16} />
                가져오기
              </button>
            </div>
            <div className={t.kindCnt}>
              <span className={`${t.badge} ${t.bGray}`}>준비 중</span>
            </div>
            <div className={t.kindDs} title={PERSONAL_DESC}>
              {PERSONAL_DESC}
            </div>
          </div>
        </div>
        <input
          ref={picker}
          type="file"
          accept=".xls,.xlsx"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (picked.length > 0 && pickKind.current) setModal({ kind: pickKind.current, files: picked });
          }}
        />
      </div>

      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      {/* ③ 올린 파일 — 목록만 스크롤 · 머리 줄 고정 */}
      {/* ★ 2026-11-08 — 작업 칸 150 → 190([보기] [삭제] 한 줄 + 오른쪽 여백). 파일 이름 칸이 남는 폭을 받고(넘치면 …),
       *   창이 좁아져 파일 이름 칸이 160 아래로 줄면 표가 줄지 않고 목록 안에서 옆으로 스크롤한다(버튼이 잘리지 않게, `tblUploads`) */}
      <div className={`${t.card} ${t.listCard}`}>
        <div className={t.listScroll}>
          <table className={`${t.tbl} ${t.tblSticky} ${t.tblUploads}`}>
            <colgroup>
              <col style={{ width: 150 }} />
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 64 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 190 }} />
            </colgroup>
            <thead>
              <tr>
                <th>구분</th>
                <th>기관 · 계좌</th>
                <th>파일 이름</th>
                <th className={t.num}>행수</th>
                <th>올린 시각</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td colSpan={6} className={t.empty}>
                    <TaxEmpty icon="upload" lead="아직 올린 파일이 없습니다" />
                  </td>
                </tr>
              ) : (
                files.map((f) => {
                  const viewHref = viewHrefOf(f.kind, month, f.id);
                  return (
                    <tr key={f.id}>
                      {/* 은행 파일은 파일 종류 코드 이름 하나만(「은행거래내역」 · 「은행이체내역」, 216) — 자료 종류와 이어 붙이지 않는다 */}
                      <td>{f.bankFileTp ? bankFileName(f.bankFileTp) : kindName(f.kind)}</td>
                      <td className={`${t.mut} ${t.ell}`}>
                        {f.account ? accountLabel(f.account) : f.social ? socialLabel(f.social) : dirName(f.direction)}
                      </td>
                      <td className={t.ell} title={f.fileName}>
                        {f.fileName}
                      </td>
                      <td className={t.num}>{won(f.insertedCount)}</td>
                      <td className={`${t.mut} ${t.tnum}`} style={{ whiteSpace: 'nowrap' }}>
                        {shortStamp(f.uploadedAt)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={t.row} style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <button
                            type="button"
                            className={`${t.btn} ${t.btnSm}`}
                            disabled={viewHref === null}
                            onClick={() => viewHref && router.push(viewHref)}
                          >
                            <Icon name="eye" size={16} />
                            보기
                          </button>
                          <button
                            type="button"
                            className={`${t.btn} ${t.btnSm} ${t.btnDanger}`}
                            onClick={() => void askDelete(f.id)}
                          >
                            <Icon name="trash-2" size={16} />
                            삭제
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal ? (
        <UploadModal
          month={month}
          kind={modal.kind}
          initialFiles={modal.files}
          data={data}
          onClose={() => setModal(null)}
          onUploaded={() => void reload()}
          onDone={(msg) => {
            setModal(null);
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
              {confirm.check.xferDetached > 0 ? ` 덧붙인 이체 정보 ${won(confirm.check.xferDetached)}줄도 지워집니다.` : ''}
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

/* ── 올리기 팝업(820px) — 파일마다 한 칸, [올리기] 한 번(④ 2026-11-07) ──────────────── */

interface ModalProps {
  month: string;
  kind: string;
  initialFiles: File[];
  data: TaxUploadsResponse;
  onClose: () => void;
  /** 몇 파일은 올렸고 몇 파일은 못 올렸을 때 — 창은 남기고 목록만 새로. */
  onUploaded: () => void;
  onDone: (toast: string) => void;
}

/** 팝업의 한 칸 — 은행이면 계좌 · 파일 종류도 그 칸에 있다. */
interface Item {
  key: number;
  file: File | null;
  mime: string | null;
  accountId: string;
  fileTp: string;
  state: 'idle' | 'loading' | 'ok' | 'error' | 'done';
  preview: TaxUploadPreview | null;
  error: string | null;
}

let itemSeq = 0;
const NOT_SPREADSHEET = '엑셀 파일(.xlsx · .xls)만 올릴 수 있습니다';

function newItem(file: File | null, accountId: string): Item {
  const mime = file ? spreadsheetMimeOf(file.name) : null;
  const bad = !!file && !mime;
  return {
    key: ++itemSeq,
    file,
    mime,
    accountId,
    fileTp: BANK_FILE_TXN,
    state: bad ? 'error' : 'idle',
    preview: null,
    error: bad ? NOT_SPREADSHEET : null,
  };
}

/** 미리보기상 올릴 수 있는가 — 같은 파일이 아니고 넣을 줄이 있다. */
const previewReady = (it: Item) => it.state === 'ok' && !!it.preview && !it.preview.sameFile && it.preview.toInsert > 0;

function UploadModal({ month, kind, initialFiles, data, onClose, onUploaded, onDone }: ModalProps) {
  const isBank = kind === KIND_BANK;
  const k = data.codes.kinds.find((x) => x.code === kind);
  const firstAccount = data.bankAccounts[0]?.id ?? '';
  const [items, setItems] = useState<Item[]>(() =>
    isBank ? (data.bankAccounts.length > 0 ? [newItem(null, firstAccount)] : []) : initialFiles.map((f) => newItem(f, '')),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bankName = (code: string) => data.codes.banks.find((b) => b.code === code)?.name ?? code;
  const accountOf = (it: Item) => data.bankAccounts.find((a) => a.id === it.accountId) ?? null;
  /** 그 은행에 이 파일 종류의 대응표가 있는가 — 없으면 [파일 고르기] 막힘 · 안내. */
  const bankOk = (it: Item) => {
    const a = accountOf(it);
    return !!a && a.fileTps.includes(it.fileTp);
  };
  const bankOf = (it: Item): BankChoice | null => (isBank ? { accountId: it.accountId, fileTp: it.fileTp } : null);

  /**
   * 이체 줄의 미리보기를 미루는가 — 같은 창에 같은 계좌 거래내역 줄이 있고(파일 고름) 그 줄이 올라갈 수 있을 때(확인 중 포함).
   * 짝 찾기는 그 계좌 거래내역이 DB 에 있어야 돈다 — 거래내역을 먼저 올린 뒤 서버가 짝을 찾는다.
   */
  const deferred = (it: Item, all: Item[]) =>
    isBank &&
    it.fileTp === BANK_FILE_XFER &&
    all.some(
      (o) =>
        o.key !== it.key &&
        o.file &&
        o.fileTp === BANK_FILE_TXN &&
        o.accountId === it.accountId &&
        (o.state === 'idle' || o.state === 'loading' || previewReady(o)),
    );
  const ready = (it: Item, all: Item[]) =>
    !!it.file && it.state !== 'done' && (isBank ? bankOk(it) : true) && (deferred(it, all) || previewReady(it));

  const patch = (key: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // 미리보기 — 파일을 고른 칸마다 한 번(미룬 이체 줄 · 대응표 없는 은행 줄은 빼고)
  useEffect(() => {
    for (const it of items) {
      if (it.state !== 'idle' || !it.file || !it.mime) continue;
      if (isBank && (!bankOk(it) || deferred(it, items))) continue;
      const { key, file, mime } = it;
      // 확인하는 동안 그 칸의 파일 · 계좌 · 파일 종류를 바꿨으면 늦게 온 결과는 버린다
      const settle = (p: Partial<Item>) =>
        setItems((xs) => xs.map((x) => (x.key === key && x.file === file && x.state === 'loading' ? { ...x, ...p } : x)));
      patch(key, { state: 'loading', error: null });
      previewUpload(kind, file, mime, bankOf(it))
        .then((preview) => settle({ state: 'ok', preview }))
        .catch((err: unknown) =>
          settle({ state: 'error', error: err instanceof TaxUploadError ? err.message : '파일을 확인하지 못했습니다' }),
        );
    }
  }, [items]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const live = items.filter((it) => it.state !== 'done');
  const readyItems = live.filter((it) => ready(it, items));
  const skipped = live.filter((it) => it.file && !ready(it, items) && it.state !== 'loading' && it.state !== 'idle').length;
  const checking = live.some((it) => it.state === 'loading');

  const doUpload = async () => {
    // 은행은 거래내역 먼저, 이체 내역 뒤(지금 규칙). 나머지는 고른 차례대로
    const queue = isBank
      ? [...readyItems.filter((it) => it.fileTp === BANK_FILE_TXN), ...readyItems.filter((it) => it.fileTp === BANK_FILE_XFER)]
      : readyItems;
    if (queue.length === 0) return;
    setBusy(true);
    setError(null);
    let done = 0;
    let rows = 0;
    let failedAny = false;
    for (const it of queue) {
      try {
        const r = await uploadFile(kind, it.file!, it.mime!, bankOf(it));
        done += 1;
        rows += r.insertedCount;
        patch(it.key, { state: 'done' });
      } catch (err) {
        failedAny = true;
        patch(it.key, { state: 'error', error: err instanceof TaxUploadError ? err.message : '올리지 못했습니다' });
      }
    }
    setBusy(false);
    const msg = `파일 ${done}개를 올렸습니다 · ${won(rows)}줄`;
    if (!failedAny) {
      onDone(msg);
      return;
    }
    if (done > 0) onUploaded();
    setError(done > 0 ? `${msg}. 못 올린 파일은 그 칸에 까닭이 있습니다` : '파일을 올리지 못했습니다. 그 칸의 까닭을 보세요');
  };

  return (
    <div
      className={t.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={`${t.modal} ${t.modalLg}`} role="dialog" aria-modal="true" aria-label="자료 올리기">
        <div className={t.mH}>
          <div>
            <h3>{k?.name ?? kind}</h3>
            {k?.description ? <p>{k.description}</p> : null}
          </div>
          <button type="button" className={t.iconBtn} aria-label="닫기" onClick={onClose} disabled={busy}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className={t.mB}>
          {isBank && data.bankAccounts.length === 0 ? (
            <div className={`${t.note} ${t.noteWarn}`}>
              <span>
                <Icon name="triangle-alert" size={16} />
              </span>
              <span>
                등록된 계좌가 없습니다 ·{' '}
                <Link href="/tax/settings" className={`${t.btn} ${t.btnLink}`}>
                  세무 설정에서 추가
                </Link>
              </span>
            </div>
          ) : null}

          {!isBank && items.length === 0 ? <p className={t.help}>올릴 파일이 없습니다</p> : null}

          {items.map((it) => (
            <FileItem
              key={it.key}
              item={it}
              month={month}
              data={data}
              isBank={isBank}
              deferred={deferred(it, items)}
              busy={busy}
              bankName={bankName}
              onChange={(p) => patch(it.key, p)}
              onRemove={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
            />
          ))}

          {isBank && data.bankAccounts.length > 0 ? (
            <div>
              <button
                type="button"
                className={`${t.btn} ${t.btnSm}`}
                disabled={busy}
                onClick={() => setItems((xs) => [...xs, newItem(null, firstAccount)])}
              >
                <Icon name="plus" size={16} />행 추가
              </button>
            </div>
          ) : null}

          {error ? <TaxFormErrorBanner kind="failed" message={error} /> : null}
        </div>

        <div className={t.mF}>
          <span className={t.sm}>
            {checking ? '파일을 확인하는 중…' : null}
            {!checking && skipped > 0 ? `못 올리는 파일 ${skipped}개는 빠집니다` : null}
          </span>
          <span className={t.sp} />
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button size="sm" variant="primary" disabled={busy || checking || readyItems.length === 0} onClick={doUpload}>
            {busy ? '올리는 중…' : readyItems.length > 0 ? `파일 ${readyItems.length}개 올리기` : '올리기'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── 팝업의 한 칸 — 은행이면 계좌 · 파일 종류 · 파일 한 줄, 아래에 그 파일의 미리보기 · 같은 파일 · 오류 ─────── */

interface FileItemProps {
  item: Item;
  month: string;
  data: TaxUploadsResponse;
  isBank: boolean;
  deferred: boolean;
  busy: boolean;
  bankName: (code: string) => string;
  onChange: (p: Partial<Item>) => void;
  onRemove: () => void;
}

function FileItem({ item: it, month, data, isBank, deferred, busy, bankName, onChange, onRemove }: FileItemProps) {
  const input = useRef<HTMLInputElement>(null);
  const account = data.bankAccounts.find((a) => a.id === it.accountId) ?? null;
  const mapOk = !isBank || (!!account && account.fileTps.includes(it.fileTp));
  const isXfer = isBank && it.fileTp === BANK_FILE_XFER;
  const done = it.state === 'done';
  const locked = busy || done;
  /** 계좌 · 파일 종류를 바꾸면 고른 파일은 비운다(지금 규칙). */
  const reset = { file: null, mime: null, state: 'idle' as const, preview: null, error: null };
  const p = !deferred && it.state === 'ok' ? it.preview : null;
  const same = p?.sameFile ?? null;

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const mime = spreadsheetMimeOf(file.name);
    onChange(
      mime
        ? { file, mime, state: 'idle', preview: null, error: null }
        : { file, mime: null, state: 'error', preview: null, error: NOT_SPREADSHEET },
    );
  };

  const removeBtn = (
    <button type="button" className={t.iconBtn} aria-label="이 줄 지우기" onClick={onRemove} disabled={busy}>
      <Icon name="x" size={16} />
    </button>
  );

  return (
    <div className={t.fileBlk}>
      {isBank ? (
        <div className={t.bankRow}>
          <select
            className={t.select}
            aria-label="계좌"
            value={it.accountId}
            disabled={locked}
            onChange={(e) => onChange({ accountId: e.target.value, ...reset })}
          >
            {data.bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.alias ? `${a.alias} · ` : ''}
                {bankName(a.bankCode)} {a.number}
              </option>
            ))}
          </select>
          <select
            className={t.select}
            aria-label="파일 종류"
            value={it.fileTp}
            disabled={locked}
            onChange={(e) => onChange({ fileTp: e.target.value, ...reset })}
          >
            {data.codes.bankFileTps.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </select>
          <span className={t.fileBlkH}>
            <button
              type="button"
              className={`${t.btn} ${t.btnSm}`}
              disabled={locked || !mapOk}
              onClick={() => input.current?.click()}
            >
              파일 고르기
            </button>
            <span className={`${t.sm} ${t.ell}`} title={it.file?.name ?? ''}>
              {it.file?.name ?? '고른 파일 없음'}
            </span>
          </span>
          {removeBtn}
          <input
            ref={input}
            type="file"
            accept=".xls,.xlsx"
            hidden
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      ) : (
        <div className={t.fileBlkH}>
          <Icon name="file-text" size={16} style={{ color: 'var(--text-caption)' }} />
          <b className={t.ell} style={{ flex: 1, minWidth: 0, fontSize: 14 }} title={it.file?.name ?? ''}>
            {it.file?.name}
          </b>
          {removeBtn}
        </div>
      )}

      {done ? (
        <div className={`${t.note} ${t.noteInfo}`}>
          <span>
            <Icon name="circle-check" size={16} />
          </span>
          <span>올렸습니다</span>
        </div>
      ) : null}

      {!done && isBank && account && !mapOk ? (
        <div className={`${t.note} ${t.noteWarn}`}>
          <span>
            <Icon name="triangle-alert" size={16} />
          </span>
          <span>
            {account.fileTps.length === 0
              ? `${bankName(account.bankCode)} 파일은 아직 받지 못합니다`
              : `${bankName(account.bankCode)}의 ${data.codes.bankFileTps.find((x) => x.code === it.fileTp)?.name ?? it.fileTp}은 아직 받지 못합니다`}
          </span>
        </div>
      ) : null}

      {!done && deferred && it.file ? (
        <div className={`${t.note} ${t.noteInfo}`}>
          <span>
            <Icon name="info" size={16} />
          </span>
          <span>같은 계좌의 거래내역을 먼저 올린 뒤 짝을 찾아 덧붙입니다 — 덧붙인 줄 수는 올린 뒤 알려 드립니다</span>
        </div>
      ) : null}

      {!done && !deferred && it.state === 'loading' ? <p className={t.help}>파일을 확인하는 중…</p> : null}
      {!done && !deferred && it.state === 'error' && it.error ? <TaxFormErrorBanner kind="failed" message={it.error} /> : null}

      {!done && same ? (
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

      {!done && p && !same ? <FilePreview preview={p} month={month} data={data} isXfer={isXfer} /> : null}
    </div>
  );
}

/* ── 한 파일의 미리보기 — 표준양식으로 바꾼 결과 · 넣을 줄 · 건너뛸 줄 · 뺀 줄 · 경고(지금 규칙 그대로) ─────── */

function FilePreview({ preview: p, month, data, isXfer }: { preview: TaxUploadPreview; month: string; data: TaxUploadsResponse; isXfer: boolean }) {
  /** 뺀 줄 수 — 종류 이름은 코드 표(TAX_SKIP_REASON), 코드값 = `excluded` 의 키. 0 인 종류는 안 보인다. */
  const excludedOf = (code: string): number => (p.excluded as unknown as Record<string, number>)[code] ?? 0;
  const skipped = p.skipReasons.filter((s) => excludedOf(s.code) > 0);
  return (
    <>
      <div className={t.between}>
        <div className={t.secT} style={{ fontSize: 15 }}>
          표준양식으로 바꾼 결과
        </div>
        <span className={t.row}>
          {p.direction ? (
            <span className={`${t.badge} ${t.bDone}`}>{data.codes.invDirs.find((d) => d.code === p.direction)?.name ?? p.direction}</span>
          ) : null}
          {p.kind === 'LOAN' ? (
            <span className={`${t.badge} ${t.bTodo}`}>
              {data.codes.banks.find((b) => b.code === p.bankCode)?.name ?? p.bankCode} · 대출 끝 {p.loanNoLast4}
            </span>
          ) : null}
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
        <PreviewTable
          preview={p}
          dirName={(code) => data.codes.invDirs.find((d) => d.code === code)?.name ?? code}
          codeName={(list, code) => data.codes[list].find((c) => c.code === code)?.name ?? code}
        />
      </div>

      <div className={t.note}>
        <span>
          <Icon name="info" size={16} />
        </span>
        <span>
          {isXfer ? '덧붙일 줄' : '넣을 줄'} <b>{won(p.toInsert)}</b>
          {' · '}
          {p.kind === 'INVOICE'
            ? '이미 올린 승인번호라'
            : PAY_KINDS.includes(p.kind)
              ? '이미 올린 납부번호라'
              : isXfer
                ? '이미 덧붙인 줄이라'
                : '이미 올린 줄이라'}{' '}
          건너뛸 줄 <b>{won(p.alreadyUploaded)}</b>
          {skipped.length > 0 ? ` · 뺀 줄 ${skipped.map((s) => `${s.name} ${won(excludedOf(s.code))}`).join(' · ')}` : ''}
          {p.toInsert === 0 ? ' · 넣을 줄이 없어 이 파일은 빠집니다' : ''}
          {/* 이미 올린 줄이 어디 있는지 — 서버가 정한 그대로(그 줄 날짜의 달 · 이미 올린 파일마다 한 줄) */}
          {p.alreadyWhere.map((w) => (
            <span key={`${w.month}|${w.fileName}`} className={t.sm} style={{ display: 'block' }}>
              {monthShort(w.month)} · {w.fileName} {won(w.count)}줄
            </span>
          ))}
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
  );
}

/* ── 미리보기 표 — 자료 종류마다 칸이 다르다(결과서 S05-02 9-4, 1-4) ─────────── */

const md = (date: string) => date.slice(5).replace('-', '.');

/** 이체 줄의 짝 상태 — 미리보기 「짝」 칸 글자. */
const XFER_STATUS: Record<'match' | 'none' | 'ambiguous' | 'already', string> = {
  match: '찾음',
  none: '못 찾음',
  ambiguous: '정할 수 없음',
  already: '이미 덧붙임',
};

function PreviewTable({
  preview: p,
  dirName,
  codeName,
}: {
  preview: TaxUploadPreview;
  dirName: (code: string) => string;
  codeName: (list: 'socialInsTps' | 'loanTps', code: string) => string;
}) {
  const more = (cols: number) => (
    <tr>
      <td colSpan={cols} className={t.sm} style={{ textAlign: 'center' }}>
        … 앞 5줄만 보여 줍니다
      </td>
    </tr>
  );
  if (p.kind === 'NTAX' || p.kind === 'LTAX') {
    // 비용 여부 = 코드 「비용이 아닌 세목」으로 서버가 정한 것(저장하지 않음, 1-6). 귀속은 지방세만(국세 파일은 비어 있다)
    return (
      <table className={t.tbl}>
        <colgroup>
          <col style={{ width: 80 }} />
          <col />
          <col style={{ width: 90 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 150 }} />
        </colgroup>
        <thead>
          <tr>
            <th>납부일</th>
            <th>세목</th>
            <th>비용</th>
            <th>귀속</th>
            <th className={t.num}>금액</th>
          </tr>
        </thead>
        <tbody>
          {p.sample.map((r, i) => (
            <tr key={i}>
              <td className={t.tnum}>{md(r.payDate)}</td>
              <td className={t.ell}>{r.taxItem}</td>
              <td className={r.expense ? '' : t.mut}>{r.expense ? '비용' : '비용 아님'}</td>
              <td className={`${t.mut} ${t.tnum}`}>{r.belongMonth ? monthShort(r.belongMonth) : '—'}</td>
              <td className={t.num}>
                {won(r.amount)}
                {r.penalty ? <span className={t.mut}> (가산금 {won(r.penalty)})</span> : null}
              </td>
            </tr>
          ))}
          {more(5)}
        </tbody>
      </table>
    );
  }
  if (p.kind === 'SOCIAL') {
    // ★ 주민번호는 없다 — 이름 · 가입자 번호 끝 4자리만. 금액은 파일 그대로(직원 · 회사 나눔은 직원 급여 단계)
    return (
      <table className={t.tbl}>
        <colgroup>
          <col />
          <col style={{ width: 110 }} />
          <col style={{ width: 140 }} />
        </colgroup>
        <thead>
          <tr>
            <th>가입자</th>
            <th>보험</th>
            <th className={t.num}>금액</th>
          </tr>
        </thead>
        <tbody>
          {p.sample.map((r, i) => (
            <tr key={i}>
              <td className={t.ell}>
                {r.memberName}
                {r.memberNoLast4 ? <span className={t.mut}> · 끝 {r.memberNoLast4}</span> : null}
              </td>
              <td className={t.mut}>{codeName('socialInsTps', r.insTp)}</td>
              <td className={t.num}>{won(r.noticeAmount)}</td>
            </tr>
          ))}
          {more(3)}
          {p.byInsTp.map((x) => (
            <tr key={x.insTp}>
              <td className={t.sm}>합계 · {won(x.count)}줄</td>
              <td>{codeName('socialInsTps', x.insTp)}</td>
              <td className={t.num}>
                <b>{won(x.amount)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (p.kind === 'LOAN') {
    // 이자만 비용 — 원금 · 이자 · 수수료를 나눠 보인다(이자 = 정상 + 연체 − 환출, 1-6 결정 13)
    return (
      <table className={t.tbl}>
        <colgroup>
          <col style={{ width: 80 }} />
          <col style={{ width: 70 }} />
          <col />
          <col />
          <col style={{ width: 90 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>거래일</th>
            <th>구분</th>
            <th className={t.num}>원금</th>
            <th className={t.num}>이자</th>
            <th className={t.num}>수수료</th>
            <th className={t.num}>잔액</th>
          </tr>
        </thead>
        <tbody>
          {p.sample.map((r, i) => (
            <tr key={i}>
              <td className={t.tnum}>{md(r.txnDate)}</td>
              <td className={t.mut} title={r.txnType ?? ''}>
                {codeName('loanTps', r.txnTp)}
              </td>
              <td className={t.num}>{r.principal ? won(r.principal) : ''}</td>
              <td className={t.num}>{r.interest ? won(r.interest) : ''}</td>
              <td className={t.num}>{r.fee ? won(r.fee) : ''}</td>
              <td className={t.num}>{won(r.balance)}</td>
            </tr>
          ))}
          {more(6)}
        </tbody>
      </table>
    );
  }
  if (p.kind === 'CARD') {
    // 홈택스 파일에는 결제일 · 적용월이 없다(1-4 「다르게 해야 할 곳」 1 · 2). ★ 카드는 끝 4자리만
    return (
      <table className={t.tbl}>
        <colgroup>
          <col style={{ width: 92 }} />
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 130 }} />
        </colgroup>
        <thead>
          <tr>
            <th>사용일자</th>
            <th>카드</th>
            <th>가맹점</th>
            <th className={t.num}>금액</th>
          </tr>
        </thead>
        <tbody>
          {p.sample.map((r, i) => (
            <tr key={i}>
              <td className={t.tnum}>{md(r.useDate)}</td>
              <td className={`${t.mut} ${t.tnum}`}>끝 {r.cardLast4}</td>
              <td className={t.ell}>{r.merchantName}</td>
              <td className={t.num}>{won(r.totalAmount)}</td>
            </tr>
          ))}
          {more(4)}
        </tbody>
      </table>
    );
  }
  if (p.kind === 'BANK' && p.bankFileTp === 'TXN') {
    // 입금 · 출금 두 칸(대표 결정 16). 내용 = 상대(없으면 적요)
    return (
      <table className={t.tbl}>
        <colgroup>
          <col style={{ width: 100 }} />
          <col />
          <col style={{ width: 120 }} />
          <col style={{ width: 120 }} />
        </colgroup>
        <thead>
          <tr>
            <th>거래일시</th>
            <th>내용</th>
            <th className={t.num}>입금</th>
            <th className={t.num}>출금</th>
          </tr>
        </thead>
        <tbody>
          {p.sample.map((r, i) => (
            <tr key={i}>
              <td className={t.tnum}>{shortDateTime(r.txnAt)}</td>
              <td className={t.ell}>{r.counterparty ?? r.description ?? ''}</td>
              <td className={t.num}>{r.inAmount > 0 ? won(r.inAmount) : ''}</td>
              <td className={t.num}>{r.outAmount > 0 ? won(r.outAmount) : ''}</td>
            </tr>
          ))}
          {more(4)}
        </tbody>
      </table>
    );
  }
  if (p.kind === 'BANK') {
    // 이체 — ★ 받는 계좌는 끝 4자리만. 짝 = 그 계좌 출금 줄(±60초 · 같은 금액)
    return (
      <table className={t.tbl}>
        <colgroup>
          <col style={{ width: 100 }} />
          <col />
          <col style={{ width: 120 }} />
          <col style={{ width: 110 }} />
        </colgroup>
        <thead>
          <tr>
            <th>이체일시</th>
            <th>받는분</th>
            <th className={t.num}>금액</th>
            <th>짝</th>
          </tr>
        </thead>
        <tbody>
          {p.sample.map((r, i) => (
            <tr key={i}>
              <td className={t.tnum}>{shortDateTime(r.xferAt)}</td>
              <td className={t.ell}>
                {r.holder}
                <span className={t.mut}>
                  {' '}
                  · {r.toBank} 끝 {r.toAccountLast4}
                </span>
              </td>
              <td className={t.num}>{won(r.amount)}</td>
              <td className={r.status === 'match' ? '' : t.mut}>{XFER_STATUS[r.status]}</td>
            </tr>
          ))}
          {more(4)}
        </tbody>
      </table>
    );
  }
  if (p.kind === 'CASH') {
    return (
      <table className={t.tbl}>
        <colgroup>
          <col style={{ width: 90 }} />
          <col />
          <col style={{ width: 70 }} />
          <col style={{ width: 140 }} />
        </colgroup>
        <thead>
          <tr>
            <th>날짜</th>
            <th>내용</th>
            <th>구분</th>
            <th className={t.num}>금액</th>
          </tr>
        </thead>
        <tbody>
          {p.sample.map((r, i) => (
            <tr key={i}>
              <td className={t.tnum}>{md(r.useDate)}</td>
              <td className={t.ell}>
                {r.description}
                {r.vendorName ? ` · ${r.vendorName}` : ''}
              </td>
              <td className={t.mut}>{dirName(r.direction)}</td>
              <td className={t.num}>{won(r.amount)}</td>
            </tr>
          ))}
          {more(4)}
        </tbody>
      </table>
    );
  }
  return (
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
            <td className={t.tnum}>{md(r.writeDate)}</td>
            <td>{r.partnerName}</td>
            <td className={t.num}>{won(r.totalAmount)}</td>
          </tr>
        ))}
        {more(3)}
      </tbody>
    </table>
  );
}
