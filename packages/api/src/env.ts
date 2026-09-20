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

/**
 * 스토리지(Supabase Storage) — 첨부 서류(CONT-17)가 쓴다.
 *
 * ★★ **`service_role` 키여야 한다.** 버킷 `erp-files` 는 비공개이고 `storage.objects`
 *    는 RLS 가 켜진 채 정책이 하나도 없다 — `anon` 키로는 목록이 **빈 배열**로 오고
 *    이름으로 찾으면 404 다. "버킷이 없다"처럼 보이지만 실제로는 권한 문제다.
 *    2026-09-20 에 저장소 루트 `.env` 의 `SUPABASE_SERVICE_ROLE_KEY` 가 **anon 키의
 *    복사본**이었다(두 값이 바이트까지 동일, JWT payload 가 `"role":"anon"`).
 *    그래서 여기서 **role 을 직접 검사하고 아니면 기동을 막는다** — 이 값이 틀리면
 *    첨부가 전부 404 로 죽는데, 그 원인을 찾는 자리는 업로드 화면이 아니라 여기다.
 */
const storageUrl = required('SUPABASE_URL').replace(/\/+$/, '');
const storageServiceKey = required('SUPABASE_SERVICE_ROLE_KEY');
assertServiceRole(storageServiceKey);

function assertServiceRole(token: string): void {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 가 JWT 모양이 아니다.');
  }
  let role: unknown;
  try {
    role = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: unknown }).role;
  } catch {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY 의 payload 를 읽을 수 없다.');
  }
  if (role !== 'service_role') {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY 의 role 이 '${String(role)}' 이다. ` +
        "'service_role' 이어야 한다 — anon 키로는 비공개 버킷이 404 로 보인다.",
    );
  }
}

/**
 * 사업자등록증 OCR(Google Cloud Vision) 서비스 계정 키.
 *
 * ★ **없어도 기동한다.** 다른 변수와 다르게 `required()` 를 쓰지 않는다 — OCR 은
 *   운영자의 타이핑을 줄이는 도우미일 뿐이고, 없으면 손으로 입력하면 된다.
 *   여기서 기동을 막으면 키 하나 때문에 계약 등록 전체가 멈춘다. 없을 때는
 *   OCR 라우트만 503 을 낸다(`routes/ocr.ts`).
 *
 * ★★ **상대경로를 `packages/api` 기준으로 절대경로로 바꿔 둔다.** 레거시는 이 값이
 *    `D:\workspace\claude\S-WonERP\secrets\...` 절대경로여서 다른 기계로 옮기는
 *    순간 OCR 이 죽었다. 상대경로를 그대로 두면 이번에는 **프로세스의 cwd** 에
 *    따라 죽는다(`npm --prefix` 로 띄우면 cwd 가 저장소 루트다). 그래서 읽는
 *    자리에서 한 번 확정한다.
 */
const credentialsRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const ocrCredentialsPath = credentialsRaw ? resolve(here, '..', credentialsRaw) : null;
if (ocrCredentialsPath && !existsSync(ocrCredentialsPath)) {
  // 죽이지는 않지만 조용히 넘어가지도 않는다 — 「OCR 이 왜 503 이지」를 찾는 자리가 여기다.
  console.warn(
    `[env] GOOGLE_APPLICATION_CREDENTIALS 가 가리키는 파일이 없다: ${ocrCredentialsPath} — OCR 은 503 을 낸다.`,
  );
}

/**
 * 국세청 사업자등록 상태조회(공공데이터포털) 인증키.
 *
 * ★ **없어도 기동한다.** OCR 키와 같은 이유다 — 확인이 안 되는 것은 계약 등록을
 *   막을 이유가 못 된다. 없으면 [확인] 버튼이 「확인하지 못했습니다」라고 답한다.
 *
 * ★ 저장소 루트 `.env` 에도 같은 키가 있다(스크립트용). 두 파일이 갈릴 수 있으니
 *   **여기(`packages/api/.env`)가 이 서버의 정본**이다.
 */
const ntsServiceKey = process.env.DATA_GO_KR_KEY?.trim() || null;

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
  /** Supabase 게이트웨이. ★ 스토리지 경로(`/storage/v1/...`)는 `lib/storage.ts` 가 붙인다. */
  storageUrl,
  storageServiceKey,
  /**
   * 스토리지 왕복 상한. 파일이 최대 10MB 라 JSON 호출(5초)보다 넉넉해야 하지만,
   * 상한이 없으면 느린 업로드 하나가 Fastify 워커를 잡아 둔다.
   */
  storageTimeoutMs: 30_000,
  /**
   * Vision 서비스 계정 키의 절대경로. `null` 이면 OCR 기능이 꺼진 것이다 —
   * 라우트가 503 과 함께 사람이 읽을 수 있는 이유를 돌려준다.
   */
  ocrCredentialsPath: ocrCredentialsPath && existsSync(ocrCredentialsPath) ? ocrCredentialsPath : null,
  /**
   * 국세청 상태조회 인증키. `null` 이면 **그 기능만** 꺼진다 — 계약 등록은 그대로 된다.
   */
  ntsServiceKey,
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
