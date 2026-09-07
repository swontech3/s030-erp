/**
 * 세션 암호화 — 삐용 access·refresh 토큰을 DB 에 넣기 전에 감싼다.
 *
 * ★ S-WonERP 의 `lib/crypto.ts` 를 **참고만 하고 새로 썼다**(지시서 2-2). 그쪽 문제 둘:
 *   1) 솔트가 고정이었다 — 같은 평문이 항상 같은 암호문이 되어 값 비교만으로 동일성이 샌다
 *   2) 시크릿을 32자로 **절단**했다 — 길이가 모자라면 조용히 약한 키가 된다
 *
 * 여기서는 KDF 자체를 없앴다. `ERP_ENCRYPTION_KEY` 가 base64 로 **32바이트 원본 키**이고
 * (env.ts 가 길이를 검증한다), 매 레코드마다 12바이트 IV 를 새로 뽑는다.
 * 파생이 없으니 솔트 문제도 절단 문제도 생길 자리가 없다.
 *
 * 형식: `v1.<iv>.<tag>.<ciphertext>` (각 base64). 버전 접두어는 나중에 키를 회전하거나
 * 알고리즘을 바꿀 때 기존 값을 구분하기 위한 것이다.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env.ts';

const VERSION = 'v1';
const IV_BYTES = 12; // GCM 표준 nonce 길이

export function encrypt(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', env.encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(packed: string): string {
  const parts = packed.split('.');
  // 형태 검사를 먼저 한다. 조각이 모자란 값을 그대로 Buffer.from 에 넣으면
  // 빈 IV 로 복호화를 시도하게 되고, 실패 원인이 "인증 실패"로 뭉개진다.
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`복호화 불가 — 알 수 없는 형식: ${parts[0] ?? '(빈 값)'}`);
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', env.encryptionKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  // 인증 태그가 안 맞으면 final() 이 던진다 — 변조된 암호문을 평문으로 돌려주지 않는다.
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * 세션 ID 원문 생성 — 브라우저 쿠키에 담기는 값.
 * 32바이트 난수. base64url 이라 쿠키에 그대로 실린다.
 */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * 세션 ID 해시 — DB(`tb_s080_auth_session.erp_sid`)에는 **이것만** 저장한다.
 * DB 가 유출돼도 세션을 재구성할 수 없다(삐용 token010.refresh_token_hash 와 같은 관례).
 *
 * ★ 솔트를 쓰지 않는 것이 맞다. 입력이 32바이트 난수라 사전공격 대상이 아니고,
 *   조회할 때 해시로 인덱스를 타야 하므로 레코드별 솔트를 쓰면 전수 검색이 된다.
 */
export function hashSessionId(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
