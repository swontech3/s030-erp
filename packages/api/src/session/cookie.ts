/**
 * 쿠키 파싱 — `@fastify/cookie` 를 붙이지 않는다.
 *
 * 이 서버가 읽는 쿠키는 `erp_sid` 하나뿐이고, 서명·직렬화도 쓰지 않는다.
 * 의존성 하나를 줄이는 쪽이 낫다.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      // 잘못된 %-인코딩(%E0 등)은 던진다. 여기서 안 잡으면 세션 훅이 500 을 내고,
      // 그건 "쿠키가 이상하면 401" 이어야 할 자리다.
      return null;
    }
  }
  return null;
}
