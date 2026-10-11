/**
 * 사업목적 카탈로그 — 화면이 부르는 주소(`/api/legal/biz-purposes/**`). 030 관리 화면과 고르기 팝업이 함께 쓴다.
 *
 * ★ 줄 모양은 shared `BizPurposeItem`(`{ id, text, active }`)이다 — 업종코드 · KSIC · 인허가는 오지 않는다.
 * ★ 409(같은 문구)는 **안내**다 — 운영자가 잘못한 것이 아니라 이미 있다는 뜻이라 붉은 오류로 그리지 않는다
 *   (`codes-model.ts` 의 `inUse` 와 같은 갈래).
 */
import type { BizPurposeItem } from '@swonbiz/shared/domain/biz-purpose';

export type { BizPurposeItem };

export class BizPurposeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BizPurposeError';
  }

  /** 같은 문구가 이미 있다(409) — 안내로 그린다. */
  get duplicate(): boolean {
    return this.status === 409;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new BizPurposeError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0);
  }
  let body: { message?: string } & Record<string, unknown> = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 본문이 없을 수 있다. 그대로 둔다.
  }
  if (!res.ok) throw new BizPurposeError(body.message ?? '처리하지 못했습니다', res.status);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface BizPurposePage {
  items: BizPurposeItem[];
  /** 한도(500줄)를 넘었다 — 검색어로 좁혀야 나머지가 보인다. */
  truncated: boolean;
}

/**
 * 목록 — 검색어는 문구에 들어 있는 글자.
 * @param includeInactive 사용 끈 줄도 — **운영사만** 효과가 있다(회사 세션은 서버가 끈다).
 */
export function loadBizPurposes(q: string, includeInactive: boolean): Promise<BizPurposePage> {
  const qs = new URLSearchParams();
  if (q.trim() !== '') qs.set('q', q.trim());
  if (includeInactive) qs.set('includeInactive', '1');
  const s = qs.toString();
  return call<BizPurposePage>(`/api/legal/biz-purposes${s ? `?${s}` : ''}`);
}

export const createBizPurpose = (text: string) =>
  call<{ item: BizPurposeItem }>('/api/legal/biz-purposes', json('POST', { text })).then((r) => r.item);

export const saveBizPurpose = (id: string, patch: { text?: string; active?: boolean }) =>
  call<{ item: BizPurposeItem }>(`/api/legal/biz-purposes/${encodeURIComponent(id)}`, json('PATCH', patch)).then(
    (r) => r.item,
  );
