/**
 * HttpBbiyongOrg — 삐용 회사 등록 실구현 (연동규격 §2, 3-5).
 *
 * `MockBbiyongOrg` 와 같은 인터페이스다. 그 앞의 코드(채번 · 중복 재시도 · 연결 저장 ·
 * 실패 보관 · 화면 배너)는 하나도 바뀌지 않는다 — 이 파일은 **HTTP 왕복과 응답 해석만**
 * 한다. 그래서 `createOrg` 바깥에 업무 판단이 없다.
 *
 * =============================================================================
 * ★★ 이 파일이 지키는 함정 4개
 * =============================================================================
 * ① **실패도 HTTP 200 이다.** 삐용은 `CustomResponse.fail()` 을 `ResponseEntity.ok()` 로
 *    감싼다. `res.ok` 만 보면 만들어지지 않은 회사가 성공으로 보이고, ERP 는 존재하지
 *    않는 org_id 를 `link_s020_org_id` 에 박는다. 성공 조건은
 *    `HTTP 200 && body.result === 'success' && body.status === 200` 셋 다다.
 * ② **메시지 칸이 `massage` 다.** 오타지만 실제 필드명이다(연동규격 §4-2).
 * ③ **중복 응답의 `data.orgId` 를 쓰지 않는다.** 같은 코드를 이미 쓰는 **남의 회사**일
 *    수 있고, 그 번호를 우리 입주사에 이으면 그 입주사가 남의 데이터를 본다 — 격리의
 *    뿌리가 `link_s020_org_id` 하나다. 그래서 `duplicate_code` 에 번호를 담지 않는다
 *    (`types.ts` · `domain/org-code.ts`).
 * ④ **401 은 장애가 아니다.** 토큰 만료이고, `callBbiyong`(→ `withFreshAccess`)이 받아서
 *    재발급한 뒤 **한 번 더 부른다.** 그러니 여기서는 `BbiyongTokenExpiredError` 로
 *    그대로 던진다 — 이것을 `BbiyongUnavailableError` 로 뭉개면 재발급이 돌지 않고
 *    화면에 「서버에 연결할 수 없습니다」가 뜬다(2026-09-30 에 고친 바로 그 증상).
 *
 * =============================================================================
 * ★ 사람에게 보여줄 문구는 여기서 만든다
 * =============================================================================
 * `rejected.message` 는 **운영자가 화면에서 그대로 읽는 글**이다(`types.ts`). 삐용 내부
 * 메시지를 날것으로 흘리지 않는다 — 권한 문제는 무엇을 해야 하는지까지 적어 준다.
 * 그 밖의 400 은 삐용 문구가 이미 사람 말이라 그대로 쓰되, 없으면 우리 문구로 대신한다.
 *
 * ★★ 퇴실·수정은 만들지 않았다 — 삐용 규격이 아직 없다(회신 대기). 이 어댑터에는
 *    `createOrg` 하나뿐이다.
 */
import { BBIYONG } from '@swonbiz/shared';
import {
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
  type BbiyongOrg,
  type BbiyongOrgPatch,
  type BbiyongOrgRequest,
  type CreateOrgOutcome,
  type OrgOpOutcome,
} from './types.ts';

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

function toInt(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 삐용이 준 사유. `massage` 가 실제 필드명이고, 실물은 `data.message` 에도 담아 온다. */
function readMassage(root: Record<string, unknown> | null): string | null {
  const parts = [str(root?.massage), str(asRecord(root?.data)?.message)].filter(
    (v): v is string => v !== null,
  );
  return parts.length > 0 ? parts.join(' / ') : null;
}

/**
 * 오류 표지. 회신 예시는 최상위 `error` 가 배열(`["AUTHZ_DENY"]`)이고, 로그인 실물은
 * `data.code` 였다. 둘 다 본다 — 배열이면 원소를 이어 붙인다.
 */
function readErrorCodes(root: Record<string, unknown> | null): string[] {
  const top = root?.error;
  const codes = Array.isArray(top)
    ? top.map((v) => str(v)).filter((v): v is string => v !== null)
    : [str(top)].filter((v): v is string => v !== null);
  const inner = str(asRecord(root?.data)?.code);
  if (inner) codes.push(inner);
  return codes;
}

/** 「이미 사용중인 단체코드」인가. ★ 문구로 알아본다 — 삐용이 전용 코드를 주지 않는다. */
function isDuplicateCode(massage: string | null): boolean {
  return massage !== null && massage.includes('이미 사용중인 단체코드');
}

/** 퇴실·재입주가 끄고 켜는 모듈. ERP 가 파는 것은 공유오피스 하나다(orgLink.ts 의 ORG_MODULE_CODES). */
const OFFICE = 'OFFICE';

const DENY_MESSAGE =
  '삐용에 회사를 만들 권한이 없습니다. 삐용 권한관리에서 「단체관리」 화면이 포함된 ERP 담당 역할을 받으세요';

const SEED_MESSAGE =
  '삐용 권한 설정이 끝나지 않아 회사를 만들지 못했습니다. 삐용 담당자에게 전달해야 합니다';

const HALF_DONE_MESSAGE =
  '삐용에 회사는 만들어졌으나 권한 설정이 끝나지 않았습니다. **삐용 담당자에게 즉시 알려 주세요** — ERP 에서 다시 시도하지 마세요';

/**
 * 회사 등록 응답 본문을 해석한다.
 *
 * ★ 어떤 입력이 와도 **던지지 않는다.** 깨진 응답은 `rejected` 다 — 파싱 예외가 올라가면
 *   `linkOrg` 의 catch 가 「연결할 수 없습니다」로 뭉개고, 진짜 원인은 로그에 묻힌다.
 */
export function parseCreateOrg(body: unknown, sentOrgCode: string): CreateOrgOutcome {
  const root = asRecord(body);
  if (!root) {
    return { kind: 'rejected', message: '삐용 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요', retryable: true };
  }

  const status = root.status;
  const massage = readMassage(root);
  const codes = readErrorCodes(root);

  // ★ 성공 게이트 — 셋 다 맞아야 한다(함정 ①).
  if (root.result === 'success' && status === 200) {
    const orgId = toInt(asRecord(root.data)?.orgId);
    if (orgId === null) {
      /*
       * ★★ 만들어졌을 수도 있는데 번호를 못 받았다. **성공으로 삼지 않는다** — 없는
       *    번호를 link 에 박는 것이 더 나쁘다. 다시 시도하면 그 코드는 중복으로 돌아오고
       *    다음 번호로 넘어간다(orgLink.ts 의 「알려진 구멍」과 같은 자리).
       */
      return {
        kind: 'rejected',
        message: '삐용이 회사 번호를 주지 않아 연결하지 못했습니다. 삐용 담당자에게 확인이 필요합니다',
        retryable: false,
      };
    }
    return { kind: 'created', orgId, orgCode: sentOrgCode };
  }

  // 권한 — 토큰 주인에게 단체관리 화면이 없거나, 에스원테크 소속이 아니다.
  if (status === 403) {
    return { kind: 'rejected', message: DENY_MESSAGE, retryable: false };
  }

  if (status === 400) {
    // 중복이면 호출자가 다음 번호로 다시 시도한다. ★ data.orgId 는 담지 않는다(함정 ③).
    if (isDuplicateCode(massage)) return { kind: 'duplicate_code', orgCode: sentOrgCode };
    return {
      kind: 'rejected',
      message: massage ?? '삐용이 회사 등록을 거절했습니다. 입주사 정보를 확인해 주세요',
      retryable: false,
    };
  }

  // 권한 견본이 없다 — 삐용 시드 문제다. 다시 시도해도 풀리지 않는다.
  if (status === 409) {
    return { kind: 'rejected', message: SEED_MESSAGE, retryable: false };
  }

  /*
   * ★★★ 「단체는 등록되었으나 권한 설정이 끝나지 않았습니다」 — 있어서는 안 되는 상태다.
   *    회사가 삐용에 **남아 있을 수 있는데** 번호를 모른다. 다시 시도하면 그 코드는
   *    중복으로 돌아오고 다음 번호로 넘어가 **쓰이지 않는 회사가 하나 더 남는다.**
   *    그래서 `retryable: false` 로 두고 문구로 사람을 부른다.
   */
  if (status === 500) {
    return { kind: 'rejected', message: HALF_DONE_MESSAGE, retryable: false };
  }

  console.warn(
    `[bbiyong] 회사 등록 — 모르는 응답 status=${String(status)} result=${String(root.result)} codes=${codes.join(',')}`,
  );
  return {
    kind: 'rejected',
    message: massage ?? '삐용이 회사 등록을 거절했습니다. 삐용 담당자에게 확인이 필요합니다',
    retryable: false,
  };
}

/**
 * 퇴실 · 재입주 · 수정의 응답을 해석한다 (삐용 회신 2026-10-02).
 *
 * ★ 봉투는 등록과 같다 — 분기는 본문 `result`/`status` 로 한다(연동규격 §4 주의점 1).
 *   돌려받을 식별자가 없으므로 `data` 는 보지 않는다.
 *
 * ★★ 두 번 보낸 경우(이미 꺼져 있다 / 이미 켜져 있다)도 여기서는 그냥 `rejected` 다.
 *    삐용 문구를 그대로 쓴다 — 「이미 …」는 사람이 읽어서 바로 아는 말이고, ERP 가
 *    따로 번역할 것이 없다. 권한·시드 문제만 우리 문구로 바꾼다(등록과 같은 규칙).
 */
export function parseOrgOp(body: unknown, label: string): OrgOpOutcome {
  const root = asRecord(body);
  if (!root) {
    return { kind: 'rejected', message: '삐용 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요', retryable: true };
  }

  const status = root.status;
  const massage = readMassage(root);

  if (root.result === 'success' && status === 200) return { kind: 'ok' };

  if (status === 403) return { kind: 'rejected', message: DENY_MESSAGE, retryable: false };
  if (status === 409) return { kind: 'rejected', message: SEED_MESSAGE, retryable: false };

  console.warn(`[bbiyong] ${label} 실패 status=${String(status)} massage=${massage ?? '-'}`);
  return {
    kind: 'rejected',
    message: massage ?? `삐용이 ${label}을 거절했습니다. 삐용 담당자에게 확인이 필요합니다`,
    retryable: false,
  };
}

// =============================================================================
// 어댑터
// =============================================================================

/** 메시지에 URL·토큰이 섞여 나가는 것을 막는다(`HttpBbiyongAuth` 와 같은 규칙). */
function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_.-]{6,}/g, '<token>');
}

export interface HttpBbiyongOrgOptions {
  baseUrl: string;
  /** 시험에서 갈아 끼운다. 운영에서는 전역 fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpBbiyongOrg implements BbiyongOrg {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(opts: HttpBbiyongOrgOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /**
   * POST + JSON 파싱. 네 호출이 전부 이것을 거친다 — 토큰·타임아웃·401·JSON 규칙이
   * 한 곳에만 있다.
   *
   * 던지는 것은 `BbiyongTokenExpiredError`(401) 와 `BbiyongUnavailableError`(그 밖) 뿐이다.
   * 업무 실패는 **던지지 않는다** — 200 으로 와서 호출자가 해석한다.
   */
  async #post(path: string, body: unknown, accessToken: string, label: string): Promise<unknown> {
    const url = `${this.#baseUrl}${path}`;

    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      // ★ 원문을 그대로 붙이지 않는다 — URL·토큰이 섞일 수 있다.
      throw new BbiyongUnavailableError(`삐용 ${label} 호출 실패: ${redact((err as Error).message)}`);
    }

    // ★★ 401 만은 토큰 문제다(함정 ④). withFreshAccess 가 받아서 재발급한다.
    if (res.status === 401) {
      throw new BbiyongTokenExpiredError(`삐용 ${label}이 401 — access 토큰이 만료됐다`);
    }

    // 400·403 은 삐용이 **토큰을 안 실었거나 칸이 빠졌을 때** 주는 HTTP 코드다(연동규격 §2-4).
    // 업무 실패는 200 으로 오므로, 여기 걸리는 것은 우리 쪽 호출이 틀린 것이다 — 장애로 본다.
    if (!res.ok) throw new BbiyongUnavailableError(`삐용 ${label}이 HTTP ${res.status} 로 응답했다`);

    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // 본문을 메시지에 담지 않는다 — 프록시 오류 페이지가 무엇을 담고 있을지 모른다.
      throw new BbiyongUnavailableError(`삐용 ${label} 응답이 JSON 이 아니다 (${text.length}바이트)`);
    }
  }

  async createOrg(req: BbiyongOrgRequest, accessToken: string): Promise<CreateOrgOutcome> {
    /*
     * ★ 보내는 칸은 `BbiyongOrgRequest` 가 가진 것 그대로다 — 여기서 더하지 않는다.
     *   주소(zipCode·address·detailAddress)와 telNo 는 **일부러 없다**: 계약 폼의 주소는
     *   대표자 **자택**이고, ERP 에 회사 전화 칸이 없다(결정 2026-09-30 · orgLink.ts).
     */
    const parsed = await this.#post(
      BBIYONG.ORG_PATH,
      {
        orgName: req.orgName,
        orgCode: req.orgCode,
        memberName: req.memberName,
        hpNo: req.hpNo,
        email: req.email,
        countryCode: req.countryCode,
        moduleCodes: req.moduleCodes,
      },
      accessToken,
      '회사 등록',
    );

    const outcome = parseCreateOrg(parsed, req.orgCode);
    // ★ 평문 로그에 이메일·전화·토큰을 남기지 않는다. 남는 것은 코드와 결과뿐이다.
    console.log(`[bbiyong] 회사 등록 — orgCode=${req.orgCode} → ${outcome.kind}`);
    return outcome;
  }

  /** 퇴실 — OFFICE 구독을 끈다. 계약이 종료될 때. */
  async moduleOff(orgCode: string, accessToken: string): Promise<OrgOpOutcome> {
    const parsed = await this.#post(
      BBIYONG.ORG_MODULE_OFF_PATH,
      { orgCode, moduleCode: OFFICE },
      accessToken,
      '퇴실',
    );
    const outcome = parseOrgOp(parsed, '퇴실');
    console.log(`[bbiyong] 퇴실 — orgCode=${orgCode} → ${outcome.kind}`);
    return outcome;
  }

  /** 재입주 — 끊긴 OFFICE 구독을 다시 켠다. ★ 회사를 다시 만들지 않는다. */
  async moduleOn(orgCode: string, accessToken: string): Promise<OrgOpOutcome> {
    const parsed = await this.#post(
      BBIYONG.ORG_MODULE_ON_PATH,
      { orgCode, moduleCode: OFFICE },
      accessToken,
      '재입주',
    );
    const outcome = parseOrgOp(parsed, '재입주');
    console.log(`[bbiyong] 재입주 — orgCode=${orgCode} → ${outcome.kind}`);
    return outcome;
  }

  /**
   * 회사명 수정.
   *
   * ★★★ **주소 3칸을 보내지 않는다.** 규격 본문에 `zipCode`·`address`·`detailAddress` 가
   *    있지만 빼고 보낸다 — 안 보낸 칸은 삐용이 그대로 둔다.
   *    ★★ **빈 문자열(`""`)로 보내면 삐용에 들어 있는 주소가 지워진다. 절대 그러지 말 것.**
   *       되돌릴 수 없고, 지워진 것을 ERP 는 알지 못한다. ERP 가 가진 주소는 **대표자
   *       자택**이라 애초에 삐용의 회사 주소 자리에 들어갈 값이 아니다.
   */
  async patchOrg(patch: BbiyongOrgPatch, accessToken: string): Promise<OrgOpOutcome> {
    const parsed = await this.#post(
      BBIYONG.ORG_PATCH_PATH,
      // ★ 이 두 칸뿐이다. 주소를 더하지 말 것(위 주석).
      { orgCode: patch.orgCode, orgName: patch.orgName },
      accessToken,
      '회사 수정',
    );
    const outcome = parseOrgOp(parsed, '회사 수정');
    console.log(`[bbiyong] 회사 수정 — orgCode=${patch.orgCode} → ${outcome.kind}`);
    return outcome;
  }
}
