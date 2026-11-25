/**
 * 삐용 공통 코드(`tb_s020_code010`) — ERP 코드 관리 화면(s030100030)이 삐용 주인 코드를 보고 고치는 길,
 * 그리고 같이 쓰는 코드를 ERP 서버가 받아 쓰는 길(통합 방 · 대표 결정 2026-11-18).
 *
 * 근거 : s09-mail `docs/명세_118_공통코드API_20261118.md` · `docs/코드주인_나누기_20261118.md`
 *
 * =============================================================================
 * ★★ 두 갈래 — 화면 토큰 · 서버 키
 * =============================================================================
 *   화면 토큰(명세 2-1)  로그인한 사람의 삐용 토큰(`callBbiyong`)으로 부른다. 종류 · 값 목록 · 추가 · 수정 ·
 *                        사용 안 함 · 다시 사용. ★ **볼 수 있는지 · 고칠 수 있는지는 삐용이 정한다**
 *                        (화면일람 S030100030 의 VIEW · UPDATE). 거부는 HTTP 200 + 본문 status 403 이고
 *                        그 문구를 그대로 화면에 보인다 — ERP 가 사람을 미리 막지 않는다.
 *   서버 키(명세 2-2)    헤더 `X-SwonBiz-Server-Key`(= `BBIYONG_SERVER_KEY`)로 **읽기만**. 같이 쓰는 코드
 *                        (이메일 도메인 · 국가 · 시간대)를 ERP 서버가 받아 쓴다(`sharedCodes.ts`).
 *
 * ★ 삐용에는 「새 종류 만들기」가 없다(명세 2-1 「있는 종류에만」) — 이 파일에도 없다.
 * ★ 삐용 응답 봉투 `{ result, status, data, massage, error }` — `massage` 는 오타가 아니라 실제 칸 이름이다.
 */
import {
  BbiyongTokenExpiredError,
  BbiyongUnavailableError,
} from './types.ts';

export const CODE_ADMIN_PATH = '/rest/v1/s030100030';
export const CODE_SERVER_PATH = '/rest/v1/code-server';
export const SERVER_KEY_HEADER = 'X-SwonBiz-Server-Key';
/** 묶음(category)이 비면 삐용이 `000` 으로 본다(명세 2). ERP 도 같은 값으로 보낸다. */
export const DEFAULT_CODE_CATEGORY = '000';

/** 종류 한 줄(명세 1 · 6). */
export interface BbiyongCodeType {
  category: string;
  cdTp: string;
  cdTpMeaning: string;
  valueCnt: number;
  useCnt: number;
}

/** 값 한 줄(명세 2 · 7) — 사용 안 함 줄도 온다(`useYn: 'N'`). */
export interface BbiyongCodeValue {
  category: string;
  cdTp: string;
  cdTpMeaning: string;
  cdV: string;
  cdVMeaning: string;
  sortSeq: number | null;
  useYn: 'Y' | 'N';
}

/** 값을 가리키는 열쇠. */
export interface BbiyongCodeKey {
  category: string;
  cdTp: string;
  cdV: string;
}

/** 추가 · 수정 본문(명세 3 · 4). 수정은 이름 · 순서만 바뀐다. */
export interface BbiyongCodeWrite extends BbiyongCodeKey {
  cdVMeaning: string;
  sortSeq?: number | null;
}

/**
 * 화면 토큰 호출 결과. `rejected` = 삐용이 업무로 거절했다(권한 · 같은 코드값 · 없는 종류 …) —
 * `message` 는 삐용 문구 그대로다(사람 말이다).
 */
export type BbiyongCodeOutcome<T> = { kind: 'ok'; value: T } | { kind: 'rejected'; message: string };

/** 화면 토큰 갈래 — 실연동 · 모의가 같은 모양이다. */
export interface BbiyongCodeAdmin {
  listTypes(accessToken: string): Promise<BbiyongCodeOutcome<BbiyongCodeType[]>>;
  listValues(category: string, cdTp: string, accessToken: string): Promise<BbiyongCodeOutcome<BbiyongCodeValue[]>>;
  addValue(body: BbiyongCodeWrite, accessToken: string): Promise<BbiyongCodeOutcome<string>>;
  updateValue(body: BbiyongCodeWrite, accessToken: string): Promise<BbiyongCodeOutcome<string>>;
  unuseValue(key: BbiyongCodeKey, accessToken: string): Promise<BbiyongCodeOutcome<string>>;
  reuseValue(key: BbiyongCodeKey, accessToken: string): Promise<BbiyongCodeOutcome<string>>;
}

/** 서버 키 갈래 — 값 목록 읽기만. 키가 없거나 닿지 못하면 던진다(`sharedCodes.ts` 가 마지막 값으로 받는다). */
export interface BbiyongCodeServerReader {
  listValues(category: string, cdTp: string): Promise<BbiyongCodeValue[]>;
}

// =============================================================================
// 파싱 — 순수 함수
// =============================================================================

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function text(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** 봉투 → 성공이면 `data`, 업무 거절이면 문구. 성공 = `result === 'success'` 그리고 `status === 200`. */
export function readEnvelope(body: unknown): { ok: true; data: unknown; massage: string } | { ok: false; message: string } {
  const root = asRecord(body);
  const massage = text(root?.massage).trim();
  if (root?.result === 'success' && int(root?.status) === 200) return { ok: true, data: root.data, massage };
  return { ok: false, message: massage || '삐용이 요청을 받지 않았습니다' };
}

export function parseCodeTypes(data: unknown): BbiyongCodeType[] {
  if (!Array.isArray(data)) return [];
  const out: BbiyongCodeType[] = [];
  for (const raw of data) {
    const r = asRecord(raw);
    const cdTp = text(r?.cdTp).trim();
    if (!cdTp) continue; // 모양이 다른 줄은 버린다(지어내지 않는다)
    out.push({
      category: text(r?.category).trim() || DEFAULT_CODE_CATEGORY,
      cdTp,
      cdTpMeaning: text(r?.cdTpMeaning),
      valueCnt: int(r?.valueCnt) ?? 0,
      useCnt: int(r?.useCnt) ?? 0,
    });
  }
  return out;
}

export function parseCodeValues(data: unknown): BbiyongCodeValue[] {
  if (!Array.isArray(data)) return [];
  const out: BbiyongCodeValue[] = [];
  for (const raw of data) {
    const r = asRecord(raw);
    const cdTp = text(r?.cdTp).trim();
    const cdV = text(r?.cdV);
    if (!cdTp || cdV === '') continue;
    out.push({
      category: text(r?.category).trim() || DEFAULT_CODE_CATEGORY,
      cdTp,
      cdTpMeaning: text(r?.cdTpMeaning),
      cdV,
      cdVMeaning: text(r?.cdVMeaning),
      sortSeq: int(r?.sortSeq),
      // ★ 명세 2 — 사용 안 함 줄은 `N`. 칸이 없으면 사용 중으로 본다(기존 retrieve-code 모양).
      useYn: text(r?.useYn).trim().toUpperCase() === 'N' ? 'N' : 'Y',
    });
  }
  return out;
}

function redact(s: string): string {
  return s.replace(/https?:\/\/\S+/gi, '<url>').replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_.-]{6,}/g, '<token>');
}

// =============================================================================
// 실연동
// =============================================================================

export interface HttpBbiyongCodesOptions {
  baseUrl: string;
  /** 서버 키(`BBIYONG_SERVER_KEY`). 비면 서버 키 읽기는 던진다. */
  serverKey?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpBbiyongCodes implements BbiyongCodeAdmin {
  readonly #baseUrl: string;
  readonly #serverKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(opts: HttpBbiyongCodesOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#serverKey = opts.serverKey?.trim() ?? '';
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
  }

  // ── 화면 토큰 ──────────────────────────────────────────────────────────
  async listTypes(accessToken: string): Promise<BbiyongCodeOutcome<BbiyongCodeType[]>> {
    const env = readEnvelope(await this.#token('GET', '/code-types', accessToken));
    return env.ok ? { kind: 'ok', value: parseCodeTypes(env.data) } : { kind: 'rejected', message: env.message };
  }

  async listValues(category: string, cdTp: string, accessToken: string): Promise<BbiyongCodeOutcome<BbiyongCodeValue[]>> {
    const qs = new URLSearchParams({ category, cdTp }).toString();
    const env = readEnvelope(await this.#token('GET', `/code-values?${qs}`, accessToken));
    return env.ok ? { kind: 'ok', value: parseCodeValues(env.data) } : { kind: 'rejected', message: env.message };
  }

  addValue(body: BbiyongCodeWrite, accessToken: string): Promise<BbiyongCodeOutcome<string>> {
    return this.#write('POST', '/code-value', writeBody(body), accessToken);
  }

  updateValue(body: BbiyongCodeWrite, accessToken: string): Promise<BbiyongCodeOutcome<string>> {
    return this.#write('PATCH', '/code-value', writeBody(body), accessToken);
  }

  unuseValue(key: BbiyongCodeKey, accessToken: string): Promise<BbiyongCodeOutcome<string>> {
    return this.#write('PATCH', '/code-value-unuse', keyBody(key), accessToken);
  }

  reuseValue(key: BbiyongCodeKey, accessToken: string): Promise<BbiyongCodeOutcome<string>> {
    return this.#write('PATCH', '/code-value-reuse', keyBody(key), accessToken);
  }

  async #write(method: string, path: string, body: object, accessToken: string): Promise<BbiyongCodeOutcome<string>> {
    const env = readEnvelope(await this.#token(method, path, accessToken, body));
    return env.ok ? { kind: 'ok', value: env.massage } : { kind: 'rejected', message: env.message };
  }

  #token(method: string, path: string, accessToken: string, body?: object): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
    if (body) headers['content-type'] = 'application/json';
    return this.#call(
      `${this.#baseUrl}${CODE_ADMIN_PATH}${path}`,
      { method, headers, body: body ? JSON.stringify(body) : undefined },
      '공통 코드',
      true,
    );
  }

  // ── 서버 키 ────────────────────────────────────────────────────────────
  async listValuesByServerKey(category: string, cdTp: string): Promise<BbiyongCodeValue[]> {
    if (!this.#serverKey) throw new BbiyongUnavailableError('삐용 서버 키(BBIYONG_SERVER_KEY)가 없어 공통 코드를 받지 못한다');
    const qs = new URLSearchParams({ category, cdTp }).toString();
    const body = await this.#call(
      `${this.#baseUrl}${CODE_SERVER_PATH}/code-values?${qs}`,
      { method: 'GET', headers: { [SERVER_KEY_HEADER]: this.#serverKey } },
      '공통 코드(서버 키)',
      false,
    );
    const env = readEnvelope(body);
    if (!env.ok) throw new BbiyongUnavailableError(`삐용 공통 코드(서버 키) 거절 — ${redact(env.message)}`);
    return parseCodeValues(env.data);
  }

  async #call(url: string, init: RequestInit, label: string, tokenCall: boolean): Promise<unknown> {
    let res: Response;
    try {
      res = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (err) {
      throw new BbiyongUnavailableError(`삐용 ${label} 호출 실패: ${redact((err as Error).message)}`);
    }
    // ★ 토큰 호출의 401 은 토큰 만료다(재발급은 `callBbiyong`). 서버 키 호출의 401 은 키가 틀린 것 — 장애로 본다.
    if (res.status === 401 && tokenCall) throw new BbiyongTokenExpiredError(`삐용 ${label} 이 401 — access 토큰이 만료됐다`);
    if (!res.ok) throw new BbiyongUnavailableError(`삐용 ${label} 이 HTTP ${res.status} 로 응답했다`, res.status);
    const raw = await res.text();
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new BbiyongUnavailableError(`삐용 ${label} 응답이 JSON 이 아니다 (${raw.length}바이트)`);
    }
  }
}

/** 서버 키 읽기만 내놓는 얇은 감싸개 — `BbiyongCodeServerReader` 모양. */
export function serverReaderOf(http: HttpBbiyongCodes): BbiyongCodeServerReader {
  return { listValues: (category, cdTp) => http.listValuesByServerKey(category, cdTp) };
}

function writeBody(b: BbiyongCodeWrite): Record<string, unknown> {
  const out: Record<string, unknown> = { category: b.category, cdTp: b.cdTp, cdV: b.cdV, cdVMeaning: b.cdVMeaning };
  // ★ 순서가 비면 칸째 뺀다 — 삐용이 추가는 맨 뒤, 수정은 지금 순서 그대로로 본다(명세 2-1).
  if (b.sortSeq !== undefined && b.sortSeq !== null) out.sortSeq = b.sortSeq;
  return out;
}
function keyBody(k: BbiyongCodeKey): Record<string, unknown> {
  return { category: k.category, cdTp: k.cdTp, cdV: k.cdV };
}
