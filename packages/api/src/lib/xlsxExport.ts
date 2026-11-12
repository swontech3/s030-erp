/**
 * ERP 공통 「엑셀 내려받기」 — 목록을 xlsx 로 만들어 내려보낸다(세무 1-3, 2026-10-27).
 *
 * ★ 표양식 관리(PDF 서류)는 xlsx 를 다루지 않는다 — 목록 내려받기는 이 부품 하나로 한다.
 * ★ SheetJS 는 api 패키지에만 있다. 그래서 파일은 **서버가 만든다** — 화면은 웹 중계(`forwardGetFile`)로 받아 저장한다.
 * ★ 칸 모양은 부르는 쪽이 정한다(표준 양식 칸 그대로). 여기서는 값만 옮긴다 — 숫자는 숫자 칸, null 은 빈 칸.
 *
 * 쓰는 법:
 *   const bytes = buildXlsx([{ name: '시트', columns: [{ header: '거래처명', value: (r) => r.name }], rows }]);
 *   return sendXlsx(reply, '거래분류_2026-09.xlsx', bytes);
 */
import type { FastifyReply } from 'fastify';
import * as XLSX from 'xlsx';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface XlsxColumn<T> {
  header: string;
  value: (row: T) => string | number | null;
}

export interface XlsxSheet<T> {
  /** 시트 이름 — 엑셀 규칙상 31자 이내, `: \ / ? * [ ]` 없이. */
  name: string;
  columns: readonly XlsxColumn<T>[];
  rows: readonly T[];
}

/** 시트들 → xlsx 바이트. 줄이 없으면 제목 줄만. 시트마다 줄 모양이 달라 `any` 로 받는다. */
export function buildXlsx(sheets: readonly XlsxSheet<any>[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const aoa = [s.columns.map((c) => c.header), ...s.rows.map((r) => s.columns.map((c) => c.value(r)))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), s.name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/** 내려받기 머리 — 한글 이름은 filename*(UTF-8), filename 에는 ASCII 가 아닌 글자를 `_` 로 바꾼 대체 이름. */
export function contentDispositionOf(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function sendXlsx(reply: FastifyReply, fileName: string, bytes: Uint8Array): FastifyReply {
  return reply
    .header('Content-Type', XLSX_CONTENT_TYPE)
    .header('Content-Disposition', contentDispositionOf(fileName))
    .header('Cache-Control', 'no-store')
    .send(Buffer.from(bytes));
}
