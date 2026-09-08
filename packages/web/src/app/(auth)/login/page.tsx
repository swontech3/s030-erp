'use client';

/** @screen s0300000010 로그인 · 000 공통 · 1차 */

/**
 * 로그인 화면 — 원본: design/erp-auth/ErpAuth.dc.html 의 isLogin 블록(23~67행).
 * 바깥 껍데기(좌 44% + 로고)와 우측 브랜드 패널은 AuthShell 로 뺐다 —
 * 접근권한없음(s0300000080)과 공유한다. 원본에서도 그 부분은 sc-if 밖에 있다.
 *
 * 버린 것 (지시서 2-5)
 *   isReset(70~81) · isSent(83~92) · isInvite(94~137)  — 화면 3종 폐기
 *   bindStrength()                                      — 초대 화면 전용 비밀번호 강도 막대
 *
 * 2-8 에서 붙인 것: 실제 제출 → `/api/auth/login` → (서버끼리) Fastify → 삐용 어댑터.
 * 이 화면은 세션을 스스로 만들지 않는다. 쿠키를 굽는 것도 route handler 쪽이다.
 *
 * ★ DS 컴포넌트를 쓰지 않은 이유 — 원본이 쓰지 않는다.
 *   템플릿의 입력은 48px·15px, 버튼은 52px 인데 DS 는 --control-h:54px 다.
 *   `.dc.html` 이 시각 기준이므로 원본 인라인 스타일을 따랐다. 이 화면에서
 *   실제로 쓰이는 DS 컴포넌트는 Icon 하나뿐이다(원본도 x-import 로 Icon 만 쓴다).
 */
import { useState } from 'react';
import { BBIYONG, LINKS } from '@swonbiz/shared';
import { Icon } from '@/components/ds';
import { AuthShell } from '@/components/patterns/AuthShell';
import styles from './login.module.css';

/** 비밀번호 재설정은 ERP 화면이 아니라 삐용으로 나간다. */
const PASSWORD_RESET_URL = `${BBIYONG.BASE_URL}${BBIYONG.PASSWORD_RESET_PATH}`;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);

  /**
   * 에러 표시 상태.
   *
   * ★★ 삐용 응답의 함정(BBIYONG-AUTH.md §2.4 함정 1) — 로그인 API 는 **HTTP 200 이어도
   *    body.status !== 200 이면 실패**다. 그 검사는 이 화면이 아니라 **삐용 어댑터**가 한다
   *    (packages/api/src/bbiyong/). 어댑터가 실패를 예외로 번역 → Fastify 401 → route handler 가
   *    message 로 바꿔 준다. 화면까지 body.status 를 들고 오면 삐용 응답 모양이 프론트로 샌다.
   *    이 화면은 상태코드와 message 만 본다.
   */
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => null);

      // ★ 여기서 res.ok 만 보고 통과시키지 않는다. 삐용 응답의 함정(위 주석)은
      //   route handler 와 Fastify 가 이미 걸러 상태코드로 번역해 주지만,
      //   화면도 body 를 확인해서 홈 경로가 실제로 왔을 때만 이동한다.
      if (!res.ok || !body?.home) {
        // 401 만 자격 증명 문제다. 나머지(503 등)는 서버가 준 문구를 쓰고, 없으면 사용자 잘못으로 돌리지 않는다.
        const fallback = res.status === 401 ? '이메일 또는 비밀번호가 올바르지 않습니다' : '로그인 처리 중 오류가 났습니다';
        setError(body?.message ?? fallback);
        return;
      }

      // ★ router.push 가 아니라 전체 이동이다. 방금 구운 세션 쿠키를 서버가
      //   첫 렌더부터 보게 하려는 것이고, 클라이언트에 남은 로그인 화면 상태도 함께 버린다.
      window.location.assign(body.home as string);
    } catch {
      setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
        <div style={{ width: 380, margin: 'auto 0' }}>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--text-h2-size)',
              fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
              lineHeight: 'var(--text-h2-lh)',
              letterSpacing: 'var(--text-h2-ls)',
              color: 'var(--text-heading)',
            }}
          >
            에스원비즈에 오신 걸 환영합니다
          </h1>

          <form onSubmit={onSubmit}>
            <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'], color: 'var(--text-heading)' }}>
                  이메일
                </span>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  className={styles.field}
                  style={{
                    height: 48,
                    padding: '0 16px',
                    fontFamily: 'inherit',
                    fontSize: 15,
                    color: 'var(--text-heading)',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    outline: 'none',
                    transition: 'border-color var(--dur) var(--ease-out),box-shadow var(--dur) var(--ease-out)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'], color: 'var(--text-heading)' }}>
                  비밀번호
                </span>
                <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    className={styles.field}
                    style={{
                      width: '100%',
                      height: 48,
                      padding: '0 48px 0 16px',
                      fontFamily: 'inherit',
                      fontSize: 15,
                      color: 'var(--text-heading)',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      outline: 'none',
                      transition: 'border-color var(--dur) var(--ease-out),box-shadow var(--dur) var(--ease-out)',
                    }}
                  />
                  {/* 원본은 data-pw-toggle 속성 + 외부 스크립트로 토글한다. React 상태로 옮겼다. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                    aria-pressed={showPassword}
                    className={styles.pwToggle}
                    style={{
                      position: 'absolute',
                      right: 14,
                      display: 'grid',
                      placeItems: 'center',
                      border: 0,
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'color var(--dur) var(--ease-out)',
                    }}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={20} />
                  </button>
                </span>
              </label>
            </div>

            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              {/*
                ★ "로그인 상태 유지" — 세션 유효기간에 **영향을 주지 않는다**.
                  지시_ERP_로그인_권한관리.md 1-5 가 "갱신 방식을 ERP 가 임의로 정하지 마라"고
                  못박았고, 현재 만료는 삐용 refresh 7일이라는 **폴백 가정**이다(회신 ⑤ 대기).
                  여기서 "30일 세션" 같은 것을 만들면 나중에 삐용 실값과 어긋난다.
                  회신 ⑤ 가 오기 전까지 이 체크박스는 서버로 넘어가지 않는다.
              */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="rememberMe"
                  style={{ width: 18, height: 18, flex: '0 0 auto', accentColor: 'var(--color-primary)' }}
                />
                <span style={{ fontSize: 14, color: 'var(--text-body)' }}>로그인 상태 유지</span>
              </label>

              {/*
                비밀번호 찾기 — 원본은 data-goto="reset" 으로 같은 템플릿의 재설정 화면을 열었다.
                ERP 는 계정을 발급하지 않으므로 그 화면(s0300000020)을 만들지 않는다.
                삐용 재설정 화면으로 나가는 외부 링크로 바꿨다. URL 은 상수에 있다.

                ★ 회신 ⑦(2026-09-08): 재설정 **딥링크가 없다.** 전용 URL 이 없고 삐용 `/SignIn`
                  하단 링크를 눌러야 모달이 뜬다. 그래서 이 링크는 삐용 로그인 화면까지만
                  데려다주고, 사용자는 거기서 한 번 더 눌러야 한다. 삐용이 진입 파라미터를
                  만들어 주기 전에는 줄일 수 없는 단계다.
              */}
              <a
                href={PASSWORD_RESET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.link}
                style={{
                  fontSize: 14,
                  color: 'var(--color-primary)',
                  textDecoration: 'none',
                  fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
                  whiteSpace: 'nowrap',
                  transition: 'color var(--dur) var(--ease-out)',
                }}
              >
                비밀번호 찾기
              </a>
            </div>

            {/* 에러 — 원본의 showError 블록. 위 useState 주석의 body.status 함정 참조. */}
            {error ? (
              <div
                role="alert"
                style={{
                  marginTop: 20,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  background: 'var(--color-danger-bg)',
                  border: '1px solid rgba(220,38,38,.3)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <span style={{ display: 'flex', color: 'var(--color-danger)', flex: '0 0 auto', marginTop: 1 }}>
                  <Icon name="circle-alert" size={16} />
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-danger)' }}>{error}</span>
              </div>
            ) : null}

            <div style={{ marginTop: 28 }}>
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className={styles.submit}
                style={{
                  width: '100%',
                  height: 52,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-primary)',
                  color: 'var(--text-on-primary)',
                  fontFamily: 'inherit',
                  fontSize: 16,
                  fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-primary)',
                  transition: 'background var(--dur) var(--ease-out)',
                }}
              >
                {/* 원본의 isLoading 블록. 스피너 애니메이션(swonSpin)은 login.module.css 에 있다. */}
                {loading ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    로그인 중…
                  </>
                ) : (
                  '로그인'
                )}
              </button>
            </div>
          </form>

          <div
            style={{
              marginTop: 32,
              paddingTop: 24,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>아직 입주사가 아니신가요?</span>
            {/* 무료 상담 신청 → 랜딩의 상담 문의 모달(s0300500010p1). 랜딩은 아직 없다. */}
            <a
              href={LINKS.CONSULT}
              className={styles.link}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 14,
                fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
                color: 'var(--color-primary)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                transition: 'color var(--dur) var(--ease-out)',
              }}
            >
              무료 상담 신청
              <Icon name="arrow-up-right" size={14} />
            </a>
          </div>
        </div>

    </AuthShell>
  );
}
