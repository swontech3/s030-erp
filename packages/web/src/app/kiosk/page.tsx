/** @screen s0300500060 회의실 현황판 · 050 공개 화면 */

/**
 * 회의실 현황판 — 회의실 문 옆 벽면 태블릿.
 *
 * 원본: design/erp-booking-kiosk/ErpBookingKiosk.dc.html
 * 시안: design/handoff/prototypes/s0300500060.html · 명세: room-booking/06-kiosk.md
 *
 * =============================================================================
 * ★★★ 로그인이 없다 — 050 공개 화면
 * =============================================================================
 * `(erp)` 그룹 **밖**에 있다. 셸도 사이드바도 세션도 없다. `proxy.ts` 의 matcher 에
 * `/kiosk` 가 없어서 로그인으로 튕기지 않고, Fastify 쪽 `/kiosk/board` 는
 * `config: { public: true }` 다 — **양쪽 모두** 공개라고 적어야 열린다.
 *
 * ★★ 기기 토큰은 아직 없다. 시안 §7 이 제안한 `?token=` 은 발급·폐기 화면이
 *    회의실 설정(4차)에 들어간 뒤에 붙인다 — 발급 수단이 SQL 뿐인 토큰은 아무도
 *    폐기하지 않아 잠금 장치 노릇을 못 한다(2026-09-27 결정 · api/routes/kiosk.ts 머리말).
 *    지금 이 주소로 볼 수 있는 것은 **시각과 「예약됨」뿐**이다.
 *
 * ★ QR 은 **여기서 한 번** 만든다(06-kiosk §6 「서버에서 한 번 생성」). 주소가
 *   회의실마다 고정이라 30초마다 다시 만들 이유가 없다.
 */
import QRCode from 'qrcode';
import { KioskBoard } from '@/features/kiosk/KioskBoard';
import styles from '@/features/kiosk/kiosk.module.css';

export const metadata = { title: '회의실 현황판' };

/**
 * QR 이 여는 주소의 앞부분.
 *
 * ★ 기본값은 시안·명세에 적힌 운영 주소 그대로다(06-kiosk §6). 개발기에서는 그 도메인이
 *   없으므로 `ERP_PUBLIC_ORIGIN` 으로 갈아 끼운다 — 태블릿이 스캔해 열 주소이지
 *   현황판 자신이 부르는 주소가 아니라서, 브라우저가 보고 있는 주소로는 알 수 없다.
 */
const QR_ORIGIN = process.env.ERP_PUBLIC_ORIGIN ?? 'https://erp.swonbiz.com';

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await searchParams;
  const roomId = (room ?? '').trim();

  if (!roomId) {
    // ★ 시안에 없는 화면이다 — 주소에 회의실이 없으면 빈 판 대신 그렇게 말한다.
    //   벽에 걸고 나면 콘솔을 볼 사람이 없다.
    return (
      <div className={styles.stage}>
        <div className={styles.board}>
          <div className={styles.setup}>
            <p className={styles.setupLead}>회의실이 지정되지 않았습니다</p>
            <p className={styles.setupSub}>
              주소 끝에 회의실을 붙여 주세요. 회의실 식별자는 운영자에게 받습니다.
            </p>
            <p className={styles.setupCode}>/kiosk?room=&#123;회의실 ID&#125;</p>
          </div>
        </div>
      </div>
    );
  }

  /* ★ `room` 과 `src` 두 파라미터는 유지한다(06-kiosk §6) — 경로만 우리 라우트다. */
  const qrUrl = `${QR_ORIGIN}/booking?room=${encodeURIComponent(roomId)}&src=kiosk`;
  const qrSvg = await QRCode.toString(qrUrl, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B1120', light: '#0000' },
  });

  return <KioskBoard roomId={roomId} qrSvg={qrSvg} qrUrl={qrUrl} />;
}
