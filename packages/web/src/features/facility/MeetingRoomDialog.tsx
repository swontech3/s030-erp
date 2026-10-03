'use client';

/** @screen s030100010p4 회의실 등록·수정 · 010 기준설정 */

/**
 * 회의실 등록·수정.
 *
 * ★ 칸은 레거시 `MeetingRoomGrid` 와 **같다** — 회의실명\* · 수용인원 · 30분당 요금 ·
 *   운영시간 · 상태. 거기에 ERP 표가 가진 **최소·최대 예약시간**을 더했다(예약 화면이
 *   이미 읽는 값인데 지금까지 고칠 자리가 없었다).
 *
 * ★★ 운영시간을 **두 칸으로 가른다.** 레거시는 `06:00~24:00` 을 한 칸에 글로 받고
 *    정규식으로 검사했다. DB 는 `open_time`·`close_time` 두 칸이고, 한 칸으로 받으면
 *    「06:00~24:00」을 다시 쪼개야 한다 — 쪼개는 코드가 틀리면 예약이 안 되는 회의실이
 *    생긴다. `type="time"` 둘이면 브라우저가 모양을 지킨다.
 *
 * ★ `facility_type` 칸이 없다 — 이 화면이 다루는 것은 회의실이고 서버가 `'MEETING'` 으로
 *   넣는다(`db/facility.ts`). 다른 종류가 생기면 그때 칸을 만든다.
 */
import { useState } from 'react';
import { FacilityError, meetingRoomBlockReason, saveMeetingRoom, type MeetingRoom } from './facility-model';
import { Field, ModalShell, MoneyInput, cf, moneyValue } from './ModalShell';
import styles from './facility.module.css';

interface Props {
  floorId: string;
  floorLabel: string;
  /** `null` 이면 신규다. */
  room: MeetingRoom | null;
  onClose: () => void;
  onSaved: () => void;
}

/** 레거시 기본값과 같다(`DEFAULT_HOURS = '06:00~24:00'`). */
const DEFAULT_OPEN = '06:00';
const DEFAULT_CLOSE = '23:59';

export function MeetingRoomDialog({ floorId, floorLabel, room, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    name: room?.name ?? '',
    capacity: room?.capacity === null || room?.capacity === undefined ? '' : String(room.capacity),
    halfHourFee: moneyValue(room?.halfHourFee),
    /*
     * ★ `24:00` 은 `<input type="time">` 이 받지 못한다 — 레거시 기본값이 그 값이라
     *   그대로 쓰면 칸이 빈 채로 뜬다. 받아 온 값은 그대로 보여 주고, 없을 때만 23:59 다.
     */
    openTime: room?.openTime ?? DEFAULT_OPEN,
    closeTime: room?.closeTime ?? DEFAULT_CLOSE,
    minDuration: room?.minDuration === null || room?.minDuration === undefined ? '' : String(room.minDuration),
    maxDuration: room?.maxDuration === null || room?.maxDuration === undefined ? '' : String(room.maxDuration),
    isReservable: room?.isReservable ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const blocked = room ? meetingRoomBlockReason(room) : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveMeetingRoom(room?.facilityId ?? null, {
        ...form,
        floorId,
        /* ★ 상태 어휘는 예약 화면이 읽는 것과 같다 — `active` / `inactive`. */
        status: form.isReservable ? 'active' : 'inactive',
      });
      onSaved();
    } catch (err) {
      setError(err instanceof FacilityError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={room ? '회의실 수정' : '회의실 등록'}
      desc={floorLabel}
      busy={busy}
      error={error}
      okLabel="저장"
      okDisabled={form.name.trim() === ''}
      onClose={onClose}
      onOk={submit}
    >
      <div className={styles.grid2}>
        <Field label="회의실명" full>
          <input className={cf.input} value={form.name} onChange={set('name')} placeholder="회의실 A" autoFocus />
        </Field>
        <Field label="수용인원 (명)">
          <input className={cf.input} value={form.capacity} onChange={set('capacity')} inputMode="numeric" />
        </Field>
        <Field label="30분당 요금 (원)">
          <MoneyInput value={form.halfHourFee} onChange={(v) => setForm((f) => ({ ...f, halfHourFee: v }))} />
        </Field>
        <Field label="운영 시작">
          <input type="time" className={cf.input} value={form.openTime} onChange={set('openTime')} />
        </Field>
        <Field label="운영 종료">
          <input type="time" className={cf.input} value={form.closeTime} onChange={set('closeTime')} />
        </Field>
        <Field label="최소 예약시간 (분)">
          <input className={cf.input} value={form.minDuration} onChange={set('minDuration')} inputMode="numeric" />
        </Field>
        <Field label="최대 예약시간 (분)">
          <input className={cf.input} value={form.maxDuration} onChange={set('maxDuration')} inputMode="numeric" />
        </Field>
      </div>

      <div className={styles.section}>
        <div className={styles.checks}>
          <label>
            <input
              type="checkbox"
              checked={form.isReservable}
              onChange={(e) => setForm((f) => ({ ...f, isReservable: e.target.checked }))}
            />{' '}
            예약 받음
          </label>
        </div>
        <p className={cf.modalDesc} style={{ marginTop: 8, textAlign: 'left' }}>
          끄면 회의실 예약 화면에서 고를 수 없습니다. 이미 잡힌 예약은 그대로 남습니다.
        </p>
        {blocked ? (
          <p className={styles.blocked} role="status">
            {blocked}
          </p>
        ) : null}
      </div>
    </ModalShell>
  );
}
