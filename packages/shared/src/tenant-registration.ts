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
 * 범위 — 여기에는 **필드가 무엇인지**만 있다
 * =============================================================================
 * 요청을 조립하고 보내는 코드는 다른 곳이다(3-2, 2026-09-30):
 *
 *   `packages/api/src/bbiyong/orgLink.ts`      채번 · 중복 재시도 · 요청 조립
 *   `packages/api/src/bbiyong/MockBbiyongOrg`  지금 답하는 쪽 (★ 삐용을 부르지 않는다)
 *   `packages/api/src/companies/registerOrg.ts` 계약 확정 뒤에 돌리는 자리
 *   `packages/shared/src/domain/org-code.ts`    `Z01`~`Z99` 발급 규칙
 *
 * 실호출(`HttpBbiyongOrg`)은 3-5 다 — 삐용 회신 2·3·4 대기.
 *
 * ★ 이 표와 실제로 나가는 본문이 어긋나지 않게, `orgLink.test.ts` 가 **주소·telNo 가
 *   빠져 있고 moduleCodes 가 빈 배열인지**를 고정한다.
 */

/** 값이 어디까지 가는가. ★ 이 프로젝트에서 가장 중요한 구분이다. */
export type FieldSink =
  /** 삐용 회사·대표 등록 요청 본문에 실려 나간다. */
  | 'bbiyong'
  /**
   * ERP 에 보관하고 삐용에는 **회사 수정**(`erp-patch-org`)으로만 보낸다 — 등록 요청에는 싣지 않는다
   * (결정 2026-10-23). 사업자번호 · 법인번호 · 업태 · 종목이다. **ERP 값이 정본이다.**
   * 보내는 자리는 `api/src/companies/companyOrgSync.ts` 한 곳이다.
   */
  | 'erp+patch'
  /** ERP 테이블(`tb_s080_*`)에만 남는다. **삐용에 보내지 않는다.** */
  | 'erp'
  /**
   * 삐용에 보내고 ERP 에도 보관한다 — **양쪽 다**.
   *
   * 지금은 `memberName`(대표자명) 하나뿐이다. 같은 값이 두 곳에 생기는 것은 원칙적으로
   * 피하지만(→ `bizNumber` 주석) 이 값만은 예외다. 삐용은 계정을 만들려고 이 이름을
   * 요구하고, ERP 는 세금계산서·계약서에 찍으려고 같은 이름을 필요로 한다. 둘 중 하나를
   * 포기하면 다른 쪽 기능이 죽는다. **삐용 값이 정본이고 ERP 쪽은 사본이다** — 어긋나면
   * 삐용을 믿는다.
   */
  | 'both';

export interface RegistrationField {
  /** 화면 라벨. 화면에 없는 항목(`orgCode`)도 사람이 부르는 이름은 둔다. */
  label: string;
  /** ★ 이 값이 어디로 가는가. */
  sink: FieldSink;
  /** 삐용 요청 본문의 필드명. `sink: 'erp'` 면 `null`. `erp+patch` 는 회사 수정(`erp-patch-org`) 본문의 이름. */
  wire: string | null;
  required: boolean;
  /** 삐용 규격의 최대 길이(문자). 규격이 없으면 `null`. */
  maxLength: number | null;
  /**
   * 화면에 입력란이 있는가.
   *
   * `false` 는 "아직 안 만들었다"가 아니라 **"사람이 넣는 값이 아니다"** 라는 뜻이다.
   * 지금은 `countryCode`(항상 KR)와 `orgCode`(Z01 부터 자동 채번) 둘이다.
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
 * ★ 사업자등록번호 · 법인번호 · 업태 · 종목 — 2026-10-23 결정으로 삐용 회사 수정(`erp-patch-org`)에
 *   **숫자만**(번호) 보낸다(sink `erp+patch`). 등록 요청에는 여전히 싣지 않는다. 그 전에는 「삐용 org010 에
 *   사업자등록번호 컬럼이 없다(회신 4 §4)」로 보내지 않았다.
 */
export const COMPANY_FIELDS = {
  orgName: { label: '회사명', sink: 'bbiyong', wire: 'orgName', required: true, maxLength: 100, onScreen: true },
  telNo: {
    label: '회사 전화', sink: 'bbiyong', wire: 'telNo', required: false, maxLength: 20,
    onScreen: true, digitsOnly: true,
  },
  // ── 주소 3칸 ────────────────────────────────────────────────────────────────
  // ★★★ 2026-09-18 정정 — **삐용에 보내지 않는다.** 3-1 에서는 `bbiyong` 이었다.
  //
  // 이 칸들이 받는 것은 **대표자 자택 주소**다. 계약 폼 섹션 1 의 라벨이 「대표자 주소」이고
  // 힌트가 「계약서에 인쇄되는 대표자 주소입니다」다 — 디자인팀 라벨이 맞았고, 이것을
  // «회사 주소를 받는 칸»으로 읽은 우리 가정이 틀렸다(doc/DESIGN_HANDOFF_DIFF.md §F-6 ①).
  //
  // ★ 주소는 **세 종류**이고 서로 다른 값이다.
  //   대표자 자택 주소 — 이 칸들. 계약서 「주소」 행에 인쇄된다. **ERP 만 보관한다**
  //   사업장 주소      — 건물 주소 + 계약호실. **화면 입력란이 없다.** 삐용
  //                     org010.ADDRESS 로 가는 것은 이쪽이다(확정 계약 중 최근 것 기준).
  //                     갱신 API 규격은 삐용 회신 대기 중이다
  //   법인 등기 주소   — 등기부등본상 주소. ERP 는 다루지 않는다
  //
  // ★★ 여기를 'bbiyong' 으로 되돌리면 **대표자 집 주소가 회사 주소로 삐용에 등록되고,
  //    세금계산서·계약서에 그 주소가 인쇄된다.** 되돌리기 전에 위 세 종류를 먼저 읽는다.
  zipCode: {
    label: '우편번호', sink: 'erp', wire: null, required: false, maxLength: 10, onScreen: true,
    note: '대표자 자택 우편번호. 삐용에 보내지 않는다 — 위 주석 참조.',
  },
  address: {
    label: '주소', sink: 'erp', wire: null, required: false, maxLength: 300, onScreen: true,
    note: '대표자 자택 기본주소. 계약서에 인쇄된다. 삐용 org010.ADDRESS(사업장 주소)와 다른 값이다.',
  },
  detailAddress: {
    label: '상세주소', sink: 'erp', wire: null, required: false, maxLength: 300, onScreen: true,
    note: '대표자 자택 상세주소.',
  },

  // ── 여기서부터 등록 요청에는 싣지 않는다(ERP 가 보관 · sink 가 erp+patch 면 회사 수정으로만 보낸다) ──
  bizNumber: {
    label: '사업자등록번호', sink: 'erp+patch', wire: 'bizNumber', required: false, maxLength: null, onScreen: true,
    digitsOnly: true,
    note: '★ 회사 수정으로만 보낸다(결정 2026-10-23) · 등록 요청에는 싣지 않는다. tb_s080_companies.biz_number — UNIQUE 다.',
  },
  corpNumber: {
    label: '법인등록번호', sink: 'erp+patch', wire: 'corpNumber', required: false, maxLength: null, onScreen: true,
    digitsOnly: true,
    note: '★ 회사 수정으로만 보낸다(결정 2026-10-23). tb_s080_companies.corp_number.',
  },
  // ★ ceoName(대표자명)은 여기 없다. OWNER_FIELDS.memberName 으로 합쳤다 — 그쪽 주석 참조.
  bizKind: {
    label: '업태', sink: 'erp+patch', wire: 'businessType', required: false, maxLength: null, onScreen: true,
    note: '세금계산서 발행에 필요하다. ★ 회사 수정으로만 보낸다(결정 2026-10-23). tb_s080_companies.business_type.',
  },
  bizItem: {
    label: '종목', sink: 'erp+patch', wire: 'businessItem', required: false, maxLength: null, onScreen: true,
    note: '★ 회사 수정으로만 보낸다(결정 2026-10-23). tb_s080_companies.business_item.',
  },
  taxEmail: {
    label: '세금계산서 수신 이메일', sink: 'erp', wire: null, required: false, maxLength: null, onScreen: true,
    note: '대표 이메일과 다를 수 있다 — 경리 담당자 주소를 받는 경우가 많다.',
  },

  // ── 화면에 없다 ────────────────────────────────────────────────────────────
  // 삐용에 **보내는** 값이지만 사람이 넣지 않는다. 자동으로 정해진다.
  countryCode: {
    label: '국가', sink: 'bbiyong', wire: 'countryCode', required: false, maxLength: 2, onScreen: false,
    note: '★ 항상 KR 로 자동 설정한다 — 운영자가 볼 이유가 없으므로 입력란도 안내도 두지 않는다. '
      + '삐용 org010.COUNTRY_CODE. 새 디자인 핸드오프의 계약 폼 섹션 1 에도 국가 칸이 없다 '
      + '(doc/DESIGN_HANDOFF_DIFF.md A-3-2). 3-1 에서는 화면에 있었고 3-1b 에서 뺐다.',
  },
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
  /**
   * ★★★ 대표자명 — 3-1c 에서 두 칸을 **하나로 합친 자리**다.
   *
   * 합치기 전에는 이랬다:
   *   ceoName    「입주사 정보」 "대표자명"   sink:erp      사업자등록증상 법적 대표
   *   memberName 「대표 정보」   "대표 성명"  sink:bbiyong  삐용 계정을 받는 사람
   *
   * 나눠 둔 이유는 "세금계산서에 찍는 사람과 로그인하는 사람이 다를 수 있다"였다.
   * 실제로는 다음 두 가지가 그 구분을 무너뜨렸다.
   *
   *   1. 한 화면에서 「대표자명」과 「대표 성명」은 거의 같은 말로 읽힌다. 운영자가 두 칸에
   *      다른 사람을 넣을 이유를 찾지 못하고, 바꿔 넣으면 **엉뚱한 사람 이메일로 계정이
   *      만들어진다.** 안내 문구를 각각 붙여도 이 위험은 남는다
   *   2. 새 디자인 원본(계약 폼 s030200040 섹션 1)에도 대표자 칸은 **하나뿐**이고,
   *      섹션 3 입주자 사용자 1행이 그 값을 그대로 미러링한다. 설계가 이미 하나로 갔다
   *
   * 그래서 **사업자등록증상 대표가 곧 ERP 계정을 받는 사람**으로 못 박는다.
   * 실무자가 대표와 다른 경우는 칸을 나누지 말고 **직원 등록으로 푼다** — 삐용 메일 발송
   * (2단계)이 열린 뒤 대표가 직원을 초대하면 된다. 그때까지는 대표 1명만 등록한다.
   *
   * ★ 이 판단을 적어 두지 않으면 나중에 누가 "법적 대표와 계정 주인은 다를 수 있는데요"
   *   하며 다시 나눈다. 다시 나누려면 위 1번의 오등록 위험을 먼저 해결해야 한다.
   */
  memberName: {
    label: '대표자명', sink: 'both', wire: 'memberName', required: true, maxLength: 50, onScreen: true,
    hint: '사업자등록증상 대표이며, 이 분이 ERP 계정을 받습니다',
    note: '삐용 member010 으로 나가고 ERP tb_s080_* 에도 보관한다. 세금계산서·계약서에 찍는 이름이 '
      + '이 값이다. 삐용 쪽이 정본이다.',
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
