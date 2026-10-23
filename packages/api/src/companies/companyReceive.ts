/**
 * 입주사 회사 정보 「받기」(삐용 → ERP, 결정 2026-10-23) — 삐용이 회사 정보를 고쳤을 때 부른다.
 * 「보내기」(`companyOrgSync.ts`)의 짝이고, 법무 받기(`legal/legalOrgReceive.ts`)와 같은 모양이다.
 * 삐용 팀에 넘기는 규격은 `doc/연동규격_입주사_회사정보_받기.md`.
 *
 *   · 부르는 쪽 확인: 실어 온 삐용 토큰의 「내 메뉴」에 단체관리가 있어야 한다(`bbiyong/receiveCaller.ts`)
 *   · 회사 찾기: **단체 ID**(`link_s020_org_id`)로 찾는다. 없으면 아무것도 안 하고 **성공**으로 답한다
 *   · 받는 칸: 회사명 · 사업자번호 · 법인번호 · 업태 · 종목. **주소는 받지 않는다**(보내도 보지 않는다)
 *   · **받은 칸만** 바꾸고 빈 값은 「안 바꿈」. 번호는 숫자로 받아 ERP 저장 모양(하이픈)으로 저장한다
 *   · 사업자번호가 다른 입주사와 겹치면 409 — 아무것도 쓰지 않는다(`biz_number` UNIQUE)
 *   · ★★ 받은 값을 삐용에 다시 보내지 않는다(되돌아가기 방지) — `pushCompanyOrg` 를 부르지 않는다
 */
import { isDigitMaskComplete, maskValue, DIGIT_MASK_RULE, type DigitMaskKind } from '@swonbiz/shared/domain/masked-caret';
import type { CompanyFromBbiyong } from '../db/companies.ts';
import type { MyMenusOutcome } from '../bbiyong/types.ts';
import { checkReceiveCaller, type CallerRefused } from '../bbiyong/receiveCaller.ts';

/** 받는 본문의 칸 → [ERP 칸, 이름, 숫자 칸 종류]. 칸 이름은 `erp-patch-org` 와 같다. */
const RECEIVE_FIELDS: Readonly<Record<string, readonly [keyof CompanyFromBbiyong, string, DigitMaskKind | null]>> = {
  orgName: ['companyName', '회사명', null],
  bizNumber: ['bizNumber', '사업자번호', 'bizno'],
  corpNumber: ['corpNumber', '법인번호', 'corpno'],
  businessType: ['businessType', '업태', null],
  businessItem: ['businessItem', '종목', null],
};

export interface ReceiveFieldError {
  field: string;
  message: string;
}

export type CompanyReceiveParsed =
  | { ok: true; orgId: number; fields: CompanyFromBbiyong }
  | { ok: false; errors: ReceiveFieldError[] };

/**
 * 본문 → 바꿀 칸. 없는 칸 · `null` · 빈 문자열(공백뿐 포함)은 「안 바꿈」이라 담지 않는다.
 * 글자가 아닌 값 · 자릿수가 틀린 번호는 400 이다(아무 칸도 쓰지 않는다).
 */
export function parseCompanyReceiveBody(raw: unknown): CompanyReceiveParsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: 'body', message: '본문 형식이 올바르지 않습니다' }] };
  }
  const body = raw as Record<string, unknown>;
  const errors: ReceiveFieldError[] = [];

  const id = body.orgId;
  const orgId = typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(orgId) || orgId <= 0) errors.push({ field: 'orgId', message: '단체 ID 는 양의 정수로 보내세요' });

  const fields: CompanyFromBbiyong = {};
  for (const [key, [target, label, digitKind]] of Object.entries(RECEIVE_FIELDS)) {
    const v = body[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') {
      errors.push({ field: key, message: `${label}은(는) 글자로 보내세요` });
      continue;
    }
    const t = v.trim();
    if (t === '') continue;
    if (digitKind && !isDigitMaskComplete(digitKind, t)) {
      errors.push({ field: key, message: `${label}은(는) ${DIGIT_MASK_RULE[digitKind]}로 보내세요` });
    } else {
      fields[target] = digitKind ? maskValue(digitKind, t) : t;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, orgId, fields };
}

/** 성공 응답의 `skipped` — 쓰지 않은 까닭. 없으면 썼다. */
export type CompanyReceiveSkipped = 'not_found' | 'no_fields';

export type CompanyReceiveOutcome =
  | { status: 200; body: { ok: true; applied: boolean; skipped: CompanyReceiveSkipped | null } }
  | { status: 400; body: { error: 'invalid_request'; message: string; errors: ReceiveFieldError[] } }
  | { status: 409; body: { error: 'duplicate'; message: string } }
  | CallerRefused;

export interface CompanyReceiveDeps {
  /** 삐용 「내 메뉴」 — 받은 토큰 그대로(`BbiyongAuth.myMenus`). */
  myMenus(accessToken: string): Promise<MyMenusOutcome>;
  /**
   * 운영사 스코프 트랜잭션 하나에서: 단체 ID 의 입주사가 없으면 `not_found`, 바꿨으면 `applied`,
   * 사업자번호가 겹치면 `duplicate`(아무것도 쓰지 않는다). ★ 삐용에 보내지 않는다.
   */
  apply(orgId: number, fields: CompanyFromBbiyong): Promise<'applied' | 'not_found' | 'duplicate'>;
}

/** 받기 한 번 — 토큰 확인 → 본문 → 쓰기. */
export async function receiveCompany(
  authorization: string | undefined,
  raw: unknown,
  deps: CompanyReceiveDeps,
): Promise<CompanyReceiveOutcome> {
  const refused = await checkReceiveCaller(authorization, deps.myMenus, '입주사 회사 정보 받기');
  if (refused) return refused;

  const parsed = parseCompanyReceiveBody(raw);
  if (!parsed.ok) {
    return { status: 400, body: { error: 'invalid_request', message: parsed.errors[0]!.message, errors: parsed.errors } };
  }
  if (Object.keys(parsed.fields).length === 0) {
    return { status: 200, body: { ok: true, applied: false, skipped: 'no_fields' } };
  }

  const out = await deps.apply(parsed.orgId, parsed.fields);
  if (out === 'duplicate') {
    return { status: 409, body: { error: 'duplicate', message: '다른 입주사가 쓰는 사업자번호입니다' } };
  }
  return out === 'applied'
    ? { status: 200, body: { ok: true, applied: true, skipped: null } }
    : { status: 200, body: { ok: true, applied: false, skipped: 'not_found' } };
}
