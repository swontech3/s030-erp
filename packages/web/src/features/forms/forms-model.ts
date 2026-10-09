/**
 * 표양식 관리(s030100020) 모델 — 타입 · 호출.
 *
 * ★ 화면 컴포넌트에 `fetch` 를 두지 않는다(코드 관리 `codes-model.ts` 와 같은 구조).
 * ★★ 모든 호출이 **같은 모양으로 실패**한다 — `FormsError`. 409(등기 설정이 쓰는 중)는
 *    `inUse` 로 갈라 화면이 오류가 아니라 **안내**로 그린다.
 * ★ 규칙(정의 검사 · 자리표시 · 칸 편집)은 shared 에 있다 — 여기는 부르기만 한다.
 */
import type { FormDefinition } from '@swonbiz/shared/domain/form-template';

/** 목록 한 줄. */
export interface FormTemplateItem {
  id: string;
  name: string;
  description: string | null;
  /** 코드 `LAW_DOC_TP` 의 코드값. 이름은 `kinds` 에서 찾는다. */
  kind: string;
  /** `YYYY-MM-DD` — 레거시 행과 새 행의 시각 기준이 달라 날짜만 받는다(`db/formTemplates.ts`). */
  updatedOn: string;
  /** 이 양식을 쓰는 등기 설정 수. ★ 0 이 아니면 삭제가 막힌다. */
  linkCount: number;
}

export interface FormTemplate extends FormTemplateItem {
  definition: FormDefinition;
}

/** 양식 종류 선택지 — 코드 관리에서 읽어 온다. */
export interface KindOption {
  code: string;
  name: string;
}

export class FormsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 409 — 쓰고 있어서 못 지운다. 오류가 아니라 **안내**다. */
    readonly inUse: boolean,
  ) {
    super(message);
    this.name = 'FormsError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new FormsError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, false);
  }
  let body: { message?: string } & Record<string, unknown> = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 본문이 없을 수 있다.
  }
  if (!res.ok) throw new FormsError(body.message ?? '처리하지 못했습니다', res.status, res.status === 409);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const seg = (s: string) => encodeURIComponent(s);

export const loadTemplates = () =>
  call<{ templates: FormTemplateItem[]; kinds: KindOption[] }>('/api/form-templates');

export const loadTemplate = (id: string) =>
  call<{ template: FormTemplate; kinds: KindOption[] }>(`/api/form-templates/${seg(id)}`);

export interface TemplateInput {
  name: string;
  description: string;
  kind: string;
  definition: FormDefinition;
}

export const createTemplate = (input: TemplateInput) => call<{ id: string }>('/api/form-templates', json('POST', input));

export const saveTemplate = (id: string, input: TemplateInput) =>
  call<{ id: string }>(`/api/form-templates/${seg(id)}`, json('PATCH', input));

export const duplicateTemplate = (id: string) =>
  call<{ id: string }>(`/api/form-templates/${seg(id)}/duplicate`, json('POST', {}));

export const removeTemplate = (id: string) =>
  call<{ id: string }>(`/api/form-templates/${seg(id)}`, { method: 'DELETE' });

/** 종류 이름. 코드에 없으면(꺼졌거나 지워졌으면) 코드값을 그대로 보인다. */
export const kindName = (kinds: readonly KindOption[], code: string): string =>
  kinds.find((k) => k.code === code)?.name ?? code;
