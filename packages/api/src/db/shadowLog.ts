/**
 * ACL shadow 로그 기록 (ACL-08).
 *
 * ★ ALLOW 는 기록하지 않는다 — 전량 기록하면 로그가 데이터보다 커진다.
 *   DENY(화면 목록에 없음)와 비정상 상태만 남긴다(ORG §4-5).
 *
 * ★ 기록 실패가 요청을 깨뜨리지 않는다. 이건 감사 로그이지 판정 경로가 아니다.
 *   로그 테이블이 잠기거나 사라졌다고 로그인이 막히면 그게 더 큰 사고다.
 */
import { pool } from './pool.ts';

export type ShadowVerdict = 'DENY' | 'ALLOW_STALE' | 'NO_GRANT_LIST';

export interface ShadowLogEntry {
  s020MemberId: number | null;
  s020OrgId: number | null;
  screenCode: string | null;
  action: string | null;
  verdict: ShadowVerdict;
  route?: string | null;
  httpMethod?: string | null;
  /** 이 시점에 실제로 막았는가. 1단계 shadow 에서는 항상 false. */
  enforced: boolean;
}

export async function writeShadowLog(entry: ShadowLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.tb_s080_acl_shadow_log
         (s020_member_id, s020_org_id, screen_code, action, verdict, route, http_method, enforced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.s020MemberId,
        entry.s020OrgId,
        entry.screenCode,
        entry.action,
        entry.verdict,
        entry.route ?? null,
        entry.httpMethod ?? null,
        entry.enforced,
      ],
    );
  } catch (err) {
    console.error('[acl] shadow 로그 기록 실패:', (err as Error).message);
  }
}
