/**
 * 새 문의 접수 → 삐용에 알림 부탁 — 앱 1단계 3-마 (대표 결정 2026-11-16)
 *
 * 설계 : s09-mail docs/앱3마_문의알림_설계_20261116.md
 *
 * =============================================================================
 * ★★★ 문의 저장은 이 부탁과 **상관없다**
 * =============================================================================
 * 라우트(`routes/inquiry.ts`)는 저장을 마친 뒤 `notifyNewInquiryLater` 를 **기다리지 않고** 부르고
 * 곧바로 201 을 돌려준다. 이 파일의 함수는 **절대 던지지 않는다** — 삐용이 꺼져 있어도, 키가 틀려도,
 * 시간이 지나도 기록 한 줄로 끝난다. 다시 보내지 않는다(대표 결정 라 — 문의는 ERP 목록에 그대로 있다).
 *
 * =============================================================================
 * ★★ 서버끼리 · 비밀 키 — 사람 토큰이 없는 유일한 삐용 호출
 * =============================================================================
 * 다른 삐용 호출(`HttpBbiyongOrg` 등)은 모두 **사람의** access 토큰을 싣는다. 고객 문의에는 로그인한
 * 사람이 없어서 그 길을 쓸 수 없다. 그래서 헤더 `X-SwonBiz-Server-Key` 에 `BBIYONG_SERVER_KEY` 를 싣는다
 * (삐용 yml `inbound.erp-server-key` 와 같은 값). 키가 없으면(또는 MOCK — 삐용 주소 없음) 부르지 않는다.
 *
 * ★ 본문은 **문의 번호와 유형 이름 둘뿐**이다. 고객 이름 · 연락처 · 본문을 싣지 않는다 —
 *   알림은 폰 잠금 화면에 뜨고, 푸시는 구글을 거친다(대표 결정 다).
 * ★ 키 값은 기록에 남기지 않는다.
 */
import { env } from '../env.ts';

export const SERVER_KEY_HEADER = 'X-SwonBiz-Server-Key';
export const INQUIRY_NOTI_PATH = '/rest/v1/noti/erp-inquiry';
/** 짧게 — 고객 응답은 이미 나갔지만, 매달린 연결을 오래 두지 않는다 */
export const NOTIFY_TIMEOUT_MS = 3_000;

export type NotifyResult = 'sent' | 'skipped' | 'failed';

/** Fastify `req.log` 모양 중 쓰는 둘 */
export interface NotifyLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface NotifyDeps {
  /** 삐용 API 주소. null = MOCK(부르지 않는다) */
  baseUrl: string | null;
  /** 서버끼리 비밀 키. 비면 부르지 않는다 */
  serverKey: string | null;
  log: NotifyLog;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** 유형 코드 → 이름(QU_TP). 없으면 빈 글자 — 삐용이 「새 문의」로 채운다 */
export function inquiryTypeName(
  codes: readonly { category: string; code: string; name: string }[],
  type: string,
): string {
  return codes.find((c) => c.category === 'QU_TP' && c.code === type)?.name ?? '';
}

/** 한 번 부른다. **던지지 않는다.** */
export async function notifyNewInquiry(
  input: { inquiryId: string; typeName: string },
  deps: NotifyDeps,
): Promise<NotifyResult> {
  const key = deps.serverKey?.trim() ?? '';
  if (!deps.baseUrl || !key) {
    deps.log.info({ inquiryId: input.inquiryId }, '[문의 알림] 건너뜀 — 삐용 주소 또는 서버 키(BBIYONG_SERVER_KEY)가 없다');
    return 'skipped';
  }
  const url = `${deps.baseUrl.replace(/\/+$/, '')}${INQUIRY_NOTI_PATH}`;
  try {
    const res = await (deps.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SERVER_KEY_HEADER]: key },
      body: JSON.stringify({ inquiryId: input.inquiryId, typeName: input.typeName }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? NOTIFY_TIMEOUT_MS),
    });
    if (res.status === 202 || res.ok) {
      deps.log.info({ inquiryId: input.inquiryId, status: res.status }, '[문의 알림] 삐용에 부탁함');
      return 'sent';
    }
    deps.log.warn({ inquiryId: input.inquiryId, status: res.status }, `[문의 알림] 삐용이 받지 않음 — HTTP ${res.status}`);
    return 'failed';
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    deps.log.warn({ inquiryId: input.inquiryId, reason }, '[문의 알림] 삐용에 닿지 못함 — 문의는 저장됐다');
    return 'failed';
  }
}

/**
 * 라우트가 부르는 것 — **기다리지 않는다.** env 의 삐용 주소 · 서버 키로 한 번 보낸다.
 * ★ 돌려주는 값이 없다. 실패는 기록 한 줄뿐이다.
 */
export function notifyNewInquiryLater(input: { inquiryId: string; typeName: string }, log: NotifyLog): void {
  void notifyNewInquiry(input, {
    baseUrl: env.bbiyongMock ? null : env.bbiyongBaseUrl,
    serverKey: env.bbiyongServerKey,
    log,
  }).catch(() => undefined);
}
