'use client';

/** @screen s030100030p3 코드 등록·수정 · 010 기준설정 */

/**
 * 코드값 등록·수정.
 *
 * ★ 칸은 레거시 `AddCodeDialog`·`CodeTable` 의 인라인 편집과 **같다** — 코드값 · 이름 ·
 *   순서 · 사용여부. 설명 칸을 하나 더 두었다(레거시 API 는 받는데 칸이 없었다).
 *   레거시의 **사용용도(use_tp) 칸은 없다** — 파티션이 자리를 가지므로 이 폼에는 올
 *   이유가 없다. 레거시의 **부모 코드 칸도 없다**(2단 계층을 옮기지 않기로 했다).
 *
 * ★ 레거시는 인라인 편집이었다. 우리는 센터 관리와 같이 **팝업**이다 — 모양을 맞추라는
 *   지시이고, 60px 행에 입력칸 여섯을 넣으면 표가 폼이 된다.
 *
 * =============================================================================
 * ★★★ 이름은 **언제나** 바뀐다. 코드값·사용여부는 쓰이는 중이면 잠긴다
 * =============================================================================
 * 업무 자료는 코드 문자열만 담는다(`spaces.room_type = 'R1'`). 그래서
 *   · 이름을 고치면 → 그 코드를 쓰는 화면에 **바로** 반영된다. 자료는 건드려지지 않는다
 *   · 코드값을 고치면 → 그 자료가 길을 잃는다. **막는다**
 *   · 끄면(`is_active=false`) → `listCodes()` 가 켜진 것만 읽으므로 기존 자료가 이름을
 *     잃는다. 지우지 않았는데 깨지는 자리라 **삭제와 같이 막는다**
 *
 * ★ 판정은 서버가 한다(`routes/codes.ts`). 화면은 목록에 실려 온 `usage`·`pinnedBy` 로
 *   칸을 미리 잠그고 이유를 적는다 — 두 곳이 따로 판정하면 화면은 통과시키는데 저장이
 *   막힌다(센터 관리의 「입주 가능 회사 수」에서 겪은 그대로).
 */
import { useState } from 'react';
import { Field, ModalShell, cf } from '@/features/facility/ModalShell';
import {
  CodesError,
  codeLockReason,
  codeLocked,
  createLine,
  saveLine,
  type CodeLine,
  type CodePartition,
} from './codes-model';
import styles from './codes.module.css';

interface Props {
  category: string;
  /**
   * 고를 수 있는 사용타입들.
   *
   * ★ 2026-10-03 개편으로 **사용타입이 미리 정해져 있지 않다** — 왼쪽에서 분류코드만
   *   고르므로, 새 코드값을 어느 사용타입에 넣을지 이 폼이 물어야 한다.
   */
  partitions: readonly CodePartition[];
  /** `null` 이면 신규다. */
  line: CodeLine | null;
  onClose: () => void;
  onSaved: () => void;
}

export function LineDialog({ category, partitions, line, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    /* 신규는 공통(000)을 기본으로 — 24개 분류가 그것 하나뿐이다. */
    useTp: line?.useTp ?? partitions.find((p) => p.useTp === '000')?.useTp ?? partitions[0]?.useTp ?? '000',
    code: line?.code ?? '',
    name: line?.name ?? '',
    description: line?.description ?? '',
    sortOrder: line ? String(line.sortOrder) : '',
    isActive: line?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  /** 신규는 잠글 것이 없다. 수정이면 쓰임·앱 상수·시스템 여부로 잠근다. */
  const locked = line !== null && codeLocked(line);
  const lockWhy = line !== null ? codeLockReason(line) : null;

  const set = (key: 'code' | 'name' | 'description' | 'sortOrder') =>
    (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      if (line) {
        await saveLine(line.lineId, {
          code: form.code.trim(),
          name: form.name,
          description: form.description,
          sortOrder: form.sortOrder,
          isActive: form.isActive,
        });
      } else {
        await createLine(category, form.useTp, {
          code: form.code.trim(),
          name: form.name,
          description: form.description,
          sortOrder: form.sortOrder,
        });
      }
      onSaved();
    } catch (err) {
      /* ★ 409 는 안내다 — 「쓰고 있어서 못 바꿉니다」는 운영자가 잘못한 것이 아니다. */
      if (err instanceof CodesError && err.inUse) setBlocked(err.message);
      else setError(err instanceof CodesError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={line ? '코드값 수정' : '코드값 추가'}
      desc={line ? `${category}/${line.useTp}` : category}
      busy={busy}
      error={error}
      blocked={blocked}
      okLabel="저장"
      okDisabled={form.name.trim() === '' || form.code.trim() === ''}
      onClose={onClose}
      onOk={submit}
    >
      <div className={styles.grid2}>
        {/*
          ★ 사용타입 — **신규일 때만 고른다.** 수정에서 사용타입을 옮기면 그 코드값을
            쓰는 자료가 다른 목록으로 건너가는 것이라, 옮기는 길을 열지 않는다
            (옮기려면 지우고 다시 만든다).
        */}
        <Field label="사용타입" full>
          {line ? (
            <input className={cf.input} value={`${line.useTpName} (${line.useTp})`} disabled />
          ) : (
            <select
              className={cf.input}
              value={form.useTp}
              onChange={(e) => setForm((f) => ({ ...f, useTp: e.target.value }))}
            >
              {partitions.map((p) => (
                <option key={p.useTp} value={p.useTp}>
                  {p.name} ({p.useTp})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="코드값">
          <input
            className={cf.input}
            value={form.code}
            onChange={set('code')}
            placeholder="R1"
            disabled={locked}
            autoFocus={line === null}
          />
        </Field>
        <Field label="코드값 이름">
          <input
            className={cf.input}
            value={form.name}
            onChange={set('name')}
            placeholder="1인실"
            /* ★★ 잠그지 않는다 — 이름은 언제나 바꿀 수 있어야 한다. */
            autoFocus={line !== null}
          />
        </Field>
        <Field label="순서">
          <input
            className={cf.input}
            value={form.sortOrder}
            onChange={set('sortOrder')}
            inputMode="numeric"
            placeholder={line ? undefined : '비우면 마지막'}
          />
        </Field>
        <Field label="사용여부">
          <select
            className={cf.input}
            value={form.isActive ? 'on' : 'off'}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'on' }))}
            /* ★ 끄는 것이 막히는 자리다. 켜는 것은 언제나 되지만, 칸을 하나만 두고
                 잠근다 — 켜진 코드를 못 끄는 것이지 끈 코드를 못 켜는 것이 아니다.
                 (끈 코드는 `usage` 가 0 이라 자연히 잠기지 않는다.) */
            disabled={locked && form.isActive}
          >
            <option value="on">사용</option>
            <option value="off">사용 안 함</option>
          </select>
        </Field>
        <Field label="설명" full>
          <input
            className={cf.input}
            value={form.description}
            onChange={set('description')}
            placeholder=""
          />
        </Field>
      </div>

      {lockWhy ? (
        <p className={styles.blocked}>{lockWhy}</p>
      ) : (
        <p className={styles.formNote}>
          코드값은 공백 없이 1~20자입니다. <b>이름은 언제나 바꿀 수 있고</b>, 고치면 이 코드를
          쓰는 화면에 바로 반영됩니다. 코드값과 사용여부는 업무 자료가 쓰고 있으면 바꿀 수
          없습니다 — 자료가 코드값으로만 연결돼 있어서입니다.
        </p>
      )}
    </ModalShell>
  );
}
