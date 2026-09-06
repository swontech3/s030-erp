/**
 * 인증 화면 공통 뼈대 — 좌 44% 폼 + 우 56% 브랜드 패널.
 *
 * 원본: design/erp-auth/ErpAuth.dc.html 15~16행(바깥 flex + 좌측 열)과 17~21행(로고).
 * 원본 템플릿에서 이 뼈대는 화면 분기(sc-if) **밖에** 있다 — 4개 화면이 같은 껍데기를
 * 쓰고 안쪽만 바뀐다. 로그인(s0300000010)과 접근권한없음(s0300000080)도 그렇게 둔다.
 *
 * min-width:1440px 고정은 원본 그대로다. 반응형은 예약 현황·현황판 두 화면만 한다
 * (SWONBIZ_PROJECT_STRUCTURE.md §5).
 */
import Image from 'next/image';
import type { ReactNode } from 'react';
import { AuthBrandPanel } from './AuthBrandPanel';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minWidth: 1440, height: '100vh', display: 'flex', fontFamily: 'var(--font-core)' }}>
      <div
        style={{
          position: 'relative',
          width: '44%',
          flex: '0 0 auto',
          minHeight: 0,
          overflowY: 'auto',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: '112px 48px 48px',
        }}
      >
        <a
          href="/"
          style={{
            position: 'absolute',
            top: 40,
            left: 48,
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
          }}
        >
          <Image
            src="/brand/swonbiz-logo.png"
            alt="SwonBiz"
            width={28}
            height={28}
            style={{ height: 28, width: 'auto', display: 'block' }}
          />
          <span
            style={{
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: '-.03em',
              color: 'var(--text-heading)',
              whiteSpace: 'nowrap',
            }}
          >
            S<span style={{ opacity: 0.55 }}>·</span>won<span style={{ color: 'var(--color-primary)' }}>Biz</span>
          </span>
        </a>

        {children}
      </div>

      <AuthBrandPanel />
    </div>
  );
}
