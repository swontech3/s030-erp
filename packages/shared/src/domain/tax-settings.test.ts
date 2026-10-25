import { describe, expect, it } from 'vitest';
import { TAX_EMAILS_MAX, parseTaxSettingsSave, type TaxCodeSets } from './tax-settings.ts';

/** 코드 표에서 읽었다고 치는 값 — 202 와 같은 코드값. */
const CODES: TaxCodeSets = {
  bizTypes: ['I', 'C'],
  withholdingCycles: ['M', 'H'],
  kinds: ['INVOICE', 'CARD', 'CASH', 'BANK', 'NTAX', 'LTAX', 'SOCIAL', 'LOAN'],
  banks: ['004', '020', '081'],
  cardCompanies: ['KB', 'WOORI'],
};

const base = () => ({
  bizType: 'C',
  withholdingCycle: 'M',
  taxEmails: [{ name: ' 한빛세무회계 김세무 실장 ', email: ' tax@example.com ' }],
  unusedKinds: ['SOCIAL'],
  finAccounts: [
    { id: 'acc-1', kind: 'B', bankCode: '004', number: '123-456-7890', alias: ' 주거래 ', isActive: true },
    { kind: 'C', cardCoCode: 'KB', number: '1234', alias: '', isActive: false },
  ],
});

const fieldsOf = (r: ReturnType<typeof parseTaxSettingsSave>) => (r.ok ? [] : r.errors.map((e) => e.field));

describe('parseTaxSettingsSave — 바른 본문', () => {
  it('다듬어서 돌려준다 — 계좌번호는 숫자만, 빈 별칭은 null, 새 줄 id 는 null', () => {
    const r = parseTaxSettingsSave(base(), CODES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bizType).toBe('C');
    expect(r.value.withholdingCycle).toBe('M');
    expect(r.value.taxEmails).toEqual([{ name: '한빛세무회계 김세무 실장', email: 'tax@example.com' }]);
    expect(r.value.unusedKinds).toEqual(['SOCIAL']);
    expect(r.value.finAccounts).toEqual([
      { id: 'acc-1', kind: 'B', bankCode: '004', cardCoCode: null, number: '1234567890', alias: '주거래', isActive: true },
      { id: null, kind: 'C', bankCode: null, cardCoCode: 'KB', number: '1234', alias: null, isActive: false },
    ]);
  });

  it('이름 · 역할은 선택 — 메일만 있어도 된다', () => {
    const r = parseTaxSettingsSave({ ...base(), taxEmails: [{ email: 'a@b.co' }] }, CODES);
    expect(r.ok && r.value.taxEmails).toEqual([{ name: null, email: 'a@b.co' }]);
  });
});

describe('사업자 유형 · 원천세 신고 주기', () => {
  it('사업자 유형은 필수', () => {
    const { bizType: _b, ...rest } = base();
    expect(fieldsOf(parseTaxSettingsSave(rest, CODES))).toEqual(['bizType']);
  });
  it('코드 표에 없는 사업자 유형 · 주기는 거절', () => {
    expect(fieldsOf(parseTaxSettingsSave({ ...base(), bizType: 'X' }, CODES))).toEqual(['bizType']);
    expect(fieldsOf(parseTaxSettingsSave({ ...base(), withholdingCycle: 'Q' }, CODES))).toEqual(['withholdingCycle']);
  });
});

describe('세무사 메일', () => {
  const mail = (i: number) => ({ name: `담당 ${i}`, email: `m${i}@example.com` });

  it(`★ ${TAX_EMAILS_MAX + 1}개는 거절`, () => {
    const r = parseTaxSettingsSave({ ...base(), taxEmails: [mail(1), mail(2), mail(3), mail(4)] }, CODES);
    expect(fieldsOf(r)).toEqual(['taxEmails']);
  });

  it('★ 이름과 메일이 둘 다 빈 줄은 버린다 — 버린 뒤 3개면 통과', () => {
    const r = parseTaxSettingsSave(
      { ...base(), taxEmails: [mail(1), { name: ' ', email: '' }, mail(2), { name: null, email: null }, mail(3)] },
      CODES,
    );
    expect(r.ok && r.value.taxEmails.map((e) => e.email)).toEqual(['m1@example.com', 'm2@example.com', 'm3@example.com']);
  });

  it('이름만 있고 메일이 비면 거절 — 메일은 필수', () => {
    const r = parseTaxSettingsSave({ ...base(), taxEmails: [{ name: '김세무', email: '' }] }, CODES);
    expect(fieldsOf(r)).toEqual(['taxEmails[0].email']);
  });

  it('메일 모양이 아니면 거절', () => {
    const r = parseTaxSettingsSave({ ...base(), taxEmails: [mail(1), { name: '', email: 'tax@example' }] }, CODES);
    expect(fieldsOf(r)).toEqual(['taxEmails[1].email']);
  });
});

describe('계좌 · 카드', () => {
  const withAccount = (a: Record<string, unknown>) => ({ ...base(), finAccounts: [a] });

  it('★ 구분과 기관 코드 칸이 안 맞으면 거절', () => {
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'B', cardCoCode: 'KB', number: '1234567890' }), CODES)))
      .toEqual(['finAccounts[0].bankCode']);
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'B', bankCode: '004', cardCoCode: 'KB', number: '1234567890' }), CODES)))
      .toEqual(['finAccounts[0].cardCoCode']);
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'C', bankCode: '004', cardCoCode: 'KB', number: '1234' }), CODES)))
      .toEqual(['finAccounts[0].bankCode']);
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'C', number: '1234' }), CODES)))
      .toEqual(['finAccounts[0].cardCoCode']);
  });

  it('코드 표에 없는 은행 · 카드사는 거절', () => {
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'B', bankCode: '999', number: '1234567890' }), CODES)))
      .toEqual(['finAccounts[0].bankCode']);
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'C', cardCoCode: 'SHINHAN', number: '1234' }), CODES)))
      .toEqual(['finAccounts[0].cardCoCode']);
  });

  it('구분은 B · C 뿐', () => {
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'X', bankCode: '004', number: '1234567890' }), CODES)))
      .toEqual(['finAccounts[0].kind']);
  });

  it('번호 모양 — 계좌는 숫자와 - 숫자 10~14자리, 카드는 끝 4자리', () => {
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'B', bankCode: '004', number: '1234' }), CODES)))
      .toEqual(['finAccounts[0].number']);
    expect(fieldsOf(parseTaxSettingsSave(withAccount({ kind: 'C', cardCoCode: 'KB', number: '12345' }), CODES)))
      .toEqual(['finAccounts[0].number']);
  });

  it('같은 id 가 두 번 오면 거절', () => {
    const a = { id: 'acc-1', kind: 'B', bankCode: '004', number: '1234567890' };
    const r = parseTaxSettingsSave({ ...base(), finAccounts: [a, { ...a }] }, CODES);
    expect(fieldsOf(r)).toEqual(['finAccounts[1].id']);
  });
});

describe('쓰지 않는 자료', () => {
  it('★ 코드 표에 없는 자료 종류는 거절', () => {
    expect(fieldsOf(parseTaxSettingsSave({ ...base(), unusedKinds: ['SOCIAL', 'FOO'] }, CODES))).toEqual(['unusedKinds']);
  });
  it('목록이 아니면 거절 · 겹친 값은 하나로', () => {
    expect(fieldsOf(parseTaxSettingsSave({ ...base(), unusedKinds: 'SOCIAL' }, CODES))).toEqual(['unusedKinds']);
    const r = parseTaxSettingsSave({ ...base(), unusedKinds: ['LOAN', 'SOCIAL', 'LOAN'] }, CODES);
    expect(r.ok && r.value.unusedKinds).toEqual(['LOAN', 'SOCIAL']);
  });
});

describe('틀린 칸이 여럿이면 모두 알린다 — 화면이 빨간 테두리 N곳을 그린다', () => {
  it('칸마다 오류 하나씩', () => {
    const r = parseTaxSettingsSave(
      {
        bizType: '',
        withholdingCycle: 'M',
        taxEmails: [{ name: '', email: 'bad' }],
        unusedKinds: [],
        finAccounts: [{ kind: 'C', cardCoCode: 'KB', number: '12' }],
      },
      CODES,
    );
    expect(fieldsOf(r)).toEqual(['bizType', 'taxEmails[0].email', 'finAccounts[0].number']);
  });
  it('본문이 객체가 아니면 body 하나', () => {
    expect(fieldsOf(parseTaxSettingsSave(null, CODES))).toEqual(['body']);
    expect(fieldsOf(parseTaxSettingsSave([], CODES))).toEqual(['body']);
  });
});
