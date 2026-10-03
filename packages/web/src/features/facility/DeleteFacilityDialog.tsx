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
import { FacilityError } from './facility-model';
import { ModalShell, cf } from './ModalShell';

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

  return (
    <ModalShell
      title={`${label} 을(를) 지우시겠습니까?`}
      desc={stop ? undefined : `${what}이 영구히 지워집니다. 이 작업은 되돌릴 수 없습니다.`}
      busy={busy}
      blocked={stop}
      error={error}
      okLabel="삭제"
      okDanger
      okDisabled={stop !== null}
      onClose={onClose}
      onOk={submit}
    >
      {stop ? (
        <p className={cf.modalDesc} style={{ textAlign: 'left' }}>
          지울 수 없습니다. 위 안내를 확인해 주세요.
        </p>
      ) : null}
    </ModalShell>
  );
}
