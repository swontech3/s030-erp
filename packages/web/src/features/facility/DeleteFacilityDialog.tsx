'use client';

/** @screen s030100010p5 삭제 확인 · 010 기준설정 */

/**
 * 삭제 확인 — 건물 · 층 · 호실 · 회의실 넷이 **이 한 창**을 쓴다.
 *
 * ★ 확인 창을 넷으로 나누지 않았다. 다른 것은 문구뿐이고 구조가 같다 — 계약 폼의
 *   `ConfirmDialog` 가 3종을 하나로 낸 것과 같은 이유다.
 *
 * =============================================================================
 * ★★★ 막는 것은 **서버다** — 이 창은 미리 알려 주기만 한다
 * =============================================================================
 * `blocked` 가 있으면 [삭제] 버튼을 아예 비활성으로 둔다. 그래도 서버가 다시 센다
 * (`routes/facility.ts`) — 화면이 아는 값은 목록을 받은 시점의 것이고, 그 사이에 계약이
 * 하나 생길 수 있다. 서버가 409 로 막으면 그 문구를 여기 그대로 띄운다.
 *
 * ★ 409 는 **오류가 아니다.** 붉게 그리지 않는다 — 운영자가 잘못한 것이 아니고, 해야 할
 *   일(「사용 안 함」으로 바꾸기)이 문구에 적혀 있다.
 */
import { useState } from 'react';
import { Button, Dialog } from '@/components/ds';
import { FacilityError } from './facility-model';
import { cf } from './ModalShell';
import styles from './facility.module.css';

export type DeleteKind = 'building' | 'floor' | 'space' | 'facility';

const WHAT: Record<DeleteKind, string> = {
  building: '건물',
  floor: '층',
  space: '호실',
  facility: '회의실',
};

interface Props {
  kind: DeleteKind;
  /** 지울 것의 이름 — 「우리빌딩」·「3층」·「301호」. */
  label: string;
  /** 누르기 전에 이미 아는 차단 사유. 있으면 [삭제] 를 막는다. */
  blocked: string | null;
  onClose: () => void;
  /** 실제 삭제. 던지면 이 창이 사유를 보여 준다. */
  onDelete: () => Promise<void>;
}

export function DeleteFacilityDialog({ kind, label, blocked, onClose, onDelete }: Props) {
  const [busy, setBusy] = useState(false);
  /** 서버가 409 로 막은 사유 — 화면이 몰랐던 경우다. */
  const [serverBlocked, setServerBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const what = WHAT[kind];
  const stop = blocked ?? serverBlocked;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      if (err instanceof FacilityError && err.inUse) {
        // ★ 쓰고 있어서 못 지운다 — 오류가 아니라 안내다.
        setServerBlocked(err.message);
      } else {
        setError(err instanceof FacilityError ? err.message : '지우지 못했습니다');
      }
    } finally {
      setBusy(false);
    }
  }

  /*
   * ★ 2026-11-25 센터·기준관리 일관성 — 공통 팝업 Dialog. 제목 = 짧은 이름(「호실 삭제」),
   *   묻는 문장은 본문 첫 줄 굵게. 아래 가운데 [삭제](지우기 · danger) [취소](보통).
   *   안내(blocked) · 오류 · 「지울 수 없습니다」 줄은 종전 껍데기와 같은 차례 · 같은 글자다.
   */
  return (
    <Dialog
      open
      onClose={onClose}
      closeDisabled={busy}
      title={`${what} 삭제`}
      description={
        <>
          <strong>{label} 을(를) 지우시겠습니까?</strong>
          {stop ? null : (
            <>
              <br />
              {what}이 영구히 지워집니다. 이 작업은 되돌릴 수 없습니다.
            </>
          )}
        </>
      }
      footer={
        <>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy || stop !== null}
            onClick={() => void submit()}
          >
            삭제
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            취소
          </Button>
        </>
      }
    >
      {stop || error ? (
      <div className={styles.dlgBody}>
        {/*
          ★ 안내와 오류를 **가른다.** 「쓰고 있어서 못 지웁니다」는 운영자가 잘못한 것이
            아니라 지금 상태가 그런 것이다 — 붉은 오류로 그리면 고장처럼 읽힌다.
        */}
        {stop ? (
          <p className={styles.dlgText} role="status" data-facility-blocked="1">
            {stop}
          </p>
        ) : null}
        {error ? (
          <p className={cf.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        {stop ? <p className={styles.dlgText}>지울 수 없습니다. 위 안내를 확인해 주세요.</p> : null}
      </div>
      ) : null}
    </Dialog>
  );
}
