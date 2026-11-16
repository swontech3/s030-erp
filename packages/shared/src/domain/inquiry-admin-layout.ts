/**
 * 문의상담관리(s030200080) — 앱 안 휴대폰 모양 규칙 · 앱 1단계 5-나 (대표 지시 2026-11-07)
 *
 * ★ 같은 화면 `/inquiry-admin` 이다 — 새 경로 · 새 서버 주소 없음. 처리 기능(답변 · 전화로 답변함 ·
 *   답변 수정)은 그대로이고 **모양만** 바뀐다(ERP CLAUDE.md 「한 업무는 한 화면에서」).
 * ★ 휴대폰 모양은 **앱 안일 때만** 켠다(`isAppUserAgent`). PC 브라우저는 좁은 창이어도 지금 그대로다.
 *   - 목록 : 접수만 · 상태 칩 감춤 · 이름 · 연락처 검색과 유형 거르기는 남김 · 정렬은 서버 그대로(원글 순)
 *     검색칸과 유형 고르기는 **한 줄**(검색칸 = 남는 너비 · 유형 = 오른쪽에 필요한 만큼 · 5-나 덧붙임 2026-11-10)
 *   - 상세 : 글 삭제 감춤(PC 만 — 개인정보를 지우는 되돌릴 수 없는 처리)
 *   - 목록 ↔ 상세는 한 장씩. 상세를 열 때 방문 기록을 남긴다 — 폰 [뒤로] 가 목록으로 돌아온다
 *     (PC 는 지금처럼 `replaceState` — 기록을 쌓지 않는다)
 */

/** 「접수」 상태 코드 — 목록 기본 거르기와 같은 값(`InquiryAdminView`) */
const RECEIVED = 'R';

export interface InquiryAdminLayout {
  /** 휴대폰 모양(목록 ↔ 상세 한 장씩) */
  phone: boolean;
  /** 상태 칩(접수 · 답변완료 · 전체)을 보이는가 */
  statusChips: boolean;
  /** [글 삭제] 를 보이는가 */
  deleteButton: boolean;
  /** 상태 거르기를 이 값으로 못 박는다(`null` 이면 고를 수 있다) */
  fixedStatus: string | null;
  /** 목록에서 상세를 열 때 주소를 적는 방법 */
  detailHistory: 'push' | 'replace';
  /** 유형 고르기를 검색 줄(검색칸 오른쪽)에 둔다 — `false` 면 PC 처럼 아래 거르기 줄에 */
  typeInSearchRow: boolean;
  /**
   * 검색 줄의 「N건」을 보이는가 — 5-나 덧붙임(2026-11-12 대표 폰 확인)
   * ★ 앱 안은 감춘다 — 제목 아래 안내 줄(「접수 N건」)과 같은 숫자가 겹쳐 나온다. 안내 줄은 그대로 둔다.
   */
  searchCount: boolean;
  /**
   * 접수 목록이 비었을 때 둘째 줄 「답변을 기다리는 문의가 없습니다」를 보이는가 — 5-나 덧붙임(2026-11-12 대표 폰 확인)
   * ★ 앱 안은 감춘다 — 첫 줄 「접수 문의가 없습니다」와 뜻이 겹친다. 거른 뒤의 「필터나 검색어를 바꿔 보세요」는 그대로.
   */
  receivedEmptySub: boolean;
  /**
   * 상세를 보고 있을 때 제목 아래 안내 줄(「접수 N건」)을 보이는가 — 3-마 덧붙임 3(2026-11-16 대표 폰 확인)
   * ★ 앱 안은 감춘다 — 한 건의 상세를 보고 있는데 접수 건수는 뜻이 없다. 목록일 때는 그대로 보인다.
   */
  detailHeadNote: boolean;
  /**
   * 상세를 문의-답변 묶음(1회 · 2회)으로 그리는가 — 3-마 덧붙임 3(2026-11-16 대표 지시)
   * ★ 앱 안 : 접수 칸(1행 이름 · 회사명 / 2행 연락처 · 등록일시 / 3행 이메일)과 문의 내용 · 답변 입력을 한 묶음에,
   *   추가 질문이 오면 그 질문과 답변이 다음 묶음. 「답변」 소제목 · 안내 문구는 없고 [전화로 답변함] · [답변 등록] 은 묶음 밖 아래.
   * ★ PC 는 지금 스레드 그대로다.
   */
  detailRounds: boolean;
  /**
   * [전화로 답변함] · [답변 등록] 을 상세 맨 아래에 고정하는가 — 3-마 덧붙임 4(2026-11-16 대표 지시)
   * ★ 앱 안 : 문의 · 답변 묶음만 스크롤되고 단추는 늘 보인다. PC 는 지금 그대로.
   */
  fixedReplyActions: boolean;
}

export function inquiryAdminLayout(inApp: boolean): InquiryAdminLayout {
  return inApp
    ? {
        phone: true,
        statusChips: false,
        deleteButton: false,
        fixedStatus: RECEIVED,
        detailHistory: 'push',
        typeInSearchRow: true,
        searchCount: false,
        receivedEmptySub: false,
        detailHeadNote: false,
        detailRounds: true,
        fixedReplyActions: true,
      }
    : {
        phone: false,
        statusChips: true,
        deleteButton: true,
        fixedStatus: null,
        detailHistory: 'replace',
        typeInSearchRow: false,
        searchCount: true,
        receivedEmptySub: true,
        detailHeadNote: true,
        detailRounds: false,
        fixedReplyActions: false,
      };
}

/** 처음 상태 거르기 — PC 는 지금 그대로(`st=all` → 전체 · 없으면 접수), 앱 안은 접수 고정 */
export function initialStatus(layout: InquiryAdminLayout, st: string | null): string | null {
  if (layout.fixedStatus) return layout.fixedStatus;
  return st === 'all' ? null : st || RECEIVED;
}

/** 빈 목록의 [전체 보기] 가 상태를 어디로 돌리는가 — 앱 안은 접수를 놓지 않는다 */
export function resetStatus(layout: InquiryAdminLayout): string | null {
  return layout.fixedStatus;
}

/**
 * 고른 문의가 `prev` → `next` 로 바뀔 때 주소를 적는 방법.
 * ★ 기록을 남기는 것은 「앱 안 · 목록에서 상세를 열 때」 하나뿐이다. 닫힐 때는 [뒤로] 가 이미
 *   주소를 되돌려 놓았거나(popstate) 조건을 바꾼 것이라, 기록을 또 쌓으면 [뒤로] 가 같은 자리를 돈다.
 */
export function detailHistory(
  layout: InquiryAdminLayout,
  prev: string | null,
  next: string | null,
): 'push' | 'replace' {
  return layout.detailHistory === 'push' && prev === null && next !== null ? 'push' : 'replace';
}

/**
 * 「보관 기간 지남」 안내의 지우는 곳 — 앱 1단계 9-나 (대표 지시 2026-11-08)
 * ★ 앱 안에서는 [글 삭제] 단추를 감추므로(`deleteButton`) 「PC 화면에서」를 앞에 붙인다. PC 는 지금 문구 그대로다.
 */
export function retentionDeleteHint(deleteButtonShown: boolean): string {
  return `${deleteButtonShown ? '' : 'PC 화면에서 '}[글 삭제]로 개인정보를 지워 주세요.`;
}

/** 제목 아래 안내 줄(「접수 N건」)을 보이는가 — 앱 안 상세면 감춘다(3-마 덧붙임 3) */
export function showHeadNote(layout: InquiryAdminLayout, selectedId: string | null): boolean {
  return layout.detailHeadNote || !selectedId;
}

/**
 * 문의-답변 묶음 — 3-마 덧붙임 3 (대표 지시 2026-11-16 · 앱 안 상세)
 *
 * 스레드(시간순 글 목록)를 「질문 하나 + 그 뒤 답변들」 묶음으로 나눈다.
 *   - 1회 = 원글(질문 자리 `question: null`) + 첫 고객 추가 질문 전까지의 답변(글답변 · 전화)
 *   - 2회부터 = 고객 추가 질문 하나(`question` = 그 글의 자리) + 다음 추가 질문 전까지의 답변
 * ★ 글 순서는 서버가 준 그대로(시간순)다 — 여기서 다시 정렬하지 않는다.
 * ★ 돌려주는 것은 자리(index)뿐이다 — 글 내용은 화면이 들고 있는 목록에서 꺼낸다.
 */
export interface InquiryRound {
  /** 1부터 */
  no: number;
  /** 고객 추가 질문의 자리 · `null` 이면 원글 */
  question: number | null;
  /** 답변(글답변 · 전화)의 자리들 */
  answers: number[];
}

export function inquiryRounds(kinds: readonly string[]): InquiryRound[] {
  const rounds: InquiryRound[] = [{ no: 1, question: null, answers: [] }];
  let cur = rounds[0]!;
  kinds.forEach((kind, i) => {
    if (kind === 'customer') {
      cur = { no: rounds.length + 1, question: i, answers: [] };
      rounds.push(cur);
    } else cur.answers.push(i);
  });
  return rounds;
}
