'use client';

/**
 * 내 예약 — 보기 전용 (/booking/mine · s030600010) · 앱 1단계 6-나 (대표 지시 2026-11-07)
 *
 * =============================================================================
 * ★★ 보기 전용이다 — 예약 · 수정 · 취소는 /booking 한 곳뿐 (CLAUDE.md 「한 업무는 한 화면에서」)
 * =============================================================================
 * 처리 버튼이 없다. 한 건을 누르면 /booking 의 그날 · 그 회의실로 **링크 이동**하고, 「예약하기」도
 * /booking 으로 가는 링크다. 링크 이동이라 방문 기록이 남아 앱 웹뷰의 [뒤로]가 이 목록으로 돌아온다.
 *
 * ★ 목록 : 우리 회사 예약 · 오늘부터 183일(대표 답) · 확정만(끝난 것 · 취소 뺌) · 가까운 날짜 순.
 *   거르기 · 정렬 · 한 줄 · 가는 주소는 shared `domain/my-bookings` 하나다.
 * ★ 회사 거르기는 서버가 한다 — 입주사 세션의 `GET /reservations`(회의실 없이)는 RLS 로 자기 회사 것만 온다.
 *   (운영사 세션은 전부 온다 — 이 화면은 입주사가 쓰는 화면이다)
 * ★ 데이터는 클라이언트가 받는다 — 「지금」을 보는 사람의 시각으로 정한다(예약 화면과 같다).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { localDayMinutes } from '@swonbiz/shared/domain/reservation-rules';
import {
  BOOK_HREF,
  myBookingHref,
  myBookingLine,
  myBookingsRange,
  pickMyBookings,
  type MyBooking,
} from '@swonbiz/shared/domain/my-bookings';
import { Icon } from '@/components/ds';
import styles from './my-bookings.module.css';

export function MyBookingsView() {
  const [items, setItems] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const asOf = localDayMinutes(new Date());
    const { from, to } = myBookingsRange(asOf.day);
    fetch(`/api/reservations?from=${from}&to=${to}`)
      .then(async (res) => {
        const body = (await res.json()) as { reservations?: MyBooking[]; message?: string };
        if (!res.ok) throw new Error(body.message ?? '예약을 불러오지 못했습니다');
        if (alive) setItems(pickMyBookings(body.reservations ?? [], asOf));
      })
      .catch((e: Error) => {
        if (!alive) return;
        setItems([]);
        setError(e.message || '예약을 불러오지 못했습니다');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          {/* ★ 앱 안이면 감춘다 — 앱 위 띠가 제목을 보인다(AppShell.module.css `[data-app-band-title]`) */}
          <h1 className={styles.title} data-app-band-title="1">
            내 예약
          </h1>
          <p className={styles.sub}>
            {items === null ? '불러오는 중입니다' : error ? error : `오늘부터 예정된 우리 회사 예약 ${items.length}건`}
          </p>
        </div>
        <Link href={BOOK_HREF} className={`${styles.btn} ${styles.btnPrimary}`} data-book="1">
          <Icon name="plus" size={16} />
          예약하기
        </Link>
      </div>

      <div className={styles.panel}>
        {items === null ? (
          <Empty icon="calendar-check" lead="예약을 불러오는 중입니다" />
        ) : error ? (
          <Empty icon="circle-alert" lead={error} />
        ) : items.length === 0 ? (
          <Empty icon="calendar-check" lead="예정된 예약이 없습니다" sub="「예약하기」에서 회의실을 예약할 수 있습니다" />
        ) : (
          <ul className={styles.list}>
            {items.map((r) => {
              const line = myBookingLine(r);
              return (
                <li key={r.reservationId}>
                  <Link href={myBookingHref(r)} className={styles.row} data-booking-row={r.reservationId}>
                    <span className={styles.when}>{line.when}</span>
                    <span className={styles.room}>{line.room}</span>
                    <span className={styles.booker}>{line.booker}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ icon, lead, sub }: { icon: 'calendar-check' | 'circle-alert'; lead: string; sub?: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={40} />
      </span>
      <p className={styles.emptyLead}>{lead}</p>
      {sub ? <p className={styles.emptySub}>{sub}</p> : null}
    </div>
  );
}
