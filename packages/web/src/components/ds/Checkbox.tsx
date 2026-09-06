'use client';

/**
 * Checkbox — DS 원본: design/_ds/swonbiz/components/forms/Checkbox.jsx
 * props 시그니처와 이름은 Checkbox.d.ts 그대로 유지한다.
 *
 * 20px 상자, 4px radius. 제어 컴포넌트로 쓴다(checked + onChange). — Checkbox.prompt.md
 *
 * ★ 'use client' 가 필요한 이유: onChange 핸들러를 받는다.
 * ★ 진짜 <input type="checkbox"> 를 숨겨서 쓴다 — 보이는 상자는 <span> 이지만
 *   키보드 포커스·스페이스 토글·스크린리더는 실제 input 이 담당한다. 접근성을 위해
 *   이 구조를 유지한다(원본과 동일).
 */
import { useId, type CSSProperties, type InputHTMLAttributes } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'style'> {
  label?: string;
  /** 라벨 아래 보조 문구 */
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

export function Checkbox({ label, description, checked, onChange, disabled, style, ...rest }: CheckboxProps) {
  const uid = useId();
  return (
    <label
      htmlFor={uid}
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: description ? 'flex-start' : 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <input
        id={uid}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        {...rest}
      />
      <span
        style={{
          width: 20,
          height: 20,
          flex: '0 0 auto',
          marginTop: description ? 2 : 0,
          borderRadius: 'var(--radius-xs)',
          border: checked ? '1px solid var(--color-primary)' : '1px solid var(--border-strong)',
          background: checked ? 'var(--color-primary)' : 'var(--surface)',
          display: 'grid',
          placeItems: 'center',
          transition: 'background var(--dur) var(--ease-out), border-color var(--dur) var(--ease-out)',
        }}
      >
        {checked ? (
          <span
            style={{
              width: 10,
              height: 5,
              borderLeft: '2px solid #fff',
              borderBottom: '2px solid #fff',
              transform: 'rotate(-45deg) translateY(-1px)',
            }}
          />
        ) : null}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: '16px', color: 'var(--text-heading)' }}>{label}</span>
        {description ? (
          <span style={{ fontSize: 'var(--text-caption-size)', color: 'var(--text-muted)' }}>{description}</span>
        ) : null}
      </span>
    </label>
  );
}
