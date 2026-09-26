'use client';

/**
 * 중도해지 정산 상세 — 사이드바 「청구」 정산 탭에서 행을 누르면 그 아래에 열린다.
 *
 * ★★ 한 업무는 한 화면에서(CLAUDE.md) — 이 카드([정산 처리]·[정산서])는 **정산 탭만** 쓴다.
 *   입주사 청구 탭은 요약 한 줄 + 「청구에서 처리」 링크, 계약 폼 머리는 「정산 결과 보기」
 *   링크만 있고, 둘 다 `/billing?tab=settle&company=&contract=` 로 이 카드를 연다.
 *
 * =============================================================================
 * ★★★ [정산 처리] 는 세 곳에 쓴다 — 한 트랜잭션이다 (023 · 024)
 * =============================================================================
 *   · 청구서    이용료 차액만 수납으로 — 청구서마다 남은 금액만큼(과납이면 환불)
 *   · 정산 원장  실제로 주고받은 금액 · 처리일 · 방법 · 비고 · 환불 계좌
 *   · 예치금 장부 반환 · 차감(받을 돈을 예치금으로 메운 만큼)
 *
 * ★ 「순정산금」이라고 쓰지 않는다 — 부호를 해석해야 방향이 읽힌다. 「환불할 금액」 ·
 *   「추가로 받을 금액」(`settlementDirection`).
 * ★ 계좌번호는 여기서 **전체**를 보인다 — 실제로 송금하는 사람이 보는 자리다. 목록(정산
 *   탭)은 가린다.
 */
import { useState } from 'react';
import { settlementDirection } from '@swonbiz/shared/domain/settlement-view';
import { usedPeriodLabel } from '@swonbiz/shared/domain/usage-period';
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
import { CLAWBACK_BASIS, SettlementDocument } from './SettlementDocument';

export function SettlementCard({ s, onProcessed }: { s: Settlement; onProcessed: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState(false);
  const dir = settlementDirection(s.netAmount);

  const cells: { key: string; value: number; note?: string }[] = [
    { key: '받은 이용료', value: s.totalPaid, note: '이 계약에 들어온 수납 합계' },
    { key: '실제 이용료', value: s.usageCharge, note: '쓴 달 × 월액 + 해지 달 일할' },
    { key: '이용료 차액', value: s.rentNet, note: '받은 이용료 − 실제 이용료 · 청구서에 들어가는 몫' },
    { key: '예치금 반환', value: s.depositReturn },
    { key: '할인 환수', value: s.discountClawback, note: `근거: ${CLAWBACK_BASIS}` },
    { key: '무상 환수', value: s.freeClawback, note: `근거: ${CLAWBACK_BASIS}` },
  ];

  return (
    <div className={styles.settleCard} data-settlement-card={s.contractId}>
      <div className={styles.settleHead}>
        <span className={styles.settleTitle}>
          중도해지 정산
          <span className={styles.settleMeta}>{s.roomNames || '—'}</span>
        </span>
        {s.processed ? (
          <span className={`${styles.badge} ${styles.st_paid}`}>{dotDate(s.processed.processedOn)} 처리 완료</span>
        ) : (
          <span className={`${styles.badge} ${styles.st_partial}`}>처리 대기</span>
        )}
      </div>

      {/* ★ 계약 기간과 실제 이용 기간을 나란히 — 「얼마나 쓰다 나갔는가」가 정산의 전제다. */}
      <div className={styles.settlePeriods}>
        <span>
          <span className={styles.factKey}>계약 기간</span> {dotDate(s.startDate)} ~ {dotDate(s.endDate)}
        </span>
        <span>
          <span className={styles.factKey}>실제 이용 기간</span> {usedPeriodLabel(s.startDate, s.terminateDate)}
        </span>
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
          <div className={styles.factKey}>= 예치금 반환 + 이용료 차액 − 할인 환수 − 무상 환수</div>
          <div className={styles.settleNetValue} data-settle-net="1">
            {dir.label} {dir.kind === 'none' ? '' : won(dir.amount)}
          </div>
        </div>
        <span className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setDoc(true)}>
            <Icon name="file-text" size={16} />
            정산서
          </button>
          {s.processed ? null : (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setOpen(true)}>
              정산 처리
            </button>
          )}
        </span>
      </div>

      {s.processed ? (
        <div className={styles.settleProcessed}>
          {dotDate(s.processed.processedOn)} ·{' '}
          <b>
            {settlementDirection(s.processed.amount).kind === 'charge' ? '받음' : '환불'}{' '}
            {won(Math.abs(s.processed.amount))}
          </b>{' '}
          · {PAY_METHOD_LABEL[s.processed.method] ?? s.processed.method}
          {s.refund ? ` · ${s.refund.bank} ${s.refund.account} (예금주 ${s.refund.holder})` : ''}
          {s.processed.memo ? ` · ${s.processed.memo}` : ''}
          {s.processed.amount !== s.netAmount ? (
            <span className={styles.muted}> (정산 금액과 {won(s.processed.amount - s.netAmount)} 차이)</span>
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
      {doc ? <SettlementDocument s={s} onClose={() => setDoc(false)} /> : null}
    </div>
  );
}

/** 환불 계좌 세 칸 — 정산 처리와 예치금 반환이 같이 쓴다. */
export function RefundAccountFields({
  value,
  onChange,
}: {
  value: { bank: string; account: string; holder: string };
  onChange: (next: { bank: string; account: string; holder: string }) => void;
}) {
  return (
    <div className={cf.field}>
      <span className={cf.label}>환불 계좌</span>
      <div className={styles.accountRow}>
        <input
          className={cf.input}
          placeholder="은행"
          value={value.bank}
          onChange={(e) => onChange({ ...value, bank: e.target.value })}
        />
        <input
          className={cf.input}
          placeholder="계좌번호"
          inputMode="numeric"
          value={value.account}
          onChange={(e) => onChange({ ...value, account: e.target.value.replace(/[^\d-]/g, '') })}
        />
        <input
          className={cf.input}
          placeholder="예금주"
          value={value.holder}
          onChange={(e) => onChange({ ...value, holder: e.target.value })}
        />
      </div>
    </div>
  );
}

export function SettleDialog({ s, onClose, onDone }: { s: Settlement; onClose: () => void; onDone: (m: string) => void }) {
  const dir = settlementDirection(s.netAmount);
  const [processedOn, setProcessedOn] = useState(localTodayIso());
  const [amount, setAmount] = useState(formatMoneyInput(String(dir.amount)));
  const [payMethod, setPayMethod] = useState('B');
  const [memo, setMemo] = useState('');
  const [account, setAccount] = useState({ bank: '', account: '', holder: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountLabel =
    dir.kind === 'refund' ? '실제 돌려준 금액' : dir.kind === 'charge' ? '실제 받은 금액' : '실제 주고받은 금액';

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
    if (dir.kind === 'refund' && (!account.bank.trim() || !account.account.trim() || !account.holder.trim())) {
      setError('환불 계좌(은행 · 계좌번호 · 예금주)를 입력해 주세요');
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
          amount: dir.kind === 'charge' ? -value : value,
          payMethod,
          memo: memo.trim() || null,
          ...(dir.kind === 'refund'
            ? { refundBank: account.bank.trim(), refundAccount: account.account.trim(), refundHolder: account.holder.trim() }
            : {}),
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
          {s.companyName} · {dir.label} {dir.kind === 'none' ? '' : won(dir.amount)}
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
            예치금은 장부에 반환·차감으로 남기고, 환수는 정산 원장에만 기록합니다.
          </p>
          <div className={styles.formGrid}>
            <label className={cf.field}>
              <span className={cf.label}>처리일</span>
              <input type="date" className={cf.input} value={processedOn} onChange={(e) => setProcessedOn(e.target.value)} />
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
            {/* ★ 환불일 때만 — 돌려줄 곳을 모르는 환불은 처리된 것이 아니다(서버도 400 으로 막는다). */}
            {dir.kind === 'refund' ? <RefundAccountFields value={account} onChange={setAccount} /> : null}
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
