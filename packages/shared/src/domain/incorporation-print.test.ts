import { describe, expect, it } from 'vitest';
import {
  INCORP_PRINT_FIELDS,
  NO_REPORTER_NOTICE,
  buildIncorpCasePrintValues,
  buildIncorpPersonPrintValues,
  buildIncorpPrintDocuments,
  englishNameClause,
  fiscalYearText,
  koreanAmount,
  koreanTime,
  officerCompositionText,
  readIncorporationSnapshot,
  rosterRecordText,
  type IncorpPrintPerson,
  type IncorpPrintSource,
} from './incorporation-print.ts';
import { buildIncorporationSnapshot, parseIncorpInfo, type IncorpPersonView } from './incorporation-detail.ts';
import type { EffectiveDocFormSetting } from './corp-change-print.ts';

const person = (o: Partial<IncorpPrintPerson> & { name: string }): IncorpPrintPerson => ({
  isFounder: false,
  isDirector: false,
  isAuditor: false,
  isRepresentative: false,
  unitsSubscribed: 0,
  appointmentDate: null,
  zipCode: null,
  address: null,
  addressDetail: null,
  rrn: null,
  ...o,
});

const info = (() => {
  const r = parseIncorpInfo({
    nameKo: '한가람',
    nameEn: 'Hangaram',
    companyTypePosition: 'B',
    hq: { zipCode: '06164', address: '서울 강남구 테헤란로 1', addressDetail: '3층' },
    capitalAmount: 100_000_000,
    parValue: 10_000,
    unitsAuthorized: 100_000,
    unitsIssued: 10_000,
    publicNoticeMethod: null,
    fiscalStart: '01-01',
    fiscalEnd: '12-31',
    plannedDate: '2026-11-02',
    purposes: '소프트웨어 개발\n경영 컨설팅',
  });
  if (!r.ok) throw new Error('fixture');
  return r.value;
})();

const persons: IncorpPrintPerson[] = [
  person({ name: '홍길동', isFounder: true, isDirector: true, isRepresentative: true, unitsSubscribed: 6_000, rrn: '9001011234567', zipCode: '06164', address: '서울 강남구 1', appointmentDate: '2026-11-01' }),
  person({ name: '김철수', isFounder: true, unitsSubscribed: 4_000, rrn: '9102022345678', address: '서울 서초구 2' }),
  person({ name: '이감사', isAuditor: true, rrn: '8803031234567', address: '경기 성남시 3' }),
];

const snapshotOf = (ps: IncorpPrintPerson[]) =>
  buildIncorporationSnapshot(
    info,
    ps.map((p, i): IncorpPersonView => ({ ...p, id: `p${i}`, rrnMasked: null, sortOrder: i + 1 })),
  );

const setting: EffectiveDocFormSetting = {
  label: '발기설립',
  formNo: '[양식 제65-1호]',
  matter: null,
  regPurpose: null,
  regReason: null,
  matterBody: null,
  taxes: { regLicense: null, localEdu: null, regFee: null },
  attachments: [
    { name: '정관', copies: 1 },
    { name: '주식인수증', copies: 1 },
  ],
};

const src = (ps = persons, s: EffectiveDocFormSetting | null = setting): IncorpPrintSource => ({
  snapshot: snapshotOf(ps),
  persons: ps,
  setting: s,
  methodName: '주식회사 발기설립',
  inputs: { applyDate: '2026-11-03', writeDate: '2026-11-02' },
});

describe('모양 바꾸기 — 레거시 그대로', () => {
  it('금액 한글', () => {
    expect(koreanAmount(100_000_000)).toBe('금 일억원정');
    expect(koreanAmount(15_000_000)).toBe('금 천오백만원정');
    expect(koreanAmount(3_000_000_000)).toBe('금 삼십억원정');
    expect(koreanAmount(0)).toBe('금 영원정');
  });
  it('사업연도 · 제18조', () => {
    expect(fiscalYearText('04-01', '03-31')).toBe('매년 4월 1일부터 3월 31일까지');
    expect(rosterRecordText('04-01', '03-31')).toEqual({ closure: '매년 4월 1일부터 4월 30일까지', base: '매년 3월 31일' });
    expect(rosterRecordText('02-01', '01-31').closure).toBe('매년 2월 1일부터 2월 28일까지');
    expect(fiscalYearText(null, '12-31')).toBe('매년 1월 1일부터 12월 31일까지');
  });
  it('영문 상호 문장 — Co., Ltd. 는 없을 때만 붙인다', () => {
    expect(englishNameClause('Hangaram')).toBe('영문으로는 Hangaram Co., Ltd.라 표기한다.');
    expect(englishNameClause('Hangaram Inc.')).toBe('영문으로는 Hangaram Inc.라 표기한다.');
    expect(englishNameClause(' ')).toBe('');
  });
});

describe('buildIncorpCasePrintValues', () => {
  const v = buildIncorpCasePrintValues(src());

  it('★ 상호는 합친 상호(위치를 따른다) · 시·도는 정식 이름 · 공고방법 기본값', () => {
    expect(v.companyName).toBe('한가람 주식회사');
    expect(v.hqAddress).toBe('(06164) 서울 강남구 테헤란로 1 3층');
    expect(v.hqSido).toBe('서울특별시');
    expect(v.publicNoticeMethod).toBe('회사의 인터넷 홈페이지');
  });

  it('자본 · 주식 · 목적', () => {
    expect([v.capitalAmount, v.capitalAmountKorean, v.parValue, v.unitsIssued]).toEqual(['100,000,000', '금 일억원정', '10,000', '10,000']);
    expect(v.purposeList).toBe('1. 소프트웨어 개발\n2. 경영 컨설팅');
    expect(v.articlesPurposeList).toBe('1. 소프트웨어 개발\n2. 경영 컨설팅\n3. 위 각 호에 부대되는 일체의 사업');
    expect(v.plannedDate).toBe('2026년 11월 2일');
  });

  it('사람 목록 — 주민번호는 이 값에만 들어간다', () => {
    expect(v.directorAuditorList).toBe('이사 홍길동 (900101-1234567)\n감사 이감사 (880303-1234567)');
    expect(v.representativeList).toBe('대표이사 홍길동\n(06164) 서울 강남구 1');
    expect(v.ceoName).toBe('홍길동');
    expect(v.founderUnitsTotal).toBe('10,000');
    expect(v.shareholderSignList).toBe(
      '주주 (지분율 60%) : 홍길동 (주민등록번호 900101-1234567)　　(인)\n주주 (지분율 40%) : 김철수 (주민등록번호 910202-2345678)　　(인)',
    );
    expect(v.resolutionOfficerList).toBe('- 사내이사 : 홍길동 (주민등록번호 900101-1234567)\n- 감　　사 : 이감사 (주민등록번호 880303-1234567)');
    expect(v.reporterList).toBe('조사보고인 감사 : 이감사 (인)\n주민등록번호 : 880303-1234567\n주소 : 경기 성남시 3');
  });

  it('★ 의사록 · 조사보고서 — 직위 + 성명(주민번호 없음), 감사만 맡으면 감사 · 그 밖은 사내이사', () => {
    const ps = [
      ...persons,
      person({ name: '박이사', isDirector: true, isRepresentative: true }),
      person({ name: '최겸직', isDirector: true, isAuditor: true }),
    ];
    const w = buildIncorpCasePrintValues(src(ps));
    expect(w.officerNameList).toBe('사내이사　홍길동\n감　　사　이감사\n사내이사　박이사\n사내이사　최겸직');
    // 검사인 = 발기인이 아닌 이사 · 감사(홍길동은 발기인)
    expect(w.reporterNameList).toBe('감　　사　이감사\n사내이사　박이사\n사내이사　최겸직');
    expect(w.reporterSignList).toBe('감　　사　이감사　　(인)\n사내이사　박이사　　(인)\n사내이사　최겸직　　(인)');
    expect(w.officerNameList + w.reporterNameList + w.reporterSignList).not.toMatch(/\d{6}/);
  });

  it('★ 발기인총회 개최일 = 설립예정일', () => {
    expect(v.meetingDate).toBe('2026년 11월 2일');
  });

  it('★ 발기인 수 · 이사 구성(의사록 명단과 같은 기준, 0명인 쪽은 뺀다)', () => {
    expect(v.founderCount).toBe('2');
    expect(v.officerComposition).toBe('사내이사 1명, 감사 1명');
    expect(officerCompositionText([{ isDirector: true, isAuditor: false }, { isDirector: true, isAuditor: true }])).toBe('사내이사 2명');
    expect(officerCompositionText([{ isDirector: false, isAuditor: true }])).toBe('감사 1명');
    expect(officerCompositionText([{ isDirector: false, isAuditor: false }])).toBe('');
  });

  it('★ 개회 · 폐회시간 — 정각은 「10시」, 폐회는 개회 + 30분 · 비우면 둘 다 빈칸', () => {
    expect(koreanTime('10:00')).toBe('10시');
    expect(koreanTime('09:05')).toBe('9시 5분');
    expect(koreanTime('')).toBe('');
    expect(koreanTime('25:00')).toBe('');
    const timed = (meetingTime: string | null, paymentBank: string | null = null) => {
      const s = src();
      return buildIncorpCasePrintValues({ ...s, snapshot: { ...s.snapshot, info: { ...s.snapshot.info, meetingTime, paymentBank } } });
    };
    expect([timed('10:00').meetingTime, timed('10:00').closingTime]).toEqual(['10시', '10시 30분']);
    expect([timed('10:30').meetingTime, timed('10:30').closingTime]).toEqual(['10시 30분', '11시']);
    expect(timed('23:45').closingTime).toBe('0시 15분');
    expect([timed(null).meetingTime, timed(null).closingTime]).toEqual(['', '']);
    expect([v.meetingTime, v.closingTime, v.paymentBank]).toEqual(['', '', '']);
    expect(timed(null, '국민은행 삼성동지점').paymentBank).toBe('국민은행 삼성동지점');
  });

  it('★ 등기 설정 — 목적만 비면 코드 이름, 사유 · 세금은 빈칸, 첨부서면은 설정 값', () => {
    expect(v.regPurpose).toBe('주식회사 발기설립');
    expect([v.regReason, v.regLicenseTax, v.taxTotal, v.regFee]).toEqual(['', '', '', '']);
    expect(v.attachments).toBe('1. 정관  1통\n1. 주식인수증  1통');
    expect(v.formNo).toBe('[양식 제65-1호]');
    expect(buildIncorpCasePrintValues(src(persons, null)).formNo).toBe('');
  });

  it('★ 첨부서면 2단 — 앞 절반 · 뒤 절반, 홀수면 앞쪽이 하나 더', () => {
    expect([v.attachments1, v.attachments2]).toEqual(['1. 정관  1통', '1. 주식인수증  1통']);
    const three = { ...setting, attachments: [...setting.attachments, { name: '조사보고서', copies: 1 }] };
    const w = buildIncorpCasePrintValues(src(persons, three));
    expect([w.attachments1, w.attachments2]).toEqual(['1. 정관  1통\n1. 주식인수증  1통', '1. 조사보고서  1통']);
    expect(w.attachments).toBe(`${w.attachments1}\n${w.attachments2}`);
    const none = buildIncorpCasePrintValues(src(persons, null));
    expect([none.attachments1, none.attachments2]).toEqual(['', '']);
  });

  it('대표이사 전화 — 설립 정보 값, 비우면 빈칸', () => {
    expect(v.ceoPhone).toBe('');
    const s = src();
    const w = buildIncorpCasePrintValues({ ...s, snapshot: { ...s.snapshot, info: { ...s.snapshot.info, ceoPhone: '010-1234-5678' } } });
    expect(w.ceoPhone).toBe('010-1234-5678');
  });

  it('모든 자리표시에 값이 있다 — 사람 칸은 빈칸', () => {
    for (const f of INCORP_PRINT_FIELDS) expect(typeof v[f.name]).toBe('string');
    expect(v.personName).toBe('');
  });
});

describe('buildIncorpPersonPrintValues', () => {
  it('취임승낙서 — 직위 · 선임일 = 취임일', () => {
    const v = buildIncorpPersonPrintValues(src(), persons[0]!);
    expect([v.personName, v.personRole, v.personRrn, v.appointedDate]).toEqual(['홍길동', '대표이사·이사', '900101-1234567', '2026년 11월 1일']);
  });
  it('★ 선임일 — 취임일이 비면 작성일', () => {
    expect(buildIncorpPersonPrintValues(src(), persons[2]!).appointedDate).toBe('2026년 11월 2일');
  });
  it('주식인수증 — 인수 수 · 총액 = 1주의 금액 × 인수 수', () => {
    const v = buildIncorpPersonPrintValues(src(), persons[1]!);
    expect([v.personUnits, v.personAmount]).toEqual(['4,000', '40,000,000']);
  });
});

describe('buildIncorpPrintDocuments', () => {
  const form = (id: string, name: string, unit: 'case' | 'officer' | 'founder', tokens: string[] = []) => ({
    id,
    name,
    mark: { domain: 'incorporation' as const, unit },
    definition: null,
    tokens,
  });
  const forms = [
    form('f1', '주식인수증', 'founder'),
    form('f2', '취임승낙서', 'officer'),
    form('f3', '조사보고서', 'case', ['reporterList']),
    form('f4', '정관', 'case'),
    { id: 'cc', name: '법인변경등록1', mark: { domain: 'corp-change' as const, changeTypes: ['NAME' as const], companyType: 'ALL' as const, unit: 'case' as const }, definition: null, tokens: [] },
  ];

  it('설립 양식만 · 건마다 → 임원마다 → 발기인마다 · 장 수', () => {
    const docs = buildIncorpPrintDocuments(forms, src());
    expect(docs.map((d) => [d.name, d.sheets.length])).toEqual([
      ['정관', 1],
      ['조사보고서', 1],
      ['취임승낙서', 2],
      ['주식인수증', 2],
    ]);
    expect(docs[2]!.sheets.map((s) => s.personName)).toEqual(['홍길동', '이감사']);
    expect(docs.every((d) => d.notice === null)).toBe(true);
  });

  it('★ 조사보고인이 없으면 — 칸은 비우고 그 양식에만 「해당 사람 없음」', () => {
    const noReporter = persons.slice(0, 2);
    const docs = buildIncorpPrintDocuments(forms, src(noReporter));
    const report = docs.find((d) => d.name === '조사보고서')!;
    expect(report.notice).toBe(NO_REPORTER_NOTICE);
    expect(report.sheets[0]!.values.reporterList).toBe('');
    expect(docs.find((d) => d.name === '정관')!.notice).toBeNull();
  });

  it('★ 검사인 칸(reporterNameList · reporterSignList)만 쓰는 양식에도 안내', () => {
    const minutes = [form('m1', '발기인총회의사록', 'case', ['reporterNameList']), form('m2', '조사보고서', 'case', ['reporterSignList'])];
    const docs = buildIncorpPrintDocuments(minutes, src(persons.slice(0, 2)));
    expect(docs.map((d) => d.notice)).toEqual([NO_REPORTER_NOTICE, NO_REPORTER_NOTICE]);
    expect(docs[0]!.sheets[0]!.values.reporterNameList).toBe('');
  });
});

describe('readIncorporationSnapshot', () => {
  it('★ 스냅샷에는 주민번호가 없다 — 읽어도 사람에 rrn 칸이 없다', () => {
    const snap = readIncorporationSnapshot(JSON.parse(JSON.stringify(snapshotOf(persons))));
    expect(snap?.composedName).toBe('한가람 주식회사');
    expect(snap?.persons.map((p) => p.name)).toEqual(['홍길동', '김철수', '이감사']);
    expect(JSON.stringify(snap)).not.toContain('900101');
  });
  it('개회시간 · 납입은행을 읽는다 — 옛 스냅샷(칸 없음)은 null', () => {
    const raw = JSON.parse(JSON.stringify(snapshotOf(persons)));
    raw.info.meetingTime = '10:00';
    raw.info.paymentBank = '국민은행';
    raw.info.ceoPhone = '02-000-0000';
    expect(readIncorporationSnapshot(raw)?.info).toMatchObject({ meetingTime: '10:00', paymentBank: '국민은행', ceoPhone: '02-000-0000' });
    delete raw.info.meetingTime;
    delete raw.info.paymentBank;
    delete raw.info.ceoPhone;
    expect(readIncorporationSnapshot(raw)?.info).toMatchObject({ meetingTime: null, paymentBank: null, ceoPhone: null });
  });
  it('v1 이 아니면 null', () => {
    expect(readIncorporationSnapshot({ version: 2, info: {} })).toBeNull();
    expect(readIncorporationSnapshot(null)).toBeNull();
  });
});
