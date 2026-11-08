'use client';

/**
 * 세무사 전달 서류(s050500010) 본문 — 1-9 (2026-11-07) · 2026-11-08 대표 수정 ⑧.
 *
 *   ⑧ 거래처 · 항목 지정 · 부가세 조회의 꼴 — 검색조건 / 버튼 / 목록 세 영역, 목록만 스크롤 · 머리 줄 고정:
 *   ① 검색조건 — 종류 · 신고 기간 선택 상자(지금 그대로)
 *   ② 버튼 — 왼쪽 [메일 보내기] + 「최종 발송 YYYY-MM-DD HH:mm」 / 「미발송」(고른 종류 · 신고 기간), 오른쪽 [엑셀 내려받기].
 *      메일 발송 설정(SMTP)이 없으면 [메일 보내기]를 막고 막힘 안내 한 줄
 *   ③ 목록 — 시트 아홉 탭(한 줄 — 간격 · 글자만 줄임) · 맨 앞 「No」 칸(화면 순번, 엑셀에는 없다) ·
 *      목록 아래 미지정이 있을 때만 「미지정 항목이 있으니 확인하시기 바랍니다.」 + [항목지정](가장 이른 달 · 「미지정」)
 *   팝업 「메일 보내기」(480px 팝업 틀) — 발송인(보기만) · 참조(서버가 정함) · 수신인(체크) · 제목 · 내용(고칠 수 있게) · 첨부파일(보기만)
 * ★ 지운 것(⑧): 「보내기 전 확인」 · 「받는 사람」 · 「메일」 영역 · 보낸 이력 표 · 보내기 확인 창 · 설명 문구.
 *
 * ★ 종류는 T 부가세 납부만 — M 원천세 납부는 선택 상자에서 막고 「준비 중」으로 적는다(인사 시스템 뒤).
 * ★ 신고 기간은 부가세 조회와 같은 선택 상자 — 고르면 주소 `?month=` 가 그 기간 끝 달로 바뀐다.
 * ★ 시트 · 제목 · 내용 처음 값 · 파일 이름 · 참조는 서버가 정한 것만 그린다. 메일도 서버가 엑셀을 만들어 첨부해 보낸다.
 * ★ 받는 사람은 세무 설정의 세무사 메일 — 이 화면에서 고치지 않는다.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { thisMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { TAX_CLS_LEFT } from '@swonbiz/shared/domain/tax-classify';
import { vatPeriodMonth } from '@swonbiz/shared/domain/tax-vat';
import { HANDOFF_SUBJECT_MAX, HANDOFF_TEXT_MAX, type HandoffCell, type HandoffSheetKey } from '@swonbiz/shared/domain/tax-handoff';
import { Icon, type IconName } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxEmpty } from '../common/TaxEmpty';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import { won } from '../uploads/tax-uploads-model';
import {
  TaxHandoffError,
  exportHref,
  lastSentLabel,
  loadHandoff,
  sendHandoff,
  type HandoffLastView,
  type TaxHandoffResponse,
} from './tax-handoff-model';

const NO_MAIL = '메일 발송 설정이 아직 없습니다 — 엑셀을 내려받아 보내 주세요';
const SELECT_STYLE = { height: 32, width: 'auto' } as const;

const cellText = (v: HandoffCell) => (typeof v === 'number' ? won(v) : (v ?? ''));

export function TaxHandoffView({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { message: toast, notify } = useTaxToast();
  const [data, setData] = useState<TaxHandoffResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<HandoffSheetKey>('P');
  const [mailOpen, setMailOpen] = useState(false);

  const reload = useCallback(
    () =>
      loadHandoff({ month, tp: 'T', periodId: null })
        .then((d) => {
          setData(d);
          setLoadError(null);
        })
        .catch((err: unknown) => setLoadError(err instanceof TaxHandoffError ? err.message : '세무사 전달 서류를 불러오지 못했습니다')),
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

  const { period } = data;
  const now = thisMonthOf(new Date());
  const picker = (
    <span className={t.row} style={{ gap: 8, flexWrap: 'nowrap' }}>
      <select className={t.select} style={SELECT_STYLE} value={data.query.tp} aria-label="전달 종류" onChange={() => undefined}>
        {data.tps.map((x) => (
          <option key={x.code} value={x.code} disabled={!x.ready}>
            {x.ready ? x.name : `${x.name} — 준비 중`}
          </option>
        ))}
      </select>
      {period ? (
        <select
          className={t.select}
          style={SELECT_STYLE}
          value={period.id}
          aria-label="신고 기간"
          onChange={(e) => {
            const p = data.periods.find((x) => x.id === e.target.value);
            if (!p) return;
            setFailed(null);
            router.push(`${pathname}?month=${vatPeriodMonth(p, now)}`);
          }}
        >
          {data.periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.option}
            </option>
          ))}
        </select>
      ) : null}
    </span>
  );
  const search = (
    <div className={`${t.card} ${t.secLow}`}>
      <TaxMonthBar month={month} picker={picker} note={null} />
    </div>
  );

  if (!period) {
    return (
      <div className={t.page}>
        {search}
        <div className={t.note}>
          <span>
            <Icon name="info" size={16} />
          </span>
          <span style={{ flex: 1 }}>세무 설정에서 사업자 유형을 먼저 고르세요 — 사업자 유형에 따라 신고 기간이 다릅니다.</span>
          <Link href="/tax/settings" className={`${t.btn} ${t.btnSm}`}>
            <Icon name="settings" size={16} />
            세무 설정
          </Link>
        </div>
      </div>
    );
  }

  const sheet = data.sheets.find((s) => s.key === tab) ?? data.sheets[0];

  return (
    <div className={`${t.page} ${t.pageFill}`}>
      {/* ① 검색조건 */}
      {search}

      {/* ② 버튼 */}
      <div className={`${t.tbar} ${t.tbarOut}`}>
        <button type="button" className={`${t.btn} ${t.btnSm} ${t.btnPrimary}`} disabled={!data.mailReady} onClick={() => setMailOpen(true)}>
          <Icon name="mail" size={16} />
          메일 보내기
        </button>
        <span className={t.help}>{lastSentLabel(data.last)}</span>
        {data.mailReady ? null : <span className={t.help}>{NO_MAIL}</span>}
        <span className={t.sp} />
        <ExcelDownloadButton href={exportHref(data.query)} className={`${t.btn} ${t.btnSm}`} onError={setFailed} />
      </div>
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      {/* ③ 목록 — 시트 아홉 탭 · 목록만 스크롤 · 머리 줄 고정 */}
      <div className={`${t.card} ${t.listCard}`}>
        <div className={`${t.tabs} ${t.tabsFit}`} role="tablist">
          {data.sheets.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={sheet?.key === s.key}
              className={`${t.tab} ${sheet?.key === s.key ? t.tabOn : ''}`}
              onClick={() => setTab(s.key)}
            >
              {s.name} ({won(s.rows.length)})
            </button>
          ))}
        </div>
        {sheet ? (
          <div className={t.listScroll}>
            <table className={`${t.tbl} ${t.tblSticky}`} style={{ tableLayout: 'auto' }}>
              <thead>
                <tr>
                  <th className={t.num} style={{ width: 56 }}>
                    No
                  </th>
                  {sheet.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.length === 0 ? (
                  <tr>
                    <td colSpan={sheet.columns.length + 1} className={t.empty}>
                      <TaxEmpty icon="mail" lead={`${data.rangeLabel} ${sheet.name} 자료가 없습니다`} />
                    </td>
                  </tr>
                ) : (
                  sheet.rows.map((r, i) => (
                    <tr key={i}>
                      <td className={t.num}>{i + 1}</td>
                      {r.map((v, j) => (
                        <td key={j} className={typeof v === 'number' ? t.num : undefined} style={{ whiteSpace: 'nowrap' }}>
                          {cellText(v)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        {data.unassignedCount > 0 && data.unassignedFirstMonth ? (
          <div className={t.tbar} style={{ color: 'var(--color-danger)', fontSize: 13 }}>
            미지정 항목이 있으니 확인하시기 바랍니다.
            <Link href={`/tax/classify?month=${data.unassignedFirstMonth}&status=${TAX_CLS_LEFT}`} className={`${t.btn} ${t.btnSm}`}>
              항목지정
            </Link>
          </div>
        ) : null}
      </div>

      {mailOpen ? (
        <SendMailModal
          data={data}
          periodId={period.id}
          onClose={() => setMailOpen(false)}
          onSent={(last) => {
            setMailOpen(false);
            setData((d) => (d ? { ...d, last } : d));
            notify('메일을 보냈습니다');
          }}
        />
      ) : null}
      <TaxToast message={toast} />
    </div>
  );
}

/* ── 팝업 — 메일 보내기(480px 팝업 틀, 거래처 수정과 같은 모양) ─────────────── */

type Warn = 'noRecipient' | 'noChoice' | null;

function SendMailModal({
  data,
  periodId,
  onClose,
  onSent,
}: {
  data: TaxHandoffResponse;
  periodId: string;
  onClose: () => void;
  onSent: (last: HandoffLastView) => void;
}) {
  const [to, setTo] = useState<string[]>(() => data.recipients.map((r) => r.email));
  const [subject, setSubject] = useState(data.subject ?? '');
  const [text, setText] = useState(data.mailText ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<Warn>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending && warn === null) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, sending, warn]);

  const send = async () => {
    if (data.recipients.length === 0) return setWarn('noRecipient');
    if (to.length === 0) return setWarn('noChoice');
    setSending(true);
    setError(null);
    try {
      const r = await sendHandoff({ ...data.query, periodId }, { to, subject, text });
      if (r.ok) onSent(r.last);
      else setError(r.message);
    } catch (err) {
      setError(err instanceof TaxHandoffError ? err.message : '메일을 보내지 못했습니다');
    } finally {
      setSending(false);
    }
  };

  const rows = data.sheets.reduce((n, s) => n + s.rows.length, 0);
  const person = (p: { name: string | null; email: string | null }) => [p.name, p.email].filter(Boolean).join(' · ') || '—';

  return (
    <div
      className={t.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className={`${t.modal} ${t.modalSmW}`} role="dialog" aria-modal="true" aria-label="메일 보내기">
        <div className={t.mH}>
          <h3>메일 보내기</h3>
          <button type="button" className={t.iconBtn} aria-label="닫기" disabled={sending} onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className={t.mB}>
          {error ? <TaxFormErrorBanner kind="failed" message={error} /> : null}
          <div className={t.field}>
            <span className={t.lab}>발송인</span>
            <span>{person(data.sender)}</span>
            {data.cc ? <span className={t.sm}>참조: {person(data.cc)}</span> : null}
          </div>
          <div className={t.field}>
            <span className={t.lab}>수신인</span>
            {data.recipients.length === 0 ? (
              <span className={t.sm}>—</span>
            ) : (
              data.recipients.map((r) => (
                <label key={r.email} className={t.chk}>
                  <input
                    type="checkbox"
                    checked={to.includes(r.email)}
                    disabled={sending}
                    onChange={(e) => setTo((cur) => (e.target.checked ? [...cur, r.email] : cur.filter((x) => x !== r.email)))}
                  />
                  <span>
                    {r.name ? <b>{r.name} </b> : null}
                    <span className={t.sm}>{r.email}</span>
                  </span>
                </label>
              ))
            )}
          </div>
          <label className={t.field}>
            <span className={t.lab}>제목</span>
            <input
              className={t.input}
              value={subject}
              maxLength={HANDOFF_SUBJECT_MAX}
              disabled={sending}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className={t.field}>
            <span className={t.lab}>내용</span>
            <textarea
              className={t.input}
              style={{ height: 'auto', padding: '10px 12px', lineHeight: 1.6, resize: 'vertical' }}
              rows={5}
              value={text}
              maxLength={HANDOFF_TEXT_MAX}
              disabled={sending}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className={t.field}>
            <span className={t.lab}>첨부파일</span>
            <span>
              {data.fileName}{' '}
              <span className={t.sm}>
                (시트 {data.sheets.length}개 · {won(rows)}줄)
              </span>
            </span>
          </div>
        </div>
        <div className={t.mF}>
          <span className={t.sp} />
          <button type="button" className={t.btn} disabled={sending} onClick={onClose}>
            취소
          </button>
          <button type="button" className={`${t.btn} ${t.btnPrimary}`} disabled={sending} onClick={() => void send()}>
            {sending ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </div>

      {warn === 'noRecipient' ? (
        <WarnDialog
          icon="triangle-alert"
          title="세무 설정에서 세무사를 먼저 등록하세요"
          okLabel="세무 설정"
          okHref="/tax/settings"
          onCancel={() => setWarn(null)}
        />
      ) : warn === 'noChoice' ? (
        <WarnDialog icon="triangle-alert" title="받는 사람을 한 명 이상 선택하세요" onCancel={() => setWarn(null)} />
      ) : null}
    </div>
  );
}

/** 경고 창 — 세무 확인 창(480px, `TaxConfirmDialog`)과 같은 모양. [세무 설정]이 있으면 둘, 없으면 [확인] 하나. */
function WarnDialog({
  icon,
  title,
  okLabel,
  okHref,
  onCancel,
}: {
  icon: IconName;
  title: string;
  okLabel?: string;
  okHref?: string;
  onCancel: () => void;
}) {
  const nav = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      className={t.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={t.modalSm} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={t.confirm}>
          <div className={`${t.confirmIc} ${t.confirmIcRed}`}>
            <Icon name={icon} size={24} />
          </div>
          <h3>{title}</h3>
        </div>
        <div className={t.confirmF} style={okHref ? undefined : { gridTemplateColumns: '1fr' }}>
          {okHref ? (
            <>
              <button type="button" className={t.btn} onClick={onCancel}>
                돌아가기
              </button>
              <button type="button" className={`${t.btn} ${t.btnPrimary}`} onClick={() => nav.push(okHref)} autoFocus>
                {okLabel}
              </button>
            </>
          ) : (
            <button type="button" className={`${t.btn} ${t.btnPrimary}`} onClick={onCancel} autoFocus>
              확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
