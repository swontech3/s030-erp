/**
 * 신규 입주사 등록 — 입력 항목 정의. **web(화면)과 api(전송)가 이 한 파일을 본다.**
 *
 * =============================================================================
 * ★★★ 이 파일의 존재 이유 — `sink` 한 칸이다
 * =============================================================================
 * 삐용은 **모르는 필드를 오류 없이 조용히 버린다**(회신 4 §4). 그래서 어떤 항목이
 * 삐용까지 가고 어떤 항목이 ERP 에만 남는지가 코드 어디에도 적혀 있지 않으면,
 * 언젠가 누가 필드를 하나 추가해 놓고 **저장됐다고 믿는다.** 그 믿음은 세금계산서를
 * 발행할 때나 깨지고, 그때는 이미 데이터가 비어 있다.
 *
 * 항목을 추가할 때 `sink` 를 반드시 정한다. 모르면 추가하지 않는다.
 *
 * =============================================================================
 * 범위 — 페이즈 3-1 은 정의와 화면 골격까지다
 * =============================================================================
 * 여기에는 **필드가 무엇인지**만 있다. 삐용에 실제로 보내는 코드(요청 조립·호출·
 * 재시도)는 3-2(포트 + Mock 어댑터)와 3-5(실호출)다. 이 파일은 그 두 작업의 입력이다.
 */

/** 값이 어디까지 가는가. ★ 이 프로젝트에서 가장 중요한 구분이다. */
export type FieldSink =
  /** 삐용 회사·대표 등록 요청 본문에 실려 나간다. */
  | 'bbiyong'
  /** ERP 테이블(`tb_s080_*`)에만 남는다. **삐용에 보내지 않는다.** */
  | 'erp';

export interface RegistrationField {
  /** 화면 라벨. 화면에 없는 항목(`orgCode`)도 사람이 부르는 이름은 둔다. */
  label: string;
  /** ★ 이 값이 어디로 가는가. */
  sink: FieldSink;
  /** 삐용 요청 본문의 필드명. `sink: 'erp'` 면 `null`. */
  wire: string | null;
  required: boolean;
  /** 삐용 규격의 최대 길이(문자). 규격이 없으면 `null`. */
  maxLength: number | null;
  /**
   * 화면에 입력란이 있는가.
   *
   * `false` 는 "아직 안 만들었다"가 아니라 **"사람이 넣는 값이 아니다"** 라는 뜻이다.
   * 지금은 `orgCode` 하나뿐이다.
   */
  onScreen: boolean;
  /** 숫자만 보낸다 — 하이픈·공백은 전송 전에 제거한다. */
  digitsOnly?: true;
  /** 화면에 함께 띄우는 안내 문구. */
  hint?: string;
  /** 개발자용 메모. 화면에 뜨지 않는다. */
  note?: string;
}

/**
 * 회사 정보.
 *
 * ★ 사업자등록번호를 삐용에 보내지 않는 이유 — 같은 값이 두 곳에 생기면 달라졌을 때
 *   어느 쪽이 맞는지 다투게 된다. 회사 식별은 `org_id` 하나로 충분하다(회신 4 §4).
 *   삐용 `org010` 에는 사업자등록번호 컬럼이 아예 없다.
 */
export const COMPANY_FIELDS = {
  orgName: { label: '회사명', sink: 'bbiyong', wire: 'orgName', required: true, maxLength: 100, onScreen: true },
  telNo: {
    label: '회사 전화', sink: 'bbiyong', wire: 'telNo', required: false, maxLength: 20,
    onScreen: true, digitsOnly: true,
  },
  zipCode: { label: '우편번호', sink: 'bbiyong', wire: 'zipCode', required: false, maxLength: 10, onScreen: true },
  address: { label: '주소', sink: 'bbiyong', wire: 'address', required: false, maxLength: 300, onScreen: true },
  detailAddress: {
    label: '상세주소', sink: 'bbiyong', wire: 'detailAddress', required: false, maxLength: 300, onScreen: true,
  },
  countryCode: {
    label: '국가', sink: 'bbiyong', wire: 'countryCode', required: false, maxLength: 2, onScreen: true,
    note: '기본 KR. 삐용 org010.COUNTRY_CODE.',
  },

  // ── 여기서부터 ERP 에만 남는다 ──────────────────────────────────────────────
  bizNumber: {
    label: '사업자등록번호', sink: 'erp', wire: null, required: false, maxLength: null, onScreen: true,
    note: '★ 삐용에 보내지 않는다(회신 4 §4). tb_s080_companies.biz_number — UNIQUE 다.',
  },
  ceoName: {
    label: '대표자명', sink: 'erp', wire: null, required: false, maxLength: null, onScreen: true,
    hint: '사업자등록증에 적힌 대표자입니다',
    note: '★★ 아래 대표 정보의 memberName 과 다른 값이다. 이쪽은 세금계산서용 법적 대표자이고, '
      + 'memberName 은 삐용 계정을 받는 사람이다. 같은 사람인 경우가 많지만 같은 칸이 아니다.',
  },
  bizKind: {
    label: '업태', sink: 'erp', wire: null, required: false, maxLength: null, onScreen: true,
    note: '세금계산서 발행에 필요하다. 삐용에는 없는 개념이다.',
  },
  bizItem: {
    label: '종목', sink: 'erp', wire: null, required: false, maxLength: null, onScreen: true,
  },
  taxEmail: {
    label: '세금계산서 수신 이메일', sink: 'erp', wire: null, required: false, maxLength: null, onScreen: true,
    note: '대표 이메일과 다를 수 있다 — 경리 담당자 주소를 받는 경우가 많다.',
  },

  // ── 화면에 없다 ────────────────────────────────────────────────────────────
  orgCode: {
    label: '단체코드', sink: 'bbiyong', wire: 'orgCode', required: true, maxLength: 3, onScreen: false,
    note: '★ ERP 가 Z01 부터 순번으로 자동 생성한다(회신 6). 운영자가 정하는 값이 아니므로 '
      + '등록 화면에 입력란도 안내도 두지 않는다. 발급 규칙 구현은 3-2, 입주사 상세에 읽기 전용 '
      + '표시는 3-4. 삐용 부서코드가 이 코드를 접두사로 물려받으므로 함부로 바꿀 수 없다.',
  },
} as const satisfies Record<string, RegistrationField>;

/**
 * 대표 정보 — 삐용 계정을 받는 사람. 회사와 **한 번의 호출로 함께** 만들어진다.
 *
 * ★ 페이즈 3 에서는 대표 1명만 등록한다. 직원 등록은 삐용 메일 발송(2단계)이 열린 뒤다.
 */
export const OWNER_FIELDS = {
  memberName: {
    label: '대표 성명', sink: 'bbiyong', wire: 'memberName', required: true, maxLength: 50, onScreen: true,
    note: '★★ 회사 정보의 ceoName(사업자등록증 대표자)과 다른 칸이다.',
  },
  hpNo: {
    label: '대표 휴대전화', sink: 'bbiyong', wire: 'hpNo', required: true, maxLength: 20,
    onScreen: true, digitsOnly: true,
  },
  email: {
    label: '대표 이메일', sink: 'bbiyong', wire: 'email', required: true, maxLength: 100, onScreen: true,
    hint: '이 주소가 곧 로그인 아이디입니다',
  },
} as const satisfies Record<string, RegistrationField>;

/**
 * ★ 어떤 형태로도 화면에 두지 않고 보내지도 않는 값.
 *
 * 목록으로 남기는 이유는 "왜 없는지"를 다음 사람이 묻지 않게 하기 위해서다.
 * 없는 것은 흔적을 남기지 않으므로, 빠뜨린 것과 일부러 뺀 것이 구분되지 않는다.
 */
export const NEVER_SENT = [
  { name: 'pwd', reason: '비밀번호. ERP 는 계정을 발급하지도 비밀번호를 보관하지도 않는다.' },
  { name: 'org_tp', reason: "삐용 서버가 정한다. 신규 입주사도 'N'(일반)이다." },
  { name: 'member_tp', reason: "삐용 서버가 정한다. 대표는 항상 'C'. ERP 가 보내면 안 된다." },
  { name: 'mailAgentYn', reason: '폐기됐다. 메일 구독은 moduleCodes 로 정한다.' },
  { name: 'bizNumber', reason: '삐용 org010 에 컬럼이 없다. ERP 가 보관한다(회신 4 §4).' },
] as const;

/**
 * 구독 모듈 — `moduleCodes` 배열로 회사 등록과 함께 보낸다.
 *
 * ★★ **지금은 비워서 보낸다.** 아래 5개는 삐용에서 아직 `use_yn='N'` 이고,
 *    켜지지 않은 모듈 코드를 보내면 **회사가 아예 만들어지지 않는다**(회신 4 §3).
 *    삐용의 시드·권한 견본·모듈 활성화가 끝나면 그때 열린다.
 *
 * ★ `CORE` 는 보내지 않아도 자동으로 붙는다. `ERPCORE` 는 일반 모듈이라 자동이 아니고
 *   운영자가 삐용 화면에서 함께 체크해야 한다 — 빠뜨리면 그 회사는 로그인해도
 *   화면 틀(셸)이 없다. 운영 위험으로 doc/ORG_ARCHITECTURE.md 에 등록돼 있다.
 */
export const SUBSCRIBABLE_MODULES = [
  { code: 'OFFICE', label: '입주사·계약' },
  { code: 'BOOKING', label: '회의실 예약' },
  { code: 'BILLING', label: '청구' },
  { code: 'LEGAL', label: '법무' },
  { code: 'TAX', label: '세무' },
] as const;

/** 지금 화면에서 고를 수 있는 모듈. **의도적으로 비어 있다** — 위 주석 참조. */
export const SELECTABLE_MODULES: readonly (typeof SUBSCRIBABLE_MODULES)[number][] = [];

/**
 * 등록 완료 안내.
 *
 * ★ "메일을 확인하세요" 라고 쓰면 안 된다 — **메일은 오지 않는다.** 삐용 메일 발송은
 *   2단계이고, 그전까지 대표 계정은 만들어져도 로그인할 수 없다(회신 4 §6).
 */
export const REGISTRATION_DONE_NOTICE = '계정 개통은 별도 안내 예정입니다';

/** 화면에 입력란을 그릴 항목만. `orgCode` 처럼 사람이 넣지 않는 값은 빠진다. */
export function onScreenFields<T extends Record<string, RegistrationField>>(
  group: T,
): { key: keyof T & string; field: RegistrationField }[] {
  return Object.entries(group)
    .filter(([, f]) => f.onScreen)
    .map(([key, field]) => ({ key: key as keyof T & string, field }));
}
