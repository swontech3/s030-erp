/**
 * 기동 배너 — **지금 어느 삐용에 붙어 있는가**를 기동 로그 맨 위에 찍는다.
 *
 * ★★ 8080(가동계)과 8082(개발계)는 숫자 하나 차이다. 삐용 저장소가 DB 포트를 두고
 *    "54xxx=개발 / 55xxx=가동, 절대 섞지 말 것"이라고 못박은 것과 같은 위험이고,
 *    잘못 붙었을 때 나가는 것이 **운영 계정의 실제 로그인 요청**이라 더 나쁘다.
 *
 * 기동을 막지는 않는다 — 언젠가 실제로 가동계에 붙여야 할 때가 온다. 대신 그때
 * "몰랐다"는 말이 안 나오게 한다.
 */

/**
 * 포트로 계통을 가른다. **여기 없는 포트는 개발계로 추정하지 않는다** —
 * 모르면 모른다고 찍는 쪽이 안전하다.
 */
const SYSTEM_BY_PORT: Record<string, 'dev' | 'prod'> = {
  '8082': 'dev',
  '8080': 'prod',
};

export interface BbiyongTarget {
  mock: boolean;
  baseUrl: string | null;
}

/** 기동 시 그대로 출력할 줄들. 순수 함수라 시험할 수 있다. */
export function bbiyongBanner({ mock, baseUrl }: BbiyongTarget): string[] {
  if (mock || !baseUrl) {
    return ['[BBIYONG] MOCK — 삐용에 붙지 않습니다 (packages/api/.env 의 BBIYONG_MOCK=true)'];
  }

  let port = '';
  try {
    port = new URL(baseUrl).port;
  } catch {
    // 깨진 URL 이어도 배너가 기동을 죽이지 않는다. 계통 미상으로 떨어진다.
  }
  const system = SYSTEM_BY_PORT[port];

  if (system === 'dev') return [`[BBIYONG] ${baseUrl}  (개발계)`];

  if (system === 'prod') {
    const bar = '='.repeat(74);
    return [
      bar,
      `  ★★  [BBIYONG] ${baseUrl}  — 가동계(운영) ★★`,
      '',
      '      여기로 나가는 것은 운영 계정의 실제 로그인 요청입니다.',
      '      개발계는 8082 입니다. 의도한 것이 아니면 지금 멈추십시오.',
      bar,
    ];
  }

  return [`[BBIYONG] ${baseUrl}  (계통 미상 — 8082=개발계 · 8080=가동계)`];
}
