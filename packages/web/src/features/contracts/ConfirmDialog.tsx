'use client';

/** @screen s030200040p2 상태 전이 확인 · 020 입주사관리 · 1차 */

/**
 * 확인 모달 3종 — 계약확정 · 계약취소 · 종료.
 *
 * 원본: design/handoff/prototypes/s0300200040.html 690~713행(마크업) · 1406~1452행(정의)
 * 명세: design/handoff/tenant-contract/04-status.md 「확인 모달 3종」
 *
 * ★ 컴포넌트 **하나**로 3종을 낸다(로드맵 페이즈 4 화면표 `s030200040p2`).
 *   다른 것은 아이콘·색·문구·추가 입력뿐이고 구조는 같다.
 *
 * ★ 2026-11-25 입주관리 일관성(대표 지시) — 공통 `Dialog`(components/ds)로 바꿨다.
 *   아쿠아 제목줄 · 아래 가운데 [확정/계약취소/종료 처리] [취소/돌아가기]. 종전의 가운데 원형 아이콘 56px ·
 *   50:50 단추는 없앴다. 되돌릴 수 없는 전이(계약취소 · 종료)의 확정 단추는 지우기(danger) 단추다.
 */
import { useState } from 'react';
import { terminationDefaults } from '@swonbiz/shared/domain/contract-status';
import { Button, Dialog } from '@/components/ds';
import styles from './contract-form.module.css';

export type ConfirmKind = 'confirm' | 'cancel' | 'terminate';

interface Def {
  /* ★ 2026-11-25 정한 것 2 — 팝업 제목 = 짧은 이름, 묻는 문장은 본문 첫 줄 */
  /** 팝업 제목줄 — 짧은 이름 */
  name: string;
  /** 묻는 문장 — 본문 첫 줄 */
  title: string;
  desc: string;
  cancelLabel: string;
  okLabel: string;
  /**
   * 확정 버튼 문구를 **코드 테이블에서 가져올 때** 그 결과 상태값(`CONTRACT_ST`).
   * 없으면 `okLabel` 을 그대로 쓴다.
   *
   * ★ `confirm` 에는 없다 — `confirmed` 의 코드명은 「계약중」이고 그것은 상태 이름이지
   *   동작 이름이 아니다. 버튼에 「계약중」이라고 적을 수는 없다.
   */
  okStatus?: string;
  /** 되돌릴 수 없는 전이는 확정 버튼이 지우기(danger) 단추다. */
  danger: boolean;
}

const DEFS: Record<ConfirmKind, Def> = {
  confirm: {
    name: '계약 확정',
    title: '계약을 확정하시겠습니까?',
    desc: '확정 후에는 계약 조건을 변경할 수 없습니다. 회사 정보와 사용자 정보는 계속 수정할 수 있습니다.',
    cancelLabel: '취소',
    okLabel: '확정',
    danger: false,
  },
  cancel: {
    name: '계약 취소',
    title: '계약을 취소하시겠습니까?',
    desc: '임시저장된 계약 정보가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
    cancelLabel: '돌아가기',
    okLabel: '계약취소',
    okStatus: 'cancelled',
    danger: true,
  },
  terminate: {
    name: '계약 종료',
    title: '계약을 종료하시겠습니까?',
    desc: '종료 후 해당 호실은 예약 가능 상태가 됩니다.',
    cancelLabel: '취소',
    okLabel: '종료 처리',
    okStatus: 'terminated',
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
  /**
   * 종료할 계약의 **원래 종료일** `YYYY-MM-DD` — `terminate` 에서만 쓴다.
   *
   * ★★ 종료일이 지난 계약이면 종료일자 기본값이 **오늘이 아니라 이 값**이다.
   *    뒤늦게 닫는 것이라 오늘을 넣으면 계약이 실제보다 길었던 것으로 남는다.
   *    판정과 기본값은 `terminationDefaults` 한 곳이다.
   */
  endDate?: string;
  /**
   * 상태 표시명 — 코드 `CONTRACT_ST` / `use_tp='000'`.
   * 확정 버튼이 결과 상태의 이름을 그대로 쓴다(`Def.okStatus`).
   */
  statusNames: Readonly<Record<string, string>>;
  onClose: () => void;
  onOk: (result: ConfirmResult) => void;
}

export function ConfirmDialog({ kind, busy, endDate, statusNames, onClose, onOk }: Props) {
  const def = DEFS[kind];
  /**
   * ★ 제목·설명은 그대로 둔다. 「계약을 종료하시겠습니까?」의 **종료는 동작**이고
   *   코드 테이블이 가진 것은 **상태 이름**이다. 문장 안의 동사를 상태 이름으로
   *   바꾸면 「계약을 계약종료하시겠습니까?」가 된다.
   */
  const okLabel = def.okStatus ? (statusNames[def.okStatus] ?? def.okLabel) : def.okLabel;
  /*
   * 종료일자·사유의 첫 값 — **판정은 `terminationDefaults` 한 곳**이다.
   *
   * ★ 만료된 계약이면 원래 종료일 + 「계약기간 만료로 계약 종료」, 아직 안 끝난 계약을
   *   중도에 닫는 것이면 오늘 + 빈 사유.
   *
   * ★ 「오늘」은 **로컬 날짜**로 만든다 — `toISOString` 은 UTC 라 저녁에 하루 밀린다.
   *
   * ★ 둘 다 **기본값일 뿐이다.** 실제 퇴실일이 다르면 운영자가 바꾼다.
   */
  const seed = terminationDefaults({ endDate: endDate ?? '', today: localToday() });
  const [date, setDate] = useState(seed.terminatedDate);
  const [reason, setReason] = useState(seed.reason);

  return (
    <Dialog
      open
      onClose={onClose}
      title={def.name}
      description={
        <>
          <strong>{def.title}</strong>
          <br />
          {def.desc}
        </>
      }
      footer={
        <>
          <Button
            type="button"
            variant={def.danger ? 'danger' : 'primary'}
            size="sm"
            disabled={busy}
            onClick={() =>
              onOk(
                kind === 'terminate'
                  ? { terminatedDate: date, terminationReason: reason.trim() || undefined }
                  : {},
              )
            }
          >
            {okLabel}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {def.cancelLabel}
          </Button>
        </>
      }
    >
      {kind === 'terminate' ? (
        <div className={styles.dialogExtra}>
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
    </Dialog>
  );
}

/** `YYYY-MM-DD` — 로컬 기준 오늘. */
export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
