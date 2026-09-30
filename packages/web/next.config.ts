import type { NextConfig } from 'next';

/**
 * 로그인이 필요한 화면 — `src/proxy.ts` 의 `matcher` 와 **같은 목록이다.**
 * 한쪽만 고치면 새 화면이 보호는 되는데 캐시에는 남는다.
 */
const PROTECTED_PATHS = [
  '/dashboard/:path*',
  '/booking/:path*',
  '/tenants/:path*',
  '/contracts/:path*',
  '/billing/:path*',
  '/settings/:path*',
  '/facility/:path*',
  '/inquiry-admin/:path*',
];

const nextConfig: NextConfig = {
  // @swonbiz/shared 는 빌드 산출물이 아니라 TS 소스를 그대로 내보낸다.
  // 워크스페이스 패키지라 Next 가 직접 트랜스파일해야 한다.
  transpilePackages: ['@swonbiz/shared'],

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ★★★ `no-store` — **로그아웃한 뒤 [뒤로] 로 되돌아가지 못하게 한다**
   * ══════════════════════════════════════════════════════════════════════════
   * Next 가 업무 화면에 기본으로 붙이는 것은 `no-cache, must-revalidate` 다.
   * 그것으로는 모자란다 — **[뒤로]·[앞으로] 는 그 응답을 캐시에서 그대로 꺼내 쓴다.**
   * 2026-09-30 에 실제로 재현했다: 로그아웃해서 세션이 죽은 뒤 [뒤로] 를 누르면
   * 대시보드가 이름·회사와 함께 다시 떴다(`navigation.type = back_forward`,
   * 문서는 새로 만들어졌는데 **네트워크 요청은 없었다** — 미들웨어도 못 탄다).
   *
   * `no-store` 는 그 재사용을 금지한다. 그러면 [뒤로] 가 실제 요청이 되고, 쿠키가
   * 없으므로 `proxy.ts` 가 `/login` 으로 돌려보낸다.
   *
   * ★ 미들웨어에서 이 헤더를 붙여 봤지만 **Next 가 페이지 응답에서 덮어쓴다**(실측).
   *   그래서 여기에 둔다. 같은 시도를 반복하지 않도록 `proxy.ts` 에도 적어 뒀다.
   *
   * ★ 대가: 이 화면들에서는 [뒤로]·[앞으로] 가 즉시 복원되지 않고 다시 그려진다.
   *   업무 화면이 남의 브라우저에 남아 있는 것보다 낫다.
   *
   * ★ 공개 화면(회의실 현황판·문의 게시판)과 정적 파일은 목록에 없다 — 그대로 캐시된다.
   *   거기엔 지킬 것이 없고, 현황판은 오히려 캐시가 도움이 된다.
   */
  async headers() {
    return PROTECTED_PATHS.map((source) => ({
      source,
      headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
    }));
  },
};

export default nextConfig;
