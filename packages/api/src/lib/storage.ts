/**
 * Supabase Storage — **서버만** 부른다. 브라우저는 스토리지에 직접 붙지 않는다.
 *
 * =============================================================================
 * ★★ 브라우저가 직접 붙지 않는 이유
 * =============================================================================
 * 직접 붙으려면 브라우저가 스토리지 자격증명을 들고 있어야 한다. `anon` 키로는
 * 비공개 버킷에 쓸 수 없고, `service_role` 키를 내려보내면 **그 키로 모든 버킷의
 * 모든 파일을 읽을 수 있다.** 신분증이 들어가는 자리라 그 선택지는 없다.
 * 그래서 Fastify 가 바이트를 받아서 대신 올린다.
 *
 * =============================================================================
 * ★★ 버킷 이름은 **여기 한 곳**에만 있다 — 레거시 결함 ①
 * =============================================================================
 * 레거시는 업로드·조회·삭제가 각자 버킷 이름을 들고 있었고 값이 서로 달랐다.
 * 그래서 **삭제해도 파일이 남았다** — 지우려는 버킷에 그 파일이 없었기 때문이다.
 * 상수 하나로 두고, 이 파일 밖에서는 버킷 이름을 쓰지 않는다.
 *
 * =============================================================================
 * ★★ 버킷을 **만들지 않는다** — 레거시 결함 ③
 * =============================================================================
 * 레거시는 업로드마다 `createBucket` 을 시도하고 409 를 무시했다. 매 요청마다
 * 쓸데없는 왕복이고, 더 나쁘게는 **버킷 설정이 코드로 덮일 수 있다** —
 * `erp-files` 는 이미 `public=false` · 10MB · JPG/PNG/PDF 로 만들어져 있고
 * 그것이 마지막 방어선이다. 코드가 그 설정을 다시 쓰게 두지 않는다.
 * 버킷이 없으면 업로드가 실패해야 한다. 조용히 만들어 넘어가면 **공개 버킷이
 * 생길 수도 있다.**
 *
 * =============================================================================
 * ★★ URL 을 **돌려주기만 하고 저장하지 않는다** — 레거시 결함 ②
 * =============================================================================
 * `signedUrl()` 이 주는 주소는 만료된다. 호출한 쪽은 응답에 실어 보내고 버린다.
 * DB 에는 `storage_path` 만 있다(020 이 `storage_url` 컬럼을 지웠다).
 */
import { env } from '../env.ts';

/** ★ 이 상수가 유일한 버킷 이름이다. 밖에서 문자열을 쓰지 않는다. */
export const FILE_BUCKET = 'erp-files';

/** 서명 URL 유효 시간. 화면을 열어 두고 보는 동안만 살아 있으면 된다. */
export const SIGNED_URL_TTL_SECONDS = 300;

const base = () => `${env.storageUrl}/storage/v1`;

const authHeaders = (): Record<string, string> => ({
  authorization: `Bearer ${env.storageServiceKey}`,
  apikey: env.storageServiceKey,
});

/** 스토리지가 거절했을 때. 호출한 쪽이 HTTP 코드를 정한다. */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * 경로는 그대로 URL 에 들어간다. 세그먼트마다 인코딩한다 —
 * 회사 식별자에 `/` 가 들어가면 다른 폴더에 쓰게 된다.
 */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * 바이트를 올린다. **덮어쓰지 않는다**(`x-upsert` 를 보내지 않는다) —
 * 경로에 새 식별자가 들어가므로 같은 경로가 두 번 나올 일이 없고, 나온다면
 * 그것은 버그다. 조용히 덮어쓰면 그 버그가 안 보인다.
 */
export async function putObject(args: {
  path: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  const res = await fetch(`${base()}/object/${FILE_BUCKET}/${encodePath(args.path)}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': args.contentType },
    body: new Uint8Array(args.body),
    signal: AbortSignal.timeout(env.storageTimeoutMs),
  });
  if (!res.ok) {
    throw new StorageError(`스토리지 업로드 실패: ${res.status} ${await safeText(res)}`, res.status);
  }
}

/**
 * 지운다. **없는 파일을 지우는 것은 성공으로 본다** — 지우려는 목적은 「없게 만드는
 * 것」이고 이미 없으면 목적은 달성됐다. 404 에 예외를 던지면 재시도가 영원히 실패한다.
 */
export async function removeObject(path: string): Promise<void> {
  const res = await fetch(`${base()}/object/${FILE_BUCKET}/${encodePath(path)}`, {
    method: 'DELETE',
    headers: authHeaders(),
    signal: AbortSignal.timeout(env.storageTimeoutMs),
  });
  if (!res.ok && res.status !== 404) {
    throw new StorageError(`스토리지 삭제 실패: ${res.status} ${await safeText(res)}`, res.status);
  }
}

/**
 * 볼 수 있는 주소를 만든다. **만료된다 — 저장하지 않는다.**
 *
 * 응답의 `signedURL` 은 `/object/sign/...` 로 시작하는 **상대 경로**다.
 * 그대로 화면에 주면 Next 오리진으로 요청이 가서 404 가 된다 — 절대 주소로 만든다.
 */
export async function signedUrl(path: string): Promise<string> {
  const res = await fetch(`${base()}/object/sign/${FILE_BUCKET}/${encodePath(path)}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
    signal: AbortSignal.timeout(env.storageTimeoutMs),
  });
  if (!res.ok) {
    throw new StorageError(`서명 URL 발급 실패: ${res.status} ${await safeText(res)}`, res.status);
  }
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const rel = body.signedURL ?? body.signedUrl;
  if (!rel) throw new StorageError('서명 URL 응답에 주소가 없다', 502);
  return `${base()}${rel.startsWith('/') ? rel : `/${rel}`}`.replace('/storage/v1/storage/v1', '/storage/v1');
}

/** 오류 본문 읽기가 또 실패해도 원래 오류를 덮지 않는다. */
async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}
