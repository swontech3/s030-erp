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
import { useRouter } from 'next/navigation';
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
import { Icon, Table, TableEmpty, TableHead, TableRow, tableCell } from '@/components/ds';
import styles from './my-bookings.module.css';

/**
 * 목록 표 칸 — 날짜 · 시간 / 회의실 / 예약한 사람(2026-11-26 일관성 · 카드 세 줄 → 공통 Table 세 칸).
 * ★ 앱 웹뷰(폭 360 안팎)에서도 세 칸이 들어가게 고정 폭 없이 비율로 나눈다. 넘치면 말줄임.
 */
const LIST_COLS = 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,0.8fr)';

export function MyBookingsView() {
  const router = useRouter();
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
      </div>

      {/*
        ★ 2026-11-26 일관성 — 「예약하기」는 예약 화면으로 가는 등록 단추라 보통 단추 · 표 위 왼쪽(종전 머리 오른쪽 주 단추).
          링크 이동(방문 기록 · 앱 [뒤로])을 지키려고 공통 Button(as="a")이 아니라 Link 에 보통 단추 모양을 입혔다.
      */}
      <div className={styles.bar}>
        <Link href={BOOK_HREF} className={`${styles.btn} ${styles.btnGhost}`} data-book="1">
          <Icon name="plus" size={16} />
          예약하기
        </Link>
      </div>

      <div className={styles.panel}>
        {/* ★ 2026-11-26 일관성 — 카드 목록 → 공통 Table(머리글 아쿠아). 한 줄을 누르면 종전처럼 예약 화면의 그날 · 그 회의실로 간다 */}
        <div className={styles.scroll}>
          <Table cols={LIST_COLS}>
            <TableHead sticky>
              <span>날짜 · 시간</span>
              <span>회의실</span>
              <span>예약한 사람</span>
            </TableHead>
            {items === null ? (
              <TableEmpty>
                <Empty icon="calendar-check" lead="예약을 불러오는 중입니다" />
              </TableEmpty>
            ) : error ? (
              <TableEmpty>
                <Empty icon="circle-alert" lead={error} />
              </TableEmpty>
            ) : items.length === 0 ? (
              <TableEmpty>
                <Empty icon="calendar-check" lead="예정된 예약이 없습니다" sub="「예약하기」에서 회의실을 예약할 수 있습니다" />
              </TableEmpty>
            ) : (
              items.map((r) => {
                const line = myBookingLine(r);
                return (
                  <TableRow key={r.reservationId} onClick={() => router.push(myBookingHref(r))}>
                    <span className={`${styles.when} ${tableCell.ellipsis}`}>{line.when}</span>
                    <span className={tableCell.ellipsis}>{line.room}</span>
                    <span className={tableCell.ellipsis}>{line.booker}</span>
                  </TableRow>
                );
              })
            )}
          </Table>
        </div>
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
