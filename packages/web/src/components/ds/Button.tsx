'use client';

/**
 * Button — DS 원본: design/_ds/swonbiz/components/core/Button.jsx
 * props 시그니처와 이름은 Button.d.ts 그대로 유지한다(템플릿 11개가 이 이름으로 호출한다).
 *
 * 규칙 (Button.prompt.md)
 * - 한 화면에 primary 는 하나. primary 둘을 나란히 두지 않고 primary + ghost 로 짝짓는다
 * - inverse 는 --surface-inverse(#0B1120) 섹션에서만
 * - size="sm"(40px)는 툴바·표·대시보드. 그 외는 54px
 *
 * ★ hover 는 원본대로 JS 상태로 둔다. 템플릿(.dc.html)의 `style-hover` 속성과는 다른
 *   이야기다 — 그건 디자인 도구 전용 속성이라 브라우저가 무시하므로 화면 이관(2-5)에서
 *   실제 CSS 로 다시 쓴다. 이 컴포넌트의 onMouseEnter/Leave 는 브라우저에서 동작한다.
 *
 * ★ 'use client' 가 필요한 이유: hover/active 상태를 쓴다.
 */
import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'subtle' | 'inverse' | 'link';
type Size = 'md' | 'sm';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  disabled?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /** "a" 로 렌더할 수 있다. href 등은 rest 로 넘어간다. */
  as?: 'button' | 'a';
  /**
   * `as="a"` 일 때의 링크 속성.
   *
   * ★★ **DS 원본 `Button.d.ts` 에 없다.** 원본은 props 를 `ButtonHTMLAttributes` 로만
   *    선언해 두고 `as` 주석에 「e.g. "a"」 라고 적어 놨다 — 그래서 `as="a"` 를 쓰면
   *    `href` 가 타입에 없어 컴파일이 깨진다(2026-10-01 랜딩에서 처음 썼다).
   *    이름은 원본 그대로 두고 **셋만 더했다.** 원본에 돌려줄 때도 이 셋만 보면 된다.
   * ★ `as="button"` 에 href 를 주면 DOM 에 의미 없는 속성이 붙는다 — 쓰지 않는다.
   */
  href?: string;
  target?: string;
  rel?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

const SIZES: Record<Size, CSSProperties> = {
  md: { height: 'var(--control-h)', padding: '0 var(--control-px)', fontSize: '16px' },
  sm: { height: 'var(--control-h-sm)', padding: '0 var(--control-px-sm)', fontSize: '14px' },
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  iconLeft,
  iconRight,
  as = 'button',
  children,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const h = hover && !disabled;

  const variants: Record<Variant, CSSProperties> = {
    primary: {
      background: h ? 'var(--color-primary-hover)' : 'var(--color-primary)',
      color: 'var(--text-on-primary)',
      border: '1px solid transparent',
      boxShadow: h ? 'var(--shadow-primary-hover)' : 'var(--shadow-primary)',
    },
    ghost: {
      background: h ? 'var(--surface-alt)' : 'var(--surface)',
      color: 'var(--text-heading)',
      border: '1px solid var(--border)',
      boxShadow: 'none',
    },
    subtle: {
      background: h ? '#E4E9FF' : 'var(--color-accent-bg)',
      color: 'var(--color-primary-hover)',
      border: '1px solid transparent',
      boxShadow: 'none',
    },
    inverse: {
      background: h ? '#FFFFFF' : 'rgba(255,255,255,.10)',
      color: h ? 'var(--slate-950)' : '#FFFFFF',
      border: '1px solid rgba(255,255,255,.22)',
      boxShadow: 'none',
    },
    link: {
      background: 'transparent',
      color: h ? 'var(--text-link-hover)' : 'var(--text-link)',
      border: '1px solid transparent',
      boxShadow: 'none',
      padding: 0,
      height: 'auto',
    },
  };

  const Tag = as as 'button';
  return (
    <Tag
      disabled={as === 'button' ? disabled : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex',
        width: fullWidth ? '100%' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        fontFamily: 'var(--font-core)',
        fontWeight: 'var(--weight-bold)' as CSSProperties['fontWeight'],
        letterSpacing: '-.01em',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transform: active && !disabled ? 'translateY(1px)' : 'none',
        transition:
          'background var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out), color var(--dur) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        ...SIZES[size],
        ...variants[variant],
        ...style,
      }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </Tag>
  );
}
