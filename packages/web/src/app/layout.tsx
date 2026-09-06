/**
 * 루트 레이아웃 — 폰트·전역 토큰이 붙을 자리.
 * 페이즈 1의 2-3(tokens.css)·2-4(DS 컴포넌트)에서 채운다. 지금은 뼈대만 둔다.
 */
export const metadata = {
  title: 'SwonBiz ERP',
  description: '에스원비즈 공유오피스 운영 시스템',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
