/**
 * pg 커넥션 풀 — **이 저장소에서 DB 에 붙는 유일한 자리다.**
 *
 * 접속 역할은 `erp_app`(BYPASSRLS 없음). 003 이 만든 RLS 정책이 실제로 걸리려면
 * 이 역할이어야 한다 — `service_role` 이나 `postgres` 로 붙으면 정책이 전부 우회된다.
 *
 * ★ 스코프가 필요한 쿼리는 `withCompanyScope()` 를 통해서만 실행한다. 이 풀에서
 *   직접 꺼낸 커넥션은 GUC 가 없어 RLS 대상 테이블에서 **0건을 본다**(fail-closed).
 *   그게 정상 동작이다. 세션 테이블처럼 RLS 가 없는 테이블만 직접 쓴다.
 */
import pg from 'pg';
import { env } from '../env.ts';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // ★ 상한 없는 쿼리가 풀(10개)을 하나씩 물고 늘어지면 서버 전체가 멎는다(리뷰 2026-09-07 M2).
  //   세션 조회·스코프 쿼리는 전부 PK/인덱스 단건이라 5초면 이미 비정상이다.
  statement_timeout: 5_000,
  query_timeout: 5_000,
});

pool.on('error', (err) => {
  // 유휴 커넥션이 서버 쪽에서 끊긴 경우. 풀이 알아서 새로 만든다 — 프로세스를 죽이지 않는다.
  console.error('[db] 유휴 커넥션 오류:', err.message);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
