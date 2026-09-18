'use client';

/** @screen s0300200040p2 상태 전이 확인 · 020 입주사관리 · 1차 */

/**
 * 확인 모달 3종 — 계약확정 · 계약취소 · 종료.
 *
 * 원본: design/handoff/prototypes/s0300200040.html 690~713행(마크업) · 1406~1452행(정의)
 * 명세: design/handoff/tenant-contract/04-status.md 「확인 모달 3종」
 *
 * ★ 컴포넌트 **하나**로 3종을 낸다(로드맵 페이즈 4 화면표 `s0300200040p2`).
 *   다른 것은 아이콘·색·문구·추가 입력뿐이고 구조는 같다.
 *
 * ★ DS 의 `Dialog` 를 쓰지 않았다. DS 원본은 좌측 정렬 제목 + 우측 닫기 × + 우측 정렬
 *   액션이고, 이 모달은 **가운데 정렬 원형 아이콘 56px + 가운데 제목 + 50:50 버튼**이다.
 *   구성이 다르므로 시안(화면 정본)을 따랐다. 판단이 필요한 자리라 보고 항목에 올린다.
 */
import { useState } from 'react';
import { Icon, type IconName } from '@/components/ds';
import styles from './contract-form.module.css';

export type ConfirmKind = 'confirm' | 'cancel' | 'terminate';

interface Def {
  icon: IconName;
  iconClass: string;
  title: string;
  desc: string;
  cancelLabel: string;
  okLabel: string;
  /** 되돌릴 수 없는 전이는 확정 버튼이 붉다. */
  danger: boolean;
}

const DEFS: Record<ConfirmKind, Def> = {
  confirm: {
    icon: 'circle-check',
    iconClass: styles.modalIconConfirm ?? '',
    title: '계약을 확정하시겠습니까?',
    desc: '확정 후에는 계약 조건을 변경할 수 없습니다. 회사 정보와 사용자 정보는 계속 수정할 수 있습니다.',
    cancelLabel: '취소',
    okLabel: '확정',
    danger: false,
  },
  cancel: {
    icon: 'circle-x',
    iconClass: styles.modalIconCancel ?? '',
    title: '계약을 취소하시겠습니까?',
    desc: '임시저장된 계약 정보가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
    cancelLabel: '돌아가기',
    okLabel: '계약취소',
    danger: true,
  },
  terminate: {
    icon: 'triangle-alert',
    iconClass: styles.modalIconTerminate ?? '',
    title: '계약을 종료하시겠습니까?',
    desc: '종료 후 해당 호실은 예약 가능 상태가 됩니다.',
    cancelLabel: '취소',
    okLabel: '종료 처리',
    danger: true,
  },
};

export interface ConfirmResult {
  terminatedDate?: string;
  terminationReason?: string;
}

interface Props {
  kind: ConfirmKind;
  busy: boolean;
  onClose: () => void;
  onOk: (result: ConfirmResult) => void;
}

export function ConfirmDialog({ kind, busy, onClose, onOk }: Props) {
  const def = DEFS[kind];
  // 종료일 기본값은 오늘이다. 로컬 날짜로 만든다 — toISOString 은 UTC 라 저녁에 하루 밀린다.
  const [date, setDate] = useState(() => localToday());
  const [reason, setReason] = useState('');

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={def.title}>
        <div className={styles.modalIconWrap}>
          <span className={`${styles.modalIcon} ${def.iconClass}`}>
            <Icon name={def.icon} size={24} />
          </span>
        </div>
        <h3 className={styles.modalTitle}>{def.title}</h3>
        <p className={styles.modalDesc}>{def.desc}</p>

        {kind === 'terminate' ? (
          <div className={styles.modalExtra}>
            <label className={styles.field}>
              <span className={styles.label}>종료일</span>
              <input
                type="date"
                className={styles.input}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <textarea
              className={styles.textarea}
              rows={2}
              placeholder="종료 사유를 입력해 주세요"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}

        <div className={styles.modalFoot}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={onClose}>
            {def.cancelLabel}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${def.danger ? styles.btnPrimaryDanger : styles.btnPrimary}`}
            disabled={busy}
            onClick={() =>
              onOk(
                kind === 'terminate'
                  ? { terminatedDate: date, terminationReason: reason.trim() || undefined }
                  : {},
              )
            }
          >
            {def.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** `YYYY-MM-DD` — 로컬 기준 오늘. */
export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
