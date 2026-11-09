'use client';

/**
 * 내 청구서 — 보기 전용 (/billing/mine · s030200090) · 앱 1단계 7-나 (대표 지시 2026-11-08)
 *
 * =============================================================================
 * ★★ 보기 전용이다 — 청구 · 수납 처리는 운영사 /billing 한 곳뿐 (CLAUDE.md 「한 업무는 한 화면에서」)
 * =============================================================================
 * 위에서부터 : 미납 안내 띠(있을 때) · 「XX월 납부 안내」 카드(청구 · 남은 금액 · 기한 · 입금 계좌 [계좌 복사]) ·
 * 지난 12개월 납부 내역. 카드 결제는 2단계다.
 *
 * ★ 판정 · 합계 · 달별 묶음 · 띠 조건은 shared `domain/my-invoices` 하나다(그 안에서 `displayInvoiceStatus` ·
 *   `summarizeInvoices` 를 그대로 부른다). 상태 이름표 · 뱃지 색은 청구 화면의 것(`STATUS_LABEL` · `.st_*`)이다.
 * ★ 회사 거르기는 서버가 한다 — `GET /my/invoices` 는 입주사 세션만 · RLS 로 자기 회사 것만 온다.
 * ★ 데이터는 클라이언트가 받는다 — 「이번 달」 · 「지금」을 보는 사람의 시각으로 정한다(예약 화면과 같다).
 * ★ 연락처는 shared `CONTRACT_OFFICE` 다. 입금 계좌는 `GET /my/invoices` 응답의 `depositAccount`
 *   (서버가 공통 코드 `DEPOSIT_ACCT` 를 읽는다 — 계약서 · 정산서와 같은 값, 2026-11-09). 없으면
 *   `DEPOSIT_ACCOUNT_MISSING` 을 보이고 [계좌 복사] 를 감춘다.
 * ★ [계좌 복사] — 앱 웹뷰는 http 로 ERP 를 열어 `navigator.clipboard` 가 없다. 랜딩 「위치」의 복사와 같이
 *   숨은 textarea + `execCommand('copy')` 로 떨어진다. 실패하면 「복사되었습니다」라고 말하지 않는다.
 * ★ 전화 · 메일 링크(`tel:` · `mailto:`)는 앱 웹뷰가 폰으로 넘긴다(5-나 허용 목록).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CONTRACT_OFFICE } from '@swonbiz/shared';
import { DEPOSIT_ACCOUNT_MISSING, type DepositAccount } from '@swonbiz/shared/domain/deposit-account';
import {
  accountNumberOf,
  myInvoicesRange,
  paymentHistory,
  showUnpaidNotice,
  thisMonthCard,
  yearMonthOf,
  type MyInvoice,
} from '@swonbiz/shared/domain/my-invoices';
import { Icon } from '@/components/ds';
import { STATUS_LABEL, STATUS_ORDER, dotDate, won } from './billing-model';
import billing from './billing.module.css';
import styles from './my-invoices.module.css';

const TEL_HREF = `tel:${CONTRACT_OFFICE.TEL}`;
const MAIL_HREF = `mailto:${CONTRACT_OFFICE.EMAIL}`;

export function MyInvoicesView() {
  const [items, setItems] = useState<MyInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** `undefined` = 읽는 중 · `null` = 설정되지 않음(또는 읽기 실패) — 정산서와 같은 뜻. */
  const [account, setAccount] = useState<DepositAccount | null | undefined>(undefined);
  // 「지금」은 처음 그릴 때 한 번 정한다 — 화면을 보는 사이 날이 바뀌어도 숫자가 흔들리지 않게.
  const [asOf] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    const { from, to } = myInvoicesRange(yearMonthOf(asOf));
    fetch(`/api/my/invoices?from=${from}&to=${to}`)
      .then(async (res) => {
        const body = (await res.json()) as {
          invoices?: MyInvoice[];
          depositAccount?: DepositAccount | null;
          message?: string;
        };
        if (!res.ok) throw new Error(body.message ?? '청구서를 불러오지 못했습니다');
        if (!alive) return;
        setItems(body.invoices ?? []);
        setAccount(body.depositAccount ?? null);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setItems([]);
        setAccount(null);
        setError(e.message || '청구서를 불러오지 못했습니다');
      });
    return () => {
      alive = false;
    };
  }, [asOf]);

  const card = useMemo(() => (items ? thisMonthCard(items, asOf) : null), [items, asOf]);
  const history = useMemo(() => (items ? paymentHistory(items, asOf, STATUS_ORDER) : []), [items, asOf]);
  const notice = useMemo(() => (items ? showUnpaidNotice(items, asOf) : false), [items, asOf]);
  const monthLabel = `${asOf.getMonth() + 1}월`;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>내 청구서</h1>
        <p className={styles.sub}>
          {items === null ? '불러오는 중입니다' : error ? error : '우리 회사 청구와 납부 내역입니다'}
        </p>
      </div>

      {notice ? (
        <div className={styles.notice} role="alert" data-unpaid-notice="1">
          <Icon name="circle-alert" size={20} />
          <div className={styles.noticeBody}>
            <p className={styles.noticeLead}>납부 기한이 지난 청구가 있습니다. 운영사에 연락해 주세요</p>
            <p className={styles.noticeLinks}>
              <a href={TEL_HREF} className={styles.noticeLink}>
                <Icon name="phone" size={16} />
                {CONTRACT_OFFICE.TEL}
              </a>
              <a href={MAIL_HREF} className={styles.noticeLink}>
                <Icon name="mail" size={16} />
                {CONTRACT_OFFICE.EMAIL}
              </a>
            </p>
          </div>
        </div>
      ) : null}

      <section className={styles.card} aria-label={`${card?.monthLabel ?? monthLabel} 납부 안내`}>
        <h2 className={styles.cardTitle}>{card?.monthLabel ?? monthLabel} 납부 안내</h2>
        {items === null ? (
          <p className={styles.cardEmpty}>불러오는 중입니다</p>
        ) : error ? (
          <p className={styles.cardEmpty}>{error}</p>
        ) : card === null ? (
          <p className={styles.cardEmpty}>이번 달 청구가 없습니다</p>
        ) : (
          <>
            <dl className={styles.figures}>
              <div>
                <dt>청구 금액</dt>
                <dd>{won(card.total)}</dd>
              </div>
              <div>
                <dt>남은 금액</dt>
                <dd className={card.paidUp ? undefined : styles.figureStrong}>{won(card.outstanding)}</dd>
              </div>
              <div>
                <dt>납부 기한</dt>
                <dd>{card.dueDate ? dotDate(card.dueDate) : '납부 완료'}</dd>
              </div>
            </dl>
            {card.lines.length > 1 ? (
              <ul className={styles.lines}>
                {card.lines.map((l) => (
                  <li key={l.invoiceId} className={styles.line}>
                    <span className={styles.lineDue}>{dotDate(l.dueDate)} 기한</span>
                    <span className={styles.lineAmount}>{won(l.totalAmount)}</span>
                    <span className={`${billing.badge} ${billing[`st_${l.status}`]}`}>{STATUS_LABEL[l.status]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <Account account={account} />
      </section>

      <section className={styles.panel} aria-label="납부 내역">
        <h2 className={styles.panelTitle}>납부 내역 (지난 12개월)</h2>
        {items === null || error ? null : history.length === 0 ? (
          <p className={styles.cardEmpty}>지난 청구 내역이 없습니다</p>
        ) : (
          <ul className={styles.history}>
            {history.map((h) => (
              <li key={h.yearMonth} className={styles.historyRow} data-history-month={h.yearMonth}>
                <span className={styles.historyMonth}>{h.label}</span>
                <span className={styles.historyAmounts}>
                  청구 {won(h.total)} · 납부 {won(h.paid)}
                </span>
                <span className={`${billing.badge} ${billing[`st_${h.status}`]}`}>{STATUS_LABEL[h.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * 입금 계좌 + [계좌 복사]. 복사하는 것은 계좌 번호만이다(`accountNumberOf`).
 * 읽는 중이면 「불러오는 중입니다」, 설정되지 않았으면 `DEPOSIT_ACCOUNT_MISSING` — 둘 다 [계좌 복사] 없음.
 */
function Account({ account }: { account: DepositAccount | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const back = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (back.current) clearTimeout(back.current);
    },
    [],
  );

  const number = account ? accountNumberOf(account.account) : '';
  const copy = async () => {
    if (!number) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(number);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = number;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setCopied(true);
    if (back.current) clearTimeout(back.current);
    back.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={styles.account}>
      <div>
        <p className={styles.accountLabel}>입금 계좌</p>
        {account ? (
          <>
            <p className={styles.accountValue}>{account.account}</p>
            <p className={styles.accountHolder}>예금주 {account.holder}</p>
          </>
        ) : (
          <p className={styles.accountHolder} data-account-missing={account === null ? '1' : undefined}>
            {account === undefined ? '불러오는 중입니다' : DEPOSIT_ACCOUNT_MISSING}
          </p>
        )}
      </div>
      {account ? (
        <button
          type="button"
          className={`${styles.copyBtn}${copied ? ` ${styles.copyBtnDone}` : ''}`}
          onClick={() => void copy()}
          data-copy-account="1"
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} />
          {copied ? '복사되었습니다' : '계좌 복사'}
        </button>
      ) : null}
    </div>
  );
}
