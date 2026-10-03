/**
 * SwonBiz ERP 백엔드 — Fastify.
 * ★ 이 저장소에서 DB 에 붙는 유일한 클라이언트다. web 은 이 API 를 통해서만 데이터를 본다.
 *
 * ★★ 이 서버는 **외부에 노출하지 않는다.** /auth/login 응답 본문에 세션 원문(erp_sid)이
 *    들어 있고, 쿠키를 굽는 것은 web(Next.js)이다. 밖에서 직접 부를 수 있으면
 *    세션을 아무나 받아간다. 배포 시 내부망·loopback 에만 바인딩한다.
 */
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import { env } from './env.ts';
import { bbiyongBanner } from './lib/bbiyongBanner.ts';
import { BbiyongReloginRequiredError, BbiyongUnavailableError } from './bbiyong/index.ts';
import { registerSessionHook } from './session/hook.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerAclRoutes } from './routes/acl.ts';
import { registerContractRoutes } from './routes/contracts.ts';
import { registerBillingRoutes } from './routes/billing.ts';
import { registerLookupRoutes } from './routes/lookups.ts';
import { registerBookingRoutes } from './routes/booking.ts';
import { registerKioskRoutes } from './routes/kiosk.ts';
import { registerInquiryRoutes } from './routes/inquiry.ts';
import { registerInquiryAdminRoutes } from './routes/inquiryAdmin.ts';
import { registerCompanyRoutes } from './routes/companies.ts';
import { registerFileRoutes } from './routes/files.ts';
import { registerOcrRoutes } from './routes/ocr.ts';
import { registerFacilityRoutes } from './routes/facility.ts';
import { closePool } from './db/pool.ts';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@swonbiz/shared/domain/contract-files';

// ★★ 어느 삐용에 붙었는지를 **가장 먼저** 찍는다. pino 의 JSON 한 줄에 섞으면 눈에 안 띄어서
//    일부러 평문으로 낸다 — 개발계와 가동계를 눈으로 가르는 것이 목적이다.
//    ★ 계통은 주소에서 추측하지 않는다. `BBIYONG_SYSTEM` 이 선언한 값을 그대로 찍는다.
for (const line of bbiyongBanner({
  mock: env.bbiyongMock,
  baseUrl: env.bbiyongBaseUrl,
  system: env.bbiyongSystem,
})) {
  console.log(line);
}

const app = Fastify({ logger: true });

// ★ 에러 응답 모양을 한 가지로 — { error: <기계용 코드>, message }.
//   Fastify 기본값은 { statusCode, error: 'Bad Request', message } 라 우리 라우트가 내는 모양과
//   달랐고, 5xx 에서는 pg 예외 문구(호스트·역할명)가 그대로 브라우저까지 갔다(리뷰 2026-09-07 H3).
app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
  /*
   * ★★ 삐용 예외를 **여기서 한 번** 번역한다(2026-09-30). 라우트마다 하면 어느 날
   *    한 라우트만 빠지고, 그 화면에서는 토큰 만료가 「서버 오류가 났습니다」로 보인다.
   *
   *   · 재로그인 필요 → 401 session_expired. `withFreshAccess` 가 여기까지 올려보낸다는
   *     것은 재발급을 이미 시도했고 실패했다는 뜻이다. ERP 세션도 그 자리에서 폐기됐다.
   *   · 삐용 장애    → 503. **401 로 내리지 않는다** — 그러면 삐용이 잠깐 흔들릴 때마다
   *     전원이 로그인 화면으로 튕기고, 다시 로그인하면 멀쩡한 세션이 하나 더 생긴다.
   *
   *   ★ 토큰 만료(`BbiyongTokenExpiredError`)는 일부러 여기 없다. 그것이 여기까지
   *     올라온다면 `withFreshAccess` 를 거치지 않고 삐용을 부른 경로가 있다는 뜻이고,
   *     조용히 401 로 덮으면 그 사실이 숨는다. 500 으로 떠서 로그에 남는 쪽이 낫다.
   */
  if (err instanceof BbiyongReloginRequiredError) {
    req.log.warn('삐용 토큰 재발급 실패 — 세션 폐기 후 재로그인 안내');
    return reply.code(401).send({ error: 'session_expired', message: err.message });
  }
  if (err instanceof BbiyongUnavailableError) {
    req.log.error({ err }, '삐용 연결 실패');
    return reply.code(503).send({ error: 'bbiyong_unavailable', message: '인증 서버에 연결할 수 없습니다' });
  }

  const status = err.statusCode ?? 500;
  if (status >= 500) {
    req.log.error({ err }, '처리되지 않은 오류');
    return reply.code(500).send({ error: 'internal_error', message: '서버 오류가 났습니다' });
  }
  const code = err.code === 'FST_ERR_VALIDATION' ? 'invalid_request' : 'bad_request';
  return reply.code(status).send({ error: code, message: err.message });
});
app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
  reply.code(404).send({ error: 'not_found', message: `${req.method} ${req.url} 은 없는 경로입니다` });
});

/**
 * 첨부 업로드가 바이트 본문을 받는 content-type 파서.
 *
 * ★ **여기서 한 번만 등록한다.** Fastify 는 같은 타입을 두 번 등록하면 던지므로
 *   라우트 파일마다 붙일 수 없다. 두 기능이 같은 형식·같은 상한을 쓰는 것도 맞다 —
 *   화면이 고른 파일 하나를 첨부로도, 판독으로도 보내기 때문이다.
 *
 * ★ `bodyLimit` 이 **마지막 방어선이 아니라 첫 번째**다. 이게 없으면 10MB 검사를
 *   하기도 전에 서버가 임의 크기를 메모리에 올린다.
 */
app.addContentTypeParser(
  [...ALLOWED_MIME_TYPES],
  { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES },
  (_req, body, done) => done(null, body),
);

// ★ 순서가 중요하다 — 훅을 먼저 걸어야 이후 등록되는 모든 라우트가 인증을 거친다.
//   라우트를 먼저 등록해도 onRequest 훅은 전역이라 걸리지만, 읽는 사람이 헷갈린다.
registerSessionHook(app);
registerAuthRoutes(app);
registerAclRoutes(app);
registerContractRoutes(app);
registerBillingRoutes(app);
registerLookupRoutes(app);
// ★ 회의실 예약(s030600010). 조회는 입주사도 하고, 종료 처리만 운영사다.
registerBookingRoutes(app);
// ★ 회의실 현황판(s030500060). **인증 없는 라우트**라 따로 둔다 — 세션을 쓰는 코드와
//   같은 파일에 섞이면 `config.public` 을 옆 라우트에 잘못 붙이는 사고가 난다.
registerKioskRoutes(app);
// ★ 문의상담 게시판(s030500070). **인증 없는 라우트**라 현황판과 같은 이유로 따로 둔다 —
//   쓰기가 둘(원글·추가 질문) 있고, 추가 질문은 열람 토큰을 따로 본다.
registerInquiryRoutes(app);
// ★ 문의 관리(s030200080). **운영사 전용**이고 공개 라우트와 **파일이 다르다** —
//   같은 파일에 두면 `config.public` 을 잘못 붙여 개인정보가 로그인 없이 열릴 수 있다.
registerInquiryAdminRoutes(app);
registerCompanyRoutes(app);
// ★ 첨부 서류(CONT-17). 회사 하위 경로라 입주사 라우트 **뒤에** 둔다 — 같은 접두사를
//   쓰는 라우트는 등록 순서와 무관하지만, 읽는 사람이 묶어서 보게 한다.
registerFileRoutes(app);
// ★ 사업자등록증 **판독만** 하는 라우트. 아직 입주사가 없는 신규 폼이 쓴다 —
//   회사가 있으면 첨부 업로드가 판독까지 겸한다(`routes/ocr.ts` 머리말).
registerOcrRoutes(app);
// ★ 센터 관리(s030100010) — 건물·층·호실·회의실. **운영사 전용**이고 네 표에 FK 가 없어
//   「쓰고 있는지」를 핸들러가 직접 센다(`db/facility.ts` 머리말).
registerFacilityRoutes(app);

app.get('/health', { config: { public: true } }, async () => ({
  ok: true,
  service: 'swonbiz-erp-api',
  // ★ `system` 은 「지금 어느 계통에 붙어 있는가」다. 기동 배너를 놓쳤을 때 확인하는 자리다.
  bbiyong: { mock: env.bbiyongMock, aclMode: env.aclMode, system: env.bbiyongSystem },
}));

// 종료 시 커넥션 풀을 닫는다. 안 닫으면 개발 중 재시작이 쌓여 커넥션이 고갈된다.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} — 종료`);
    void app
      .close()
      .then(closePool)
      .then(() => process.exit(0));
  });
}

app.listen({ port: env.port, host: '127.0.0.1' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
