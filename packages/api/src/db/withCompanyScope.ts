/**
 * withCompanyScope — RLS 세션 컨텍스트를 세팅하는 트랜잭션 래퍼.
 *
 * `003_revoke_public.sql` 이 만든 것은 DB 쪽 절반뿐이다. 정책은
 * `current_setting('app.current_company_id')` 를 읽어 판정하므로, 그 값을 넣어주는
 * 애플리케이션 쪽 절반이 이 파일이다. 이 래퍼를 거치지 않은 쿼리는 GUC 가 없어
 * **0건을 본다**(fail-closed). 그게 정상이고, 그래서 이 래퍼가 유일한 통로여야 한다.
 *
 * =============================================================================
 * ★★ 왜 set_config 인가 — SET LOCAL 은 쓸 수 없다
 * =============================================================================
 * 1) `SET LOCAL app.current_role = 'tenant'` 는 **파서가 거부한다.**
 *      ERROR: syntax error at or near "current_role"
 *    `current_role` 이 SQL 예약어다. 이름을 바꾸지 않는 한 SET 문법으로는 못 넣는다.
 *
 * 2) `SET` 은 `$1` 바인딩을 받지 못한다. 그래서 SET 을 고집하면 값을 문자열로
 *    이어 붙이게 되고, 그 자리가 곧 SQL 인젝션 지점이 된다. 회사 식별자가 들어가는
 *    자리라 최악의 위치다.
 *
 * `set_config(name, value, is_local)` 이 둘 다 해결한다. 값은 파라미터로 넘어가고
 * 이름은 문자열 리터럴이라 예약어 문제가 없다.
 *
 * =============================================================================
 * ★★★ 세 번째 인자는 반드시 true
 * =============================================================================
 * `true`  = 트랜잭션 범위. COMMIT/ROLLBACK 과 함께 사라진다. (SET LOCAL 과 동일)
 * `false` = 세션 범위. **커넥션에 값이 남는다.**
 *
 * 커넥션 풀에서 `false` 를 쓰면 이 요청의 `company_id` 가 커넥션에 남고, 그 커넥션을
 * 물려받은 **다음 요청(다른 회사)** 이 남의 데이터를 보게 된다. 로그에도 안 남고
 * 테스트로도 잘 안 잡힌다 — 부하가 있어야 재현되기 때문이다.
 * 이 시스템에서 가장 위험한 버그 형태다. `true` 외의 값을 쓰지 않는다.
 */
import { pool } from './pool.ts';

/** 이 래퍼 안에서 쓸 수 있는 최소한의 클라이언트. pg.PoolClient 가 이 모양이다. */
export interface ScopedClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

export interface CompanyScope {
  /** 'operator' 는 전체, 'tenant' 는 자기 company_id 만 본다. */
  role: 'operator' | 'tenant';
  /**
   * 입주사 식별자. 삐용 조직 연결이 없으면 null 이고, 그건 **빈 스코프**다 —
   * 예외가 아니라 0건이다(ORG_ARCHITECTURE.md §1-2).
   */
  companyId: string | null;
}

/**
 * 현재 트랜잭션에 RLS 판정용 GUC 를 세팅한다.
 * ★ 반드시 BEGIN 이후에 호출한다. 트랜잭션 밖에서 부르면 is_local=true 가 즉시 소멸한다.
 */
export async function applyCompanyScope(client: ScopedClient, scope: CompanyScope): Promise<void> {
  await client.query(`SELECT set_config('app.current_role', $1, true)`, [scope.role]);

  // operator 는 회사 스코프를 쓰지 않는다. tenant 는 null 이어도 빈 문자열로 넣어
  // 정책이 NULL 취급(= 아무것도 안 보임)하게 둔다 — erp_current_company_id() 가
  // nullif(..., '') 로 감싸고 있다.
  if (scope.role !== 'operator') {
    await client.query(`SELECT set_config('app.current_company_id', $1, true)`, [scope.companyId ?? '']);
  }
}

/**
 * 트랜잭션을 열고 스코프를 건 뒤 콜백을 실행한다. **DB 접근은 전부 이 함수를 거친다.**
 *
 * ★ 콜백이 던지면 ROLLBACK 하고 예외를 그대로 올린다. 커넥션은 어느 경로로 끝나든
 *   반드시 반납한다 — 반납을 빠뜨리면 풀이 말라 서버 전체가 멎는다.
 */
export async function withCompanyScope<T>(
  scope: CompanyScope,
  fn: (client: ScopedClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyCompanyScope(client, scope);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // ROLLBACK 자체가 실패할 수 있다(커넥션이 이미 죽은 경우). 원래 예외를 덮지 않는다.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* 무시 — 아래에서 원래 예외를 던진다 */
    }
    throw err;
  } finally {
    client.release();
  }
}
