'use client';

/** @screen s030100030p4 삭제 확인 · 010 기준설정 */

/**
 * 분류 · 파티션 · 코드값 삭제 확인.
 *
 * ★ 레거시는 `confirm("이 코드를 삭제하시겠습니까?")` 였다. 브라우저 기본 창은 무엇이
 *   지워지는지·왜 못 지우는지를 담을 자리가 없다 — 센터 관리와 같이 팝업으로 간다.
 *
 * ★★★ **막는 판정은 서버가 한다.** 여기서 미리 이유를 보여 주는 것은 편의이고, [삭제] 를
 *    눌러도 서버가 409 를 돌려주면 그 문구를 **안내로** 그린다(오류 아님).
 *
 * ★ 지우는 순서가 있다: 코드값 → 파티션 → 분류. 아래에서 위로만 비워진다. 그 이유를
 *   문구에 담는다 — 「파티션을 먼저 지워 주세요」.
 */
import { useState } from 'react';
import { ModalShell } from '@/features/facility/ModalShell';
import {
  CodesError,
  lineBlockReason,
  masterBlockReason,
  partitionBlockReason,
  partitionLabel,
  removeLine,
  removeMaster,
  removePartition,
  type CodeLine,
  type CodeMaster,
  type CodePartition,
} from './codes-model';
import styles from './codes.module.css';

export type DeleteTarget =
  | { kind: 'master'; master: CodeMaster }
  | { kind: 'partition'; partition: CodePartition }
  | { kind: 'line'; line: CodeLine; category: string; useTp: string };

interface Props {
  target: DeleteTarget;
  onClose: () => void;
  onDeleted: () => void;
}

/** 무엇을 지우는가 — 제목·설명·미리 아는 차단 이유. */
function describe(t: DeleteTarget): { title: string; what: string; blocked: string | null } {
  switch (t.kind) {
    case 'master':
      return {
        title: '분류 삭제',
        what: `${t.master.name} (${t.master.category})`,
        blocked: masterBlockReason(t.master),
      };
    case 'partition':
      return {
        title: '파티션 삭제',
        what: `${t.partition.category} · ${partitionLabel(t.partition)}`,
        blocked: partitionBlockReason(t.partition),
      };
    default:
      return {
        title: '코드 삭제',
        what: `${t.category}/${t.useTp} · ${t.line.code} ${t.line.name}`,
        blocked: lineBlockReason(t.line),
      };
  }
}

export function DeleteCodeDialog({ target, onClose, onDeleted }: Props) {
  const { title, what, blocked: known } = describe(target);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 서버가 돌려준 차단 사유. ★ 미리 안 것(`known`)보다 이쪽이 정확하다. */
  const [blocked, setBlocked] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      if (target.kind === 'master') await removeMaster(target.master.category);
      else if (target.kind === 'partition')
        await removePartition(target.partition.category, target.partition.useTp);
      else await removeLine(target.line.lineId);
      onDeleted();
    } catch (err) {
      if (err instanceof CodesError && err.inUse) setBlocked(err.message);
      else setError(err instanceof CodesError ? err.message : '지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  const why = blocked ?? known;

  return (
    <ModalShell
      title={title}
      desc={what}
      busy={busy}
      error={error}
      blocked={why}
      okLabel="삭제"
      okDanger
      okDisabled={why !== null}
      onClose={onClose}
      onOk={submit}
    >
      {why === null ? (
        <p className={styles.formNote}>
          지우면 되돌릴 수 없습니다.
          {target.kind === 'line'
            ? ' 이 코드값을 쓰는 업무 자료는 없습니다 — 쓰고 있으면 서버가 막습니다.'
            : ''}
        </p>
      ) : null}
    </ModalShell>
  );
}
