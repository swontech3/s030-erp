'use client';

/** @screen s030200070p4 예치금 반환 · 020 입주사관리 */

/**
 * 예치금 반환 — **정산서 없이** 반환만 처리한다. 기간 만료로 끝난 계약이 여기로 온다.
 *
 * ★ 금액은 고칠 수 없다 — 장부의 보유액 전부다. 일부만 돌려줄 사정(원상복구 비용 등)이
 *   생기면 그건 「차감」이고, 차감 규칙은 아직 중도해지 정산에만 있다(보고 항목).
 * ★ 중도해지 정산이 처리 전이면 서버가 409 로 막는다 — 그 예치금은 [정산 처리]가 나눈다.
 */
import { useState } from 'react';
import { Icon } from '@/components/ds';
import cf from '@/features/contracts/contract-form.module.css';
import styles from './billing.module.css';
import { PAY_METHOD_LABEL, localTodayIso, won } from './billing-model';
import { RefundAccountFields } from './SettlementCard';

export function DepositReturnDialog(props: {
  contractId: string;
  companyName: string;
  amount: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [returnedOn, setReturnedOn] = useState(localTodayIso());
  const [payMethod, setPayMethod] = useState('B');
  const [memo, setMemo] = useState('');
  const [account, setAccount] = useState({ bank: '', account: '', holder: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!account.bank.trim() || !account.account.trim() || !account.holder.trim()) {
      setError('반환 계좌(은행 · 계좌번호 · 예금주)를 입력해 주세요');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${props.contractId}/deposit/return`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paidOn: returnedOn,
          payMethod,
          memo: memo.trim() || null,
          refundBank: account.bank.trim(),
          refundAccount: account.account.trim(),
          refundHolder: account.holder.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? '예치금을 반환하지 못했습니다');
      props.onDone(`예치금 ${won(props.amount)}을 반환했습니다`);
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
        if (e.target === e.currentTarget && !busy) props.onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) props.onClose();
      }}
    >
      <div className={cf.modal} role="dialog" aria-modal="true" aria-label="예치금 반환">
        <div className={cf.modalIconWrap}>
          <span className={`${cf.modalIcon} ${cf.modalIconConfirm}`}>
            <Icon name="receipt" size={24} />
          </span>
        </div>
        <h3 className={cf.modalTitle}>예치금을 반환하시겠습니까?</h3>
        <p className={cf.modalDesc}>
          {props.companyName} · 환불할 금액 {won(props.amount)}
        </p>
        <div className={cf.modalExtra}>
          <div className={styles.formGrid}>
            <label className={cf.field}>
              <span className={cf.label}>반환일</span>
              <input type="date" className={cf.input} value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} />
            </label>
            <RefundAccountFields value={account} onChange={setAccount} />
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
          <button type="button" className={`${cf.btn} ${cf.btnGhost}`} disabled={busy} onClick={props.onClose}>
            취소
          </button>
          <button type="button" className={`${cf.btn} ${cf.btnPrimary}`} disabled={busy} onClick={submit}>
            반환 처리
          </button>
        </div>
      </div>
    </div>
  );
}
