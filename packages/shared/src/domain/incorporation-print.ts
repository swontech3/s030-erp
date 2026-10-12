/**
 * 법인설립 서류 출력(10-5) — 자리표시 목록 · 출력값 · 스냅샷 읽기 · 서류 묶음. 순수 함수.
 *
 * 결정 2026-10-11:
 *   · 서류 7종(설립등기신청서 · 주주전원서면결의서 · 취임승낙서 · 주식발행사항동의서 · 주식인수증 · 조사보고서 ·
 *     정관)은 **레거시 화면**(`S-WonERP/src/components/incorporation/documents/*`)의 값 계산을 그대로 옮겼다.
 *     문구는 양식(표양식)에 있고, 여기는 자리표시에 들어갈 **값**만 만든다
 *   · 등기 설정은 법인변경과 같은 규칙(결정 1 (가)) — 설정 값을 쓰고 빈 칸은 빈칸. 등기의 목적만 비면 코드 이름
 *     (`LAW_EST_TP` 의 「주식회사 발기설립」). 사유 · 세금은 빈칸(세금 `tax_mode` 가 fixed 가 아니다), 첨부서면은 설정 값
 *   · 날짜(결정 2) — 출력 직전 입력은 신청일 · 작성일(기본 오늘, 화면 몫). 정관 끝 날짜 = 설립예정일,
 *     취임승낙서 선임일 = 취임일 → 비면 작성일
 *   · 정관 「서울특별시」(제3조① · 제4조②) = 본점 시·도 정식 이름(결정 3, `korea-sido.ts`)
 *   · 조사보고서(결정 4) — 건마다 한 장. 보고인(발기인이 아닌 이사 · 감사)이 없으면 칸을 비우고 대화상자에
 *     「해당 사람 없음」 안내(`notice`)
 *
 * ★ 상호는 합친 상호(`composedName` — 순수 상호 + 주식회사 + 위치)다. 레거시는 「주식회사 ○○」로 앞 고정이었다.
 * ★★ 주민번호는 이 함수에 **평문으로 들어와 출력값으로만 나간다** — 복호화 · no-store 는 API 몫(법인변경과 같다).
 *    목록 칸(이사 · 감사 · 발기인 …)에도 들어간다(레거시와 같다).
 * ★ 글자 모양(줄 앞 「- 」, 전각 공백 「　」 등)은 레거시 그대로다. 사람 여럿이 든 칸은 사람마다 줄을 잇는다
 *   (레거시의 사람 사이 여백은 넣지 않는다 — 칸 높이는 양식이 정한다).
 */
import { parseDay } from './day.ts';
import { purposeLines } from './corp-change.ts';
import {
  formatAmount,
  formatKoreanDate,
  formatRrn,
  formatAttachments,
  type EffectiveDocFormSetting,
  type PrintInputs,
} from './corp-change-print.ts';
import { personsForIncorpMark, type IncorpMarkUnit, type LegalFormMark } from './legal-form-mark.ts';
import { sidoOf } from './korea-sido.ts';
import type { IncorpInfoInput, IncorpSnapshotPerson, IncorporationSnapshot } from './incorporation-detail.ts';

// =============================================================================
// 자리표시 목록 — 표양식 편집기 · 출력 대화상자의 이름표가 이 목록을 읽는다
// =============================================================================

/**
 * 값이 어디서 오나.
 *   case   — 건(작성완료 스냅샷 · 등기 설정). 모든 설립 양식에서 쓴다
 *   input  — 출력 직전에 사람이 넣는 날짜(신청일 · 작성일)
 *   person — 그 장의 사람. **임원마다 · 발기인마다** 양식에서만 값이 있다(건마다 양식에서는 빈칸)
 */
export type IncorpPrintFieldSource = 'case' | 'input' | 'person';

export interface IncorpPrintField {
  /** 자리표시 이름 — 양식에 `{{name}}` 으로 적는다. */
  name: string;
  /** 사람이 보는 이름. */
  label: string;
  source: IncorpPrintFieldSource;
}

export const INCORP_PRINT_FIELDS: readonly IncorpPrintField[] = [
  // 회사 · 자본
  { name: 'companyName', label: '상호', source: 'case' },
  { name: 'companyNameEnClause', label: '영문 상호 문장', source: 'case' },
  { name: 'hqAddress', label: '본점', source: 'case' },
  { name: 'hqSido', label: '본점 시·도', source: 'case' },
  { name: 'capitalAmount', label: '자본금', source: 'case' },
  { name: 'capitalAmountKorean', label: '자본금(한글)', source: 'case' },
  { name: 'parValue', label: '1주의 금액', source: 'case' },
  { name: 'unitsAuthorized', label: '발행할 주식의 총수', source: 'case' },
  { name: 'unitsIssued', label: '설립 때 발행하는 주식의 총수', source: 'case' },
  { name: 'publicNoticeMethod', label: '공고방법', source: 'case' },
  { name: 'fiscalYear', label: '사업연도', source: 'case' },
  { name: 'rosterClosure', label: '주주명부 폐쇄기간', source: 'case' },
  { name: 'recordDate', label: '기준일', source: 'case' },
  { name: 'plannedDate', label: '설립예정일', source: 'case' },
  { name: 'meetingDate', label: '발기인총회 개최일', source: 'case' },
  { name: 'purposeList', label: '목적(번호 목록)', source: 'case' },
  { name: 'articlesPurposeList', label: '정관 목적(번호 목록 + 부대사업)', source: 'case' },
  // 사람 목록
  { name: 'directorAuditorList', label: '이사·감사 성명과 주민등록번호', source: 'case' },
  { name: 'representativeList', label: '대표이사 성명과 주소', source: 'case' },
  { name: 'ceoName', label: '대표이사 성명', source: 'case' },
  { name: 'ceoAddress', label: '대표이사 주소', source: 'case' },
  { name: 'founderUnitsTotal', label: '주주 전원의 주식수', source: 'case' },
  { name: 'resolutionOfficerList', label: '이사·감사 선임(서면결의)', source: 'case' },
  { name: 'resolutionRepresentativeList', label: '대표이사 선임(서면결의)', source: 'case' },
  { name: 'shareholderSignList', label: '주주 기명날인(서면결의)', source: 'case' },
  { name: 'founderSignList', label: '발기인 기명날인(주식발행사항동의서)', source: 'case' },
  { name: 'reporterList', label: '조사보고인', source: 'case' },
  { name: 'officerNameList', label: '이사·감사 직위와 성명(의사록)', source: 'case' },
  { name: 'reporterNameList', label: '검사인 직위와 성명(의사록)', source: 'case' },
  { name: 'reporterSignList', label: '검사인 기명날인(조사보고서)', source: 'case' },
  { name: 'articlesFounderList', label: '정관 발기인', source: 'case' },
  // 등기 설정
  { name: 'formLabel', label: '표시명', source: 'case' },
  { name: 'formNo', label: '양식호수', source: 'case' },
  { name: 'regPurpose', label: '등기의목적', source: 'case' },
  { name: 'regReason', label: '등기의사유', source: 'case' },
  { name: 'regLicenseTax', label: '등록면허세', source: 'case' },
  { name: 'localEduTax', label: '지방교육세', source: 'case' },
  { name: 'taxTotal', label: '세액합계', source: 'case' },
  { name: 'regFee', label: '등기신청수수료', source: 'case' },
  { name: 'attachments', label: '첨부서면', source: 'case' },
  // 출력 직전 입력
  { name: 'applyDate', label: '신청일', source: 'input' },
  { name: 'writeDate', label: '작성일', source: 'input' },
  // 그 장의 사람(임원마다 · 발기인마다)
  { name: 'personName', label: '성명', source: 'person' },
  { name: 'personRole', label: '직위', source: 'person' },
  { name: 'personRrn', label: '주민등록번호', source: 'person' },
  { name: 'personAddress', label: '주소', source: 'person' },
  { name: 'appointedDate', label: '선임일', source: 'person' },
  { name: 'personUnits', label: '인수 주식 수', source: 'person' },
  { name: 'personAmount', label: '인수 총액', source: 'person' },
];

/** 정관 제2조 목적의 끝 줄 — 레거시 `ArticlesDoc` 그대로. */
export const ARTICLES_INCIDENTAL_PURPOSE = '위 각 호에 부대되는 일체의 사업';
/** 공고방법이 비었을 때 — 레거시 정관 · 설립 입력 칸 안내와 같다. */
export const DEFAULT_PUBLIC_NOTICE = '회사의 인터넷 홈페이지';

// =============================================================================
// 모양 바꾸기 — 레거시 `incorp-documents.ts` 그대로
// =============================================================================

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const BIG = ['', '만', '억', '조'];

/** 금액 한글 — 100000000 → 「금 일억원정」. 십 · 백 · 천 앞의 일은 뺀다. 0 · 음수 · 없음은 「금 영원정」(레거시 그대로). */
export function koreanAmount(n: number | null): string {
  if (!n || n < 0) return '금 영원정';
  const groups: number[] = [];
  let x = Math.floor(n);
  while (x > 0) {
    groups.push(x % 10000);
    x = Math.floor(x / 10000);
  }
  let result = '';
  for (let g = groups.length - 1; g >= 0; g--) {
    const grp = groups[g]!;
    if (grp === 0) continue;
    let s = '';
    const d = [grp % 10, Math.floor(grp / 10) % 10, Math.floor(grp / 100) % 10, Math.floor(grp / 1000) % 10];
    for (let i = 3; i >= 0; i--) {
      if (d[i] === 0) continue;
      s += (d[i] === 1 && i > 0 ? '' : (DIGITS[d[i]!] ?? '')) + (SMALL[i] ?? '');
    }
    result += s + (BIG[g] ?? '');
  }
  return `금 ${result}원정`;
}

/** 주소 — 「(우편번호) 기본주소 상세주소」. 레거시 설립 서류의 `formatAddress` 그대로(우편번호를 넣는다). */
export function formatIncorpAddress(a: { zipCode?: string | null; address?: string | null; addressDetail?: string | null } | null | undefined): string {
  const base = [a?.address, a?.addressDetail].filter(Boolean).join(' ').trim();
  return a?.zipCode ? `(${a.zipCode}) ${base}`.trim() : base;
}

const monthDay = (s: string | null): { mm: number; dd: number } | null => {
  if (!s) return null;
  const [mm, dd] = s.split('-').map((x) => parseInt(x, 10));
  return mm && dd ? { mm, dd } : null;
};

/** 사업연도 — 「매년 1월 1일부터 12월 31일까지」. 둘 중 하나라도 비면 레거시 기본값(1월 1일 ~ 12월 31일). */
export function fiscalYearText(start: string | null, end: string | null): string {
  const s = monthDay(start);
  const e = monthDay(end);
  if (!s || !e) return '매년 1월 1일부터 12월 31일까지';
  return `매년 ${s.mm}월 ${s.dd}일부터 ${e.mm}월 ${e.dd}일까지`;
}

/**
 * 정관 제18조 — 주주명부 폐쇄기간(사업연도 시작 달의 첫날부터 그 달 말일, 비윤년 기준) · 기준일(사업연도 끝).
 * 레거시 `ArticlesDoc` 의 `record` 그대로. 사업연도가 비면 레거시 기본값.
 */
export function rosterRecordText(start: string | null, end: string | null): { closure: string; base: string } {
  const s = monthDay(start);
  const e = monthDay(end);
  if (!s || !e) return { closure: '매년 1월 1일부터 1월 31일까지', base: '매년 12월 31일' };
  const lastDay = new Date(2001, s.mm, 0).getDate();
  return { closure: `매년 ${s.mm}월 ${s.dd}일부터 ${s.mm}월 ${lastDay}일까지`, base: `매년 ${e.mm}월 ${e.dd}일` };
}

/**
 * 정관 제1조의 영문 상호 문장 — 「영문으로는 ○○○ Co., Ltd.라 표기한다.」. 영문 상호가 없으면 ''.
 * 이미 법인 표기(Co.,Ltd · Ltd · Inc · Corp)가 있으면 붙이지 않는다(레거시 규칙 그대로).
 */
export function englishNameClause(nameEn: string | null | undefined): string {
  const en = nameEn?.trim();
  if (!en) return '';
  return /(co\.?,?\s*ltd|\bltd\b|\binc\b|\bcorp)/i.test(en) ? `영문으로는 ${en}라 표기한다.` : `영문으로는 ${en} Co., Ltd.라 표기한다.`;
}

/** 직위 — 「대표이사·이사·감사」 순으로 이어 붙인다(레거시 `personRoleLabel`). */
export function personRoleLabel(p: Pick<IncorpSnapshotPerson, 'isDirector' | 'isAuditor' | 'isRepresentative'>): string {
  const r: string[] = [];
  if (p.isRepresentative) r.push('대표이사');
  if (p.isDirector) r.push('이사');
  if (p.isAuditor) r.push('감사');
  return r.join('·');
}

/** 의사록 · 조사보고서의 직위 — 감사만 맡으면 「감　　사」, 그 밖은 「사내이사」(결정 2026-10-12). */
export function minutesRole(p: Pick<IncorpSnapshotPerson, 'isDirector' | 'isAuditor'>): string {
  return p.isAuditor && !p.isDirector ? '감　　사' : '사내이사';
}

/** 조사보고인 — 발기인이 아닌 이사 · 감사(레거시 `InvestigationReportDoc`, 상법 제298조). */
export function investigationReporters<T extends Pick<IncorpSnapshotPerson, 'isFounder' | 'isDirector' | 'isAuditor'>>(persons: readonly T[]): T[] {
  return persons.filter((p) => (p.isDirector || p.isAuditor) && !p.isFounder);
}

// =============================================================================
// 작성완료 스냅샷 읽기
// =============================================================================

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 저장된 `submit_snapshot`(v1)을 읽는다. 스냅샷이 아니면 null(출력 거절 — 부르는 쪽). */
export function readIncorporationSnapshot(raw: unknown): IncorporationSnapshot | null {
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.info)) return null;
  const i = raw.info;
  const hq = isObj(i.hq) ? { zipCode: str(i.hq.zipCode), address: str(i.hq.address), addressDetail: str(i.hq.addressDetail) } : null;
  const info: IncorpInfoInput = {
    nameKo: str(i.nameKo),
    nameEn: str(i.nameEn),
    hq,
    capitalAmount: num(i.capitalAmount),
    parValue: num(i.parValue),
    unitsAuthorized: num(i.unitsAuthorized),
    unitsIssued: num(i.unitsIssued),
    publicNoticeMethod: str(i.publicNoticeMethod),
    fiscalStart: str(i.fiscalStart),
    fiscalEnd: str(i.fiscalEnd),
    plannedDate: str(i.plannedDate),
    purposes: str(i.purposes),
    companyTypePosition: str(i.companyTypePosition),
  };
  const persons = (Array.isArray(raw.persons) ? raw.persons : []).filter(isObj).map(
    (p): IncorpSnapshotPerson => ({
      name: str(p.name) ?? '',
      isFounder: p.isFounder === true,
      isDirector: p.isDirector === true,
      isAuditor: p.isAuditor === true,
      isRepresentative: p.isRepresentative === true,
      unitsSubscribed: num(p.unitsSubscribed) ?? 0,
      appointmentDate: str(p.appointmentDate),
      zipCode: str(p.zipCode),
      address: str(p.address),
      addressDetail: str(p.addressDetail),
    }),
  );
  return {
    version: 1,
    composedName: str(raw.composedName) ?? '',
    companyTypePosition: str(raw.companyTypePosition) ?? 'F',
    info,
    persons,
  };
}

// =============================================================================
// 출력값
// =============================================================================

/** 사람 한 명 — 스냅샷의 사람 + **출력 순간에 복호화한** 주민번호. ★ 저장 · 로그 금지. */
export interface IncorpPrintPerson extends IncorpSnapshotPerson {
  rrn: string | null;
}

export interface IncorpPrintSource {
  snapshot: IncorporationSnapshot;
  /** 스냅샷 순서 그대로, 주민번호를 붙인 사람. */
  persons: readonly IncorpPrintPerson[];
  /** 등기 설정(설립 · 발기설립 줄, `pickDocFormSetting`). null 이면 설정 칸은 빈칸. */
  setting: EffectiveDocFormSetting | null;
  /** 설립 구분의 코드 이름(`LAW_EST_TP` R_PROMOTER) — 등기의 목적 설정이 비었을 때 쓴다. */
  methodName: string | null;
  inputs: PrintInputs;
}

const count = (n: number | null): string => (n ? formatAmount(n) : '');
const lines = (xs: readonly string[]) => xs.join('\n');

/** 건마다 한 장 양식의 값. ★ 사람 칸(`person…`)도 빈칸으로 넣는다 — 모든 이름에 값이 있게. */
export function buildIncorpCasePrintValues(src: IncorpPrintSource): Record<string, string> {
  const { snapshot, persons, setting, methodName, inputs } = src;
  const info = snapshot.info;
  const name = snapshot.composedName;
  const hq = formatIncorpAddress(info.hq);
  const rrnOf = (p: IncorpPrintPerson) => formatRrn(p.rrn);

  const founders = persons.filter((p) => p.isFounder);
  const directors = persons.filter((p) => p.isDirector);
  const auditors = persons.filter((p) => p.isAuditor);
  const representatives = persons.filter((p) => p.isRepresentative);
  const rep = representatives[0] ?? null;
  const totalUnits = founders.reduce((s, p) => s + (p.unitsSubscribed || 0), 0);
  const purposes = purposeLines(info.purposes ?? '');
  const record = rosterRecordText(info.fiscalStart, info.fiscalEnd);
  const t = setting?.taxes ?? { regLicense: null, localEdu: null, regFee: null };
  const total = t.regLicense === null && t.localEdu === null ? null : (t.regLicense ?? 0) + (t.localEdu ?? 0);

  const values: Record<string, string> = {
    companyName: name,
    companyNameEnClause: englishNameClause(info.nameEn),
    hqAddress: hq,
    hqSido: sidoOf(info.hq?.address),
    capitalAmount: count(info.capitalAmount),
    capitalAmountKorean: koreanAmount(info.capitalAmount),
    parValue: count(info.parValue),
    unitsAuthorized: count(info.unitsAuthorized),
    unitsIssued: count(info.unitsIssued),
    publicNoticeMethod: info.publicNoticeMethod?.trim() || DEFAULT_PUBLIC_NOTICE,
    fiscalYear: fiscalYearText(info.fiscalStart, info.fiscalEnd),
    rosterClosure: record.closure,
    recordDate: record.base,
    plannedDate: formatKoreanDate(info.plannedDate),
    // 발기인총회 개최일 — 설립예정일 값을 쓴다(결정 2026-10-12)
    meetingDate: formatKoreanDate(info.plannedDate),
    purposeList: lines(purposes.map((l, i) => `${i + 1}. ${l}`)),
    articlesPurposeList: lines([...purposes, ARTICLES_INCIDENTAL_PURPOSE].map((l, i) => `${i + 1}. ${l}`)),

    // 설립등기신청서 — 레거시 `RegistrationAppDoc`
    directorAuditorList: lines(
      persons.filter((p) => p.isDirector || p.isAuditor).map((p) => `${p.isAuditor && !p.isDirector ? '감사' : '이사'} ${p.name} (${rrnOf(p)})`),
    ),
    representativeList: lines(representatives.flatMap((p) => [`대표이사 ${p.name}`, formatIncorpAddress(p)])),
    ceoName: rep?.name ?? '',
    ceoAddress: rep ? formatIncorpAddress(rep) : '',

    // 주주전원서면결의서 — 레거시 `ShareholderResolutionDoc`
    founderUnitsTotal: count(totalUnits),
    resolutionOfficerList: lines([
      ...directors.map((p) => `- 사내이사 : ${p.name} (주민등록번호 ${rrnOf(p)})`),
      ...auditors.map((p) => `- 감　　사 : ${p.name} (주민등록번호 ${rrnOf(p)})`),
    ]),
    resolutionRepresentativeList: lines(
      representatives.map((p) => `- 사내이사 ${p.name}를 대표이사로 선임한다. (피선임자는 즉석에서 취임을 승낙하다.)`),
    ),
    shareholderSignList: lines(
      founders.map((p) => {
        const ratio = totalUnits ? Math.round(((p.unitsSubscribed || 0) / totalUnits) * 1000) / 10 : 0;
        return `주주 (지분율 ${ratio}%) : ${p.name} (주민등록번호 ${rrnOf(p)})　　(인)`;
      }),
    ),

    // 주식발행사항동의서 — 레거시 `StockIssuanceConsentDoc`
    founderSignList: lines(founders.flatMap((p) => [`발기인 ${p.name} (주민등록번호 ${rrnOf(p)})　　(인)`, `주소 : ${formatIncorpAddress(p)}`])),

    // 조사보고서 — 레거시 `InvestigationReportDoc`
    reporterList: lines(
      investigationReporters(persons).flatMap((p) => [
        `조사보고인 ${personRoleLabel(p)} : ${p.name} (인)`,
        `주민등록번호 : ${rrnOf(p)}`,
        `주소 : ${formatIncorpAddress(p)}`,
      ]),
    ),

    // 발기인총회의사록 · 조사보고서(새 docx, 결정 2026-10-12) — 주민번호 없이 직위 + 성명.
    // 직위는 `minutesRole`(대표이사 선임은 `representativeList` 몫)
    officerNameList: lines(persons.filter((p) => p.isDirector || p.isAuditor).map((p) => `${minutesRole(p)}　${p.name}`)),
    reporterNameList: lines(investigationReporters(persons).map((p) => `${minutesRole(p)}　${p.name}`)),
    reporterSignList: lines(investigationReporters(persons).map((p) => `${minutesRole(p)}　${p.name}　　(인)`)),

    // 정관 말미 — 레거시 `ArticlesDoc`
    articlesFounderList: lines(founders.flatMap((p) => [`발기인　성명 : ${p.name} (${rrnOf(p)})　(인)`, `주소 : ${formatIncorpAddress(p)}`])),

    // 등기 설정 — 법인변경과 같은 규칙(결정 1 (가))
    formLabel: setting?.label ?? '',
    formNo: setting?.formNo ?? '',
    regPurpose: setting?.regPurpose ?? methodName ?? '',
    regReason: setting?.regReason ?? '',
    regLicenseTax: formatAmount(t.regLicense),
    localEduTax: formatAmount(t.localEdu),
    taxTotal: formatAmount(total),
    regFee: formatAmount(t.regFee),
    attachments: formatAttachments(setting?.attachments ?? []),

    applyDate: formatKoreanDate(inputs.applyDate),
    writeDate: formatKoreanDate(inputs.writeDate),
  };
  for (const f of INCORP_PRINT_FIELDS) if (f.source === 'person') values[f.name] = '';
  return values;
}

/** 임원마다 · 발기인마다 한 장 양식의 값 — 건 값 위에 그 사람 칸을 얹는다. */
export function buildIncorpPersonPrintValues(src: IncorpPrintSource, person: IncorpPrintPerson): Record<string, string> {
  const par = src.snapshot.info.parValue ?? 0;
  const appointed = person.appointmentDate && parseDay(person.appointmentDate.slice(0, 10)) ? person.appointmentDate : (src.inputs.writeDate ?? null);
  return {
    ...buildIncorpCasePrintValues(src),
    personName: person.name,
    // 취임승낙서 — 직위가 비면 「이사」(레거시 그대로)
    personRole: personRoleLabel(person) || '이사',
    personRrn: formatRrn(person.rrn),
    personAddress: formatIncorpAddress(person),
    // 선임일 = 취임일 → 비면 작성일(결정 2)
    appointedDate: formatKoreanDate(appointed),
    personUnits: count(person.unitsSubscribed),
    personAmount: count(par * (person.unitsSubscribed || 0)),
  };
}

// =============================================================================
// 서류 묶음
// =============================================================================

/** 법무 표시가 붙은 양식 하나 — 정의는 `migrateDefinition` 을 거친 것, `tokens` 는 그 정의의 자리표시. */
export interface IncorpMarkedForm<D = unknown> {
  id: string;
  name: string;
  mark: LegalFormMark;
  definition: D;
  tokens: readonly string[];
}

export interface IncorpPrintSheet {
  /** 임원마다 · 발기인마다 양식이면 그 사람 이름, 건마다면 null. */
  personName: string | null;
  values: Record<string, string>;
}

export interface IncorpPrintDocument<D = unknown> {
  formId: string;
  /** 서류 이름 = 양식 이름. */
  name: string;
  unit: IncorpMarkUnit;
  definition: D;
  /** 건마다 = 1장. 임원마다 · 발기인마다 = 해당 사람 수(0장일 수 있다 — 화면이 「해당 사람 없음」). */
  sheets: IncorpPrintSheet[];
  /** 대화상자 안내 — 조사보고인이 없을 때(결정 4). 없으면 null. */
  notice: string | null;
}

/** 조사보고인이 없을 때의 안내(결정 4). */
export const NO_REPORTER_NOTICE = '해당 사람 없음 — 조사보고인(발기인이 아닌 이사 · 감사)이 없어 보고인 칸이 비어 있습니다';

/** 조사보고인 칸 — 이 중 하나라도 쓰는 양식에 「해당 사람 없음」 안내가 붙는다. */
const REPORTER_FIELDS = ['reporterList', 'reporterNameList', 'reporterSignList'];

const UNIT_ORDER: Record<IncorpMarkUnit, number> = { case: 0, officer: 1, founder: 2 };

/**
 * 이 건에 뜨는 서류들 — 법인설립 표시가 붙은 양식만. 순서: 건마다 → 임원마다 → 발기인마다, 같은 단위 안에서는
 * 양식 이름 순.
 * ★ 「해당 사람 없음」 안내는 양식이 조사보고인 칸(`REPORTER_FIELDS`)을 쓰는데 보고인이 없을 때만 붙는다.
 */
export function buildIncorpPrintDocuments<D>(
  forms: readonly IncorpMarkedForm<D>[],
  src: IncorpPrintSource,
): IncorpPrintDocument<D>[] {
  const picked = forms
    .filter((f): f is IncorpMarkedForm<D> & { mark: { domain: 'incorporation'; unit: IncorpMarkUnit } } => f.mark.domain === 'incorporation')
    .sort((a, b) => UNIT_ORDER[a.mark.unit] - UNIT_ORDER[b.mark.unit] || a.name.localeCompare(b.name, 'ko'));
  const noReporter = investigationReporters(src.persons).length === 0;
  return picked.map((f) => ({
    formId: f.id,
    name: f.name,
    unit: f.mark.unit,
    definition: f.definition,
    sheets:
      f.mark.unit === 'case'
        ? [{ personName: null, values: buildIncorpCasePrintValues(src) }]
        : personsForIncorpMark(f.mark, src.persons).map((p) => ({ personName: p.name, values: buildIncorpPersonPrintValues(src, p) })),
    notice: noReporter && REPORTER_FIELDS.some((t) => f.tokens.includes(t)) ? NO_REPORTER_NOTICE : null,
  }));
}

/** `GET /legal/incorporations/:id/print` 응답. ★ 주민번호 평문이 들어 있다 — no-store, 저장 · 로그 금지. */
export interface IncorporationPrintResponse<D = unknown> {
  id: string;
  status: string;
  documents: IncorpPrintDocument<D>[];
}

/** 상세의 「출력 이력」 한 줄(043). */
export interface IncorpPrintLogItem {
  /** `YYYY-MM-DD HH:mm`(DB 시간대 그대로). */
  printedAt: string;
  formName: string;
  /** 임원마다 · 발기인마다 서류의 장이면 그 사람, 아니면 null. */
  personName: string | null;
  applyDate: string | null;
  writeDate: string | null;
  printedBy: string;
  printedRole: 'operator' | 'tenant';
}
