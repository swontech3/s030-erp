/**
 * 등기 설정(s040900010) — 화면이 부르는 주소(`/api/legal/doc-form-settings/**`) · 편집 초안.
 *
 * ★ 저장 규칙은 shared `doc-form-setting.ts` 머리말 1~8 이다. 화면은 칸을 글자로 들고 있다가 저장할 때
 *   본문으로 바꾼다 — 검사는 서버가 한다(칸별 오류 `field` 를 그 칸 아래에 그린다).
 */
import type {
  DocFormDomain,
  DocFormSettingView,
  DocFormSettingsResponse,
} from '@swonbiz/shared/domain/doc-form-setting';
import { INCORP_TAX_KEYS, type IncorpTaxSetting } from '@swonbiz/shared/domain/incorporation-tax';
import { comma } from '@/features/contracts/form-model';

export type { DocFormDomain, DocFormSettingView, DocFormSettingsResponse };

export class DocFormSettingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 칸별 오류의 칸 이름(`label` · `taxes.regFee` · `attachments.2.copies` …). 없으면 null. */
    readonly field: string | null,
  ) {
    super(message);
    this.name = 'DocFormSettingError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new DocFormSettingError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, null);
  }
  let body: { message?: string; errors?: { field?: string }[] } & Record<string, unknown> = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 본문이 없을 수 있다. 그대로 둔다.
  }
  if (!res.ok) throw new DocFormSettingError(body.message ?? '처리하지 못했습니다', res.status, body.errors?.[0]?.field ?? null);
  return body as T;
}

export const loadDocFormSettings = () => call<DocFormSettingsResponse>('/api/legal/doc-form-settings', { cache: 'no-store' });

export const saveDocFormSetting = (body: unknown) =>
  call<{ item: DocFormSettingView }>('/api/legal/doc-form-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.item);

export const deleteDocFormSettingOverride = (domain: DocFormDomain, code: string, companyType: string) =>
  call<{ ok: true }>(
    `/api/legal/doc-form-settings/${encodeURIComponent(domain)}/${encodeURIComponent(code)}/${encodeURIComponent(companyType)}`,
    { method: 'DELETE' },
  );

// =============================================================================
// 편집 초안 — 칸은 모두 글자. 금액은 천 단위 쉼표(`formatMoneyInput`)
// =============================================================================

export type IncorpTaxKey = (typeof INCORP_TAX_KEYS)[number];

export interface Draft {
  label: string;
  formNo: string;
  regPurpose: string;
  regReason: string;
  matter: string;
  matterBody: string;
  isActive: boolean;
  taxes: { regLicense: string; localEdu: string; regFee: string };
  incorpTax: Record<IncorpTaxKey, string>;
  attachments: { name: string; copies: string }[];
}

const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : comma(n));

/** 저장된 줄 → 초안. 줄이 없으면(미설정 · 회사유형 줄 없음) 빈 초안. */
export function draftOf(view: DocFormSettingView | null): Draft {
  const t = view?.taxes;
  const it: IncorpTaxSetting | null = view?.incorpTax ?? null;
  return {
    label: view?.label ?? '',
    formNo: view?.formNo ?? '',
    regPurpose: view?.regPurpose ?? '',
    regReason: view?.regReason ?? '',
    matter: view?.matter ?? '',
    matterBody: view?.matterBody ?? '',
    isActive: view?.isActive ?? true,
    taxes: { regLicense: money(t?.regLicense), localEdu: money(t?.localEdu), regFee: money(t?.regFee) },
    incorpTax: Object.fromEntries(INCORP_TAX_KEYS.map((k) => [k, money(it?.[k])])) as Record<IncorpTaxKey, string>,
    attachments: (view?.attachments ?? []).map((a) => ({ name: a.name, copies: String(a.copies) })),
  };
}

/**
 * 금액 글자 → 숫자. 비면 null. 숫자가 아니면 **글자 그대로 보낸다** — 서버가 칸 이름과 함께 거절한다
 * (화면이 몰래 고치지 않는다).
 */
function num(s: string): number | string | null {
  const v = s.replace(/,/g, '').trim();
  if (v === '') return null;
  return /^\d+$/.test(v) ? Number(v) : s;
}

/** 초안 → PUT 본문. 구분 · 코드 · 회사유형은 고른 것. */
export function bodyOf(domain: DocFormDomain, regTypeKey: string, companyType: string, d: Draft): Record<string, unknown> {
  const common = {
    domain,
    regTypeKey,
    companyType,
    label: d.label,
    formNo: d.formNo,
    regPurpose: d.regPurpose,
    regReason: d.regReason,
    isActive: d.isActive,
    attachments: d.attachments.map((a) => ({ name: a.name, copies: num(a.copies) })),
  };
  if (domain === 'incorporation') {
    return { ...common, incorpTax: Object.fromEntries(INCORP_TAX_KEYS.map((k) => [k, num(d.incorpTax[k])])) };
  }
  return {
    ...common,
    matter: d.matter,
    matterBody: d.matterBody,
    taxes: { regLicense: num(d.taxes.regLicense), localEdu: num(d.taxes.localEdu), regFee: num(d.taxes.regFee) },
  };
}

/** 세액합계 미리 보기 — 등록면허세 + 지방교육세(둘 다 비면 빈칸). 출력과 같은 규칙. */
export function fixedTaxTotal(t: Draft['taxes']): string {
  const a = num(t.regLicense);
  const b = num(t.localEdu);
  if (a === null && b === null) return '';
  if (typeof a === 'string' || typeof b === 'string') return '';
  return comma((a ?? 0) + (b ?? 0));
}
