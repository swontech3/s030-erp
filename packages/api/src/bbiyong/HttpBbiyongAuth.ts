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
  BbiyongOrgSelectRequiredError,
  BbiyongUnavailableError,
  INVALID_CREDENTIALS_MESSAGE,
  ORG_SELECT_MESSAGE,
  type BbiyongAuth,
  type BbiyongLoginResult,
  type BbiyongProfile,
} from './types.ts';

export { INVALID_CREDENTIALS_MESSAGE, ORG_SELECT_MESSAGE } from './types.ts';

/** 삐용 응답 하나를 해석한 결과. 성공만이 토큰을 들고 있다. */
export type SignInOutcome =
  | { kind: 'success'; result: BbiyongLoginResult }
  /** 겸직 — 토큰 대신 단체 선택 목록이 왔다. ★ selectToken 은 담지 않는다(3분 유효). */
  | { kind: 'orgSelect'; candidateCount: number }
  | { kind: 'fail'; errorCode: string | null; serverMessage: string | null };

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

/**
 * POST /rest/v1/s021200010/sign-in 의 응답 본문을 해석한다.
 *
 * ★ 어떤 입력이 와도 예외를 던지지 않는다. 깨진 응답은 `fail` 이다 — 파싱 예외가
 *   그대로 올라가면 로그인 화면에 "서버 오류"가 뜨고, 진짜 원인은 로그 안에 묻힌다.
 */
export function parseSignIn(body: unknown): SignInOutcome {
  const root = asRecord(body);
  if (!root) return failOf(null);

  const data = asRecord(root.data);

  // ★ 겸직 판정을 성공 게이트보다 **먼저** 한다.
  //   회신에는 needOrgSelect 응답의 result·status 가 명시돼 있지 않다. 이 응답이 혹시
  //   result:'fail' 로 온다면, 게이트를 먼저 통과시킬 경우 겸직 계정이 "비밀번호가
  //   틀렸습니다"로 뭉개진다 — 회신 §4 가 "조용히 실패하면 안 된다"고 못박은 바로 그 경우다.
  //   이 가지는 토큰을 만들지 않으므로 순서를 앞당겨도 인증이 느슨해지지 않는다.
  //   판정은 값이 아니라 **존재 여부**로 한다(회신 §4).
  if (data && Object.hasOwn(data, 'needOrgSelect')) {
    return { kind: 'orgSelect', candidateCount: Array.isArray(data.candidates) ? data.candidates.length : 0 };
  }

  // ★★ 성공 게이트. 셋 다 맞아야 한다.
  if (root.result !== 'success' || root.status !== 200) return failOf(root);
  if (!data) return failOf(root);

  const memberId = toInt(data.memberId);
  const orgId = toInt(data.orgId);
  const orgTp = str(data.orgTp);
  const accessToken = str(data.accessToken);
  const refreshToken = str(data.refreshToken);

  // 하나라도 없으면 반쪽 세션이 된다. orgId 가 없으면 스코프를 해석할 수 없고,
  // orgTp 가 없으면 운영사·입주사를 가를 수 없다. 만들다 만 세션보다 실패가 낫다.
  if (memberId === null || orgId === null || orgTp === null || accessToken === null || refreshToken === null) {
    return failOf(root);
  }

  return {
    kind: 'success',
    result: {
      memberId,
      orgId,
      orgTp,
      memberName: toDisplayString(data.memberName),
      orgName: toDisplayString(data.orgName),
      accessToken,
      refreshToken,
    },
  };
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

  async signIn(email: string, password: string): Promise<BbiyongLoginResult> {
    // 필드명은 `pwd` 다. 평문으로 나가지만 그건 삐용 규격이고, 전송 구간은 TLS 가 맡는다.
    const body = await this.#call(
      `${this.#baseUrl}${BBIYONG.LOGIN_PATH}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, pwd: password }) },
      'sign-in',
    );

    const out = parseSignIn(body);

    if (out.kind === 'orgSelect') {
      // ★ 조용히 실패시키지 않는다. 이 줄이 로그에 찍히면 2단계 로그인 팝업(s0300000010p1)을
      //   만들 때가 된 것이다. 이메일을 남기는 것은 이 경로만이다 — 자격 증명은 이미
      //   통과했고(계정 열거가 아니다), 누구를 도와줘야 하는지 알아야 한다.
      console.warn(
        `[bbiyong] needOrgSelect — 겸직 계정 로그인 시도: ${email} (후보 ${out.candidateCount}개). ` +
          '2단계 로그인 팝업 s0300000010p1 이 필요하다는 신호다.',
      );
      throw new BbiyongOrgSelectRequiredError(ORG_SELECT_MESSAGE, out.candidateCount);
    }

    if (out.kind === 'fail') {
      // 실패 경로에는 이메일을 남기지 않는다 — 로그가 계정 목록이 된다.
      // 삐용은 "이메일 없음"과 "비밀번호 틀림"을 둘 다 A005 로 준다(회신 §7).
      console.warn(`[bbiyong] sign-in 실패 code=${out.errorCode ?? '-'} massage=${out.serverMessage ?? '-'}`);
      throw new BbiyongAuthError(INVALID_CREDENTIALS_MESSAGE);
    }

    this.#profiles.set(out.result.memberId, {
      memberName: out.result.memberName,
      orgName: out.result.orgName,
      orgTp: out.result.orgTp,
    });
    return out.result;
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
   * ★ 아직 호출자가 없다 — 페이즈 1 은 삐용 API 를 로그인·로그아웃에만 쓴다.
   *   HttpBbiyongAcl(회신 ⑫)이 붙어 삐용에 인증 요청을 보내기 시작하면 그 401 처리에서
   *   이 메서드를 부른다. 파싱 함정이 sign-in 과 같아서 지금 같이 시험해 둔다.
   */
  async reIssue(accessToken: string, refreshToken: string): Promise<string> {
    const url = new URL(`${this.#baseUrl}${BBIYONG.REFRESH_PATH}`);
    url.searchParams.set('access-token', accessToken);
    url.searchParams.set('refresh-token', refreshToken);

    const body = await this.#call(url.toString(), { method: 'GET' }, 're-issue');
    const out = parseReIssue(body);
    if (out.kind === 'fail') {
      console.warn(`[bbiyong] re-issue 실패 code=${out.errorCode ?? '-'} massage=${out.serverMessage ?? '-'}`);
      // 갱신 실패는 재로그인으로 보낸다 — 세션을 되살릴 방법이 없다.
      throw new BbiyongAuthError('세션이 만료되었습니다. 다시 로그인해 주세요');
    }
    return out.accessToken;
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

    // HTTP 비정상은 삐용의 업무 실패가 아니라 인프라 문제다(업무 실패는 200 으로 온다).
    if (!res.ok) throw new BbiyongUnavailableError(`삐용 ${label} 이 HTTP ${res.status} 로 응답했다`);

    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // 본문을 메시지에 담지 않는다. 프록시 오류 페이지가 무엇을 담고 있을지 모른다.
      throw new BbiyongUnavailableError(`삐용 ${label} 응답이 JSON 이 아니다 (${text.length}바이트)`);
    }
  }
}
