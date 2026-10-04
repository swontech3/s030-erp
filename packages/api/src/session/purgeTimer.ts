/**
 * 세션 정리를 **서버가 스스로 돌린다** — 하루 한 번.
 *
 * =============================================================================
 * ★★ 왜 로그인 경로가 아니라 타이머인가
 * =============================================================================
 * 「로그인할 때 묻어서 돌린다」도 생각했다. 그러면 로그인이라는 **사람을 기다리게
 * 하는 경로**에 지우기가 붙고, 하루치를 지우자고 하루 수십 번 조건을 본다.
 * 치우는 일은 아무도 안 기다리는 일이므로 아무도 안 기다리는 자리에 둔다.
 *
 * ★ `unref()` 한다. 이 타이머 때문에 프로세스가 안 죽으면 **종료가 24시간 걸린다.**
 *
 * ★ 실패가 서버를 죽이지 않는다. 세션 몇 행이 안 지워진 것은 서비스가 멈출 일이
 *   아니다 — 로그만 남기고 다음 차례에 다시 시도한다.
 *
 * ★ 뜨자마자 한 번 돈다. 하루에 한 번만이라면 **서버를 매일 재시작하는 개발 중에는
 *   영영 안 도는** 수가 있다. 지울 것이 없으면 0행 DELETE 라 값이 거의 들지 않는다.
 *
 * ★★ 로그아웃은 이 타이머를 기다리지 않는다 — 그 자리에서 행을 지운다
 *    (`store.ts` `revokeSessionByHash`). 타이머가 치우는 것은 **아무도 로그아웃하지
 *    않고 그냥 만료된 세션**이고, 실제로 쌓이는 것의 대부분이 그쪽이다.
 */
import type { FastifyBaseLogger } from 'fastify';
import { purgeDeadSessions } from './purge.ts';

const EVERY_MS = 24 * 60 * 60 * 1000;

/** 멈추는 함수를 돌려준다 — 시험이 타이머를 남기지 않게 하려면 필요하다. */
export function startSessionPurge(log: FastifyBaseLogger): () => void {
  const run = () => {
    void purgeDeadSessions()
      .then((deleted) => {
        // ★ 0행일 때는 조용히 지나간다. 매일 「0건 지웠다」가 쌓이면 로그가 무뎌진다.
        if (deleted > 0) log.info(`[session] 끝난 세션 ${deleted}건 정리`);
      })
      .catch((err: Error) => log.error({ err }, '[session] 정리 실패 — 다음 차례에 다시 한다'));
  };

  run();
  const timer = setInterval(run, EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
