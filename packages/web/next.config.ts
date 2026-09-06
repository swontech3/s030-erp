import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @swonbiz/shared 는 빌드 산출물이 아니라 TS 소스를 그대로 내보낸다.
  // 워크스페이스 패키지라 Next 가 직접 트랜스파일해야 한다.
  transpilePackages: ['@swonbiz/shared'],
};

export default nextConfig;
