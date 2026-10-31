/**
 * 코드가 **어디에 쓰이는지** 적어 둔 표 — 코드 관리(s030100030)가 「못 지운다」를 판정하는 근거.
 *
 * =============================================================================
 * ★★★ 이 표를 빠뜨리면 **쓰고 있는 코드가 지워진다**
 * =============================================================================
 * 업무 표에서 코드표(`tb_s080_codes_line`)로 가는 **FK 가 하나도 없다**(2026-10-03 실측:
 * `information_schema` 로 확인, 0건). 업무 자료는 코드 문자열을 그냥 담는다 —
 * `tb_s080_spaces.room_type = 'R1'` 처럼. 즉 **DB 가 막아 주지 않는다.**
 *
 * 그래서 「쓰고 있는가」의 답은 **이 파일에만 있다.** 여기 한 줄을 빠뜨리면 코드 관리
 * 화면이 그 코드를 「아무도 안 쓴다」고 판정하고 **지운다.** 지워진 뒤에 남는 것은
 * 자료 쪽의 고아 문자열이고, 화면은 이름을 못 찾아 빈칸으로 열린다. 조용히 깨진다.
 *
 * ★★ **코드값을 담는 컬럼을 새로 만들면 이 표에 한 줄을 추가한다.** 잊기 쉬우니 두 곳이
 *    거든다:
 *      ① `scripts/verify-codes.js` 가 이 표의 표·컬럼이 **실제로 존재하는지** 대조한다
 *         (오타·이름 변경을 잡는다). 다만 **빠뜨린 줄은 잡을 수 없다** — 없는 것을
 *         없다고 알 방법이 없기 때문이다.
 *      ② 코드 관리 화면이 운영자에게 안내 문구를 띄운다(`CodesView` 의 `styles.hint`).
 *
 * ★ 자동 탐지로 대신할 수 없다. 실제로 해 보고 버렸다(2026-10-03):
 *     · 값만 맞추면 **거짓 양성**이 쏟아진다. `C`·`R`·`A` 같은 한 글자 코드가 카테고리를
 *       넘나들며 겹친다 — `auth_session.org_tp`(삐용 기관구분)가 EXEC_TP·PAY_ST·RES_TP·
 *       MEMBER_TYPE 에 동시에 일치했다. 코드 컬럼이 아닌데도.
 *     · 컬럼명 패턴으로 추리면 **놓친다**. `tb_s080_spaces.status`(ROOM_ST 72행)가
 *       `_st`·`_status` 로 끝나지 않아 스캔에서 빠졌다.
 *   둘 다 틀리는 방향이 다르고, 틀린 경고는 정당한 삭제를 막는다. 그래서 손으로 적는다.
 *
 * =============================================================================
 * ★★ 무엇을 막고 무엇을 허용하는가 (결정 2026-10-03)
 * =============================================================================
 *   막는다   · 쓰이는 코드 **삭제**            — 자료의 문자열이 길을 잃는다
 *            · 쓰이는 코드의 **`code` 값 변경** — 삭제와 같다. 자료는 코드값으로만 연결된다
 *            · 쓰이는 코드 **비활성화**         — `listCodes()` 가 `is_active = true` 로
 *              읽으므로, 끄면 기존 자료가 이름을 못 찾아 셀렉트가 미선택으로 열린다.
 *              지우지 않았는데 깨지는 자리라 삭제와 같이 막는다
 *   허용한다 · **이름(`name`) 변경**            — 자료는 코드값만 담는다. 이름은 조회 시점에
 *              읽히므로 고치면 그 코드를 쓰는 화면에 **바로** 반영된다(요구사항)
 *            · 순서·설명 변경
 *
 * 파티션 삭제(값이 남음)·머리 삭제(파티션이 남음)는 **FK `ON DELETE RESTRICT` 가 이미
 * 막는다** — 이 표가 아니라 DB 가 하는 일이다(마이그레이션 013).
 *
 * 근거 전문: `doc/CODE_MASTER_ANALYSIS.md` §A-2 · §B
 */

/** 코드값을 담는 업무 컬럼 하나. */
export interface CodeUsageRef {
  /** 코드 카테고리(머리). */
  category: string;
  /** 파티션. 공통은 `'000'`. ★ 파티션까지 봐야 한다 — 같은 code 가 파티션마다 따로 있다. */
  useTp: string;
  /** 업무 표 이름. ★ SQL 식별자로 들어간다 — `isSafeIdentifier` 를 통과해야 한다. */
  table: string;
  /** 업무 컬럼 이름. 위와 같다. */
  column: string;
  /** 사람이 읽는 이름. 409 문구에 그대로 들어간다 — 「호실 3곳에서 쓰고 있습니다」. */
  label: string;
}

/**
 * 코드값이 실제로 저장되는 자리 — **13건** (2026-10-03 실측 9건 + 2026-10-07 표양식 1건 + 2026-10-10 법인변경 2건 + 법무 회사유형 1건).
 *
 * 각 줄은 「그 컬럼의 값이 이 (category, use_tp) 의 code 다」를 뜻한다. 앱 코드에서
 * 확인한 것만 적었다 — 값이 우연히 겹치는 컬럼은 넣지 않았다(머리말 ★).
 */
export const CODE_USAGE: readonly CodeUsageRef[] = [
  // --- 호실 (센터 관리 s030100010) ---
  { category: 'ROOM_TP', useTp: '000', table: 'tb_s080_spaces', column: 'room_type', label: '호실' },
  /** 호실상태는 계약이 정한다(`db/spaceStatus.ts`) — 사람이 넣는 값이 아니지만 코드값이다. */
  { category: 'ROOM_ST', useTp: '000', table: 'tb_s080_spaces', column: 'status', label: '호실상태' },

  // --- 계약 (s030200040) ---
  {
    category: 'ROOM_TP',
    useTp: '000',
    table: 'tb_s080_contract_spaces',
    column: 'room_type',
    label: '계약 호실',
  },
  { category: 'CONTRACT_ST', useTp: '000', table: 'tb_s080_contracts', column: 'status', label: '계약' },
  {
    category: 'PAYMENT_METHOD',
    useTp: '000',
    table: 'tb_s080_contracts',
    column: 'payment_method',
    label: '계약 납부방법',
  },
  {
    category: 'ACCESS_ROUTE',
    useTp: '000',
    table: 'tb_s080_contracts',
    column: 'access_route',
    label: '계약 접근경로',
  },

  // --- 입주사 (s030200030) ---
  {
    category: 'MEMBER_TYPE',
    useTp: '000',
    table: 'tb_s080_companies',
    column: 'member_type',
    label: '입주사 회원구분',
  },
  /**
   * ★ 입주사 목록의 상태 뱃지는 이 컬럼을 **쓰지 않는다** — 계약에서 유도한다
   *   (`domain/tenant-status.ts`). 그래도 컬럼에 코드값이 들어 있어 세는 대상이다.
   *   「화면이 안 쓰니 지워도 된다」가 아니다 — 자료가 남아 있으면 못 지운다.
   */
  { category: 'COMPANY_ST', useTp: '000', table: 'tb_s080_companies', column: 'status', label: '입주사 상태' },

  // --- 문의상담 (s030500070 · s030200080) ---
  { category: 'QU_TP', useTp: '000', table: 'tb_s080_inquiries', column: 'type', label: '문의' },

  // --- 표양식 (s030100020) — 2026-10-07 추가 ---
  /** 양식 종류(표 · 일반서류). `domain/form-template.ts` 의 `FORM_KIND_CATEGORY`. */
  { category: 'LAW_DOC_TP', useTp: '000', table: 'tb_s080_form_templates', column: 'kind', label: '표양식' },

  // --- 법인변경 (s040200010) — 2026-10-10 추가. `domain/corp-change.ts` ---
  { category: 'LAW_CNG_TP', useTp: '000', table: 'tb_s080_corp_changes', column: 'change_type', label: '법인변경' },
  { category: 'LAW_PROG_ST', useTp: '000', table: 'tb_s080_corp_changes', column: 'status', label: '법인변경' },
  /**
   * 비입주사 회사유형(038, 2026-10-10) — 파티션 **002**(주식회사 · 유한회사). 입주사의 회원구분
   * (`tb_s080_companies.member_type`, 000)과 칸 이름은 같지만 파티션이 다르다.
   * `domain/corp-change-detail.ts` 의 `LEGAL_MEMBER_TYPE_USE_TP`.
   */
  { category: 'MEMBER_TYPE', useTp: '002', table: 'tb_s080_legal_orgs', column: 'member_type', label: '법무 회사유형' },
  /**
   * 법인설립 회사 형태(2026-10-31) — 파티션 **001**(법인설립용). 새 건을 만들 때 고른다.
   * `domain/incorporation.ts` 의 `INCORP_ENTITY_USE_TP`.
   */
  { category: 'MEMBER_TYPE', useTp: '001', table: 'tb_s080_incorporations', column: 'entity_type', label: '법인설립 회사 형태' },
] as const;

/** 앱 코드가 코드값을 **상수로** 들고 있는 자리 하나. */
export interface PinnedCodeRef {
  category: string;
  useTp: string;
  /** 앱이 박아 둔 code 들. */
  codes: readonly string[];
  /** 어느 파일이 들고 있는가 — 고치려는 사람이 찾아갈 자리. */
  source: string;
  label: string;
}

/**
 * ★★ 자료가 **0행이어도** 코드값을 바꾸면 깨지는 자리 — **7건** (2026-10-03 실측 4건 + 2026-10-07 표양식 1건 + 2026-10-10 법인변경 2건).
 *
 * 앱 코드가 코드값을 상수로 비교한다. 예컨대 `spaceStatus.ts` 가 `'E'`(공실)를 직접
 * 쓰므로, `ROOM_ST` 의 `E` 를 `V` 로 고치면 호실상태 자동화가 **조용히** 틀린다 —
 * 테스트도 DB 도 막지 않는다. 그래서 이 code 들은 **쓰이는 자료가 없어도** 코드값 변경과
 * 삭제를 막는다.
 *
 * ★ 이름 변경은 허용한다. 앱이 보는 것은 코드값이고 이름은 화면 문구다.
 */
export const PINNED_CODES: readonly PinnedCodeRef[] = [
  {
    category: 'ROOM_ST',
    useTp: '000',
    codes: ['E', 'O', 'R'],
    source: 'packages/api/src/db/spaceStatus.ts (SPACE_STATUS)',
    label: '호실상태 자동화',
  },
  {
    category: 'CONTRACT_ST',
    useTp: '000',
    codes: ['draft', 'confirmed', 'terminated', 'cancelled'],
    source: 'packages/shared/src/domain/contract-status.ts (CONTRACT_STATUS)',
    label: '계약 상태 전이',
  },
  {
    category: 'PAYMENT_METHOD',
    useTp: '000',
    codes: ['M', 'C'],
    source: 'packages/shared/src/domain/contract-amounts.ts (PAYMENT_METHOD)',
    label: '첫 납부액 계산',
  },
  {
    category: 'QU_ST',
    useTp: '000',
    codes: ['R', 'A'],
    source: 'packages/shared/src/domain/inquiry.ts (InquiryStatus)',
    label: '문의 상태 판정',
  },
  /**
   * 새 양식의 종류 — 앱과 DB 기본값(`kind DEFAULT 'T'`)이 둘 다 `T` 를 박아 두었다.
   * ★ 2026-10-07 추가. `T` 를 바꾸면 새 양식이 코드에 없는 종류로 만들어진다.
   */
  {
    category: 'LAW_DOC_TP',
    useTp: '000',
    codes: ['T'],
    source: 'packages/shared/src/domain/form-template.ts (DEFAULT_FORM_KIND)',
    label: '표양식 기본 종류',
  },
  /**
   * 법인변경 — 구분마다 입력 칸과 검증이, 상태마다 전이표와 역할이 박혀 있다. ★ 2026-10-10 추가.
   * ★ `LAW_CNG_TP` 의 `CEO_CHG` · `LAW_PROG_ST` 의 `S` · `A`(제출 — 2026-10-10 뺐다) 는 앱이 쓰지 않아 여기 없다.
   */
  {
    category: 'LAW_CNG_TP',
    useTp: '000',
    codes: ['NAME', 'HQ', 'PURPOSE', 'OFFICER', 'CEO_ADDR'],
    source: 'packages/shared/src/domain/corp-change.ts (CORP_CHANGE_TYPES)',
    label: '법인변경 구분별 입력 칸',
  },
  {
    category: 'LAW_PROG_ST',
    useTp: '000',
    codes: ['P', 'E', 'C', 'X'],
    source: 'packages/shared/src/domain/corp-change.ts (CORP_CHANGE_STATUSES)',
    label: '법인변경 상태 전이',
  },
  /**
   * 양식의 법무 표시(정의 jsonb `legal.companyType`)가 주식회사 · 유한회사를 코드값으로 담는다 —
   * 컬럼이 아니라 jsonb 안이라 `CODE_USAGE` 로 셀 수 없어 여기 박는다. ★ 2026-10-11 추가(서류 출력).
   */
  {
    category: 'MEMBER_TYPE',
    useTp: '002',
    codes: ['R', 'A'],
    source: 'packages/shared/src/domain/legal-form-mark.ts (LEGAL_FORM_COMPANY_TYPES)',
    label: '법무 양식 회사유형',
  },
  /**
   * 법인설립 회사 형태 · 설립 구분 — 형태마다 이름표 · 검증 · 서류 묶음이, 구분마다 등기 설정 줄이 박혀 있다.
   * ★ 2026-10-31 추가(유한회사 설립).
   */
  {
    category: 'MEMBER_TYPE',
    useTp: '001',
    codes: ['R', 'A'],
    source: 'packages/shared/src/domain/incorporation.ts (INCORP_ENTITY_TYPES)',
    label: '법인설립 회사 형태',
  },
  {
    category: 'LAW_EST_TP',
    useTp: '000',
    codes: ['R_PROMOTER', 'U_P'],
    source: 'packages/shared/src/domain/incorporation.ts (INCORP_METHOD · INCORP_LTD_METHOD)',
    label: '법인설립 설립 구분',
  },
] as const;

/**
 * SQL 식별자로 안전한가.
 *
 * ★ 이 표의 `table`·`column` 은 **식별자**라 파라미터로 묶을 수 없고 문장에 박아야 한다.
 *   값은 이 파일의 상수뿐이므로 바깥 입력이 섞일 길이 없지만, 그 사실에 기대지 않고
 *   세는 쪽에서 한 번 더 통과시킨다 — 나중에 이 표를 설정 파일로 옮기는 사람이 생길 때
 *   막아 주는 자리다.
 */
export function isSafeIdentifier(s: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(s);
}

/** 이 파티션의 코드값을 담는 업무 컬럼들. */
export function usageRefsFor(category: string, useTp: string): readonly CodeUsageRef[] {
  return CODE_USAGE.filter((u) => u.category === category && u.useTp === useTp);
}

/** 이 파티션에서 **앱이 박아 둔** code 들. 없으면 빈 배열. */
export function pinnedCodesFor(category: string, useTp: string): readonly PinnedCodeRef[] {
  return PINNED_CODES.filter((p) => p.category === category && p.useTp === useTp);
}

/** 이 code 가 앱 상수로 박혀 있는가 — 박혀 있으면 코드값 변경·삭제를 막는다. */
export function pinnedRefFor(category: string, useTp: string, code: string): PinnedCodeRef | null {
  return pinnedCodesFor(category, useTp).find((p) => p.codes.includes(code)) ?? null;
}
