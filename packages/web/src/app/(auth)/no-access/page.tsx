/** @screen s0300000080 접근 권한 없음 · 000 공통 · 1차 */

/**
 * 접근권한없음 — 로그인은 성공했지만 접근 가능한 화면이 0건일 때 온다 (AUTH-13).
 *
 * 원본: design/erp-auth/ErpAuth.dc.html 의 sent 블록(83~92행) 구조를 그대로 쓰고
 * 다섯 군데만 바꾼다.
 *
 *   요소            sent 원본           여기
 *   원형 배경        --color-accent-bg   --color-warning-bg
 *   아이콘          mail-check          circle-alert
 *   아이콘 색        --color-primary     --color-warning
 *   제목            메일을 확인해 주세요  이 계정은 ERP 이용 권한이 없습니다
 *   본문            재설정 안내          담당자에게 문의하세요.
 *   액션            버튼 + 링크          "로그아웃" 하나
 *
 * 원본에 있던 회색 안내 박스(스팸함 확인)와 "← 로그인으로 돌아가기" 링크는 뺐다.
 * 여기서 나갈 길은 로그아웃 하나여야 한다 — 로그인으로 돌아가도 같은 계정이면
 * 다시 이 화면으로 온다.
 *
 * ★ 라우트는 /no-access 다. 화면 ID 를 URL 에 노출하지 않는다(구조도 §1 첫 원칙).
 * ★ 상태가 없어 서버 컴포넌트다. 로그아웃은 form POST 라 자바스크립트 없이도 동작한다.
 */
import { AuthShell } from '@/components/patterns/AuthShell';
import { Icon } from '@/components/ds';
import styles from './no-access.module.css';

export const metadata = {
  title: '접근 권한 없음 · SwonBiz ERP',
};

export default function NoAccessPage() {
  return (
    <AuthShell>
      <div style={{ width: 380, margin: 'auto 0' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              background: 'var(--color-warning-bg)',
              color: 'var(--color-warning)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon name="circle-alert" size={28} />
          </span>
        </div>

        <h1
          style={{
            margin: '20px 0 0',
            fontSize: 'var(--text-h2-size)',
            fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
            lineHeight: 'var(--text-h2-lh)',
            letterSpacing: 'var(--text-h2-ls)',
            color: 'var(--text-heading)',
            textAlign: 'center',
          }}
        >
          이 계정은 ERP 이용 권한이 없습니다
        </h1>

        <p
          style={{
            margin: '8px 0 0',
            fontSize: 16,
            lineHeight: 1.7,
            color: 'var(--text-body)',
            textAlign: 'center',
            textWrap: 'pretty' as React.CSSProperties['textWrap'],
          }}
        >
          담당자에게 문의하세요.
        </p>

        {/*
          로그아웃 — 실제로 동작한다. 쿠키를 지우고 /login 으로 보낸다.
          revoked_at 은 /api/auth/logout → Fastify /auth/logout 이 처리한다.

          ★ GET 링크가 아니라 form POST 다. 링크로 두면 프리페치만으로 로그아웃된다.
        */}
        <form action="/api/auth/logout" method="post" style={{ marginTop: 20 }}>
          {/*
            버튼 스타일 — 크기는 원본(sent 블록) 52px 을 따르고, 색은 DS Button 의
            ghost 정의와 맞춘다.

            근거: 원본 sent 블록의 "다시 보내기" 버튼이 이미
              border:1px solid var(--border) / background:var(--surface) /
              color:var(--text-heading) / hover background:var(--surface-alt)
            인데, 이는 DS Button ghost 변형과 **같은 값**이다. 즉 색은 이미 일치하고
            높이만 다르다(원본 52px vs DS --control-h 54px). 로그인 화면과 같은 이유로
            .dc.html 을 시각 기준으로 삼아 52px 을 유지했다.
          */}
          <button
            type="submit"
            className={styles.logout}
            style={{
              width: '100%',
              height: 52,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface)',
              color: 'var(--text-heading)',
              fontFamily: 'inherit',
              fontSize: 16,
              fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
              cursor: 'pointer',
              transition: 'background var(--dur) var(--ease-out)',
            }}
          >
            로그아웃
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
