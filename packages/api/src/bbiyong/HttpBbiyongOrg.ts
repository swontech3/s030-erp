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
 * ★ 지금 이 어댑터가 가진 것은 다섯이다 — 회사 등록(`createOrg`) · 퇴실(`moduleOff`) ·
 *   재입주(`moduleOn`) · 회사 수정(`patchOrg`) · 직원정보(`sendMember`). 뒤의 넷은
 *   삐용 회신으로 규격이 온 순서대로 붙었다(2026-10-02 · 2026-10-05).
 */
import { BBIYONG } from '@swonbiz/shared';
import {
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
  // ★ 등록·퇴실·재입주 셋이 같은 목록을 본다. 정의는 `types.ts` 한 곳이다.
  ORG_MODULE_CODES,
  type BbiyongMemberRequest,
  type BbiyongOrg,
  type BbiyongOrgInfo,
  type BbiyongOrgKey,
  type BbiyongOrgLegalPatch,
  type BbiyongOrgPatch,
  type BbiyongOrgSearch,
  type BbiyongOrgRequest,
  type CreateOrgOutcome,
  type MemberOpOutcome,
  type OrgLookupOutcome,
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

/**
 * 「이미 구독 중」인가 — **재입주에서만** 이것을 성공으로 친다(삐용 회신 2026-10-04:
 * 「이미 구독 중(400)은 무시해도 된다」).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ★★★ **400 이라고 다 무시하면 안 된다**
 * ══════════════════════════════════════════════════════════════════════════
 * 같은 400 으로 「○○(CODE) 은(는) 지금 **선택할 수 없는 서비스**입니다」가 온다
 * (연동규격 §2-4). 그것까지 성공으로 치면 **모듈이 안 켜졌는데 ERP 는 켜졌다고 믿는다.**
 * 그래서 상태만 보지 않고 **문구에 「구독」이 있는지**까지 본다 — 위 문구에는 없다.
 * `isDuplicateCode` 와 같은 방식이다(삐용은 기계용 코드를 안 주고 문장을 준다).
 *
 * ★ 틀려도 **안전한 쪽으로 틀린다.** 문구가 달라 못 알아보면 그냥 거절로 남아
 *   「대기」가 될 뿐, 거짓 성공은 나지 않는다.
 *
 * ★★ **실제 응답 원문을 보면 더 좁힌다.** 지금은 「구독」 두 글자가 전부라 넓다 —
 *    삐용이 돌려주는 문장을 한 번 받아 보면 `isDuplicateCode` 처럼 통문장으로 맞출 것.
 */
function isAlreadySubscribed(body: unknown): boolean {
  const root = asRecord(body);
  if (!root || toInt(root.status) !== 400) return false;
  return (readMassage(root) ?? '').includes('구독');
}

const DENY_MESSAGE =
  '삐용에 회사를 만들 권한이 없습니다. 삐용 권한관리에서 「단체관리」 화면이 포함된 ERP 담당 역할을 받으세요';

const SEED_MESSAGE =
  '삐용 권한 설정이 끝나지 않아 회사를 만들지 못했습니다. 삐용 담당자에게 전달해야 합니다';

/** 법무 회사 수정에 실을 수 있는 칸(`BbiyongOrgLegalPatch` 의 `orgCode` 밖). */
const LEGAL_PATCH_KEYS = ['zipCode', 'address', 'detailAddress', 'bizNumber', 'corpNumber'] as const;

/** 단체 조회 규격이 없을 때 운영자에게 보여 줄 문구. */
const ORG_LOOKUP_UNSUPPORTED_MESSAGE =
  '삐용 단체 조회가 아직 연결되지 않았습니다(삐용 규격 대기). 개발계에서는 BBIYONG_MOCK=true 로 확인할 수 있습니다';

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
    /*
     * ★★ 대표 회원번호(규격 2026-10-05 에 추가됐다). **없으면 null 로 둔다** —
     *    회사는 이미 만들어졌으므로 거절로 돌리지 않는다. 거절로 돌리면 다음 시도가
     *    다음 단체코드로 **회사를 하나 더 만든다**(위 orgId === null 자리와 반대로
     *    판단하는 이유: 거기서는 org_id 가 없으면 연결 자체를 할 수 없다).
     */
    const memberId = toInt(asRecord(root.data)?.memberId);
    if (memberId === null) {
      console.warn(
        `[bbiyong] 회사 등록 — orgCode=${sentOrgCode} 응답에 대표 회원번호가 없다. 대표 정보 수정을 보낼 수 없다`,
      );
    }
    return { kind: 'created', orgId, orgCode: sentOrgCode, memberId };
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

/**
 * 직원정보(`erp-member`) 응답을 해석한다 (삐용 규격 2026-10-05).
 *
 * ★ 봉투는 회사 등록과 같다 — 성공·실패 **둘 다 HTTP 200** 이고 본문 `result`·`status`
 *   로 가른다(함정 ①). 그래서 `parseOrgOp` 와 거의 같지만 **합치지 않았다**:
 *   `I` 는 **회원번호를 받아야 성공**이고, 그 한 줄이 이 함수의 존재 이유다.
 *
 * ★★ `I` 가 `success` 인데 번호가 없으면 **실패로 본다.** 번호를 못 받으면 그 직원은
 *    다음 저장에서 또 `I` 로 나가고, 그때는 이메일이 겹쳐 거절된다 — 즉 영원히 대기다.
 *    「성공했다고 적고 번호는 비워 두는」 상태가 가장 나쁘다(회사 등록의 orgId 와 같은
 *    판단이다). 대표 번호만 반대로 다룬다 — 그쪽은 대신 만들어진 것이 있다.
 *
 * ★ 어떤 입력이 와도 **던지지 않는다.** 깨진 응답은 `rejected` 다.
 */
export function parseMemberOp(body: unknown, regTp: 'I' | 'U' | 'D'): MemberOpOutcome {
  const root = asRecord(body);
  if (!root) {
    return { kind: 'rejected', message: '삐용 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요', retryable: true };
  }

  const status = root.status;
  const massage = readMassage(root);

  if (root.result === 'success' && status === 200) {
    if (regTp !== 'I') return { kind: 'ok' };

    const memberId = toInt(asRecord(root.data)?.memberId);
    if (memberId === null) {
      return {
        kind: 'rejected',
        message: '삐용이 회원번호를 주지 않아 직원을 연결하지 못했습니다. 삐용 담당자에게 확인이 필요합니다',
        retryable: false,
      };
    }
    return { kind: 'created', memberId };
  }

  if (status === 403) return { kind: 'rejected', message: DENY_MESSAGE, retryable: false };
  if (status === 409) return { kind: 'rejected', message: SEED_MESSAGE, retryable: false };

  /*
   * 그 밖의 거절은 **삐용 문구를 그대로 쓴다.** 여기 오는 것은 거의 「이메일이 이미
   * 사용 중」·「대표는 삭제할 수 없습니다」 같은 값 문제이고, 그 문장이 이미 사람 말이다
   * (`parseOrgOp` 와 같은 규칙). 번역하려 들면 삐용이 문구를 늘릴 때마다 뒤처진다.
   */
  const label = { I: '직원 등록', U: '직원 수정', D: '직원 삭제' }[regTp];
  console.warn(`[bbiyong] ${label} 실패 status=${String(status)} massage=${massage ?? '-'}`);
  return {
    kind: 'rejected',
    message: massage ?? `삐용이 ${label}을 거절했습니다. 입력값을 확인해 주세요`,
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

  /**
   * 퇴실 — 구독 모듈을 끈다. 계약이 종료될 때.
   *
   * ══════════════════════════════════════════════════════════════════════
   * ★★★ **퇴실은 한 번, 재입주는 두 번이다.** 삐용이 그렇게 받는다(확인 2026-10-04)
   * ══════════════════════════════════════════════════════════════════════
   *   퇴실    `{ orgCode, moduleCodes: ["OFFICE","AUTHZ"] }`   ← 복수 · 배열 · **1회**
   *   재입주  `{ orgCode, moduleCode: "OFFICE" }` 그리고
   *           `{ orgCode, moduleCode: "AUTHZ"  }`              ← 단수 · 문자열 · **2회**
   *
   * 보기에 어긋나 보이지만 **맞추지 말 것.** 둘을 같은 모양으로 「정리」하면 삐용이
   * 모르는 칸을 조용히 무시하고 `success` 를 돌려줄 수 있다 — 그러면 ERP 는 껐다고
   * 믿는데 삐용에서는 켜져 있는 상태가 된다. 바꾸려면 삐용에 다시 확인해야 한다.
   *
   * ★ 2026-10-04 전에는 둘 다 `OFFICE` 하나만 보냈다. 등록은 둘을 켜는데 퇴실은
   *   하나만 꺼서 **`AUTHZ` 가 영영 켜진 채 남았다.**
   */
  async moduleOff(orgCode: string, accessToken: string): Promise<OrgOpOutcome> {
    const parsed = await this.#post(
      BBIYONG.ORG_MODULE_OFF_PATH,
      // ★ 복수형 배열. 한 번에 보낸다(위 머리말).
      { orgCode, moduleCodes: [...ORG_MODULE_CODES] },
      accessToken,
      '퇴실',
    );
    const outcome = parseOrgOp(parsed, '퇴실');
    console.log(`[bbiyong] 퇴실 — orgCode=${orgCode} 모듈=${ORG_MODULE_CODES.join(',')} → ${outcome.kind}`);
    return outcome;
  }

  /**
   * 재입주 — 끊긴 구독을 다시 켠다. ★ 회사를 다시 만들지 않는다.
   *
   * ★★ **모듈마다 한 번씩 부른다**(단수 `moduleCode`). 퇴실과 모양이 다른 이유는
   *    `moduleOff` 머리말에 있다.
   *
   * ★★ **「이미 구독 중」(400)은 성공으로 치고 다음 모듈로 간다**(삐용 회신 2026-10-04).
   *    재입주를 두 번 눌렀거나, 앞선 시도가 한 모듈만 켜 놓고 멈췄을 때 그렇게 온다.
   *    이미 원하는 상태이므로 실패가 아니다. 판정은 `isAlreadySubscribed` 한 곳이고
   *    **400 이라고 다 통과시키지 않는다** — 그쪽 머리말에 이유가 있다.
   *
   * ★★ **그 밖의 거절은 거기서 멈추고 그 결과를 돌려준다.** 남은 모듈은 켜지지 않는다 —
   *    반쯤 켜진 상태로 「성공」이라 답하면 아무도 그걸 모른다. 부르는 쪽
   *    (`orgLink.applyOp`)이 「대기」로 남기고, [다시 시도] 는 **멈춘 그 모듈부터**
   *    의미 있게 이어진다(앞 모듈은 「이미 구독 중」으로 통과하므로).
   */
  async moduleOn(orgCode: string, accessToken: string): Promise<OrgOpOutcome> {
    for (const moduleCode of ORG_MODULE_CODES) {
      const parsed = await this.#post(
        BBIYONG.ORG_MODULE_ON_PATH,
        // ★ 단수형 문자열. 모듈 하나에 요청 하나다(위 머리말).
        { orgCode, moduleCode },
        accessToken,
        '재입주',
      );

      if (isAlreadySubscribed(parsed)) {
        console.log(`[bbiyong] 재입주 — orgCode=${orgCode} 모듈=${moduleCode} → 이미 구독 중(넘어간다)`);
        continue;
      }

      const outcome = parseOrgOp(parsed, '재입주');
      console.log(`[bbiyong] 재입주 — orgCode=${orgCode} 모듈=${moduleCode} → ${outcome.kind}`);
      if (outcome.kind !== 'ok') return outcome;
    }
    return { kind: 'ok' };
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

  /**
   * 법무 비입주사 회사 정보 수정 — `patchOrg` 와 같은 주소, 다른 칸(결정 2026-10-22).
   *
   * ★★ **값이 있는 칸만 싣는다.** `undefined` 는 물론 빈 문자열도 칸째 뺀다 — 빈 문자열은 삐용 값을
   *    지운다(`patchOrg` 머리말). 만드는 쪽(`legal/legalOrgSync.ts`)이 이미 뺐어도 여기서 한 번 더 본다.
   * ★ 회사명(`orgName`)은 싣지 않는다 — 법무는 회사명을 맞추지 않는다.
   */
  async patchOrgLegal(patch: BbiyongOrgLegalPatch, accessToken: string): Promise<OrgOpOutcome> {
    const body: Record<string, string> = { orgCode: patch.orgCode };
    for (const key of LEGAL_PATCH_KEYS) {
      const v = patch[key];
      if (v !== undefined && v.trim() !== '') body[key] = v;
    }
    const parsed = await this.#post(BBIYONG.ORG_PATCH_PATH, body, accessToken, '회사 수정');
    const outcome = parseOrgOp(parsed, '회사 수정');
    // ★ 칸 이름만 남긴다 — 번호 · 주소 값은 로그에 두지 않는다.
    console.log(`[bbiyong] 법무 회사 수정 — orgCode=${patch.orgCode} [${Object.keys(body).slice(1).join(',')}] → ${outcome.kind}`);
    return outcome;
  }

  /**
   * 직원정보 — 신규(`I`) · 수정(`U`) · 삭제(`D`). **엔드포인트는 하나다**(규격 2026-10-05).
   *
   * ══════════════════════════════════════════════════════════════════════
   * ★★★ **보내는 칸을 `regTp` 마다 다르게 만든다**
   * ══════════════════════════════════════════════════════════════════════
   *   `I`  memberId 를 **보내지 않는다**(아직 없다) · `repYn` 을 보낸다
   *   `U`  memberId 필수 · `repYn` 을 **보내지 않는다**(규격: `I` 에서만 쓴다)
   *   `D`  memberId 필수 · `repYn` 을 보내지 않는다
   *
   * ★ `hpNo` 는 선택 항목이라 **값이 없으면 칸을 뺀다.** 빈 문자열로 보내면 삐용에 들어
   *   있는 연락처를 지울 수 있다 — 회사 수정에서 주소 3칸을 뺀 것과 같은 이유다
   *   (`patchOrg` 머리말). 되돌릴 수 없고, 지워진 것을 ERP 는 알지 못한다.
   *
   * ★ 이름·이메일은 `D` 에도 싣는다. 규격의 「보내는 칸」 표에서 선택이라고 적힌 것은
   *   `hpNo` 뿐이고, 삭제가 그 둘을 어딘가에 쓸지(이력 등) 우리는 모른다. 빼서 400 을
   *   받는 것보다 싣는 쪽이 안전하다 — 삭제는 지우는 일이라 **덮어쓸 값이 없다.**
   *
   * ★★ **대표에게 `I`·`D` 를 보내지 않는 판정은 여기 없다.** 그 판정은 `memberSync.ts`
   *    가 한다 — 이 어댑터는 HTTP 왕복과 응답 해석만 한다(파일 머리말).
   */
  async sendMember(req: BbiyongMemberRequest, accessToken: string): Promise<MemberOpOutcome> {
    const body: Record<string, unknown> = {
      regTp: req.regTp,
      orgCode: req.orgCode,
      memberName: req.memberName,
      email: req.email,
    };
    // ★ `I` 는 번호가 없고, `U`·`D` 는 필수다. 없는 값을 null 로 보내지 않는다.
    if (req.regTp !== 'I') body.memberId = req.memberId;
    if (req.regTp === 'I') body.repYn = req.repYn ?? 'N';
    // ★ 빈 값이면 칸 자체를 뺀다(위 머리말).
    if (req.hpNo) body.hpNo = req.hpNo;

    const label = { I: '직원 등록', U: '직원 수정', D: '직원 삭제' }[req.regTp];
    const parsed = await this.#post(BBIYONG.MEMBER_PATH, body, accessToken, label);

    const outcome = parseMemberOp(parsed, req.regTp);
    // ★ 평문 로그에 이름·이메일·전화를 남기지 않는다. 남는 것은 코드와 번호와 결과뿐이다.
    console.log(
      `[bbiyong] ${label} — orgCode=${req.orgCode} memberId=${req.memberId ?? '-'} → ${outcome.kind}` +
        (outcome.kind === 'created' ? `(${outcome.memberId})` : ''),
    );
    return outcome;
  }

  /**
   * 단체 목록 · 단건 — **삐용 규격이 아직 없다**(2026-10-09).
   *
   * ★★ 그래서 부르지 않고 `unsupported` 를 돌려준다. 지어낸 경로로 HTTP 를 보내면 404 를
   *    「장애」로 읽게 되고, 삐용 쪽 로그에도 알 수 없는 호출이 남는다. 규격이 오면 이 두
   *    메서드만 채운다 — 라우트(`routes/orgLookup.ts`)와 팝업은 그대로다.
   * ★ `BBIYONG_MOCK=true` 면 `MockBbiyongOrg` 가 대신 답한다.
   *
   * ★★ 삐용 회신(2026-10-09) — 규격이 오면 지킬 것:
   *    ① **호출 계정에 「법무 회사 보기」 권한이 있어야 한다.** 없으면 삐용이 거절한다 —
   *       ERP 장애가 아니라 삐용 권한 설정 문제로 읽어야 한다(문구도 그렇게 낸다).
   *    ② 목록은 **「법무 서비스를 받은 회사」** 기준이다. Z 코드 조건은 없다 — 거르는 것은
   *       삐용 몫이고, ERP 는 받은 목록을 그대로 보여 준다.
   */
  async listOrgs(_search: BbiyongOrgSearch, _accessToken: string): Promise<OrgLookupOutcome<BbiyongOrgInfo[]>> {
    return { kind: 'unsupported', message: ORG_LOOKUP_UNSUPPORTED_MESSAGE };
  }

  async getOrg(_key: BbiyongOrgKey, _accessToken: string): Promise<OrgLookupOutcome<BbiyongOrgInfo | null>> {
    return { kind: 'unsupported', message: ORG_LOOKUP_UNSUPPORTED_MESSAGE };
  }
}
