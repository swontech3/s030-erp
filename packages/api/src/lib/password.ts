/**
 * 글 비밀번호 해시 — 문의상담(s030500070)이 쓴다.
 *
 * =============================================================================
 * ★★★ 왜 scrypt 인가
 * =============================================================================
 * 명세(04-data-model.md §4)는 「bcrypt/argon2. 평문·가역 암호화 금지」다. 저장소에
 * 둘 다 없고, `crypto.scrypt` 는 **같은 계열의 비밀번호 KDF**(메모리·CPU 비용을 물리는
 * 함수)라서 의존성 없이 같은 성질을 얻는다(2026-09-27 결정).
 *
 * ★★ 알고리즘과 파라미터를 **해시 문자열 앞에 적는다.** 나중에 argon2 로 갈아도
 *    옛 해시를 그대로 검증할 수 있다 — 다 밀고 「비밀번호를 다시 정하세요」를
 *    보낼 수단이 이 게시판에는 없다(로그인이 없어 연락할 길이 글 하나뿐이다).
 *
 * ★ 이 비밀번호는 4자다. 해시만으로는 못 막는다 — `unlock` 시도 제한(10분 5회)이
 *   같이 있어야 성립한다. 둘 중 하나만 있으면 없는 것과 같다.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * ★ `promisify(scrypt)` 를 쓰지 않는다 — 오버로드가 뭉개져 옵션 인자를 못 넘긴다.
 *   파라미터를 넘기지 못하면 기본값(N=16384 가 아님)으로 조용히 약해진다.
 */
const scryptAsync = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** OWASP 권고 최소선(N=2^14 · r=8 · p=1). 메모리 16MB — 기본 maxmem(32MB) 안이다. */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** `scrypt$N$r$p$salt$hash` — 앞의 다섯 자리가 검증에 필요한 전부다. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEY_BYTES, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * 맞는 비밀번호인가.
 *
 * ★ 실패는 전부 `false` 다 — 「형식이 깨졌다」와 「틀렸다」를 구분해 알려 주지 않는다.
 * ★ 비교는 `timingSafeEqual` — 길이가 다르면 비교 자체를 하지 않는다.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash!, 'base64');
  try {
    const key = await scryptAsync(plain.normalize('NFKC'), Buffer.from(salt!, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    // 파라미터가 망가졌거나 maxmem 을 넘었다 — 통과시키지 않는다.
    return false;
  }
}
