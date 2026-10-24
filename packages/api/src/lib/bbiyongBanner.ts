/**
 * 기동 배너 — **지금 어느 삐용에 붙어 있는가**를 기동 로그 맨 위에 찍는다.
 *
 * ★★ 잘못된 계통에 붙었을 때 나가는 것은 **운영 계정의 실제 로그인 요청**이다.
 *    삐용 저장소가 DB 포트를 두고 "54xxx=개발 / 55xxx=가동, 절대 섞지 말 것"이라고
 *    못박은 것과 같은 위험이고, 이쪽이 더 나쁘다.
 *
 * ★★★ **계통을 주소에서 추측하지 않는다** (2026-09-30 변경). 예전에는 포트로 갈랐다
 *      — 8082=개발계 · 8080=가동계. 그 규칙이 깨졌다: 삐용 개발계는
 *      `192.168.0.22:8082`, 가동계는 `192.168.0.14:8082` 로 **포트가 같고 호스트가**
 *      **다르다.** 호스트로 갈라도 같은 사고가 반복된다 — 가동계가 도메인·HTTPS 로
 *      바뀌는 순간 또 틀린다. 그래서 계통은 `BBIYONG_SYSTEM` 으로 **사람이 선언하고**,
 *      이 파일은 받은 값을 찍기만 한다. 주소를 코드에 박지 않는 것과 같은 이유다.
 *
 * 기동을 막지는 않는다 — 언젠가 실제로 가동계에 붙여야 할 때가 온다. 대신 그때
 * "몰랐다"는 말이 안 나오게 한다. (가동계인데 HTTPS 가 아니면 **기동은 `env.ts` 가**
 * **막는다** — 삐용 회신 ①.)
 */

/** `BBIYONG_SYSTEM` 의 어휘. `env.ts` 가 검증해서 넘긴다. */
export type BbiyongSystem = 'dev' | 'prod';

/** 계통을 사람이 읽는 말로. `unknown` 은 「모른다」이고 개발계로 추정하지 않는다. */
const SYSTEM_LABEL: Record<'dev' | 'prod' | 'unknown', string> = {
  dev: '  (개발계)',
  prod: '  (가동계 ★)',
  unknown: '  (계통 미상 — BBIYONG_SYSTEM 이 비어 있습니다)',
};

export interface BbiyongTarget {
  mock: boolean;
  baseUrl: string | null;
  /** 계통. MOCK 이면 주소가 없으므로 `null` 이다. */
  system: BbiyongSystem | null;
}

/** 기동 시 그대로 출력할 줄들. 순수 함수라 시험할 수 있다. */
export function bbiyongBanner({ mock, baseUrl, system }: BbiyongTarget): string[] {
  if (mock || !baseUrl) {
    // ★ MOCK 이어도 **어디를 향해 설정돼 있는지**는 같이 찍는다. MOCK 을 끄는 순간
    //   나가게 될 주소이고, 그것이 개발계인지 가동계인지는 끄기 **전에** 보여야 한다.
    const target = baseUrl ? ` · 실연동 시 붙을 곳: ${baseUrl}${SYSTEM_LABEL[system ?? 'unknown']}` : '';
    return [`[BBIYONG] MOCK — 삐용에 붙지 않습니다 (erp-api.env 의 BBIYONG_MOCK=true)${target}`];
  }

  if (system === 'dev') return [`[BBIYONG] ${baseUrl}${SYSTEM_LABEL.dev}`];

  if (system === 'prod') {
    const bar = '='.repeat(74);
    return [
      bar,
      `  ★★  [BBIYONG] ${baseUrl}  — 가동계(운영) ★★`,
      '',
      '      여기로 나가는 것은 운영 계정의 실제 로그인 요청입니다.',
      '      개발계로 되돌리려면 common.env 의 BBIYONG_SYSTEM 과',
      '      BBIYONG_BASE_URL 을 **함께** 되돌립니다(둘은 한 쌍입니다).',
      '      의도한 것이 아니면 지금 멈추십시오.',
      bar,
    ];
  }

  // ★ `env.ts` 가 「주소는 있는데 계통이 없다」를 기동 단계에서 막으므로 실제로는 오지
  //   않는다. 순수 함수로서의 출구는 남겨 둔다 — 추측해서 '개발계'라고 찍는 것보다
  //   모른다고 찍는 쪽이 안전하다.
  return [`[BBIYONG] ${baseUrl}${SYSTEM_LABEL.unknown}`];
}
