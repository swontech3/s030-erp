import { defineConfig } from 'vitest/config';

/**
 * 테스트 환경변수 — **테스트는 `packages/api/.env` 에 기대지 않는다.**
 *
 * `MockBbiyongAcl` 을 import 하면 `shadowLog` → `pool` → `env.ts` 가 딸려온다. `env.ts` 는
 * 변수가 없으면 그 자리에서 기동을 막는데(그게 env.ts 가 하는 일이다), 그 때문에 `.env` 가
 * 없는 기계에서는 테스트가 **import 단계에서** 죽는다. 여기서 가짜 값을 박아 그걸 막는다.
 *
 * ★ `process.loadEnvFile` 은 **이미 설정된 process.env 를 덮어쓰지 않는다.** 그래서 `.env` 가
 *   있는 개발 기계에서도 아래 값이 이긴다 — 테스트가 실수로 진짜 DB·삐용에 붙지 않는다.
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
    },
  },
});
