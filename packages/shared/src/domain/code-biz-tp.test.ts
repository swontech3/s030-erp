import { describe, expect, it } from 'vitest';
import { CODE_BIZ_TP_CATEGORY, codeBizTpLabel, codeBizTpOf, codeBizTpOptions } from './code-biz-tp';
import { PINNED_CODES } from './code-usage';

describe('업무구분(CODE_BIZ_TP) — 코드 관리 왼쪽 목록', () => {
  it('코드값 ↔ 화면 업무구분', () => {
    expect(codeBizTpOf('BBIYONG')).toBe('bbiyong');
    expect(codeBizTpOf('ERP')).toBe('erp');
    expect(codeBizTpOf('erp')).toBeNull();
  });

  it('선택지 — 이 분류 · 아는 코드값만 · 받은 순서 · 이름은 코드에서', () => {
    const codes = [
      { category: 'PAY_ST', code: 'ERP', name: '다른 분류' },
      { category: CODE_BIZ_TP_CATEGORY, code: 'ERP', name: 'ERP 코드' },
      { category: CODE_BIZ_TP_CATEGORY, code: 'ETC', name: '모름' },
      { category: CODE_BIZ_TP_CATEGORY, code: 'BBIYONG', name: ' 삐용 ' },
    ];
    expect(codeBizTpOptions(codes)).toEqual([
      { tp: 'erp', code: 'ERP', name: 'ERP 코드' },
      { tp: 'bbiyong', code: 'BBIYONG', name: '삐용' },
    ]);
    expect(codeBizTpOptions([{ category: CODE_BIZ_TP_CATEGORY, code: 'ERP', name: '' }])[0]!.name).toBe('ERP');
  });

  it('딱지 — 선택지의 이름, 코드를 못 읽었으면 코드값', () => {
    expect(codeBizTpLabel('bbiyong', [{ tp: 'bbiyong', name: '삐용' }])).toBe('삐용');
    expect(codeBizTpLabel('bbiyong', [])).toBe('BBIYONG');
  });

  it('★ 고정 코드 — 코드 관리가 코드값을 바꾸거나 지우지 못한다', () => {
    const pin = PINNED_CODES.find((p) => p.category === CODE_BIZ_TP_CATEGORY);
    expect(pin).toMatchObject({ useTp: '000', codes: ['BBIYONG', 'ERP'] });
  });
});
