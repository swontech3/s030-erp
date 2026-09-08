/**
 * ERP 세션 저장소 — `tb_s080_auth_session` 한 곳이 진실원이다.
 *
 * 브라우저에는 불투명한 `erp_sid` 원문만 내려가고, DB 에는 그 SHA-256 해시만 남는다.
 * 삐용 access·refresh 토큰은 **서버에만** 암호화 보관한다(지시문 1-4).
 *
 * =============================================================================
 * ★★ 캐시 설계 — 30초 캐시를 두되 `revoked_at` 은 캐시를 우회한다
 * =============================================================================
 * 요청마다 캐시하는 것: 정체성(memberId·orgId·orgTp)과 **companyId 역조회 결과**.
 * 요청마다 매번 DB 를 보는 것: `revoked_at` · `expires_at` 두 컬럼뿐.
 *
 * 후자는 PK 단건 조회라 싸고, 이렇게 해야 로그아웃이 **즉시** 먹는다. 세션 전체를
 * 30초 캐시하면 로그아웃한 사용자가 30초 동안 계속 들어온다 — 그 30초가
 * "로그아웃했는데 왜 아직 보이냐"는 사고의 형태다.
 */
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import { pool } from '../db/pool.ts';
import { decrypt, encrypt, hashSessionId, newSessionId } from '../lib/crypto.ts';
import { resolveCompanyId } from '../scope/resolveCompany.ts';
import { env } from '../env.ts';
import { bbiyongAcl, type BbiyongLoginResult } from '../bbiyong/index.ts';

/** 캐시에 담는 것 — 자주 바뀌지 않는 정체성만. 만료·폐기는 여기 넣지 않는다. */
interface CachedIdentity {
  s020MemberId: number;
  s020OrgId: number;
  orgTp: string;
  companyId: string | null;
  role: ScopeRole;
  cachedAt: number;
}

const IDENTITY_TTL_MS = 30_000;
const identityCache = new Map<string, CachedIdentity>();
/** 이 크기를 넘으면 만료된 항목을 한 번 훑어 버린다. 안 하면 방치된 세션만큼 메모리가 자란다. */
const IDENTITY_SWEEP_AT = 1_000;

function sweepExpired(now: number): void {
  if (identityCache.size < IDENTITY_SWEEP_AT) return;
  for (const [key, v] of identityCache) {
    if (now - v.cachedAt > IDENTITY_TTL_MS) identityCache.delete(key);
  }
}

/** 로그아웃·강제만료 시 즉시 버린다. 캐시가 남아 있으면 companyId 가 되살아난다. */
export function dropCached(erpSidHash: string): void {
  identityCache.delete(erpSidHash);
}

export interface CreatedSession {
  /** 브라우저 쿠키에 담을 **원문**. 이 값은 여기서만 존재하고 저장되지 않는다. */
  rawSid: string;
  session: ErpSession;
}

export async function createSession(login: BbiyongLoginResult): Promise<CreatedSession> {
  const rawSid = newSessionId();
  const erpSid = hashSessionId(rawSid);
  const companyId = await resolveCompanyId(login.orgId);
  // ★ 스코프 역할은 어댑터(getScope)가 정한다 — 여기서 org_tp 를 직접 보지 않는다.
  //   판정 자리가 둘이 되면 어느 날 하나만 고쳐진다.
  const { role } = bbiyongAcl.getScope(
    { s020MemberId: login.memberId, s020OrgId: login.orgId, orgTp: login.orgTp },
    companyId,
  );
  const expiresAt = new Date(Date.now() + env.sessionTtlMs);

  await pool.query(
    `INSERT INTO public.tb_s080_auth_session
       (erp_sid, bbiyong_member_id, org_tp, org_id,
        bbiyong_access_encrypted, bbiyong_refresh_encrypted, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      erpSid,
      login.memberId,
      login.orgTp,
      login.orgId,
      encrypt(login.accessToken),
      encrypt(login.refreshToken),
      expiresAt,
    ],
  );

  return {
    rawSid,
    session: {
      erpSid,
      s020MemberId: login.memberId,
      s020OrgId: login.orgId,
      orgTp: login.orgTp,
      companyId,
      role,
      expiresAt,
      lastActiveAt: null,
    },
  };
}

/**
 * 쿠키 원문 → 세션. 없거나 만료·폐기면 null.
 * 401 을 던지는 것은 호출자(hook)의 몫이다 — 여기서는 상태만 판정한다.
 */
export async function lookupSession(rawSid: string): Promise<ErpSession | null> {
  const erpSid = hashSessionId(rawSid);

  // ① 살아 있는지 — **항상 DB 를 본다.** 캐시 우회.
  const { rows } = await pool.query<{
    bbiyong_member_id: number;
    org_tp: string;
    org_id: number;
    expires_at: Date;
    last_active_at: Date | null;
    revoked_at: Date | null;
  }>(
    `SELECT bbiyong_member_id, org_tp, org_id, expires_at, last_active_at, revoked_at
       FROM public.tb_s080_auth_session
      WHERE erp_sid = $1`,
    [erpSid],
  );

  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at !== null || row.expires_at.getTime() <= Date.now()) {
    dropCached(erpSid);
    return null;
  }

  // ② 정체성 — 30초 캐시. companyId 역조회(조인)를 매 요청 반복하지 않기 위한 것이다.
  let cached = identityCache.get(erpSid);
  if (!cached || Date.now() - cached.cachedAt > IDENTITY_TTL_MS) {
    const companyId = await resolveCompanyId(row.org_id);
    const { role } = bbiyongAcl.getScope(
      { s020MemberId: row.bbiyong_member_id, s020OrgId: row.org_id, orgTp: row.org_tp },
      companyId,
    );
    const now = Date.now();
    sweepExpired(now);
    cached = {
      s020MemberId: row.bbiyong_member_id,
      s020OrgId: row.org_id,
      orgTp: row.org_tp,
      companyId,
      role,
      cachedAt: now,
    };
    identityCache.set(erpSid, cached);
    // 마지막 활동 시각도 이때만 갱신한다 — 요청마다 UPDATE 하면 세션 테이블이 쓰기로 뜨겁다.
    void pool
      .query(`UPDATE public.tb_s080_auth_session SET last_active_at = now() WHERE erp_sid = $1`, [erpSid])
      .catch((err: Error) => console.error('[session] last_active_at 갱신 실패:', err.message));
  }

  return {
    erpSid,
    s020MemberId: cached.s020MemberId,
    s020OrgId: cached.s020OrgId,
    orgTp: cached.orgTp,
    companyId: cached.companyId,
    role: cached.role,
    expiresAt: row.expires_at,
    lastActiveAt: row.last_active_at,
  };
}

/** 세션 폐기. 이미 폐기된 세션을 다시 폐기해도 오류가 아니다(로그아웃은 멱등해야 한다). */
export async function revokeSession(rawSid: string): Promise<void> {
  const erpSid = hashSessionId(rawSid);
  await pool.query(
    `UPDATE public.tb_s080_auth_session SET revoked_at = now() WHERE erp_sid = $1 AND revoked_at IS NULL`,
    [erpSid],
  );
  dropCached(erpSid);
}

/** 로그아웃 시 삐용 세션도 끊기 위해 복호화한 refresh 토큰이 필요하다. */
export async function readRefreshToken(rawSid: string): Promise<string | null> {
  const { rows } = await pool.query<{ bbiyong_refresh_encrypted: string }>(
    `SELECT bbiyong_refresh_encrypted FROM public.tb_s080_auth_session WHERE erp_sid = $1`,
    [hashSessionId(rawSid)],
  );
  const enc = rows[0]?.bbiyong_refresh_encrypted;
  if (!enc) return null;
  try {
    return decrypt(enc);
  } catch (err) {
    // 복호화 실패(키 회전 등)로 로그아웃을 막지 않는다 — ERP 세션은 어차피 끊는다.
    console.error('[session] refresh 토큰 복호화 실패:', (err as Error).message);
    return null;
  }
}
