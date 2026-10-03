/**
 * 인증 화면 우측 브랜드 패널 (56%).
 *
 * 원본: design/erp-auth/ErpAuth.dc.html 140~164행.
 * 로그인(s030000010)과 접근권한없음(s030000080)이 **같은 것을 쓴다** —
 * 원본 템플릿에서도 이 패널은 화면 분기(sc-if) 밖에 있어 4개 화면이 공유한다.
 * 두 벌로 복사하면 한쪽만 고쳐지는 날이 온다.
 *
 * 상태가 없어 서버 컴포넌트로 동작한다.
 */
import { Icon, type IconName } from '@/components/ds';

const FEATURES: ReadonlyArray<{ icon: IconName; title: string; desc: string }> = [
  { icon: 'file-pen-line', title: '법무 서류 자동 생성', desc: '정관·의사록·주주명부까지' },
  { icon: 'receipt', title: '세금계산서 자동 발행', desc: '결제 완료 시 즉시 처리' },
  { icon: 'calendar-check', title: '회의실 실시간 예약', desc: '월 무료 시간 자동 차감' },
];

export function AuthBrandPanel() {
  return (
    <div
      style={{
        position: 'relative',
        width: '56%',
        flex: '0 0 auto',
        background: 'linear-gradient(180deg,#131C33 0%,var(--surface-inverse) 100%)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}
    >
      {/*
        배경 장식 3겹 — 원본 그대로.
        #131C33 과 rgba(...) 알파 조합은 리터럴로 둔다(지시서 2-3-3).
        CSS 변수로 알파를 조합할 수 없어 디자인이 의도적으로 리터럴로 쓴 값이다.
      */}
      <div
        style={{
          position: 'absolute',
          top: -140,
          right: -100,
          width: 520,
          height: 520,
          borderRadius: 999,
          background: 'radial-gradient(circle,var(--color-primary) 0%,rgba(79,70,229,0) 72%)',
          opacity: 0.16,
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -60,
          left: -80,
          width: 320,
          height: 320,
          borderRadius: 999,
          background: 'radial-gradient(circle,var(--color-accent) 0%,rgba(34,211,238,0) 72%)',
          opacity: 0.1,
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(#FFFFFF 1px,transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.05,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', width: 440 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 26,
            padding: '0 12px',
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(79,70,229,.18)',
            border: '1px solid rgba(129,140,248,.35)',
            color: 'var(--color-secondary)',
            fontSize: 12,
            fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
            whiteSpace: 'nowrap',
          }}
        >
          <Icon name="sparkles" size={14} />
          12년째 운영 중
        </span>

        <h2
          style={{
            margin: '20px 0 0',
            fontSize: 'var(--text-h1-size)',
            fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
            lineHeight: 1.25,
            letterSpacing: 'var(--text-h1-ls)',
            color: '#FFFFFF',
          }}
        >
          공간을 빌리면
          <br />
          AI가 법무·세무를 처리합니다
        </h2>

        <p
          style={{
            margin: '16px 0 0',
            fontSize: 16,
            lineHeight: 1.7,
            color: 'var(--text-on-inverse-muted)',
            textWrap: 'pretty' as React.CSSProperties['textWrap'],
          }}
        >
          계약, 청구, 세금계산서, 회의실 예약까지 입주와 동시에 시작됩니다.
        </p>

        <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {FEATURES.map((f) => (
            <div key={f.icon} style={{ display: 'flex', gap: 14 }}>
              <span
                style={{
                  width: 36,
                  height: 36,
                  flex: '0 0 auto',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(255,255,255,.06)',
                  border: '1px solid rgba(255,255,255,.10)',
                  color: 'var(--color-secondary)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon name={f.icon} size={18} />
              </span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'], color: '#FFFFFF' }}>
                  {f.title}
                </div>
                <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.55, color: 'var(--text-on-inverse-muted)' }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 40,
          textAlign: 'center',
          fontSize: 12,
          lineHeight: 1.5,
          color: 'rgba(255,255,255,.4)',
        }}
      >
        SwonBiz는 주식회사 에스원테크가 운영하는 공유오피스 브랜드입니다
      </div>
    </div>
  );
}
