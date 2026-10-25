/**
 * 입주사 직원 정보 「받기」(삐용 → ERP, 결정 2026-10-23) — 삐용이 직원 정보를 고쳤을 때 부른다.
 * 직원 보내기(`bbiyong/memberSync.ts` 의 `U`)의 짝이고, 회사 받기(`companyReceive.ts`)와 같은 모양이다.
 * 삐용 팀에 넘기는 규격은 `doc/연동규격_입주사_직원정보_받기.md`.
 *
 *   · 부르는 쪽 확인: 실어 온 삐용 토큰이 운영사이거나, 지금 계정의 단체가 그 직원이 속한 회사의
 *     단체와 같아야 한다(`bbiyong/receiveCaller.ts`)
 *   · 직원 찾기: **삐용 회원번호**(`link_s020_member_id`)로 찾는다. 없으면 아무것도 안 하고 **성공**
 *   · 받는 칸: 이름 · 이메일 · 연락처. **받은 칸만** 바꾸고 빈 값은 「안 바꿈」. 연락처는 숫자로 받아
 *     ERP 저장 모양(하이픈)으로 저장한다
 *   · **활성 대표** 직원이고 이름을 받았으면 회사 표의 대표자명(`ceo_name`, 사본)도 맞춘다
 *   · 받은 이메일이 같은 회사의 다른 활성 직원과 겹치면 400 — 아무것도 쓰지 않는다
 *   · ★★ 받은 값을 삐용에 다시 보내지 않는다(되돌아가기 방지) — `syncMembersForCompany` 를 부르지 않는다.
 *     DB 값을 바꾸므로 다음 계약 폼 저장의 「바뀜」 판정(`replaceMembers` 가 DB 와 비교)에도 걸리지 않는다
 */
import { isDigitMaskComplete, maskValue, DIGIT_MASK_RULE } from '@swonbiz/shared/domain/masked-caret';
import type { MemberFromBbiyong } from '../db/companies.ts';
import { checkReceiveCaller, type CallerRefused, type ReceiveCallerDeps } from '../bbiyong/receiveCaller.ts';
import type { ReceiveFieldError } from './companyReceive.ts';

export type MemberReceiveParsed =
  | { ok: true; memberId: number; fields: MemberFromBbiyong }
  | { ok: false; errors: ReceiveFieldError[] };

/**
 * 본문 → 바꿀 칸. 없는 칸 · `null` · 빈 문자열(공백뿐 포함)은 「안 바꿈」이라 담지 않는다.
 * 글자가 아닌 값 · 자릿수가 틀린 연락처는 400 이다. ★ `orgId` · `orgCode` 는 받아도 보지 않는다.
 */
export function parseMemberReceiveBody(raw: unknown): MemberReceiveParsed {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [{ field: 'body', message: '본문 형식이 올바르지 않습니다' }] };
  }
  const body = raw as Record<string, unknown>;
  const errors: ReceiveFieldError[] = [];

  const id = body.memberId;
  const memberId = typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(memberId) || memberId <= 0) {
    errors.push({ field: 'memberId', message: '회원번호는 양의 정수로 보내세요' });
  }

  const fields: MemberFromBbiyong = {};
  const textOf = (key: string, label: string): string | null => {
    const v = body[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') {
      errors.push({ field: key, message: `${label}은(는) 글자로 보내세요` });
      return null;
    }
    const t = v.trim();
    return t === '' ? null : t;
  };
  const name = textOf('memberName', '이름');
  if (name !== null) fields.name = name;
  const email = textOf('email', '이메일');
  if (email !== null) fields.email = email;
  const phone = textOf('hpNo', '연락처');
  if (phone !== null) {
    if (!isDigitMaskComplete('phone', phone)) errors.push({ field: 'hpNo', message: `연락처는 ${DIGIT_MASK_RULE.phone}로 보내세요` });
    else fields.phone = maskValue('phone', phone);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, memberId, fields };
}

/** 성공 응답의 `skipped` — 쓰지 않은 까닭. 없으면 썼다. */
export type MemberReceiveSkipped = 'not_found' | 'no_fields';

export type MemberReceiveOutcome =
  | { status: 200; body: { ok: true; applied: boolean; skipped: MemberReceiveSkipped | null } }
  | { status: 400; body: { error: 'invalid_request'; message: string; errors: ReceiveFieldError[] } }
  | CallerRefused;

/** 부르는 쪽 확인(`ReceiveCallerDeps` — 삐용 내 메뉴 · 지금 계정의 단체) + 대상 찾기 + 쓰기. */
export interface MemberReceiveDeps extends ReceiveCallerDeps {
  /** 회원번호의 직원이 속한 입주사의 삐용 단체 ID(`link_s020_org_id`). 직원 · 연결이 없으면 null. */
  orgIdOfMember(memberId: number): Promise<number | null>;
  /**
   * 운영사 스코프 트랜잭션 하나에서: 회원번호의 직원이 없으면 `not_found`, 이메일이 같은 회사 다른 활성
   * 직원과 겹치면 `email_taken`(아무것도 쓰지 않는다), 바꿨으면 `applied`(활성 대표면 `ceo_name` 도).
   * ★ 삐용에 보내지 않는다.
   */
  apply(memberId: number, fields: MemberFromBbiyong): Promise<'applied' | 'not_found' | 'email_taken'>;
}

const EMAIL_TAKEN = '같은 회사의 다른 직원이 쓰는 이메일입니다';

/**
 * 받기 한 번 — 토큰 확인 → 본문 → 쓰기.
 * ★ 대상 회사 = `memberId` 의 직원이 속한 회사의 단체 ID. 본문이 틀리거나 직원이 없으면 대상을 모른다
 *   (운영사만 400 · `not_found` 를 받는다).
 */
export async function receiveMember(
  authorization: string | undefined,
  raw: unknown,
  deps: MemberReceiveDeps,
): Promise<MemberReceiveOutcome> {
  const parsed = parseMemberReceiveBody(raw);
  const refused = await checkReceiveCaller(
    authorization,
    deps,
    async () => (parsed.ok ? deps.orgIdOfMember(parsed.memberId) : null),
    '입주사 직원 정보 받기',
  );
  if (refused) return refused;

  if (!parsed.ok) {
    return { status: 400, body: { error: 'invalid_request', message: parsed.errors[0]!.message, errors: parsed.errors } };
  }
  if (Object.keys(parsed.fields).length === 0) {
    return { status: 200, body: { ok: true, applied: false, skipped: 'no_fields' } };
  }

  const out = await deps.apply(parsed.memberId, parsed.fields);
  if (out === 'email_taken') {
    return { status: 400, body: { error: 'invalid_request', message: EMAIL_TAKEN, errors: [{ field: 'email', message: EMAIL_TAKEN }] } };
  }
  return out === 'applied'
    ? { status: 200, body: { ok: true, applied: true, skipped: null } }
    : { status: 200, body: { ok: true, applied: false, skipped: 'not_found' } };
}
