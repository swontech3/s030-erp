'use client';

/**
 * s0300600010 회의실 예약 — 주간 그리드 · 월간 · 등록/수정 모달.
 *
 * 시안: design/handoff/prototypes/s0300600010.html  (2026-09-27 2차 인계)
 * 명세: design/handoff/room-booking/ 01~05 · 07 · 08
 * ★ 이 파일은 시안의 `render()` · `renderWeek()` · 드래그 · 모달을 React 로 옮긴 것이다.
 *   치수(28px 행 · 72/56px 시간열 · 56px 요일 머리)와 문구는 시안에서 그대로 가져왔다.
 *
 * =============================================================================
 * ★★ 한 업무는 한 화면에서 (CLAUDE.md)
 * =============================================================================
 * 예약 만들기·수정·취소·종료 처리는 **이 화면에만** 있다.
 *
 * =============================================================================
 * ★★★ 규칙은 shared 하나 · 판정은 서버
 * =============================================================================
 * 30분 단위·운영시간·최소·최대·지난 시각·4주·하루 한도는 `validateReservation` 이
 * 정하고 화면과 서버가 같이 부른다. **겹침은 DB 배타 제약이 정본**이라 화면은 미리
 * 알려 주기만 한다 — 화면이 통과시켜도 서버가 409 로 막으면 그쪽이 맞다.
 *
 * =============================================================================
 * ★★★ 하루 사용량은 서버가 준다 · 남의 예약은 시각만 온다
 * =============================================================================
 * `usedMinutesByDate` 는 **전 회의실 합산**이고(화면이 세면 다른 방 시간이 빠진다),
 * `busy` 는 **시각 넷뿐**이다(026 — 회사명·제목·예약자가 오지 않는다).
 *
 * ★ 아직 없는 것: 키오스크(s0300500060) · 외부 예약(2차).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AHEAD_DAYS,
  DAILY_LIMIT_MINUTES,
  SLOT_MINUTES,
  localDayMinutes,
  minutesToTime,
  timeToMinutes,
  validateReservation,
} from '@swonbiz/shared/domain/reservation-rules';
import { Icon } from '@/components/ds';
import styles from './booking.module.css';
import { BookingForm, messageFor, shownStatus, type FormSeed } from './BookingForm';
import {
  WEEKDAY,
  dayNum,
  dowOf,
  dur,
  inMonth,
  md,
  mdDow,
  monthGrid,
  monthLabel,
  orgLabel,
  roomRules,
  shiftDay,
  shiftMonth,
  today,
  weekDays,
  weekLabel,
  weekStart,
  widthMode as modeOf,
  type Busy,
  type CompanyOption,
  type Reservation,
  type Room,
  type WidthMode,
} from './booking-model';

/** 칸 하나의 높이(px) — 시안 `SLOT_H`. 블록·현재 시각 선·진입 스크롤이 이 값을 쓴다. */
const SLOT_H = 28;

interface Props {
  /** 운영사인가 — 지난 시각·4주·하루 한도 예외, 월간 보기, 예약 조직 선택, 종료 처리. */
  operator: boolean;
  /** 내 입주사. 운영사는 `null`. */
  companyId: string | null;
  /** 로그인한 사람 — 예약자 정보 블록의 기본값. */
  me: { memberName: string; orgName: string };
}

interface DragState {
  day: string;
  from: number;
  lo: number;
  hi: number;
  mouse: boolean;
  capped: boolean;
}

export function BookingView({ operator, companyId, me }: Props) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [roomId, setRoomId] = useState('');
  /** 기준 날짜 — 월↔주 전환과 하루 보기가 **이 날짜 하나를 함께 쓴다**(시안 `state.anchor`). */
  const [anchor, setAnchor] = useState(() => today());
  const [view, setView] = useState<'week' | 'month'>('week');
  const [list, setList] = useState<Reservation[] | null>(null);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [usedByDate, setUsedByDate] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState<FormSeed | null>(null);
  const [confirming, setConfirming] = useState<Reservation | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [wide, setWide] = useState<WidthMode>('xl');
  const [now, setNow] = useState(() => localDayMinutes(new Date()));

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  /* ── 폭 단계 — 시안은 프레임 폭으로 갈린다. 우리는 창 폭이 곧 셸 폭이다 ── */
  useEffect(() => {
    const read = () => setWide(modeOf(window.innerWidth));
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  /* ── 1분마다 — 현재 시각 선 · 지난 칸 판정 ── */
  useEffect(() => {
    const timer = setInterval(() => setNow(localDayMinutes(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    void fetch('/api/facilities')
      .then((r) => (r.ok ? (r.json() as Promise<{ facilities?: Room[]; companies?: CompanyOption[] }>) : null))
      .then((b) => {
        const all = b?.facilities ?? [];
        setRooms(all);
        setCompanies(b?.companies ?? []);
        setRoomId((prev) => prev || all[0]?.facilityId || '');
      })
      .catch(() => setRooms([]));
  }, []);

  const room = rooms?.find((r) => r.facilityId === roomId) ?? null;
  const rules = room ? roomRules(room) : null;
  /** 입주사가 잡을 수 있는 마지막 날 — 오늘 포함 28일이므로 오늘+27. 운영자는 없다. */
  const lastBookable = operator ? null : shiftDay(now.day, AHEAD_DAYS - 1);

  /** 월간은 **운영자 · 768 이상**에서만이다(시안 `effectiveView`). */
  const effectiveView: 'week' | 'month' = operator && wide !== 'sm' ? view : 'week';
  /** 767 이하는 하루 보기다. */
  const days = useMemo(
    () => (wide === 'sm' ? [anchor] : weekDays(weekStart(anchor))),
    [wide, anchor],
  );
  const month = useMemo(() => monthGrid(anchor), [anchor]);

  /* ── 불러오기 — 보고 있는 기간만 ─────────────────────────────────────── */
  const range = useMemo(() => {
    if (effectiveView === 'month') {
      return { from: month.days[0]!, to: month.days[month.days.length - 1]! };
    }
    return { from: days[0]!, to: days[days.length - 1]! };
  }, [effectiveView, month.days, days]);

  const seq = useRef(0);
  const load = useCallback(async (facilityId: string, from: string, to: string) => {
    if (!facilityId) return;
    const mine = ++seq.current;
    setError(null);
    try {
      const res = await fetch(
        `/api/reservations?facilityId=${encodeURIComponent(facilityId)}&from=${from}&to=${to}`,
      );
      const body = (await res.json()) as {
        reservations?: Reservation[];
        busy?: Busy[];
        usedMinutesByDate?: Record<string, number>;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? '예약을 불러오지 못했습니다');
      if (mine === seq.current) {
        setList(body.reservations ?? []);
        setBusy(body.busy ?? []);
        setUsedByDate(body.usedMinutesByDate ?? {});
      }
    } catch (e) {
      if (mine === seq.current) {
        setList([]);
        setBusy([]);
        setUsedByDate({});
        setError((e as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    void load(roomId, range.from, range.to);
  }, [roomId, range.from, range.to, load]);

  const reload = useCallback(() => void load(roomId, range.from, range.to), [load, roomId, range]);

  /* ── 자리 계산 ───────────────────────────────────────────────────────── */

  /** 살아 있는 내(또는 운영자가 보는 전체) 예약 — 취소는 자리를 잡지 않는다. */
  const live = useMemo(() => (list ?? []).filter((r) => r.status !== 'cancelled'), [list]);

  /**
   * 남의 예약 — **시각만** 아는 자리(026).
   * ★ 내 예약은 `busy` 에도 들어 있다. 상세가 있는 것은 빼야 「예약됨」이 내 예약을 덮지 않는다.
   */
  const masked = useMemo(
    () =>
      busy.filter(
        (b) =>
          !live.some((r) => r.day === b.day && r.startTime === b.startTime && r.endTime === b.endTime),
      ),
    [busy, live],
  );

  /** 그 날 그 회의실에서 이미 찬 칸 번호. 드래그가 예약을 건너뛰지 않게 한다. */
  const occupiedOn = useCallback(
    (day: string): Set<number> => {
      const set = new Set<number>();
      if (!rules) return set;
      const add = (startTime: string, endTime: string) => {
        for (let t = timeToMinutes(startTime); t < timeToMinutes(endTime); t += SLOT_MINUTES) {
          set.add((t - rules.openMinutes) / SLOT_MINUTES);
        }
      };
      live.filter((r) => r.day === day).forEach((r) => add(r.startTime, r.endTime));
      masked.filter((b) => b.day === day).forEach((b) => add(b.startTime, b.endTime));
      return set;
    },
    [live, masked, rules],
  );

  /** 그 날 우리 입주사가 쓴 분 — **서버 값**(전 회의실 합산). 운영사는 한도가 없다. */
  const usedOn = useCallback(
    (day: string) => (operator ? 0 : usedByDate[day] ?? 0),
    [operator, usedByDate],
  );

  /** 칸이 막힌 이유 — 운영자는 제한이 없다(시안 `blockedReason`). */
  const blockedReason = useCallback(
    (day: string, startMinutes: number): 'limit' | 'past' | null => {
      if (operator) return null;
      if (lastBookable && day > lastBookable) return 'limit';
      if (day < now.day || (day === now.day && startMinutes < now.minutes)) return 'past';
      return null;
    },
    [operator, lastBookable, now],
  );

  /** 이미 지난 칸인가 — 색만 다르다(운영자도 흐리게 본다). */
  const isPastSlot = useCallback(
    (day: string, startMinutes: number) =>
      day < now.day || (day === now.day && startMinutes + SLOT_MINUTES <= now.minutes),
    [now],
  );

  const slotFree = useCallback(
    (day: string, slot: number, occ: Set<number>) => {
      if (!rules) return false;
      const count = (rules.closeMinutes - rules.openMinutes) / SLOT_MINUTES;
      return (
        slot >= 0 &&
        slot < count &&
        !occ.has(slot) &&
        blockedReason(day, rules.openMinutes + slot * SLOT_MINUTES) === null
      );
    },
    [rules, blockedReason],
  );

  /** 같은 방·같은 날에 겹치는 자리가 있는가 — 모달의 미리 검사(정본은 DB). */
  const overlaps = useCallback(
    (args: { facilityId: string; day: string; startMinutes: number; endMinutes: number; exceptId: string | null }) => {
      if (args.facilityId !== roomId) return false; // 다른 방의 자리는 아직 모른다 — 서버가 본다
      const hit = (start: string, end: string) =>
        args.startMinutes < timeToMinutes(end) && args.endMinutes > timeToMinutes(start);
      return (
        live.some((r) => r.day === args.day && r.reservationId !== args.exceptId && hit(r.startTime, r.endTime)) ||
        masked.some((b) => b.day === args.day && hit(b.startTime, b.endTime))
      );
    },
    [live, masked, roomId],
  );

  /* ── 진입 스크롤 — 현재 시각 1시간 전이 맨 위에 ───────────────────────── */
  const scrollToNow = useCallback(() => {
    const box = scrollRef.current;
    if (!box || !rules) return;
    box.scrollTop = Math.max(0, ((now.minutes - 60 - rules.openMinutes) / SLOT_MINUTES) * SLOT_H);
  }, [rules, now.minutes]);

  const scrolledFor = useRef('');
  useEffect(() => {
    if (!rules || effectiveView !== 'week') return;
    const key = `${roomId}|${range.from}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    if (!days.includes(now.day)) {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      return;
    }
    scrollToNow();
  }, [rules, effectiveView, roomId, range.from, days, now.day, scrollToNow]);

  /* ── 드래그 — 마우스는 끌어 범위, 터치는 탭 한 칸 ────────────────────── */
  useEffect(() => {
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      if (!d.mouse) {
        const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const cell = hit?.closest('[data-cell]') as HTMLElement | null;
        if (!cell || cell.dataset.date !== d.day || Number(cell.dataset.slot) !== d.from) return;
      }
      openCreate(d.day, d.lo, d.hi);
    };
    const cancel = () => setDrag(null);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
    };
    // openCreate 는 아래에서 선언된다 — 렌더마다 새로 걸어 최신 값을 쓴다.
  });

  const onCellDown = (day: string, slot: number, e: React.PointerEvent) => {
    if (e.button > 0 || !rules) return;
    if (blockedReason(day, rules.openMinutes + slot * SLOT_MINUTES)) return;
    if (occupiedOn(day).has(slot)) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse) e.preventDefault();
    setDrag({ day, from: slot, lo: slot, hi: slot, mouse, capped: false });
  };

  const onCellOver = (day: string, slot: number) => {
    const d = dragRef.current;
    if (!d || !d.mouse || d.day !== day || !rules) return;
    const occ = occupiedOn(day);
    const maxSlots = rules.maxMinutes ? rules.maxMinutes / SLOT_MINUTES : Infinity;
    let lo = d.from;
    let hi = d.from;
    // ★ 누른 칸에서 **바깥쪽으로 걸어가며** 막히는 첫 칸에서 멈춘다 — 예약을 건너뛰지 않는다.
    while (lo - 1 >= Math.min(slot, d.from) && slotFree(day, lo - 1, occ)) lo--;
    while (hi + 1 <= Math.max(slot, d.from) && slotFree(day, hi + 1, occ)) hi++;
    let capped = false;
    if (hi - lo + 1 > maxSlots) {
      capped = true;
      if (slot < d.from) lo = hi - maxSlots + 1;
      else hi = lo + maxSlots - 1;
    }
    setDrag({ ...d, lo, hi, capped });
  };

  /* ── 모달 열기 ───────────────────────────────────────────────────────── */
  const openCreate = (day: string, lo: number, hi: number) => {
    if (!room || !rules) return;
    const count = (rules.closeMinutes - rules.openMinutes) / SLOT_MINUTES;
    const minSlots = (rules.minMinutes ?? SLOT_MINUTES) / SLOT_MINUTES;
    // ★ 최소 이용 시간까지 늘린다. 늘리다 다음 예약과 겹치면 그대로 열고 오류를 보여 준다.
    const end = hi - lo + 1 < minSlots ? Math.min(lo + minSlots - 1, count - 1) : hi;
    setForm({
      mode: 'create',
      source: null,
      facilityId: room.facilityId,
      day,
      startMinutes: rules.openMinutes + lo * SLOT_MINUTES,
      endMinutes: rules.openMinutes + (end + 1) * SLOT_MINUTES,
      title: '',
      people: Math.min(4, room.capacity ?? 4),
      memo: '',
      companyId: '',
    });
  };

  /** [+ 예약 추가] — 보고 있는 날의 **첫 빈 칸**(시안 `openCreateDefault`). */
  const openCreateDefault = () => {
    if (!room || !rules) return;
    const monday = weekStart(anchor);
    let day = wide === 'sm' ? anchor : days.includes(now.day) ? now.day : monday;
    if (!operator && day < now.day) day = now.day;
    const occ = occupiedOn(day);
    const count = (rules.closeMinutes - rules.openMinutes) / SLOT_MINUTES;
    let slot = 0;
    while (slot < count && !slotFree(day, slot, occ)) slot++;
    if (slot >= count) slot = 0;
    openCreate(day, slot, slot);
  };

  /** 수정 가능한가 — 확정이고, 운영자거나 우리 조직이면서 시작 전(시안 `canEdit`). */
  const canEdit = (r: Reservation) => {
    if (shownStatus(r, now) !== 'confirmed') return false;
    if (operator) return true;
    return r.companyId !== null && r.companyId === companyId;
  };

  const openBooking = (r: Reservation) => {
    if (!rooms) return;
    setForm({
      mode: canEdit(r) ? 'edit' : 'view',
      source: r,
      facilityId: r.facilityId,
      day: r.day,
      startMinutes: timeToMinutes(r.startTime),
      endMinutes: timeToMinutes(r.endTime),
      title: r.title,
      people: r.attendees ?? 1,
      memo: r.purpose ?? '',
      companyId: r.companyId ?? '',
    });
  };

  const complete = async (r: Reservation) => {
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(r.reservationId)}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('처리하지 못했습니다');
      setForm(null);
      reload();
      notify('예약을 종료 처리했습니다');
    } catch (e) {
      notify((e as Error).message);
    }
  };

  /* ── 툴바 ────────────────────────────────────────────────────────────── */
  const stepBy = (dir: 1 | -1) => {
    if (effectiveView === 'month') return setAnchor(shiftMonth(anchor, dir));
    setAnchor(shiftDay(anchor, wide === 'sm' ? dir : dir * 7));
  };

  const nextAnchor =
    effectiveView === 'month'
      ? shiftMonth(anchor, 1)
      : shiftDay(anchor, wide === 'sm' ? 1 : 7);
  /** 입주사는 예약 가능 기간 밖으로 넘어가지 않는다(시안 `renderToolbar`). */
  const nextBlocked =
    !!lastBookable &&
    (wide === 'sm' ? nextAnchor > lastBookable : weekStart(nextAnchor) > lastBookable);

  const rangeLabel =
    effectiveView === 'month'
      ? monthLabel(anchor)
      : wide === 'sm'
      ? mdDow(anchor)
      : weekLabel(weekStart(anchor));

  const ruleText = room
    ? `운영 ${room.openTime} – ${room.closeTime} · 30분 단위 · 1회 ${dur(room.minDuration)}` +
      (room.maxDuration > 0 ? ` ~ ${dur(room.maxDuration)}` : ' 이상') +
      (lastBookable ? ` · 입주사 ${md(lastBookable)}까지 · 하루 ${DAILY_LIMIT_MINUTES / 60}시간` : '')
    : '';

  const slotCount = rules ? (rules.closeMinutes - rules.openMinutes) / SLOT_MINUTES : 0;
  const gridCols = `${wide === 'xl' ? 72 : 56}px repeat(${days.length},minmax(0,1fr))`;

  return (
    <div className={styles.page} data-w={wide}>
      {/* ── 툴바 ── */}
      <div className={styles.toolbar}>
        <div className={styles.tbLeft}>
          <span className={styles.step}>
            <button type="button" className={styles.iconBtn} aria-label="이전" onClick={() => stepBy(-1)}>
              <Icon name="chevron-left" size={16} />
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
              onClick={() => {
                setAnchor(today());
                setTimeout(scrollToNow, 0);
              }}
            >
              오늘
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="다음"
              data-next="1"
              disabled={nextBlocked}
              onClick={() => stepBy(1)}
            >
              <Icon name="chevron-right" size={16} />
            </button>
          </span>
          <span className={styles.range}>{rangeLabel}</span>
        </div>

        <div className={styles.tbRight}>
          <span className={styles.roomPick}>
            <span className={styles.lead}>
              <Icon name="door-open" size={16} />
            </span>
            <select
              aria-label="회의실"
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                scrolledFor.current = '';
              }}
            >
              {(rooms ?? []).map((r) => (
                <option key={r.facilityId} value={r.facilityId}>
                  {r.name}
                  {r.capacity ? ` (${r.capacity}인)` : ''}
                  {r.isReservable ? '' : ' · 예약 불가'}
                </option>
              ))}
            </select>
            <span className={styles.caret}>
              <Icon name="chevron-down" size={16} />
            </span>
          </span>

          {/* ★ 월간은 운영자 · 768 이상에서만 — 입주사에게는 **DOM 자체가 없다** */}
          {operator && wide !== 'sm' ? (
            <span className={styles.seg} data-seg="1">
              <button
                type="button"
                className={effectiveView === 'month' ? styles.segOn : undefined}
                onClick={() => setView('month')}
              >
                월간
              </button>
              <button
                type="button"
                className={effectiveView === 'week' ? styles.segOn : undefined}
                onClick={() => setView('week')}
              >
                주간
              </button>
            </span>
          ) : null}

          {wide === 'sm' ? null : (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
              data-add="1"
              disabled={!room}
              onClick={openCreateDefault}
            >
              <Icon name="plus" size={16} />
              예약 추가
            </button>
          )}
        </div>
      </div>

      {/* ── 날짜 스트립 (767 이하) ── */}
      {wide === 'sm' ? (
        <div className={styles.datestrip} data-strip="1">
          {weekDays(weekStart(anchor)).map((day, i) => (
            <button
              key={day}
              type="button"
              className={
                `${styles.dsDay}` +
                (day === anchor ? ` ${styles.dsOn}` : '') +
                (day === now.day ? ` ${styles.dsToday}` : '') +
                (lastBookable && day > lastBookable ? ` ${styles.dsOff}` : '')
              }
              onClick={() => setAnchor(day)}
            >
              <span className={styles.dsDow}>{WEEKDAY[i]}</span>
              <span className={styles.dsNum}>{dayNum(day)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* ── 패널 ── */}
      <div className={styles.panel}>
        {rooms !== null && rooms.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <Icon name="calendar-check" size={40} />
            </span>
            <p className={styles.emptyLead}>예약할 수 있는 회의실이 없습니다</p>
            <p className={styles.emptySub}>회의실은 운영사가 등록합니다</p>
          </div>
        ) : error ? (
          <div className={styles.empty}>
            <p className={styles.emptyLead}>{error}</p>
          </div>
        ) : effectiveView === 'month' ? (
          <>
            <div className={styles.scroll}>
              <div className={styles.mHead}>
                {WEEKDAY.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className={styles.mGrid} data-month="1">
                {month.days.map((day) => {
                  const outside = !inMonth(day, month.month);
                  const items = live.filter((r) => r.day === day);
                  const minutes = items.reduce(
                    (sum, r) => sum + (timeToMinutes(r.endTime) - timeToMinutes(r.startTime)),
                    0,
                  );
                  const span = rules ? rules.closeMinutes - rules.openMinutes : 1;
                  const hours = minutes / 60;
                  return (
                    <button
                      key={day}
                      type="button"
                      data-mcell={day}
                      disabled={outside}
                      className={
                        `${styles.mCell}` +
                        (day === now.day ? ` ${styles.mToday}` : '') +
                        (day < now.day ? ` ${styles.mPast}` : '')
                      }
                      title={items
                        .map((r) => `${r.startTime}–${r.endTime} ${orgLabel(r.companyName)}`)
                        .join('\n')}
                      onClick={() => {
                        setView('week');
                        setAnchor(day);
                      }}
                    >
                      <span className={styles.mNum}>{dayNum(day)}</span>
                      <span className={styles.track}>
                        {minutes ? (
                          <span className={styles.fill} style={{ width: `${(minutes / span) * 100}%` }} />
                        ) : null}
                      </span>
                      {items.length && !outside ? (
                        <span className={styles.mSum}>
                          {items.length}건 <span>· {hours % 1 ? hours.toFixed(1) : hours}h</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={styles.legend}>
              <span>막대 = 운영시간 대비 예약된 시간</span>
              <span className={styles.sp} />
              <span className={styles.rule}>날짜를 누르면 그 주의 주간 보기로 이동합니다</span>
            </div>
          </>
        ) : (
          <>
            <div className={styles.scroll} data-scroll="1" ref={scrollRef}>
              <div className={styles.gHead} style={{ gridTemplateColumns: gridCols }}>
                <div className={styles.hCell} />
                {days.map((day) => (
                  <div
                    key={`h-${day}`}
                    className={`${styles.hCell}${day === now.day ? ` ${styles.hToday}` : ''}`}
                  >
                    <span className={styles.hDow}>{WEEKDAY[dowOf(day)]}</span>
                    <span className={styles.hNum}>{dayNum(day)}</span>
                  </div>
                ))}
              </div>

              <div className={styles.gBody} style={{ gridTemplateColumns: gridCols }}>
                {/* 시간 열 — 정시만 적는다 */}
                <div className={styles.tCol}>
                  {Array.from({ length: slotCount }, (_, i) => {
                    const t = (rules?.openMinutes ?? 0) + i * SLOT_MINUTES;
                    return (
                      <div key={t} className={`${styles.tRow}${t % 60 ? ` ${styles.half}` : ''}`}>
                        {t % 60 ? '' : minutesToTime(t)}
                      </div>
                    );
                  })}
                </div>

                {days.map((day) => (
                  <div
                    key={`c-${day}`}
                    className={`${styles.dCol}${day === now.day ? ` ${styles.dToday}` : ''}`}
                    data-date={day}
                  >
                    {Array.from({ length: slotCount }, (_, i) => {
                      const t = (rules?.openMinutes ?? 0) + i * SLOT_MINUTES;
                      const why = blockedReason(day, t);
                      return (
                        <div
                          key={t}
                          data-cell="1"
                          data-date={day}
                          data-slot={i}
                          className={
                            `${styles.cell}` +
                            (t % 60 ? ` ${styles.half}` : '') +
                            (isPastSlot(day, t) || why === 'past' ? ` ${styles.cellPast}` : '') +
                            (why ? ` ${styles.cellBlocked}` : '') +
                            (why === 'limit' ? ` ${styles.cellLimit}` : '')
                          }
                          title={
                            why === 'limit'
                              ? `${md(lastBookable!)}까지 예약할 수 있습니다`
                              : why === 'past'
                              ? '지난 시각은 예약할 수 없습니다'
                              : undefined
                          }
                          onPointerDown={(e) => onCellDown(day, i, e)}
                          onPointerOver={() => onCellOver(day, i)}
                        />
                      );
                    })}

                    {/* 예약 블록 — 절대배치 한 덩어리 */}
                    {live
                      .filter((r) => r.day === day)
                      .map((r) => (
                        <BookingBlock
                          key={r.reservationId}
                          reservation={r}
                          openMinutes={rules?.openMinutes ?? 0}
                          operator={operator}
                          wide={wide}
                          now={now}
                          onOpen={openBooking}
                        />
                      ))}

                    {/* 남의 예약 — 시각만 안다. 「예약됨」으로 잠근다(026) */}
                    {masked
                      .filter((b) => b.day === day)
                      .map((b) => {
                        const start = timeToMinutes(b.startTime);
                        const slots = (timeToMinutes(b.endTime) - start) / SLOT_MINUTES;
                        return (
                          <div
                            key={`m-${b.startTime}`}
                            className={styles.bk}
                            data-busy="1"
                            style={{
                              top: ((start - (rules?.openMinutes ?? 0)) / SLOT_MINUTES) * SLOT_H + 1,
                              height: slots * SLOT_H - 2,
                            }}
                          >
                            <span className={styles.bkTime}>
                              {b.startTime}–{b.endTime}
                            </span>
                            {slots >= 2 || wide === 'sm' ? <span className={styles.bkName}>예약됨</span> : null}
                          </div>
                        );
                      })}

                    {/* 현재 시각 */}
                    {day === now.day &&
                    rules &&
                    now.minutes >= rules.openMinutes &&
                    now.minutes < rules.closeMinutes ? (
                      <div
                        className={styles.nowLine}
                        data-now="1"
                        style={{ top: ((now.minutes - rules.openMinutes) / SLOT_MINUTES) * SLOT_H }}
                      />
                    ) : null}

                    {/* 드래그 고스트 */}
                    {drag && drag.day === day && rules ? (
                      <div
                        className={styles.ghost}
                        data-ghost="1"
                        style={{ top: drag.lo * SLOT_H + 1, height: (drag.hi - drag.lo + 1) * SLOT_H - 2 }}
                      >
                        <span className={styles.ghostTime}>
                          {minutesToTime(rules.openMinutes + drag.lo * SLOT_MINUTES)}–
                          {minutesToTime(rules.openMinutes + (drag.hi + 1) * SLOT_MINUTES)} (
                          {dur((drag.hi - drag.lo + 1) * SLOT_MINUTES)})
                        </span>
                        {drag.capped ? (
                          <span className={styles.ghostCap}>최대 {dur(rules.maxMinutes ?? 0)}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* ── 범례 ── */}
            <div className={styles.legend} data-legend="1">
              <span className={styles.sw}>
                <span className={styles.swConfirmed} />
                확정
              </span>
              <span className={styles.sw}>
                <span className={styles.swDone} />
                종료
              </span>
              {lastBookable ? (
                <span className={styles.sw}>
                  <span className={styles.swLimit} />
                  예약 가능 기간 밖
                </span>
              ) : null}
              <span className={styles.sw}>
                <span className={styles.swNow} />
                현재 시각
              </span>
              <span className={styles.sp} />
              <span className={styles.rule}>{ruleText}</span>
            </div>
          </>
        )}
      </div>

      {/* ── 767 이하 하단 CTA ── */}
      {wide === 'sm' ? (
        <div className={styles.mCta}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            data-add-mobile="1"
            disabled={!room}
            onClick={openCreateDefault}
          >
            <Icon name="plus" size={18} />
            예약 추가
          </button>
        </div>
      ) : null}

      {form && rooms ? (
        <BookingForm
          seed={form}
          rooms={rooms}
          companies={companies}
          operator={operator}
          widthMode={wide}
          me={me}
          lastBookable={lastBookable}
          usedMinutesOn={usedOn}
          asOf={now}
          overlaps={overlaps}
          onClose={() => setForm(null)}
          /* ★ 수정 모달은 **열어 둔 채** 확인 창을 위에 띄운다 — [돌아가기] 면 하던 자리로
             돌아온다(시안 03-booking-form.md §5). 닫아 버리면 취소를 그만둔 사람이
             처음부터 다시 찾아 들어가야 한다. */
          onCancelAsk={(r) => setConfirming(r)}
          onComplete={(r) => void complete(r)}
          onDone={(message, moved) => {
            setForm(null);
            // ★ 저장한 회의실·날짜로 옮겨 간다 — 모달에서 방을 바꿨을 수 있다.
            setRoomId(moved.facilityId);
            setAnchor(moved.day);
            setView('week');
            notify(message);
            reload();
          }}
        />
      ) : null}

      {confirming ? (
        <CancelConfirm
          reservation={confirming}
          widthMode={wide}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            setForm(null);
            notify('예약을 취소했습니다');
            reload();
          }}
        />
      ) : null}

      {toast ? (
        <div className={styles.toast}>
          <Icon name="check" size={16} />
          <span>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 예약 블록 — 시간 · 제목 · 조직·인원 · 뱃지.
 *
 * ★ 칸 수에 따라 줄이 늘어난다(시안 `bookingEl`): 1칸이면 시간만, 2칸부터 제목,
 *   3칸부터 「조직 · N명」. 767 이하는 1칸이어도 제목을 보여 준다(열이 넓다).
 * ★ 남의 조직 예약은 「예약됨」이지만, 입주사에게는 애초에 상세가 오지 않는다(026) —
 *   그래서 이 컴포넌트가 그리는 것은 **볼 수 있는 예약**뿐이다.
 */
function BookingBlock({
  reservation,
  openMinutes,
  operator,
  wide,
  now,
  onOpen,
}: {
  reservation: Reservation;
  openMinutes: number;
  operator: boolean;
  wide: WidthMode;
  now: { day: string; minutes: number };
  onOpen: (r: Reservation) => void;
}) {
  const start = timeToMinutes(reservation.startTime);
  const slots = (timeToMinutes(reservation.endTime) - start) / SLOT_MINUTES;
  const done = shownStatus(reservation, now) === 'completed';
  const showName = slots >= 2 || wide === 'sm';
  /**
   * 「입주사」「운영사」「외부」 뱃지 — **운영자 화면에서만**(시안 `bookingEl`).
   *
   * ★ 입주사 화면에는 붙이지 않는다. 자기 예약과 「예약됨」뿐이라 구분할 것이 없다.
   * ★ 「외부」는 **자리만 있다** — 외부 손님 예약은 2차다(`025` 주석). 그때가 오면
   *   예약 행의 구분 칸을 보고 이 자리에서 갈린다. 지금 값이 들어올 길은 없다.
   */
  const ownLabel = !operator
    ? null
    : reservation.companyId === null
    ? '운영사'
    : '입주사';

  return (
    <button
      type="button"
      className={`${styles.bk} ${styles.bkFull}${done ? ` ${styles.bkDone}` : ''}`}
      data-bk={reservation.reservationId}
      style={{ top: ((start - openMinutes) / SLOT_MINUTES) * SLOT_H + 1, height: slots * SLOT_H - 2 }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(reservation);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className={styles.bkTime}>
        {reservation.startTime}–{reservation.endTime}
      </span>
      {showName ? <span className={styles.bkName}>{reservation.title}</span> : null}
      {slots >= 3 ? (
        <span className={styles.bkMeta}>
          {orgLabel(reservation.companyName)}
          {reservation.attendees ? ` · ${reservation.attendees}명` : ''}
        </span>
      ) : null}
      {ownLabel ? <span className={styles.bkOwn}>{ownLabel}</span> : null}
    </button>
  );
}

/**
 * 예약 취소 확인 — 480px(시안 `03-booking-form.md` §5).
 *
 * ★★ **되돌릴 수 없다.** 누르자마자 지워지면 잘못 누른 사람이 되돌릴 방법이 없고,
 *    그 시간은 이미 다른 조직이 가져갈 수 있다.
 * ★ 사유 칸은 **우리가 더 남기는 것**이다(시안에는 없다).
 */
function CancelConfirm({
  reservation,
  widthMode,
  onClose,
  onDone,
}: {
  reservation: Reservation;
  widthMode: WidthMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(reservation.reservationId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancelReason: reason.trim() || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? '취소하지 못했습니다');
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className={`${styles.overlay}${widthMode === 'sm' ? ` ${styles.overlayNarrow}` : ''}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`${styles.modal} ${styles.modalSm}`}
        role="alertdialog"
        aria-modal="true"
        aria-label="예약 취소 확인"
      >
        <div className={styles.confirm}>
          <div className={styles.confirmIcon}>
            <Icon name="circle-x" size={24} />
          </div>
          <h3 className={styles.confirmTitle}>예약을 취소하시겠습니까?</h3>
          <p className={styles.confirmText}>
            취소한 시간은 바로 다른 조직이 예약할 수 있습니다.
            <br />이 작업은 되돌릴 수 없습니다.
          </p>
          <div className={styles.confirmSum}>
            {reservation.roomName} · {md(reservation.day)} {reservation.startTime}–{reservation.endTime}
          </div>
          <label className={`${styles.field} ${styles.confirmReason}`}>
            <span className={styles.label}>취소 사유 (선택)</span>
            <input
              className={styles.input}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error ? <p className={styles.err}>{error}</p> : null}
        </div>
        <div className={styles.confirmFoot}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={onClose}>
            돌아가기
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            data-cancel-do="1"
            disabled={busy}
            onClick={() => void submit()}
          >
            예약 취소
          </button>
        </div>
      </div>
    </div>
  );
}

/** 규칙 사유 문구는 모달과 같은 것을 쓴다. */
export { messageFor, validateReservation };
