'use client';

/**
 * 삐용 주인 코드값 추가 · 수정(통합 방 · 대표 결정 2026-11-18).
 *
 * ★ 삐용 화면 API(명세 118 의 3 · 4)로 저장한다. 칸은 그 API 가 받는 것뿐이다 — 코드값 · 이름 · 순서.
 *   ERP 코드값의 「설명」 · 「사용타입」 칸은 삐용 표에 없다.
 * ★ 수정은 **이름 · 순서만** — 코드값은 바꾸지 않는다(다른 표 · 소스가 코드값으로 읽는다, 명세 2-1).
 * ★ 사용 여부는 여기서 고르지 않는다 — 표의 [사용 안 함] · [다시 사용] 이 한다(삐용 주소가 따로다).
 * ★ 삐용이 거절하면(권한 · 같은 코드값 …) 그 문구를 그대로 보인다 — ERP 가 미리 막지 않는다.
 *
 * ★ 2026-11-25 센터·기준관리 일관성 — 공통 팝업(`Dialog` · 아쿠아 제목줄 · 아래 가운데 [저장](주) [취소](보통)).
 *   종전 껍데기(facility ModalShell)의 [닫기] 는 [취소] 로 · 순서는 확인 먼저. 안내(blocked) · 오류는 본문 맨 위
 *   (codes.module.css 의 .blocked · .error). 바탕 누름 · ESC 로 닫힌다(저장 중에는 막는다 — closeDisabled).
 */
import { useState } from 'react';
import { Button, Dialog } from '@/components/ds';
import { Field, cf } from '@/features/facility/ModalShell';
import {
  CodesError,
  addBbiyongValue,
  bbiyongTypeLabel,
  saveBbiyongValue,
  type BbiyongCodeType,
  type BbiyongCodeValue,
} from './codes-model';
import styles from './codes.module.css';

interface Props {
  type: BbiyongCodeType;
  /** `null` 이면 추가다. */
  value: BbiyongCodeValue | null;
  onClose: () => void;
  onSaved: () => void;
}

export function BbiyongValueDialog({ type, value, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    cdV: value?.cdV ?? '',
    cdVMeaning: value?.cdVMeaning ?? '',
    sortSeq: value?.sortSeq !== null && value?.sortSeq !== undefined ? String(value.sortSeq) : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const set = (key: 'cdV' | 'cdVMeaning' | 'sortSeq') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      const input = { category: type.category, cdTp: type.cdTp, ...form };
      await (value ? saveBbiyongValue(input) : addBbiyongValue(input));
      onSaved();
    } catch (err) {
      /* ★ 409 = 삐용이 받지 않았다 — 삐용 문구 그대로. */
      if (err instanceof CodesError && err.inUse) setBlocked(err.message);
      else setError(err instanceof CodesError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeDisabled={busy}
      title={value ? '코드값 수정' : '코드값 추가'}
      description={`삐용 · ${bbiyongTypeLabel(type)}`}
      footer={
        <>
          <Button variant="primary" size="sm" disabled={busy || form.cdVMeaning.trim() === '' || form.cdV.trim() === ''} onClick={() => void submit()}>
            저장
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            취소
          </Button>
        </>
      }
    >
      {/*
        ★ 안내와 오류를 **가른다.** 「쓰고 있어서 못 지웁니다」는 운영자가 잘못한 것이
          아니라 지금 상태가 그런 것이다 — 붉은 오류로 그리면 고장처럼 읽힌다.
      */}
      {blocked ? (
        <p className={styles.blocked} role="status" data-facility-blocked="1">
          {blocked}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.grid2}>
        <Field label="코드값">
          <input className={cf.input} value={form.cdV} onChange={set('cdV')} disabled={value !== null} autoFocus={value === null} />
        </Field>
        <Field label="코드값 이름">
          <input className={cf.input} value={form.cdVMeaning} onChange={set('cdVMeaning')} autoFocus={value !== null} />
        </Field>
        <Field label="순서">
          <input
            className={cf.input}
            value={form.sortSeq}
            onChange={set('sortSeq')}
            inputMode="numeric"
            placeholder={value ? '비우면 그대로' : '비우면 마지막'}
          />
        </Field>
      </div>
      <p className={styles.formNote}>
        이 코드의 주인은 <b>삐용</b>입니다 — 삐용 표에 저장됩니다. 코드값은 만든 뒤 바꿀 수 없고 이름 · 순서만
        고칩니다. 지우는 대신 표의 [사용 안 함]을 씁니다.
      </p>
    </Dialog>
  );
}
