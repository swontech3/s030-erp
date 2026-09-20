/**
 * 국세청 사업자등록 **상태조회** — 공공데이터포털 「사업자등록정보 진위확인 및 상태조회」.
 *
 * =============================================================================
 * ★★★ **절대 던지지 않는다**
 * =============================================================================
 * 국세청은 우리가 통제하지 못하는 바깥이다. 점검 중일 수도, 느릴 수도, 규격을 바꿀
 * 수도 있다. 여기서 던지면 [확인] 버튼 하나가 아니라 **계약 폼 전체가 오류로 보인다.**
 * 확인이 안 되는 것은 계약 등록을 막을 이유가 못 된다 — 그래서 실패는 전부
 * `unavailable` 한 가지로 접어서 돌려준다.
 *
 * ★ `unavailable`(확인 못 함)과 `unregistered`(등록 안 된 번호)를 **섞지 않는다.**
 *   섞으면 멀쩡한 번호가 없는 번호로 보이고, 운영자가 계약을 멈춘다.
 *
 * =============================================================================
 * ★★ 결과를 저장하지 않는다
 * =============================================================================
 * DB 에 넣지 않는다. 상태는 **조회한 그 순간의 사실**이고, 저장하면 어제의 사실이
 * 오늘의 화면에 「확인됨」으로 남는다. 레거시가 서명 URL 로 같은 실수를 했다.
 */
import { ntsKindOf, ntsMessageOf, type NtsKind, type NtsRow } from '@swonbiz/shared/domain/biz-number-check';
import { env } from '../env.ts';

interface StatusLog {
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/** 바깥 호출. 기본은 공공데이터포털이고 테스트만 갈아 끼운다. */
export type PostStatus = (bizNumber: string, serviceKey: string) => Promise<{ data: unknown }>;

/** 상태조회 엔드포인트. 진위확인(`/validate`)이 아니라 상태조회다. */
const ENDPOINT = 'https://api.odcloud.kr/api/nts-businessman/v1/status';

/**
 * ★ 상한을 둔다. 국세청이 느릴 때 Fastify 워커가 거기 잡혀 있으면, 확인과 상관없는
 *   다른 요청까지 같이 느려진다.
 */
const TIMEOUT_MS = 5_000;

const postToNts: PostStatus = async (bizNumber, serviceKey) => {
  const res = await fetch(`${ENDPOINT}?serviceKey=${encodeURIComponent(serviceKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ b_no: [bizNumber] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`국세청 응답 ${res.status}`);
  return (await res.json()) as { data: unknown };
};

export interface NtsResult {
  kind: NtsKind;
  message: string;
}

/**
 * 숫자 10자리를 받아 상태를 돌려준다.
 *
 * @param serviceKey 기본은 `.env` 의 `DATA_GO_KR_KEY`. ★ 없으면 **부르지 않고**
 *   `unavailable` 이다 — 키가 빠진 배포에서도 계약 등록은 그대로 돈다.
 */
export async function lookupNtsStatus(
  bizNumber: string,
  log: StatusLog,
  post: PostStatus = postToNts,
  serviceKey: string | null = env.ntsServiceKey,
): Promise<NtsResult> {
  if (!serviceKey) {
    log.warn({}, '국세청 상태조회를 건너뛴다 — DATA_GO_KR_KEY 가 없다');
    return { kind: 'unavailable', message: ntsMessageOf('unavailable') };
  }

  try {
    const body = await post(bizNumber, serviceKey);
    // ★ 모양을 믿지 않는다. 바깥 응답이라 언제든 달라질 수 있다.
    if (!Array.isArray(body?.data)) throw new Error('data 가 배열이 아니다');
    const row = (body.data[0] ?? null) as NtsRow | null;
    const kind = ntsKindOf(row);
    return { kind, message: ntsMessageOf(kind, row) };
  } catch (err) {
    // ★ 원인은 로그에만. 밖으로 내보내면 serviceKey 가 섞인 URL 이 브라우저까지 간다.
    log.error({ err }, '국세청 상태조회 실패 — 확인만 건너뛴다');
    return { kind: 'unavailable', message: ntsMessageOf('unavailable') };
  }
}
