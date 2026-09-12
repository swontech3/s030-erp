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
  /** ★ 헤더 표시 전용. 사이드바·접근 판정에 쓰지 않는다(지시문 1-6). */
  display: { memberName: string; orgName: string; orgTp: string } | null;
  companyId: string | null;
  role: 'operator' | 'tenant';
  expiresAt: string;
}

/**
 * 세션이 없거나 만료(401)면 null — 호출자가 /login 으로 보낸다.
 *
 * ★ 401 **만** null 이다(리뷰 2026-09-07). Fastify 가 5xx 를 내거나 아예 안 붙으면 던진다 —
 *   그걸 null 로 뭉개면 DB 가 잠깐 흔들릴 때마다 전원이 로그인 화면으로 튕기고,
 *   다시 로그인하면 멀쩡한 세션이 하나 더 생긴다. 장애는 (erp)/error.tsx 가 장애로 보여준다.
 */
export async function getMe(): Promise<MeResponse | null> {
  const sid = await readSid();
  if (!sid) return null;
  const res = await callApi<MeResponse & { message?: string }>('/auth/me', { erpSid: sid });
  if (res.ok) return res.body;
  if (res.status === 401) return null;
  throw new Error(`세션 조회 실패(${res.status}): ${res.body?.message ?? ''}`);
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
  try {
    await callApi('/acl/verify', {
      method: 'POST',
      erpSid: sid,
      body: { screenCode, action: 'VIEW', route },
    });
  } catch (err) {
    // 기록 실패가 화면을 깨뜨리지 않는다 — api 쪽 writeShadowLog 와 같은 원칙을 이 홉에도 적용한다.
    console.error('[acl] verify 호출 실패(기록만 누락):', (err as Error).message);
  }
}
