/**
 * SwonBiz ERP — Tailwind 설정 (1차 인계)
 *
 * 두 가지 방식 중 하나를 고르세요.
 *   A) CSS 변수를 그대로 두고 Tailwind 는 변수를 참조 — 권장.
 *      런타임 테마 전환(brand biz/tech)이 필요하고, 디자인 원본과 1:1 대조가 쉽습니다.
 *   B) 아래 리터럴 값을 그대로 사용 — CSS 변수 없이 Tailwind 만으로 가는 경우.
 *
 * 아래 설정은 A 방식입니다. handoff/tokens/*.css 를 전역에 먼저 로드하세요.
 */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "var(--color-primary)", hover: "var(--color-primary-hover)" },
        secondary: "var(--color-secondary)",
        accent: { DEFAULT: "var(--color-accent)", bg: "var(--color-accent-bg)" },
        warning: { DEFAULT: "var(--color-warning)", bg: "var(--color-warning-bg)", text: "var(--color-warning-text)" },
        danger: { DEFAULT: "var(--color-danger)", bg: "var(--color-danger-bg)", text: "var(--color-danger-text)" },
        surface: { DEFAULT: "var(--surface)", alt: "var(--surface-alt)", inverse: "var(--surface-inverse)" },
        line: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
        ink: {
          heading: "var(--text-heading)",
          body: "var(--text-body)",
          muted: "var(--text-muted)",
          caption: "var(--text-caption)",
          "on-primary": "var(--text-on-primary)",
          "on-inverse": "var(--text-on-inverse)",
          "on-inverse-muted": "var(--text-on-inverse-muted)",
        },
      },
      fontFamily: {
        sans: ["var(--font-core)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        display: ["60px", { lineHeight: "1.12", letterSpacing: "-.03em", fontWeight: "800" }],
        h1: ["40px", { lineHeight: "1.2", letterSpacing: "-.022em", fontWeight: "700" }],
        h2: ["30px", { lineHeight: "1.3", letterSpacing: "-.018em", fontWeight: "700" }],
        h3: ["22px", { lineHeight: "1.4", letterSpacing: "-.012em", fontWeight: "600" }],
        "body-lg": ["19px", { lineHeight: "1.65" }],
        body: ["16px", { lineHeight: "1.7" }],
        caption: ["14px", { lineHeight: "1.55" }],
        micro: ["12px", { lineHeight: "1.5" }],
      },
      spacing: {
        // 4px 배수. Tailwind 기본 스케일과 겹치므로 레이아웃 상수만 추가합니다.
        "section-y": "96px",
        "section-y-lg": "120px",
        gutter: "24px",
      },
      maxWidth: {
        container: "1200px",
        prose: "760px",
        form: "1120px",   // 계약 폼 콘텐츠 폭
        settings: "800px" // 설정 본문 폭
      },
      borderRadius: {
        xs: "4px", sm: "6px", md: "8px", lg: "12px", pill: "999px",
      },
      boxShadow: {
        primary: "0 4px 16px rgba(79,70,229,.22)",
        "primary-hover": "0 6px 20px rgba(79,70,229,.28)",
        float: "0 8px 24px rgba(11,17,32,.10)",
        overlay: "0 20px 48px rgba(11,17,32,.18)",
      },
      height: {
        control: "54px",     // 랜딩
        "control-md": "44px",// 폼 기본
        "control-sm": "40px",// ERP 기본
        "control-xs": "38px",// 밀집 테이블 행
      },
      transitionTimingFunction: {
        out: "cubic-bezier(.22,.61,.36,1)",
        "in-out": "cubic-bezier(.4,0,.2,1)",
      },
      transitionDuration: { fast: "120ms", DEFAULT: "180ms", slow: "280ms" },
      screens: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" },
      ringColor: { focus: "var(--focus-ring)" },
    },
  },
  plugins: [],
};
