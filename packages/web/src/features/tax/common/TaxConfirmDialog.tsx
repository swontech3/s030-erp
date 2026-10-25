'use client';

/**
 * 세무 확인 창(480px) — 결과서 0-6 · 시안 `MODALS.confirm`.
 *
 *   위 52px 동그라미 아이콘(인디고 연한 바탕, 지우기는 빨강 연한 바탕) · 제목 20px 굵게 · 본문 14px ·
 *   아래 버튼 둘 반반 — [돌아가기](흰) · [실행](primary, 지우기는 빨강 바탕).
 *   닫기: 바깥 누르기 · Esc · [돌아가기].
 *
 * ★ 세무 화면만 쓴다. 화면 번호가 없다 — 마크업 재사용일 뿐이다.
 */
import { useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ds';
import t from './tax.module.css';

interface Props {
  icon: IconName;
  title: string;
  body: ReactNode;
  okLabel: string;
  /** 지우기 — 빨강 아이콘 바탕 · 빨강 [실행]. */
  danger?: boolean;
  onCancel: () => void;
  onOk: () => void;
}

export function TaxConfirmDialog({ icon, title, body, okLabel, danger = false, onCancel, onOk }: Props) {
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
          <div className={`${t.confirmIc} ${danger ? t.confirmIcRed : ''}`}>
            <Icon name={icon} size={24} />
          </div>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
        <div className={t.confirmF}>
          <button type="button" className={t.btn} onClick={onCancel}>
            돌아가기
          </button>
          <button type="button" className={`${t.btn} ${danger ? t.btnDangerSolid : t.btnPrimary}`} onClick={onOk} autoFocus>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
