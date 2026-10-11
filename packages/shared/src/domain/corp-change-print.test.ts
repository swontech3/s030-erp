import { describe, expect, it } from 'vitest';
import {
  CORP_CHANGE_PRINT_FIELDS,
  buildPrintDocuments,
  parsePrintInputs,
  parsePrintLogBody,
  buildCasePrintValues,
  buildOfficerPrintValues,
  changeSummary,
  formatAttachments,
  formatKoreanDate,
  formatRrn,
  pickDocFormSetting,
  readSubmitSnapshot,
  type CasePrintSource,
  type DocFormSettingRow,
} from './corp-change-print.ts';
import type { CorpChangeSubmitSnapshot } from './corp-change-transition.ts';

/** 개발 DB 의 등기 설정 줄에서 옮긴 값(2026-10-11 실측) — 두 첨부 모양 · `\n` 글자가 섞여 있다. */
const row = (r: Partial<DocFormSettingRow> & Pick<DocFormSettingRow, 'regTypeKey'>): DocFormSettingRow => ({
  companyType: '',
  isActive: true,
  label: null,
  formNo: null,
  matter: null,
  taxMode: 'fixed',
  taxes: null,
  attachments: null,
  regPurpose: null,
  regReason: null,
  matterBody: null,
  ...r,
});

const ROWS: DocFormSettingRow[] = [
  row({
    regTypeKey: 'CEO_ADDR',
    label: '주식회사 변경 등기(대표이사 주소 변경)',
    formNo: '[양식 제70호]',
    matter: '변경된 주소와\n이전연월일',
    taxes: { regFee: 6000, localEdu: 8040, regLicense: 40200 },
    attachments: [
      { name: '주민등록표등(초)본', copies: 1 },
      { name: '등록면허세영수필확인서', copies: 1 },
      { name: '<기   타>', copies: 0 },
    ],
    regPurpose: '대표이사 주소변경',
    regReason: '',
    matterBody: '',
  }),
  row({
    regTypeKey: 'CEO_ADDR',
    companyType: 'A',
    label: '유한회사 변경 등기(대표이사 주소 변경)',
    formNo: '[양식 제96호]',
    matter: '이전한 주소와 이전 연월일',
    taxes: null,
    attachments: ['주민등록표등본 또는 초본', '등록면허세영수필확인서'],
  }),
  row({
    regTypeKey: 'NAME',
    label: '상호ㆍ목적ㆍ공고방법 변경',
    formNo: '[양식 제71호]',
    matter: '상호, 목적,\\n공고방법  변경과\\n그 연월일',
    taxes: { regFee: 4000, localEdu: 8040, regLicense: 40200 },
    attachments: ['주주총회의사록(공증받은 것)'],
  }),
  row({ regTypeKey: 'NAME', companyType: 'R', label: '주식회사변경등기(상호ㆍ목적ㆍ공고방법 변경)', formNo: '', matter: '', attachments: [] }),
  row({ regTypeKey: 'OFFICER', label: '주식회사 변경 등기(이사ㆍ감사 등 변경)', formNo: '[양식 제72-2호]', taxes: null }),
];

describe('pickDocFormSetting — 설정 고르기', () => {
  it('기본 줄 — 회사유형이 R · A 가 아니면', () => {
    const s = pickDocFormSetting(ROWS, 'CEO_ADDR', 'P')!;
    expect(s.formNo).toBe('[양식 제70호]');
    expect(s.taxes).toEqual({ regLicense: 40200, localEdu: 8040, regFee: 6000 });
    expect(s.regPurpose).toBe('대표이사 주소변경');
    expect(s.regReason).toBeNull();
    expect(s.matterBody).toBeNull();
    expect(pickDocFormSetting(ROWS, 'CEO_ADDR', null)!.formNo).toBe('[양식 제70호]');
  });

  it('회사유형 줄이 칸별로 덮는다 — 빈 칸 · 빈 세금은 기본 줄 값', () => {
    const s = pickDocFormSetting(ROWS, 'CEO_ADDR', 'A')!;
    expect(s.label).toBe('유한회사 변경 등기(대표이사 주소 변경)');
    expect(s.formNo).toBe('[양식 제96호]');
    expect(s.taxes).toEqual({ regLicense: 40200, localEdu: 8040, regFee: 6000 });
    expect(s.attachments).toEqual([
      { name: '주민등록표등본 또는 초본', copies: 1 },
      { name: '등록면허세영수필확인서', copies: 1 },
    ]);
    expect(s.regPurpose).toBe('대표이사 주소변경');
  });

  it('주식회사 상호 줄 — 표시명만 있고 나머지는 빈 칸 → 표시명만 덮고 나머지는 기본 줄', () => {
    const r = pickDocFormSetting(ROWS, 'NAME', 'R')!;
    expect(r.label).toBe('주식회사변경등기(상호ㆍ목적ㆍ공고방법 변경)');
    expect({ ...r, label: null }).toEqual({ ...pickDocFormSetting(ROWS, 'NAME', null)!, label: null });
  });

  it('★ 목적변경은 상호 줄(71호)을 쓴다 — 결정 F', () => {
    expect(pickDocFormSetting(ROWS, 'PURPOSE', 'R')!.formNo).toBe('[양식 제71호]');
  });

  it('★ `\\n` 글자는 줄바꿈으로 — 질문 4', () => {
    expect(pickDocFormSetting(ROWS, 'NAME', null)!.matter).toBe('상호, 목적,\n공고방법  변경과\n그 연월일');
  });

  it('세금이 없으면 셋 다 null · tax_mode 가 fixed 가 아니면 세금을 읽지 않는다', () => {
    expect(pickDocFormSetting(ROWS, 'OFFICER', null)!.taxes).toEqual({ regLicense: null, localEdu: null, regFee: null });
    const computed = [row({ regTypeKey: 'HQ', taxMode: 'computed', taxes: { regLicense: 1 } })];
    expect(pickDocFormSetting(computed, 'HQ', null)!.taxes).toEqual({ regLicense: null, localEdu: null, regFee: null });
  });

  it('줄이 없거나 꺼져 있으면 null', () => {
    expect(pickDocFormSetting(ROWS, 'HQ', null)).toBeNull();
    expect(pickDocFormSetting([row({ regTypeKey: 'HQ', isActive: false, label: 'x' })], 'HQ', null)).toBeNull();
  });

  it('첨부 — 이름 빈 항목은 버리고, 통수가 이상하면 1', () => {
    const rows = [row({ regTypeKey: 'HQ', attachments: ['', '  ', { name: '' }, { name: '정관', copies: -1 }, { name: '위임장', copies: 2 }, 3] })];
    expect(pickDocFormSetting(rows, 'HQ', null)!.attachments).toEqual([
      { name: '정관', copies: 1 },
      { name: '위임장', copies: 2 },
    ]);
  });
});

describe('모양 바꾸기', () => {
  it('첨부서면 — 줄마다 「1. 서류명  N통」, 0통은 이름만', () => {
    expect(formatAttachments([{ name: '정관', copies: 1 }, { name: '위임장', copies: 2 }, { name: '<기   타>', copies: 0 }])).toBe(
      '1. 정관  1통\n1. 위임장  2통\n<기   타>',
    );
    expect(formatAttachments([])).toBe('');
  });

  it('날짜 — 「2026년 10월 1일」, 없는 날짜는 빈칸', () => {
    expect(formatKoreanDate('2026-10-01')).toBe('2026년 10월 1일');
    expect(formatKoreanDate('2026-02-30')).toBe('');
    expect(formatKoreanDate(null)).toBe('');
  });

  it('주민번호 — 13자리면 하이픈, 아니면 받은 그대로', () => {
    expect(formatRrn('9001011234567')).toBe('900101-1234567');
    expect(formatRrn('900101-1234567')).toBe('900101-1234567');
    expect(formatRrn(null)).toBe('');
    expect(formatRrn('12')).toBe('12');
  });
});

const snap = (over: Partial<CorpChangeSubmitSnapshot> = {}): CorpChangeSubmitSnapshot => ({
  version: 2,
  changeType: 'CEO_ADDR',
  company: {
    isTenant: true,
    name: '주식회사 에이',
    corpNumber: '110111-1234567',
    bizNumber: '123-45-67890',
    ceoName: '홍길동',
    tel: '02-123-4567',
    memberType: 'R',
    head: { zipCode: '06000', address: '서울 강남구 본점로 1', addressDetail: '3층' },
    ceoHome: { zipCode: '04000', address: '서울 마포구 자택로 2', addressDetail: null },
  },
  payload: { newCeoAddress: { zipCode: '04500', address: '서울 중구 새집로 3', addressDetail: '101호' }, moveInDate: '2026-10-01' },
  officers: [],
  ...over,
});

describe('changeSummary — 레거시 문장 그대로(결정 I)', () => {
  it('상호', () => {
    expect(changeSummary(snap({ changeType: 'NAME', payload: { newName: '주식회사 비' } }))).toBe('상호를 「주식회사 비」(으)로 변경한다.');
  });
  it('본점 — 우편번호를 괄호로', () => {
    expect(
      changeSummary(snap({ changeType: 'HQ', payload: { newHqAddress: { zipCode: '06100', address: '서울 강남구 새로 9', addressDetail: '' } } })),
    ).toBe('본점을 「(06100) 서울 강남구 새로 9」(으)로 이전한다.');
  });
  it('대표주소 — 이전연월일 줄', () => {
    expect(changeSummary(snap())).toBe(
      '대표이사 홍길동의 주소를 「(04500) 서울 중구 새집로 3 101호」(으)로 변경한다.\n이전연월일 : 2026년 10월 1일',
    );
  });
  it('목적 — 빈 줄을 빼고 번호', () => {
    expect(changeSummary(snap({ changeType: 'PURPOSE', payload: { purposes: '소프트웨어 개발\n\n  부동산 임대업 ' } }))).toBe(
      '1. 소프트웨어 개발\n2. 부동산 임대업',
    );
  });
  it('임원 — 직위 성명 — 구분 (효력일)', () => {
    const officers = [
      { name: '김갑', changeKind: 'APPOINT', position: '사내이사', effectiveDate: '2026-10-01', zipCode: null, address: null, addressDetail: null },
      { name: '이을', changeKind: 'RESIGN', position: '감사', effectiveDate: null, zipCode: null, address: null, addressDetail: null },
    ];
    expect(changeSummary(snap({ changeType: 'OFFICER', payload: {}, officers }))).toBe('사내이사 김갑 — 취임 (2026-10-01)\n감사 이을 — 사임');
  });
});

describe('buildCasePrintValues', () => {
  const src = (over: Partial<CasePrintSource> = {}): CasePrintSource => ({
    snapshot: snap(),
    setting: pickDocFormSetting(ROWS, 'CEO_ADDR', 'R'),
    changeTypeName: '대표이사 주소변경(코드)',
    inputs: { applyDate: '2026-10-11', writeDate: null },
    ...over,
  });

  it('★ 모든 자리표시 이름에 값이 있다 — 빈 것도 빈칸으로', () => {
    const v = buildCasePrintValues(src());
    expect(Object.keys(v).sort()).toEqual(CORP_CHANGE_PRINT_FIELDS.map((f) => f.name).sort());
    expect(Object.values(v).every((x) => typeof x === 'string')).toBe(true);
  });

  it('회사값 · 설정값 · 날짜', () => {
    const v = buildCasePrintValues(src());
    expect(v).toMatchObject({
      companyName: '주식회사 에이',
      corpNumber: '110111-1234567',
      bizNumber: '123-45-67890',
      hqAddress: '서울 강남구 본점로 1 3층',
      ceoName: '홍길동',
      ceoAddress: '서울 마포구 자택로 2',
      ceoPhone: '02-123-4567',
      formLabel: '주식회사 변경 등기(대표이사 주소 변경)',
      formNo: '[양식 제70호]',
      regPurpose: '대표이사 주소변경',
      regReason: '',
      matter: '변경된 주소와\n이전연월일',
      regLicenseTax: '40,200',
      localEduTax: '8,040',
      taxTotal: '48,240',
      regFee: '6,000',
      attachments: '1. 주민등록표등(초)본  1통\n1. 등록면허세영수필확인서  1통\n<기   타>',
      applyDate: '2026년 10월 11일',
      writeDate: '',
      officerName: '',
      officerRrn: '',
    });
  });

  it('결의일 — 변경 내용의 resolutionDate 를 「2026년 10월 1일」로, 없거나 틀리면 빈칸', () => {
    const at = (payload: Record<string, unknown>) =>
      buildCasePrintValues(src({ snapshot: snap({ changeType: 'NAME', payload }) })).resolutionDate;
    expect(at({ newName: '비', resolutionDate: '2026-10-01' })).toBe('2026년 10월 1일');
    expect(at({ newName: '비' })).toBe('');
    expect(at({ resolutionDate: '2026-02-30' })).toBe('');
    // 대표주소 변경에는 결의일 칸이 없다
    expect(buildCasePrintValues(src()).resolutionDate).toBe('');
  });

  it('등기의 목적 — 설정이 비면 변경 구분 코드 이름(질문 2)', () => {
    const setting = { ...pickDocFormSetting(ROWS, 'CEO_ADDR', null)!, regPurpose: null };
    expect(buildCasePrintValues(src({ setting })).regPurpose).toBe('대표이사 주소변경(코드)');
  });

  it('등기할 사항(내용) — 레거시 문장, 설정 글이 있으면 앞에 한 줄(질문 1)', () => {
    expect(buildCasePrintValues(src()).matterBody).toBe(changeSummary(snap()));
    const setting = { ...pickDocFormSetting(ROWS, 'CEO_ADDR', null)!, matterBody: '아래와 같이 변경' };
    expect(buildCasePrintValues(src({ setting })).matterBody).toBe(`아래와 같이 변경\n${changeSummary(snap())}`);
  });

  it('★ 설정이 없으면 설정 칸은 전부 빈칸 — 값을 지어 넣지 않는다(결정 F)', () => {
    const v = buildCasePrintValues(src({ setting: null, changeTypeName: null }));
    for (const k of ['formLabel', 'formNo', 'regPurpose', 'regReason', 'matter', 'regLicenseTax', 'localEduTax', 'taxTotal', 'regFee', 'attachments']) {
      expect(v[k]).toBe('');
    }
  });

  it('세액합계 — 등록면허세 + 지방교육세, 하나만 있어도 합', () => {
    const base = pickDocFormSetting(ROWS, 'CEO_ADDR', null)!;
    const v = buildCasePrintValues(src({ setting: { ...base, taxes: { regLicense: 1000, localEdu: null, regFee: null } } }));
    expect(v.taxTotal).toBe('1,000');
    expect(v.regFee).toBe('');
  });
});

describe('buildOfficerPrintValues', () => {
  it('건 값 위에 그 임원 칸 — 주민번호는 하이픈 모양', () => {
    const v = buildOfficerPrintValues(
      { snapshot: snap({ changeType: 'OFFICER' }), setting: null, changeTypeName: null, inputs: { writeDate: '2026-10-11' } },
      {
        name: '김갑',
        changeKind: 'REELECT',
        position: '사내이사',
        effectiveDate: '2026-10-01',
        zipCode: '04500',
        address: '서울 중구 임원로 1',
        addressDetail: '2층',
        rrn: '9001011234567',
      },
    );
    expect(v).toMatchObject({
      companyName: '주식회사 에이',
      writeDate: '2026년 10월 11일',
      officerName: '김갑',
      officerPosition: '사내이사',
      officerKind: '중임',
      officerRrn: '900101-1234567',
      officerAddress: '서울 중구 임원로 1 2층',
      officerEffectiveDate: '2026년 10월 1일',
    });
  });
});

describe('readSubmitSnapshot — 결정 H', () => {
  it('★ 옛 v1 — 없는 칸(전화 · 사업자번호 · 회사유형)은 null', () => {
    const v1 = {
      version: 1,
      changeType: 'HQ',
      company: {
        isTenant: false,
        name: '에이',
        corpNumber: null,
        ceoName: '홍',
        head: { zipCode: '1', address: '서울', addressDetail: null },
        ceoHome: { zipCode: null, address: null, addressDetail: null },
      },
      payload: { relocationDate: '2026-10-01' },
      officers: [],
    };
    const s = readSubmitSnapshot(v1)!;
    expect(s.version).toBe(2);
    expect(s.company).toMatchObject({ name: '에이', tel: null, bizNumber: null, memberType: null });
    expect(s.payload).toEqual({ relocationDate: '2026-10-01' });
  });

  it('v2 는 그대로', () => {
    expect(readSubmitSnapshot(snap())).toEqual(snap());
  });

  it('스냅샷이 아니면 null', () => {
    expect(readSubmitSnapshot(null)).toBeNull();
    expect(readSubmitSnapshot({ version: 3, changeType: 'HQ', company: {} })).toBeNull();
    expect(readSubmitSnapshot({ version: 2, company: {} })).toBeNull();
  });
});

describe('buildPrintDocuments — 양식 고르기 · 장', () => {
  const caseMark = (over = {}) => ({ domain: 'corp-change' as const, changeTypes: ['OFFICER' as const], companyType: 'ALL' as const, unit: 'case' as const, ...over });
  const forms = [
    { id: 'f-reelect', name: '중임승낙서', definition: 'D3', mark: { ...caseMark(), unit: 'officer' as const, officerKinds: ['REELECT' as const] } },
    { id: 'f-app', name: '법인변경등록1', definition: 'D1', mark: caseMark({ changeTypes: ['NAME', 'OFFICER'] }) },
    { id: 'f-hq', name: '본점만', definition: 'D2', mark: caseMark({ changeTypes: ['HQ'] }) },
    { id: 'f-a', name: '가유한회사만', definition: 'D4', mark: caseMark({ companyType: 'A' }) },
    { id: 'f-none', name: '사임서', definition: 'D5', mark: { ...caseMark(), unit: 'officer' as const, officerKinds: ['RESIGN' as const] } },
  ];
  const officer = (name: string, changeKind: string) => ({
    name, changeKind, position: '사내이사', effectiveDate: '2026-10-01', zipCode: null, address: null, addressDetail: null, rrn: '9001011234567',
  });
  const officers = [officer('김갑', 'REELECT'), officer('이을', 'APPOINT'), officer('박병', 'REELECT')];
  const src: CasePrintSource = { snapshot: snap({ changeType: 'OFFICER', payload: {}, officers }), setting: null, changeTypeName: null, inputs: {} };

  it('구분 · 회사유형이 맞는 양식만, 건마다 먼저 · 이름 순', () => {
    const docs = buildPrintDocuments(forms, src, officers);
    expect(docs.map((d) => d.formId)).toEqual(['f-app', 'f-none', 'f-reelect']);
  });

  it('건마다 = 1장 · 임원마다 = 그 구분의 임원마다 한 장(0장도 그대로)', () => {
    const docs = buildPrintDocuments(forms, src, officers);
    expect(docs[0]!.sheets).toHaveLength(1);
    expect(docs[0]!.sheets[0]!.officerName).toBeNull();
    expect(docs[1]!.sheets).toEqual([]);
    expect(docs[2]!.sheets.map((s) => [s.officerName, s.values.officerName, s.values.officerRrn])).toEqual([
      ['김갑', '김갑', '900101-1234567'],
      ['박병', '박병', '900101-1234567'],
    ]);
  });

  it('유한회사 건이면 유한회사 양식도 뜬다', () => {
    const a = { ...src, snapshot: snap({ changeType: 'OFFICER', payload: {}, officers, company: { ...snap().company, memberType: 'A' } }) };
    expect(buildPrintDocuments(forms, a, officers).map((d) => d.formId)).toContain('f-a');
  });
});

describe('parsePrintInputs', () => {
  it('비우면 null · 있는 날짜만', () => {
    expect(parsePrintInputs({})).toEqual({ ok: true, value: { applyDate: null, writeDate: null } });
    expect(parsePrintInputs({ applyDate: '2026-10-11', writeDate: '' })).toEqual({ ok: true, value: { applyDate: '2026-10-11', writeDate: null } });
    expect(parsePrintInputs({ writeDate: '2026-13-01' })).toMatchObject({ ok: false, field: 'writeDate' });
    expect(parsePrintInputs({ applyDate: ['2026-10-11'] })).toMatchObject({ ok: false, field: 'applyDate' });
  });
});

describe('parsePrintLogBody — 출력 이력 기록 본문', () => {
  it('formId · sheet(기본 0) · 날짜', () => {
    expect(parsePrintLogBody({ formId: 'f-1' })).toEqual({ ok: true, value: { formId: 'f-1', sheet: 0, applyDate: null, writeDate: null } });
    expect(parsePrintLogBody({ formId: 'f-1', sheet: 2, applyDate: '2026-10-11' })).toEqual({
      ok: true,
      value: { formId: 'f-1', sheet: 2, applyDate: '2026-10-11', writeDate: null },
    });
  });
  it.each([
    [null, 'body'],
    [{}, 'formId'],
    [{ formId: '' }, 'formId'],
    [{ formId: 'f', sheet: -1 }, 'sheet'],
    [{ formId: 'f', sheet: 1.5 }, 'sheet'],
    [{ formId: 'f', writeDate: '2026-02-30' }, 'writeDate'],
  ])('거절 %j', (raw, field) => {
    expect(parsePrintLogBody(raw)).toMatchObject({ ok: false, field });
  });
  it('★ 임원 이름 · 주민번호를 실어 와도 버린다(아는 칸만)', () => {
    const r = parsePrintLogBody({ formId: 'f', officerName: '가짜', officerRrn: '9001011234567' });
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['applyDate', 'formId', 'sheet', 'writeDate']);
  });
});
