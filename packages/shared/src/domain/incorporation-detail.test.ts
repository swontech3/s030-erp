import { describe, expect, it } from 'vitest';
import {
  buildIncorporationSnapshot,
  composeIncorporationName,
  incorporationDisplayName,
  parseIncorpFirstSave,
  parseIncorpInfo,
  parseIncorpPersonBody,
  parseIncorporationListQuery,
  type IncorpPersonView,
} from './incorporation-detail.ts';

const OP = { role: 'operator' as const, s020OrgId: 1 };
const TENANT = { role: 'tenant' as const, s020OrgId: 9003 };

describe('composeIncorporationName — 순수 상호 + 주식회사 + 위치', () => {
  it('앞(F) · 뒤(B) · 기본값은 앞', () => {
    expect(composeIncorporationName('한가람', 'F')).toBe('주식회사 한가람');
    expect(composeIncorporationName(' 한가람 ', 'B')).toBe('한가람 주식회사');
    expect(composeIncorporationName('한가람', null)).toBe('주식회사 한가람');
    expect(composeIncorporationName('한가람', 'X')).toBe('주식회사 한가람');
  });
  it('상호가 비면 빈 글자 — 「주식회사」만 찍히지 않는다', () => {
    expect(composeIncorporationName('', 'F')).toBe('');
    expect(composeIncorporationName(null, 'B')).toBe('');
  });
  it('머리 이름 — 합친 상호 → 단체코드 → 「단체 {ID}」', () => {
    expect(incorporationDisplayName('주식회사 한가람', { orgId: 9003, orgCode: 'Z99' })).toBe('주식회사 한가람');
    expect(incorporationDisplayName('', { orgId: 9003, orgCode: 'Z99' })).toBe('Z99');
    expect(incorporationDisplayName('', { orgId: 9003, orgCode: null })).toBe('단체 9003');
  });
});

describe('parseIncorpInfo — 모양만 본다(임시 저장)', () => {
  it('빈 본문은 모두 null', () => {
    const r = parseIncorpInfo({});
    expect(r.ok && r.value).toMatchObject({ nameKo: null, hq: null, capitalAmount: null, purposes: null, companyTypePosition: null });
  });
  it('글자는 앞뒤 공백만 떼고 사업목적 줄바꿈은 지킨다', () => {
    const r = parseIncorpInfo({ nameKo: ' 한가람 ', purposes: ' 소프트웨어 개발\n경영 컨설팅 ', companyTypePosition: 'B' });
    expect(r.ok && r.value).toMatchObject({ nameKo: '한가람', purposes: '소프트웨어 개발\n경영 컨설팅', companyTypePosition: 'B' });
  });
  it('★ 30억도 숫자로 받는다(bigint) · 음수 · 소수 · 글자는 거절', () => {
    expect(parseIncorpInfo({ capitalAmount: 3_000_000_000 }).ok).toBe(true);
    const r = parseIncorpInfo({ capitalAmount: -1, parValue: 1.5, unitsIssued: '100' });
    expect(r.ok ? [] : r.errors!.map((e) => e.field)).toEqual(['capitalAmount', 'parValue', 'unitsIssued']);
  });
  it('설립예정일은 날짜여야 한다(DB 칸이 timestamp) · 사업연도는 글자로만 본다', () => {
    expect(parseIncorpInfo({ plannedDate: '2026-02-30' }).ok).toBe(false);
    expect(parseIncorpInfo({ fiscalStart: '1-1' }).ok).toBe(true); // 형식은 작성완료 때
  });
  it('정의에 없는 키 · 틀린 주소 모양은 거절', () => {
    const r = parseIncorpInfo({ ceoName: '홍', hq: { zipCode: 1 } });
    expect(r.ok ? [] : r.errors!.map((e) => e.field)).toEqual(['ceoName', 'hq']);
  });
});

describe('parseIncorpInfo — 대도시 중과 체크', () => {
  it('없으면 null(사람이 안 고침) · true/false 는 그대로 · 그 밖은 거절', () => {
    const at = (v: unknown) => parseIncorpInfo({ metroSurcharge: v });
    const r0 = at(undefined);
    expect(r0.ok && r0.value.metroSurcharge).toBeNull();
    const r1 = at(false);
    expect(r1.ok && r1.value.metroSurcharge).toBe(false);
    expect(at('Y').ok).toBe(false);
  });
});

describe('parseIncorpPersonBody', () => {
  it('체크 · 인수수량 · 취임일 · 주민번호', () => {
    const r = parseIncorpPersonBody({ name: '홍길동', isFounder: true, isRepresentative: true, unitsSubscribed: 10_000, appointmentDate: '2026-11-02', rrn: '900101-1234567' });
    expect(r.ok && r.value).toMatchObject({ name: '홍길동', isFounder: true, isDirector: false, unitsSubscribed: 10_000, rrn: '9001011234567' });
  });
  it('틀린 칸을 다 모은다 — 체크가 글자 · 인수수량 음수 · 날짜 아님 · 주민번호 모양', () => {
    const r = parseIncorpPersonBody({ isFounder: 'Y', unitsSubscribed: -3, appointmentDate: '내일', rrn: '123' }, 'persons.0');
    expect(r.ok ? [] : r.errors!.map((e) => e.field)).toEqual([
      'persons.0.isFounder',
      'persons.0.unitsSubscribed',
      'persons.0.appointmentDate',
      'persons.0.rrn',
    ]);
  });
});

describe('parseIncorpFirstSave', () => {
  it('★ 회사 세션이 남의 단체를 적으면 403 — 설립 말로', () => {
    expect(parseIncorpFirstSave({ orgId: 1, info: {} }, TENANT)).toEqual({ ok: false, status: 403, message: '자기 회사의 법인설립만 다룰 수 있습니다' });
  });
  it('회사 세션은 단체를 비우면 자기 단체 · 운영사는 단체 필수', () => {
    const t = parseIncorpFirstSave({ info: {} }, TENANT);
    expect(t.ok && t.value.orgId).toBe(9003);
    expect(parseIncorpFirstSave({ info: {} }, OP)).toMatchObject({ ok: false, status: 400 });
  });
  it('설립 정보 · 사람 오류를 한 번에', () => {
    const r = parseIncorpFirstSave({ orgId: 9003, info: { parValue: 'x' }, persons: [{ rrn: '1' }] }, OP);
    expect(r.ok ? [] : r.errors!.map((e) => e.field)).toEqual(['parValue', 'persons.0.rrn']);
  });
});

describe('parseIncorporationListQuery', () => {
  it('상태 P · E · C · 취소 포함', () => {
    expect(parseIncorporationListQuery({})).toEqual({ ok: true, value: { status: null, includeCancelled: false } });
    expect(parseIncorporationListQuery({ status: 'E', includeCancelled: '1' })).toEqual({ ok: true, value: { status: 'E', includeCancelled: true } });
    expect(parseIncorporationListQuery({ status: 'X' }).ok).toBe(false);
  });
});

describe('buildIncorporationSnapshot', () => {
  it('★ 주민번호 · id · 순서는 담지 않는다 · 위치가 비면 앞', () => {
    const person: IncorpPersonView = {
      id: 'p1', name: '홍길동', isFounder: true, isDirector: true, isAuditor: false, isRepresentative: true,
      unitsSubscribed: 100, appointmentDate: null, zipCode: null, address: null, addressDetail: null, rrnMasked: '900101-1******', sortOrder: 1,
    };
    const info = parseIncorpInfo({ nameKo: '한가람' });
    const snap = buildIncorporationSnapshot(info.ok ? info.value : (null as never), [person]);
    expect(snap.composedName).toBe('주식회사 한가람');
    expect(snap.companyTypePosition).toBe('F');
    expect(JSON.stringify(snap)).not.toContain('900101');
    expect(Object.keys(snap.persons[0]!)).not.toEqual(expect.arrayContaining(['id', 'rrnMasked', 'sortOrder']));
  });
});
