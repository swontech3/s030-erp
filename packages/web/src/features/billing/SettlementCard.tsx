'use client';

/**
 * 중도해지 정산 결과 — 입주사 청구 탭 위쪽에 계약마다 한 장.
 *
 * ★ 위치를 계약 폼이 아니라 **청구 탭**으로 정했다. 정산은 수납과 한 덩어리로 읽혀야
 *   한다 — 이용료 차액이 청구서의 수납으로 들어가므로, 정산을 처리하면 바로 아래 표에서
 *   청구서 상태가 바뀌는 것이 보인다. 계약 폼은 이미 섹션 넷이 무겁다.
 *
 * =============================================================================
 * ★★★ [정산 처리] 는 두 곳에 나누어 쓴다 — 한 트랜잭션이다 (023, 2026-09-26 결정)
 * =============================================================================
 *   · 청구서    이용료 차액(총수납 − 실이용료)만 수납으로 — 청구서마다 남은 금액만큼(과납이면 환불)
 *   · 정산 원장  실제로 주고받은 금액 · 처리일 · 방법 · 비고 — 예치금 반환과 환수는 여기에만
 * 순정산금을 통째로 청구서에 넣으면 그 청구서가 「미납」으로 보이고 월별 미수금에 예치금·
 * 환수가 섞인다. 그래서 「환불 처리」·「추가 청구 받음」을 따로 두지 않고 버튼 하나로 묶었다.
 */
import { useState } from 'react';
import { Icon } from '@/components/ds';
import cf from '@/features/contracts/contract-form.module.css';
import styles from './billing.module.css';
import {
  PAY_METHOD_LABEL,
  dotDate,
  formatMoneyInput,
  localTodayIso,
  parseMoneyInput,
  won,
  type Settlement,
} from './billing-model';

/** 순정산금의 뜻 — 양수 환불 / 음수 추가청구 / 0 없음. */
function netLabel(net: number): string {
  if (net > 0) return '환불';
  if (net < 0) return '추가청구';
  return '정산 없음';
}

export function SettlementCard({ s, onProcessed }: { s: Settlement; onProcessed: (message: string) => void }) {
  const [open, setOpen] = useState(false);

  const cells: { key: string; value: number; note?: string }[] = [
    { key: '총수납', value: s.totalPaid, note: '이 계약에 들어온 수납 합계' },
    { key: '실이용료', value: s.usageCharge, note: '쓴 달 × 월액 + 해지 달 일할' },
    { key: '예치금 반환', value: s.depositReturn },
    { key: '할인 환수', value: s.discountClawback },
    { key: '무상 환수', value: s.freeClawback },
    { key: '이용료 차액', value: s.rentNet, note: '총수납 − 실이용료 · 청구서에 들어가는 몫' },
  ];

  return (
    <div className={styles.settleCard}>
      <div className={styles.settleHead}>
        <span className={styles.settleTitle}>
          중도해지 정산
          <span className={styles.settleMeta}>
            {s.roomNames || '—'} · {dotDate(s.startDate)} ~ {dotDate(s.endDate)} · 해지 {dotDate(s.terminateDate)}
          </span>
        </span>
        {s.processed ? (
          <span className={`${styles.badge} ${styles.st_paid}`}>{dotDate(s.processed.processedOn)} 처리 완료</span>
        ) : (
          <span className={`${styles.badge} ${styles.st_partial}`}>처리 대기</span>
        )}
      </div>

      <div className={styles.settleGrid}>
        {cells.map((c) => (
          <div key={c.key} className={styles.settleCell} title={c.note}>
            <div className={styles.factKey}>{c.key}</div>
            <div className={styles.factValue}>{won(c.value)}</div>
          </div>
        ))}
      </div>

      <div className={styles.settleNet}>
        <div>
          <div className={styles.factKey}>순정산금 = 예치금 반환 + 이용료 차액 − 할인 환수 − 무상 환수</div>
          <div className={styles.settleNetValue}>
            {netLabel(s.netAmount)} {won(Math.abs(s.netAmount))}
          </div>
        </div>
        {s.processed ? null : (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setOpen(true)}>
            정산 처리
          </button>
        )}
      </div>

      {s.processed ? (
        <div className={styles.settleProcessed}>
          {dotDate(s.processed.processedOn)} ·{' '}
          <b>
            {netLabel(s.processed.amount)} {won(Math.abs(s.processed.amount))}
          </b>{' '}
          · {PAY_METHOD_LABEL[s.processed.method] ?? s.processed.method}
          {s.processed.memo ? ` · ${s.processed.memo}` : ''}
          {s.processed.amount !== s.netAmount ? (
            <span className={styles.muted}> (순정산금과 {won(s.processed.amount - s.netAmount)} 차이)</span>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <SettleDialog
          s={s}
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setOpen(false);
            onProcessed(message);
          }}
        />
      ) : null}
    </div>
  );
}

function SettleDialog({ s, onClose, onDone }: { s: Settlement; onClose: () => void; onDone: (m: string) => void }) {
  const direction = s.netAmount > 0 ? 'refund' : s.netAmount < 0 ? 'charge' : 'none';
  const [processedOn, setProcessedOn] = useState(localTodayIso());
  const [amount, setAmount] = useState(formatMoneyInput(String(Math.abs(s.netAmount))));
  const [payMethod, setPayMethod] = useState('B');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountLabel =
    direction === 'refund' ? '실제 돌려준 금액' : direction === 'charge' ? '실제 받은 금액' : '실제 주고받은 금액';

  const submit = async () => {
    const value = parseMoneyInput(amount === '' ? '0' : amount);
    if (value === null || value < 0) {
      setError('금액은 0 이상으로 적어 주세요 — 환불인지 받은 것인지는 정산 결과가 정합니다');
      return;
    }
    if (!processedOn) {
      setError('처리일을 입력해 주세요');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${s.contractId}/settlement/process`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // ★ 원장의 부호는 순정산금과 같다 — 양수 환불 / 음수 받음.
        body: JSON.stringify({
          paidOn: processedOn,
          amount: direction === 'charge' ? -value : value,
          payMethod,
          memo: memo.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? '정산을 처리하지 못했습니다');
      onDone('정산을 처리했습니다');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className={cf.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
    >
      <div className={cf.modal} role="dialog" aria-modal="true" aria-label="정산 처리">
        <div className={cf.modalIconWrap}>
          <span className={`${cf.modalIcon} ${cf.modalIconConfirm}`}>
            <Icon name="receipt" size={24} />
          </span>
        </div>
        <h3 className={cf.modalTitle}>정산을 처리하시겠습니까?</h3>
        <p className={cf.modalDesc}>
          순정산금 {netLabel(s.netAmount)} {won(Math.abs(s.netAmount))}
        </p>

        <div className={cf.modalExtra}>
          <p className={styles.note}>
            {s.rentNet === 0 ? (
              <>이용료 차액이 없어 청구서는 바뀌지 않습니다.</>
            ) : (
              <>
                이용료 차액 <b>{won(Math.abs(s.rentNet))}</b>을 청구서마다 남은 금액만큼{' '}
                {s.rentNet > 0 ? '환불(음수 수납)' : '수납'}으로 넣습니다. 처리 후 청구서는 전부 납부완료가 됩니다.
              </>
            )}
            <br />
            예치금 반환·환수는 청구서에 넣지 않고 정산 원장에만 기록합니다.
          </p>
          <div className={styles.formGrid}>
            <label className={cf.field}>
              <span className={cf.label}>처리일</span>
              <input
                type="date"
                className={cf.input}
                value={processedOn}
                onChange={(e) => setProcessedOn(e.target.value)}
              />
            </label>
            <label className={cf.field}>
              <span className={cf.label}>{amountLabel}</span>
              <input
                className={`${cf.input} ${cf.inputMoney}`}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(formatMoneyInput(e.target.value.replace('-', '')))}
              />
            </label>
            <div className={cf.field}>
              <span className={cf.label}>방법</span>
              <div className={styles.segment}>
                {(['B', 'C'] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={`${styles.segBtn}${payMethod === code ? ` ${styles.segOn}` : ''}`}
                    onClick={() => setPayMethod(code)}
                  >
                    {PAY_METHOD_LABEL[code]}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className={cf.textarea}
              rows={2}
              placeholder="비고 (선택)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
            {error ? <p className={styles.formError}>{error}</p> : null}
          </div>
        </div>

        <div className={cf.modalFoot}>
          <button type="button" className={`${cf.btn} ${cf.btnGhost}`} disabled={busy} onClick={onClose}>
            취소
          </button>
          <button type="button" className={`${cf.btn} ${cf.btnPrimary}`} disabled={busy} onClick={submit}>
            정산 처리
          </button>
        </div>
      </div>
    </div>
  );
}
