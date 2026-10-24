/**
 * 법인변경 서류 출력(5단계) — 자리표시 목록 · 등기 설정 고르기 · 출력값 · 스냅샷 읽기. 순수 함수.
 *
 * 결정 2026-10-10 Q1~Q10 · 10-11 A~I 와 그 뒤 질문 1~7. 마이그레이션 없음.
 *
 * =============================================================================
 * ★★★ 자리표시 이름은 레거시 그대로다 — 법인변경등록1 과 맞물린다 (Q2)
 * =============================================================================
 * 영문 이름(`companyName` · `matterBody` …)은 레거시 「법인 변경등기」 데이터 소스와 07-02 「고정 토큰」
 * 그대로다. 개발 DB 의 법인변경등록1 이 이 이름들로 칸을 채운다. 사람이 보는 이름은 `label` 이다.
 * 새로 생긴 것은 신청일 · 작성일(`applyDate` · `writeDate`)과 임원 칸(`officer…`), 사업자번호,
 * 결의일(`resolutionDate`, 2026-10-11 — 의사록 · 서면결의서 · 취임승낙서의 회의 · 결의 날짜)이다.
 * ★ 별칭은 없다 — 옛 이름(`today` · `grade` · `day`)은 일회용 파일로 양식 쪽을 고친다(결정 D).
 *
 * =============================================================================
 * ★★★ 등기 설정이 코드 값을 이긴다 (Q7)
 * =============================================================================
 * 표시명 · 양식호수 · 「등기할 사항」 제목 · 등기의 목적/사유 · 세금 · 첨부서면은 등기 설정
 * (`tb_s080_doc_form_settings`)의 값이다. 레거시처럼 코드에 박힌 값이 설정을 덮지 않는다.
 *   · 설정이 비면 **빈칸**이다(결정 F) — 값을 지어 넣지 않는다. 채우는 것은 090 화면 때
 *   · 예외 하나 — 등기의 목적(`regPurpose`)은 설정이 비면 변경 구분 코드 이름이다(레거시 신청서와 같다)
 *   · 목적변경(PURPOSE)은 상호 줄(NAME, 71호)을 같이 쓴다(결정 F — 71호가 상호 · 목적 · 공고방법 공용)
 *   · `form_template_id` 는 출력에 쓰지 않는다(결정 E) — 서류는 양식의 법무 표시로 고른다
 *
 * =============================================================================
 * ★★ 주민번호는 이 함수에 **평문으로 들어와 출력값으로만 나간다** (Q4)
 * =============================================================================
 * 복호화는 API 가 출력 응답을 만드는 순간에 한다. 여기서는 모양만 바꾼다(`######-#######`).
 * 저장 · 로그 · 스냅샷에 남기지 않는 것은 부르는 쪽의 일이다 — 응답은 no-store.
 */
import { purposeLines, DEFAULT_RESIGN_REASON, OFFICER_CHANGE_KIND_LABEL, isOfficerChangeKind } from './corp-change.ts';
import type { CorpChangeSubmitSnapshot, SnapshotAddress, SnapshotOfficer } from './corp-change-transition.ts';
import { isLegalFormCompanyType, markAppliesTo, officersForMark, type LegalFormMark } from './legal-form-mark.ts';
import { parseDay } from './day.ts';

// =============================================================================
// 자리표시 목록 — 표양식 편집기와 대표님 안내표가 이 목록을 읽는다
// =============================================================================

/**
 * 값이 어디서 오나.
 *   case    — 건(작성완료 스냅샷 · 등기 설정). 모든 법인변경 양식에서 쓴다
 *   input   — 출력 직전에 사람이 넣는 날짜(Q8 — 신청일 · 작성일 둘뿐)
 *   officer — 그 임원. **임원마다 한 장** 양식에서만 값이 있다(건마다 양식에서는 빈칸)
 */
export type PrintFieldSource = 'case' | 'input' | 'officer';

export interface PrintField {
  /** 자리표시 이름 — 양식에 `{{name}}` 으로 적는다. */
  name: string;
  /** 사람이 보는 이름. */
  label: string;
  source: PrintFieldSource;
}

export const CORP_CHANGE_PRINT_FIELDS: readonly PrintField[] = [
  { name: 'companyName', label: '상호', source: 'case' },
  { name: 'corpNumber', label: '법인등록번호', source: 'case' },
  { name: 'bizNumber', label: '사업자등록번호', source: 'case' },
  { name: 'hqAddress', label: '본점주소', source: 'case' },
  { name: 'ceoName', label: '대표자', source: 'case' },
  { name: 'ceoAddress', label: '대표자주소', source: 'case' },
  { name: 'ceoPhone', label: '대표자전화', source: 'case' },
  { name: 'formLabel', label: '표시명', source: 'case' },
  { name: 'formNo', label: '양식호수', source: 'case' },
  { name: 'regPurpose', label: '등기의목적', source: 'case' },
  { name: 'regReason', label: '등기의사유', source: 'case' },
  { name: 'matter', label: '등기할사항(제목)', source: 'case' },
  { name: 'matterBody', label: '등기할사항(내용)', source: 'case' },
  { name: 'resolutionDate', label: '결의일', source: 'case' },
  { name: 'regLicenseTax', label: '등록면허세', source: 'case' },
  { name: 'localEduTax', label: '지방교육세', source: 'case' },
  { name: 'taxTotal', label: '세액합계', source: 'case' },
  { name: 'regFee', label: '등기신청수수료', source: 'case' },
  { name: 'attachments', label: '첨부서면', source: 'case' },
  { name: 'applyDate', label: '신청일', source: 'input' },
  { name: 'writeDate', label: '작성일', source: 'input' },
  { name: 'officerName', label: '임원성명', source: 'officer' },
  { name: 'officerPosition', label: '임원직위', source: 'officer' },
  { name: 'officerKind', label: '임원구분', source: 'officer' },
  { name: 'officerRrn', label: '임원주민등록번호', source: 'officer' },
  { name: 'officerAddress', label: '임원주소', source: 'officer' },
  { name: 'officerEffectiveDate', label: '임원효력일', source: 'officer' },
  { name: 'officerResignReason', label: '사임사유', source: 'officer' },
];

/** 출력 직전 입력 — 신청일 · 작성일. */
export interface PrintInputs {
  /** `YYYY-MM-DD`. 비면 빈칸. */
  applyDate?: string | null;
  writeDate?: string | null;
}

// =============================================================================
// 작성완료 스냅샷 읽기 — v1 · v2 (결정 H: 옛 v1 은 그대로 두고 읽을 때 채운다)
// =============================================================================

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function readAddress(v: unknown): SnapshotAddress {
  const o = isObj(v) ? v : {};
  return { zipCode: str(o.zipCode), address: str(o.address), addressDetail: str(o.addressDetail) };
}

/**
 * 저장된 `submit_snapshot` 을 v3 모양으로 읽는다. 스냅샷이 아니면 null(출력 거절 — 부르는 쪽).
 * ★ v1 에 없는 칸(전화 · 사업자번호 · 회사유형) · v3 전의 사임사유는 null 이다 — 지어 넣지 않는다.
 */
export function readSubmitSnapshot(raw: unknown): CorpChangeSubmitSnapshot | null {
  if (!isObj(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== 3)) return null;
  if (typeof raw.changeType !== 'string' || !isObj(raw.company)) return null;
  const c = raw.company;
  const officers = Array.isArray(raw.officers) ? raw.officers : [];
  return {
    version: 3,
    changeType: raw.changeType,
    company: {
      isTenant: c.isTenant === true,
      name: str(c.name),
      corpNumber: str(c.corpNumber),
      bizNumber: str(c.bizNumber),
      ceoName: str(c.ceoName),
      tel: str(c.tel),
      memberType: str(c.memberType),
      head: readAddress(c.head),
      ceoHome: readAddress(c.ceoHome),
    },
    payload: isObj(raw.payload) ? raw.payload : {},
    officers: officers.filter(isObj).map((o) => ({
      name: str(o.name) ?? '',
      changeKind: str(o.changeKind) ?? '',
      position: str(o.position),
      effectiveDate: str(o.effectiveDate),
      zipCode: str(o.zipCode),
      address: str(o.address),
      addressDetail: str(o.addressDetail),
      resignReason: str(o.resignReason),
    })),
  };
}

// =============================================================================
// 등기 설정 고르기 — 기본 줄 위에 회사유형 줄을 칸별로 덮는다(레거시 `resolveEffectiveSetting`)
// =============================================================================

/** `tb_s080_doc_form_settings` 한 줄 — 출력이 읽는 칸만. jsonb 칸은 모양을 믿지 않는다(`unknown`). */
export interface DocFormSettingRow {
  regTypeKey: string;
  /** '' = 기본 줄 · 'R' · 'A' = 회사유형 줄. */
  companyType: string;
  isActive: boolean;
  label: string | null;
  formNo: string | null;
  matter: string | null;
  taxMode: string | null;
  taxes: unknown;
  attachments: unknown;
  regPurpose: string | null;
  regReason: string | null;
  matterBody: string | null;
}

export interface DocFormTaxes {
  regLicense: number | null;
  localEdu: number | null;
  regFee: number | null;
}

export interface DocFormAttachment {
  name: string;
  /** 통수. 0 이면 번호 · 통수 없이 이름만 찍는다. */
  copies: number;
}

/** 덮어쓴 뒤의 설정. 글 칸은 `\n` 글자를 줄바꿈으로 바꾼 뒤다. */
export interface EffectiveDocFormSetting {
  label: string | null;
  formNo: string | null;
  matter: string | null;
  regPurpose: string | null;
  regReason: string | null;
  matterBody: string | null;
  /** 세금 — `tax_mode` 가 fixed 가 아니면 셋 다 null(레거시와 같다. 계산식은 없다 — Q10). */
  taxes: DocFormTaxes;
  attachments: DocFormAttachment[];
}

/** 이 구분이 읽는 설정 줄의 키 — 목적변경은 상호 줄(71호)을 같이 쓴다(결정 F). */
export function settingKeyFor(changeType: string): string {
  return changeType === 'PURPOSE' ? 'NAME' : changeType;
}

/**
 * 저장된 글의 `\n` **글자**(역슬래시 + n)를 줄바꿈으로 바꾼다(질문 4). 개발 DB 상호 줄의 「등기할 사항」
 * 제목이 그렇게 저장돼 있다. ★ 설정 값을 고치지 않는다 — 출력할 때만 바꾼다.
 */
export function unescapeNewlines(s: string): string {
  return s.replace(/\\n/g, '\n');
}

const blankToNull = (s: string | null): string | null => (s !== null && s.trim() !== '' ? s : null);

export function readTaxes(raw: unknown): DocFormTaxes | null {
  if (!isObj(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const t = { regLicense: num(raw.regLicense), localEdu: num(raw.localEdu), regFee: num(raw.regFee) };
  return t.regLicense === null && t.localEdu === null && t.regFee === null ? null : t;
}

/**
 * 첨부서면 — 두 모양이 섞여 있다(개발 DB 실측): 글자 목록(1통으로 친다) · `{ name, copies }` 목록.
 * 이름이 빈 항목은 버린다. 통수가 숫자가 아니면 1, 음수 · 소수는 버리고 1.
 */
export function readAttachments(raw: unknown): DocFormAttachment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DocFormAttachment[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim() !== '') out.push({ name: item, copies: 1 });
      continue;
    }
    if (!isObj(item) || typeof item.name !== 'string' || item.name.trim() === '') continue;
    const c = item.copies;
    out.push({ name: item.name, copies: typeof c === 'number' && Number.isInteger(c) && c >= 0 ? c : 1 });
  }
  return out.length > 0 ? out : null;
}

/**
 * 이 건에 쓸 설정. 기본 줄(`company_type = ''`)에 회사유형 줄을 **칸별로** 덮는다 — 회사유형 줄의
 * 칸이 비어 있으면 기본 줄 값을 쓴다. 두 줄 다 없으면 null(전부 빈칸으로 출력).
 *
 * @param memberType 회사유형 코드. R · A 가 아니면 기본 줄만 쓴다(결정 B).
 * ★ `tax_mode` 는 기본 줄 것이다(레거시와 같다).
 * ★ 끈 줄(`is_active = false`)은 없는 것으로 친다.
 */
export function pickDocFormSetting(
  rows: readonly DocFormSettingRow[],
  changeType: string,
  memberType: string | null,
): EffectiveDocFormSetting | null {
  const key = settingKeyFor(changeType);
  const live = rows.filter((r) => r.isActive && r.regTypeKey === key);
  const base = live.find((r) => r.companyType === '') ?? null;
  const over = isLegalFormCompanyType(memberType) ? (live.find((r) => r.companyType === memberType) ?? null) : null;
  if (!base && !over) return null;

  const text = (k: 'label' | 'formNo' | 'matter' | 'regPurpose' | 'regReason' | 'matterBody'): string | null => {
    const v = blankToNull(over?.[k] ?? null) ?? blankToNull(base?.[k] ?? null);
    return v === null ? null : unescapeNewlines(v);
  };
  const taxMode = (base ?? over)!.taxMode;
  const taxes =
    taxMode === 'fixed'
      ? (readTaxes(over?.taxes) ?? readTaxes(base?.taxes) ?? { regLicense: null, localEdu: null, regFee: null })
      : { regLicense: null, localEdu: null, regFee: null };
  const attachments = (readAttachments(over?.attachments) ?? readAttachments(base?.attachments) ?? []).map((a) => ({
    ...a,
    name: unescapeNewlines(a.name),
  }));

  return {
    label: text('label'),
    formNo: text('formNo'),
    matter: text('matter'),
    regPurpose: text('regPurpose'),
    regReason: text('regReason'),
    matterBody: text('matterBody'),
    taxes,
    attachments,
  };
}

// =============================================================================
// 모양 바꾸기 — 레거시 출력과 같은 글자
// =============================================================================

/** 금액 — 천 단위 쉼표. 없으면 빈칸. */
export function formatAmount(n: number | null): string {
  return n === null ? '' : String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `YYYY-MM-DD` → 「2026년 10월 11일」. 비었거나 없는 날짜면 빈칸. */
export function formatKoreanDate(day: string | null | undefined): string {
  if (!day) return '';
  const d = parseDay(day.slice(0, 10));
  if (!d) return '';
  const [y, m, dd] = day.slice(0, 10).split('-');
  return `${y}년 ${Number(m)}월 ${Number(dd)}일`;
}

/** 주소 — 「기본주소 상세주소」. 우편번호는 넣지 않는다(레거시 자리표시와 같다). */
export function formatAddress(a: Partial<SnapshotAddress> | null | undefined): string {
  return [a?.address, a?.addressDetail].map((s) => s?.trim()).filter(Boolean).join(' ');
}

/**
 * 주소 — 「(우편번호) 기본주소 상세주소」. **등기할 사항 문장에서만** 쓴다(레거시 `formatAddressParts`
 * 그대로, 결정 I).
 */
function formatAddressWithZip(a: unknown): string {
  const o = isObj(a) ? a : {};
  const base = [str(o.address), str(o.addressDetail)].filter(Boolean).join(' ').trim();
  const zip = str(o.zipCode);
  return zip ? `(${zip}) ${base}`.trim() : base;
}

/** 주민번호 평문 → `######-#######`. 숫자 13자리가 아니면 받은 그대로(손댄 값으로 보이지 않게). */
export function formatRrn(plain: string | null | undefined): string {
  if (!plain) return '';
  const digits = plain.replace(/-/g, '');
  return /^\d{13}$/.test(digits) ? `${digits.slice(0, 6)}-${digits.slice(6)}` : plain;
}

/**
 * 첨부서면 칸 — 줄마다 `1. 서류명  N통`(질문 3). 법원 양식은 항목마다 「1.」이다.
 * 0통 항목은 번호 · 통수 없이 이름만(`<기   타>` 같은 머리글).
 */
export function formatAttachments(list: readonly DocFormAttachment[]): string {
  return list.map((a) => (a.copies > 0 ? `1. ${a.name}  ${a.copies}통` : a.name)).join('\n');
}

/**
 * 등기할 사항 문장 — 레거시 `ChangeSummary` 그대로(결정 I). 구분을 모르면 빈칸.
 *
 *   상호 · 본점 · 대표주소 — 한 문장(대표주소는 이전연월일 줄이 붙는다)
 *   목적 — 사업목적 줄마다 `1. …` `2. …`
 *   임원 — 임원마다 `직위 성명 — 구분 (YYYY-MM-DD)`
 */
export function changeSummary(snapshot: CorpChangeSubmitSnapshot): string {
  const p = snapshot.payload;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (snapshot.changeType) {
    case 'NAME':
      return `상호를 「${s(p.newName)}」(으)로 변경한다.`;
    case 'HQ':
      return `본점을 「${formatAddressWithZip(p.newHqAddress)}」(으)로 이전한다.`;
    case 'CEO_ADDR':
      return [
        `대표이사 ${snapshot.company.ceoName ?? ''}의 주소를 「${formatAddressWithZip(p.newCeoAddress)}」(으)로 변경한다.`,
        `이전연월일 : ${formatKoreanDate(s(p.moveInDate))}`,
      ].join('\n');
    case 'PURPOSE':
      return purposeLines(s(p.purposes))
        .map((l, i) => `${i + 1}. ${l}`)
        .join('\n');
    case 'OFFICER':
      return snapshot.officers
        .map((o) => {
          const kind = isOfficerChangeKind(o.changeKind) ? OFFICER_CHANGE_KIND_LABEL[o.changeKind] : o.changeKind;
          const day = o.effectiveDate ? ` (${o.effectiveDate.slice(0, 10)})` : '';
          return `${o.position ?? ''} ${o.name} — ${kind}${day}`;
        })
        .join('\n');
    default:
      return '';
  }
}

// =============================================================================
// 출력값 — 자리표시 이름 → 글자
// =============================================================================

export interface CasePrintSource {
  snapshot: CorpChangeSubmitSnapshot;
  /** `pickDocFormSetting` 결과. null 이면 설정 칸은 전부 빈칸. */
  setting: EffectiveDocFormSetting | null;
  /** 변경 구분의 코드 이름(`LAW_CNG_TP`) — 등기의 목적 설정이 비었을 때 쓴다. */
  changeTypeName: string | null;
  inputs: PrintInputs;
}

/** 임원 한 명 — 스냅샷의 임원 + **출력 순간에 복호화한** 주민번호. */
export interface PrintOfficer extends SnapshotOfficer {
  /** 평문(하이픈 있어도 없어도). 없으면 null. ★ 저장 · 로그 금지 — 머리말 ★★. */
  rrn: string | null;
}

/**
 * 건마다 한 장 양식의 값. ★ 임원 칸(`officer…`)도 빈칸으로 넣는다 — 모든 이름에 값이 있게.
 *
 * 등기할 사항(내용) `matterBody` = 레거시 문장. 설정의 「등기할 사항(내용)」이 있으면 그 글을 앞에
 * 한 줄로 붙인다(질문 1).
 */
export function buildCasePrintValues(src: CasePrintSource): Record<string, string> {
  const { snapshot, setting, changeTypeName, inputs } = src;
  const c = snapshot.company;
  const t = setting?.taxes ?? { regLicense: null, localEdu: null, regFee: null };
  const total = t.regLicense === null && t.localEdu === null ? null : (t.regLicense ?? 0) + (t.localEdu ?? 0);
  const summary = changeSummary(snapshot);

  const values: Record<string, string> = {
    companyName: c.name ?? '',
    corpNumber: c.corpNumber ?? '',
    bizNumber: c.bizNumber ?? '',
    hqAddress: formatAddress(c.head),
    ceoName: c.ceoName ?? '',
    ceoAddress: formatAddress(c.ceoHome),
    ceoPhone: c.tel ?? '',
    formLabel: setting?.label ?? '',
    formNo: setting?.formNo ?? '',
    regPurpose: setting?.regPurpose ?? changeTypeName ?? '',
    regReason: setting?.regReason ?? '',
    matter: setting?.matter ?? '',
    matterBody: [setting?.matterBody, summary].filter((v): v is string => !!v).join('\n'),
    // 결의일 — 변경 내용의 `resolutionDate`(상호 · 목적 · 본점 · 임원). 대표주소 변경에는 없다 → 빈칸
    resolutionDate: formatKoreanDate(typeof snapshot.payload.resolutionDate === 'string' ? snapshot.payload.resolutionDate : null),
    regLicenseTax: formatAmount(t.regLicense),
    localEduTax: formatAmount(t.localEdu),
    taxTotal: formatAmount(total),
    regFee: formatAmount(t.regFee),
    attachments: formatAttachments(setting?.attachments ?? []),
    applyDate: formatKoreanDate(inputs.applyDate),
    writeDate: formatKoreanDate(inputs.writeDate),
  };
  for (const f of CORP_CHANGE_PRINT_FIELDS) if (f.source === 'officer') values[f.name] = '';
  return values;
}

/** 임원마다 한 장 양식의 값 — 건 값 위에 그 임원 칸을 얹는다. */
export function buildOfficerPrintValues(src: CasePrintSource, officer: PrintOfficer): Record<string, string> {
  return {
    ...buildCasePrintValues(src),
    officerName: officer.name,
    officerPosition: officer.position ?? '',
    officerKind: isOfficerChangeKind(officer.changeKind) ? OFFICER_CHANGE_KIND_LABEL[officer.changeKind] : '',
    officerRrn: formatRrn(officer.rrn),
    officerAddress: formatAddress(officer),
    officerEffectiveDate: formatKoreanDate(officer.effectiveDate),
    // 사임사유 — 사임 임원만. 비어 있으면 기본 문구(2026-10-14)
    officerResignReason: officer.changeKind === 'RESIGN' ? officer.resignReason?.trim() || DEFAULT_RESIGN_REASON : '',
  };
}

// =============================================================================
// 서류 묶음 — 이 건의 [서류 출력]에 뜨는 양식과 장(sheet)마다의 값
// =============================================================================

/** 법무 표시가 붙은 양식 하나 — 정의는 `migrateDefinition` 을 거친 것. */
export interface MarkedForm<D = unknown> {
  id: string;
  name: string;
  mark: LegalFormMark;
  definition: D;
}

export interface PrintSheet {
  /** 임원마다 양식이면 그 임원 이름, 건마다면 null. 화면이 장을 고를 때 쓴다. */
  officerName: string | null;
  values: Record<string, string>;
}

export interface PrintDocument<D = unknown> {
  formId: string;
  /** 서류 이름 = 양식 이름(결정 A). */
  name: string;
  unit: LegalFormMark['unit'];
  definition: D;
  /** 건마다 = 1장. 임원마다 = 표시의 임원 구분에 드는 임원 수(0장일 수 있다 — 화면이 「해당 임원 없음」). */
  sheets: PrintSheet[];
}

/**
 * 이 건에 뜨는 서류들 — 법무 표시가 이 구분 · 회사유형에 맞는 양식만(`markAppliesTo`).
 * 순서: 건마다 양식 먼저, 그다음 임원마다 양식. 같은 단위 안에서는 양식 이름 순.
 *
 * @param officers 스냅샷 임원 + 출력 순간 복호화한 주민번호. 순서는 스냅샷 순서.
 */
export function buildPrintDocuments<D>(
  forms: readonly MarkedForm<D>[],
  src: CasePrintSource,
  officers: readonly PrintOfficer[],
): PrintDocument<D>[] {
  const memberType = src.snapshot.company.memberType;
  const picked = forms
    .filter((f) => markAppliesTo(f.mark, src.snapshot.changeType, memberType))
    .sort((a, b) => (a.mark.unit === b.mark.unit ? a.name.localeCompare(b.name, 'ko') : a.mark.unit === 'case' ? -1 : 1));
  return picked.map((f) => ({
    formId: f.id,
    name: f.name,
    unit: f.mark.unit,
    definition: f.definition,
    sheets:
      f.mark.unit === 'case'
        ? [{ officerName: null, values: buildCasePrintValues(src) }]
        : officersForMark(f.mark, officers).map((o) => ({ officerName: o.name, values: buildOfficerPrintValues(src, o) })),
  }));
}

/**
 * 출력 주소의 날짜 `?applyDate=&writeDate=` — 비우면 빈칸으로 나간다. 있는 날짜(`YYYY-MM-DD`)가
 * 아니면 거절(어느 칸인지와 함께).
 */
export function parsePrintInputs(raw: Record<string, unknown>): { ok: true; value: PrintInputs } | { ok: false; field: string; message: string } {
  const out: PrintInputs = {};
  for (const [key, label] of [
    ['applyDate', '신청일'],
    ['writeDate', '작성일'],
  ] as const) {
    const v = raw[key];
    if (v === undefined || v === null || v === '') {
      out[key] = null;
      continue;
    }
    if (typeof v !== 'string' || parseDay(v) === null) return { ok: false, field: key, message: `${label}은(는) 날짜(YYYY-MM-DD)로 입력하세요` };
    out[key] = v;
  }
  return { ok: true, value: out };
}

/** `GET /legal/corp-changes/:id/print` 응답. ★ 주민번호 평문이 들어 있다 — no-store, 저장 · 로그 금지. */
export interface CorpChangePrintResponse<D = unknown> {
  id: string;
  changeType: string;
  status: string;
  documents: PrintDocument<D>[];
}

// =============================================================================
// 출력 이력(040) — [인쇄] 를 누를 때 한 줄
// =============================================================================

/**
 * 기록 요청 본문 `{ formId, sheet, applyDate?, writeDate? }`.
 *
 * ★ 임원 이름은 받지 않는다 — 장 번호(`sheet`)만 받고 서버가 스냅샷에서 이름을 찾는다(화면이 준 이름을
 *   기록하지 않는다). 건마다 서류는 `sheet` 가 0 이다.
 * ★ 주민번호 · 서류 값은 받지도 남기지도 않는다(040 머리말).
 */
export interface PrintLogInput {
  formId: string;
  sheet: number;
  applyDate: string | null;
  writeDate: string | null;
}

export function parsePrintLogBody(raw: unknown): { ok: true; value: PrintLogInput } | { ok: false; field: string; message: string } {
  if (!isObj(raw)) return { ok: false, field: 'body', message: '요청 형식이 올바르지 않습니다' };
  if (typeof raw.formId !== 'string' || raw.formId.trim() === '' || raw.formId.length > 100) {
    return { ok: false, field: 'formId', message: '서류(formId)가 올바르지 않습니다' };
  }
  const sheet = raw.sheet ?? 0;
  if (typeof sheet !== 'number' || !Number.isInteger(sheet) || sheet < 0 || sheet > 999) {
    return { ok: false, field: 'sheet', message: '장 번호(sheet)가 올바르지 않습니다' };
  }
  const dates = parsePrintInputs({ applyDate: raw.applyDate, writeDate: raw.writeDate });
  if (!dates.ok) return dates;
  return {
    ok: true,
    value: { formId: raw.formId, sheet, applyDate: dates.value.applyDate ?? null, writeDate: dates.value.writeDate ?? null },
  };
}

/** 상세의 「출력 이력」 한 줄. */
export interface PrintLogItem {
  /** `YYYY-MM-DD HH:mm`(DB 시간대 그대로). */
  printedAt: string;
  formName: string;
  /** 임원마다 서류의 장이면 그 임원, 아니면 null. */
  officerName: string | null;
  applyDate: string | null;
  writeDate: string | null;
  /** 삐용 회원 ID. */
  printedBy: string;
  printedRole: 'operator' | 'tenant';
}
