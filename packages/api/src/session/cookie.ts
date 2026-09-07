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
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}
