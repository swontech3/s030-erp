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
import { startSessionPurge } from './session/purgeTimer.ts';
import { sweepPendingLinks } from './companies/retrySweep.ts';
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
import { registerCodeRoutes } from './routes/codes.ts';
import { registerFormTemplateRoutes } from './routes/formTemplates.ts';
import { registerOrgLookupRoutes } from './routes/orgLookup.ts';
import { registerCorpChangeRoutes } from './routes/corpChanges.ts';
import { registerBizPurposeRoutes } from './routes/bizPurposes.ts';
import { registerIncorporationRoutes } from './routes/incorporations.ts';
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
// ★ 코드 관리(s030100030) — 머리·파티션·값 3층. **운영사 전용**이고, 업무 표에서 코드표로
//   오는 FK 가 0건이라 「쓰고 있는지」를 선언표(`domain/code-usage.ts`)로 센다.
// ★★ 소비용 조회는 `registerLookupRoutes` 의 `GET /codes` 다 — 경로가 겹치지 않게 이쪽은
//    `/codes-admin/**` 를 쓴다. 같은 접두사를 쓰면 `/codes/:category` 가 `/codes` 를 가린다.
registerCodeRoutes(app);
// ★ 표양식 관리(s030100020) — 양식 등록·수정·삭제. **운영사 전용**. 등기 설정이 가리키는
//   양식은 FK 가 없어 핸들러가 세어서 막는다(`db/formTemplates.ts` 머리말).
registerFormTemplateRoutes(app);
// ★ 공용 회사 조회(삐용 단체) — 법무 서비스(S04)가 처음 쓰는 팝업의 서버 쪽. **운영사 전용**.
//   화면이 아니라 부품이라 화면 코드가 없다(`routes/orgLookup.ts` 머리말).
registerOrgLookupRoutes(app);
// ★ 법인변경(s040200010) — 운영사 · 회사가 함께 쓴다. 누가 무엇을 보는지는 RLS(037)가
//   단체 ID 로 가른다(`routes/corpChanges.ts` 머리말). 목록(2단계) · 새 건 · 상세 · 임원(3단계).
registerCorpChangeRoutes(app);
// ★ 사업목적 카탈로그(s040300010, 041) — 목록은 로그인한 모든 사용자(법인변경 상세의 고르기 팝업이
//   부른다), 추가 · 고치기는 운영사만. 지우기는 없다(`routes/bizPurposes.ts` 머리말).
registerBizPurposeRoutes(app);
// ★ 법인설립(s040100010 · s040100020, 042) — 법인변경과 같은 모양 · 같은 전이 규칙. 운영사 · 회사가 함께 쓰고
//   RLS 가 단체 ID 로 가른다. ERP 회사표에 쓰지 않는다(`routes/incorporations.ts` 머리말).
registerIncorporationRoutes(app);

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

// ★ 죽은 세션 치우기 — 하루 한 번, 서버가 스스로 돈다(`session/purgeTimer.ts`).
//   사람이 기억해야 도는 길로 두면 지금처럼 쌓인다(2026-10-04 에 441행).
startSessionPurge(app.log);

/*
 * ══════════════════════════════════════════════════════════════════════════
 * ★★ 삐용 연동 실패를 저절로 다시 보낸다 — **응답 뒤에, 운영자 요청에 묻어서**
 * ══════════════════════════════════════════════════════════════════════════
 * 세션 정리처럼 타이머로 두고 싶지만 **삐용을 부를 토큰이 서버에 없다**(결정 Q1 —
 * 서버끼리 쓰는 API 키는 만들지 않는다). 그래서 운영자의 토큰에 묻어서 돈다.
 * 한계와 그 선택의 근거는 `companies/retrySweep.ts` 머리말에 적어 뒀다.
 *
 * ★ `onResponse` 다 — 응답을 **보낸 뒤**에 돌아 사람을 기다리게 하지 않는다.
 * ★ 운영사만. 입주사 요청에 묻히면 그 사람 토큰으로 남의 회사를 삐용에 등록하게 된다.
 * ★ 쿨다운 60초·한 번에 3건은 스윕 쪽에 있다. 여기서는 부르기만 한다.
 */
app.addHook('onResponse', async (req) => {
  const session = req.session;
  if (!session || session.role !== 'operator') return;
  sweepPendingLinks(session, app.log);
});

app.listen({ port: env.port, host: '127.0.0.1' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
