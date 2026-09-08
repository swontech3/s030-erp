/**
 * 환경변수 — **읽는 자리를 한 곳으로 모은다.**
 *
 * 기동 시 한 번 검증하고, 틀렸으면 그 자리에서 죽는다. 지시서 2-8:
 * "`BBIYONG_ACL_MODE=http` 인데 삐용 URL 미설정이면 **기동 실패**.
 *  조용히 mock 으로 폴백하지 않는다."
 * 폴백하면 운영에 mock 권한이 올라가고, 그때는 전원이 모든 화면을 보게 된다.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// packages/api/.env — 저장소 루트의 .env(스크립트용 postgres 접속)와 다른 파일이다.
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 없다. packages/api/.env 를 확인할 것.`);
  return v;
}

// ★ 기본값을 두지 않는다(리뷰 2026-09-07). 변수를 빠뜨린 배포가 조용히 mock ACL(전 화면 허용)로
//   뜨는 것이 이 파일이 막으려는 바로 그 사고다. 없으면 기동 실패.
const aclMode = required('BBIYONG_ACL_MODE') as 'mock' | 'http';
if (aclMode !== 'mock' && aclMode !== 'http') {
  throw new Error(`BBIYONG_ACL_MODE 는 'mock' 또는 'http' 여야 한다: ${aclMode}`);
}
if (aclMode === 'http' && !process.env.BBIYONG_BASE_URL) {
  throw new Error(
    'BBIYONG_ACL_MODE=http 인데 BBIYONG_BASE_URL 이 없다. mock 으로 폴백하지 않고 기동을 중단한다 — ' +
      '폴백하면 운영에 mock 권한(전 화면 허용)이 올라간다.',
  );
}

// ★ 삐용 실연동(BBIYONG_MOCK=false)인데 URL 이 없으면 기동을 막는다(회신 ⑦ 반영, 2026-09-08).
//   ACL 과 같은 이유다 — 없는 주소로 로그인을 시도하면 전원이 "서버 오류"로 막히고,
//   그 원인을 찾는 자리는 로그인 화면이 아니라 여기여야 한다.
const bbiyongMock = process.env.BBIYONG_MOCK === 'true';
const bbiyongBaseUrl = process.env.BBIYONG_BASE_URL;
if (!bbiyongMock && !bbiyongBaseUrl) {
  throw new Error('BBIYONG_MOCK=false 인데 BBIYONG_BASE_URL 이 없다. 삐용 로그인 API 주소를 설정할 것.');
}

// ★ 운영에서 mock 은 기동 자체를 막는다(리뷰 2026-09-07 M3). 환경변수 하나 빠진 배포가
//   "전 화면 허용 + 고정 비밀번호" 로 뜨는 것이 이 파일이 막아야 할 가장 큰 사고다.
if (process.env.NODE_ENV === 'production' && (aclMode === 'mock' || process.env.BBIYONG_MOCK === 'true')) {
  throw new Error('NODE_ENV=production 에서 BBIYONG_MOCK=true 또는 BBIYONG_ACL_MODE=mock 은 허용하지 않는다.');
}

const key = Buffer.from(required('ERP_ENCRYPTION_KEY'), 'base64');
if (key.length !== 32) {
  throw new Error(`ERP_ENCRYPTION_KEY 는 base64 로 32바이트여야 한다(현재 ${key.length}바이트).`);
}

export const env = {
  databaseUrl: required('ERP_DATABASE_URL'),
  encryptionKey: key,
  bbiyongMock,
  /**
   * 삐용 백엔드 베이스 URL. mock 이 아니면 반드시 있다(위에서 기동을 막는다).
   * mock 일 때는 null — mock 경로가 이 값을 쓰지 않는다는 뜻이다.
   */
  bbiyongBaseUrl: bbiyongBaseUrl ?? null,
  aclMode,
  port: Number(process.env.PORT ?? 3001),
  /**
   * 세션 유효기간 — 삐용 refresh 만료를 넘지 않아야 한다.
   *
   * ★ 회신 ⑤(2026-09-08): refresh 폴백 7일 · access 폴백 30분. 다만 **개발계와 가동계가**
   *   **각 DB 의 code010 으로 분리돼 값이 다를 수 있다.** 그래서 ERP 는 삐용 만료를
   *   추적하지 않고, 삐용이 401 을 주면 그때 갱신한다(HttpBbiyongAuth.reIssue).
   *   이 값은 그와 별개인 **ERP 세션의 상한**이다. access 30분은 코드 어디에도 없다.
   *   화면(로그인 상태 유지 체크박스)이 이 값에 영향을 주지 않는다 — 지시문 1-5.
   */
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
} as const;
