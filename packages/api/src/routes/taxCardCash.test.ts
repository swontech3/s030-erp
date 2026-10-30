/**
 * 카드 사용 내역 · 현금 경비(1-4) — DB 없이 볼 수 있는 것: 현금 경비 표준 양식 시트.
 *
 * ★ 올리기 · 개수 맞추기 · 거래처 자동 등록 · 회사별 막기는 `scripts/verify-tax-uploads.js` 가 실제 DB 에서 잰다.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { CASH_TEMPLATE_GUIDE } from '@swonbiz/shared/domain/tax-card-cash';
import { buildXlsx } from '../lib/xlsxExport.ts';
import { cashTemplateSheets } from './taxCardCash.ts';

const SIG = ['날짜', '품명', '거래처', '항목', '매출액', '매입액', '지급방법', '증빙'];

describe('cashTemplateSheets — 현금 경비 표준 양식(판단 14 · 15)', () => {
  const bytes = buildXlsx(cashTemplateSheets(SIG, {
    items: [{ code: 'MEAL', name: '식대·회의비', description: '직원 식사·회의 다과' }, { code: 'TEL', name: '통신비', description: null }],
    payMethods: [{ code: 'CASH', name: '현금' }, { code: 'TRANSFER', name: '계좌이체(직원 정산)' }],
    proofs: [{ code: 'RECEIPT', name: '영수증' }, { code: 'CASHRCPT', name: '현금영수증' }],
  }));
  const wb = XLSX.read(bytes, { type: 'array' });
  const aoa = (name: string) => XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, defval: '' });

  it('시트 넷 — 현금 경비 · 항목 목록 · 지급방법 목록 · 증빙 목록(드롭다운 없이 목록 시트)', () => {
    expect(wb.SheetNames).toEqual(['현금 경비', '항목 목록', '지급방법 목록', '증빙 목록']);
  });

  it('★ 1줄 안내 문구 · 2줄 제목 줄(대응표 TAX_CASH_STD 제목 줄 그대로) · 자료 줄 없음', () => {
    expect(aoa('현금 경비')).toEqual([[CASH_TEMPLATE_GUIDE, '', '', '', '', '', '', ''], SIG]);
  });

  it('목록 시트 — 코드 표 이름 그대로(항목은 풀이까지)', () => {
    expect(aoa('항목 목록')).toEqual([['항목', '풀이'], ['식대·회의비', '직원 식사·회의 다과'], ['통신비', '']]);
    expect(aoa('지급방법 목록')).toEqual([['지급방법'], ['현금'], ['계좌이체(직원 정산)']]);
    expect(aoa('증빙 목록')).toEqual([['증빙'], ['영수증'], ['현금영수증']]);
  });

  it('★ 사업자 유형이 없어 항목이 비면 — 항목 목록 시트에 안내 한 줄(양식은 그대로 내려준다)', () => {
    const empty = XLSX.read(buildXlsx(cashTemplateSheets(SIG, { items: [], payMethods: [], proofs: [] })), { type: 'array' });
    expect(empty.SheetNames).toEqual(['현금 경비', '항목 목록', '지급방법 목록', '증빙 목록']);
    expect(XLSX.utils.sheet_to_json(empty.Sheets['항목 목록']!, { header: 1, defval: '' })).toEqual([
      ['항목', '풀이'],
      ['세무 설정에서 사업자 유형을 고른 뒤 다시 내려받으면 항목 목록이 채워집니다', ''],
    ]);
  });
});
