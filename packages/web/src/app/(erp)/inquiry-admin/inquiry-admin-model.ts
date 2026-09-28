/**
 * 문의 관리 화면이 함께 쓰는 형·잔손질 — s0300200080.
 *
 * ★ 규칙(상태 판정·답변 검증)은 여기 없다. `@swonbiz/shared/domain/inquiry` 가 정하고
 *   서버와 화면이 같이 부른다. 이 파일은 **화면에만 필요한 것**만 둔다.
 * ★ 유형·상태의 **이름은 코드 마스터에서 온다**(`QU_TP` · `QU_ST`). 화면에
 *   「입주문의」·「접수」를 박아 두지 않는다 — 공개 화면과 같은 규칙이다.
 */

/** 목록 한 줄. ★ 연락처는 오지 않는다 — 검색은 되지만 목록에 담지 않는다. */
export interface AdminListItem {
  inquiryId: string;
  /** 코드 마스터 `QU_TP` 의 code. 이 이름이 목록의 제목이다. */
  type: string;
  /** ★ 실명. 공개 목록의 「김**」과 달리 운영자는 답할 사람을 알아야 한다. */
  name: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** 코드 마스터 `QU_ST` 의 code. 저장값이 아니라 마지막 글로 판정한 결과다. */
  status: string;
  /** 마지막 글의 종류(`text`·`phone`·`customer`). 스레드가 비었으면 `null`. */
  lastKind: string | null;
  /** `YYYY-MM-DD HH:MM`. 스레드가 비었으면 `null`. */
  lastAt: string | null;
  /** ★ **운영자 화면에만** 있는 값이다(04-data-model §5). 자동 삭제는 없다. */
  retentionPassed: boolean;
}

export interface AdminListResponse {
  total: number;
  page: number;
  pageSize: number;
  /** 「6개월」을 화면에 박지 않는다 — 서버가 `RETENTION_MONTHS` 를 내려준다. */
  retentionMonths: number;
  items: AdminListItem[];
}

export interface AdminInquiry {
  inquiryId: string;
  type: string;
  name: string;
  phone: string;
  email: string;
  companyName: string | null;
  body: string;
  /** `YYYY-MM-DD`. */
  day: string;
  /** `YYYY-MM-DD HH:MM`. */
  createdAt: string;
  status: string;
  retentionPassed: boolean;
  retentionMonths: number;
}

/**
 * 스레드 글 종류의 이름.
 *
 * ★ 코드 마스터에 없는 값이다 — `kind` 는 028 의 CHECK(`text`·`phone`·`customer`)이고
 *   운영·고객이 고르는 코드가 아니다. 코드 마스터에서 가져오는 것은 **상태(QU_ST)와
 *   유형(QU_TP)** 둘이고, 그 둘은 화면에 박지 않았다.
 */
export const KIND_LABEL: Record<string, string> = {
  text: '답변',
  phone: '전화 답변',
  customer: '추가 질문',
};

/** 목록 카드의 「마지막 글」 한 줄. 스레드가 비었으면 원글만 있다는 뜻이다. */
export function lastLine(item: AdminListItem): string {
  if (!item.lastKind || !item.lastAt) return '원글만 · 답변 없음';
  return `${KIND_LABEL[item.lastKind] ?? item.lastKind} · ${item.lastAt.replaceAll('-', '.')}`;
}
