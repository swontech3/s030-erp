/**
 * 루트 레이아웃 — 디자인 토큰과 웹폰트가 붙는 자리.
 *
 * 화면·DS 컴포넌트는 다음 단계(2-4·2-5)다. 여기서는 토큰 로드와 폰트 프리로드까지만 한다.
 */
import '@/styles/tokens.css';
// ★ 계약서 인쇄 규칙. 전역이어야 한다 — 숨겨야 할 것(사이드바·폼 섹션)이 컴포넌트
//   밖에 있어서 CSS 모듈로는 가리킬 수 없다. 자세한 이유는 파일 머리말.
import '@/styles/print.css';

export const metadata = {
  title: 'SwonBiz ERP',
  description: '에스원비즈 공유오피스 운영 시스템',
};

/**
 * ★ 2026-11-08 — 다른 화면(삐용) 안에 떴는지를 **첫 페인트 전에** `<html data-embedded>` 로 적는다.
 *   서버는 iframe 인지 모른다. 마운트 뒤에 알면 메뉴 틀 · 로그인 입력칸이 한 번 그려졌다가 사라진다
 *   (삐용 요청 2026-11-08 「로그인 화면 깜박임」). 이 표시를 보고 CSS 가 처음부터 감춘다
 *   — AppShell.module.css · login.module.css.
 * ★ 판정은 shared `isEmbedded` 와 같다(self !== top, 접근이 막히면 안에 뜬 것).
 * ★ 표시만 한다 — 토큰 주고받기 · 허용 주소 판정은 그대로 embedBridge 한 곳이다.
 */
const EMBED_MARK_SCRIPT =
  "try{if(window.self!==window.top)document.documentElement.setAttribute('data-embedded','1')}" +
  "catch(e){document.documentElement.setAttribute('data-embedded','1')}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // ★ suppressHydrationWarning — 위 스크립트가 React 보다 먼저 data-embedded 를 붙인다(html 한 칸만)
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EMBED_MARK_SCRIPT }} />
        {/*
          자체 호스팅 웹폰트 프리로드.

          tokens.css 의 @font-face 는 그 CSS 가 파싱되고 글자가 실제로 쓰일 때까지
          요청되지 않는다. 로그인 화면은 첫 화면이라 그 지연이 그대로 FOUT(글자 튐)로
          보인다. 프리로드로 CSS 파싱과 병렬로 받는다.

          ★ crossOrigin 이 없으면 프리로드한 것과 폰트가 실제로 요청하는 것이 다른
            요청으로 취급되어 두 번 받는다. 같은 출처라도 폰트는 CORS 모드로 요청된다.
        */}
        <link
          rel="preload"
          href="/fonts/PretendardVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Inter-latin-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
