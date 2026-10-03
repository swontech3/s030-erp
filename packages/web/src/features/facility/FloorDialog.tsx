'use client';

/** @screen s030100010p2 층 등록·수정 · 010 기준설정 */

/**
 * 층 등록·수정.
 *
 * ★ 칸은 레거시 `FloorForm` 과 **같다** — 층 번호\* · 층명 · 평수 · 월임대료 · 보증금 ·
 *   라운지/회의실/OA존 체크 3개.
 *
 * ★★ **층별 도면 첨부가 들어왔다**(2026-10-03). `tb_cm_file.target_type` 에 `'FLOOR'` 를
 *    더해서 계약 서류와 **같은 기계**로 붙인다 — 선택이고, 없어도 저장된다. 신규 등록일
 *    때 붙들었다가 저장 직후에 올리는 것까지 건물(p1)과 같다.
 *
 * ★ 층 번호는 **글자**다(`floor_no text`). 「B1」·「1」·「10」이 섞이므로 숫자 칸으로 두면
 *   지하층을 넣을 수 없다. 목록 정렬은 서버가 숫자로 읽히는 것만 숫자로 센다.
 */
import { useState } from 'react';
import { FacilityError, area, saveFloor, uploadFacilityFile, type Floor } from './facility-model';
import { AttachField } from './AttachField';
import { Field, ModalShell, MoneyInput, cf, moneyValue } from './ModalShell';
import styles from './facility.module.css';

interface Props {
  buildingId: string;
  buildingName: string;
  /** `null` 이면 신규다. */
  floor: Floor | null;
  onClose: () => void;
  onSaved: () => void;
}

export function FloorDialog({ buildingId, buildingName, floor, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    floorNo: floor?.floorNo ?? '',
    name: floor?.name ?? '',
    /* ★ `37.00` 이 아니라 `37` 로 보여 준다 — DB 가 numeric 이라 꼬리에 0 이 붙어 온다. */
    areaSqm: area(floor?.areaSqm),
    monthlyRent: moneyValue(floor?.monthlyRent),
    deposit: moneyValue(floor?.deposit),
    hasLounge: floor?.hasLounge ?? false,
    hasMeetingRoom: floor?.hasMeetingRoom ?? false,
    hasOaZone: floor?.hasOaZone ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 아직 층이 없어 붙들고 있는 도면. 저장 직후에 올린다. */
  const [doc, setDoc] = useState<File | null>(null);
  /** 이 창에서 방금 만든 층의 id — 건물(p1)과 같은 쓸모다. */
  const [savedId, setSavedId] = useState<string | null>(null);

  const targetId = floor?.floorId ?? savedId;

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const check = (key: 'hasLounge' | 'hasMeetingRoom' | 'hasOaZone') => (e: { target: { checked: boolean } }) =>
    setForm((f) => ({ ...f, [key]: e.target.checked }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await saveFloor(targetId, { ...form, buildingId });
      setSavedId(res.floorId);

      if (doc) {
        try {
          await uploadFacilityFile('floors', res.floorId, doc);
          setDoc(null);
        } catch (err) {
          /* ★ 층은 이미 저장됐다 — 무엇이 됐고 무엇이 안 됐는지 그대로 적는다. */
          const why = err instanceof FacilityError ? err.message : '파일을 올리지 못했습니다';
          setError(`층은 저장했습니다 — 첨부만 실패했습니다(${why}). 다시 [저장] 을 누르면 첨부만 올라갑니다`);
          return;
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof FacilityError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={floor ? '층 수정' : '층 등록'}
      desc={buildingName}
      busy={busy}
      error={error}
      okLabel="저장"
      okDisabled={form.floorNo.trim() === ''}
      /* ★ 이미 저장된 뒤에 닫으면 목록을 새로 받아야 한다 — 건물(p1)과 같은 이유다. */
      onClose={savedId ? onSaved : onClose}
      onOk={submit}
    >
      <div className={styles.grid2}>
        <Field label="층 번호">
          {/* ★ 글자다 — 「B1」을 넣을 수 있어야 한다. */}
          <input className={cf.input} value={form.floorNo} onChange={set('floorNo')} placeholder="3" autoFocus />
        </Field>
        <Field label="층명">
          <input className={cf.input} value={form.name} onChange={set('name')} placeholder="라운지층" />
        </Field>
        <Field label="평수">
          <input className={cf.input} value={form.areaSqm} onChange={set('areaSqm')} inputMode="decimal" />
        </Field>
        <Field label="월임대료 (원)">
          <MoneyInput value={form.monthlyRent} onChange={(v) => setForm((f) => ({ ...f, monthlyRent: v }))} />
        </Field>
        <Field label="보증금 (원)">
          <MoneyInput value={form.deposit} onChange={(v) => setForm((f) => ({ ...f, deposit: v }))} />
        </Field>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionTitle}>층 시설</p>
        <div className={styles.checks}>
          <label>
            <input type="checkbox" checked={form.hasLounge} onChange={check('hasLounge')} /> 라운지
          </label>
          <label>
            <input type="checkbox" checked={form.hasMeetingRoom} onChange={check('hasMeetingRoom')} /> 회의실
          </label>
          <label>
            <input type="checkbox" checked={form.hasOaZone} onChange={check('hasOaZone')} /> OA존
          </label>
        </div>
      </div>

      {/* 레거시 `FloorForm` 의 파일 칸. ★ 화면코드는 늘지 않는다 — p2 안의 칸이다. */}
      <AttachField kind="floors" targetId={targetId} pending={doc} onPending={setDoc} />
    </ModalShell>
  );
}
