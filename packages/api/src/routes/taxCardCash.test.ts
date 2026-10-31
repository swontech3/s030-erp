/**
 * 카드 사용 내역 · 현금 경비(1-4) — DB 없이 볼 수 있는 것: 현금 경비 표준 양식 파일.
 *
 * ★ 올리기 · 개수 맞추기 · 거래처 자동 등록 · 회사별 막기는 `scripts/verify-tax-uploads.js` 가 실제 DB 에서 잰다.
 * ★ 210(2026-10-31): 1줄 제목 · 구분 + 금액 한 칸 · 「안내」 시트 · 구분 목록, 날짜 · 금액 칸 서식.
 * ★ 드롭다운 · 검사(2026-10-31): ERP 공통 양식 만들기(`lib/xlsxTemplate.ts`) — 날짜 · 구분 · 항목 · 금액 · 결제방법 · 증빙 6칸.
 *   만든 파일을 **다시 읽어** 본다 — 시트 · 칸 · 서식이 파일에 실제로 들어갔는지.
 */
import * as XLSX from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { CASH_TEMPLATE_GUIDE, convertCashSheet, type CashImportMap, type CashMapColumns } from '@swonbiz/shared/domain/tax-card-cash';
import { readSheetRows } from '../tax/readSheet.ts';
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

/** 「현금 경비」 시트의 규칙 — 칸 범위 · 종류 · 식1. */
const rulesOf = (bytes: Uint8Array) =>
  [...strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!).matchAll(/<dataValidation [^>]*type="([a-z]+)"[^>]*sqref="([^"]+)"[^>]*><formula1>([^<]*)<\/formula1>/g)]
    .map((m) => [m[2], m[1], m[3]]);

describe('buildCashTemplate — 드롭다운 · 검사(ERP 공통 양식 만들기)', () => {
  const last = CASH_TEMPLATE_DATA_ROWS + 1;

  it('★ 6칸 — 날짜만 · 구분 · 항목 · 결제방법 · 증빙 목록 · 0 보다 큰 정수(금액), 자료 줄 2 ~ 1001줄', () => {
    expect(rulesOf(buildCashTemplate(SIG, COLS, NAMES))).toEqual([
      [`A2:A${last}`, 'date', '1'],
      [`B2:B${last}`, 'list', "'구분 목록'!$A$2:$A$3"],
      [`E2:E${last}`, 'list', "'항목 목록'!$A$2:$A$3"],
      [`F2:F${last}`, 'whole', '0'],
      [`G2:G${last}`, 'list', "'결제방법 목록'!$A$2:$A$3"],
      [`H2:H${last}`, 'list', "'증빙 목록'!$A$2:$A$3"],
    ]);
  });

  it('★ 칸 자리는 대응표를 따른다 — 칸 순서가 바뀌면 규칙도 따라간다', () => {
    const sig = ['금액', '날짜', '구분', '품명', '거래처', '항목', '결제방법', '증빙'];
    const cols: CashMapColumns = { amount: 1, useDate: 2, direction: 3, description: 4, vendorName: 5, item: 6, payMethod: 7, proof: 8 };
    expect(rulesOf(buildCashTemplate(sig, cols, NAMES)).map((r) => [r[0]!.slice(0, 1), r[1]])).toEqual([
      ['A', 'whole'], ['B', 'date'], ['C', 'list'], ['F', 'list'], ['G', 'list'], ['H', 'list'],
    ]);
  });

  it('★ 항목 목록이 비면(세무 설정 전) 항목 칸 규칙을 뺀다 — 안내 한 줄은 드롭다운에 넣지 않는다', () => {
    const rules = rulesOf(buildCashTemplate(SIG, COLS, { ...NAMES, items: [] }));
    expect(rules.map((r) => r[0]!.slice(0, 1))).toEqual(['A', 'B', 'F', 'G', 'H']);
  });

  it('★ 규칙이 든 채로 채운 양식이 지금 올리기 읽기(readSheetRows + convertCashSheet)로 그대로 읽힌다', () => {
    // 엑셀에서 채워 저장한 것처럼 — 만든 파일의 시트 XML 2 ~ 4줄에 값을 넣는다(규칙 · 서식은 그대로 둔다)
    const files = unzipSync(buildCashTemplate(SIG, COLS, NAMES));
    const path = 'xl/worksheets/sheet1.xml';
    const str = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    const num = (ref: string, v: number, s: number) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    const rowXml = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;
    const filledRows: Record<number, string> = {
      2: num('A2', 46300, 1) + str('B2', '매입') + str('C2', '지어낸 문구') + str('E2', '식대·회의비') + num('F2', 3000, 2) + str('G2', '현금') + str('H2', '영수증'),
      3: str('A3', '2026-10-06 14:30') + str('B3', '매출') + str('C3', '지어낸 판매') + num('F3', 50000, 2) + str('G3', '계좌이체'),
      4: str('A4', '2026-10-07') + str('B4', '환불') + str('C4', '지어낸 구분틀림') + num('F4', 1000, 2) + str('G4', '현금'),
    };
    let xml = strFromU8(files[path]!);
    for (const [r, cells] of Object.entries(filledRows)) {
      const from = xml.indexOf(`<row r="${r}">`);
      const to = xml.indexOf('</row>', from) + '</row>'.length;
      expect(from).toBeGreaterThan(0);
      xml = xml.slice(0, from) + rowXml(Number(r), cells) + xml.slice(to);
    }
    files[path] = strToU8(xml);
    const filled = zipSync(files);
    expect(rulesOf(filled)).toHaveLength(6);

    const read = readSheetRows(filled);
    if (!read.ok) throw new Error(read.message);
    const map: CashImportMap = { id: 'm', kind: 'CASH', headerRow: 1, headerSignature: SIG, columns: COLS };
    const conv = convertCashSheet(read.rows, map, NAMES);
    if (!conv.ok) throw new Error(JSON.stringify(conv.error));
    expect(conv.rows.map((r) => [r.useDate, r.direction, r.amount, r.payMethod])).toEqual([
      ['2026-10-05', 'P', 3000, 'CASH'], ['2026-10-06', 'S', 50000, 'TRANSFER'],
    ]);
    expect(conv.excluded.badDirection).toBe(1); // 붙여넣기는 엑셀 규칙을 피한다 — 서버 검사가 그대로 막는다
  });

  it('★ 규칙이 든 양식 그대로도 읽힌다 — 제목 줄이 맞고 줄이 없을 뿐(올릴 줄이 없습니다)', () => {
    const read = readSheetRows(buildCashTemplate(SIG, COLS, NAMES));
    if (!read.ok) throw new Error(read.message);
    const conv = convertCashSheet(read.rows, { id: 'm', kind: 'CASH', headerRow: 1, headerSignature: SIG, columns: COLS }, NAMES);
    expect(conv.ok ? 'ok' : conv.error.code).toBe('no_rows');
  });
});
