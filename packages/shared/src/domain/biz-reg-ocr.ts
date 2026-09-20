/**
 * 사업자등록증 OCR 파서 — **판정만** 한다. Vision 도 DB 도 여기서 만지지 않는다.
 *
 * =============================================================================
 * ★★★ 이 파일의 규칙 하나 — **읽을 수 없으면 비운다**
 * =============================================================================
 * 화면은 `null` 이 아닌 칸만 폼에 덮는다. 그래서 `null` 은 「사람이 직접 채운다」는
 * 뜻이고, 틀린 값은 「사람이 맞다고 믿고 저장한다」는 뜻이다. 둘의 무게가 다르다.
 *
 * 레거시(`S-WonERP/src/lib/biz-reg-ocr.ts`)는 반대로 갔다. 라벨 뒤에 무엇이 있든
 * 집어넣었고, 그래서 홈택스 증명서에서 워터마크 조각 `ATION` 이 종목이 됐고
 * **주민등록번호가 법인등록번호 칸에 들어갔다.** 여기서는 확신이 없으면 비운다.
 *
 * =============================================================================
 * ★★ 라벨을 **줄 안에서만** 찾는다
 * =============================================================================
 * 레거시는 `종\s*목` 처럼 썼다. `\s` 는 줄바꿈을 먹으므로 이 정규식은 서로 아무
 * 상관 없는 두 줄의 「종」과 「목」을 이어 붙여 라벨로 착각한다. 홈택스 증명서가
 * 정확히 그 모양이었다(`종` / `목` / `ATION`). 그래서 여기서는 **먼저 줄로 자르고**
 * 라벨은 한 줄 안에서만 찾는다.
 *
 * 대신 국세청 양식이 라벨을 세로로 쓰는 칸(상호·성명·대표자)은 OCR 이
 * 「꼬리 글자만 남은 줄」로 뱉는다 — `호 : 값` · `명 : 값` · `자: 값`.
 * 그건 별도 규칙으로 따로 받는다(`TAIL_LABELS`).
 *
 * =============================================================================
 * ★ 주소는 읽지 않는다
 * =============================================================================
 * 등록증의 주소는 **사업장 소재지**이고, 계약 폼의 주소 칸은 **대표자 자택**이다
 * (`tenant-registration.ts` 의 `address` 주석). 다른 개념을 채우면 계약서에 틀린
 * 주소가 인쇄된다. 읽을 수 있어도 읽지 않는다.
 */

import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, MAX_FILE_MB } from './contract-files.ts';

/** 파서가 내는 7칸. `null` 은 「읽지 못했다」다 — 빈 문자열과 다르다. */
export interface BizRegFields {
  /** 법인명(단체명) 또는 상호. */
  companyName: string | null;
  /** 대표자 또는 성명. */
  ceoName: string | null;
  /** `000-00-00000`. */
  bizNumber: string | null;
  /** `000000-0000000`. ★ 주민등록번호를 여기에 넣지 않는다. */
  corpNumber: string | null;
  /** 코드 `MEMBER_TYPE`(`use_tp='000'`) — 법인 `R`·`A`·`C`·`S` / 개인사업자 `P`. */
  memberType: string | null;
  /** 업태. 폼의 `bizKind`. */
  businessType: string | null;
  /** 종목. 폼의 `industry`. */
  businessItem: string | null;
}

const EMPTY: BizRegFields = {
  companyName: null,
  ceoName: null,
  bizNumber: null,
  corpNumber: null,
  memberType: null,
  businessType: null,
  businessItem: null,
};

/**
 * 값이 끝나는 자리. 한 줄에 두 필드가 들어오는 장이 있다 —
 * `개업연월일: 2018년 05월 01 일 법인등록번호 : 110111-0000002`.
 * 레거시는 줄 끝까지 먹어서 대표자명이 「홍길동 법인등록번호 : …」 가 됐다(결함 ②).
 */
const NEXT_LABELS = [
  '법인등록번호', '사업자등록번호', '주민', '등록번호', '개업연월일', '생년월일',
  '사업자등록일', '사업장', '본점', '사업의', '업태', '종목', '발급사유', '공동사업자',
  '전자세금계산서', '사업자 단위', '성명', '대표자', '상호', '법인명',
];

/** 라벨 뒤 한 조각을 값으로 다듬는다. 콜론을 떼고, 다음 라벨 앞에서 자른다. */
function valueAfter(line: string, from: number): string | null {
  let rest = line.slice(from).replace(/^\s*[:：]?\s*/, '');
  let cut = rest.length;
  for (const label of NEXT_LABELS) {
    const at = rest.indexOf(label);
    if (at > 0 && at < cut) cut = at;
  }
  rest = rest.slice(0, cut).trim();
  // 값이 콜론만 남거나 비면 「못 읽었다」다.
  return rest.replace(/[:：]\s*$/, '').trim() || null;
}

/** 라벨이 들어 있는 **첫 줄**에서 값을 꺼낸다. 라벨은 한 줄 안에서만 찾는다. */
function byLabel(lines: readonly string[], label: RegExp): string | null {
  for (const line of lines) {
    const m = line.match(label);
    if (m && m.index !== undefined) {
      const value = valueAfter(line, m.index + m[0].length);
      if (value) return value;
    }
  }
  return null;
}

/**
 * 세로로 쓴 라벨의 **꼬리 글자만 남은 줄** — `호 : 값` · `명 : 값` · `자: 값`.
 * 국세청 등록증에서 「상호」·「성명」·「대표자」가 이렇게 쪼개져 나온다.
 *
 * ★ `명(` 은 받지 않는다 — 「법인명(단체명)」의 꼬리라서 대표자가 아니라 회사명이다.
 */
const TAIL_LABELS = {
  companyName: /^\s*호\s*[:：]\s*(.+)$/,
  ceoName: /^\s*(?:자|명(?!\s*\())\s*[:：]\s*(.+)$/,
} as const;

function byTailLabel(lines: readonly string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const m = line.match(pattern);
    if (m) {
      const value = valueAfter(line, line.indexOf(m[1]!));
      if (value) return value;
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   번호 — **라벨로 고른다.** 「문서에서 처음 보이는 하이픈 숫자」가 아니다
   ══════════════════════════════════════════════════════════════════════════
   레거시는 `(\d{6})-(\d{7})` 의 첫 매치를 법인등록번호로 썼다. 홈택스 증명서에는
   `주민(법인)등록번호` 밑에 **주민등록번호**가 같은 자릿수로 들어 있다. 그래서
   남의 주민등록번호가 법인등록번호 칸에 자동 입력됐다(결함 ③).
   ★ `주민(법인)등록번호` 안에는 「법인등록번호」라는 **연속된 글자가 없다**
     (「법인)등록번호」다). 라벨을 글자 그대로 찾으면 이 함정에 빠지지 않는다. */

/**
 * 라벨 뒤에서 자릿수가 맞는 숫자를 꺼내 하이픈을 넣는다. **라벨 뒤가 아니면 안 본다.**
 *
 * `groups` 는 하이픈으로 끊기는 자릿수다 — 사업자번호 `[3,2,5]`, 법인등록번호 `[6,7]`.
 * 하이픈이 붙은 표기를 먼저 보고, 없으면 붙여 쓴 전체 자릿수를 받아 하이픈을 넣는다.
 */
function numberByLabel(
  lines: readonly string[],
  label: RegExp,
  groups: readonly number[],
): string | null {
  const total = groups.reduce((a, b) => a + b, 0);
  const hyphen = new RegExp(groups.map((n) => `\\d{${n}}`).join('-'));
  const plain = new RegExp(`(?<!\\d)(\\d{${total}})(?!\\d)`);

  /** `1234567890` → `123-45-67890`. */
  const split = (digits: string) => {
    let at = 0;
    return groups.map((n) => digits.slice(at, (at += n))).join('-');
  };

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i]!.match(label);
    if (!m || m.index === undefined) continue;
    // 라벨 뒤 같은 줄 → 없으면 다음 줄(라벨만 있고 값이 아래 줄인 양식이 있다).
    const candidates = [lines[i]!.slice(m.index + m[0].length), lines[i + 1] ?? ''];
    for (const text of candidates) {
      const h = text.match(hyphen);
      if (h) return h[0];
      const p = text.match(plain);
      if (p) return split(p[1]!);
    }
  }
  return null;
}

/**
 * 사업자등록번호. 「사업자등록번호」를 먼저 보고, 없으면 「등록번호」를 본다.
 * ★ 「법인등록번호」·「주민(…)등록번호」의 꼬리를 「등록번호」로 읽지 않도록
 *   앞 글자를 막는다 — 막지 않으면 법인번호가 사업자번호 칸에 들어간다.
 */
const BIZ_NUMBER_LABELS: readonly RegExp[] = [/사업자등록번호/, /(?<![법인주민)])등록번호/];

/* ══════════════════════════════════════════════════════════════════════════
   회원구분 — 「법인」이라는 **글자**로 정하지 않는다
   ══════════════════════════════════════════════════════════════════════════
   홈택스 증명서에는 개인사업자 서류인데도 「법인」이 세 번 나온다
   (`상호(법인명)`·`주민(법인)등록번호`·`성명(법인명)`). 레거시는 `/법인/` 한 번으로
   법인이라 판정해 개인사업자를 `R`(주식회사)로 찍었다(결함 ④).
   여기서는 **양식 머리의 사업자 구분 표기**와 **법인등록번호의 존재**만 본다. */

/** 등록증 머리의 `(법인사업자)`. 이 표기가 법인 여부의 정본이다. */
const CORP_MARK = /\(\s*법인\s*사업자\s*\)/;
/** `(일반과세자)`·`(간이과세자)`·`(면세사업자)` — 개인 쪽 표기. */
const SOLE_MARK = /\(\s*(?:일반|간이|면세)\s*(?:과세자|사업자)\s*\)/;

/**
 * 법인 종류는 **회사명에서만** 가른다. 문서 전체에서 찾으면 종목에 「협동조합」이
 * 들어 있는 주식회사가 `S` 가 된다.
 */
function corpKindOf(companyName: string | null): string {
  const name = companyName ?? '';
  if (/유한회사|유한책임회사|\(유\)/.test(name)) return 'A';
  if (/[농어]\s*[·/]?\s*[농어]?\s*업회사법인/.test(name)) return 'C';
  if (/사회적\s*기업|협동조합/.test(name)) return 'S';
  return 'R'; // 주식회사, 또는 종류를 알 수 없는 법인
}

export function parseBizReg(rawText: string): BizRegFields {
  const text = rawText ?? '';
  if (!text.trim()) return { ...EMPTY };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // ── 회사명 ──────────────────────────────────────────────────────────────
  // 구체적인 라벨부터 본다. ★ 레거시는 `(법인명\(단체명\)|상호|법인명)` 한 정규식에
  //   넣었는데, 교대(|)는 **문서에서 더 앞에 있는 쪽**이 이기므로 순서가 뜻대로
  //   동작하지 않았다. 여기서는 라벨마다 문서를 한 번씩 훑는다.
  const companyName =
    byLabel(lines, /법인명\s*\(\s*단체명\s*\)/) ??
    byLabel(lines, /상\s*호\s*\(\s*법인명\s*\)/) ??
    byLabel(lines, /상\s*호/) ??
    byLabel(lines, /법인명/) ??
    byTailLabel(lines, TAIL_LABELS.companyName);

  // ── 대표자 ──────────────────────────────────────────────────────────────
  // ★ `성명(법인명)` 은 **공동사업자** 칸이다. 대표자로 읽으면 대표자명이
  //   「해당사항이 없습니다.」 가 된다 — 그래서 `성명(대표자)` 를 먼저 본다.
  const ceoName =
    byLabel(lines, /성\s*명\s*\(\s*대표자\s*\)/) ??
    byLabel(lines, /대\s*표\s*자/) ??
    byLabel(lines, /성\s*명(?!\s*\(\s*법인명)/) ??
    byTailLabel(lines, TAIL_LABELS.ceoName);

  // ── 번호 ────────────────────────────────────────────────────────────────
  let bizNumber: string | null = null;
  for (const label of BIZ_NUMBER_LABELS) {
    bizNumber = numberByLabel(lines, label, [3, 2, 5]);
    if (bizNumber) break;
  }

  const corpNumber = numberByLabel(lines, /법인등록번호/, [6, 7]);

  // ── 회원구분 ────────────────────────────────────────────────────────────
  const isCorp = CORP_MARK.test(text) || corpNumber !== null;
  let memberType: string | null = null;
  if (isCorp) memberType = corpKindOf(companyName);
  else if (SOLE_MARK.test(text) || bizNumber !== null) memberType = 'P';

  // ── 업태 · 종목 ─────────────────────────────────────────────────────────
  // ★ 라벨이 한 줄 안에 온전히 있을 때만 읽는다. 「사업의 종류」는 표의 제목이지
  //   업태·종목 라벨이 아니라서 걸리지 않는다.
  // ★ 실제 등록증은 업태·종목이 여러 행이지만 **대표 1행만** 읽는다. OCR 이 두 열을
  //   뒤섞어 내놓는 장이 있어(개인 ①·②) 전 행을 모으면 업태 값이 종목 칸으로 샌다.
  const businessType = byLabel(lines, /업\s*태/);
  const businessItem = byLabel(lines, /종\s*목/);

  return { companyName, ceoName, bizNumber, corpNumber, memberType, businessType, businessItem };
}

/* ══════════════════════════════════════════════════════════════════════════
   폼에 얹기 — **non-null 만 덮는다**
   ══════════════════════════════════════════════════════════════════════════
   읽지 못한 칸(`null`)을 빈 문자열로 덮으면 **사람이 이미 적어 둔 값이 지워진다.**
   OCR 은 도우미지 정본이 아니다. 그래서 patch 에는 읽은 칸만 담는다. */

/** 계약 폼 섹션 1(`CompanyState`)의 일부. 여기 없는 칸은 손대지 않는다는 뜻이다. */
export interface BizRegPatch {
  company?: string;
  bizno?: string;
  memberType?: string;
  corpno?: string;
  /** 등록증의 **종목**. 폼 라벨은 「업종」이다(`ContractForm` 에서 `businessItem` 과 이어진다). */
  industry?: string;
  /** 등록증의 **업태**. */
  bizKind?: string;
  ceo?: string;
}

export interface BizRegApply {
  patch: BizRegPatch;
  /** 덮은 칸 수. 화면의 「n개 불러왔습니다」가 이 수다. */
  applied: number;
  /**
   * ★★ 사업자번호를 덮었는가. 덮었으면 화면은 **확인 상태를 되돌려야 한다.**
   *    되돌리지 않으면 앞 번호로 받은 「확인됨」이 새 번호에 그대로 남는다 —
   *    아무도 확인한 적 없는 번호가 확인된 것으로 보인다.
   */
  resetBizCheck: boolean;
}

/**
 * 읽은 값을 폼 패치로 바꾼다.
 *
 * @param memberTypeCodes 회원구분 Select 에 실제로 있는 코드들. ★ 목록에 없는 코드는
 *   넣지 않는다 — Select 는 빈 칸으로 보이는데 폼 상태에는 값이 있어서, 저장하면
 *   아무도 고른 적 없는 코드가 들어간다.
 */
export function bizRegPatch(
  fields: BizRegFields,
  memberTypeCodes: readonly string[],
): BizRegApply {
  const patch: BizRegPatch = {};

  if (fields.companyName) patch.company = fields.companyName;
  if (fields.bizNumber) patch.bizno = fields.bizNumber;
  if (fields.ceoName) patch.ceo = fields.ceoName;
  if (fields.corpNumber) patch.corpno = fields.corpNumber;
  if (fields.businessType) patch.bizKind = fields.businessType;
  if (fields.businessItem) patch.industry = fields.businessItem;
  if (fields.memberType && memberTypeCodes.includes(fields.memberType)) {
    patch.memberType = fields.memberType;
  }

  return {
    patch,
    applied: Object.keys(patch).length,
    resetBizCheck: patch.bizno !== undefined,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   ★ 판독 전용 업로드 검사는 **없다**
   ══════════════════════════════════════════════════════════════════════════
   한동안 `rejectBizRegScan` 이 여기 있었다. 섹션 1 에 판독 전용 파일 입력이 따로
   있던 시절의 물건이다. 지금은 사업자등록증이 **첨부 업로드를 타고** 들어오므로
   형식·크기는 `rejectUpload`(`./contract-files.ts`)가 이미 본다 — 화면과 서버가
   같은 함수를 쓰는 것도 그쪽에 이미 있다. 같은 규칙을 한 벌 더 두면 갈린다. */
