'use client';

/** @screen s040200011p1 법무 처리 확인 · 020 법인변경 · 법무 서비스(s04) */

/**
 * 법무 처리 확인 창 — 완료 · 완료 취소 · 취소 · 복원 · 삭제 다섯이 **이 한 창**을 쓴다(4단계, 2026-10-10).
 * 법인설립 상세(s040100020, 10-4)도 이 창을 그대로 쓴다 — 다른 것은 삭제 문구의 「사람」뿐이다(`peopleLabel`).
 * 제출(A)은 없앴다(2026-10-10) — 그 버튼과 문구도 지웠다.
 *
 * ★ 시안이 없다 — 상태 전이 확인 창(`s030200040p2`)과 **같은 모양**이다(가운데 원형 아이콘 56px ·
 *   가운데 제목 · 50:50 버튼). 다섯이 다른 것은 아이콘 · 색 · 문구뿐이고, 취소만 사유 칸이 있다.
 * ★ 계약 폼의 `ConfirmDialog` 는 건드리지 않는다(결정 2026-10-10). 그쪽은 계약 3종이 박혀 있다.
 *   문의 삭제(`DeleteInquiryDialog`) · 시설 삭제(`DeleteFacilityDialog`)도 같은 모양을 따로 든다.
 *   ★ 「공용 확인 창 하나로 합치기」는 **별건**이다 — 이 창을 그 근거로 넓히지 않는다.
 *
 * ★ 막는 것은 서버다 — 이 창은 묻기만 한다. 실패하면 서버 문구를 창 안에 띄우고 닫지 않는다.
 *
 * ★ 2026-11-25 법무 일관성 — 창 틀은 공통 `Dialog`(components/ds) : 아쿠아 제목줄 · 아래 가운데 [처리](먼저) [취소](나중 · 「취소 처리」 창만 [돌아가기]).
 *   제목 = 짧은 이름(확인 단추 문구 `okLabel` 그대로), 묻는 문장은 본문 첫 줄 굵게(계약 `ConfirmDialog` 와 같다).
 *   종전의 가운데 원형 그림 56px · 50:50 단추는 없앴다. 지우는 동작(취소 · 삭제)의 확인 단추는 지우기(danger)다.
 */
import { useState } from 'react';
import { CANCEL_REASON_MAX } from '@swonbiz/shared/domain/corp-change-transition';
import { Button, Dialog } from '@/components/ds';
import styles from './corp-change-detail.module.css';

export type CorpChangeConfirmKind = 'complete' | 'uncomplete' | 'cancel' | 'restore' | 'delete';

interface Def {
  tone: 'primary' | 'danger';
  title: string;
  okLabel: string;
  /** 닫는 단추 문구 — 2026-11-25 대표 결정(법무 정한 것 2) : 「취소」. 단 「취소 처리」 창만 「돌아가기」(두 「취소」가 나란히 서지 않게) */
  cancelLabel: string;
}

const DEFS: Record<CorpChangeConfirmKind, Def> = {
  complete: { tone: 'primary', title: '완료 처리하시겠습니까?', okLabel: '완료', cancelLabel: '취소' },
  uncomplete: { tone: 'primary', title: '완료를 취소하시겠습니까?', okLabel: '완료 취소', cancelLabel: '취소' },
  cancel: { tone: 'danger', title: '이 건을 취소하시겠습니까?', okLabel: '취소 처리', cancelLabel: '돌아가기' },
  restore: { tone: 'primary', title: '이 건을 복원하시겠습니까?', okLabel: '복원', cancelLabel: '취소' },
  delete: { tone: 'danger', title: '이 건을 삭제하시겠습니까?', okLabel: '삭제', cancelLabel: '취소' },
};

/** 본문 — 복원은 돌아갈 상태 이름이 들어간다. */
function descOf(kind: CorpChangeConfirmKind, restoreToName: string | null, peopleLabel: string): string {
  switch (kind) {
    case 'complete':
      return '완료한 건은 운영사만 완료 취소로 작성완료 상태로 되돌릴 수 있습니다.';
    case 'uncomplete':
      return '작성완료 상태로 돌아갑니다. 완료일은 지워집니다.';
    case 'cancel':
      return '취소한 건은 운영사가 취소 직전 상태로 복원할 수 있습니다.';
    case 'restore':
      return `취소 직전 상태${restoreToName ? `(${restoreToName})` : ''}로 돌아갑니다. 취소 사유는 지워집니다.`;
    case 'delete':
      return `건과 ${peopleLabel}이 모두 지워집니다. 되돌릴 수 없습니다.`;
  }
}

interface Props {
  kind: CorpChangeConfirmKind;
  /** 복원일 때 돌아갈 상태의 이름. */
  restoreToName?: string | null;
  /** 삭제 문구의 사람 묶음 이름 — 법인변경 「임원」(기본) · 법인설립 「사람」(10-4, 2026-10-11). */
  peopleLabel?: string;
  onClose: () => void;
  /** 처리. 실패면 문구를 돌려준다(창을 닫지 않는다), 성공이면 null. 취소면 사유가 온다. */
  onConfirm: (cancelReason: string | null) => Promise<string | null>;
}

export function CorpChangeConfirmDialog({ kind, restoreToName = null, peopleLabel = '임원', onClose, onConfirm }: Props) {
  const def = DEFS[kind];
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    const failed = await onConfirm(kind === 'cancel' ? reason.trim() || null : null);
    setBusy(false);
    if (failed) setError(failed);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      closeDisabled={busy}
      title={def.okLabel}
      description={
        <>
          <strong>{def.title}</strong>
          <br />
          {descOf(kind, restoreToName, peopleLabel)}
        </>
      }
      footer={
        <>
          <Button
            type="button"
            variant={def.tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            disabled={busy}
            onClick={() => void run()}
          >
            {def.okLabel}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {def.cancelLabel}
          </Button>
        </>
      }
    >
      {kind === 'cancel' ? (
        <label className={styles.modalField}>
          <span className={styles.label}>취소 사유 (선택)</span>
          <textarea
            className={styles.textarea}
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            value={reason}
            disabled={busy}
            placeholder="비워 두어도 됩니다"
            onChange={(e) => setReason(e.target.value)}
          />
          <span className={styles.hint}>
            {reason.length}/{CANCEL_REASON_MAX}자 · 회사 사용자도 상세에서 봅니다
          </span>
        </label>
      ) : null}

      {error ? <p className={styles.modalErr}>{error}</p> : null}
    </Dialog>
  );
}
