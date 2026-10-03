'use client';

/**
 * s030500060 회의실 현황판 — 벽면 태블릿. **로그인 없음 · 표시 전용 · 24시간 켜 둠.**
 *
 * 시안: design/handoff/prototypes/s0300500060.html (2026-09-27 2차 인계)
 * 명세: design/handoff/room-booking/06-kiosk.md
 * ★ 이 파일은 시안의 `paint()` · `paintBanner()` · `paintRows()` · `paintCards()` 를
 *   React 로 옮긴 것이다. 문구·치수·판정 순서를 시안에서 그대로 가져왔다.
 *
 * =============================================================================
 * ★★★ 보여 주는 것은 **시각과 「예약됨」뿐이다**
 * =============================================================================
 * 복도를 지나는 누구나 보는 화면이다. 제목·조직·예약자는 이 컴포넌트에 **들어오지도
 * 않는다** — 서버가 `erp_busy_slots`(026)로만 읽어 시각 둘을 준다. 마스킹하는 코드가
 * 여기 없는 것이 맞다. 거를 것이 있으면 이미 늦은 것이다.
 *
 * =============================================================================
 * ★★ 두 주기 — 데이터 30초 · 시계 1초
 * =============================================================================
 * 데이터를 1초마다 받으면 하루 86,400회다(06-kiosk §7). 시계와 현재 시각 마커는
 * **로컬에서** 1초마다 움직이고, 예약은 30초마다 받는다. 화면이 멈춘 것처럼 보이지
 * 않으면서 요청은 하루 2,880회로 끝난다.
 *
 * =============================================================================
 * ★★ 끊기면 **마지막 데이터로 계속 판정하다가, 30분이 넘으면 멈춘다**
 * =============================================================================
 * 30분이 넘으면 그 사이 취소·추가가 반영되지 않아 **틀린 「비어 있음」** 을 보여 줄 수
 * 있다. 틀린 안내는 없는 안내보다 나쁘다 — 그래서 판정을 멈추고 그렇게 말한다(§9).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ds';
import styles from './kiosk.module.css';

/** 데이터 30초 — 06-kiosk §7. */
const POLL_MS = 30_000;
/** 시계·마커 1초(로컬). */
const TICK_MS = 1_000;
/** 이 이상 끊기면 현황 판정을 멈춘다(분). */
const STALE_MIN = 30;
/** 한 행 최대 18슬롯 = 9시간. */
const ROW_MAX_SLOTS = 18;
const SLOT = 30;

interface Busy {
  startTime: string;
  endTime: string;
}

interface Board {
  room: { facilityId: string; name: string; openTime: string; closeTime: string };
  day: string;
  serverTime: string;
  busy: Busy[];
}

interface Props {
  roomId: string;
  /** 서버가 만든 QR(SVG 원문) — 주소가 바뀌지 않으므로 한 번만 만든다(06-kiosk §6). */
  qrSvg: string;
  /**
   * QR 이 여는 주소. **눈에 보이지 않는다** — `data-qr-url` 로만 붙인다.
   * ★ 설치한 사람이 「이 QR 이 어디로 가는가」를 개발자 도구로 확인할 수 있어야 하고,
   *   검증 스크립트도 그림을 해독하지 않고 이 값을 본다. 공개 주소라 숨길 것이 없다.
   */
  qrUrl: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 분 → `HH:MM`. */
const fmt = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
/** `HH:MM` → 분. */
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

export function KioskBoard({ roomId, qrSvg, qrUrl }: Props) {
  const [board, setBoard] = useState<Board | null>(null);
  /** 회의실을 못 찾았다(404) — 주소가 잘못 붙은 태블릿이다. */
  const [missing, setMissing] = useState(false);
  /** 마지막으로 성공한 시각(로컬 ms). 끊김 판정의 기준이다. */
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  /** 서버 시계 − 태블릿 시계(ms). 기기 시계가 틀어져 있어도 서버 기준으로 보여 준다. */
  const [offsetMs, setOffsetMs] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [fade, setFade] = useState(false);
  const [dev, setDev] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const stamp = useRef('');
  /** 서버 시각 보정을 이미 했는가 — **첫 응답 한 번만** 맞춘다(06-kiosk §7). */
  const synced = useRef(false);
  const devTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 1280×800 판을 화면에 맞춰 확대 ────────────────────────────────────── */
  useEffect(() => {
    const read = () => setScale(Math.min(window.innerWidth / 1280, window.innerHeight / 800));
    read();
    window.addEventListener('resize', read);
    // ★ 태블릿을 돌려 끼우는 설치가 있다 — 방향이 바뀌면 다시 잰다.
    window.addEventListener('orientationchange', read);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
    };
  }, []);

  /* ── 데이터 30초 ───────────────────────────────────────────────────────── */
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/kiosk/board?room=${encodeURIComponent(roomId)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setMissing(true);
        setFailing(false);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Board;
      setMissing(false);
      setFailing(false);
      setLastOk(Date.now());
      // ★ 서버 시각은 **첫 응답에서만** 받아 보정한다. 매번 맞추면 폴링 지터가 시계를 떨게 한다.
      //   서버는 분 단위로 주므로 로컬도 분으로 잘라 뺀다 — 초 자리 때문에 1분 밀리지 않게.
      if (!synced.current) {
        synced.current = true;
        setOffsetMs(dayTimeToMs(body.day, body.serverTime) - Math.floor(Date.now() / 60_000) * 60_000);
      }
      const next = JSON.stringify(body.busy) + body.day;
      if (stamp.current && stamp.current !== next) {
        // 바뀐 것이 있을 때만 페이드 — 30초마다 깜빡이면 벽에서 거슬린다
        setFade(false);
        requestAnimationFrame(() => setFade(true));
        setTimeout(() => setFade(false), 460);
      }
      stamp.current = next;
      setBoard(body);
    } catch {
      // ★ 끊겨도 마지막 데이터를 지우지 않는다 — 스트립만 켜고 계속 보여 준다(§9).
      setFailing(true);
    }
  }, [roomId]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  /* ── 시계 1초 ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  /* ── 화면 꺼짐 방지 — 해제되면 5초 후, 실패하면 10초 후 재시도(§7) ────── */
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;
    const request = () => {
      if (dead || !navigator.wakeLock) return;
      navigator.wakeLock
        .request('screen')
        .then((got) => {
          lock = got;
          got.addEventListener('release', () => {
            retry = setTimeout(request, 5_000);
          });
        })
        .catch(() => {
          retry = setTimeout(request, 10_000);
        });
    };
    request();
    // 화면이 잠겼다 돌아오면 잠금이 풀려 있다 — 돌아올 때 다시 건다.
    const onVisible = () => {
      if (document.visibilityState === 'visible') request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  useEffect(
    () => () => {
      if (devTimer.current) clearTimeout(devTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
    },
    [],
  );

  /* ── 지금 몇 시인가 — 서버 보정을 얹은 로컬 시계 ─────────────────────── */
  const at = new Date(tick + offsetMs);
  const nowMin = at.getHours() * 60 + at.getMinutes();
  const offMin = lastOk === null ? 0 : Math.floor((tick - lastOk) / 60_000);
  /** 첫 폴링 실패부터 스트립을 켠다(§9). */
  const offline = failing && lastOk !== null;
  const stale = offline && offMin >= STALE_MIN;

  const room = board?.room ?? null;
  const open = room ? toMin(room.openTime) : 0;
  const close = room ? toMin(room.closeTime) : 0;
  const busy = useMemo(
    () => [...(board?.busy ?? [])].sort((a, z) => toMin(a.startTime) - toMin(z.startTime)),
    [board],
  );

  const live = busy.find((b) => nowMin >= toMin(b.startTime) && nowMin < toMin(b.endTime)) ?? null;
  const upcoming = busy.filter((b) => toMin(b.startTime) > nowMin);
  const next = upcoming[0] ?? null;

  if (missing || (!board && failing && lastOk === null)) {
    return (
      <div className={styles.stage}>
        <div className={styles.board} style={{ '--k-scale': scale } as React.CSSProperties}>
          <div className={styles.setup}>
            <p className={styles.setupLead}>
              {missing ? '회의실을 찾을 수 없습니다' : '서버에 연결할 수 없습니다'}
            </p>
            <p className={styles.setupSub}>
              {missing
                ? '주소의 회의실이 없거나 사용 중지되었습니다. 설치 주소를 확인해 주세요.'
                : '연결되면 자동으로 표시됩니다.'}
            </p>
            <p className={styles.setupCode}>/kiosk?room={roomId}</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── 배너 — 판정 순서를 시안 `paintBanner` 그대로 따른다 ──────────────── */
  let bannerLive = false;
  let main = '';
  let sub = '';
  if (stale) {
    main = '현황을 확인할 수 없습니다';
    sub = '연결되면 자동으로 갱신됩니다';
  } else if (!room) {
    main = '불러오는 중';
    sub = '';
  } else if (nowMin < open) {
    main = '운영 시작 전';
    sub = `${fmt(open)}부터${next ? ` · 첫 예약 ${next.startTime}` : ''}`;
  } else if (nowMin >= close) {
    main = '운영 종료';
    // ★ 「내일 09:00」 — 다음 운영일의 그 회의실 open 이다(휴무일 처리는 TBD · §3).
    sub = `내일 ${room.openTime}부터`;
  } else if (live) {
    bannerLive = true;
    main = `사용 중 · ${live.endTime}까지`;
    /* 바로 이어지는 예약이 있으면 비는 시각이 아니라 연속 사용임을 알린다 */
    const cont = busy.find((b) => b.startTime === live.endTime);
    sub = cont
      ? `이어서 예약 ${cont.startTime}–${cont.endTime}`
      : next
        ? `다음 예약 ${next.startTime}`
        : '이후 예약 없음';
  } else {
    main = next ? `비어 있음 · ${next.startTime}까지` : '비어 있음';
    sub = next ? `다음 예약 ${next.startTime}–${next.endTime}` : '오늘 남은 예약 없음';
  }

  /* ── 타임라인 행 — 운영시간을 18슬롯(9시간)씩 나눈다 ─────────────────── */
  const total = room ? (close - open) / SLOT : 0;
  const rows: { from: number; to: number }[] = [];
  for (let from = 0; from < total; from += ROW_MAX_SLOTS) {
    rows.push({ from, to: Math.min(from + ROW_MAX_SLOTS, total) });
  }
  /** 짧은 행의 폭을 줄여 **모든 행의 30분 폭을 같게** 한다(§4). */
  const unit = Math.min(ROW_MAX_SLOTS, total);

  const cards = upcoming.slice(0, 3);
  const dayLabel = board
    ? `${at.getMonth() + 1}월 ${at.getDate()}일 ${WEEKDAY_LONG[at.getDay()]}`
    : '';
  const outside = !!room && (nowMin < open || nowMin >= close);

  const onTap = () => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, 600);
    if (tapCount.current < 3) return;
    tapCount.current = 0;
    setDev(
      `${window.innerWidth} × ${window.innerHeight} (×${scale.toFixed(2)})\n` +
        `room ${roomId.slice(0, 8)} · 갱신 ${lastOk === null ? '—' : fmt(minutesOfDay(new Date(lastOk + offsetMs)))}`,
    );
    if (devTimer.current) clearTimeout(devTimer.current);
    devTimer.current = setTimeout(() => setDev(null), 5_000);
  };

  return (
    <div className={styles.stage}>
      <div className={styles.board} style={{ '--k-scale': scale } as React.CSSProperties}>
        {outside ? (
          <div className={styles.dim} data-dim="1">
            <span>운영 시간 외</span>
          </div>
        ) : null}
        {dev ? (
          <div className={styles.dev} data-dev="1">
            {dev.split('\n').map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
        <button type="button" className={styles.hit} aria-label="개발 정보" onClick={onTap} />

        <div className={`${styles.screen}${fade ? ` ${styles.isFade}` : ''}`}>
          {offline ? (
            <div className={styles.offline} data-offline="1">
              <Icon name="wifi-off" size={22} />
              <span className={styles.offlineText}>연결이 끊어졌습니다</span>
              <span className={styles.offlineAt}>
                마지막 갱신 {lastOk === null ? '—' : fmt(minutesOfDay(new Date(lastOk + offsetMs)))}
              </span>
            </div>
          ) : null}

          <div className={styles.head}>
            <div className={styles.headLeft}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 고정 크기 로고 하나. next/image 의 최적화가 필요 없다 */}
              <img className={styles.logo} src="/brand/swonbiz-logo.png" alt="" />
              <div>
                <div className={styles.room} data-room="1">
                  {room?.name ?? ''}
                </div>
                <div className={styles.date}>{dayLabel}</div>
              </div>
            </div>
            <div className={styles.clock} data-clock="1">
              {fmt(nowMin)}
            </div>
          </div>

          <div className={`${styles.banner}${bannerLive ? ` ${styles.isLive}` : ''}`} data-banner="1">
            <span className={styles.dot} />
            <span className={styles.bannerMain} data-banner-main="1">
              {main}
            </span>
            <span className={styles.bannerSub} data-banner-sub="1">
              {sub}
            </span>
          </div>

          <div className={`${styles.body}${stale ? ` ${styles.isStale}` : ''}`}>
            <div className={styles.rows} data-rows="1">
              {rows.map(({ from, to }) => {
                const span = to - from;
                const t0 = open + from * SLOT;
                const t1 = open + to * SLOT;
                const pct = (slots: number) => (slots / span) * 100;
                const hours: number[] = [];
                for (let m = Math.ceil(t0 / 60) * 60; m <= t1; m += 60) hours.push(m);
                return (
                  <div key={t0} className={styles.row} data-row="1">
                    <div className={styles.rowLabel}>
                      {fmt(t0).slice(0, 2)}–{fmt(t1).slice(0, 2)}
                    </div>
                    <div className={styles.timeline} style={{ width: `calc((100% - 72px) * ${span / unit})` }}>
                      <div className={styles.ticks}>
                        {hours.map((m) => (
                          <span
                            key={m}
                            style={{
                              left: `${pct((m - t0) / SLOT)}%`,
                              transform:
                                m === t0 ? 'none' : m === t1 ? 'translateX(-100%)' : 'translateX(-50%)',
                              opacity: m < nowMin ? 0.3 : 1,
                            }}
                          >
                            {pad2(m / 60)}
                          </span>
                        ))}
                        {nowMin >= t0 && nowMin < t1 ? (
                          <span className={styles.tri} style={{ left: `${pct((nowMin - t0) / SLOT)}%` }} />
                        ) : null}
                      </div>
                      <div className={styles.track}>
                        {Array.from({ length: span - 1 }, (_, i) => i + 1).map((i) => (
                          <div
                            key={i}
                            className={`${styles.grid}${(t0 + i * SLOT) % 60 ? ` ${styles.gridHalf}` : ''}`}
                            style={{ left: `${pct(i)}%` }}
                          />
                        ))}
                        {busy.map((b) => {
                          const s = Math.max(toMin(b.startTime), t0);
                          const e = Math.min(toMin(b.endTime), t1);
                          if (e <= s) return null;
                          return (
                            <div
                              key={`${b.startTime}-${b.endTime}`}
                              className={styles.bar}
                              data-bar="1"
                              style={{ left: `${pct((s - t0) / SLOT)}%`, width: `${pct((e - s) / SLOT)}%` }}
                            />
                          );
                        })}
                        {nowMin >= t0 && nowMin < t1 ? (
                          <div
                            className={styles.now}
                            data-now="1"
                            style={{ left: `${pct((nowMin - t0) / SLOT)}%` }}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.foot}>
              <div className={styles.next}>
                <h2 className={styles.nextTitle}>다음 예약</h2>
                <div className={styles.cards} data-cards="1">
                  {cards.length === 0 ? (
                    <div className={styles.cardsEmpty}>
                      {room && nowMin >= close ? '오늘 예약이 모두 끝났습니다' : '오늘 남은 예약이 없습니다'}
                    </div>
                  ) : (
                    cards.map((b) => (
                      <div key={`${b.startTime}-${b.endTime}`} className={styles.card} data-card="1">
                        <div className={styles.cardTime}>
                          {b.startTime} – {b.endTime}
                        </div>
                        {/* ★ 「예약됨」이 전부다 — 누구의 무슨 회의인지는 이 화면에 오지 않는다 */}
                        <div className={styles.cardTag}>예약됨</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={styles.qr}>
                {/* QR 은 서버가 만든 SVG 원문이다 — 우리가 만든 문자열이고 사용자 입력이 아니다 */}
                <div
                  className={styles.qrCode}
                  data-qr="1"
                  data-qr-url={qrUrl}
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <div>
                  <div className={styles.qrLead}>지금 예약하기</div>
                  <div className={styles.qrSub}>휴대폰으로 스캔</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** `YYYY-MM-DD` + `HH:MM` → 로컬 ms. 서버 시각 보정에 쓴다. */
function dayTimeToMs(day: string, time: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, Number(time.slice(0, 2)), Number(time.slice(3, 5))).getTime();
}
