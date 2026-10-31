/**
 * 카드 사용 내역 · 현금 경비(1-4) — DB 없이 볼 수 있는 것: 현금 경비 표준 양식 파일.
 *
 * ★ 올리기 · 개수 맞추기 · 거래처 자동 등록 · 회사별 막기는 `scripts/verify-tax-uploads.js` 가 실제 DB 에서 잰다.
 * ★ 210(2026-10-31): 1줄 제목 · 구분 + 금액 한 칸 · 「안내」 시트 · 구분 목록, 날짜 · 금액 칸 서식. 드롭다운은 없다(라이선스 문제로 미룸).
 *   만든 파일을 **다시 읽어** 본다 — 시트 · 칸 · 서식이 파일에 실제로 들어갔는지.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { CASH_TEMPLATE_GUIDE, type CashMapColumns } from '@swonbiz/shared/domain/tax-card-cash';
import { buildCashTemplate, CASH_TEMPLATE_DATA_ROWS } from './taxCardCash.ts';

const SIG = ['날짜', '구분', '품명', '거래처', '항목', '금액', '결제방법', '증빙'];
const COLS: CashMapColumns = { useDate: 1, direction: 2, description: 3, vendorName: 4, item: 5, amount: 6, payMethod: 7, proof: 8 };
const NAMES = {
  directions: [{ code: 'P', name: '매입' }, { code: 'S', name: '매출' }],
  items: [{ code: 'MEAL', name: '식대·회의비', description: '직원 식사·회의 다과' }, { code: 'TEL', name: '통신비', description: null }],
  payMethods: [{ code: 'CASH', name: '현금' }, { code: 'TRANSFER', name: '계좌이체' }],
  proofs: [{ code: 'RECEIPT', name: '영수증' }, { code: 'CASHRCPT', name: '현금영수증' }],
};

describe('buildCashTemplate — 현금 경비 표준 양식(판단 14 · 15 · 210)', () => {
  const wb = XLSX.read(buildCashTemplate(SIG, COLS, NAMES), { type: 'array', cellNF: true, sheetStubs: true });
  const aoa = (name: string) => XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, defval: '', blankrows: false });

  it('시트 — 현금 경비(첫 시트 — 올리기는 첫 시트를 읽는다) · 안내 · 구분 · 항목 · 결제방법 · 증빙 목록', () => {
    expect(wb.SheetNames).toEqual(['현금 경비', '안내', '구분 목록', '항목 목록', '결제방법 목록', '증빙 목록']);
  });

  it('★ 1줄 = 제목 줄(대응표 TAX_CASH_STD 그대로) · 자료 줄 없음', () => {
    expect(aoa('현금 경비')).toEqual([SIG]);
  });

  it(`★ 날짜 칸은 날짜 서식 · 금액 칸은 「#,##0」 — 자료 줄 2~${CASH_TEMPLATE_DATA_ROWS + 1}줄, 다른 칸은 서식 없음`, () => {
    const ws = wb.Sheets['현금 경비']!;
    expect(CASH_TEMPLATE_DATA_ROWS).toBe(1000);
    for (const r of [2, 500, CASH_TEMPLATE_DATA_ROWS + 1]) {
      expect(ws[`A${r}`]?.z).toBe('yyyy-mm-dd');
      expect(ws[`F${r}`]?.z).toBe('#,##0');
      expect(ws[`C${r}`]).toBeUndefined();
    }
    expect(ws[`A${CASH_TEMPLATE_DATA_ROWS + 2}`]).toBeUndefined();
  });

  it('★ 「안내」 시트 — 안내 문구 한 줄씩(목록에 있는 이름 그대로 적으세요)', () => {
    expect(aoa('안내')).toEqual(CASH_TEMPLATE_GUIDE.map((l) => [l]));
  });

  it('목록 시트 — 코드 표 이름 그대로(항목은 풀이까지), 머리는 제목 줄의 칸 이름', () => {
    expect(aoa('구분 목록')).toEqual([['구분'], ['매입'], ['매출']]);
    expect(aoa('항목 목록')).toEqual([['항목', '풀이'], ['식대·회의비', '직원 식사·회의 다과'], ['통신비', '']]);
    expect(aoa('결제방법 목록')).toEqual([['결제방법'], ['현금'], ['계좌이체']]);
    expect(aoa('증빙 목록')).toEqual([['증빙'], ['영수증'], ['현금영수증']]);
  });

  it('★ 사업자 유형이 없어 항목이 비면 — 항목 목록 시트에 안내 한 줄(양식은 그대로 내려준다)', () => {
    const empty = XLSX.read(buildCashTemplate(SIG, COLS, { directions: [], items: [], payMethods: [], proofs: [] }), { type: 'array' });
    expect(empty.SheetNames).toEqual(['현금 경비', '안내', '구분 목록', '항목 목록', '결제방법 목록', '증빙 목록']);
    expect(XLSX.utils.sheet_to_json(empty.Sheets['항목 목록']!, { header: 1, defval: '' })).toEqual([
      ['항목', '풀이'],
      ['세무 설정에서 사업자 유형을 고른 뒤 다시 내려받으면 항목 목록이 채워집니다', ''],
    ]);
  });
});
