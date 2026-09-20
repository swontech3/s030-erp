/**
 * 사업자번호 확인 — **판정만** 한다. 국세청도 DB 도 여기서 부르지 않는다.
 *
 * =============================================================================
 * ★★★ 한 버튼에 성격이 다른 두 가지가 들어 있다
 * =============================================================================
 *   ① 국세청 상태  — **바깥 사실**이다. 알려 줄 뿐 아무것도 막지 않는다.
 *                    폐업자와도 계약할 수 있고, 그 판단은 운영자가 한다.
 *                    국세청이 죽어도 계약 등록은 그대로 된다 — 확인만 안 될 뿐이다.
 *   ② ERP 중복     — **우리 규칙**이다. 같은 번호의 입주사가 이미 있는가.
 *
 * 둘을 한 번에 보여주되 섞지 않는다. 「폐업자인데 중복은 아님」 같은 조합이 실제로
 * 나오고, 그때 운영자가 봐야 하는 것은 두 줄이다.
 *
 * =============================================================================
 * ★★ **「종료」인 입주사는 중복이 아니다**
 * =============================================================================
 * 퇴실한 회사가 다시 들어오는 일이 있다. 그때 「이미 등록된 번호입니다」로 막으면
 * 운영자는 같은 회사를 두 번 만들거나(번호가 UNIQUE 라 만들지도 못한다) 손을 놓는다.
 * 그래서 종료된 입주사는 **막는 대신 「그 회사로 계약하시겠습니까」라고 묻는다.**
 *
 * 상태 판정은 여기서 다시 쓰지 않는다 — `deriveTenantStatus` 가 준 `filters` 를 본다.
 */
import type { TenantFilterKey } from './tenant-status.ts';

/* ══════════════════════════════════════════════════════════════════════════
   형식
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 확인을 걸 수 있는 형식인가 — 숫자 10자리.
 *
 * ★ `SectionCompany.isBiznoFormatOk` 와 **다르다.** 그쪽은 「입력 중인 값이 틀렸나」라
 *   빈 값을 통과시킨다(사업자등록 전이면 비워 두는 칸이다). 여기는 「확인을 부를 수
 *   있나」라 빈 값이 통과가 아니다 — 확인할 것이 없다.
 *
 * ★ 체크섬은 보지 않는다. 맞는지 아닌지는 국세청이 정본이고, 우리가 한 겹 더
 *   판정하면 국세청이 아는 번호를 우리가 막는 일이 생긴다.
 */
export function isBizNumberFormatOk(value: string): boolean {
  return /^\d{10}$/.test((value ?? '').replace(/\D/g, ''));
}

/* ══════════════════════════════════════════════════════════════════════════
   ① 국세청 상태조회
   ══════════════════════════════════════════════════════════════════════════ */

/** 상태조회 응답의 한 줄 중 **우리가 쓰는 칸만**. 나머지(과세유형 등)는 받지 않는다. */
export interface NtsRow {
  b_no?: string;
  /** 한글 문구. 표시에 쓰지 않는다 — 바뀔 수 있다. */
  b_stt?: string;
  /** ★ **정본이다.** `01` 계속 / `02` 휴업 / `03` 폐업 / `''` 미등록. */
  b_stt_cd?: string;
  tax_type?: string;
  /** 폐업일 `YYYYMMDD`. 폐업이 아니면 빈 문자열이다. */
  end_dt?: string;
}

/**
 * `unavailable` 은 이 함수가 내지 않는다 — **호출 자체가 실패**했을 때 부르는 쪽이 쓴다.
 * 「확인하지 못했다」와 「등록되지 않았다」는 다른 말이고, 섞으면 멀쩡한 번호가
 * 없는 번호로 보인다.
 */
export type NtsKind = 'active' | 'suspended' | 'closed' | 'unregistered' | 'unknown' | 'unavailable';

export function ntsKindOf(row: NtsRow | null | undefined): NtsKind {
  // ★ 국세청은 **없는 번호에도 행을 돌려준다**(`b_stt_cd: ''`). 행이 있다고 등록된 것이 아니다.
  if (!row) return 'unregistered';
  switch (row.b_stt_cd) {
    case '01':
      return 'active';
    case '02':
      return 'suspended';
    case '03':
      return 'closed';
    case '':
    case undefined:
      return 'unregistered';
    default:
      // 모르는 코드를 계속사업자로 읽지 않는다. 지어내느니 모른다고 한다.
      return 'unknown';
  }
}

/** `20240131` → `2024-01-31`. 8자리가 아니면 `null` — 반쪽짜리 날짜를 보여주지 않는다. */
function isoDate(yyyymmdd: string | undefined): string | null {
  const d = (yyyymmdd ?? '').trim();
  if (!/^\d{8}$/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

/**
 * 사용자에게 보여줄 한 줄.
 *
 * ★ 휴업·폐업에 「막혔다」는 말을 쓰지 않는다. 막지 않기 때문이다 —
 *   운영자가 보고 판단한다.
 */
export function ntsMessageOf(kind: NtsKind, row?: NtsRow | null): string {
  switch (kind) {
    case 'active':
      return '국세청: 계속사업자입니다';
    case 'suspended':
      return '국세청: 휴업자입니다. 계약 전에 확인해 주세요';
    case 'closed': {
      const at = isoDate(row?.end_dt);
      return at
        ? `국세청: 폐업자입니다 (폐업일 ${at}). 계약 전에 확인해 주세요`
        : '국세청: 폐업자입니다. 계약 전에 확인해 주세요';
    }
    case 'unregistered':
      return '국세청: 등록되지 않은 사업자등록번호입니다';
    case 'unknown':
      return '국세청: 상태를 알 수 없습니다';
    case 'unavailable':
      // ★ 확인이 안 된 것뿐이다. 계약 등록은 그대로 된다 — 그 말을 같이 한다.
      return '국세청 확인을 하지 못했습니다. 등록은 그대로 진행할 수 있습니다';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ② ERP 중복
   ══════════════════════════════════════════════════════════════════════════ */

/** 같은 사업자번호로 찾은 입주사. `filters`·`statusLabel` 은 `deriveTenantStatus` 가 준 그대로다. */
export interface ExistingTenant {
  companyId: string;
  companyName: string;
  filters: readonly TenantFilterKey[];
  /** 「계약중」·「D-9」·「검토중」·「종료」. 괄호 안에 덧붙일 때 쓴다. */
  statusLabel: string;
}

export type DuplicateKind = 'none' | 'active' | 'ended';

export interface DuplicateVerdict {
  kind: DuplicateKind;
  /** ★ **문장만** 담는다. 회사명은 `bizCheckLine` 이 괄호로 붙인다. */
  message: string;
  companyId: string | null;
  companyName: string | null;
  /**
   * 괄호 안에 회사명과 함께 적을 상태. 계약중이면 `null` — 「이미 계약중인
   * 입주사입니다 (에스원3DP · 계약중)」은 같은 말을 두 번 하는 것이다.
   */
  statusNote: string | null;
}

/**
 * @param found         같은 번호의 입주사. 없으면 `null`.
 * @param selfCompanyId 지금 편집 중인 입주사. ★ **자기 자신은 중복이 아니다** —
 *                      저장된 계약에서 [확인] 을 누르면 자기가 걸리는데, 그때
 *                      「이미 등록된 입주사입니다」가 자기를 가리키면 운영자는
 *                      무엇을 고쳐야 할지 알 수 없다.
 */
export function duplicateVerdictOf(
  found: ExistingTenant | null | undefined,
  selfCompanyId: string | null,
): DuplicateVerdict {
  const none: DuplicateVerdict = {
    kind: 'none',
    message: '',
    companyId: null,
    companyName: null,
    statusNote: null,
  };
  if (!found) return none;
  if (selfCompanyId && found.companyId === selfCompanyId) return none;

  // ★★ 「종료」만 재입주로 본다. 검토중(계약이 아직 없음)은 **끝난 것이 아니다** —
  //    임시저장만 해 둔 입주사를 새로 또 만들면 같은 회사가 둘이 된다.
  if (found.filters.includes('ended')) {
    return {
      kind: 'ended',
      // ★ 예전에는 「…계약하시겠습니까?」라고 물었다. 그 물음에 답하는 링크가
      //   있었기 때문이다. 링크를 뺀 뒤로는 **묻지 않고 알려 준다** — 답할 수 없는
      //   질문을 띄우면 운영자가 무엇을 눌러야 하는지 찾게 된다.
      message: '이미 등록된 입주사입니다. 기존 입주사로 계약할 수 있습니다',
      companyId: found.companyId,
      companyName: found.companyName,
      statusNote: found.statusLabel,
    };
  }

  return {
    kind: 'active',
    // 계약이 도는 중이면 「계약중」, 아직 계약 전이면 그렇게 말한다 — 없는 계약을
    // 있다고 하지 않는다.
    message: found.filters.includes('active')
      ? '이미 계약중인 입주사입니다'
      : '이미 등록된 입주사입니다',
    companyId: found.companyId,
    companyName: found.companyName,
    // 계약중은 문장이 이미 말하고 있다. 검토중·만기임박만 괄호에 덧붙인다.
    statusNote: found.filters.includes('active') && !found.filters.includes('soon')
      ? null
      : found.statusLabel,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   ③ 회사명 중복 — **알려만 준다**
   ══════════════════════════════════════════════════════════════════════════
   ★★ 같은 상호는 **법적으로 가능하다.** 사업자번호가 다르면 다른 회사다. 그래서
      이것은 막는 판정이 아니라 「혹시 같은 곳 아닙니까」라는 귀띔이다.

   ★ 종료된 입주사와 이름이 겹치는 것도 알려 준다. 사업자번호 쪽과 규칙이 다르다 —
     그쪽은 「종료면 재입주」라 중복에서 빼지만, 이름은 **같은 회사인지 아닌지를
     사람이 알아보라고** 보여주는 것이라 상태를 가리지 않는다.
   ══════════════════════════════════════════════════════════════════════════ */

export interface NameDuplicate {
  found: boolean;
  companyId: string | null;
  companyName: string | null;
}

export const NO_NAME_DUPLICATE: NameDuplicate = {
  found: false,
  companyId: null,
  companyName: null,
};

/* ══════════════════════════════════════════════════════════════════════════
   합친 결과 — 화면이 받는 모양
   ══════════════════════════════════════════════════════════════════════════ */
export interface BizCheckResult {
  nts: { kind: NtsKind; message: string };
  /** 사업자번호 중복. */
  duplicate: DuplicateVerdict;
  /** 회사명 중복. ★ 막지 않는다 — 같은 상호는 법적으로 가능하다. */
  nameDuplicate: NameDuplicate;
}

/**
 * 화면에 뜨는 **한 줄**.
 *
 * ★ 예전에는 두 줄이었는데 서로 붙어 읽혔다. 하나로 합치고 ` · ` 로 끊는다.
 *
 * ★★ **사업자번호가 이미 걸렸으면 회사명은 말하지 않는다.** 같은 번호면 같은
 *    회사이고, 「이미 계약중인 입주사입니다 · 같은 회사명이 있습니다」는 한 회사를
 *    두 번 가리키는 말이라 두 곳이 걸린 것처럼 읽힌다.
 */
export function bizCheckLine(result: BizCheckResult): string {
  const parts = [result.nts.message];

  const dup = result.duplicate;
  if (dup.kind !== 'none') {
    const inside = [dup.companyName, dup.statusNote].filter(Boolean).join(' · ');
    parts.push(inside ? `${dup.message} (${inside})` : dup.message);
  } else if (result.nameDuplicate.found) {
    parts.push(`같은 회사명이 있습니다 (${result.nameDuplicate.companyName})`);
  }

  return parts.filter(Boolean).join(' · ');
}
