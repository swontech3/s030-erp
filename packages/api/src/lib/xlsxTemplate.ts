/**
 * ERP 공통 「양식 만들기」 — 사용자가 채워 올릴 엑셀 양식을 만든다(세무 1-4 보완, 2026-10-31). 현금 경비 양식이 처음 쓰고,
 * 뒤에 은행 · 급여 등 다른 양식도 칸 정의만 바꿔 이 부품을 부른다.
 *
 * ★ 시트 · 칸 · 서식은 SheetJS 로 만들고, 드롭다운 · 검사 규칙(데이터 유효성 검사)은 만든 파일을 fflate 로 풀어
 *   첫 시트 XML 에 `<dataValidations>` 를 써 넣은 뒤 다시 묶는다 — SheetJS 무료판은 규칙을 쓰지 못한다(대표 결정 2026-10-31,
 *   ExcelJS 는 딸린 꾸러미 라이선스 문제로 쓰지 않는다).
 * ★★ 자리는 엑셀 규격(ECMA-376 CT_Worksheet) 순서 — `sheetData` 뒤, `ignoredErrors` 등 뒤에 오는 요소보다 **앞**.
 *   어기면 엑셀이 「복구하시겠습니까?」를 띄우고 그 시트를 비운다(SheetJS 가 쓰는 ignoredErrors 뒤에 넣은 시험 파일, 대표 확인).
 * ★ 엑셀은 붙여넣기에 규칙을 걸지 않는다 — 올릴 때 서버 검사(표준 양식 변환)는 그대로 둔다.
 * ★ 사용자가 올린 파일 읽기는 이 부품과 상관없다(`tax/readSheet.ts`, SheetJS).
 * ★ 목록 내려받기(값이 든 표)는 `xlsxExport.ts` — 이 부품은 빈 양식만 만든다.
 *
 * 쓰는 법:
 *   buildXlsxTemplate({
 *     form: { name: '현금 경비', dataRows: 1000, columns: [
 *       { header: '날짜', format: 'date', check: { type: 'date' } },
 *       { header: '구분', check: { type: 'list', sheet: '구분 목록' } },
 *       { header: '금액', format: 'amount', check: { type: 'positiveInt' } }, …] },
 *     extraSheets: [{ name: '안내', rows: [['…']] }],
 *     lists: [{ name: '구분 목록', header: ['구분'], rows: [['매입'], ['매출']] }],
 *   })
 */
import * as XLSX from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export const TEMPLATE_DATE_FORMAT = 'yyyy-mm-dd';
export const TEMPLATE_AMOUNT_FORMAT = '#,##0';

/** 안내 창 글자 — 비우면 종류마다 기본 글자. */
interface CheckText {
  errorTitle?: string;
  error?: string;
}

/**
 * 칸 검사 — `list` 는 목록 시트의 A2 부터 목록 길이까지(1줄은 머리), `date` 는 날짜만(1900-01-01 ~ 9999-12-31,
 * 시각이 붙은 날짜도 날짜 값이라 받는다), `positiveInt` 는 0 보다 큰 정수만.
 */
export type TemplateCheck =
  | ({ type: 'list'; sheet: string } & CheckText)
  | ({ type: 'date' } & CheckText)
  | ({ type: 'positiveInt' } & CheckText);

export interface TemplateColumn {
  header: string;
  /** 빈 자료 칸에 미리 거는 서식 — date `yyyy-mm-dd` · amount `#,##0`. */
  format?: 'date' | 'amount';
  check?: TemplateCheck;
}

export interface TemplateSheet {
  name: string;
  rows: readonly (readonly string[])[];
}

export interface TemplateList {
  /** 시트 이름 — 드롭다운이 `check.sheet` 로 가리킨다. */
  name: string;
  /** 1줄 머리. 드롭다운 값은 A 칸이다(B 칸부터는 풀이 등). */
  header: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface XlsxTemplate {
  /** 양식 시트 — 늘 첫 시트(올리기는 첫 시트를 읽는다). 1줄 = 칸 제목, 자료 줄 2 ~ dataRows+1 에 서식 · 규칙. */
  form: { name: string; dataRows: number; columns: readonly TemplateColumn[] };
  /** 양식 뒤에 붙는 시트(안내 등) — 준 줄 그대로. */
  extraSheets?: readonly TemplateSheet[];
  /** 그 뒤의 목록 시트 — 목록은 부르는 쪽이 코드 표에서 읽어 채운다. 빈 목록이면 그 칸의 규칙을 부르는 쪽이 뺀다. */
  lists?: readonly TemplateList[];
}

const FORMAT_OF = { date: TEMPLATE_DATE_FORMAT, amount: TEMPLATE_AMOUNT_FORMAT } as const;

/** 엑셀 한도 — 안내 제목 32자 · 안내 글 255자. */
const MAX_TITLE = 32;
const MAX_MESSAGE = 255;

/** ECMA-376 CT_Worksheet 에서 dataValidations 뒤에 오는 요소 — 이 중 처음 나오는 것 앞에 넣는다. */
const AFTER_DATA_VALIDATIONS = [
  'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
  'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF',
  'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst',
];

const FORM_SHEET_PATH = 'xl/worksheets/sheet1.xml';

const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 시트 이름 → 식 안의 이름 — 작은따옴표로 감싸고 안의 작은따옴표는 겹쳐 쓴다. */
const sheetRef = (name: string) => `'${name.replace(/'/g, "''")}'`;

function textOf(check: TemplateCheck): { title: string; message: string } {
  const def =
    check.type === 'list' ? { title: '목록에 없음', message: `「${check.sheet}」 시트의 이름 중에서 고르세요.` }
    : check.type === 'date' ? { title: '날짜가 아님', message: '날짜만 적습니다. 예: 2026-10-05' }
    : { title: '숫자가 아님', message: '0 보다 큰 정수만 적습니다.' };
  const title = check.errorTitle ?? def.title;
  const message = check.error ?? def.message;
  if (title.length > MAX_TITLE) throw new Error(`양식 규칙 — 안내 제목은 ${MAX_TITLE}자까지: ${title}`);
  if (message.length > MAX_MESSAGE) throw new Error(`양식 규칙 — 안내 글은 ${MAX_MESSAGE}자까지`);
  return { title, message };
}

/** 칸 하나의 `<dataValidation>` — 대표가 엑셀에서 확인한 시험 파일(가_고침)과 같은 속성 · 순서. */
function ruleXml(check: TemplateCheck, sqref: string, lists: readonly TemplateList[]): string {
  let head: string;
  let body: string;
  if (check.type === 'list') {
    const list = lists.find((l) => l.name === check.sheet);
    if (!list) throw new Error(`양식 규칙 — 목록 시트가 없다: ${check.sheet}`);
    if (list.rows.length === 0) throw new Error(`양식 규칙 — 목록이 비었다(규칙을 빼고 부른다): ${check.sheet}`);
    head = 'type="list"';
    body = `<formula1>${escXml(`${sheetRef(list.name)}!$A$2:$A$${list.rows.length + 1}`)}</formula1>`;
  } else if (check.type === 'date') {
    head = 'type="date" operator="between"';
    body = '<formula1>1</formula1><formula2>2958465</formula2>';
  } else {
    head = 'type="whole" operator="greaterThan"';
    body = '<formula1>0</formula1>';
  }
  const { title, message } = textOf(check);
  return `<dataValidation ${head} allowBlank="1" showErrorMessage="1" showInputMessage="1"`
    + ` errorTitle="${escXml(title)}" error="${escXml(message)}" sqref="${sqref}">${body}</dataValidation>`;
}

/** 시트 XML 에 규칙 묶음을 규격 자리에 넣는다. */
function insertDataValidations(xml: string, block: string): string {
  if (xml.includes('<dataValidations')) throw new Error('양식 규칙 — 시트에 이미 dataValidations 가 있다');
  const end = xml.indexOf('</sheetData>');
  if (end < 0) throw new Error('양식 규칙 — 시트에 sheetData 가 없다');
  const from = end + '</sheetData>'.length;
  const nexts = [...AFTER_DATA_VALIDATIONS.map((t) => `<${t}`), '</worksheet>']
    .map((t) => xml.indexOf(t, from))
    .filter((i) => i >= 0);
  const at = Math.min(...nexts);
  return xml.slice(0, at) + block + xml.slice(at);
}

/** 양식 → xlsx 바이트. */
export function buildXlsxTemplate(t: XlsxTemplate): Uint8Array {
  const { form } = t;
  const lists = t.lists ?? [];
  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([form.columns.map((c) => c.header)]);
  form.columns.forEach((col, c) => {
    if (!col.format) return;
    for (let r = 1; r <= form.dataRows; r++) ws[XLSX.utils.encode_cell({ r, c })] = { t: 'z', z: FORMAT_OF[col.format] };
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: form.dataRows, c: form.columns.length - 1 } });
  XLSX.utils.book_append_sheet(wb, ws, form.name);
  for (const s of t.extraSheets ?? []) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows.map((r) => [...r])), s.name);
  for (const l of lists) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...l.header], ...l.rows.map((r) => [...r])]), l.name);
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', sheetStubs: true }));

  const rules = form.columns.flatMap((col, c) => {
    if (!col.check) return [];
    const letter = XLSX.utils.encode_col(c);
    return [ruleXml(col.check, `${letter}2:${letter}${form.dataRows + 1}`, lists)];
  });
  if (rules.length === 0) return bytes;

  const files = unzipSync(bytes);
  const sheet = files[FORM_SHEET_PATH];
  if (!sheet) throw new Error(`양식 규칙 — ${FORM_SHEET_PATH} 가 없다`);
  files[FORM_SHEET_PATH] = strToU8(insertDataValidations(strFromU8(sheet), `<dataValidations count="${rules.length}">${rules.join('')}</dataValidations>`));
  return zipSync(files, { level: 6 });
}
