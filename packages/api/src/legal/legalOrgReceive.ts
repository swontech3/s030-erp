/**
 * 법무 비입주사 회사 정보 「받기」(삐용 → 법무, 2026-10-23) — 삐용이 회사 정보를 고쳤을 때 부른다.
 * 「보내기」(`legalOrgSync.ts`)의 짝이다. 삐용 팀에 넘기는 규격은 `doc/연동규격_법무_회사정보_받기.md`.
 *
 *   · 부르는 쪽 확인: **실어 온 삐용 토큰**이 운영사(내 메뉴에 단체관리 `S021100010`)이거나, 지금 계정의
 *     단체가 본문 `orgId` 와 같을 때만 받는다. 그 밖은 403(`bbiyong/receiveCaller.ts`)
 *   · 회사 찾기: **단체 ID** 로 찾는다. 함께 온 단체코드는 비교하지 않는다(결정 2026-10-23)
 *   · 법무 회사 정보 줄이 없으면 아무것도 안 하고 **성공**으로 답한다(삐용이 장애로 보지 않게)
 *   · 입주사 단체면 쓰지 않는다(성공으로 답한다) — 입주사 정보는 ERP 회사 표다
 *   · 받는 칸: 본점 주소 3칸 · 사업자번호 · 법인번호만. **받은 칸만** 바꾸고 빈 값은 「안 바꿈」
 *   · 번호는 숫자로 받아 법무 저장 모양(하이픈)으로 바꿔 저장한다(`parseLegalOrgBody` 와 같은 함수)
 *   · ★★ 받은 값을 다시 삐용에 보내지 않는다(되돌아가기 방지) — 이 경로는 `pushLegalOrg` 를 부르지 않는다
 */
import { isDigitMaskComplete, maskValue, DIGIT_MASK_RULE, type DigitMaskKind } from '@swonbiz/shared/domain/masked-caret';
import type { LegalOrgFromBbiyong } from '../db/corpChanges.ts';
import { checkReceiveCaller, type CallerRefused, type ReceiveCallerDeps } from '../bbiyong/receiveCaller.ts';
import { hasEditGrant, parseEditGrant } from './companyEditGrant.ts';

// ★ 부르는 쪽 확인은 입주사 회사 · 직원 받기와 같은 함수다(`bbiyong/receiveCaller.ts`).
export { bearerOf, RECEIVE_REQUIRED_MENU } from '../bbiyong/receiveCaller.ts';

/** 받는 본문의 칸 → [법무 칸, 이름, 최대 길이(null = 제한 없음), 숫자 칸 종류]. */
const RECEIVE_FIELDS: Readonly<
  Record<string, readonly [keyof LegalOrgFromBbiyong, string, number | null, DigitMaskKind | null]>
> = {
  zipCode: ['headZipCode', '본점 우편번호', 10, null],
  address: ['headAddress', '본점 주소', null, null],
  detailAddress: ['headAddressDetail', '본점 상세주소', 200, null],
  bizNumber: ['bizNumber', '사업자번호', null, 'bizno'],
  corpNumber: ['corpNumber', '법인번호', null, 'corpno'],
};

export interface ReceiveFieldError {
  field: string;
  message: string;
}

export type ReceiveParsed =
  | { ok: true; orgId: number; fields: LegalOrgFromBbiyong }
  | { ok: false; errors: ReceiveFieldError[] };

/**
 * 본문 → 바꿀 칸. 없는 칸 · `null` · 빈 문자열(공백뿐 포함)은 「안 바꿈」이라 담지 않는다.
 * 글자가 아닌 값 · 길이 초과 · 자릿수가 틀린 번호는 400 이다(아무 칸도 쓰지 않는다).
 * ★ `orgCode` 는 받아도 보지 않는다. 위 다섯 칸 밖의 칸(회사명 등)도 보지 않는다.
 */
export function parseReceiveBody(raw: unknown): ReceiveParsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: 'body', message: '본문 형식이 올바르지 않습니다' }] };
  }
  const body = raw as Record<string, unknown>;
  const errors: ReceiveFieldError[] = [];

  const id = body.orgId;
  const orgId = typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(orgId) || orgId <= 0) errors.push({ field: 'orgId', message: '단체 ID 는 양의 정수로 보내세요' });

  const fields: LegalOrgFromBbiyong = {};
  for (const [key, [target, label, max, digitKind]] of Object.entries(RECEIVE_FIELDS)) {
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
    } else if (max !== null && t.length > max) {
      errors.push({ field: key, message: `${label}은(는) ${max}자 이내로 보내세요` });
    } else {
      fields[target] = digitKind ? maskValue(digitKind, t) : t;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, orgId, fields };
}

/** 성공 응답의 `skipped` — 쓰지 않은 까닭. 없으면 썼다. */
export type ReceiveSkipped = 'not_found' | 'tenant' | 'no_fields';

export type ReceiveOutcome =
  | { status: 200; body: { ok: true; applied: boolean; skipped: ReceiveSkipped | null } }
  | { status: 400; body: { error: 'invalid_request'; message: string; errors: ReceiveFieldError[] } }
  | CallerRefused;

/** 부르는 쪽 확인(`ReceiveCallerDeps` — 삐용 내 메뉴 · 지금 계정의 단체) + 쓰기. */
export interface ReceiveDeps extends ReceiveCallerDeps {
  /** 공통 코드 `BBIYONG_EDIT_GRANT` 의 `ORG_SELF` 줄 이름(`화면코드:키`). 없으면 null. */
  orgGrantName(): Promise<string | null>;
  /**
   * 운영사 스코프 트랜잭션 하나에서: 입주사면 `tenant`, 법무 줄이 없으면 `not_found`, 바꿨으면 `applied`.
   * ★ 삐용에 보내지 않는다.
   */
  apply(orgId: number, fields: LegalOrgFromBbiyong): Promise<'applied' | 'tenant' | 'not_found'>;
}

/**
 * 받기 한 번 — 토큰 확인 → 본문 → 쓰기. 토큰을 먼저 본다(확인 안 된 쪽에 칸 오류를 알려 주지 않는다).
 * ★ 대상 회사 = 본문 `orgId`. 본문이 틀려 읽지 못하면 대상을 모른다(운영사만 400 을 받는다).
 *   운영사가 아니면 단체 수정 키(`ORG_SELF`)가 있을 때만(키가 없거나 코드 줄이 틀리면 대상을 모른다, C3).
 */
export async function receiveLegalOrg(
  authorization: string | undefined,
  raw: unknown,
  deps: ReceiveDeps,
): Promise<ReceiveOutcome> {
  const parsed = parseReceiveBody(raw);
  const refused = await checkReceiveCaller(
    authorization,
    deps,
    async (menus) => {
      if (!parsed.ok) return null;
      const grant = parseEditGrant(await deps.orgGrantName());
      return grant && hasEditGrant(menus, grant) ? parsed.orgId : null;
    },
    '법무 회사 정보 받기',
  );
  if (refused) return refused;

  if (!parsed.ok) {
    return { status: 400, body: { error: 'invalid_request', message: parsed.errors[0]!.message, errors: parsed.errors } };
  }
  if (Object.keys(parsed.fields).length === 0) {
    return { status: 200, body: { ok: true, applied: false, skipped: 'no_fields' } };
  }

  const out = await deps.apply(parsed.orgId, parsed.fields);
  return out === 'applied'
    ? { status: 200, body: { ok: true, applied: true, skipped: null } }
    : { status: 200, body: { ok: true, applied: false, skipped: out } };
}
