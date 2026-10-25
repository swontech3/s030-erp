/**
 * HttpBbiyongAuth — 삐용 로그인 API 실구현 (회신 ⑦, 2026-09-08).
 *
 * `MockBbiyongAuth` 와 같은 인터페이스를 구현한다. 바깥 코드(라우트·세션 저장소)는
 * 어느 쪽이 꽂혀 있는지 모른다 — 그게 이 어댑터 경계의 목적이다.
 *
 * =============================================================================
 * ★★ 이 파일이 지키는 함정 3개
 * =============================================================================
 * ① **실패도 성공도 HTTP 200 이다.** 삐용은 `CustomResponse.fail()` 을
 *    `ResponseEntity.ok()` 로 감싼다. `res.ok` 만 보면 실패한 로그인이 통과한다.
 *    성공 조건은 `HTTP 200 && body.result === 'success' && body.status === 200` 셋 다.
 * ② **실패 사유 필드명이 `massage` 다.** 오타지만 실제 필드명이고, `message` 로 읽으면
 *    항상 undefined 라 조용히 죽는다. 타입으로 박아 둔다.
 * ③ **orgId 는 응답 본문에만 있다.** JWT 페이로드에는 `sub`·`auth`·`exp` 셋뿐이다.
 *    토큰을 디코드해도 안 나오므로 로그인 시점에 받아 세션에 보관해야 한다.
 *
 * 그리고 넷째: **만료 시간을 코드에 박지 않는다.** access 30분·refresh 7일은 삐용의
 * 폴백값이고 개발계·가동계가 각 DB 의 `code010` 으로 분리돼 값이 다를 수 있다.
 * 이 파일 어디에도 30분은 없다 — 401 을 받으면 `reIssue()` 로 갱신한다.
 */
import { BBIYONG } from '@swonbiz/shared';
import {
  BbiyongAuthError,
  BbiyongReloginRequiredError,
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
  RELOGIN_MESSAGE,
  type BbiyongAuth,
  type BbiyongLoginResult,
  type BbiyongProfile,
  type MyMenusOutcome,
} from './types.ts';

export { INVALID_CREDENTIALS_MESSAGE, ORG_SELECT_MESSAGE, RELOGIN_MESSAGE } from './types.ts';

export type ReIssueOutcome =
  | { kind: 'success'; accessToken: string }
  | { kind: 'fail'; errorCode: string | null; serverMessage: string | null };

// =============================================================================
// 파싱 — 순수 함수. 네트워크를 타지 않으므로 응답 예시로 전부 시험할 수 있다.
// =============================================================================

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 로그에 남길 실패 사유.
 *
 * `massage` 는 오타가 아니라 실제 필드명이다 — 최상위 `message` 는 보지 않는다.
 * ★ 다만 **`data.message` 는 본다.** 2026-09-08 개발계 실물 응답이 이랬다:
 *     { massage: '로그인 실패', data: { code: 'A005', message: '가입된 이메일 정보가 없습니다.' } }
 *   `massage` 만 읽으면 로그에 "로그인 실패"만 남아 원인을 알 수 없다.
 *   ★★ 이 값은 **로그 전용**이다. 사용자에게는 어느 쪽도 보여주지 않는다 —
 *      "가입된 이메일 정보가 없습니다"는 계정 존재 여부를 그대로 알려주는 문구다.
 */
function readMassage(root: Record<string, unknown> | null): string | null {
  const parts = [str(root?.massage), str(asRecord(root?.data)?.message)].filter((v): v is string => v !== null);
  return parts.length > 0 ? parts.join(' / ') : null;
}

/**
 * 오류 코드. 회신 예시는 최상위 `error` 였지만 실물은 `data.code` 였고, 최상위 `error` 는
 * **빈 배열**이었다. 둘 다 본다.
 */
function readErrorCode(root: Record<string, unknown> | null): string | null {
  return str(root?.error) ?? str(asRecord(root?.data)?.code);
}

function failOf(root: Record<string, unknown> | null): { kind: 'fail'; errorCode: string | null; serverMessage: string | null } {
  return { kind: 'fail', errorCode: readErrorCode(root), serverMessage: readMassage(root) };
}

/**
 * 정수 필드. 숫자와 숫자문자열만 받는다.
 *
 * ★ 성공 판정(`status`)에는 이런 관대함을 두지 않는다 — 판정은 엄격하게, 식별자는
 *   너그럽게. 삐용이 어느 날 memberId 를 문자열로 주기 시작해도 로그인이 죽지 않되,
 *   `status: '200'` 같은 값이 성공 게이트를 넘지는 못한다.
 */
function toInt(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 표시용 값. 없어도 로그인은 된다 — 헤더에 이름이 안 뜰 뿐이다. */
function toDisplayString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** my-orgs 에서 꺼낸 「지금 계정」 — 삐용이 토큰으로 확인해 준 값이다. */
export interface MyOrgsCurrent {
  memberId: number;
  orgId: number;
  memberName: string;
  orgName: string;
}

/**
 * GET /rest/v1/s021200010/my-orgs 의 응답 본문 → 지금 토큰의 계정(current:true 한 줄).
 *
 * ★ 로그인 확인용이다(규격서 Q6 · 2026-10-22). 삐용은 토큰으로 「지금 계정」을 알아내
 *   같은 이메일의 회사 계정 목록을 주고, 그중 지금 계정에 current:true 를 붙인다.
 * ★ 함정 ①이 여기에도 있다 — 성공은 `result === 'success' && status === 200` 셋 다.
 * ★ 어떤 입력에도 던지지 않는다. 확인할 수 없으면 null 이다.
 */
export function parseMyOrgs(body: unknown): MyOrgsCurrent | null {
  const root = asRecord(body);
  if (!root || root.result !== 'success' || root.status !== 200 || !Array.isArray(root.data)) return null;
  const row = root.data.map(asRecord).find((r) => r?.current === true);
  if (!row) return null;
  const memberId = toInt(row.memberId);
  const orgId = toInt(row.orgId);
  if (memberId === null || orgId === null) return null;
  return { memberId, orgId, memberName: toDisplayString(row.memberName), orgName: toDisplayString(row.orgName) };
}

/**
 * GET /rest/v1/auth/re-issue 의 응답 본문. 함정 ①이 여기에도 그대로 있다 —
 * 갱신 실패도 HTTP 200 이고 본문 `status` 가 400 이다.
 *
 * refresh 는 **회전하지 않는다**. access 만 새로 나온다.
 */
export function parseReIssue(body: unknown): ReIssueOutcome {
  const root = asRecord(body);
  if (!root) return failOf(null);
  if (root.result !== 'success' || root.status !== 200) return failOf(root);

  const data = asRecord(root.data);
  const accessToken = str(data?.accessToken);
  if (accessToken === null) return failOf(root);
  return { kind: 'success', accessToken };
}

/**
 * GET /rest/v1/s021000000/my-menus 의 응답 본문(연동규격 §1-5). 함정 ①이 여기에도 있다 —
 * 성공은 `result === 'success' && status === 200` 이고 `data` 가 화면코드 배열이다.
 * 그 밖은 전부 `rejected`(입구 거절 `AUTHZ_DENY` 도 HTTP 200 · 본문 403 으로 온다).
 */
export function parseMyMenus(body: unknown): MyMenusOutcome {
  const root = asRecord(body);
  if (!root || root.result !== 'success' || root.status !== 200 || !Array.isArray(root.data)) {
    return { kind: 'rejected' };
  }
  // ★ 2026-10-25 — 삐용 응답은 객체 배열(`{ menuCode, keys, … }` · 규격서 §1-5 2026-10-03 바뀜)이다.
  //   옛 모양(화면코드 문자열 배열)도 그대로 받는다. 연계 시험으로 찾아 삐용 쪽이 고쳤다
  const screens = root.data
    .map((v) => (typeof v === 'string' ? v : asRecord(v)?.menuCode))
    .filter((v): v is string => typeof v === 'string');
  return { kind: 'ok', screens };
}

// =============================================================================
// 어댑터
// =============================================================================

/**
 * 로그·에러 메시지에서 URL 과 JWT 를 지운다.
 *
 * ★★ `/re-issue` 는 access·refresh 토큰 2개를 **쿼리스트링**으로 받는다. undici 는 실패한
 *    요청 URL 을 예외 메시지에 그대로 붙이므로, 그 예외를 그대로 로깅하면 ERP 로그에
 *    토큰 평문이 남는다. 서버 대 서버라 브라우저 히스토리는 무관하지만 로그는 남는다.
 */
function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_.-]{6,}/g, '<token>');
}

export interface HttpBbiyongAuthOptions {
  baseUrl: string;
  /** 시험에서 갈아 끼운다. 운영에서는 전역 fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpBbiyongAuth implements BbiyongAuth {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  /**
   * 표시정보 캐시 — memberId → 이름·단체명.
   *
   * ★ 삐용에 회원 표시정보 조회 엔드포인트가 없다(회신 ⑦에 없음). 그래서 로그인 응답에
   *   실려 온 값을 **프로세스 메모리에만** 들고 있는다. ERP DB 에 복사하지 않는 이유는
   *   types.ts 의 getProfile 주석에 있다 — 삐용에서 이름이 바뀌면 ERP 만 옛 이름을 들고
   *   있게 되고 그 어긋남은 추적되지 않는다.
   *
   *   한계: API 를 재기동하면 비어 있다. 그 세션의 헤더는 다시 로그인할 때까지 이름이
   *   빈칸으로 뜬다(표시 전용이라 권한·스코프에는 영향이 없다). 삐용에 조회 엔드포인트를
   *   요청해 둔 상태다 — doc/BBIYONG_REPLY_PHASE1.md 참고.
   */
  readonly #profiles = new Map<number, BbiyongProfile>();

  constructor(opts: HttpBbiyongAuthOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /**
   * 삐용 토큰 → 확인된 로그인 값 (규격서 Q6 · 2026-10-22). ERP 서버는 비밀번호를 받지 않는다.
   *
   * ★ 토큰은 **머리글로만** 싣는다 — 주소(쿼리)에 실으면 중계 로그에 평문으로 남는다.
   * ★ 회사 구분(orgTp)은 my-orgs 응답에 없어 null 이다 — 브라우저가 보낸 값은 믿지 않는다(대표 결정 A).
   */
  async verifySession(accessToken: string, refreshToken: string): Promise<BbiyongLoginResult> {
    let body: unknown;
    try {
      body = await this.#call(
        `${this.#baseUrl}${BBIYONG.MY_ORGS_PATH}`,
        { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
        'my-orgs',
      );
    } catch (err) {
      // 가짜 · 만료 토큰 — 인증 실패다. 연결 실패(BbiyongUnavailableError)는 그대로 올린다.
      if (err instanceof BbiyongTokenExpiredError) throw new BbiyongAuthError(RELOGIN_MESSAGE);
      throw err;
    }

    const me = parseMyOrgs(body);
    if (!me) {
      console.warn('[bbiyong] my-orgs 로 지금 계정을 확인하지 못했다 — 세션을 만들지 않는다');
      throw new BbiyongAuthError(RELOGIN_MESSAGE);
    }

    this.#profiles.set(me.memberId, { memberName: me.memberName, orgName: me.orgName, orgTp: null });
    return { ...me, orgTp: null, accessToken, refreshToken };
  }

  /**
   * 삐용 세션 1건 삭제. **실패해도 던지지 않는다** — ERP 세션은 호출 전에 이미 폐기됐고
   * (routes/auth.ts 의 순서), 여기서 던지면 로그아웃 응답이 500 이 된다.
   */
  async signOut(refreshToken: string): Promise<void> {
    try {
      // ★ 토큰은 헤더로만 보낸다. 쿼리스트링에 실으면 중계 로그에 평문으로 남는다.
      await this.#call(
        `${this.#baseUrl}${BBIYONG.SIGN_OUT_PATH}`,
        { method: 'POST', headers: { 'refresh-token': refreshToken } },
        'sign-out',
      );
    } catch (err) {
      console.warn(`[bbiyong] sign-out 실패(무시): ${redact((err as Error).message)}`);
    }
  }

  /** 로그인 때 받아 둔 표시값. 없으면 null — 화면은 빈 이름으로 버틴다. */
  async getProfile(memberId: number): Promise<BbiyongProfile | null> {
    return this.#profiles.get(memberId) ?? null;
  }

  /**
   * access 토큰 갱신. **만료 시각을 계산하지 않는다** — 삐용을 부르다 401 을 받으면
   * 이걸 부른다. 30분은 폴백값이고 개발계·가동계가 다를 수 있다(회신 §6).
   *
   * ⚠️ 토큰 2개가 쿼리스트링에 실린다. 삐용 규격이라 바꿀 수 없고, ERP 는 이 URL 을
   *    로그에 남기지 않는 것으로 대응한다(`redact`).
   *
   * ★ 부르는 자리는 `session/bbiyongToken.ts` 의 `withFreshAccess` 하나다(2026-09-30).
   *   그 전까지는 이 메서드가 **인터페이스에 없어서 아무도 부를 수 없었다.**
   */
  async reIssue(accessToken: string, refreshToken: string): Promise<string> {
    const url = new URL(`${this.#baseUrl}${BBIYONG.REFRESH_PATH}`);
    url.searchParams.set('access-token', accessToken);
    url.searchParams.set('refresh-token', refreshToken);

    let body: unknown;
    try {
      body = await this.#call(url.toString(), { method: 'GET' }, 're-issue');
    } catch (err) {
      // ★★ **재발급 요청 자체가 401 이면 refresh 도 죽은 것이다.** 여기서 만료 예외를
      //    그대로 올려보내면 호출자가 「또 재발급하면 되겠지」로 읽고 무한히 돈다.
      //    되살릴 수 없다는 사실을 타입으로 못박아 재로그인으로 보낸다.
      if (err instanceof BbiyongTokenExpiredError) {
        console.warn('[bbiyong] re-issue 가 401 — refresh 토큰도 만료됐다. 재로그인만 남았다');
        throw new BbiyongReloginRequiredError();
      }
      throw err;
    }

    const out = parseReIssue(body);
    if (out.kind === 'fail') {
      console.warn(`[bbiyong] re-issue 실패 code=${out.errorCode ?? '-'} massage=${out.serverMessage ?? '-'}`);
      // 갱신 실패는 재로그인으로 보낸다 — 세션을 되살릴 방법이 없다.
      throw new BbiyongReloginRequiredError();
    }
    return out.accessToken;
  }

  /**
   * 내 메뉴 — 받은 토큰 그대로 부른다(재발급 없음, `BbiyongAuth.myMenus`).
   * ★ 401 은 그 토큰이 만료 · 무효라는 뜻이라 `rejected` 다. HTTP 403(삐용 입구가 토큰을 못 받음 —
   *   연동규격 §1 「토큰을 안 실으면 403」)도 `rejected` 다. 연결 문제만 던진다.
   */
  async myMenus(accessToken: string): Promise<MyMenusOutcome> {
    let body: unknown;
    try {
      body = await this.#call(
        `${this.#baseUrl}${BBIYONG.MY_MENUS_PATH}`,
        { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
        'my-menus',
      );
    } catch (err) {
      if (err instanceof BbiyongTokenExpiredError) return { kind: 'rejected' };
      if (err instanceof BbiyongUnavailableError && err.httpStatus === 403) return { kind: 'rejected' };
      throw err;
    }
    return parseMyMenus(body);
  }

  /**
   * 호출 + JSON 파싱. 던지는 것은 `BbiyongUnavailableError` 뿐이다 —
   * **연결·규격 문제를 인증 실패로 번역하지 않는다.** 401 로 내려보내면 삐용 장애가
   * "비밀번호가 틀렸습니다"로 보이고, 사용자는 멀쩡한 비밀번호를 계속 다시 친다.
   */
  async #call(url: string, init: RequestInit, label: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (err) {
      // ★ 원문 메시지를 그대로 붙이지 않는다 — URL(=토큰·비밀번호)이 들어 있다.
      throw new BbiyongUnavailableError(`삐용 ${label} 호출 실패: ${redact((err as Error).message)}`);
    }

    // ★★ **401 만은 인프라 문제가 아니다 — 토큰이 만료·무효라는 뜻이다**(2026-09-30).
    //    이것을 아래 `BbiyongUnavailableError` 로 뭉개던 것이 「토큰이 만료되면 화면에
    //    〈서버에 연결할 수 없습니다〉가 뜬다」의 원인이었다. 삐용은 살아 있고,
    //    필요한 것은 재발급 한 번이다(`withFreshAccess`).
    //    ★ 삐용 규격상 401 은 **토큰을 싣는 호출**에만 온다 — 로그인 실패는 HTTP 200 이고
    //      토큰을 아예 안 실으면 403 이다(연동규격 §2 표).
    if (res.status === 401) {
      throw new BbiyongTokenExpiredError(`삐용 ${label} 이 401 — access 토큰이 만료됐다`);
    }

    // 나머지 HTTP 비정상은 삐용의 업무 실패가 아니라 인프라 문제다(업무 실패는 200 으로 온다).
    if (!res.ok) throw new BbiyongUnavailableError(`삐용 ${label} 이 HTTP ${res.status} 로 응답했다`, res.status);

    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // 본문을 메시지에 담지 않는다. 프록시 오류 페이지가 무엇을 담고 있을지 모른다.
      throw new BbiyongUnavailableError(`삐용 ${label} 응답이 JSON 이 아니다 (${text.length}바이트)`);
    }
  }
}
