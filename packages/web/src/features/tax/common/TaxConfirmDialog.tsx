'use client';

/**
 * 세무 확인 창 — ★ 2026-11-26 세무 일관성 ⑤ : 공통 Dialog(삐용 팝업 — 아쿠아 제목줄 · 아래 가운데 단추)로 바꿨다.
 *
 *   제목 = 짧은 이름(실행 단추 글자와 같다 — 법무 확인 창과 같은 방식) · 질문(「…하시겠습니까?」)은 본문 첫 줄(굵게) · 그 아래 설명.
 *   아래 단추 = [실행](주 · 지우기는 빨강 Button danger) [취소](보통). 「○○ 취소」 확인 창이면 취소 단추를 「돌아가기」로(cancelLabel).
 *   닫기: 바깥 누르기 · Esc · [취소] — 공통 Dialog 가 한다.
 *   (종전 : 위 56px 동그라미 아이콘 · 제목 22px 질문 · 반반 단추 [돌아가기][실행] — 세무만의 꼴)
 *
 * ★ 세무 화면만 쓴다. 화면 번호가 없다 — 마크업 재사용일 뿐이다.
 */
import type { ReactNode } from 'react';
import { Button, Dialog } from '@/components/ds';

interface Props {
  /** 짧은 제목 — 보통 실행 단추 글자(okLabel)와 같다. 없으면 okLabel. */
  title?: string;
  /** 본문 첫 줄 질문 — 「…하시겠습니까?」 */
  question: string;
  body?: ReactNode;
  okLabel: string;
  /** 지우기 — 빨강 [실행](공통 Button danger). */
  danger?: boolean;
  /** 취소 단추 글자 — 기본 「취소」. 「○○ 취소」 확인 창은 「돌아가기」. */
  cancelLabel?: string;
  onCancel: () => void;
  onOk: () => void;
}

export function TaxConfirmDialog({ title, question, body, okLabel, danger = false, cancelLabel = '취소', onCancel, onOk }: Props) {
  return (
    <Dialog
      open
      onClose={onCancel}
      title={title ?? okLabel}
      description={
        <>
          <strong>{question}</strong>
          {body ? (
            <>
              <br />
              {body}
            </>
          ) : null}
        </>
      }
      footer={
        <>
          <Button type="button" variant={danger ? 'danger' : 'primary'} size="sm" onClick={onOk} autoFocus>
            {okLabel}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </>
      }
    />
  );
}
