/**
 * 스코프 헬퍼 — 삐용 orgId → ERP companyId 역조회.
 *
 * ★★ 이후 5개 페이즈가 전부 이 값 위에서 돈다. 여기가 틀리면 격리가 전 페이즈에서
 *    동시에 샌다(지시서 3장 "가장 꼼꼼히 볼 곳").
 *
 * 접합점은 `tb_s080_companies.link_s020_org_id` 정수 컬럼 하나다. FK 는 없고
 * UNIQUE 만 걸려 있다 — 삐용 org010 에 사업자등록번호가 없어 자동 매칭이 불가능하고,
 * 연결은 운영자가 손으로 건다(ORG §1-2).
 *
 * ★ 연결이 없으면 `null` 이고 그건 **빈 스코프**다. 예외를 던지지도, 전체를 주지도 않는다.
 */
import { pool } from '../db/pool.ts';

export async function resolveCompanyId(s020OrgId: number): Promise<string | null> {
  // tb_s080_companies 에는 RLS 가 걸려 있지 않다(003 대상 6테이블에 없음) —
  // 스코프를 정하기 전에 부르는 조회이므로 RLS 가 걸려 있으면 자기 자신을 못 찾는다.
  const { rows } = await pool.query<{ company_id: string }>(
    `SELECT company_id FROM public.tb_s080_companies WHERE link_s020_org_id = $1 LIMIT 1`,
    [s020OrgId],
  );
  return rows[0]?.company_id ?? null;
}
