import { defineConfig } from 'vitest/config';

/**
 * 테스트 환경변수 — **테스트는 환경 파일을 읽지 않는다**(결정 2026-10-24 ⑥).
 *
 * `MockBbiyongAcl` 을 import 하면 `shadowLog` → `pool` → `env.ts` 가 딸려온다. `env.ts` 는
 * 변수가 없으면 그 자리에서 기동을 막는데(그게 env.ts 가 하는 일이다), 그 때문에 테스트가
 * **import 단계에서** 죽는다. 여기서 가짜 값을 박아 그걸 막는다.
 *
 * ★ `env.ts` 는 `VITEST` 가 있으면 common.env · erp-api.env 를 읽지 않는다. 그래서 env.ts 가
 *   `required()` 로 요구하는 칸은 **전부 여기 있어야 한다** — 하나라도 빠지면 import 에서 죽는다.
 *   테스트가 실수로 진짜 DB·삐용·스토리지에 붙지 않는다.
 *
 * ★ DATABASE_URL 은 **일부러 못 붙는 주소**다. 지금 테스트는 순수 함수(getScope·parseSignIn)만
 *   보므로 DB 에 닿을 일이 없고, 닿는 순간 조용히 통과하는 대신 실패하는 편이 낫다.
 */
export default defineConfig({
  test: {
    env: {
      ERP_DATABASE_URL: 'postgres://vitest:vitest@127.0.0.1:1/vitest-should-not-connect',
      // 32바이트 base64 — 값 자체는 의미 없고 길이 검사만 통과하면 된다.
      ERP_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      BBIYONG_MOCK: 'true',
      BBIYONG_ACL_MODE: 'mock',
      /**
       * ★ **일부러 없는 경로**다. 이 값이 진짜 키를 가리키면 테스트가 Google Vision 을
       *   실제로 부른다 — 과금되고, 네트워크에 따라 결과가 흔들린다. DATABASE_URL 을
       *   못 붙는 주소로 둔 것과 같은 이유다.
       */
      GOOGLE_APPLICATION_CREDENTIALS: 'secrets/vitest-should-not-call-vision.json',
      // 스토리지도 일부러 못 붙는 주소. 키는 env.ts 의 role 검사만 통과하는 가짜 JWT
      // (payload = {"role":"service_role"}, 서명 없음).
      SUPABASE_URL: 'http://127.0.0.1:1/vitest-should-not-connect',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.vitest',
      // 국세청 키 — ntsStatus.test 는 「키가 있을 때」를 본다. 요청은 시험이 가짜 post 로
      // 갈아 끼우므로 이 값으로 국세청을 부르는 일은 없다.
      DATA_GO_KR_KEY: 'vitest-fake-nts-key',
    },
  },
});
