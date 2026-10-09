import { describe, expect, it } from 'vitest';
import {
  corpChangeCompanyName,
  maskRrn,
  normalizeRrn,
  parseCreateBody,
  parseFirstSave,
  parseOrgTarget,
  parseLegalOrgBody,
  parseOfficerBody,
  parsePayload,
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
      value: { newHqAddress: { zipCode: '04524', address: '서울 중구', addressDetail: null }, resolutionDate: null },
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
