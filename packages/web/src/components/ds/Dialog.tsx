'use client';

/**
 * Dialog — DS 원본: design/_ds/swonbiz/components/feedback/Dialog.jsx
 * props 이름은 Dialog.d.ts 그대로(open · onClose · title · description · footer · width · children).
 *
 * ★ 2026-11-25 입주관리 일관성(대표 지시 「삐용 기준 · 시안과 다르면 삐용 쪽」) — 모양은 삐용 팝업과 같다.
 *   - 제목줄 : 아쿠아 바탕(--color-primary) · 흰 글자 · 24px/600 · 줄 높이 52px(삐용 회원 조회 팝업 제목줄)
 *   - 아래 단추 줄 : 가운데 · 사이 12px. 순서는 부르는 쪽이 [저장/확인](주) [취소](보통)로 넣는다
 *     (원본 d.ts 의 「오른쪽 정렬 · 취소 먼저」와 다르다 — 삐용 쪽을 따랐다)
 *   - 원본의 오른쪽 위 ✕ 는 두지 않는다(삐용 팝업에 없다). 닫기 = [취소] · 바탕 누름 · ESC
 *   - 가림막 = 원본 rgba(11,17,32,.44) → 토큰 --surface-inverse(#0B1120) 45%(시안 03-components 스크림 값)
 * ★ 원본 d.ts 에 없는 것 셋을 더했다(Button 의 href 와 같은 방식) :
 *   closeDisabled(저장 중 바탕 누름 · ESC 막기) · zIndex(종전 화면 모달 80 그대로가 기본) · ariaLabel
 * ★ 'use client' — ESC 를 듣는다.
 */
import { useEffect, useId, type ReactNode } from 'react';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: ReactNode;
  /** 아래 단추 줄(가운데). [저장/확인](주) 먼저 · [취소](보통) 나중 */
  footer?: ReactNode;
  width?: number;
  children?: ReactNode;
  /** true 면 바탕 누름 · ESC 로 닫지 않는다(저장 중) */
  closeDisabled?: boolean;
  zIndex?: number;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  width = 480,
  children,
  closeDisabled = false,
  zIndex = 80,
}: DialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open || !onClose) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, closeDisabled]);

  if (!open) return null;
  return (
    <div
      className={styles.overlay}
      style={{ zIndex }}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !closeDisabled && onClose) onClose();
      }}
    >
      <div className={styles.panel} style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 id={titleId} className={styles.title}>{title}</h3>
        <div className={styles.body}>
          {description ? <p className={styles.desc}>{description}</p> : null}
          {children}
        </div>
        {footer ? <div className={styles.foot}>{footer}</div> : null}
      </div>
    </div>
  );
}
