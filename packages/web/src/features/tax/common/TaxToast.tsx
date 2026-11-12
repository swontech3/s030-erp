'use client';

/**
 * 세무 토스트 — ★ 2026-11-07 ERP 디자인 컨셉에 맞춤(월별 청구 · 03-components Toast):
 *   오른쪽 아래 380px 흰 카드 + 왼쪽 인디고 점 + 굵은 글자, **2.8초** 뒤 사라진다(전: 아래 가운데 검정 2.4초 — 결과서 0-6).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import t from './tax.module.css';

/** 월별 청구(BillingView)와 같은 시간. */
const TOAST_MS = 2800;

/** 토스트 하나를 띄우는 손잡이 — `notify(문구)` 를 부르면 2.8초 동안 보인다. */
export function useTaxToast(): { message: string | null; notify: (message: string) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((m: string) => {
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { message, notify };
}

export function TaxToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className={t.toast} role="status" aria-live="polite">
      <span className={t.toastDot} />
      <span className={t.toastMsg}>{message}</span>
    </div>
  );
}
