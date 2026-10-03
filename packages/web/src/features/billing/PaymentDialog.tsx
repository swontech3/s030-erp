'use client';

/** @screen s030200070p1 수납 입력 · 020 입주사관리 */

/**
 * 수납 입력·수정 창.
 *
 * ★ 디자인이 없다 — **상태 전이 확인 창(s030200040p2)과 같은 모양**으로 만들었다
 *   (가운데 원형 아이콘 · 가운데 제목 · 50:50 버튼). 뼈대 클래스도 그 창의 것을 쓴다.
 *
 * ★★ 일반 수납은 **양수만** 받는다. 환불(음수)은 정산 결과의 [정산 처리] 에서만
 *    생긴다 — 거기서 이용료 과납분이 음수 수납으로 들어간다(023). 여기서 음수를 열어
 *    두면 청구서마다 아무 이유 없는 환불이 생길 수 있고, 그건 정산 원장에 안 남는다.
 *    이미 들어간 환불 수납을 **고칠 때**만 음수를 유지한다(부호는 바꿀 수 없다).
 */
import { useState } from 'react';
import { Icon } from '@/components/ds';
import cf from '@/features/contracts/contract-form.module.css';
import styles from './billing.module.css';
import {
  PAY_METHOD_LABEL,
  formatMoneyInput,
  localTodayIso,
  parseMoneyInput,
  won,
  yearMonthDot,
  type Payment,
} from './billing-model';

export interface PaymentTarget {
  invoiceId: string;
  yearMonth: string;
  companyName: string;
  roomNames: string;
  totalAmount: number;
  outstanding: number;
}

interface Props {
  target: PaymentTarget;
  /** 있으면 수정이다. */
  editing?: Payment | null;
  onClose: () => void;
  /** 저장이 끝났다 — 부르는 쪽이 목록을 다시 받는다. */
  onSaved: (message: string) => void;
}

export function PaymentDialog({ target, editing = null, onClose, onSaved }: Props) {
  const refund = editing !== null && editing.amount < 0;

  const [paidOn, setPaidOn] = useState(editing?.paidOn ?? localTodayIso());
  const [amount, setAmount] = useState(() => {
    if (editing) return formatMoneyInput(String(editing.amount));
    // ★ 기본값은 **남은 금액**이다. 남은 것이 없으면(과납·완납) 비워 둔다 — 0 을 넣어 두면
    //   그대로 저장을 눌러 400 을 받는다.
    return target.outstanding > 0 ? formatMoneyInput(String(target.outstanding)) : '';
  });
  const [payMethod, setPayMethod] = useState(editing?.payMethod ?? 'B');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = parseMoneyInput(amount);
    if (value === null || value === 0) {
      setError('금액을 입력해 주세요');
      return;
    }
    if (!refund && value < 0) {
      setError('수납 금액은 0보다 커야 합니다 — 환불은 정산 결과의 [정산 처리]에서 넣습니다');
      return;
    }
    if (refund && value > 0) {
      setError('환불 수납은 음수로 남겨야 합니다');
      return;
    }
    if (!paidOn) {
      setError('입금일을 입력해 주세요');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const url = editing ? `/api/payments/${editing.paymentId}` : `/api/invoices/${target.invoiceId}/payments`;
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paidOn, amount: value, payMethod, memo: memo.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? '수납을 저장하지 못했습니다');
      onSaved(editing ? '수납을 수정했습니다' : `${won(value)} 수납을 넣었습니다`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const title = editing ? (refund ? '환불 수납 수정' : '수납 수정') : '수납 입력';

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
      <div className={cf.modal} role="dialog" aria-modal="true" aria-label={title}>
        <div className={cf.modalIconWrap}>
          <span className={`${cf.modalIcon} ${cf.modalIconConfirm}`}>
            <Icon name="receipt" size={24} />
          </span>
        </div>
        <h3 className={cf.modalTitle}>{title}</h3>
        <p className={cf.modalDesc}>
          {target.companyName} · {yearMonthDot(target.yearMonth)}
          {target.roomNames ? ` · ${target.roomNames}` : ''}
          <br />
          청구 {won(target.totalAmount)} · 남은 금액 {won(target.outstanding)}
        </p>

        <div className={cf.modalExtra}>
          <div className={styles.formGrid}>
            <label className={cf.field}>
              <span className={cf.label}>입금일</span>
              <input type="date" className={cf.input} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
            <label className={cf.field}>
              <span className={cf.label}>금액</span>
              <input
                className={`${cf.input} ${cf.inputMoney}`}
                inputMode="numeric"
                value={amount}
                placeholder="0"
                onChange={(e) => setAmount(formatMoneyInput(e.target.value))}
              />
            </label>
            <div className={cf.field}>
              <span className={cf.label}>결제수단</span>
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
            {editing ? '수정' : '수납'}
          </button>
        </div>
      </div>
    </div>
  );
}
