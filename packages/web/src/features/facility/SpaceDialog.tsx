'use client';

/** @screen s030100010p3 호실 등록·수정 · 010 기준설정 */

/**
 * 호실 등록·수정 — **한 실씩** 다룬다(결정 2026-10-03).
 *
 * ★ 레거시는 「여러 행을 고치고 [저장] 한 번」인 표였다. 화면일람·삐용 시드에 적힌 설계가
 *   팝업이라 팝업으로 만들었다. 여러 실을 정리할 때 클릭이 늘어나는 것은 그 결정의 값이다.
 *
 * ★★ 칸은 레거시 + **넷**이다(결정 2026-10-03): 평수 · 정원 · 보증금 · 「사용 여부」.
 *    보증금은 계약에 쓰는 값인데 지금까지 어느 화면에서도 고칠 수 없었다.
 *    `amenities`(jsonb)는 **넣지 않았다** — 읽는 코드가 없고 72행 전부 비어 있어 입력
 *    모양을 지어낼 근거가 없다(같은 결정).
 *
 * ★★★ **「사용 안 함」은 삭제가 아니다.** 끄면 계약 폼의 호실 목록에서 사라지고
 *    (`db/lookups.ts` 가 `is_active = true` 로 거른다) 지난 계약서는 그대로 남는다.
 *    계약 이력이 있는 호실을 정리하는 **유일한 길**이다 — 삭제는 서버가 막는다.
 *
 * ★ `room_no` 는 칸이 없다. 12자리 16진 기계값이고 서버가 만든다(`db/facility.ts`).
 *
 * =============================================================================
 * ★★★ 호실상태는 **고칠 수 없다** — 계약이 정한다 (결정 2026-10-03)
 * =============================================================================
 * 2026-10-03 까지 여기 Select 가 있었는데 **아무도 쓰지 않았고**, 그래서 확정 계약이
 * 살아 있는 방까지 72실 전부 「공실」이었다. 이제 계약 확정·종료·취소가 상태를 정하고
 * (`db/spaceStatus.ts`) 손으로 바꾸는 길은 없앴다 — 둘이 갈리면 어느 쪽이 참인지
 * 아무도 모르기 때문이다. **계약과 어긋나면 계약이 맞다.**
 *
 * ★ 칸 자체는 남긴다(읽기 전용). 「지금 이 방이 어떤 상태인가」는 이 팝업에서 보고 싶은
 *   값이고, 왜 못 고치는지도 한 줄로 적어 둔다 — 칸이 사라지면 「없어졌다」로 읽힌다.
 */
import { useState } from 'react';
import {
  FacilityError,
  SPACE_STATUS_EMPTY,
  area,
  codeName,
  codesOf,
  saveSpace,
  spaceBlockReason,
  type CodeItem,
  type Space,
} from './facility-model';
import {
  DEFAULT_MAX_COMPANIES,
  MIN_MAX_COMPANIES,
  warnVirtualShared,
} from '@swonbiz/shared/domain/space-occupancy';
import { Field, ModalShell, MoneyInput, cf, moneyValue } from './ModalShell';
import styles from './facility.module.css';

interface Props {
  floorId: string;
  floorLabel: string;
  codes: readonly CodeItem[];
  /** `null` 이면 신규다. */
  space: Space | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SpaceDialog({ floorId, floorLabel, codes, space, onClose, onSaved }: Props) {
  const types = codesOf(codes, 'ROOM_TP');
  /* ★ 고르는 목록이 아니라 **이름을 붙이려고** 읽는다 — 상태는 계약이 정한다. */
  const statusName = codeName(codes, 'ROOM_ST', space?.status ?? SPACE_STATUS_EMPTY);

  const [form, setForm] = useState({
    roomName: space?.roomName ?? '',
    roomType: space?.roomType ?? types[0]?.code ?? '',
    bizAddrAvailable: space?.bizAddrAvailable ?? false,
    standardFee: moneyValue(space?.standardFee),
    deposit: moneyValue(space?.deposit),
    /* ★ `12.50` 이 아니라 `12.5` 다 — 꼬리의 0 은 numeric 의 자릿수일 뿐이다. */
    areaSqm: area(space?.areaSqm),
    capacity: space?.capacity === null || space?.capacity === undefined ? '' : String(space.capacity),
    /*
     * 「입주 가능 회사 수」 — ★ 새 호실은 **1** 로 시작한다. 빈 칸으로 두면 서버가
     *   기본값을 넣는데, 그러면 「몇 곳인지 안 정한 호실」이 생긴 것처럼 보인다.
     */
    maxCompanies: String(space?.maxCompanies ?? DEFAULT_MAX_COMPANIES),
    memo: space?.memo ?? '',
    isActive: space?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  /*
   * ★ 계약 이력이 있는 호실이면 **왜 지울 수 없는지 여기서 미리 알려 준다.** 「사용 안 함」
   *   체크 옆에 두는 것이 맞는 자리다 — 지우려던 사람이 대안을 바로 본다.
   */
  const blocked = space ? spaceBlockReason(space) : null;

  /*
   * ★★ 「입주 가능 회사 수」는 **1 이상**이다. 0 이면 아무도 고를 수 없는 방이 된다.
   *    서버도 400 으로 막고 DB 에도 CHECK 가 있지만, 누르기 전에 말해 주는 쪽이 낫다.
   */
  const maxNumber = Number(form.maxCompanies.trim());
  const maxValid =
    form.maxCompanies.trim() !== '' && Number.isInteger(maxNumber) && maxNumber >= MIN_MAX_COMPANIES;

  /*
   * ★ 비상주를 2 이상으로 열면 **막지 않고 알린다** — 같은 주소로 사업자가 여럿
   *   등록된다는 사실을 운영자가 알고 고르는 것과 모르고 고르는 것은 다르다.
   *   판정은 코드에 박히지 않고 규칙 파일에 있다(`warnVirtualShared`).
   */
  const virtualWarning = maxValid ? warnVirtualShared(form.roomType, maxNumber) : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveSpace(space?.spaceId ?? null, { ...form, floorId });
      onSaved();
    } catch (err) {
      setError(err instanceof FacilityError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={space ? '호실 수정' : '호실 등록'}
      desc={floorLabel}
      busy={busy}
      error={error}
      okLabel="저장"
      okDisabled={form.roomType === '' || !maxValid}
      onClose={onClose}
      onOk={submit}
    >
      <div className={styles.grid2}>
        <Field label="호실명">
          <input className={cf.input} value={form.roomName} onChange={set('roomName')} placeholder="301호" autoFocus />
        </Field>
        <Field label="계약구분">
          <select className={cf.select} value={form.roomType} onChange={set('roomType')}>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="호실상태">
          {/* ★ 읽기 전용이다. 계약이 정한다 — 머리말 참고. */}
          <input className={cf.input} value={statusName} readOnly disabled />
        </Field>
        <Field label="월임대료 (원)">
          <MoneyInput value={form.standardFee} onChange={(v) => setForm((f) => ({ ...f, standardFee: v }))} />
        </Field>
        <Field label="보증금 (원)">
          <MoneyInput value={form.deposit} onChange={(v) => setForm((f) => ({ ...f, deposit: v }))} />
        </Field>
        <Field label="평수">
          <input className={cf.input} value={form.areaSqm} onChange={set('areaSqm')} inputMode="decimal" />
        </Field>
        <Field label="정원 (명)">
          <input className={cf.input} value={form.capacity} onChange={set('capacity')} inputMode="numeric" />
        </Field>
        {/*
          ★★ 「건수」가 아니라 「회사 수」다 — 한 회사가 이 호실을 두 계약으로 잡아도
             1곳이다(`domain/space-occupancy`). 「건수」로 적으면 계약서 장수로 읽힌다.
        */}
        <Field label="입주 가능 회사 수">
          <input
            className={cf.input}
            value={form.maxCompanies}
            onChange={set('maxCompanies')}
            inputMode="numeric"
          />
        </Field>
      </div>

      <p className={cf.modalDesc} style={{ marginTop: -4, textAlign: 'left' }}>
        이 호실에 몇 곳까지 계약할 수 있는지입니다. 한 회사의 계약 여럿은 1곳으로 셉니다.
      </p>
      {maxValid ? null : (
        <p className={styles.blocked} role="status">
          입주 가능 회사 수는 {MIN_MAX_COMPANIES} 이상의 숫자여야 합니다
        </p>
      )}
      {virtualWarning ? (
        <p className={styles.blocked} role="status">
          {virtualWarning}
        </p>
      ) : null}

      <div className={styles.section}>
        <div className={styles.checks}>
          <label>
            <input
              type="checkbox"
              checked={form.bizAddrAvailable}
              onChange={(e) => setForm((f) => ({ ...f, bizAddrAvailable: e.target.checked }))}
            />{' '}
            사업자 주소 제공
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />{' '}
            사용함
          </label>
        </div>
        {/* ★ 끄면 무슨 일이 일어나는지 적어 둔다 — 「삭제」로 오해하지 않게. */}
        <p className={cf.modalDesc} style={{ marginTop: 8, textAlign: 'left' }}>
          「사용함」을 끄면 새 계약의 호실 목록에 나오지 않습니다. 지난 계약서는 그대로 남습니다.
        </p>
        {blocked ? (
          <p className={styles.blocked} role="status">
            {blocked}
          </p>
        ) : null}
      </div>

      <div className={styles.section}>
        <Field label="비고" full>
          <textarea className={cf.textarea} rows={2} value={form.memo} onChange={set('memo')} />
        </Field>
      </div>
    </ModalShell>
  );
}
