/**
 * SwonBiz ERP 백엔드 — Fastify.
 * ★ 이 저장소에서 DB 에 붙는 유일한 클라이언트다. web 은 이 API 를 통해서만 데이터를 본다.
 *
 * 페이즈 1의 2-2 범위는 "뜨는 것"까지다. 세션 훅·ACL 어댑터·라우트는 2-8 에서 붙인다.
 */
import Fastify from 'fastify';
import { SCREENS, homeRouteFor } from '@swonbiz/shared';

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  ok: true,
  service: 'swonbiz-erp-api',
  // shared 가 실제로 연결돼 있는지 확인용. 화면 목록의 단일 진실 공급원은 shared 쪽이다.
  screens: Object.keys(SCREENS).length,
}));

// 홈 분기 규칙이 web·api 양쪽에서 같은 코드를 쓴다는 것을 보이는 자리.
// 실제 사용은 2-8(세션 미들웨어)에서.
export { homeRouteFor };

const port = Number(process.env.PORT ?? 3001);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
