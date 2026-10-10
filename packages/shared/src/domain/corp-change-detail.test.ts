import { describe, expect, it } from 'vitest';
import {
  applyCompanyDefaults,
  guessMemberType,
  corpChangeCompanyName,
  corpChangeDateLine,
  maskRrn,
  normalizeRrn,
  parseCompanyPart,
  parseCreateBody,
  parseFirstSave,
  parseOrgTarget,
  parseLegalOrgBody,
  parseOfficerBody,
  parsePayload,
  type CorpChangeCompanyInfo,
} from './corp-change-detail.ts';

const operator = { role: 'operator' as const, s020OrgId: 1 };
const tenant = { role: 'tenant' as const, s020OrgId: 9003 };

describe('parseCreateBody — 새 건', () => {
  it('★★ 회사는 자기 단체로만 — 남의 단체는 403', () => {
    expect(parseCreateBody({ changeType: 'NAME', orgId: 9001 }, tenant)).toMatchObject({ ok: false, status: 403 });
    expect(parseCreateBody({ changeType: 'NAME', orgId: 9003 }, tenant)).toEqual({
      ok: true,
      value: { changeType: 'NAME', orgId: 9003, orgCode: null },
    });
    // 생략하면 세션 단체 · 본문의 단체코드는 쓰지 않는다
    expect(parseCreateBody({ changeType: 'HQ', orgCode: 'Z01' }, tenant)).toEqual({
      ok: true,
      value: { changeType: 'HQ', orgId: 9003, orgCode: null },
    });
  });

  it('운영사 — 단체 필수 · 단체코드는 3자 이내', () => {
    expect(parseCreateBody({ changeType: 'NAME' }, operator)).toMatchObject({ ok: false, status: 400 });
    expect(parseCreateBody({ changeType: 'NAME', orgId: 9003, orgCode: ' Z99 ' }, operator)).toEqual({
      ok: true,
      value: { changeType: 'NAME', orgId: 9003, orgCode: 'Z99' },
    });
    expect(parseCreateBody({ changeType: 'NAME', orgId: 9003, orgCode: 'Z999' }, operator).ok).toBe(false);
  });

  it.each([
    [{ changeType: 'CEO_CHG', orgId: 1 }],
    [{ changeType: 'NAME', orgId: '9003a' }],
    [{ changeType: 'NAME', orgId: 9003, orgCode: 'Z-9' }],
    [{ changeType: 'NAME', orgId: 0 }],
    [{ changeType: 'NAME', orgId: 1.5 }],
    [null],
  ])('틀린 본문 %o 은 400', (body) => {
    expect(parseCreateBody(body, operator)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('parseOrgTarget — 단체', () => {
  it('주소의 숫자 글자도 받는다 · 회사는 남의 단체 403 · 회사가 보낸 단체코드는 버린다', () => {
    expect(parseOrgTarget('9003', 'Z99', operator)).toEqual({ ok: true, value: { orgId: 9003, orgCode: 'Z99' } });
    expect(parseOrgTarget('9001', null, tenant)).toMatchObject({ ok: false, status: 403 });
    expect(parseOrgTarget(undefined, 'Z01', tenant)).toEqual({ ok: true, value: { orgId: 9003, orgCode: null } });
  });
});

describe('parseFirstSave — 첫 저장', () => {
  it('★★ 틀린 칸을 다 모은다 — 변경 내용 · 임원 여럿', () => {
    const r = parseFirstSave(
      {
        changeType: 'OFFICER',
        orgId: 9003,
        payload: { resolutionDate: 1, extra: 'x' },
        officers: [{ name: '김' }, { changeKind: 'FIRE', rrn: '12' }],
      },
      operator,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors?.map((e) => e.field)).toEqual(['extra', 'resolutionDate', 'officers.1.changeKind', 'officers.1.rrn']);
  });

  it('★ 남의 단체(403)가 모양 오류보다 먼저', () => {
    expect(parseFirstSave({ changeType: 'CEO_CHG', orgId: 9001, payload: 3 }, tenant)).toMatchObject({ ok: false, status: 403 });
  });

  it('임원 · 변경 내용이 없으면 빈 것으로 — 주민번호를 비우면 없음', () => {
    const r = parseFirstSave({ changeType: 'OFFICER', officers: [{ name: '김', rrn: '' }] }, tenant);
    expect(r.ok && r.value.officers[0]?.rrn).toBeUndefined();
    expect(r.ok && r.value.payload).toEqual({ resolutionDate: null });
    expect(r.ok && r.value.orgId).toBe(9003);
  });

  it('임원변경이 아닌 구분에 임원 · 목록이 배열이 아니면 거절', () => {
    expect(parseFirstSave({ changeType: 'NAME', orgId: 1, officers: [{}] }, operator).ok).toBe(false);
    expect(parseFirstSave({ changeType: 'OFFICER', orgId: 1, officers: {} }, operator).ok).toBe(false);
  });
});

describe('parsePayload — 변경 내용(임시 저장)', () => {
  it('칸 정의대로 · 빈 칸은 null · 필수가 비어도 통과(검증은 P→E 때)', () => {
    expect(parsePayload('NAME', { newName: '  ', resolutionDate: '2026-10-01' })).toEqual({
      ok: true,
      value: { newName: null, newNameEn: null, resolutionDate: '2026-10-01' },
    });
  });

  it('주소 — 세 칸, 모두 비면 null', () => {
    const r = parsePayload('HQ', { newHqAddress: { zipCode: '04524', address: '서울 중구', addressDetail: '' } });
    expect(r).toEqual({
      ok: true,
      value: { newHqAddress: { zipCode: '04524', address: '서울 중구', addressDetail: null }, resolutionDate: null, relocationDate: null },
    });
    expect(parsePayload('HQ', { newHqAddress: { zipCode: '', address: '' } })).toMatchObject({
      ok: true,
      value: { newHqAddress: null },
    });
  });

  it('사업목적 줄바꿈은 지킨다', () => {
    const r = parsePayload('PURPOSE', { purposes: '1. 소프트웨어 개발\n2. 컨설팅\n' });
    expect(r.ok && r.value.purposes).toBe('1. 소프트웨어 개발\n2. 컨설팅');
  });

  it('★ 날짜 형식은 거절하지 않는다(화면이 안내한다)', () => {
    expect(parsePayload('CEO_ADDR', { moveInDate: '2026-13-01' }).ok).toBe(true);
  });

  it.each([
    ['NAME', { other: 'x' }],
    ['NAME', { newName: 3 }],
    ['HQ', { newHqAddress: '서울' }],
    ['HQ', { newHqAddress: { zipCode: 1 } }],
    ['HQ', { newHqAddress: { city: '서울' } }],
    ['NAME', []],
  ] as const)('%s %o 은 모양이 틀려 거절', (type, raw) => {
    expect(parsePayload(type, raw).ok).toBe(false);
  });
});

describe('parseOfficerBody — 임원', () => {
  it('★ 주민번호 — 13자리(하이픈 허용)면 숫자만 · 비우면 「안 바꿈」(undefined)', () => {
    const r = parseOfficerBody({ name: '김임원', rrn: '900101-1234567' });
    expect(r.ok && r.value.rrn).toBe('9001011234567');
    const keep = parseOfficerBody({ name: '김임원', rrn: '' });
    expect(keep.ok && keep.value.rrn).toBeUndefined();
  });

  it.each([['12345'], ['900101-123456X'], ['9001011234567890'], [9001011234567]])('★ 주민번호 %s 는 거절', (rrn) => {
    expect(parseOfficerBody({ name: '김', rrn })).toMatchObject({ ok: false, status: 400 });
  });

  it('임시 저장 — 성명 · 직위가 비어도 받는다 · 구분 기본은 취임', () => {
    expect(parseOfficerBody({})).toEqual({
      ok: true,
      value: {
        name: '',
        changeKind: 'APPOINT',
        position: null,
        effectiveDate: null,
        zipCode: null,
        address: null,
        addressDetail: null,
        rrn: undefined,
      },
    });
  });

  it('구분 · 효력일 모양이 틀리면 거절(효력일은 DB 날짜 칸)', () => {
    expect(parseOfficerBody({ changeKind: 'FIRE' }).ok).toBe(false);
    expect(parseOfficerBody({ effectiveDate: '2026-02-30' }).ok).toBe(false);
    expect(parseOfficerBody({ effectiveDate: '2026-02-28' }).ok).toBe(true);
  });
});

describe('주민번호 마스킹', () => {
  it('앞 7자리 + ******', () => {
    expect(maskRrn('9001011234567')).toBe('900101-1******');
    expect(normalizeRrn(' 900101-1234567 ')).toBe('9001011234567');
    expect(normalizeRrn('12')).toBeNull();
  });
});

describe('parseLegalOrgBody — 비입주사 법무 회사 정보', () => {
  it('빈 칸은 null · 길이는 DB 그대로', () => {
    const r = parseLegalOrgBody({ legalName: ' 주식회사 한빛 ', tel: '' });
    expect(r.ok && r.value.legalName).toBe('주식회사 한빛');
    expect(r.ok && r.value.tel).toBeNull();
    expect(parseLegalOrgBody({ corpNumber: '1'.repeat(21) }).ok).toBe(false);
    expect(parseLegalOrgBody({ headAddress: '가'.repeat(500) }).ok).toBe(true); // text
    expect(parseLegalOrgBody({ ceoName: 5 }).ok).toBe(false);
  });
});

describe('corpChangeCompanyName — 상호 → 단체코드 → 「단체 {ID}」', () => {
  it.each([
    ['주식회사 한빛', 'Z99', '주식회사 한빛'],
    [null, 'Z99', 'Z99'],
    [' ', null, '단체 9003'],
  ])('%s / %s → %s', (name, orgCode, label) => {
    expect(corpChangeCompanyName(name, { orgCode, orgId: 9003 })).toBe(label);
  });
});

describe('parseCompanyPart — 저장 본문의 company', () => {
  it('없거나 null 이면 「안 건드림」(null)', () => {
    expect(parseCompanyPart(undefined)).toEqual({ ok: true, value: null });
    expect(parseCompanyPart(null)).toEqual({ ok: true, value: null });
  });

  it('★ 오류 자리는 company.{칸} — 화면이 기본정보 칸 옆에 붙인다', () => {
    const r = parseCompanyPart({ ceoName: 'x'.repeat(51), tel: 5 });
    expect(!r.ok && r.errors?.map((e) => e.field)).toEqual(['company.ceoName', 'company.tel']);
    expect(parseCompanyPart('글자').ok).toBe(false);
  });

  it('첫 저장 본문에 실린다 — 안 실으면 null', () => {
    const op = { role: 'operator' as const, s020OrgId: 1 };
    const base = { changeType: 'NAME', orgId: 9003, payload: {} };
    expect(parseFirstSave(base, op).ok && (parseFirstSave(base, op) as { value: { company: unknown } }).value.company).toBeNull();
    const r = parseFirstSave({ ...base, company: { legalName: ' 한빛 ' } }, op);
    expect(r.ok && r.value.company?.legalName).toBe('한빛');
  });
});

describe('applyCompanyDefaults — 삐용 값으로 빈 칸만', () => {
  const blank: CorpChangeCompanyInfo = {
    isTenant: false,
    tenantCompanyId: null,
    displayName: 'Z99',
    legalName: null,
    corpNumber: null,
    bizNumber: null,
    ceoName: null,
    tel: null,
    head: { zipCode: null, address: null, addressDetail: null },
    ceo: { zipCode: null, address: null, addressDetail: null },
    memberType: null,
    memberTypeName: null,
    hasLegalOrg: false,
    defaultedFields: [],
  };
  const org = { orgId: 9003, orgCode: 'Z99' };

  it('회사명 → 등기상 상호 · 대표자명 → 대표자, 채운 칸을 알린다 · 회사명 표시도 바뀐다', () => {
    const r = applyCompanyDefaults(blank, { orgName: ' 주식회사 삐용 ', repName: '김대표' }, org, []);
    expect(r).toMatchObject({ legalName: '주식회사 삐용', ceoName: '김대표', displayName: '주식회사 삐용' });
    expect(r.defaultedFields).toEqual(['legalName', 'ceoName']);
    expect(blank.defaultedFields).toEqual([]); // 받은 것을 고치지 않는다
  });

  it('★ 저장된 값이 우선 — 빈 칸만', () => {
    const r = applyCompanyDefaults({ ...blank, legalName: '등기 상호' }, { orgName: '삐용', repName: '김대표' }, org, []);
    expect(r).toMatchObject({ legalName: '등기 상호', ceoName: '김대표', defaultedFields: ['ceoName'] });
  });

  it('★ 입주사 · 값 없음 · 빈 글자는 그대로', () => {
    const tenant = { ...blank, isTenant: true };
    expect(applyCompanyDefaults(tenant, { orgName: '삐용' }, org, [])).toBe(tenant);
    expect(applyCompanyDefaults(blank, null, org, [])).toEqual(blank);
    expect(applyCompanyDefaults(blank, { orgName: '  ', repName: null }, org, [])).toMatchObject({ displayName: 'Z99', defaultedFields: [] });
  });
});

describe('guessMemberType — 등기상 상호 → 회사유형(코드표 이름으로 찾는다)', () => {
  // ★ 코드값은 코드표의 것 — 시험에서 일부러 다른 값을 줘서 「박지 않음」을 본다.
  const types = [
    { code: 'X1', name: '주식회사' },
    { code: 'X2', name: '유한회사' },
  ];
  it.each([
    ['주식회사 한빛', 'X1'],
    ['한빛 주식회사', 'X1'],
    ['(주)한빛', 'X1'],
    ['유한회사 한빛', 'X2'],
    ['(유)한빛', 'X2'],
    ['한빛상사', null],
    ['', null],
    [null, null],
  ])('%s → %s', (name, code) => {
    expect(guessMemberType(name, types)?.code ?? null).toBe(code);
  });

  it('코드표에 그 이름이 없으면 추정하지 않는다', () => {
    expect(guessMemberType('주식회사 한빛', [{ code: 'A', name: '유한회사' }])).toBeNull();
  });
});

describe('applyCompanyDefaults — 회사유형 추정', () => {
  const blank: CorpChangeCompanyInfo = {
    isTenant: false,
    tenantCompanyId: null,
    displayName: 'Z99',
    legalName: null,
    corpNumber: null,
    bizNumber: null,
    ceoName: null,
    tel: null,
    head: { zipCode: null, address: null, addressDetail: null },
    ceo: { zipCode: null, address: null, addressDetail: null },
    memberType: null,
    memberTypeName: null,
    hasLegalOrg: false,
    defaultedFields: [],
  };
  const org = { orgId: 9003, orgCode: 'Z99' };
  const types = [
    { code: 'R', name: '주식회사' },
    { code: 'A', name: '유한회사' },
  ];

  it('삐용 회사명으로 채운 상호에서도 추정한다 — 「저장 전」 칸에 들어간다', () => {
    const r = applyCompanyDefaults(blank, { orgName: '(주)삐용' }, org, types);
    expect(r).toMatchObject({ memberType: 'R', memberTypeName: '주식회사', defaultedFields: ['legalName', 'memberType'] });
  });

  it('삐용 조회가 실패해도 저장된 상호로 추정한다', () => {
    const r = applyCompanyDefaults({ ...blank, legalName: '유한회사 한빛', hasLegalOrg: true }, null, org, types);
    expect(r).toMatchObject({ memberType: 'A', defaultedFields: ['memberType'] });
  });

  it('★ 저장된 회사유형이 우선 · 입주사는 그대로', () => {
    const saved = applyCompanyDefaults({ ...blank, legalName: '주식회사 한빛', memberType: 'A', memberTypeName: '유한회사' }, null, org, types);
    expect(saved).toMatchObject({ memberType: 'A', defaultedFields: [] });
    const tenant = { ...blank, isTenant: true, legalName: '주식회사 입주' };
    expect(applyCompanyDefaults(tenant, null, org, types)).toBe(tenant);
  });
});

describe('parseLegalOrgBody — 숫자 칸 형식(서버 검사)', () => {
  it('★ 자릿수가 맞으면 하이픈을 넣어 저장한다(ERP 입주사 칸과 같은 모양)', () => {
    const r = parseLegalOrgBody({ corpNumber: '1101111234567', bizNumber: '111 22 85905', tel: '0212345678' });
    expect(r.ok && [r.value.corpNumber, r.value.bizNumber, r.value.tel]).toEqual(['110111-1234567', '111-22-85905', '02-1234-5678']);
  });

  it('★ 자릿수가 틀리면 400 · 칸별 오류(저장 본문이면 company.{칸})', () => {
    const r = parseCompanyPart({ corpNumber: '110111-123456', bizNumber: '111-22-8590', tel: '010-123-4567' });
    expect(!r.ok && r.errors?.map((e) => e.field)).toEqual(['company.corpNumber', 'company.bizNumber', 'company.tel']);
    expect(!r.ok && r.errors?.[0]?.message).toContain('숫자 13자리');
    expect(parseLegalOrgBody({ tel: '010-1234-abcd' }).ok).toBe(false);
  });

  it('빈 칸 · 대표번호(1588)는 막지 않는다', () => {
    const r = parseLegalOrgBody({ corpNumber: '', tel: '1588-1234' });
    expect(r.ok && [r.value.corpNumber, r.value.tel]).toEqual([null, '158-812-34']);
  });
});

describe('corpChangeDateLine — 상태에 맞는 날짜만', () => {
  const all: { createdOn: string; writtenOn: string | null; completedOn: string | null } = { createdOn: '2026-10-01', writtenOn: '2026-10-02', completedOn: '2026-10-03' };
  const line = (status: string, statusBeforeCancel: 'P' | 'E' | 'C' | 'X' | null = null, d = all) =>
    corpChangeDateLine({ status, statusBeforeCancel, ...d }).map((x) => `${x.label} ${x.day}`).join(' · ');

  it('P 는 등록만 — 서류수정 뒤 남은 작성완료일은 안 보인다', () => {
    expect(line('P')).toBe('등록 2026-10-01');
  });
  it('E 는 등록 · 작성완료 — 완료 취소 뒤의 완료일도 안 보인다', () => {
    expect(line('E')).toBe('등록 2026-10-01 · 작성완료 2026-10-02');
  });
  it('C 는 셋 다', () => {
    expect(line('C')).toBe('등록 2026-10-01 · 작성완료 2026-10-02 · 완료 2026-10-03');
  });
  it('취소는 취소 직전 상태 기준', () => {
    expect(line('X', 'P')).toBe('등록 2026-10-01');
    expect(line('X', 'E')).toBe('등록 2026-10-01 · 작성완료 2026-10-02');
    expect(line('X', 'C')).toBe('등록 2026-10-01 · 작성완료 2026-10-02 · 완료 2026-10-03');
    expect(line('X', null)).toBe('등록 2026-10-01');
  });
  it('값이 없는 날짜는 뺀다', () => {
    expect(line('C', null, { ...all, writtenOn: null })).toBe('등록 2026-10-01 · 완료 2026-10-03');
  });
});
