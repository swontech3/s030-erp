/**
 * 서로 안에 뜨는 모드 · 로그인 한 번 — ERP 쪽 (2026-10-22 대표 지시 「2번」)
 *
 * 입주사 = ERP 가 바깥 틀 · 비입주사 = 삐용이 바깥 틀. 다른 서비스 화면은 바깥 틀 안에 뜬다.
 * 로그인은 한 번 — 바깥 틀이 안쪽에 로그인 토큰을 넘긴다.
 *
 * ★ 토큰은 주소(URL)에 싣지 않는다 — 화면 사이 메시지(postMessage)로만
 * ★ 안쪽이 「준비됨」을 알리면 바깥이 토큰을 보낸다. 받는 쪽은 보낸 주소를 설정 목록과 대조한다
 *   (web `NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS` — 비면 주고받지 않는다)
 * ★★ 메시지 이름 · 규칙은 삐용 s02-front `src/common/embedLogin.js` 와 **같아야 한다**(저장소가 달라 두 벌이다)
 *
 * ERP 안  : 받은 토큰을 **기존 로그인 자리**(`/api/auth/login` — 서버가 삐용에 물어 확인)로 넘긴다. 새 로그인 길 없음
 * ERP 바깥 : 내 안에 뜬 삐용이 「준비됨」 → ERP 서버에서 삐용 토큰을 받아(자기 쿠키) **저장하지 않고** 바로 넘긴다
 */

export const EMBED_READY = 'embed-ready';
export const EMBED_LOGIN = 'embed-login';

/** 「준비됨」 다시 보내기 — 바깥이 아직 듣기 시작하지 않았을 수 있다(바깥이 처음 그려지며 곧바로 안쪽을 띄울 때) */
const READY_RETRY_MS = 1000;
const READY_MAX_SENDS = 10;

export interface EmbedTokens {
  accessToken: string;
  refreshToken: string;
}

/** 브라우저 창에서 쓰는 것만 — 시험에서 가짜로 바꾼다 */
export interface EmbedWindow {
  self: unknown;
  top: unknown;
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: 'message', fn: (e: MessageEventLike) => unknown): void;
  removeEventListener(type: 'message', fn: (e: MessageEventLike) => unknown): void;
  /** 「준비됨」 다시 보내기에 쓴다 — 없으면 한 번만 보낸다 */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

export interface MessageEventLike {
  origin: string;
  source: unknown;
  data: unknown;
}

/** 설정 값 → 주소 목록. 공백 · 끝의 / 정리 */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 다른 화면 안에 떠 있는가. 접근이 막히면 안에 뜬 것이다 */
export function isEmbedded(win: EmbedWindow): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** 안쪽 — 받아도 되는 토큰 메시지면 토큰 둘, 아니면 null */
export function acceptLogin(event: MessageEventLike, allowed: readonly string[], parentWin: unknown): EmbedTokens | null {
  if (!allowed.includes(event.origin) || event.source !== parentWin) return null;
  const d = asRecord(event.data);
  if (!d || d.type !== EMBED_LOGIN || !isText(d.accessToken) || !isText(d.refreshToken)) return null;
  return { accessToken: d.accessToken, refreshToken: d.refreshToken };
}

/** 바깥 — 허용 주소의 「내 안에 뜬 창」이 「준비됨」을 보냈는가 */
export function shouldAnswerReady(event: MessageEventLike, allowed: readonly string[], selfWin: unknown): boolean {
  if (!allowed.includes(event.origin) || asRecord(event.data)?.type !== EMBED_READY) return false;
  const src = event.source as { parent?: unknown } | null;
  if (!src || src === selfWin) return false;
  try {
    return src.parent === selfWin;
  } catch {
    return false;
  }
}

/**
 * ERP 가 안에 떴을 때(로그인 화면에서 부른다) — 「준비됨」을 허용 주소로만 보내고, 받은 토큰을 `login` 으로.
 * @returns 정리 함수
 */
export function startEmbedInner(opts: {
  win: EmbedWindow;
  allowed: readonly string[];
  /** 기존 로그인 자리(/api/auth/login)를 부른다 */
  login: (tokens: EmbedTokens) => Promise<unknown>;
}): () => void {
  const { win, allowed, login } = opts;
  if (allowed.length === 0 || !isEmbedded(win)) return () => {};
  let done = false;
  let timer: unknown = null;
  const stopRetry = () => {
    if (timer !== null) win.clearInterval?.(timer);
    timer = null;
  };
  const onMessage = async (event: MessageEventLike) => {
    if (done) return;
    const tokens = acceptLogin(event, allowed, win.parent);
    if (!tokens) return;
    done = true;
    stopRetry();
    await login(tokens);
  };
  win.addEventListener('message', onMessage);
  const sendReady = () => {
    for (const origin of allowed) {
      try {
        win.parent.postMessage({ type: EMBED_READY }, origin);
      } catch {
        /* 맞지 않는 주소는 브라우저가 버린다 */
      }
    }
  };
  sendReady();
  // ★ 토큰을 받을 때까지 1초마다 다시 — 최대 10번(받으면 멈춘다)
  let sent = 1;
  if (win.setInterval) {
    timer = win.setInterval(() => {
      if (sent >= READY_MAX_SENDS) {
        stopRetry();
        return;
      }
      sendReady();
      sent += 1;
    }, READY_RETRY_MS);
  }
  return () => {
    stopRetry();
    win.removeEventListener('message', onMessage);
  };
}

/**
 * ERP 가 바깥일 때(메뉴 틀에서 부른다) — 내 안에 뜬 창이 「준비됨」이면 서버에서 토큰을 받아 그 주소로만 보낸다.
 * ★ 토큰은 변수에만 잠깐 있고 저장하지 않는다.
 */
export function startEmbedOuter(opts: {
  win: EmbedWindow;
  allowed: readonly string[];
  getTokens: () => Promise<EmbedTokens | null>;
}): () => void {
  const { win, allowed, getTokens } = opts;
  if (allowed.length === 0) return () => {};
  const onMessage = async (event: MessageEventLike) => {
    if (!shouldAnswerReady(event, allowed, win.self)) return;
    const tokens = await getTokens();
    if (!tokens) return;
    (event.source as { postMessage(m: unknown, o: string): void }).postMessage(
      { type: EMBED_LOGIN, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      event.origin,
    );
  };
  win.addEventListener('message', onMessage);
  return () => win.removeEventListener('message', onMessage);
}
