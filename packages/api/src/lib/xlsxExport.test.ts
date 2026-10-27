/**
 * ERP 공통 엑셀 내려받기 — 만든 파일을 SheetJS 로 다시 읽어 칸 · 값 · 시트 이름을 본다.
 */
import Fastify from 'fastify';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { XLSX_CONTENT_TYPE, buildXlsx, contentDispositionOf, sendXlsx } from './xlsxExport.ts';

interface Row {
  name: string;
  amount: number;
  memo: string | null;
}

const read = (bytes: Uint8Array) => XLSX.read(bytes, { type: 'array' });

describe('buildXlsx', () => {
  it('제목 줄 + 줄마다 값 — 숫자는 숫자 칸, 빈 값은 빈 칸', () => {
    const bytes = buildXlsx([
      {
        name: '매입·매출 계산서',
        columns: [
          { header: '거래처명', value: (r: Row) => r.name },
          { header: '공급가액', value: (r: Row) => r.amount },
          { header: '메모', value: (r: Row) => r.memo },
        ],
        rows: [{ name: '가', amount: 100000, memo: null }, { name: '나', amount: 2500, memo: '메모' }],
      },
    ]);
    const wb = read(bytes);
    expect(wb.SheetNames).toEqual(['매입·매출 계산서']);
    const sheet = wb.Sheets['매입·매출 계산서']!;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })).toEqual([
      ['거래처명', '공급가액', '메모'],
      ['가', 100000, null],
      ['나', 2500, '메모'],
    ]);
    expect(sheet.B2?.t).toBe('n');
  });

  it('줄이 없어도 제목 줄만 있는 시트를 만든다', () => {
    const bytes = buildXlsx([{ name: '빈 시트', columns: [{ header: '칸', value: () => '' }], rows: [] }]);
    expect(XLSX.utils.sheet_to_json(read(bytes).Sheets['빈 시트']!, { header: 1 })).toEqual([['칸']]);
  });

  it('시트 여럿 — 순서 그대로', () => {
    const sheet = (name: string) => ({ name, columns: [{ header: 'a', value: () => 1 }], rows: [] });
    expect(read(buildXlsx([sheet('하나'), sheet('둘')])).SheetNames).toEqual(['하나', '둘']);
  });
});

describe('contentDispositionOf — 한글 파일 이름', () => {
  it('filename* 에 UTF-8 로, filename 에는 ASCII 대체', () => {
    expect(contentDispositionOf('거래분류_2026-09.xlsx')).toBe(
      `attachment; filename="_____2026-09.xlsx"; filename*=UTF-8''${encodeURIComponent('거래분류_2026-09.xlsx')}`,
    );
  });
});

describe('sendXlsx', () => {
  it('엑셀 형식 · 내려받기 머리 · no-store 로 보낸다', async () => {
    const app = Fastify();
    const bytes = buildXlsx([{ name: 's', columns: [{ header: 'a', value: () => 1 }], rows: [] }]);
    app.get('/x', async (_req, reply) => sendXlsx(reply, '거래분류_2026-09.xlsx', bytes));
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(XLSX_CONTENT_TYPE);
    expect(res.headers['content-disposition']).toBe(contentDispositionOf('거래분류_2026-09.xlsx'));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(read(new Uint8Array(res.rawPayload)).SheetNames).toEqual(['s']);
    await app.close();
  });
});
