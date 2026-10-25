'use client';

/**
 * 세무 토스트 — 화면 아래 가운데, 검정 바탕 흰 굵은 글자, **2.4초** 뒤 사라진다(결과서 0-6).
 *
 * ★ 세무 화면만 쓴다. ERP · 법무 화면은 각자 토스트를 그대로 둔다(그쪽은 2.6초 — 바꾸지 않는다).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ds';
import t from './tax.module.css';

const TOAST_MS = 2400;

/** 토스트 하나를 띄우는 손잡이 — `notify(문구)` 를 부르면 2.4초 동안 보인다. */
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
      <Icon name="check" size={16} />
      <span>{message}</span>
    </div>
  );
}
