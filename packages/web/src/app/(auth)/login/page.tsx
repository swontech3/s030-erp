'use client';

/** @screen s030000010 로그인 · 000 공통 · 1차 */

/**
 * 로그인 화면 — 원본: design/erp-auth/ErpAuth.dc.html 의 isLogin 블록(23~67행).
 * 바깥 껍데기(좌 44% + 로고)와 우측 브랜드 패널은 AuthShell 로 뺐다 —
 * 접근권한없음(s030000080)과 공유한다. 원본에서도 그 부분은 sc-if 밖에 있다.
 *
 * 버린 것 (지시서 2-5)
 *   isReset(70~81) · isSent(83~92) · isInvite(94~137)  — 화면 3종 폐기
 *   bindStrength()                                      — 초대 화면 전용 비밀번호 강도 막대
 *
 * 2-8 에서 붙인 것: 실제 제출 → `/api/auth/login` → (서버끼리) Fastify → 삐용 어댑터.
 * 이 화면은 세션을 스스로 만들지 않는다. 쿠키를 굽는 것도 route handler 쪽이다.
 *
 * 2026-10-05 에 붙인 것: 「비밀번호를 잊으셨나요?」 **펼침 안내**. 삐용은 직원을
 * 등록해도 초기화 메일을 **자동으로 보내지 않고**, ERP 에는 보내는 API 가 없다
 * (회신 2026-10-05) — 직원이 삐용 화면에서 직접 [링크 받기] 를 눌러야 한다. 그 사실과
 * 유효시간·재요청 규칙을 가기 전에 읽히는 것이 그 블록의 목적이다. 주소는 환경변수다
 * (`BBIYONG_WEB_URL` 주석 참조).
 *
 * ★ 같은 날 늦게, 삐용이 **진입 파라미터 `?reset=1`** 을 만들어 줬다. 이제 링크를
 *   누르면 삐용 화면에서 초기화 모달이 **바로 열린다** — 거기서 한 번 더 누르던
 *   단계가 없어졌다. 안내 문구도 그에 맞게 고쳤다(`BBIYONG.PASSWORD_RESET_PATH`).
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

/**
 * 삐용 **화면** 주소 — 비밀번호 초기화가 그 화면에서만 되기 때문에 필요하다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★★★ `NEXT_PUBLIC_` 접두사가 **필수다** · 기본값은 **두지 않는다**
 * ══════════════════════════════════════════════════════════════════════════
 * 이 파일은 `'use client'` 다. 접두사가 없는 환경변수는 Next 가 클라이언트 번들에서
 * `undefined` 로 치환한다 — 2026-10-05 까지 이 링크가 바로 그 상태였다:
 * `BBIYONG.BASE_URL`(= `BBIYONG_BASE_URL`, 삐용 **API** `:8082`)로 만들었는데
 * 브라우저에서는 그 변수가 사라져 **기본값 `https://bbiyong.s-wontech.co.kr` 로만**
 * 나갔다. 주소가 애초에 화면도 아니었다(화면은 `:3000`).
 *
 * ★ **기본값을 두지 않는다**(결정 2026-10-05). 주소를 모르면 **링크를 걸지 않는다** —
 *   짐작한 주소를 걸면 사용자는 엉뚱한 곳에 도착하고 아무도 그 사실을 모른다.
 *   비어 있으면 아래 안내가 링크 대신 「운영사에 문의」를 보여 준다.
 *
 * ★ `process.env.NEXT_PUBLIC_…` 을 **여기서 직접 읽는다.** `@swonbiz/shared` 에 두지
 *   않은 이유는 그쪽 `constants.ts` 주석에 있다(워크스페이스 패키지까지 치환되는지
 *   Next 문서에 없다 — 안 되면 값이 조용히 비어 링크가 영영 안 뜬다).
 *
 * ★★ 계통을 바꾸면 **web 을 다시 빌드해야 한다.** `NEXT_PUBLIC_*` 은 빌드 때 값이
 *    박히고 그 뒤에는 환경변수를 바꿔도 반응하지 않는다(Next 16.3.4 문서 §Bundling
 *    Environment Variables for the Browser). API 쪽 변수처럼 재기동만으로는 안 바뀐다.
 */
const BBIYONG_WEB_URL = process.env.NEXT_PUBLIC_BBIYONG_WEB_URL ?? '';

/**
 * 삐용 로그인 화면 + 초기화 모달을 바로 여는 파라미터(`/SignIn?reset=1`).
 * ★ 쿼리는 상수 쪽에 들어 있다 — 여기서 덧붙이지 않는다(`constants.ts` 주석).
 */
const PASSWORD_RESET_URL = BBIYONG_WEB_URL ? `${BBIYONG_WEB_URL}${BBIYONG.PASSWORD_RESET_PATH}` : '';

/** 펼침 안내의 id — 버튼의 `aria-controls` 와 한 쌍이다. */
const RESET_HELP_ID = 'login-reset-help';

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  /**
   * 비밀번호 초기화 안내를 펼쳤는가.
   *
   * ★ 왜 펼침인가 — 삐용은 초기화 메일을 **자동으로 보내지 않는다**(회신 2026-10-05).
   *   사용자가 삐용 화면에서 **직접 [링크 받기] 를 눌러야** 하고, 유효시간·재요청
   *   규칙을 모르면 헤맨다. 눌렀을 때 그 설명을 먼저 보여 준다 — 늘 띄우면 로그인
   *   화면이 길어지고, 안내가 필요 없는 사람에게도 매번 보인다.
   *
   * ★ `?reset=1` 이 생겨 모달까지는 바로 가지만(2026-10-05), 그래도 **안내는 남긴다** —
   *   줄어든 것은 「한 번 더 누르기」뿐이고, 유효시간·재요청·스팸함·아이디 찾기 불가는
   *   그대로 모르면 헤매는 것들이다.
   */
  const [resetOpen, setResetOpen] = useState(false);

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
                ERP 는 계정을 발급하지 않으므로 그 화면(s030000020)을 만들지 않는다.

                ★★ **바로 삐용으로 보내지 않고 안내를 먼저 펼친다**(2026-10-05). 삐용은
                  초기화 **메일을 자동으로 보내지 않는다**(회신 2026-10-05) — 사용자가
                  삐용 화면에서 직접 [링크 받기] 를 눌러야 하고, 유효시간·재요청 규칙을
                  모르면 헤맨다. 그 설명을 가기 전에 읽히는 것이 이 펼침의 목적이다.
                  (`?reset=1` 로 모달까지는 바로 열린다 — 줄어든 것은 거기서 한 번 더
                  누르던 단계뿐이다.)
              */}
              <button
                type="button"
                onClick={() => setResetOpen((v) => !v)}
                aria-expanded={resetOpen}
                aria-controls={RESET_HELP_ID}
                className={styles.link}
                style={{
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  color: 'var(--color-primary)',
                  fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'color var(--dur) var(--ease-out)',
                }}
              >
                비밀번호를 잊으셨나요?
              </button>
            </div>

            {/*
              ══════════════════════════════════════════════════════════════════
              비밀번호 초기화 안내 (삐용 회신 2026-10-05)
              ══════════════════════════════════════════════════════════════════
              ★ ERP 에는 **보내는 API 가 없다.** 직원을 등록해도 메일이 자동으로 나가지
                않고, 직원이 삐용 화면에서 직접 [링크 받기] 를 눌러야 링크 메일이 간다.
              ★ 아래 링크는 `?reset=1` 이라 **모달이 바로 열린다**(2026-10-05 확인).
                그래서 안내 첫 줄이 「창이 열립니다」로 시작한다 — 사람이 보게 될 다음
                화면을 먼저 말해 주는 것이 순서다.
              ★ 유효시간·재요청 규칙은 **삐용이 정한 값**을 그대로 적는다. ERP 코드가
                그 시간을 쓰는 곳은 없다 — 적어 두는 것은 사람을 위한 안내일 뿐이다.
              ★★ 아이디(이메일) 찾기를 **일부러 적었다.** 삐용 화면에 「메일 주소 찾기」
                 버튼이 **보이는데**, 2026-10-05 에 열어 보니 그건 단체명·대표자명·휴대폰
                 으로 조회하는 **대표자 기준**이라 직원은 자기 이메일을 찾을 수 없다.
                 안 적으면 운영자가 보이는 버튼을 눌러 보며 헤맨다.
            */}
            {resetOpen ? (
              <div
                id={RESET_HELP_ID}
                style={{
                  marginTop: 14,
                  padding: '14px 16px',
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
                    color: 'var(--text-heading)',
                  }}
                >
                  비밀번호는 삐용에서 초기화합니다
                </p>
                <ul
                  style={{
                    margin: '8px 0 0',
                    paddingLeft: 18,
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: 'var(--text-body)',
                  }}
                >
                  {/*
                    ★ 첫 줄은 **주소가 있을 때만** 나온다. 주소가 없으면 아래에 링크 대신
                      「운영사에 문의」가 뜨므로 「누르면 열립니다」가 가리킬 데가 없다.
                  */}
                  {PASSWORD_RESET_URL ? (
                    <li>아래 「삐용에서 초기화하기」를 누르면 초기화 창이 바로 열립니다.</li>
                  ) : null}
                  {/*
                    ★★ 「아래쪽 칸」을 **짚어 준다.** 그 창은 위에 「메일찾기」(단체명·
                       대표자명·휴대폰), 아래에 「비밀번호 초기화」(이메일) 두 칸이 쌓여
                       있고, 열면 위 칸이 먼저 보인다 — 짚지 않으면 거기에 입력한다.
                  */}
                  <li>
                    창 <strong>아래쪽</strong> 「비밀번호 초기화」 칸에 이메일을 넣고 [링크 받기]
                    를 누르면 초기화 링크가 메일로 갑니다.
                  </li>
                  <li>링크 유효시간은 처음 설정 24시간, 다시 설정 30분입니다.</li>
                  <li>다시 요청하면 이전 링크는 무효입니다. 마지막에 받은 메일을 쓰세요.</li>
                  <li>
                    메일이 안 보이면 스팸함도 확인해 주세요. 발신 주소는{' '}
                    <span style={{ whiteSpace: 'nowrap' }}>noreply@s-wontech.co.kr</span> 입니다.
                  </li>
                  <li>
                    아이디는 가입하신 이메일 주소입니다. 삐용의 「메일 주소 찾기」는 대표자
                    기준(단체명·대표자명·휴대폰) 조회라 직원은 찾을 수 없습니다 — 기억나지
                    않으면 운영사에 문의해 주세요.
                  </li>
                </ul>

                {/*
                  ★ 주소가 비어 있으면 **링크를 걸지 않는다**(위 `BBIYONG_WEB_URL` 주석).
                    가동계 주소는 아직 받지 못했다 — 받으면 환경변수만 채운다.
                */}
                {PASSWORD_RESET_URL ? (
                  <a
                    href={PASSWORD_RESET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.link}
                    style={{
                      marginTop: 12,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 14,
                      fontWeight: 'var(--weight-bold)' as React.CSSProperties['fontWeight'],
                      color: 'var(--color-primary)',
                      textDecoration: 'none',
                      transition: 'color var(--dur) var(--ease-out)',
                    }}
                  >
                    삐용에서 초기화하기
                    <Icon name="arrow-up-right" size={14} />
                  </a>
                ) : (
                  <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                    삐용 로그인 화면 주소가 아직 설정되지 않았습니다. 운영사에 문의해 주세요.
                  </p>
                )}
              </div>
            ) : null}

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
            {/* 무료 상담 신청 → 랜딩의 상담 문의 모달(s030500010p1). 랜딩은 아직 없다. */}
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
