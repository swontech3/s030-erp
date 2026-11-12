/**
 * 엑셀 바이트 → 첫 시트의 행(셀 배열) — SheetJS(0.20.3, 공식 배포 주소판)로 읽는다.
 *
 * ★ 행 번호를 지킨다 — 0번 = 엑셀 1줄. 빈 줄도 빈 배열로 남긴다(대응표가 「6줄째가 제목」처럼 줄 번호로 가리킨다).
 * ★ 형식은 **파일 앞 바이트**로 본다(xls · xlsx) — 본문 형식(content-type) · 확장자는 믿지 않는다.
 * ★ 크기(5MB)는 Fastify 본문 해석이 먼저 막고 여기서 한 번 더 본다. 줄 수는 상한 + 여유까지만 읽는다 —
 *   나머지는 읽지 않고, 넘친 것은 표준 양식 변환(`convertInvoiceSheet`)이 「10,000줄까지」로 막는다.
 * ★ 수식 · 서식 · 매크로는 읽지 않는다. 값만.
 * ★ 엑셀 날짜 값은 UTC 로 읽는다(`UTC: true`, 2026-10-31) — 아니면 서버 시간대(서울) 자정이 되어 UTC 날짜로 보는
 *   `dateOf` 가 하루 앞 날짜를 낸다. 글자로 적힌 날짜(홈택스 파일)는 영향이 없다.
 */
import * as XLSX from 'xlsx';
import {
  TAX_UPLOAD_MAX_BYTES,
  TAX_UPLOAD_MAX_ROWS,
  detectSpreadsheetFormat,
} from '@swonbiz/shared/domain/tax-uploads';

/** 제목 줄 위의 머리 줄 여유 — 이만큼 더 읽어야 「상한을 넘었다」를 알 수 있다. */
const HEAD_ROOM_ROWS = 100;

export type SheetRead =
  | { ok: true; format: 'xls' | 'xlsx'; rows: unknown[][] }
  | { ok: false; code: 'not_spreadsheet' | 'too_large' | 'unreadable'; message: string };

export type SocialRead =
  | { ok: true; format: 'xls' | 'xlsx' | 'csv'; rows: unknown[][] }
  | Extract<SheetRead, { ok: false }>;

/**
 * 4대보험 파일(1-6) — 앞 바이트가 엑셀이면 엑셀로, 아니면 CSV 로 읽는다.
 * ★ 통합징수포털 CSV 는 옛 한글 부호(cp949)다 — UTF-8 로 깨짐 없이 풀리면 UTF-8(앞 표시 BOM 은 걷음), 아니면 Node 기본
 *   `TextDecoder('euc-kr')`(cp949 를 포함하는 WHATWG 부호)로 푼다. 새 꾸러미는 쓰지 않는다.
 * ★ 값은 모두 **글자 그대로** 둔다(숫자로 바꾸지 않는다 — 가입자 번호 앞 0 을 지킨다). 빈 줄도 빈 배열로 남긴다.
 * ★ 칸을 읽는 것은 대응표가 가리키는 칸뿐이다(shared `convertSocialSheet`) — 주민번호 칸은 여기서 나뉘기만 하고 쓰이지 않는다.
 */
export function readSocialRows(bytes: Uint8Array): SocialRead {
  if (bytes.length > TAX_UPLOAD_MAX_BYTES) {
    return { ok: false, code: 'too_large', message: '파일은 5MB 까지 올릴 수 있습니다' };
  }
  if (detectSpreadsheetFormat(bytes)) return readSheetRows(bytes);
  const text = decodeCsvText(bytes);
  if (text === null) return { ok: false, code: 'not_spreadsheet', message: 'CSV · 엑셀 파일(.csv · .xls · .xlsx)만 올릴 수 있습니다' };
  return { ok: true, format: 'csv', rows: parseCsv(text, TAX_UPLOAD_MAX_ROWS + HEAD_ROOM_ROWS) };
}

/** UTF-8(깨짐 없음) → 그대로, 아니면 cp949. 글자 파일이 아니면(NUL) null. */
function decodeCsvText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

/** 쉼표 · 큰따옴표(RFC 4180) CSV → 행. 줄바꿈은 CRLF · LF. 마지막 빈 줄은 남기지 않는다. `maxRows` 줄까지만. */
function parseCsv(text: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    rows.push(row.length === 1 && row[0] === '' ? [] : row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { endRow(); i++; }
    else if (ch === '\n' || ch === '\r') endRow();
    else field += ch;
  }
  if ((field !== '' || row.length > 0) && rows.length < maxRows) endRow();
  return rows;
}

export function readSheetRows(bytes: Uint8Array): SheetRead {
  if (bytes.length > TAX_UPLOAD_MAX_BYTES) {
    return { ok: false, code: 'too_large', message: '파일은 5MB 까지 올릴 수 있습니다' };
  }
  const format = detectSpreadsheetFormat(bytes);
  if (!format) return { ok: false, code: 'not_spreadsheet', message: '엑셀 파일(.xls · .xlsx)만 올릴 수 있습니다' };

  try {
    const wb = XLSX.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      type: 'buffer',
      sheetRows: TAX_UPLOAD_MAX_ROWS + HEAD_ROOM_ROWS,
      cellDates: true,
      UTC: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
    });
    const first = wb.SheetNames[0];
    const ws = first ? wb.Sheets[first] : undefined;
    if (!ws) return { ok: false, code: 'unreadable', message: '읽을 수 없는 파일입니다' };
    const ref = ws['!ref'];
    if (!ref) return { ok: true, format, rows: [] };
    // ★ 시트가 A1 이 아닌 곳에서 시작해도 0번 = 1줄이 되도록 A1 부터 읽는다
    const range = XLSX.utils.decode_range(ref);
    range.s.r = 0;
    range.s.c = 0;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range, UTC: true });
    return { ok: true, format, rows };
  } catch {
    return { ok: false, code: 'unreadable', message: '읽을 수 없는 파일입니다' };
  }
}
