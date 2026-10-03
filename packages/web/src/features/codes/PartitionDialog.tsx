'use client';

/** @screen s030100030p2 파티션 등록·수정 · 010 기준설정 */

/**
 * 파티션 등록·수정 — **레거시에 없던 화면이다.**
 *
 * ★★ 레거시는 `use_tp` 를 코드 행마다 **자유 텍스트 3자**로 받았다
 *    (`CodeTable.tsx`, `placeholder="예: WEB"`). 실데이터 규약은 숫자 `000`/`001`/`002`
 *    인데도 막을 근거가 스키마에 없었기 때문이다(`doc/CODE_MASTER_ANALYSIS.md` §E-4).
 *    013 이 파티션 표를 만들고 FK 를 걸어 근거가 생겼다 — 이제 **존재하는 파티션만**
 *    코드가 참조할 수 있고, 파티션은 여기서 만든다(사용자 결정 2026-10-03).
 *
 * ★ 파티션 번호(`use_tp`)는 만든 뒤 바꿀 수 없다. 코드 행들이 FK 로 매달려 있고,
 *   `ON UPDATE CASCADE` 가 걸려 있어 DB 는 따라오지만 — 앱 상수(`useTp: '000'`)는
 *   따라오지 않는다. 바꾸는 길을 열면 그 어긋남이 조용히 생긴다.
 *
 * ★ 파티션은 **형제**다. `001` 이 `000` 을 물려받지 않는다 — 폼 아래에 적어 둔다.
 *   운영자가 상속으로 읽으면 `001` 에 공통 코드를 다시 적지 않아 목록이 비어 보인다.
 */
import { useState } from 'react';
import { Field, ModalShell, cf } from '@/features/facility/ModalShell';
import { CodesError, createPartition, savePartition, type CodePartition } from './codes-model';
import styles from './codes.module.css';

interface Props {
  category: string;
  /** `null` 이면 신규다. */
  partition: CodePartition | null;
  onClose: () => void;
  onSaved: () => void;
}

export function PartitionDialog({ category, partition, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    useTp: partition?.useTp ?? '',
    name: partition?.name ?? '',
    description: partition?.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      if (partition) {
        await savePartition(category, partition.useTp, {
          name: form.name,
          description: form.description,
        });
      } else {
        await createPartition(category, {
          useTp: form.useTp.trim(),
          name: form.name,
          description: form.description,
        });
      }
      onSaved();
    } catch (err) {
      if (err instanceof CodesError && err.inUse) setBlocked(err.message);
      else setError(err instanceof CodesError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={partition ? '파티션 수정' : '파티션 등록'}
      desc={partition ? `${category}/${partition.useTp}` : category}
      busy={busy}
      error={error}
      blocked={blocked}
      okLabel="저장"
      okDisabled={form.name.trim() === '' || (!partition && form.useTp.trim() === '')}
      onClose={onClose}
      onOk={submit}
    >
      <div className={styles.grid2}>
        <Field label="파티션 번호">
          <input
            className={cf.input}
            value={form.useTp}
            onChange={set('useTp')}
            placeholder="001"
            inputMode="numeric"
            maxLength={3}
            /* ★ 만든 뒤에는 못 바꾼다 — 코드 행이 FK 로 매달려 있고 앱 상수가 따라오지 않는다. */
            disabled={partition !== null}
            autoFocus={partition === null}
          />
        </Field>
        <Field label="파티션 이름">
          <input
            className={cf.input}
            value={form.name}
            onChange={set('name')}
            placeholder="납부관리용"
            autoFocus={partition !== null}
          />
        </Field>
        <Field label="설명 — 어느 화면이 쓰는가" full>
          <input
            className={cf.input}
            value={form.description}
            onChange={set('description')}
            placeholder="납부 관리 화면"
          />
        </Field>
      </div>

      <p className={styles.formNote}>
        파티션 번호는 숫자 3자입니다(`000` 이 공통). 파티션은 서로 <b>독립된 목록</b>이라{' '}
        `001` 은 `000` 의 코드를 물려받지 않습니다 — 필요한 코드를 그 파티션에 다시 넣어야
        합니다. 이름은 <b>파티션이 무엇인지</b>를, 설명은 <b>어느 화면이 쓰는지</b>를 적습니다.
        {partition ? ' 파티션 번호는 바꿀 수 없습니다.' : ''}
      </p>
    </ModalShell>
  );
}
