'use client';

/**
 * 세무사 전달 서류(s050500010) 본문 — 1-9 (2026-11-07 대표 지시 「답변 · 변경」). 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js`
 * 의 S05-10 · 결과서 S05-10 을 지시대로 바꾼 것.
 *
 *   맨 위 줄(종류 선택 상자 · 신고 기간 선택 상자) · 「보내기 전 확인」(미지정 N줄 + [항목지정]) ·
 *   시트 아홉 탭(이름 옆 건수) + 표 미리보기(읽기만) · 2열(받는 사람 | 메일 제목 · 첨부) ·
 *   보내기 줄([메일 보내기] + 확인 창 · [엑셀 내려받기] · 안내) · 보낸 이력 표
 *
 * ★ 종류는 T 부가세 납부만 — M 원천세 납부는 선택 상자에서 막고 「준비 중」으로 적는다(인사 시스템 뒤).
 * ★ 신고 기간은 부가세 조회와 같은 선택 상자 — 고르면 주소 `?month=` 가 그 기간 끝 달로 바뀐다.
 * ★ 시트 · 제목 · 파일 이름은 서버가 정한 것만 그린다. 메일도 서버가 엑셀을 만들어 첨부해 보낸다.
 * ★ [메일 보내기]는 받는 사람이 0명이거나 메일 발송 설정이 없으면 막는다. [엑셀 내려받기]는 늘 된다.
 * ★ 받는 사람은 세무 설정의 세무사 메일 — 이 화면에서 고치지 않는다(「세무 설정에서 바꾸기」 링크).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { thisMonthOf } from '@swonbiz/shared/domain/tax-uploads';
import { vatPeriodMonth } from '@swonbiz/shared/domain/tax-vat';
import { handoffLogPeriodLabel, type HandoffCell, type HandoffSheetKey } from '@swonbiz/shared/domain/tax-handoff';
import { Button, Icon } from '@/components/ds';
import { ExcelDownloadButton } from '@/components/patterns/ExcelDownloadButton';
import t from '../common/tax.module.css';
import { TaxEmpty } from '../common/TaxEmpty';
import { TaxConfirmDialog } from '../common/TaxConfirmDialog';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxMonthBar } from '../common/TaxMonthBar';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import { won } from '../uploads/tax-uploads-model';
import { TaxHandoffError, exportHref, loadHandoff, sendHandoff, type TaxHandoffResponse } from './tax-handoff-model';

const NO_RECIPIENT = '세무 설정에서 세무사 메일을 먼저 넣으세요';
const NO_MAIL = '메일 발송 설정이 아직 없습니다 — 엑셀을 내려받아 보내 주세요';

const cellText = (v: HandoffCell) => (typeof v === 'number' ? won(v) : (v ?? ''));

export function TaxHandoffView({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { message: toast, notify } = useTaxToast();
  const [data, setData] = useState<TaxHandoffResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<HandoffSheetKey>('P');
  const [to, setTo] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);

  const reload = useCallback(
    () =>
      loadHandoff({ month, tp: 'T', periodId: null })
        .then((d) => {
          setData(d);
          setLoadError(null);
          // 처음엔 세무 설정의 메일 모두 체크 — 다시 불러와도 고른 것은 남기되 설정에 없는 것은 뺀다
          setTo((prev) => (prev === null ? d.recipients.map((r) => r.email) : prev.filter((e) => d.recipients.some((r) => r.email === e))));
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
  const tpPicker = (
    <select className={t.select} style={{ height: 32, width: 'auto' }} value={data.query.tp} aria-label="전달 종류" onChange={() => undefined}>
      {data.tps.map((x) => (
        <option key={x.code} value={x.code} disabled={!x.ready}>
          {x.ready ? x.name : `${x.name} — 준비 중`}
        </option>
      ))}
    </select>
  );
  const periodPicker = period ? (
    <select
      className={t.select}
      style={{ height: 32, width: 'auto' }}
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
  ) : null;
  const picker = (
    <span className={t.row} style={{ gap: 8, flexWrap: 'nowrap' }}>
      {tpPicker}
      {periodPicker}
    </span>
  );

  if (!period) {
    return (
      <div className={t.page}>
        <TaxMonthBar month={month} picker={picker} note={null} />
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

  const chosen = to ?? [];
  const sheet = data.sheets.find((s) => s.key === tab) ?? data.sheets[0];
  const noRecipient = data.recipients.length === 0;
  const blockedWhy = noRecipient ? NO_RECIPIENT : !data.mailReady ? NO_MAIL : chosen.length === 0 ? '받는 사람을 한 명 이상 고르세요' : null;
  const query = data.query;

  const send = async () => {
    setAsking(false);
    setSending(true);
    setFailed(null);
    try {
      const r = await sendHandoff({ ...query, periodId: period.id }, chosen);
      if (r.ok) notify('세무사에게 보냈습니다');
      else setFailed(r.message ?? '메일을 보내지 못했습니다');
    } catch (err) {
      setFailed(err instanceof TaxHandoffError ? err.message : '메일을 보내지 못했습니다');
    } finally {
      setSending(false);
      void reload();
    }
  };

  return (
    <div className={t.page}>
      <TaxMonthBar month={month} picker={picker} note={null} />
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.between}>
          <div className={t.secT}>보내기 전 확인</div>
          {data.unassignedCount > 0 ? (
            <span className={`${t.badge} ${t.bDoing}`}>남은 일 1</span>
          ) : (
            <span className={`${t.badge} ${t.bDone}`}>모두 끝남</span>
          )}
        </div>
        {data.unassignedCount > 0 ? (
          <>
            <p className={t.help} style={{ marginTop: 8 }}>
              남은 일이 있어도 보낼 수 있습니다. 남은 건수는 메일 본문에 적힙니다.
            </p>
            <div className={t.row} style={{ marginTop: 10 }}>
              <span className={`${t.badge} ${t.bTodo}`}>미지정 {won(data.unassignedCount)}줄</span>
              <Link href={`/tax/classify?month=${month}`} className={`${t.btn} ${t.btnSm}`}>
                항목지정
              </Link>
            </div>
          </>
        ) : (
          <p className={t.help} style={{ marginTop: 8 }}>
            {data.rangeLabel} 매입 · 카드 · 현금 경비에 항목이 모두 붙어 있습니다.
          </p>
        )}
      </div>

      <div className={t.card}>
        <div className={t.tabs} role="tablist" style={{ padding: '0 16px' }}>
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
          <div style={{ overflowX: 'auto' }}>
            <table className={t.tbl} style={{ tableLayout: 'auto' }}>
              <thead>
                <tr>
                  {sheet.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.length === 0 ? (
                  <tr>
                    <td colSpan={sheet.columns.length} className={t.empty}>
                      <TaxEmpty icon="mail" lead={`${data.rangeLabel} ${sheet.name} 자료가 없습니다`} />
                    </td>
                  </tr>
                ) : (
                  sheet.rows.map((r, i) => (
                    <tr key={i}>
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
      </div>

      <div className={t.grid2}>
        <div className={`${t.card} ${t.cardPad}`}>
          <div className={t.between}>
            <div className={t.secT}>받는 사람</div>
            <Link href="/tax/settings" className={`${t.btn} ${t.btnLink}`} style={{ fontSize: 13 }}>
              세무 설정에서 바꾸기
            </Link>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {noRecipient ? (
              <span className={t.sm}>{NO_RECIPIENT}</span>
            ) : (
              data.recipients.map((r) => (
                <label key={r.email} className={t.chk}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(r.email)}
                    onChange={(e) =>
                      setTo((prev) => {
                        const cur = prev ?? [];
                        return e.target.checked ? [...cur, r.email] : cur.filter((x) => x !== r.email);
                      })
                    }
                  />
                  <span>
                    {r.name ? <b>{r.name} </b> : null}
                    <span className={t.sm}>{r.email}</span>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
        <div className={`${t.card} ${t.cardPad}`}>
          <div className={t.secT}>메일</div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: 'var(--text-heading)' }}>
            <div>
              <span className={t.sm}>제목</span> <b>{data.subject}</b>
            </div>
            <div>
              <span className={t.sm}>첨부</span> {data.fileName}{' '}
              <span className={t.sm}>
                (시트 {data.sheets.length}개 · {won(data.sheets.reduce((n, s) => n + s.rows.length, 0))}줄)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={t.row} style={{ gap: 12 }}>
        <Button size="sm" variant="primary" disabled={blockedWhy !== null || sending} onClick={() => setAsking(true)}>
          <Icon name="mail" size={16} />
          {sending ? '보내는 중…' : '메일 보내기'}
        </Button>
        <ExcelDownloadButton href={exportHref(query)} className={t.btn} onError={setFailed} />
        {blockedWhy ? <span className={t.help}>{blockedWhy}</span> : null}
      </div>

      <div className={t.card}>
        <div className={`${t.cardPad} ${t.cardH}`} style={{ paddingBottom: 12 }}>
          <h2>보낸 이력</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className={t.tbl} style={{ borderTop: '1px solid var(--border)', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th>보낸 때</th>
                <th>종류</th>
                <th>기간</th>
                <th>받는 사람</th>
                <th>파일 이름</th>
                <th className={t.num}>줄 수</th>
                <th>결과</th>
                <th>보낸 사람</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className={t.empty}>
                    <TaxEmpty icon="mail" lead="아직 보내지 않았습니다" />
                  </td>
                </tr>
              ) : (
                data.logs.map((l) => (
                  <tr key={l.id}>
                    <td className={t.num} style={{ textAlign: 'left' }}>
                      {l.sentAt}
                    </td>
                    <td className={t.mut}>{data.tps.find((x) => x.code === l.tp)?.name ?? l.tp}</td>
                    <td className={t.mut}>{handoffLogPeriodLabel(l.periodFrom, l.periodTo)}</td>
                    <td>{l.recipients.join(', ')}</td>
                    <td className={t.mut}>{l.fileName}</td>
                    <td className={t.num}>{won(l.rowCount)}</td>
                    <td>
                      {l.ok ? (
                        <span className={`${t.badge} ${t.bDone}`}>성공</span>
                      ) : (
                        <span title={l.failReason ?? ''}>
                          <span className={`${t.badge} ${t.bDoing}`}>실패</span> <span className={t.sm}>{l.failReason}</span>
                        </span>
                      )}
                    </td>
                    <td className={t.mut}>{l.sentByName ?? l.sentBy}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {asking ? (
        <TaxConfirmDialog
          icon="mail"
          title="세무사에게 보내시겠습니까?"
          okLabel="보내기"
          body={
            <>
              {chosen.length}명에게 {period.option} 부가세 신고 자료를 보냅니다.
              {data.unassignedCount > 0 ? (
                <>
                  <br />
                  남은 일(미지정 {won(data.unassignedCount)}줄)은 메일 본문에 적힙니다.
                </>
              ) : null}
            </>
          }
          onCancel={() => setAsking(false)}
          onOk={() => void send()}
        />
      ) : null}
      <TaxToast message={toast} />
    </div>
  );
}
