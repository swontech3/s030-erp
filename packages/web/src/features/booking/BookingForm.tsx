'use client';

/**
 * 예약 등록 · 수정 · 상세 — **모달 하나, mode 3종**(시안 `03-booking-form.md`).
 *
 * =============================================================================
 * ★★ 왜 한 모달인가
 * =============================================================================
 * 등록·수정·상세는 보여 주는 것이 같다. 셋을 따로 만들면 「수정에만 빠진 칸」이 생기고,
 * 규칙도 세 곳에 흩어진다. 시안이 한 모달에 `mode` 만 다르게 둔 이유가 그것이다.
 *
 *   create  빈 칸을 끌거나 [예약 추가] → 「회의실 예약」 · [예약하기]
 *   edit    고칠 수 있는 블록을 클릭   → 「예약 수정」 · [저장] · [예약 취소]
 *   view    고칠 수 없는 블록을 클릭   → 「예약 상세」 · 전부 잠김
 *
 * ★★★ 검사는 **입력할 때마다** 돈다. 막히면 제출 버튼이 잠기고 첫 번째 위반 하나만
 *    말해 준다(여러 줄을 띄우면 무엇부터 고칠지 알 수 없다 — `05-logic.md` §4).
 * ★★ 화면 검사는 친절이다. 서버가 같은 규칙으로 다시 본다 — **겹침은 DB 가 정본**이라
 *    화면이 통과시켜도 409 가 올 수 있다.
 * ★ 값은 **열릴 때 한 번만** 채운다. 입력 중에 다시 채우면 커서가 튄다.
 */
import { useMemo, useState } from 'react';
import {
  REASON_TEXT,
  SLOT_MINUTES,
  minutesToTime,
  timeToMinutes,
  validateReservation,
  type ReservationReason,
} from '@swonbiz/shared/domain/reservation-rules';
import { Icon } from '@/components/ds';
import styles from './booking.module.css';
import {
  STATUS_LABEL,
  dur,
  md,
  orgLabel,
  roomRules,
  type CompanyOption,
  type Reservation,
  type Room,
  type WidthMode,
} from './booking-model';

export type FormMode = 'create' | 'edit' | 'view';

export interface FormSeed {
  mode: FormMode;
  /** edit · view 일 때의 원본. create 면 `null`. */
  source: Reservation | null;
  facilityId: string;
  /** `YYYY-MM-DD`. */
  day: string;
  startMinutes: number;
  endMinutes: number;
  title: string;
  people: number;
  memo: string;
  /** 운영자가 대신 잡아 줄 입주사. 빈 문자열이면 운영사 자신이다. */
  companyId: string;
}

interface Props {
  seed: FormSeed;
  rooms: readonly Room[];
  companies: readonly CompanyOption[];
  operator: boolean;
  widthMode: WidthMode;
  /** 로그인한 사람 — 예약자 정보 블록의 기본값. */
  me: { memberName: string; orgName: string };
  /** 마지막으로 잡을 수 있는 날(입주사). 운영자는 `null`. */
  lastBookable: string | null;
  /** 그 날 우리 입주사가 쓴 분 — 서버가 준 값(전 회의실 합산). 운영자는 0. */
  usedMinutesOn: (day: string) => number;
  /** 지금 — 로컬 벽시계. */
  asOf: { day: string; minutes: number };
  /** 같은 회의실·같은 날에 이미 잡힌 자리와 겹치는가(불러온 범위 안에서만 안다). */
  overlaps: (args: { facilityId: string; day: string; startMinutes: number; endMinutes: number; exceptId: string | null }) => boolean;
  onClose: () => void;
  onCancelAsk: (reservation: Reservation) => void;
  onComplete: (reservation: Reservation) => void;
  onDone: (message: string, moved: { facilityId: string; day: string }) => void;
}

export function BookingForm({
  seed,
  rooms,
  companies,
  operator,
  widthMode,
  me,
  lastBookable,
  usedMinutesOn,
  asOf,
  overlaps,
  onClose,
  onCancelAsk,
  onComplete,
  onDone,
}: Props) {
  const readOnly = seed.mode === 'view';
  const [facilityId, setFacilityId] = useState(seed.facilityId);
  const [day, setDay] = useState(seed.day);
  const [startMinutes, setStartMinutes] = useState(seed.startMinutes);
  const [endMinutes, setEndMinutes] = useState(seed.endMinutes);
  const [title, setTitle] = useState(seed.title);
  const [people, setPeople] = useState(seed.people);
  const [memo, setMemo] = useState(seed.memo);
  const [orgId, setOrgId] = useState(seed.companyId);
  const [titleError, setTitleError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = rooms.find((r) => r.facilityId === facilityId) ?? rooms[0]!;

  /**
   * 그 날 우리 조직이 쓴 분 — **고치는 중인 예약 자신은 뺀다**(시안 `usedMin(…, exceptId)`).
   *
   * ★★★ 서버가 준 `usedMinutesByDate` 에는 이 예약도 들어 있다. 그대로 쓰면 1시간을
   *    1시간 30분으로 늘릴 때 「이미 1시간 썼다」가 더해져 2시간 30분으로 계산되고,
   *    한도에 걸려 **저장 버튼이 잠긴다**(2026-09-27 에 그렇게 막혀 있었다).
   *    서버의 PATCH 는 이미 자기 자신을 빼고 본다 — 화면만 어긋나 있었다.
   */
  const usedFor = (on: string) => {
    const raw = usedMinutesOn(on);
    const self = seed.source;
    if (!self || self.day !== on || self.status === 'cancelled') return raw;
    return Math.max(0, raw - (timeToMinutes(self.endTime) - timeToMinutes(self.startTime)));
  };
  const rules = roomRules(room);
  const capacity = room.capacity ?? 99;

  /** 30분 간격 선택지 — 시작은 `open ~ close−30`, 종료는 `open+30 ~ close`. */
  const times = useMemo(() => {
    const starts: number[] = [];
    const ends: number[] = [];
    for (let t = rules.openMinutes; t < rules.closeMinutes; t += SLOT_MINUTES) starts.push(t);
    for (let t = rules.openMinutes + SLOT_MINUTES; t <= rules.closeMinutes; t += SLOT_MINUTES) ends.push(t);
    return { starts, ends };
  }, [rules.openMinutes, rules.closeMinutes]);

  /**
   * 첫 번째 위반 하나 — 순서가 곧 우선순위다(`05-logic.md` §4).
   * ★ 겹침은 규칙 함수에 없다(DB 가 정본이다). 그래서 길이 검사 다음에 여기서 본다.
   */
  const timeError = useMemo(() => {
    if (readOnly) return null;
    if (endMinutes <= startMinutes) return '종료 시각은 시작 시각보다 늦어야 합니다';
    if (overlaps({ facilityId, day, startMinutes, endMinutes, exceptId: seed.source?.reservationId ?? null })) {
      return '이미 예약된 시간과 겹칩니다';
    }
    const verdict = validateReservation({
      room: rules,
      day,
      startMinutes,
      endMinutes,
      asOf,
      operator,
      companyUsedMinutes: usedFor(day),
    });
    if (verdict.ok) return null;
    return messageFor(verdict.reason, {
      roomName: room.name,
      minMinutes: rules.minMinutes,
      maxMinutes: rules.maxMinutes,
      lastBookable,
      used: usedFor(day),
    });
  }, [
    readOnly, endMinutes, startMinutes, overlaps, facilityId, day, seed.source, rules, asOf, operator,
    usedMinutesOn, room.name, lastBookable, usedFor,
  ]);

  /** 입주사에게만 — 그 날 우리 조직이 얼마나 썼는지. */
  const usageLine = useMemo(() => {
    if (operator || readOnly) return null;
    const used = usedFor(day);
    const left = Math.max(0, 120 - used);
    return `${md(day)} 우리 조직 예약 ${dur(used)} · ${left ? `${dur(left)} 더 예약할 수 있습니다` : '더 예약할 수 없습니다'}`;
  }, [operator, readOnly, usedFor, day]);

  const pickRoom = (nextId: string) => {
    const next = rooms.find((r) => r.facilityId === nextId);
    if (!next) return;
    const nextRules = roomRules(next);
    const length = endMinutes - startMinutes;
    // ★ 운영시간 안으로 맞추되 **길이는 지킨다**(시안 05-logic.md §7).
    const start = Math.min(Math.max(startMinutes, nextRules.openMinutes), nextRules.closeMinutes - SLOT_MINUTES);
    setFacilityId(nextId);
    setStartMinutes(start);
    setEndMinutes(Math.min(start + length, nextRules.closeMinutes));
    setPeople((p) => Math.min(p, next.capacity ?? p));
  };

  const pickStart = (value: number) => {
    const length = Math.max(endMinutes - startMinutes, rules.minMinutes ?? SLOT_MINUTES);
    setStartMinutes(value);
    setEndMinutes(Math.min(value + length, rules.closeMinutes));
  };

  const submit = async () => {
    if (timeError) return;
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      facilityId,
      day,
      startTime: minutesToTime(startMinutes),
      endTime: minutesToTime(endMinutes),
      title: title.trim(),
      attendees: people,
      purpose: memo.trim() || null,
    };
    try {
      const res =
        seed.mode === 'create'
          ? await fetch('/api/reservations', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              // ★ 예약 조직은 **등록할 때만** 보낸다 — 수정에서는 바꿀 수 없다(서버가 400).
              body: JSON.stringify(operator ? { ...body, companyId: orgId === '' ? null : orgId } : body),
            })
          : await fetch(`/api/reservations/${encodeURIComponent(seed.source!.reservationId)}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            });
      const payload = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(payload.message ?? '처리하지 못했습니다');
      onDone(seed.mode === 'create' ? '예약했습니다' : '예약을 변경했습니다', { facilityId, day });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const source = seed.source;
  /** 시간이 지난 확정 예약은 **화면에서** 종료로 본다(시안 04-rules.md §1). */
  const shown = source ? shownStatus(source, asOf) : null;
  /** ★ 저장값이 아직 확정인 지난 예약 — 운영자가 닫아야 할 것. */
  const waiting = !!source && shown === 'completed' && source.status === 'confirmed';
  const orgName =
    source?.companyName ??
    (source ? orgLabel(null) : orgId === '' ? (operator ? '운영사' : me.orgName) : companies.find((c) => c.companyId === orgId)?.companyName ?? me.orgName);

  const heading = seed.mode === 'create' ? '회의실 예약' : seed.mode === 'edit' ? '예약 수정' : '예약 상세';
  const full = widthMode === 'sm';

  return (
    <div
      className={`${styles.overlay}${full ? ` ${styles.overlayFull}` : ''}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={heading}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitleRow}>
              <h3 className={styles.modalTitle}>{heading}</h3>
              {shown ? (
                <span
                  className={`${styles.badge} ${
                    waiting
                      ? styles.badgeWaiting
                      : shown === 'confirmed'
                      ? styles.badgeIndigo
                      : shown === 'completed'
                      ? styles.badgeNeutral
                      : styles.badgeCancel
                  }`}
                  data-badge="1"
                >
                  {/* ★ 운영자에게만 「미처리」를 덧붙인다 — 닫아야 할 것이 무엇인지 보여야 한다 */}
                  {waiting && operator ? '종료 · 미처리' : STATUS_LABEL[shown] ?? shown}
                </span>
              ) : null}
            </div>
            <p className={styles.modalSub}>
              {room.name}
              {room.capacity ? ` · ${room.capacity}인` : ''} · 30분 단위
            </p>
          </div>
          <button type="button" className={`${styles.iconBtn} ${styles.iconBtnBare}`} aria-label="닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* ── 예약 정보 ── */}
          <div>
            <div className={styles.secTitle}>예약 정보</div>
            <div className={styles.fgrid}>
              <label className={`${styles.field} ${styles.span6}`}>
                <span className={styles.label}>회의실</span>
                <span className={styles.selectWrap}>
                  <select
                    className={styles.select}
                    data-f="room"
                    value={facilityId}
                    disabled={readOnly}
                    onChange={(e) => pickRoom(e.target.value)}
                  >
                    {rooms.map((r) => (
                      <option key={r.facilityId} value={r.facilityId}>
                        {r.name}
                        {r.capacity ? ` (${r.capacity}인)` : ''}
                      </option>
                    ))}
                  </select>
                  <span className={styles.caret}>
                    <Icon name="chevron-down" size={16} />
                  </span>
                </span>
              </label>

              <label className={`${styles.field} ${styles.span2} ${styles.fdate}`}>
                <span className={styles.label}>날짜</span>
                <input
                  className={styles.input}
                  type="date"
                  data-f="date"
                  value={day}
                  min={operator ? undefined : asOf.day}
                  max={operator ? undefined : lastBookable ?? undefined}
                  disabled={readOnly}
                  onChange={(e) => e.target.value && setDay(e.target.value)}
                />
              </label>

              <label className={`${styles.field} ${styles.span2}`}>
                <span className={styles.label}>시작</span>
                <span className={styles.selectWrap}>
                  <select
                    className={`${styles.select}${timeError ? ` ${styles.isError}` : ''}`}
                    data-f="start"
                    value={startMinutes}
                    disabled={readOnly}
                    onChange={(e) => pickStart(Number(e.target.value))}
                  >
                    {times.starts.map((t) => (
                      <option key={t} value={t}>
                        {minutesToTime(t)}
                      </option>
                    ))}
                  </select>
                  <span className={styles.caret}>
                    <Icon name="chevron-down" size={16} />
                  </span>
                </span>
              </label>

              <label className={`${styles.field} ${styles.span2}`}>
                <span className={styles.label}>종료</span>
                <span className={styles.selectWrap}>
                  <select
                    className={`${styles.select}${timeError ? ` ${styles.isError}` : ''}`}
                    data-f="end"
                    value={endMinutes}
                    disabled={readOnly}
                    onChange={(e) => setEndMinutes(Number(e.target.value))}
                  >
                    {times.ends.map((t) => (
                      <option key={t} value={t}>
                        {minutesToTime(t)}
                      </option>
                    ))}
                  </select>
                  <span className={styles.caret}>
                    <Icon name="chevron-down" size={16} />
                  </span>
                </span>
              </label>

              <div className={styles.span6} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: -6 }}>
                {timeError ? (
                  <span className={styles.err} data-time-err="1">
                    <Icon name="circle-alert" size={16} />
                    <span>{timeError}</span>
                  </span>
                ) : null}
                <span className={styles.hint}>
                  {room.name} · 운영 {room.openTime} – {room.closeTime} · 1회 {dur(room.minDuration)}
                  {room.maxDuration > 0 ? ` ~ ${dur(room.maxDuration)}` : ' 이상'}
                </span>
                {usageLine ? (
                  <span className={styles.hint} data-usage="1">
                    {usageLine}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* ── 예약 내용 ── */}
          <div>
            <div className={styles.secTitle}>예약 내용</div>
            <div className={styles.fgrid}>
              <label className={`${styles.field} ${styles.span6}`}>
                <span className={styles.label}>
                  회의 제목 <span className={styles.req}>*</span>
                </span>
                <input
                  className={`${styles.input}${titleError ? ` ${styles.isError}` : ''}`}
                  data-f="title"
                  value={title}
                  maxLength={40}
                  placeholder="주간 회의"
                  autoComplete="off"
                  disabled={readOnly}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (e.target.value.trim()) setTitleError(false);
                  }}
                />
                {titleError ? (
                  <span className={styles.err}>
                    <Icon name="circle-alert" size={16} />
                    회의 제목을 입력해 주세요
                  </span>
                ) : null}
              </label>

              <div className={`${styles.field} ${styles.span6}`}>
                <span className={styles.label}>참석 인원</span>
                <span className={styles.peopleRow}>
                  <span className={styles.stepper}>
                    <button
                      type="button"
                      aria-label="인원 감소"
                      data-people="minus"
                      disabled={readOnly || people <= 1}
                      onClick={() => setPeople((p) => Math.max(1, p - 1))}
                    >
                      <Icon name="minus" size={16} />
                    </button>
                    <span className={styles.stepValue} data-people="value">
                      {people}
                    </span>
                    <button
                      type="button"
                      aria-label="인원 증가"
                      data-people="plus"
                      disabled={readOnly || people >= capacity}
                      onClick={() => setPeople((p) => Math.min(capacity, p + 1))}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </span>
                  {room.capacity ? <span className={styles.hint}>최대 {room.capacity}명</span> : null}
                </span>
              </div>

              <label className={`${styles.field} ${styles.span6}`}>
                <span className={styles.label}>메모</span>
                <textarea
                  className={styles.textarea}
                  data-f="memo"
                  value={memo}
                  maxLength={200}
                  rows={2}
                  placeholder="준비물, 참석자 안내 등"
                  disabled={readOnly}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </label>
            </div>
          </div>

          {/* ── 예약자 정보 ── */}
          <div>
            <div className={styles.secRow}>
              <div className={styles.secTitle}>예약자 정보</div>
              <span className={styles.secNote}>
                {seed.mode === 'create'
                  ? operator
                    ? '등록자는 로그인한 운영자로 기록됩니다'
                    : '로그인 정보로 자동 입력됩니다'
                  : '등록 후에는 바꿀 수 없습니다'}
              </span>
            </div>

            {/* ★ 예약 조직은 **운영자가 새로 만들 때만** 고른다. 저장 뒤에는 못 바꾼다(서버 400). */}
            {operator && seed.mode === 'create' ? (
              <label className={styles.field} style={{ marginTop: 12 }}>
                <span className={styles.label}>예약 조직</span>
                <span className={styles.selectWrap}>
                  <select
                    className={styles.select}
                    data-org="1"
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                  >
                    <option value="">운영사 (에스원비즈)</option>
                    {companies.map((c) => (
                      <option key={c.companyId} value={c.companyId}>
                        {c.companyName}
                      </option>
                    ))}
                  </select>
                  <span className={styles.caret}>
                    <Icon name="chevron-down" size={16} />
                  </span>
                </span>
              </label>
            ) : null}

            <div className={styles.booker}>
              <div className={styles.bookerGrid}>
                <div>
                  <div className={styles.bookerKey}>조직명</div>
                  <div className={`${styles.bookerValue} ${styles.bookerValueBold}`} data-booker="org">
                    {orgName}
                  </div>
                </div>
                <div>
                  <div className={styles.bookerKey}>{source ? '예약자' : '등록자'}</div>
                  <div className={styles.bookerValue} data-booker="name">
                    {source ? source.bookerName ?? '—' : me.memberName}
                  </div>
                </div>
                {/*
                  ★★ 연락처 — **자리는 남기고 숨겼다.** 지금 세션에 전화번호가 없다(삐용 Mock
                     계정에 필드 자체가 없다). 삐용 실연동으로 계정에서 받게 되면 `hidden` 만
                     떼면 된다. 빈 칸을 보여 주면 「채워야 하는데 비어 있는 칸」으로 읽힌다.
                */}
                <div hidden data-booker="phone">
                  <div className={styles.bookerKey}>연락처</div>
                  <div className={styles.bookerValue}>—</div>
                </div>
              </div>
            </div>
          </div>

          {source?.createdAt ? (
            <div className={styles.metaLine}>
              등록 {source.createdAt} · {source.bookerName ?? '—'}
              {source.status === 'cancelled' ? ' · 취소됨' : ''}
              {source.cancelReason ? ` (${source.cancelReason})` : ''}
            </div>
          ) : null}

          {error ? <p className={styles.err}>{error}</p> : null}
        </div>

        <div className={styles.modalFoot}>
          {seed.mode === 'edit' && source ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDangerGhost} ${styles.btnLg}`}
              data-cancel-ask="1"
              disabled={busy}
              onClick={() => onCancelAsk(source)}
            >
              예약 취소
            </button>
          ) : null}
          {/*
            ★ 종료 처리 — 시안에는 없다. 우리 규칙이 「자동 종료 없음 · 운영자가 닫는다」라서
              지난 확정 예약을 운영자가 닫을 길이 필요하다(2026-09-27 결정).
          */}
          {waiting && operator && source ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`}
              data-complete="1"
              disabled={busy}
              onClick={() => onComplete(source)}
            >
              종료 처리
            </button>
          ) : null}
          <span className={styles.sp} />
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnLg}`}
            disabled={busy}
            onClick={onClose}
          >
            {readOnly ? '닫기' : '취소'}
          </button>
          {readOnly ? null : (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
              data-submit="1"
              disabled={busy || !!timeError}
              onClick={() => void submit()}
            >
              {seed.mode === 'edit' ? '저장' : '예약하기'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 표시 상태 — **저장값이 확정이어도 종료 시각이 지났으면 종료로 본다**(시안 04-rules.md §1).
 *
 * ★ 저장값을 바꾸는 것은 운영자의 [종료 처리] 다. 화면이 먼저 그렇게 그리는 이유는,
 *   운영자가 아직 닫지 않았다고 해서 지난 예약이 「확정」으로 보이면 안 되기 때문이다.
 */
export function shownStatus(r: Reservation, asOf: { day: string; minutes: number }): string {
  if (r.status === 'cancelled') return 'cancelled';
  const ended = r.day < asOf.day || (r.day === asOf.day && timeToMinutes(r.endTime) <= asOf.minutes);
  if (r.status === 'completed' || ended) return 'completed';
  return 'confirmed';
}

/** 시안 문구 — 규칙 사유를 그 방의 값으로 풀어 쓴다(`05-logic.md` §4). */
export function messageFor(
  reason: ReservationReason,
  ctx: {
    roomName: string;
    minMinutes: number | null;
    maxMinutes: number | null;
    lastBookable: string | null;
    used: number;
  },
): string {
  switch (reason) {
    case 'TOO_SHORT':
      return `${ctx.roomName} 은 최소 ${dur(ctx.minMinutes ?? 0)} 이상 예약할 수 있습니다`;
    case 'TOO_LONG':
      return `${ctx.roomName} 은 한 번에 최대 ${dur(ctx.maxMinutes ?? 0)}까지 예약할 수 있습니다`;
    case 'TOO_FAR':
      return ctx.lastBookable
        ? `${md(ctx.lastBookable)}까지 예약할 수 있습니다 (오늘부터 4주)`
        : REASON_TEXT.TOO_FAR;
    case 'DAILY_LIMIT':
      return `하루 2시간까지 예약할 수 있습니다 · 이 날 ${dur(ctx.used)} 예약되어 있습니다`;
    default:
      return REASON_TEXT[reason];
  }
}
