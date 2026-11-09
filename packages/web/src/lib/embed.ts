/**
 * 서로 안에 뜨는 모드 · 로그인 한 번 — ERP 웹이 부르는 자리 (2026-10-22 대표 지시 「2번」).
 * 규칙 · 판정은 `@swonbiz/shared` 의 embedBridge 한 곳이다. 여기서는 브라우저 창 · 설정 · 주소만 붙인다.
 *
 * ★ `NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS` 를 **여기서 직접 읽는다** — 워크스페이스 패키지 안에서
 *   NEXT_PUBLIC 치환이 되는지 Next 문서에 없다(로그인 화면 BBIYONG_WEB_URL 주석과 같은 이유).
 *   비면 주고받지 않는다. 빌드 때 박힌다 — 바꾸면 web 을 다시 빌드한다.
 */
import {
  embedLoginTarget,
  isEmbedded,
  parseAllowedOrigins,
  startEmbedInner,
  startEmbedOuter,
  type EmbedTokens,
  type EmbedWindow,
} from '@swonbiz/shared';

const ALLOWED = parseAllowedOrigins(process.env.NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS);

const win = () => window as unknown as EmbedWindow;

/** 다른 화면 안에 떠 있는가 */
export function embeddedNow(): boolean {
  return typeof window !== 'undefined' && isEmbedded(win());
}

/**
 * 안에 뜬 로그인 화면이 토큰을 기다리는 시간. 넘으면 입력칸을 보인다(삐용 요청 2026-11-08 「예: 5초」).
 * ★ 「준비됨」 다시 보내기(1초 × 10번)보다 짧다 — 입력칸이 보인 뒤에 토큰이 와도 그대로 로그인된다.
 */
export const EMBED_WAIT_MS = 5000;

/**
 * ERP 가 안에 떴을 때(로그인 화면) — 받은 토큰을 기존 로그인 자리로. 성공하면 원래 가려던 ERP 안 주소(redirect),
 * 없거나 바깥 주소면 그 사람의 홈으로(판정은 embedLoginTarget 한 곳)
 *
 * ★ 2026-11-08 — 안에 뜬 로그인 화면은 처음에 입력칸을 감추고 「잠시만요」만 보인다(`<html data-embedded>`).
 *   `showForm` 은 입력칸을 보일 때 부른다 — ① 허용 주소가 비어 받을 길이 없을 때 바로 ② EMBED_WAIT_MS 안에
 *   토큰이 안 왔을 때 ③ 받은 토큰으로 로그인하지 못했을 때. 받는 규칙(허용 주소 · ERP 안 주소)은 그대로다.
 */
export function startInnerLogin(showForm: () => void): () => void {
  if (!embeddedNow()) return () => {};
  if (ALLOWED.length === 0) {
    showForm();
    return () => {};
  }
  let waiting: ReturnType<typeof setTimeout> | null = setTimeout(showForm, EMBED_WAIT_MS);
  const stopWaiting = () => {
    if (waiting !== null) clearTimeout(waiting);
    waiting = null;
  };
  const stopInner = startEmbedInner({
    win: win(),
    allowed: ALLOWED,
    login: async (tokens: EmbedTokens) => {
      stopWaiting(); // 받았다 — 로그인 처리 중에 입력칸이 튀어나오지 않게
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
        });
        const body = (await res.json().catch(() => null)) as { home?: string } | null;
        if (res.ok && body?.home) {
          window.location.assign(embedLoginTarget(window.location.search, body.home));
          return;
        }
      } catch {
        /* 아래에서 입력칸을 보인다 */
      }
      showForm();
    },
  });
  return () => {
    stopWaiting();
    stopInner();
  };
}

/** ERP 가 바깥일 때(메뉴 틀) — 내 안에 뜬 창이 「준비됨」이면 서버에서 받은 삐용 토큰을 넘긴다(저장하지 않는다) */
export function startOuterLogin(): () => void {
  return startEmbedOuter({
    win: win(),
    allowed: ALLOWED,
    getTokens: async () => {
      const res = await fetch('/api/auth/bbiyong-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as Partial<EmbedTokens> | null;
      return body?.accessToken && body.refreshToken
        ? { accessToken: body.accessToken, refreshToken: body.refreshToken }
        : null;
    },
  });
}
