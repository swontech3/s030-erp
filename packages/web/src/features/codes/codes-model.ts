/**
 * 코드 관리(s030100030) 모델 — 타입 · 호출 · 문구.
 *
 * ★ 화면 컴포넌트에 `fetch` 를 두지 않는다. 경로가 퍼지면 어느 화면이 무엇을 부르는지
 *   읽히지 않고, 409(쓰고 있어서 못 바꿈) 처리가 자리마다 달라진다(센터 관리와 같은 구조).
 *
 * ★★ 모든 호출이 **같은 모양으로 실패**한다 — `CodesError` 하나다. 그 안에 `inUse` 가
 *    있어 화면이 「오류」와 「안내」를 가른다(409 는 요청이 틀린 것이 아니다).
 *
 * ★ 경로가 `/api/codes-admin/**` 다. `/api/codes` 는 **소비용 조회**(계약 폼이 읽는
 *   `GET /codes`)라 겹치면 안 된다 — 이름을 가르는 이유가 그것뿐이다.
 */

/** 분류(머리) — `tb_s080_code_masters`. */
export interface CodeMaster {
  /** 분류 키. `ROOM_TP` 처럼 소스에 박히는 값이다 — 만든 뒤 바꿀 수 없다. */
  category: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  partitionCount: number;
  /** 이 분류 아래 **전 파티션** 코드 수 합. */
  lineCount: number;
}

/** 파티션 — `tb_s080_code_categories`. `use_tp` 에 이름을 주는 자리다. */
export interface CodePartition {
  category: string;
  /** `000` 이 공통. ★ 파티션은 **독립**이고 상속이 아니다. */
  useTp: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  lineCount: number;
}

/** 이 코드값을 쓰는 업무 자료 한 자리. */
export interface CodeUsage {
  label: string;
  count: number;
}

/** 코드값 — `tb_s080_codes_line`. */
export interface CodeLine {
  lineId: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  /** 쓰는 업무 자료. ★ 비어 있지 않으면 코드값 변경·끄기·삭제가 막힌다. */
  usage: CodeUsage[];
  /** 앱이 이 코드값을 상수로 박아 둔 자리. ★ 있으면 자료가 0건이어도 막힌다. */
  pinnedBy: string | null;
}

/** 이 파티션의 코드값이 저장되는 자리 — 선언표가 가리키는 곳. */
export interface UsageRef {
  label: string;
  table: string;
}

export interface CodesTree {
  masters: CodeMaster[];
  partitions: CodePartition[];
}

export interface LinesPage {
  lines: CodeLine[];
  usageRefs: UsageRef[];
}

export class CodesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 409 — 쓰고 있어서 못 바꾼다. 오류가 아니라 **안내**다. */
    readonly inUse: boolean,
  ) {
    super(message);
    this.name = 'CodesError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new CodesError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, false);
  }

  let body: { message?: string } & Record<string, unknown> = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 본문이 없을 수 있다. 그대로 둔다.
  }

  if (!res.ok) {
    throw new CodesError(
      body.message ?? '처리하지 못했습니다',
      res.status,
      /*
       * ★ 409 가 「쓰고 있어서 못 바꿈」이다(`routes/codes.ts` 의 `inUse`).
       *   403 도 안내에 가깝지만(시스템 코드) 섞지 않는다 — 그쪽은 영구 제약이고
       *   이쪽은 「자료를 정리하면 풀리는」 상태다.
       */
      res.status === 409,
    );
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const seg = (s: string) => encodeURIComponent(s);

// ── 조회 ──────────────────────────────────────────────────────────────────

export const loadTree = (): Promise<CodesTree> =>
  call<{ masters: CodeMaster[]; categories: CodePartition[] }>('/api/codes-admin/tree').then(
    (r) => ({ masters: r.masters, partitions: r.categories }),
  );

export const loadLines = (category: string, useTp: string): Promise<LinesPage> =>
  call<LinesPage>(`/api/codes-admin/${seg(category)}/${seg(useTp)}/lines`);

// ── 분류 ──────────────────────────────────────────────────────────────────

export const createMaster = (input: { category: string; name: string; description: string }) =>
  call<{ category: string }>('/api/codes-admin/masters', json('POST', input));

export const saveMaster = (category: string, input: { name: string; description: string }) =>
  call<{ category: string }>(`/api/codes-admin/masters/${seg(category)}`, json('PATCH', input));

export const removeMaster = (category: string) =>
  call<{ category: string }>(`/api/codes-admin/masters/${seg(category)}`, { method: 'DELETE' });

// ── 파티션 ────────────────────────────────────────────────────────────────

export const createPartition = (
  category: string,
  input: { useTp: string; name: string; description: string },
) =>
  call<{ useTp: string }>(
    `/api/codes-admin/masters/${seg(category)}/partitions`,
    json('POST', input),
  );

export const savePartition = (
  category: string,
  useTp: string,
  input: { name: string; description: string },
) =>
  call<{ useTp: string }>(
    `/api/codes-admin/masters/${seg(category)}/partitions/${seg(useTp)}`,
    json('PATCH', input),
  );

export const removePartition = (category: string, useTp: string) =>
  call<{ useTp: string }>(
    `/api/codes-admin/masters/${seg(category)}/partitions/${seg(useTp)}`,
    { method: 'DELETE' },
  );

// ── 코드값 ────────────────────────────────────────────────────────────────

export const createLine = (
  category: string,
  useTp: string,
  input: { code: string; name: string; description: string; sortOrder: string },
) => call<{ lineId: string }>(`/api/codes-admin/${seg(category)}/${seg(useTp)}/lines`, json('POST', input));

export const saveLine = (
  lineId: string,
  input: {
    code: string;
    name: string;
    description: string;
    sortOrder: string;
    isActive: boolean;
  },
) => call<{ lineId: string }>(`/api/codes-admin/lines/${seg(lineId)}`, json('PATCH', input));

export const removeLine = (lineId: string) =>
  call<{ lineId: string }>(`/api/codes-admin/lines/${seg(lineId)}`, { method: 'DELETE' });

// ── 문구 ──────────────────────────────────────────────────────────────────

/** 「공통 (000)」 */
export const partitionLabel = (p: CodePartition): string => `${p.name} (${p.useTp})`;

/** 「호실 72건 · 계약 호실 2건」 */
export const usageText = (usage: readonly CodeUsage[]): string =>
  usage.map((u) => `${u.label} ${u.count}건`).join(' · ');

/**
 * 이 코드값을 **왜 못 지우는가** — 없으면 `null`(지울 수 있다).
 *
 * ★★ 화면이 판정을 다시 하지 않는다. 서버가 `usage`·`pinnedBy` 를 적어 보내고 여기서는
 *    문구만 만든다 — 두 곳이 따로 판정하면 화면은 통과시키는데 저장이 막힌다.
 */
export function lineBlockReason(line: CodeLine): string | null {
  if (line.isSystem) return '시스템 코드라 지울 수 없습니다';
  if (line.pinnedBy) return `앱이 이 코드값을 직접 씁니다 (${line.pinnedBy})`;
  if (line.usage.length > 0) {
    return `${usageText(line.usage)}에서 쓰고 있습니다. 이름만 고치려면 수정을 쓰세요`;
  }
  return null;
}

/** 코드값 칸·사용여부 칸을 잠가야 하는가 — 이름 칸은 **언제나 열려 있다**. */
export function codeLocked(line: CodeLine): boolean {
  return line.isSystem || line.pinnedBy !== null || line.usage.length > 0;
}

/** 코드값·사용여부를 잠근 이유. 폼이 칸 아래에 적는다. */
export function codeLockReason(line: CodeLine): string | null {
  if (line.isSystem) return '시스템 코드는 코드값을 바꿀 수 없습니다. 이름은 바꿀 수 있습니다';
  if (line.pinnedBy) {
    return `앱이 이 코드값을 직접 써서 코드값·사용여부를 바꿀 수 없습니다 (${line.pinnedBy}). 이름은 바꿀 수 있습니다`;
  }
  if (line.usage.length > 0) {
    return `${usageText(line.usage)}에서 써서 코드값·사용여부를 바꿀 수 없습니다. 이름은 바꿀 수 있습니다`;
  }
  return null;
}

/** 파티션을 **왜 못 지우는가** — 없으면 `null`. */
export function partitionBlockReason(p: CodePartition): string | null {
  if (p.useTp === '000') return '공통(000) 파티션은 지울 수 없습니다. 분류를 지우면 함께 사라집니다';
  if (p.isSystem) return '시스템 파티션이라 지울 수 없습니다';
  if (p.lineCount > 0) return `코드 ${p.lineCount}개가 남아 있습니다. 코드를 먼저 지워 주세요`;
  return null;
}

/** 분류를 **왜 못 지우는가** — 없으면 `null`. */
export function masterBlockReason(m: CodeMaster): string | null {
  if (m.isSystem) return '시스템 분류라 지울 수 없습니다';
  if (m.partitionCount > 0) {
    return `파티션 ${m.partitionCount}개 · 코드 ${m.lineCount}개가 남아 있습니다. 파티션을 먼저 지워 주세요`;
  }
  return null;
}
