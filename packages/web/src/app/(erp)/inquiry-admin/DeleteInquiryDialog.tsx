'use client';

/** @screen s030200080p1 문의 삭제 확인 · 020 입주사관리 */

/**
 * 글 전체 삭제 확인 창 (s030200080).
 *
 * ★ 모양 = 공통 팝업 `Dialog`(삐용 기준 · 2026-11-25 입주관리 일관성) — 아쿠아 제목줄 ·
 *   아래 가운데 [삭제](지우기 · danger) [취소](보통). 종전 원형 아이콘 · 50:50 단추는 없앴다.
 *   바탕 누름 · ESC 로 닫힌다(지우는 중에는 막는다 — closeDisabled).
 *
 * =============================================================================
 * ★★★ 무엇이 지워지는지 **적어 두고 묻는다**
 * =============================================================================
 * 「삭제하시겠습니까?」만 띄우면 무엇이 사라지는지 알 수 없다. 이 처리는 개인정보를
 * 파기하고 되돌릴 수 없으므로(04-data-model §5) 지워지는 것과 남는 것을 함께 보여 준다.
 *
 * ★ 문구가 두 가지다 — 보관 기간이 지난 글이면 「기간이 지난 글입니다」, 아니면
 *   「아직 보관 기간 안입니다」. 둘 다 지울 수 있지만(2026-09-28 결정), 기간 안의 글을
 *   지우는 것은 스팸 제거 같은 예외라 그렇다고 알린다.
 */
import { useState } from 'react';
import { Button, Dialog } from '@/components/ds';
import { dotDate } from '@/features/inquiry/inquiry-model';
import styles from './inquiry-admin.module.css';

interface Props {
  typeName: string;
  name: string;
  /** `YYYY-MM-DD`. */
  day: string;
  retentionPassed: boolean;
  retentionMonths: number;
  onClose: () => void;
  /** 지우기. `false` 를 돌려주면 창을 닫지 않고 오류를 보여 준다. */
  onConfirm: () => Promise<boolean>;
}

export function DeleteInquiryDialog({
  typeName,
  name,
  day,
  retentionPassed,
  retentionMonths,
  onClose,
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await onConfirm())) setError('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      closeDisabled={busy}
      width={460}
      title="이 문의를 삭제하시겠습니까?"
      footer={
        <>
          <Button variant="danger" size="sm" data-delete-ok="1" disabled={busy} onClick={() => void run()}>
            삭제
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            취소
          </Button>
        </>
      }
    >
      <p className={styles.modalDesc}>
        <b>
          {typeName} · {name} · {dotDate(day)} 등록
        </b>
        <br />
        {retentionPassed
          ? `등록일부터 ${retentionMonths}개월이 지난 글입니다. 삭제하면 개인정보가 파기됩니다.`
          : `아직 보관 기간(${retentionMonths}개월) 안의 글입니다. 상담이 진행 중일 수 있습니다.`}
      </p>
      <div className={styles.modalList}>
        지워지는 것 — 이름 · 연락처 · 이메일 · 회사명 · 문의 내용 · <b>답변과 추가 질문 전체</b>
        <br />
        남는 것 — 등록일과 문의 유형, 그리고 <b>연락처 해시</b>(같은 번호로 하루 3건을 넘겨 다시 쓰는 것을 막기
        위한 값입니다. 번호 자체는 남지 않습니다)
        <br />
        <b>되돌릴 수 없습니다.</b> 고객 목록에서 사라지고 비밀번호로도 열리지 않습니다.
      </div>
      {error ? <p className={styles.modalErr}>{error}</p> : null}
    </Dialog>
  );
}
