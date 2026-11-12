/**
 * ERP 공통 「양식 만들기」 — 만든 파일을 **다시 풀어** 본다. 드롭다운 · 검사 규칙은 SheetJS 무료판이 읽지 못해서
 * 시트 XML 을 직접 읽는다(fflate). 서식 · 시트 · 칸은 SheetJS 로 다시 읽는다.
 *
 * ★ 엑셀은 시트 XML 의 요소 순서가 규격(ECMA-376 CT_Worksheet)과 다르면 「복구하시겠습니까?」를 띄우고 그 시트를 비운다
 *   (2026-10-31 대표 확인 — dataValidations 를 SheetJS 의 ignoredErrors 뒤에 넣은 파일). 자리를 시험으로 묶어 둔다.
 */
import * as XLSX from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsxTemplate, TEMPLATE_AMOUNT_FORMAT, TEMPLATE_DATE_FORMAT, type XlsxTemplate } from './xlsxTemplate.ts';

const sheetXml = (bytes: Uint8Array, n = 1) => strFromU8(unzipSync(bytes)[`xl/worksheets/sheet${n}.xml`]!);
const rulesOf = (xml: string) =>
  [...xml.matchAll(/<dataValidation ([^>]*)>([\s\S]*?)<\/dataValidation>/g)].map((m) => ({ attrs: m[1]!, body: m[2]! }));
const attr = (attrs: string, k: string) => new RegExp(`(?:^| )${k}="([^"]*)"`).exec(attrs)?.[1];

const SPEC: XlsxTemplate = {
  form: {
    name: '지어낸 양식',
    dataRows: 5,
    columns: [
      { header: '날짜', format: 'date', check: { type: 'date' } },
      { header: '구분', check: { type: 'list', sheet: '구분 목록' } },
      { header: '품명' },
      { header: '금액', format: 'amount', check: { type: 'positiveInt', errorTitle: '금액이 아님', error: '0 보다 큰 원 단위 정수만 적습니다.' } },
    ],
  },
  extraSheets: [{ name: '안내', rows: [['지어낸 안내 1'], ['지어낸 안내 2']] }],
  lists: [{ name: '구분 목록', header: ['구분'], rows: [['매입'], ['매출']] }],
};

describe('buildXlsxTemplate — 시트 · 칸 · 서식', () => {
  const bytes = buildXlsxTemplate(SPEC);
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true, sheetStubs: true });

  it('시트 순서 — 양식 → 덧붙인 시트 → 목록 시트', () => {
    expect(wb.SheetNames).toEqual(['지어낸 양식', '안내', '구분 목록']);
  });

  it('양식 1줄 = 칸 제목 · 자료 줄 없음 · 덧붙인 시트와 목록 시트는 준 줄 그대로', () => {
    const aoa = (n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n]!, { header: 1, defval: '', blankrows: false });
    expect(aoa('지어낸 양식')).toEqual([['날짜', '구분', '품명', '금액']]);
    expect(aoa('안내')).toEqual([['지어낸 안내 1'], ['지어낸 안내 2']]);
    expect(aoa('구분 목록')).toEqual([['구분'], ['매입'], ['매출']]);
  });

  it('서식 — 날짜 칸 yyyy-mm-dd · 금액 칸 #,##0, 자료 줄 2 ~ dataRows+1 줄만, 서식 없는 칸은 비움', () => {
    const ws = wb.Sheets['지어낸 양식']!;
    expect([TEMPLATE_DATE_FORMAT, TEMPLATE_AMOUNT_FORMAT]).toEqual(['yyyy-mm-dd', '#,##0']);
    for (const r of [2, 6]) {
      expect(ws[`A${r}`]?.z).toBe('yyyy-mm-dd');
      expect(ws[`D${r}`]?.z).toBe('#,##0');
      expect(ws[`C${r}`]).toBeUndefined();
    }
    expect(ws.A7).toBeUndefined();
    expect(ws['!ref']).toBe('A1:D6');
  });
});

describe('buildXlsxTemplate — 드롭다운 · 검사 규칙(시트 XML)', () => {
  const xml = sheetXml(buildXlsxTemplate(SPEC));
  const rules = rulesOf(xml);

  it('규칙은 check 가 있는 칸만, 칸 순서대로 — count 도 같다', () => {
    expect(rules.map((r) => attr(r.attrs, 'sqref'))).toEqual(['A2:A6', 'B2:B6', 'D2:D6']);
    expect(xml).toContain('<dataValidations count="3">');
  });

  it('★ 목록 — 목록 시트의 A2 부터 목록 길이까지(시트 이름은 작은따옴표)', () => {
    const r = rules[1]!;
    expect(attr(r.attrs, 'type')).toBe('list');
    expect(r.body).toBe("<formula1>'구분 목록'!$A$2:$A$3</formula1>");
  });

  it('★ 날짜만(1900-01-01 ~ 9999-12-31) · 0 보다 큰 정수만', () => {
    expect(attr(rules[0]!.attrs, 'type')).toBe('date');
    expect(attr(rules[0]!.attrs, 'operator')).toBe('between');
    expect(rules[0]!.body).toBe('<formula1>1</formula1><formula2>2958465</formula2>');
    expect(attr(rules[2]!.attrs, 'type')).toBe('whole');
    expect(attr(rules[2]!.attrs, 'operator')).toBe('greaterThan');
    expect(rules[2]!.body).toBe('<formula1>0</formula1>');
  });

  it('★ 모든 규칙 — 빈 칸 허용 · 오류 창 · 안내 창 켬(대표 확인 파일과 같은 모양)', () => {
    for (const r of rules) {
      expect(attr(r.attrs, 'allowBlank')).toBe('1');
      expect(attr(r.attrs, 'showErrorMessage')).toBe('1');
      expect(attr(r.attrs, 'showInputMessage')).toBe('1');
    }
  });

  it('★ 한글 안내 — 기본 글자 · 부르는 쪽이 준 글자', () => {
    expect([attr(rules[0]!.attrs, 'errorTitle'), attr(rules[0]!.attrs, 'error')]).toEqual(['날짜가 아님', '날짜만 적습니다. 예: 2026-10-05']);
    expect([attr(rules[1]!.attrs, 'errorTitle'), attr(rules[1]!.attrs, 'error')]).toEqual(['목록에 없음', '「구분 목록」 시트의 이름 중에서 고르세요.']);
    expect([attr(rules[2]!.attrs, 'errorTitle'), attr(rules[2]!.attrs, 'error')]).toEqual(['금액이 아님', '0 보다 큰 원 단위 정수만 적습니다.']);
  });

  it('★★ 자리 — sheetData 바로 뒤, SheetJS 가 쓰는 ignoredErrors 보다 앞(규격 순서)', () => {
    const at = xml.indexOf('<dataValidations');
    expect(at).toBe(xml.indexOf('</sheetData>') + '</sheetData>'.length);
    expect(xml).toContain('<ignoredErrors'); // SheetJS 가 지금 쓰는 요소 — 없어지면 이 시험이 자리를 보지 못한다
    expect(at).toBeLessThan(xml.indexOf('<ignoredErrors'));
  });

  it('규칙이 없는 양식은 dataValidations 를 쓰지 않는다', () => {
    const plain = buildXlsxTemplate({ form: { name: '빈', dataRows: 2, columns: [{ header: '가' }] } });
    expect(sheetXml(plain)).not.toContain('dataValidation');
  });

  it('XML 글자 — 안내 글자의 & < > " 는 바꿔 쓰고, 시트 이름의 작은따옴표는 겹쳐 쓴다', () => {
    const odd = buildXlsxTemplate({
      form: { name: '양식', dataRows: 1, columns: [{ header: '가', check: { type: 'list', sheet: "가'나 목록", error: 'A & B <"C">' } }] },
      lists: [{ name: "가'나 목록", header: ['가'], rows: [['x']] }],
    });
    const r = rulesOf(sheetXml(odd))[0]!;
    expect(attr(r.attrs, 'error')).toBe('A &amp; B &lt;&quot;C&quot;&gt;');
    expect(r.body).toBe("<formula1>'가''나 목록'!$A$2:$A$2</formula1>");
  });
});

describe('buildXlsxTemplate — 잘못 부르면 막는다', () => {
  it('목록 시트가 없거나 비었으면 오류(빈 목록은 부르는 쪽이 규칙을 뺀다)', () => {
    const noList: XlsxTemplate = { form: { name: '양식', dataRows: 1, columns: [{ header: '가', check: { type: 'list', sheet: '없는 목록' } }] } };
    expect(() => buildXlsxTemplate(noList)).toThrow(/없는 목록/);
    expect(() => buildXlsxTemplate({ ...noList, lists: [{ name: '없는 목록', header: ['가'], rows: [] }] })).toThrow(/비었/);
  });

  it('엑셀 한도 — 안내 제목 32자 · 안내 글 255자를 넘으면 오류', () => {
    const col = (errorTitle: string, error: string) =>
      ({ form: { name: '양식', dataRows: 1, columns: [{ header: '가', check: { type: 'date' as const, errorTitle, error } }] } });
    expect(() => buildXlsxTemplate(col('가'.repeat(33), '나'))).toThrow(/32/);
    expect(() => buildXlsxTemplate(col('가', '나'.repeat(256)))).toThrow(/255/);
  });
});
