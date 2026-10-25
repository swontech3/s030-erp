/**
 * 세무 설정(s050100010) 화면 모델 — 불러오기 · 저장 · 초안(draft) ↔ 저장 본문 · 칸별 오류 자리.
 *
 * ★ 화면은 칸을 **글자 그대로** 초안에 들고 있다가 [저장] 때 한 번에 보낸다(결과서 S05-11 6 — [저장]을
 *   눌러야 반영). 입력 모양 검사는 **서버가 한다**(shared `tax-settings.ts`) — 화면은 서버의 칸별 오류
 *   (`errors[]`)를 받아 그 칸에 빨간 테두리를 그린다. 같은 규칙을 화면에 두 벌 두지 않는다.
 * ★ 브라우저는 Fastify 에 직접 붙지 않는다 — `/api/tax/settings`(Next 중계)를 부른다.
 */
import {
  TAX_FIN_KIND_BANK,
  TAX_FIN_KIND_CARD,
  type TaxFieldError,
  type TaxFinKind,
  type TaxSettingsResponse,
} from '@swonbiz/shared/domain/tax-settings';

export type { TaxSettingsResponse, TaxFieldError };

const PATH = '/api/tax/settings';

/** 불러오기 · 저장 실패. 400 이면 칸별 오류(`errors`)가 있다. */
export class TaxSettingsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: TaxFieldError[],
  ) {
    super(message);
    this.name = 'TaxSettingsError';
  }
}

async function call(init?: RequestInit): Promise<TaxSettingsResponse> {
  let res: Response;
  try {
    res = await fetch(PATH, { cache: 'no-store', ...init });
  } catch {
    throw new TaxSettingsError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요', 0, []);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없을 수 있다
  }
  if (!res.ok) {
    const message = typeof body.message === 'string' ? body.message : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요';
    const errors = Array.isArray(body.errors) ? (body.errors as TaxFieldError[]) : [];
    throw new TaxSettingsError(message, res.status, errors);
  }
  return body as unknown as TaxSettingsResponse;
}

export const loadTaxSettings = () => call();

export const saveTaxSettings = (body: TaxSettingsBody) =>
  call({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// =============================================================================
// 초안
// =============================================================================

/** 화면 안에서만 쓰는 줄 열쇠 — 저장 전 새 줄에는 id 가 없어서 따로 둔다. */
let seq = 0;
export const newKey = () => `k${++seq}`;

export interface DraftEmail {
  key: string;
  name: string;
  email: string;
}

export interface DraftFin {
  key: string;
  /** 저장된 줄이면 그 id, 새 줄이면 null. */
  id: string | null;
  kind: TaxFinKind;
  /** 은행(B)이면 은행 코드, 카드(C)면 카드사 코드. */
  instCode: string;
  /** 계좌번호(숫자와 -) · 카드 끝 4자리 — 친 그대로. */
  number: string;
  alias: string;
  isActive: boolean;
}

export interface Draft {
  bizType: string | null;
  withholdingCycle: string;
  taxEmails: DraftEmail[];
  accounts: DraftFin[];
  cards: DraftFin[];
  unusedKinds: string[];
}

export function draftOf(data: TaxSettingsResponse): Draft {
  const fins = data.finAccounts.map(
    (a): DraftFin => ({
      key: newKey(),
      id: a.id,
      kind: a.kind,
      instCode: (a.kind === TAX_FIN_KIND_BANK ? a.bankCode : a.cardCoCode) ?? '',
      number: a.number,
      alias: a.alias ?? '',
      isActive: a.isActive,
    }),
  );
  return {
    bizType: data.settings.bizType,
    withholdingCycle: data.settings.withholdingCycle,
    taxEmails: data.settings.taxEmails.map((e) => ({ key: newKey(), name: e.name ?? '', email: e.email })),
    accounts: fins.filter((f) => f.kind === TAX_FIN_KIND_BANK),
    cards: fins.filter((f) => f.kind === TAX_FIN_KIND_CARD),
    unusedKinds: [...data.settings.unusedKinds],
  };
}

/** 바꾼 것이 있는가 — 줄 열쇠는 빼고 값만 견준다. */
export function sameDraft(a: Draft, b: Draft): boolean {
  const strip = (d: Draft) => ({
    ...d,
    taxEmails: d.taxEmails.map(({ key: _k, ...r }) => r),
    accounts: d.accounts.map(({ key: _k, ...r }) => r),
    cards: d.cards.map(({ key: _k, ...r }) => r),
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export interface TaxSettingsBody {
  bizType: string | null;
  withholdingCycle: string;
  taxEmails: { name: string; email: string }[];
  unusedKinds: string[];
  finAccounts: {
    id: string | null;
    kind: TaxFinKind;
    bankCode: string | null;
    cardCoCode: string | null;
    number: string;
    alias: string;
    isActive: boolean;
  }[];
}

/**
 * 초안 → 저장 본문. 계좌 다음 카드 순서로 보낸다 — 서버의 칸별 오류 `finAccounts[i]` 는 이 순서의 i 다
 * (`finOrder` 가 i → 줄 열쇠를 돌려준다). 메일은 빈 줄까지 그대로 보낸다 — 버리는 것은 서버가 하고,
 * `taxEmails[i]` 의 i 가 화면 줄 순서와 같게 하려는 것이다.
 */
export function bodyOf(d: Draft): TaxSettingsBody {
  return {
    bizType: d.bizType,
    withholdingCycle: d.withholdingCycle,
    taxEmails: d.taxEmails.map((e) => ({ name: e.name, email: e.email })),
    unusedKinds: d.unusedKinds,
    finAccounts: finOrder(d).map((f) => ({
      id: f.id,
      kind: f.kind,
      bankCode: f.kind === TAX_FIN_KIND_BANK ? f.instCode : null,
      cardCoCode: f.kind === TAX_FIN_KIND_CARD ? f.instCode : null,
      number: f.number,
      alias: f.alias,
      isActive: f.isActive,
    })),
  };
}

export const finOrder = (d: Draft): DraftFin[] => [...d.accounts, ...d.cards];

/**
 * 서버의 칸 이름 → 화면 칸 열쇠.
 *   `taxEmails[2].email` → `email:{줄 열쇠}:email` · `finAccounts[3].number` → `fin:{줄 열쇠}:number` ·
 *   `bizType` · `withholdingCycle` · `taxEmails` · `unusedKinds` 는 그대로.
 * ★ 기관 코드 칸(`bankCode` · `cardCoCode`)은 화면의 한 선택 칸(`inst`)이다.
 */
export function errorKeyOf(field: string, d: Draft): string {
  const m = /^(taxEmails|finAccounts)\[(\d+)\]\.?(\w*)$/.exec(field);
  if (!m) return field;
  const [, list, idx, sub] = m;
  if (list === 'taxEmails') {
    const row = d.taxEmails[Number(idx)];
    return row ? `email:${row.key}:${sub || 'email'}` : field;
  }
  const row = finOrder(d)[Number(idx)];
  if (!row) return field;
  const col = sub === 'bankCode' || sub === 'cardCoCode' ? 'inst' : sub || 'number';
  return `fin:${row.key}:${col}`;
}
