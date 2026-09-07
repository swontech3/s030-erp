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

const aclMode = (process.env.BBIYONG_ACL_MODE ?? 'mock') as 'mock' | 'http';
if (aclMode !== 'mock' && aclMode !== 'http') {
  throw new Error(`BBIYONG_ACL_MODE 는 'mock' 또는 'http' 여야 한다: ${aclMode}`);
}
if (aclMode === 'http' && !process.env.BBIYONG_BASE_URL) {
  throw new Error(
    'BBIYONG_ACL_MODE=http 인데 BBIYONG_BASE_URL 이 없다. mock 으로 폴백하지 않고 기동을 중단한다 — ' +
      '폴백하면 운영에 mock 권한(전 화면 허용)이 올라간다.',
  );
}

const key = Buffer.from(required('ERP_ENCRYPTION_KEY'), 'base64');
if (key.length !== 32) {
  throw new Error(`ERP_ENCRYPTION_KEY 는 base64 로 32바이트여야 한다(현재 ${key.length}바이트).`);
}

export const env = {
  databaseUrl: required('ERP_DATABASE_URL'),
  encryptionKey: key,
  bbiyongMock: process.env.BBIYONG_MOCK === 'true',
  aclMode,
  port: Number(process.env.PORT ?? 3001),
  /**
   * 세션 유효기간 — 삐용 refresh 만료와 같아야 한다.
   * ★ 7일은 **폴백 가정**이다(회신 ⑤ 대기). 실값이 오면 이 상수만 고친다.
   *   화면(로그인 상태 유지 체크박스)이 이 값에 영향을 주지 않는다 — 지시문 1-5.
   */
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
} as const;
