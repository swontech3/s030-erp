/**
 * 문의상담 화면이 함께 쓰는 값·형·잔손질 — s030500070 · p1 · p2.
 *
 * ★ 규칙(검증·상태 판정·마스킹)은 여기 없다. `@swonbiz/shared/domain/inquiry` 가
 *   정하고 서버와 화면이 같이 부른다. 이 파일은 **화면에만 필요한 것**만 둔다.
 * ★ 유형·상태의 **이름은 코드 마스터에서 온다**(`/api/inquiries/codes`). 화면에
 *   「입주문의」·「접수」를 박아 두지 않는다.
 */

/** 헤더·푸터·안내 문구에 들어가는 대표번호. 시안 그대로다(02-screens §1). */
export const TEL_LABEL = '070-4355-2312';
export const TEL_HREF = 'tel:07043552312';

export interface CodeOption {
  code: string;
  name: string;
}

export interface InquiryCodes {
  types: CodeOption[];
  statuses: CodeOption[];
}

export interface ListItem {
  inquiryId: string;
  type: string;
  maskedName: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** 코드 마스터 `QU_ST` 의 code. */
  status: string;
}

export interface ThreadMessage {
  messageId: string;
  kind: string;
  body: string | null;
  operatorName: string | null;
  /** `YYYY-MM-DD HH:MM`. */
  createdAt: string;
  /** `YYYY-MM-DD` — 있으면 「수정됨」. */
  editedAt: string | null;
}

export interface InquiryDetail {
  inquiryId: string;
  type: string;
  name: string;
  phone: string;
  email: string;
  companyName: string | null;
  body: string;
  day: string;
  status: string;
}

/** 코드 → 표시 이름. 없는 코드면 코드를 그대로 보여 준다(빈 칸보다 낫다). */
export function codeName(list: readonly CodeOption[], code: string): string {
  return list.find((c) => c.code === code)?.name ?? code;
}

/** `2026-09-26` → `2026.09.26`. 시안의 목록·글 보기 표기다. */
export const dotDate = (day: string): string => day.replaceAll('-', '.');

/** `2026-09-26 09:40` → `2026.09.26 09:40`. */
export const dotDateTime = (at: string): string => `${dotDate(at.slice(0, 10))}${at.slice(10)}`;

/**
 * 연락처 입력 마스크 — 시안 `05-logic.md#5` 와 같은 규칙.
 * 010 이면 3-4-4, 아니면 3-3-4 로 끊는다. 11자리를 넘기지 않는다.
 */
export function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  const mid = d.length > 10 || d.startsWith('010') ? 7 : 6;
  if (d.length > mid) return `${d.slice(0, 3)}-${d.slice(3, mid)}-${d.slice(mid)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}
