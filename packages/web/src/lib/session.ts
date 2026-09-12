import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, type ScreenId } from '@swonbiz/shared';
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

/**
 * ★ 화면 목록에 없으면 들여보내지 않는다 — 사이드바에서 감추는 것만으로는 부족하다.
 *
 * `verifyScreen` 은 1단계 shadow 라 **막지 않는다**(기록만 남긴다). 운영사 전용
 * 화면은 그걸로 부족하다: 사이드바에 항목이 없어도 URL 을 직접 치면 열린다.
 * 옆 호실의 계약 조건이 걸린 자리에서 "메뉴에 없으니 안 들어오겠지"는 방어가 아니다.
 *
 * ★ 판정 근거는 **삐용이 준 화면 목록 하나뿐**이다. org_tp 도 member_tp 도 role 도
 *   보지 않는다(회신 2026-09-12 §1·§5).
 *
 * ★★ 이것도 여전히 web 쪽 게이트다. 이 화면에는 아직 데이터 API 가 하나도 없어
 *    새어 나갈 것이 없지만, 3-4 에서 입주사 조회 API 가 붙는 순간 **Fastify 쪽에서
 *    같은 판정을 해야 한다.** 여기서 막았다고 그쪽을 생략하면 API 를 직접 부르는
 *    경로가 그대로 열린다.
 */
export async function requireScreen(screenCode: ScreenId, route: string): Promise<void> {
  const me = await getMe();
  if (!me) redirect('/login');

  // 기록이 먼저다 — 막힌 접근도 shadow 로그에 남아야 누가 어디를 두드렸는지 보인다.
  await verifyScreen(screenCode, route);

  if (!me.screens.includes(screenCode)) redirect('/no-access');
}
