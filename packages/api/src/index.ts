/**
 * SwonBiz ERP 백엔드 — Fastify.
 * ★ 이 저장소에서 DB 에 붙는 유일한 클라이언트다. web 은 이 API 를 통해서만 데이터를 본다.
 *
 * ★★ 이 서버는 **외부에 노출하지 않는다.** /auth/login 응답 본문에 세션 원문(erp_sid)이
 *    들어 있고, 쿠키를 굽는 것은 web(Next.js)이다. 밖에서 직접 부를 수 있으면
 *    세션을 아무나 받아간다. 배포 시 내부망·loopback 에만 바인딩한다.
 */
import Fastify from 'fastify';
import { env } from './env.ts';
import { registerSessionHook } from './session/hook.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerAclRoutes } from './routes/acl.ts';
import { closePool } from './db/pool.ts';

const app = Fastify({ logger: true });

// ★ 순서가 중요하다 — 훅을 먼저 걸어야 이후 등록되는 모든 라우트가 인증을 거친다.
//   라우트를 먼저 등록해도 onRequest 훅은 전역이라 걸리지만, 읽는 사람이 헷갈린다.
registerSessionHook(app);
registerAuthRoutes(app);
registerAclRoutes(app);

app.get('/health', async () => ({
  ok: true,
  service: 'swonbiz-erp-api',
  bbiyong: { mock: env.bbiyongMock, aclMode: env.aclMode },
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
