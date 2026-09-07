import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@swonbiz/shared';
import { callApi } from './api';

/**
 * 서버 컴포넌트·route handler 에서 세션을 다루는 자리.
 *
 * ★ ERP 는 세션을 스스로 판정하지 않는다. 쿠키를 꺼내 Fastify 에 물어볼 뿐이다.
 *   web 이 직접 판정하기 시작하면 진실원이 둘이 되고, 둘이 어긋나는 순간
 *   화면은 열리는데 API 는 401 인 상태가 된다.
 */

export async function readSid(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export interface MeResponse {
  screens: string[];
  home: string;
  companyId: string | null;
  role: 'operator' | 'tenant';
  orgTp: string;
  expiresAt: string;
}

/** 세션이 없거나 만료면 null. 호출자가 /login 으로 보낸다. */
export async function getMe(): Promise<MeResponse | null> {
  const sid = await readSid();
  if (!sid) return null;
  const res = await callApi<MeResponse>('/auth/me', { erpSid: sid });
  return res.ok ? res.body : null;
}

/**
 * 화면 접근 검증 — 판정은 Fastify(→ 삐용 어댑터)가 한다.
 *
 * 1단계 shadow 라 항상 통과하고 기록만 남는다. 그래서 **지금은 반환값으로 화면을
 * 막지 않는다** — 막으면 삐용 마스터에 화면이 등록되기 전(회신 ⑮)이라 정상 사용자가
 * 전부 갇힌다. 3단계에서 `enforced: true` 가 오기 시작하면 그때 이 값을 보고 막는다.
 */
export async function verifyScreen(screenCode: string, route: string): Promise<void> {
  const sid = await readSid();
  if (!sid) return;
  await callApi('/acl/verify', {
    method: 'POST',
    erpSid: sid,
    body: { screenCode, action: 'VIEW', route },
  });
}
