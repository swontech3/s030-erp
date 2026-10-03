'use client';

/** @screen s030100030p4 삭제 확인 · 010 기준설정 */

/**
 * 분류코드 · 사용타입 · 코드값 삭제 확인.
 *
 * ★★ **삭제 확인은 이 창 하나다**(사용자 지시 2026-10-03: 「같은 일을 두 곳에서 하지
 *    않게 할 것」). 따로 `confirm()` 을 띄우지 않는다 — 이 창이 이미 확인 창이고,
 *    브라우저 기본 창은 **무엇이 지워지는지·왜 못 지우는지**를 담을 자리가 없다.
 *    레거시가 그 `confirm("이 코드를 삭제하시겠습니까?")` 였다.
 *
 * ★★★ **막는 판정은 서버가 한다.** 여기서 미리 이유를 보여 주는 것은 편의이고, [삭제] 를
 *    눌러도 서버가 409 를 돌려주면 그 문구를 **안내로** 그린다(오류 아님).
 *
 * ★ 지우는 순서가 있다: 코드값 → 사용타입 → 분류코드. 아래에서 위로만 비워진다.
 *   그 이유를 문구에 담는다 — 「사용타입을 먼저 지워 주세요」.
 *
 * ★★ 2026-10-03 — **「시스템이라서 못 지운다」가 없어졌다**(사용자 결정). 남은 차단은
 *    자료가 바로 깨지는 둘뿐이다: 쓰고 있는 코드값 · 앱이 직접 쓰는 코드값.
 */
import { useState } from 'react';
import { ModalShell } from '@/features/facility/ModalShell';
import {
  CodesError,
  lineBlockReason,
  masterBlockReason,
  partitionBlockReason,
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

/**
 * 무엇을 지우는가 — 제목·묻는 말·미리 아는 차단 이유.
 *
 * ★★ 묻는 말은 **「{이름}({값})를 삭제하시겠습니까?」** 한 모양이다(사용자 지시
 *    2026-10-03). 무엇이 지워지는지 **이름과 값이 둘 다** 들어가야 한다 — 「삭제
 *    하시겠습니까?」만 띄우면 잘못 고른 행을 그대로 지운다.
 */
function describe(t: DeleteTarget): { title: string; ask: string; blocked: string | null } {
  switch (t.kind) {
    case 'master':
      return {
        title: '분류코드 삭제',
        ask: `${t.master.name}(${t.master.category})를 삭제하시겠습니까?`,
        blocked: masterBlockReason(t.master),
      };
    case 'partition':
      return {
        title: '사용타입 삭제',
        ask: `${t.partition.name}(${t.partition.useTp})를 삭제하시겠습니까?`,
        blocked: partitionBlockReason(t.partition),
      };
    default:
      return {
        title: '코드값 삭제',
        ask: `${t.line.name}(${t.line.code})를 삭제하시겠습니까?`,
        blocked: lineBlockReason(t.line),
      };
  }
}

export function DeleteCodeDialog({ target, onClose, onDeleted }: Props) {
  const { title, ask, blocked: known } = describe(target);
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
      desc={ask}
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
