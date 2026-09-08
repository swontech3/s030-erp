'use client';

/**
 * (erp) 그룹의 장애 화면 — 세션 조회가 5xx 를 내거나 Fastify 에 못 붙었을 때.
 *
 * 리뷰(2026-09-07 M1) 전에는 이 경우가 "세션 없음"으로 뭉개져 전원이 /login 으로 튕겼다.
 * 장애는 장애로 보여야 재로그인으로 세션이 하나 더 생기는 일이 없다.
 * 디자인 템플릿이 없는 화면이라 셸 없이 최소한만 그린다 — 정식 디자인은 디자인 회신 후.
 */
export default function ErpError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--surface-alt)' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h1 style={{ margin: 0, fontSize: 'var(--text-h3-size)', color: 'var(--text-heading)' }}>
          지금은 서비스에 연결할 수 없습니다
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          로그인 세션은 그대로입니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 24,
            height: 44,
            padding: '0 20px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface)',
            color: 'var(--text-heading)',
            fontFamily: 'inherit',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
