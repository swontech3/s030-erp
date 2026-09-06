'use client';

/**
 * Input — DS 원본: design/_ds/swonbiz/components/forms/Input.jsx
 * props 시그니처와 이름은 Input.d.ts 그대로 유지한다.
 *
 * 54px 높이, 8px radius, 인디고 포커스 링. ERP 대시보드의 조밀한 폼과 표 필터에서는
 * size="sm". — Input.prompt.md
 *
 * ★ 'use client' 가 필요한 이유: 포커스 상태를 쓴다.
 * ★ 에러 색 #DC2626 은 원본 그대로 리터럴로 둔다 — 토큰(--color-danger)이 있지만
 *   원본이 리터럴을 쓰고 있고, 개발이 임의로 토큰으로 바꾸면 다음 전달분과 어긋난다
 *   (지시서 2-3-3 "개발이 토큰을 새로 만들지 않는다"의 같은 취지).
 */
import { useId, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'style'> {
  label?: string;
  hint?: string;
  /** 지정하면 에러 상태가 되고 hint 를 대체한다. */
  error?: string;
  size?: 'md' | 'sm';
  iconLeft?: ReactNode;
  style?: CSSProperties;
}

export function Input({ label, hint, error, size = 'md', iconLeft, id, style, ...rest }: InputProps) {
  const [focus, setFocus] = useState(false);
  const reactId = useId();
  const uid = id || reactId;
  const h = size === 'sm' ? 'var(--control-h-sm)' : 'var(--control-h)';
  const border = error ? '#DC2626' : focus ? 'var(--color-primary)' : 'var(--border)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}>
      {label ? (
        <label
          htmlFor={uid}
          style={{
            fontSize: 'var(--text-caption-size)',
            fontWeight: 'var(--weight-bold)' as CSSProperties['fontWeight'],
            color: 'var(--text-heading)',
          }}
        >
          {label}
        </label>
      ) : null}

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {iconLeft ? (
          <span style={{ position: 'absolute', left: 14, display: 'flex', color: 'var(--text-caption)' }}>
            {iconLeft}
          </span>
        ) : null}
        <input
          id={uid}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            width: '100%',
            height: h,
            padding: iconLeft ? '0 16px 0 42px' : '0 16px',
            fontFamily: 'var(--font-core)',
            fontSize: '16px',
            color: 'var(--text-heading)',
            background: 'var(--surface)',
            border: `1px solid ${border}`,
            borderRadius: 'var(--radius-md)',
            outline: 'none',
            boxShadow: focus ? '0 0 0 3px var(--focus-ring)' : 'none',
            transition: 'border-color var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out)',
          }}
          {...rest}
        />
      </div>

      {error || hint ? (
        <span style={{ fontSize: 'var(--text-caption-size)', color: error ? '#DC2626' : 'var(--text-muted)' }}>
          {error || hint}
        </span>
      ) : null}
    </div>
  );
}
