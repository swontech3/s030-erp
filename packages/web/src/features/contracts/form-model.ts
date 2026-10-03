/**
 * 계약 폼의 상태 모양과 파생값 — s030200040.
 *
 * =============================================================================
 * ★★★ 이 파일에 계산식을 쓰지 않는다
 * =============================================================================
 * 금액·종료일·첫달납부액은 전부 `@swonbiz/shared/domain/contract-amounts` 가 낸다.
 * 여기가 하는 일은 **화면 값(문자열·빈 칸)을 그 함수가 받는 모양으로 바꾸고, 함수가
 * 던지는 경우를 «아직 못 낸다»로 옮기는 것**뿐이다.
 *
 * 시안(`s030200040.html`)에는 같은 계산이 JS 로 들어 있다. **베끼지 않았다** —
 * 네 곳이 서버와 다르기 때문이다(`doc/CONTRACT_DATA_MODEL.md` §A-4).
 *
 *   부가세 끝수      시안 `Math.round`      서버 **버림**
 *   종료일 말일 처리 시안 없음(오버플로)    서버 **그 달 말일로 맞춘 뒤 −1일**
 *   기간 0           시안 빈 문자열         서버 **오류**
 *   납부방법         시안 한글 문자열 비교  서버 **코드값 `M`·`C`**
 *
 * 그래서 이 파일에 `Math.round` 도 `setMonth` 도 없다. 있으면 그 순간 두 벌이 된다.
 */
import {
  PAYMENT_METHOD,
  calcEndDate,
  calcFirstPayment,
  calcRowAmounts,
  calcTotals,
  type ContractTotals,
} from '@swonbiz/shared/domain/contract-amounts';
import { caretForMasked } from '@swonbiz/shared/domain/masked-caret';

/** 계약 항목 한 줄. 금액은 전부 원 단위 정수이고, 안 채운 칸은 0 이다. */
export interface ItemRow {
  /** 코드 `ROOM_TP`. 표시명이 아니다. */
  roomType: string;
  /** ★ 저장 키. 화면 표시는 `roomName` 이지만 값은 이쪽이다. 안 고르면 빈 문자열. */
  spaceId: string;
  /** 호실의 기준가(월회비). 읽기 전용 표시이고 호실을 고를 때만 바뀐다. */
  standardFee: number;
  deposit: number;
  monthlyFee: number;
  /** 「계산서」 열 — **부가세 대상 여부**다. 발행 여부가 아니다. */
  vatYn: boolean;
}

/** 섹션 3 사용자 한 줄. 1행은 섹션 1 대표자를 미러링하므로 값을 갖지 않는다. */
export interface UserRow {
  /**
   * `tb_s080_members.member_id`. 새 줄이면 `null`.
   * ★ 되돌려 보내야 **같은 사람으로 갱신**된다. 빼면 저장할 때마다 사람이 새로 생기고
   *   옛 행은 비활성으로 밀려나 예약 이력이 끊긴다.
   */
  memberId: string | null;
  name: string;
  phone: string;
  mailId: string;
  /** 도메인 Select 의 값. 목록에 없는 주소면 `DOMAIN_CUSTOM` 이고 실제 값은 아래 칸이다. */
  domain: string;
  /** 도메인 Select 가 「직접입력」일 때만 쓴다. 섹션 1 의 `emailDomainCustom` 과 같은 모양이다. */
  domainCustom: string;
  memo: string;
  /** 저장 대상 여부. 미체크 행도 **입력값은 유지**하고 저장 때만 뺀다. */
  selected: boolean;
}

/** 섹션 1. ★ 저장 경로가 아직 없다 — ContractForm 의 「이 화면이 저장하지 않는 것」 참조. */
export interface CompanyState {
  company: string;
  bizno: string;
  memberType: string;
  corpno: string;
  industry: string;
  bizKind: string;
  ceo: string;
  phone: string;
  emailId: string;
  emailDomain: string;
  /** 도메인 Select 가 「직접입력」일 때만 쓴다. */
  emailDomainCustom: string;
  zip: string;
  addr1: string;
  addr2: string;
  note1: string;
}

/** 섹션 2 계약 조건. 계약당 1세트. */
export interface TermsState {
  buildId: string;
  floorId: string;
  contractRoom: string;
  /** 코드 `PAYMENT_METHOD` — `M` 월납 / `C` 일시불. */
  paymentMethod: string;
  /** 코드 `ACCESS_ROUTE`. */
  accessRoute: string;
  contractDate: string;
  /** 문자열이다 — 비워 두는 상태가 있어야 해서 숫자로 두지 않는다. */
  months: string;
  /**
   * 무상 개월수. 기본 `'0'` 이고 문자열이다(`months` 와 같은 이유).
   *
   * ★ **계약 개월수보다 작아야 한다.** 화면 검사는 `freeMonthsError` 하나이고
   *   서버도 같은 규칙(`requireFreeMonths`)을 본다.
   */
  freeMonths: string;
  startDate: string;
  memo: string;
}

export interface SpaceOption {
  spaceId: string;
  buildId: string;
  buildName: string;
  floorId: string;
  floorName: string;
  roomName: string;
  roomType: string;
  standardFee: number | null;
  deposit: number | null;
  /**
   * 「입주 가능 회사 수」 — 이 호실에 몇 곳까지 들어가는가(`tb_s080_spaces.max_companies`).
   *
   * ★ 셀렉트를 거르는 수다. 서버도 **같은 수**로 저장을 다시 본다 — 둘이 갈리면
   *   목록에는 뜨는데 저장이 막힌다(`domain/space-occupancy`).
   */
  maxCompanies: number;
}

export interface CodeOption {
  category: string;
  code: string;
  name: string;
}

/**
 * 회원구분 — ★ **코드 테이블에서 온다**(`MEMBER_TYPE` / `use_tp='000'`).
 *
 * ★★ **시안의 회원구분과 목록이 다르다.** 시안은 「프리랜서 / 개인사업자 / 법인」 3종이고
 *    DB 의 `MEMBER_TYPE 000` 은 **법인 형태** 5종이다 — 주식회사(R) · 유한회사(A) ·
 *    농/어업회사법인(C) · 사회적 기업/협동조합(S) · 개인(P).
 *    「프리랜서」·「개인사업자」라는 글자는 DB 전체에 0건이다
 *    (`doc/CONTRACT_DATA_MODEL.md` §C-3 ⑤ · `doc/CODE_MASTER_ANALYSIS.md` §G-4).
 *
 *    2026-09-19 **DB 쪽을 따르기로 했다.** 그래서 아래 두 규칙이 옮겨졌다:
 *      - 법인 여부 — 예전엔 「법인」 한 값. 지금은 **개인(P)이 아닌 전부**
 *      - 사업자등록증 필수 — 예전엔 「프리랜서가 아니면」. 지금은 **법인이면**
 *        (개인(P) 안에 프리랜서와 개인사업자가 섞여 있어 갈라낼 수 없다)
 */
export const MEMBER_TYPE_CATEGORY = 'MEMBER_TYPE';

/** 회원구분 Select 의 목록. 코드 응답에서 뽑는다 — 표시명이 필요해 행째로 준다. */
export const memberTypesOf = (codes: readonly CodeOption[]): readonly CodeOption[] =>
  codes.filter((c) => c.category === MEMBER_TYPE_CATEGORY);

/** 개인사업자 — 사업자등록을 한 개인. */
export const MEMBER_TYPE_SOLE_PROPRIETOR = 'P';
/** 개인 — 사업자등록이 아직 없을 수 있다(시안의 「프리랜서」 자리다). 017 이 만들었다. */
export const MEMBER_TYPE_INDIVIDUAL = 'Z';

/** 비법인 코드 둘. 나머지(`R`·`A`·`C`·`S`)는 전부 법인격이다. */
const NON_CORP_MEMBER_TYPES: readonly string[] = [MEMBER_TYPE_SOLE_PROPRIETOR, MEMBER_TYPE_INDIVIDUAL];

/**
 * 법인격인가 — 법인등록번호 활성 · 법인등기부등본 카드 · 저장 시 `corpNumber` 포함.
 *
 * ★ 미선택(`''`)은 **법인이 아니다.** 안 고른 상태에서 법인 전용 칸이 열리면
 *   운영자가 채우고, 그 값은 저장될 때 버려진다(`corpNumber` 는 법인일 때만 실린다).
 */
export const isCorpMemberType = (code: string): boolean =>
  code.trim() !== '' && !NON_CORP_MEMBER_TYPES.includes(code);

/**
 * 사업자등록증을 내야 하는가 — **개인(`Z`)만 면제**다.
 *
 * ★ 017 전에는 「법인이면 필수」였다. 그때는 `P`(개인) 하나에 개인사업자와 프리랜서가
 *   섞여 있어 갈라낼 수 없었고, 그 결과 **개인사업자가 사업자등록증 없이 통과**했다.
 *   017 이 `P` 개인사업자 / `Z` 개인으로 나눠서 시안의 3분법이 그대로 표현된다.
 *
 * ★ 미선택(`''`)은 면제다. 구분을 고르기 전에 서류부터 요구하지 않는다.
 */
export const needsBizLicense = (code: string): boolean =>
  code.trim() !== '' && code !== MEMBER_TYPE_INDIVIDUAL;

/**
 * 이메일 도메인 카테고리 — ★ **코드 테이블에서 온다**(마이그레이션 016).
 *
 * 2026-09-19 이전에는 `EMAIL_DOMAINS` 화면 상수였다. DB 에 코드가 없어서였는데
 * (`doc/LEGACY_DATA_SURVEY.md` §C-3 ④), 016 이 `EMAIL_DOMAIN` 카테고리를 만들었다.
 * 도메인은 운영자가 늘리고 줄이는 값이지 배포로 바꿀 값이 아니다.
 *
 * ★ 이 카테고리는 `code` 와 `name` 이 **둘 다 도메인 문자열**이다. 화면은 `code` 를
 *   그대로 이메일에 붙인다(`joinEmail`).
 */
export const EMAIL_DOMAIN_CATEGORY = 'EMAIL_DOMAIN';

/** 도메인 Select 의 목록. 코드 응답에서 뽑는다 — 없으면 빈 배열이다. */
export const emailDomainsOf = (codes: readonly CodeOption[]): readonly string[] =>
  codes.filter((c) => c.category === EMAIL_DOMAIN_CATEGORY).map((c) => c.code);

/**
 * ★ 「선택하세요」와 「직접입력」은 **코드가 아니다.** Select 의 조작 장치라 화면이
 *   앞뒤에 붙인다. 코드 테이블에 넣으면 운영자가 지울 수 있게 되고, 지우면 Select 가
 *   값 없는 상태로 열린다.
 */
export const DOMAIN_PLACEHOLDER = '선택하세요';
/** 「직접입력」 Select 의 값. 도메인 문자열과 겹치지 않는 값이어야 한다. */
export const DOMAIN_CUSTOM = 'custom';

/** 섹션 3 최대 행수. 계약 항목 상한(10)은 shared 의 `MAX_CONTRACT_SPACES` 다. */
export const MAX_USERS = 20;

/**
 * ★★★ 섹션마다 **저장 경로가 있는가**.
 *
 * 4-4 는 계약 조건(섹션 2)만 저장했다. 나머지 셋은 입력은 되는데 새로고침하면
 * 조용히 사라졌다 — **오류도 없이.** 운영자가 서류를 다 채우고 저장을 눌렀는데
 * 값이 없어지는 것은 버그보다 나쁘다. 화면이 거짓말을 하는 것이다.
 *
 * 그래서 저장 경로가 없는 섹션은 **읽기 전용으로 잠그고 이유를 띄운다.**
 * 경로가 붙으면 여기를 `true` 로 바꾸는 것이 전부다 — 잠금 코드가 한 곳에만 있다.
 *
 * ★ 이 표를 `true` 로 바꾸기 전에 **저장하고 새로고침해서 값이 남는지** 먼저 확인한다.
 */
export const SECTION_SAVEABLE: Record<1 | 2 | 3 | 4, boolean> = {
  /** 회사 기본정보 — `PATCH /companies/:id` (3-4). */
  1: true,
  /** 계약정보 — `POST/PATCH /contracts` (4-3). */
  2: true,
  /** 입주자 사용자 — `PUT /companies/:id/members` (3-4). */
  3: true,
  /**
   * 첨부 서류 — **있다**(CONT-17, 2026-09-20).
   *
   * ★ 다른 셋과 성격이 다르다. 1·2·3 은 폼의 [저장]·[임시저장] 이 한꺼번에 보내지만,
   *   첨부는 **파일을 고른 즉시** 올라간다(`POST /api/companies/:id/files`).
   *   그래서 이 값은 「잠금 안내를 띄울까」가 아니라 「저장 경로가 있는가」의 기록이다.
   */
  4: true,
};

/** 저장 경로가 없는 섹션에 띄우는 안내. `05-patterns.md` §5 「잠금 섹션」 형식을 쓴다. */
export const NOT_SAVEABLE_NOTICE = '아직 저장되지 않습니다. 입력해도 값이 남지 않으니 준비된 뒤에 채워 주세요.';
export const NOT_SAVEABLE_BADGE = '준비 중';

export const ROW_TEMPLATE: ItemRow = {
  roomType: '',
  spaceId: '',
  standardFee: 0,
  deposit: 0,
  monthlyFee: 0,
  vatYn: true,
};

export const USER_TEMPLATE: UserRow = {
  memberId: null,
  name: '',
  phone: '',
  mailId: '',
  domain: '',
  domainCustom: '',
  memo: '',
  selected: true,
};

/* ══════════════════════════════════════════════════════════════════════════
   표시 형식
   ══════════════════════════════════════════════════════════════════════════ */

export const comma = (n: number): string => (n || 0).toLocaleString('ko-KR');

/** 콤마가 섞인 입력값 → 정수. 빈 칸은 0 이다. */
export const toNumber = (v: string): number => {
  const digits = v.replace(/[^0-9]/g, '');
  return digits ? Number.parseInt(digits, 10) : 0;
};

/**
 * 이메일 **아이디** 칸 — 들어오는 즉시 못 쓰는 글자를 떨어뜨린다.
 *
 * =============================================================================
 * ★ 왜 검증이 아니라 마스크인가
 * =============================================================================
 * 이메일은 아이디 칸과 도메인 칸을 합쳐서 저장한다(`joinEmail`). 한글이나 공백이
 * 섞인 채로 합쳐지면 **형식이 깨진 주소가 그대로 저장되고**, 그 회사에는 아무것도
 * 보낼 수 없게 된다. 저장 직전에 막으면 이미 여러 칸을 채운 뒤라 되돌리기가 번거롭다 —
 * 애초에 들어가지 않게 한다. 전화번호·사업자번호와 같은 방식이다.
 *
 * ★★ **`.` `_` `-` 는 허용한다.** 「영문·숫자만」을 글자 그대로 적용하면
 *    `hong.gil-dong@…` 같은 **실재하는 주소를 입력할 수 없다.** 세 글자는 이메일
 *    아이디에 흔하고, 막아서 얻는 것이 없다. 막는 것은 한글·공백·`@` 와 그 밖의
 *    기호다 — 이들은 섞이면 주소가 깨지거나(공백·한글) 칸의 경계를 흐린다(`@`).
 *
 * ★ `+` 는 뺐다(`user+tag@…`). 개인 메일에서는 흔하지만 회사 대표 주소에서는 드물고,
 *   필요하면 이 정규식 한 곳만 고치면 된다.
 */
export function maskEmailId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, '');
}

/**
 * 마스크 3종 — 시안 `maskValue`(`05-logic.md` §5) 그대로다.
 * 계산이 아니라 **표시 형식**이라 서버와 갈릴 것이 없다.
 */
export function maskValue(kind: 'bizno' | 'corpno' | 'phone', raw: string): string {
  const max = kind === 'corpno' ? 13 : kind === 'phone' ? 11 : 10;
  const d = raw.replace(/\D/g, '').slice(0, max);

  if (kind === 'bizno') {
    if (d.length > 5) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
  }
  if (kind === 'corpno') {
    return d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
  }
  // 010 은 3-4-4, 그 외는 3-3-4
  const mid = d.startsWith('010') || d.length > 10 ? 7 : 6;
  if (d.length > mid) return `${d.slice(0, 3)}-${d.slice(3, mid)}-${d.slice(mid)}`;
  return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
}

/**
 * 마스킹 칸의 `onChange` — **값을 바꾸면서 커서를 제자리에 둔다** (CONT-19).
 *
 * ★★ 제어 컴포넌트에 마스크를 씌우면 중간을 고칠 때 **커서가 맨 끝으로 튄다.**
 *    React 가 새 값을 인풋에 써 넣고, 값을 쓰면 브라우저가 커서를 뒤로 보내기 때문이다.
 *    실측: `111-22-85905` 의 2번 자리에서 `9` → 커서 12(맨 끝). 앞자리를 이어서
 *    고칠 수 없다.
 *
 * ★ 그래서 **여기서 먼저** `el.value` 에 마스크된 값을 써 넣고 커서를 잡아 둔다.
 *   뒤이어 React 가 렌더할 때 값이 이미 같으므로 인풋을 건드리지 않고, 커서가 남는다.
 *   금액 칸이 예전부터 쓰던 수법과 같다(`formatMoneyInput`).
 *
 * ★ 자리 계산은 shared 의 `caretForMasked` 다 — 시험이 거기 붙어 있다.
 */
export function maskInput(el: HTMLInputElement, kind: 'bizno' | 'corpno' | 'phone' | 'emailId'): string {
  const raw = el.value;
  const caret = el.selectionStart ?? raw.length;
  const masked = kind === 'emailId' ? maskEmailId(raw) : maskValue(kind, raw);
  el.value = masked;
  const pos = caretForMasked({ raw, caret, masked, keep: kind === 'emailId' ? EMAIL_KEEP : DIGIT });
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* detached */
  }
  return masked;
}

const DIGIT = /\d/;
/** `maskEmailId` 가 남기는 글자와 **같아야** 한다 — 갈리면 커서가 한 칸씩 어긋난다. */
const EMAIL_KEEP = /[A-Za-z0-9._-]/;

/**
 * 콤마를 다시 넣으면 커서가 맨 앞으로 튄다 — 길이 차이만큼 되돌린다.
 * ★ 이것이 없으면 **두 번째 글자부터 입력이 막힌다**(`05-logic.md` §5).
 */
export function formatMoneyInput(el: HTMLInputElement): string {
  const prevLen = el.value.length;
  const prevPos = el.selectionStart ?? el.value.length;
  const digits = el.value.replace(/[^0-9]/g, '');
  const formatted = digits ? Number(digits).toLocaleString('ko-KR') : '';
  el.value = formatted;
  const pos = Math.max(0, Math.min(formatted.length, prevPos + (formatted.length - prevLen)));
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* detached */
  }
  return formatted;
}

/* ══════════════════════════════════════════════════════════════════════════
   파생값 — 전부 shared 가 낸다
   ══════════════════════════════════════════════════════════════════════════ */

/** 줄 하나의 부가세액·납부액. **`floor` 는 shared 안에 있다.** */
export function rowAmounts(row: ItemRow): { vatAmount: number; paymentAmount: number } {
  return calcRowAmounts({ monthlyFee: row.monthlyFee, vatYn: row.vatYn });
}

export function totalsOf(rows: readonly ItemRow[]): ContractTotals {
  return calcTotals(
    rows.map((r, i) => ({
      seq: i + 1,
      standardFee: r.standardFee,
      deposit: r.deposit,
      monthlyFee: r.monthlyFee,
      vatYn: r.vatYn,
    })),
  );
}

/**
 * 첫달납부액. **아직 못 내는 상태가 있다** — 납부방법이 비었거나, 일시불인데 기간이 없을 때다.
 * 그때 0 을 보여주면 「0원을 내면 된다」로 읽힌다. `null` 로 두고 화면이 빈 칸을 그린다.
 */
export function firstPaymentOf(
  totals: ContractTotals,
  paymentMethod: string,
  months: string,
  freeMonths = '0',
): number | null {
  const periodMonths = toNumber(months);
  if (paymentMethod !== PAYMENT_METHOD.MONTHLY && paymentMethod !== PAYMENT_METHOD.LUMP_SUM) return null;
  if (paymentMethod === PAYMENT_METHOD.LUMP_SUM && periodMonths < 1) return null;
  /*
   * ★ 무상이 기간 이상이면 `calcFirstPayment` 가 던진다. 입력 도중에 잠깐 그 상태가
   *   되는 것은 정상이라(기간을 지우는 중) 화면을 죽이지 않고 빈 칸을 보여준다.
   *   저장을 막는 것은 `freeMonthsError` 다.
   */
  try {
    return calcFirstPayment({ totals, paymentMethod, periodMonths, freeMonths: toNumber(freeMonths) });
  } catch {
    return null;
  }
}

/**
 * 무상 개월수가 틀렸으면 **사람에게 할 말**, 통과면 `null`.
 *
 * ★★ 문구를 여기 한 곳에만 둔다. 화면이 막고 서버도 막지만(`requireFreeMonths`),
 *    사람이 읽는 문장은 화면이 낸다 — 서버 예외 문구가 그대로 뜨면 개발자 말투가 된다.
 */
export function freeMonthsError(months: string, freeMonths: string): string | null {
  const free = toNumber(freeMonths);
  if (free === 0) return null;
  const period = toNumber(months);
  if (period < 1) return '기간을 먼저 입력해 주세요';
  if (free >= period) return `무상 개월수는 기간(${period}개월)보다 작아야 합니다`;
  return null;
}

/**
 * 종료일 `YYYY.MM.DD`. 시작일이나 기간이 없으면 빈 문자열이다 —
 * 그건 «아직 안 채웠다»이지 오류가 아니다. 기간 0 을 **저장하려 할 때** 서버가 막는다.
 */
export function endDateOf(startDate: string, months: string): string {
  return endDateIsoOf(startDate, months).replace(/-/g, '.');
}

/**
 * 같은 종료일을 **ISO(`YYYY-MM-DD`)로** 준다.
 *
 * ★ 계약서(s030200040p1)가 이것을 쓴다. `endDateOf` 는 화면 표기라 점을 찍는데,
 *   그 값을 문서에 넘기면 날짜로 인식되지 않아 **종료일 칸이 빈 채로 인쇄된다.**
 *   실제로 그렇게 나왔다(2026-09-20). 두 형식을 각각의 이름으로 둔다 —
 *   계산은 여기 한 번뿐이고 `endDateOf` 가 이 결과를 바꿔 쓴다.
 */
export function endDateIsoOf(startDate: string, months: string): string {
  const periodMonths = toNumber(months);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || periodMonths < 1) return '';

  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(start.getTime())) return '';

  return calcEndDate(start, periodMonths).toISOString().slice(0, 10);
}

/*
 * ★ 할인·무상 문구와 특기사항 자동 줄 규칙은 **shared 로 옮겼다**(2026-09-21).
 *   재계약이 특기사항 첫 줄에 문구를 넣게 되면서 **둘이 부딪히는지** 시험해야 했는데,
 *   여기(웹)에는 시험 러너가 없어 걸 수가 없었다. `contract-memo.ts` 를 본다.
 *
 * ★ 자동 줄은 이제 둘이다 — 할인 → 무상 순서는 `ContractForm` 이 정한다.
 *
 * ★ 화면 쪽 호출부가 바뀌지 않도록 여기서 다시 내보낸다.
 */
export {
  DISCOUNT_PREFIX,
  FREE_LINE,
  discountLabel,
  freeLabel,
  withAutoLines,
} from '@swonbiz/shared/domain/contract-memo';

/** 섹션 1 대표자 이메일 — 도메인 Select 와 직접입력 중 지금 유효한 쪽. */
export function currentDomain(c: CompanyState): string {
  return c.emailDomain === DOMAIN_CUSTOM ? c.emailDomainCustom : c.emailDomain;
}

/** 섹션 3 입주자 사용자 — 같은 판정. 두 섹션이 같은 규칙을 쓰게 한 줄로 둔다. */
export function userDomain(u: UserRow): string {
  return u.domain === DOMAIN_CUSTOM ? u.domainCustom : u.domain;
}

/**
 * 화면의 두 칸 → 저장하는 이메일 한 줄.
 * 한쪽이 비면 `null` 이다 — `kim@` 이나 `@naver.com` 같은 반쪽을 저장하지 않는다.
 */
export function joinEmail(id: string, domain: string): string | null {
  const a = id.trim();
  const b = domain.trim();
  return a && b ? `${a}@${b}` : null;
}

/**
 * 저장된 이메일 → 화면의 두 칸.
 *
 * ★ 목록에 없는 도메인이면 **「직접입력」으로 연다.** Select 에 없는 값을 그대로 넣으면
 *   브라우저가 첫 옵션(「선택하세요」)으로 되돌리고, 그 상태로 저장하면 **도메인이
 *   사라진다.** 값이 조용히 지워지는 자리다.
 */
export function splitEmail(
  email: string | null,
  /**
   * 고를 수 있는 도메인 목록(`emailDomainsOf(codes)`).
   *
   * ★ 016 이전에는 이 함수가 상수 배열을 직접 봤다. 이제 목록이 **DB 에서 오므로**
   *   호출자가 넘긴다 — 운영자가 도메인을 지우면 그 도메인을 쓰던 기존 계약은
   *   자동으로 「직접입력」으로 열려야 하고, 그러려면 지금 목록을 봐야 한다.
   */
  domains: readonly string[],
): Pick<CompanyState, 'emailId' | 'emailDomain' | 'emailDomainCustom'> {
  const at = email ? email.lastIndexOf('@') : -1;
  if (!email || at < 1) return { emailId: email ?? '', emailDomain: '', emailDomainCustom: '' };

  const id = email.slice(0, at);
  const domain = email.slice(at + 1);
  const known = domains.includes(domain);
  return known
    ? { emailId: id, emailDomain: domain, emailDomainCustom: '' }
    : { emailId: id, emailDomain: DOMAIN_CUSTOM, emailDomainCustom: domain };
}

/**
 * 필수 항목 — 헤더 보조 안내의 「필수 항목 N개 미입력」과 오류 표시가 같은 목록을 본다.
 * 시안 `REQUIRED_FIELDS` 8개 그대로다.
 */
export const REQUIRED_FIELDS = [
  { key: 'company', label: '회사명' },
  { key: 'bizno', label: '사업자등록번호' },
  { key: 'ceo', label: '대표자' },
  { key: 'phone', label: '연락처' },
  { key: 'emailId', label: '이메일' },
  { key: 'contractDate', label: '계약일자' },
  { key: 'months', label: '기간(월)' },
  { key: 'startDate', label: '시작일' },
] as const;

export type RequiredKey = (typeof REQUIRED_FIELDS)[number]['key'];

/**
 * **임시저장** 의 필수 항목 — 대표자 · 연락처 · 이메일 셋뿐이다.
 *
 * ★★ 회사명과 사업자등록번호가 **일부러 빠져 있다.** 사업자등록을 신청 중이면 상호도
 *    번호도 아직 없는데, 그 상태로 자리를 잡아 두는 것이 가계약이다. 회사명을 필수로
 *    두면 **가계약 자체를 등록할 수 없다.**
 *
 * ★ 그래도 셋은 받는다. 연락할 방법이 없는 가계약은 나중에 누구 것인지 알 수 없다 —
 *   임시저장이 «아무것도 안 봐도 된다»는 뜻은 아니다.
 *
 * ★ 계약 조건(계약일자·기간·시작일)도 빠진다. 섹션 2 는 아직 협의 중일 수 있다.
 *
 * 회사명·사업자번호는 **확정** 시점에 `REQUIRED_FIELDS` 가 다시 막는다. 사업자등록이
 * 나온 뒤에 확정하라는 규칙이 거기 들어 있다.
 */
export const DRAFT_REQUIRED_KEYS: readonly RequiredKey[] = ['ceo', 'phone', 'emailId'];

/** 임시저장을 막을 항목. 비어 있으면 저장하지 않는다. */
export function missingForDraft(company: CompanyState): RequiredKey[] {
  const value: Partial<Record<RequiredKey, string>> = {
    ceo: company.ceo,
    phone: company.phone,
    emailId: company.emailId,
  };
  return DRAFT_REQUIRED_KEYS.filter((key) => !(value[key] ?? '').trim());
}

export function missingRequired(company: CompanyState, terms: TermsState): RequiredKey[] {
  const value: Record<RequiredKey, string> = {
    company: company.company,
    bizno: company.bizno,
    ceo: company.ceo,
    phone: company.phone,
    emailId: company.emailId,
    contractDate: terms.contractDate,
    months: terms.months,
    startDate: terms.startDate,
  };
  return REQUIRED_FIELDS.filter((f) => !value[f.key].trim()).map((f) => f.key);
}
