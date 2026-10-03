'use client';

/** @screen s030100030p1 분류 등록·수정 · 010 기준설정 */

/**
 * 분류(머리) 등록·수정.
 *
 * ★ 칸은 레거시 `AddCategoryDialog` 와 **같다** — 분류 키 · 이름. 설명 칸을 하나 더
 *   두었다(레거시 API 는 `description` 을 받는데 화면에 칸이 없었다).
 *
 * ★★ **분류 키는 만든 뒤 바꿀 수 없다.** `'ROOM_TP'` 처럼 소스에 문자열로 박히는 값이라
 *    (`routes/lookups.ts` 의 `CONTRACT_FORM_CODES` 등) 바꾸면 그 자리들이 조용히
 *    빈 목록을 받는다. 그래서 수정일 때는 칸을 잠근다.
 *
 * ★ 등록하면 **공통(000) 파티션이 함께 생긴다**(`routes/codes.ts`). 안 만들면 코드를
 *   담을 자리가 없다 — 라인의 FK 가 파티션을 가리킨다.
 *
 * ★ 레거시는 `.toUpperCase()` 만 하고 모양을 보지 않았다. 공백·한글이 들어가면 그 분류를
 *   문자열로 부르는 자리가 전부 깨진다 — 서버가 모양을 보고 400 을 돌려준다.
 */
import { useState } from 'react';
import { Field, ModalShell, cf } from '@/features/facility/ModalShell';
import { CodesError, createMaster, saveMaster, type CodeMaster } from './codes-model';
import styles from './codes.module.css';

interface Props {
  /** `null` 이면 신규다. */
  master: CodeMaster | null;
  onClose: () => void;
  onSaved: () => void;
}

export function MasterDialog({ master, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    category: master?.category ?? '',
    name: master?.name ?? '',
    description: master?.description ?? '',
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
      if (master) {
        await saveMaster(master.category, { name: form.name, description: form.description });
      } else {
        await createMaster({
          /* ★ 보내기 전에 대문자로 — 서버도 올리지만 화면이 보여 준 것과 저장이 같게. */
          category: form.category.trim().toUpperCase(),
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
      title={master ? '분류코드 수정' : '분류코드 추가'}
      desc={master ? master.category : '분류코드를 만들면 공통(000) 사용타입이 함께 생깁니다'}
      busy={busy}
      error={error}
      blocked={blocked}
      okLabel="저장"
      okDisabled={form.name.trim() === '' || (!master && form.category.trim() === '')}
      onClose={onClose}
      onOk={submit}
    >
      <div className={styles.grid2}>
        <Field label="분류코드">
          <input
            className={cf.input}
            value={form.category}
            onChange={set('category')}
            placeholder="ROOM_TP"
            /* ★★ 만든 뒤에는 못 바꾼다 — 소스에 박히는 값이다. */
            disabled={master !== null}
            autoFocus={master === null}
          />
        </Field>
        <Field label="분류코드명">
          <input
            className={cf.input}
            value={form.name}
            onChange={set('name')}
            placeholder="계약타입"
            autoFocus={master !== null}
          />
        </Field>
        <Field label="설명" full>
          <input
            className={cf.input}
            value={form.description}
            onChange={set('description')}
            placeholder="호실 관리 · 계약 폼이 쓴다"
          />
        </Field>
      </div>

      <p className={styles.formNote}>
        {master
          ? '분류코드는 바꿀 수 없습니다 — 소스에 문자열로 박혀 있어서, 바꾸면 그 분류코드를 읽는 화면이 빈 목록을 받습니다.'
          : '분류코드는 영문 대문자로 시작하고 영문 대문자·숫자·밑줄만 쓸 수 있습니다. 만든 뒤에는 바꿀 수 없습니다.'}
      </p>
    </ModalShell>
  );
}
