/**
 * 일회용(2026-11-01) — 유한회사 타관할로의 본점이전(`HQ_OUT`) 등록: 코드 줄 · 등기 설정 줄 · 표양식 3개(결정 2026-11-01).
 *
 *   1. 공통 코드 `LAW_CNG_TP`/`000` 줄 `HQ_OUT` 「타관할로의 본점이전」(순서 = 그 파티션의 가장 큰 순서 + 1)
 *   2. 등기 설정 법인변경 `HQ_OUT` · 회사유형 유한회사(`A`) 줄 — 원본(`doc/forms-src/92-2(67-2).유한회사본점이전등기
 *      (타관할로의본점이전).docx`, git 밖)에서: 표시명 · 양식호수 · 등기의 목적 · 첨부서면 6개(결정 6). 사유는 날짜 없는
 *      문구(결정 5). 세금 고정 112,500 · 22,500(결정 3), 등기신청수수료는 비움(결정 4 — 등기 설정 화면에서 넣음)
 *   3. 표양식(법무 표시: 법인변경 · 건마다 · 구분 `HQ_OUT` · 회사유형 유한회사 — 유한회사 타관할 건에만 뜬다)
 *      · 「본점이전(관할외) 등기신청서(유한회사)」 — 표양식 「설립등기신청서(유한회사)」의 칸 모양을 복사해 원본의 행으로
 *        다시 짠다. 1장 = 머리(접수) · 상호/등기번호 · 본점 · 등기의 목적 · 사유 · 등기할 사항 4행(새 본점 · 이전한 뜻과
 *        연월일 · 지배인 · 상호 변경 — 뒤 둘은 빈칸, 결정 8). 2장 = 설립 신청서 3장(세금 · 첨부서면 · 신청인 · 알림 ·
 *        작성요령)에서 과세표준액 행을 빼고, 신청인 본점 = 새 본점(원본 ⑫), 작성요령은 원본의 두 항목
 *      · 「사원총회 의사록(유한회사, 변경)」 — 표양식 「주주총회 의사록」 복사 · 낱말만(결정 7): 주주 → 사원 · 주식 → 출자좌수
 *        · 소집절차 생략 근거 제363조 제4항 → 제573조 · 안건 = 정관 본점 소재지 변경, 정족수는 제585조 문구 · 사내이사 → 이사
 *      · 「이사과반수동의서」 — 표양식 「이사회 의사록」 복사 · 낱말만 + 짧게(결정 7): 일시 · 장소 · 출석 현황 · 폐회 문장을
 *        빼고 동의 사항(새 본점 · 이전일) · 맺음 문장 · 날짜 · 서명란(대표이사 · 이사 두 줄)만 남긴다
 * ★ 행 높이: 바꾸거나 새로 짠 행만 헤드리스 Chrome 으로 재서(시험 건 — 긴 상호 · 긴 주소) 모자라면 늘린다. 그대로 둔 행은
 *   원래 높이. 앱 인쇄 규칙(장마다 297mm · 위아래 12mm, 2026-11-01 장 나누기 스크립트와 같은 재기)으로 모든 장이 27.30cm
 *   안인지, 마지막 글 줄이 장 안인지 본다.
 * ★ 원본 양식 · 기존 등기 설정 줄 · 다른 코드 줄은 읽기만 한다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 한 트랜잭션으로 쓴다. 멈추는 경우(아무것도 쓰지 않는다): 원본 양식이 1건이
 *   아님 · 바꿀 칸 글자가 기대와 다름 · 코드 줄 · 등기 설정 줄 · 양식 이름이 이미 있음 · 분류 머리 · 파티션이 없음 ·
 *   넘침 · `parseDefinition` 실패 · 이름표 밖 자리표시 · 남으면 안 되는 낱말(주주 · 주식 · 사내이사).
 *   쓰는 표: `tb_s080_codes_line` 한 줄 · `tb_s080_doc_form_settings` 한 줄 · `tb_s080_form_templates` 세 줄(넣기만).
 *
 *   npx tsx scripts/oneoff/2026-11-01-ltd-hq-out.mjs <admin.env>              (보기)
 *   npx tsx scripts/oneoff/2026-11-01-ltd-hq-out.mjs <admin.env> --apply      (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DEFAULT_MARGIN_TOP, definitionTokens, migrateDefinition, parseDefinition } from '../../packages/shared/src/domain/form-template.ts';
import { CORP_CHANGE_PRINT_FIELDS, buildCasePrintValues, pickDocFormSetting } from '../../packages/shared/src/domain/corp-change-print.ts';
import { markAppliesTo, parseLegalMark } from '../../packages/shared/src/domain/legal-form-mark.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-01-ltd-hq-out.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE_INNER_CM = 29.7 - 1.2 * 2;
const BY = 'oneoff-2026-11-01';
const clone = (x) => JSON.parse(JSON.stringify(x));
const fmt = (n) => n.toFixed(2);
const LABELS = Object.fromEntries(CORP_CHANGE_PRINT_FIELDS.map((f) => [f.name, f.label]));

// =============================================================================
// 1 · 2 — 코드 줄 · 등기 설정 줄
// =============================================================================
const CODE = { buildId: '1', category: 'LAW_CNG_TP', useTp: '000', code: 'HQ_OUT', name: '타관할로의 본점이전', description: '유한회사 건만 고를 수 있다 — 동일관할(HQ)은 주식회사 건만(결정 2026-11-01)' };
const SETTING = {
  regTypeKey: 'HQ_OUT',
  companyType: 'A',
  label: '유한회사 본점이전 등기(타관할로의 본점이전)',
  formNo: '[양식 제92-2호]',
  regPurpose: '유한회사 본점이전등기',
  // 결정 5 — 원본 ⑤ 문구에서 날짜 둘(20○○년○월○일)을 뺀다
  regReason: '사원총회 결의에 의하여 정관의 본점소재지를 변경하고 이사과반수의 결정(또는 이사회 결의)에 의하여 본점을 이전하였으므로 다음사항의 등기를 구함',
  // 결정 3 · 4 — 등록면허세 · 지방교육세 고정, 수수료는 비움
  taxes: { regLicense: 112_500, localEdu: 22_500, regFee: null },
  // 결정 6 — 원본 ⑪ 6개(순서 그대로). 통수는 원본이 비어 있다 — 다른 줄과 같이 1통
  attachments: ['정관', '사원총회의사록(공증 받은 것)', '이사과반수동의서', '등록면허세영수필확인서', '등기신청수수료영수필확인서', '위임장'].map((name) => ({ name, copies: 1 })),
};

// =============================================================================
// 3 — 서식
// =============================================================================
const MARK = { domain: 'corp-change', unit: 'case', changeTypes: ['HQ_OUT'], companyType: 'A' };
const APP = { from: '설립등기신청서(유한회사)', name: '본점이전(관할외) 등기신청서(유한회사)' };
const MIN = { from: '주주총회 의사록', name: '사원총회 의사록(유한회사, 변경)' };
const CON = { from: '이사회 의사록', name: '이사과반수동의서' };

/** 원본 작성요령 — 설립 신청서의 세 항목에서 「인감증명법」 항목을 뺀 두 항목(원본 92-2 그대로). */
const SEAL_ITEM = /\n1\.「인감증명법」[^\n]*/;

/** 사원총회 의사록(변경) 안건 — 결정 7(정관 본점 조항 변경 · 제585조 정족수 문구). */
const MIN_AGENDA = '제1호 의안 : 정관 변경(본점 소재지)의 건\n의장은 본점을 {{newHqAddress}}(으)로 이전하기 위하여 정관의 본점 소재지 조항을 변경할 필요가 있음을 설명하고 그 가부를 물은 바, 총사원의 반수 이상이며 총사원의 의결권의 4분의 3 이상을 가지는 사원의 동의로 원안대로 승인 가결하다.';
/** 사원총회 의사록(변경) — 칸 글자 바꾸기(장 · 행 · 열 → 지금 글자, 새 글자). */
const MIN_EDITS = [
  [0, 0, 0, '주주총회 의사록', '사원총회 의사록'],
  [0, 1, 0, '임시주주총회', '임시사원총회'],
  [0, 3, 0, '상법 제363조 제4항에 따라 주주 전원의 동의를 받아 소집절차를 생략하고 다음과 같이 임시 주주총회를 개최하다.', '상법 제573조에 따라 사원 전원의 동의를 받아 소집절차를 생략하고 다음과 같이 임시 사원총회를 개최하다.'],
  [0, 8, 0, '주주의 총수', '사원의 총수'],
  [0, 8, 4, '발행주식의 총수', '출자좌수의 총수'],
  [0, 8, 10, '주', '좌'],
  [0, 9, 0, '의결권 있는 주주의 수', '의결권 있는 사원의 수'],
  [0, 9, 4, '의결권 있는 주식 수', '의결권 있는 출자좌수'],
  [0, 9, 10, '주', '좌'],
  [0, 10, 0, '출석 주주의 수', '출석 사원의 수'],
  [0, 10, 4, '출석 주식 수', '출석 출자좌수'],
  [0, 10, 10, '주', '좌'],
  [0, 11, 0, '의장 {{ceoName}}은(는) 정관 규정에 따라 이 회의 진행을 위하여 의장석에 등단하여 위와 같이 법정수에 달하는 주주가 출석하였으므로 본 주주총회가 적법하게 성립되었음을 알리고 개회를 선언한 후 안건 심의에 들어가다.', '의장 {{ceoName}}은(는) 정관 규정에 따라 이 회의 진행을 위하여 의장석에 등단하여 위와 같이 법정수에 달하는 사원이 출석하였으므로 본 사원총회가 적법하게 성립되었음을 알리고 개회를 선언한 후 안건 심의에 들어가다.'],
  [1, 2, 0, '{{matterBody}}', MIN_AGENDA],
  [1, 10, 3, '사내이사', '이사'],
  [1, 12, 3, '사내이사', '이사'],
];
/** 이사과반수동의서 — 이사회 의사록에서 남길 행 · 바꿀 글자. 지우는 행: 일시 · 장소 · 출석 현황 · 의장 문장 · 폐회 문장 · 서명 3줄. */
const CON_EDITS = [
  [0, 0, '이 사 회 의 사 록', '이 사 과 반 수 동 의 서'],
  [1, 0, '본 회사는 다음과 같이 이사회를 개최하다', '본 회사의 이사는 다음 사항에 동의한다'],
  [11, 0, '부의안건 및 결의사항', '동의 사항'],
  [13, 0, '{{matterBody}}', '1. 본점 이전 장소 : {{newHqAddress}}\n2. 본점 이전 일자 : {{relocationDate}}'],
  [15, 0, '위 의사의 안건, 경과요령, 그 결과를 명백히 하기 위해 이 의사록을 작성하고\n출석 이사 및 감사가 기명날인 또는 서명하다.', '위 사항에 대하여 이사 과반수가 동의하였음을 증명하기 위하여 이 동의서를 작성하고\n이사가 기명날인 또는 서명한다.'],
  [18, 3, '의장 대표이사', '대표이사'],
  [20, 4, '사내이사', '이사'],
];
const CON_DROP = [3, 4, 5, 6, 7, 8, 9, 10, 14, 21, 22, 23, 24, 25, 26];

// =============================================================================
// 시험 건 — 유한회사 · 타관할 본점이전 · 긴 상호 · 긴 주소(사원 · 이사 수는 법인변경 자료에 없어 값이 같다)
// =============================================================================
const ADDR = { zipCode: '13494', address: '경기 성남시 분당구 판교역로 235', addressDetail: '에이치스퀘어 엔동 7층 701호 (삼평동, 판교테크노밸리)' };
const OLD = { zipCode: '06164', address: '서울 강남구 테헤란로 123', addressDetail: '4층 401호 (역삼동, 에스원비즈빌딩)' };
function sampleValues(settingRows) {
  const snapshot = {
    version: 3, changeType: 'HQ_OUT',
    company: { isTenant: false, name: '유한회사 가나다라마바사아자차카타파하글로벌', corpNumber: '110114-1234567', bizNumber: '123-45-67890', ceoName: '남궁가나다', tel: '02-1234-5678', memberType: 'A', head: OLD, ceoHome: OLD },
    payload: { newHqAddress: ADDR, resolutionDate: '2026-12-01', relocationDate: '2026-12-15' },
    officers: [],
  };
  return buildCasePrintValues({ snapshot, setting: pickDocFormSetting(settingRows, 'HQ_OUT', 'A'), changeTypeName: '타관할로의 본점이전', inputs: { applyDate: '2026-12-20', writeDate: '2026-12-20' } });
}

// =============================================================================
// 재기 — FormDocument 와 같은 칸, 장 안쪽 맨 위에서 행 끝(cm)
// =============================================================================
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fillText = (t, values) => t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => values[String(k).trim()] ?? '');
function pageHtml(id, page, values, font) {
  const covered = new Set();
  for (const c of page.cells) for (let a = 0; a < (c.rowSpan ?? 1); a++) for (let b = 0; b < (c.colSpan ?? 1); b++) if (a || b) covered.add(`${c.row + a},${c.col + b}`);
  const at = new Map(page.cells.map((c) => [`${c.row},${c.col}`, c]));
  const edge = (on) => (on === false ? 'none' : '1px solid #000');
  const trs = page.rowHeights.map((h, r) => `<tr style="height:${h}cm">${page.colWidths.map((_, c) => {
    if (covered.has(`${r},${c}`)) return '';
    const x = at.get(`${r},${c}`);
    const b = x?.border;
    return `<td colspan="${x?.colSpan ?? 1}" rowspan="${x?.rowSpan ?? 1}" style="text-align:${x?.align ?? 'left'};vertical-align:${x?.valign ?? 'middle'};font-size:${x?.fontSize ?? font.size}pt;font-weight:${x?.bold ? 700 : 400};border-top:${edge(b?.top)};border-right:${edge(b?.right)};border-bottom:${edge(b?.bottom)};border-left:${edge(b?.left)}">${x?.text ? esc(fillText(x.text, values)) : ''}</td>`;
  }).join('')}</tr>`).join('');
  const w = page.colWidths.reduce((a, b) => a + b, 0);
  return `<section data-id="${id}" class="page"><table style="width:${w}cm;margin-top:${page.marginTop ?? DEFAULT_MARGIN_TOP}cm;font-family:'${font.family}'"><colgroup>${page.colWidths.map((cw) => `<col style="width:${cw}cm">`).join('')}</colgroup><tbody>${trs}</tbody></table></section>`;
}
function measure(items) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0} .page{width:210mm;box-sizing:border-box;padding:12mm 0;display:flex;flex-direction:column;align-items:center;margin-bottom:20px}
table{border-collapse:collapse;table-layout:fixed} td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5}
</style></head><body>${items.map((t) => pageHtml(t.id, t.page, t.values, t.font)).join('')}<script>
const cm=(p)=>p*2.54/96; const out={};
document.querySelectorAll('section').forEach((s)=>{const t0=s.getBoundingClientRect().top+parseFloat(getComputedStyle(s).paddingTop);
 out[s.dataset.id]=[...s.querySelectorAll('tr')].map((tr)=>[+cm(tr.getBoundingClientRect().height).toFixed(3), +cm(tr.getBoundingClientRect().bottom-t0).toFixed(3)]);});
document.body.setAttribute('data-out',encodeURIComponent(JSON.stringify(out)));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltd-hq-out-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=5000', '--dump-dom', 'file:///' + file.split(path.sep).join('/')], { maxBuffer: 1 << 28, timeout: 180000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return JSON.parse(decodeURIComponent(m[1]));
}
const roundUp = (h) => Math.ceil(h * 100 - 1e-9) / 100;

// =============================================================================
// 정의 손보기
// =============================================================================
function cellAt(page, row, col) {
  const c = page.cells.find((x) => x.row === row && x.col === col);
  if (!c) throw new Error(`칸 r${row} c${col} 이 없다`);
  return c;
}
function setText(page, row, col, from, to, where) {
  const c = cellAt(page, row, col);
  if (c.text !== from) throw new Error(`${where} r${row} c${col} 글자가 ${JSON.stringify(c.text)} 다(${JSON.stringify(from)} 여야 한다)`);
  c.text = to;
}
/** 행 지우기(여럿) — 아래 행부터. 그 행을 걸치는 칸이 있으면 멈춘다. */
function dropRows(page, rows, where) {
  for (const row of [...rows].sort((a, b) => b - a)) {
    if (page.cells.some((c) => c.row < row && c.row + (c.rowSpan ?? 1) - 1 >= row)) throw new Error(`${where} r${row} 을 걸치는 칸이 있다`);
    page.cells = page.cells.filter((c) => c.row !== row).map((c) => (c.row > row ? { ...c, row: c.row - 1 } : c));
    page.rowHeights.splice(row, 1);
  }
}
const style = (c) => { const { row: _r, col: _c, text: _t, ...s } = c; return clone(s); };

/** 신청서 1장 — 설립 신청서 1장의 머리 행(r0~r5)을 두고, 그 아래를 원본 행으로 다시 짠다. 바꾼 행 번호를 돌려준다. */
function buildAppPage1(src) {
  const p = clone(src);
  const label = style(cellAt(p, 9, 0));
  const value = style(cellAt(p, 9, 1));
  const purpose = p.cells.filter((c) => c.row === 6).map(clone);
  const reason = p.cells.filter((c) => c.row === 7).map(clone);
  const head = p.cells.filter((c) => c.row === 8).map(clone);
  const hBase = p.rowHeights[9];
  setText(p, 2, 3, '유한회사 설립 등기신청', '유한회사 본점이전(관할외) 등기신청', '신청서 1장');
  if (cellAt(p, 0, 0).text !== '{{formNo}} {{formLabel}}') throw new Error('신청서 1장 맨 위 칸이 {{formNo}} {{formLabel}} 이 아니다');
  const keep = p.cells.filter((c) => c.row <= 5);
  const heights = p.rowHeights.slice(0, 6);
  const rows = [];
  const two = (l, v, h = hBase) => rows.push({ h, cells: [{ col: 0, ...label, text: l }, { col: 1, ...value, text: v }] });
  rows.push({ h: hBase, cells: [{ col: 0, ...label, text: '상        호' }, { col: 1, ...value, colSpan: 4, text: '{{companyName}}' }, { col: 5, ...label, text: '등기번호' }, { col: 6, ...value, colSpan: 2, text: '{{corpNumber}}' }] });
  two('본        점', '{{hqAddress}}');
  rows.push({ h: p.rowHeights[6], cells: purpose });
  rows.push({ h: p.rowHeights[7], cells: reason });
  rows.push({ h: p.rowHeights[8], cells: head });
  two('새  본  점', '{{newHqAddress}}');
  two('본점을 이전한 뜻과 그 연월일', '{{relocationDate}} 본점이전');
  // 결정 8 — 지배인 · 상호 동시 변경은 빈칸(값 칸에 글이 없다)
  rows.push({ h: hBase, cells: [{ col: 0, ...label, text: '지배인을 둔 장소를 이전한 뜻(본점에 지배인을 두고 있는 경우)' }, { col: 1, ...value }] });
  rows.push({ h: hBase, cells: [{ col: 0, ...label, text: '상호를 변경한 경우 변경 후의 상호와 변경 연월일' }, { col: 1, ...value }] });
  const changed = [];
  rows.forEach((r, i) => {
    const at = 6 + i;
    heights.push(r.h);
    for (const c of r.cells) keep.push({ ...c, row: at });
    changed.push(at);
  });
  p.cells = keep.sort((a, b) => a.row - b.row || a.col - b.col);
  p.rowHeights = heights;
  // 머리 행의 제목도 바꿨다
  changed.push(2);
  return { page: p, changed };
}
/** 신청서 2장 — 설립 신청서 3장에서 과세표준액 행 뺌 · 첨부서면 한 칸 · 신청인 본점 = 새 본점 · 작성요령 원본 두 항목. */
function buildAppPage2(src) {
  const p = clone(src);
  setText(p, 3, 0, '과 세 표 준 액', '과 세 표 준 액', '신청서 2장');
  setText(p, 5, 0, '{{attachments1}}', '{{attachments}}', '신청서 2장');
  setText(p, 5, 4, '{{attachments2}}', '<기 타>', '신청서 2장');
  setText(p, 8, 0, '             본  점  {{hqAddress}}', '             본  점  {{newHqAddress}}', '신청서 2장');
  const tips = cellAt(p, 20, 0);
  if (!SEAL_ITEM.test(tips.text ?? '')) throw new Error('신청서 2장 작성요령에 「인감증명법」 항목이 없다');
  tips.text = tips.text.replace(SEAL_ITEM, '');
  dropRows(p, [3], '신청서 2장');
  // 지운 뒤 번호: 첨부서면 r4 · 신청인 본점 r7 · 작성요령 r19
  return { page: p, changed: [4, 7, 19] };
}

/** 바꾼 행만 재서 모자라면 늘린다(그대로 둔 행은 원래 높이). */
function growChanged(def, changedByPage, values) {
  const got = measure(def.pages.map((p, i) => ({ id: `p${i}`, page: p, values, font: def.font })));
  const grown = [];
  def.pages.forEach((p, i) => {
    for (const r of changedByPage[i] ?? []) {
      const need = roundUp(got[`p${i}`][r][0]);
      if (need > p.rowHeights[r] + 0.005) { grown.push(`${i + 1}장 r${r} ${fmt(p.rowHeights[r])} → ${fmt(need)}`); p.rowHeights[r] = need; }
    }
  });
  return grown;
}
const rowText = (page, r) => page.cells.filter((c) => c.row === r && c.text).map((c) => c.text).join(' ').trim();
const lastTextRow = (page) => { for (let r = page.rowHeights.length - 1; r >= 0; r--) if (rowText(page, r)) return r; return -1; };

// =============================================================================
// 보기 · 쓰기
// =============================================================================
(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const problems = [];
    const one = async (name) => {
      const rows = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [name])).rows;
      if (rows.length !== 1) throw new Error(`「${name}」 양식이 ${rows.length}개다(1개여야 한다)`);
      return migrateDefinition(rows[0].definition);
    };
    const appSrc = await one(APP.from);
    const minSrc = await one(MIN.from);
    const conSrc = await one(CON.from);

    // 등기 설정 — 이번 줄을 얹은 모양으로 시험 값을 만든다(지금 줄은 읽기만)
    const settingRows = (await c.query(
      `SELECT reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes, attachments, reg_purpose, reg_reason, matter_body
         FROM public.tb_s080_doc_form_settings WHERE operator_id = 1 AND domain = 'corp-change'`,
    )).rows.map((r) => ({ regTypeKey: r.reg_type_key, companyType: r.company_type ?? '', isActive: r.is_active, label: r.label, formNo: r.form_no, matter: r.matter, taxMode: r.tax_mode, taxes: r.taxes, attachments: r.attachments, regPurpose: r.reg_purpose, regReason: r.reg_reason, matterBody: r.matter_body }));
    if (settingRows.some((r) => r.regTypeKey === SETTING.regTypeKey)) problems.push(`등기 설정 ${SETTING.regTypeKey} 줄이 이미 있다`);
    const planned = [...settingRows, { regTypeKey: SETTING.regTypeKey, companyType: SETTING.companyType, isActive: true, label: SETTING.label, formNo: SETTING.formNo, matter: null, taxMode: 'fixed', taxes: SETTING.taxes, attachments: SETTING.attachments, regPurpose: SETTING.regPurpose, regReason: SETTING.regReason, matterBody: null }];
    const values = sampleValues(planned);

    // 서식 1 — 신청서
    const p1 = buildAppPage1(appSrc.pages[0]);
    const p2 = buildAppPage2(appSrc.pages[2]);
    const appDef = { ...clone(appSrc), legal: MARK, pages: [p1.page, p2.page] };
    const appGrown = growChanged(appDef, [p1.changed, p2.changed], values);
    // 서식 2 — 사원총회 의사록(변경)
    const minDef = { ...clone(minSrc), legal: MARK };
    for (const [pi, r, col, from, to] of MIN_EDITS) setText(minDef.pages[pi], r, col, from, to, `「${MIN.from}」 ${pi + 1}장`);
    const minChanged = [[], []];
    for (const [pi, r] of MIN_EDITS) if (!minChanged[pi].includes(r)) minChanged[pi].push(r);
    const minGrown = growChanged(minDef, minChanged, values);
    // 서식 3 — 이사과반수동의서
    const conDef = { ...clone(conSrc), legal: MARK, pages: [clone(conSrc.pages[0])] };
    if (conSrc.pages.length !== 1) throw new Error(`「${CON.from}」 이 ${conSrc.pages.length}장이다(1장이어야 한다)`);
    for (const [r, col, from, to] of CON_EDITS) setText(conDef.pages[0], r, col, from, to, `「${CON.from}」`);
    const conChangedBefore = CON_EDITS.map(([r]) => r);
    dropRows(conDef.pages[0], CON_DROP, `「${CON.from}」`);
    const shift = (r) => r - CON_DROP.filter((d) => d < r).length;
    const conGrown = growChanged(conDef, [[...new Set(conChangedBefore.map(shift))]], values);

    const forms = [];
    for (const [meta, raw, grown] of [[APP, appDef, appGrown], [MIN, minDef, minGrown], [CON, conDef, conGrown]]) {
      const def = parseDefinition(raw);
      const mark = parseLegalMark(def.legal);
      if (!mark.ok) problems.push(`「${meta.name}」 법무 표시: ${mark.message}`);
      else if (!markAppliesTo(mark.value, 'HQ_OUT', 'A') || markAppliesTo(mark.value, 'HQ_OUT', 'R') || markAppliesTo(mark.value, 'HQ', 'A')) problems.push(`「${meta.name}」 법무 표시가 유한회사 타관할 건에만 뜨지 않는다`);
      const tokens = definitionTokens(def);
      def.manualFields = tokens.map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);
      const unknown = tokens.filter((t) => !LABELS[t]);
      if (unknown.length) problems.push(`「${meta.name}」 이름표 밖 자리표시 ${unknown.join(',')}`);
      const all = def.pages.flatMap((p) => p.cells).map((x) => x.text ?? '').join('\n');
      for (const w of ['주주', '주식', '사내이사', '설립']) if (fillText(all, values).includes(w)) problems.push(`「${meta.name}」 에 「${w}」 이 남았다`);
      forms.push({ meta, def, grown, tokens });
    }

    // 장 높이 — 앱 인쇄 규칙
    const got = measure(forms.flatMap((f, fi) => f.def.pages.map((p, pi) => ({ id: `${fi}|${pi}`, page: p, values, font: f.def.font }))));
    for (const [fi, f] of forms.entries()) {
      console.log(`■ ${f.meta.name}  ← 표양식 「${f.meta.from}」 · ${f.def.font.family} ${f.def.font.size}pt · 법무 표시 ${JSON.stringify(f.def.legal)}`);
      f.def.pages.forEach((p, pi) => {
        const rows = got[`${fi}|${pi}`];
        const h = rows[rows.length - 1][1];
        const lt = lastTextRow(p);
        const fits = h <= PAGE_INNER_CM + 1e-9 && rows[lt][1] <= PAGE_INNER_CM + 1e-9;
        if (!fits) problems.push(`「${f.meta.name}」 ${pi + 1}장 넘침(${fmt(h)}cm)`);
        console.log(`  ${pi + 1}장 — 행 ${p.rowHeights.length}개 · ${fmt(h)} / ${fmt(PAGE_INNER_CM)}cm${fits ? '' : ' ★ 넘침'} · 마지막 줄 r${lt} 「${fillText(rowText(p, lt), values).replace(/\n/g, ' ').slice(0, 34)}」 끝 ${fmt(rows[lt][1])}cm`);
      });
      console.log(`  늘린 행: ${f.grown.length ? f.grown.join(' · ') : '없음'}`);
      console.log(`  자리표시 ${f.tokens.length}개: ${f.tokens.join(' · ')}`);
    }
    console.log('\n■ 신청서 1장 행(위에서부터)');
    forms[0].def.pages[0].rowHeights.forEach((h, r) => { const t = rowText(forms[0].def.pages[0], r); if (t) console.log(`  r${r} ${fmt(h)} | ${t.replace(/\n/g, '⏎').slice(0, 80)}`); });
    console.log('\n■ 사원총회 의사록(변경) 바꾼 글');
    for (const [pi, r, col, , to] of MIN_EDITS) console.log(`  ${pi + 1}장 r${r} c${col} → ${JSON.stringify(to.length > 90 ? `${to.slice(0, 90)}…` : to)}`);
    console.log('\n■ 이사과반수동의서 남은 행');
    forms[2].def.pages[0].rowHeights.forEach((h, r) => { const t = rowText(forms[2].def.pages[0], r); if (t) console.log(`  r${r} ${fmt(h)} | ${t.replace(/\n/g, '⏎')}`); });

    console.log('\n■ 시험 값(유한회사 · 타관할 · 긴 상호 · 긴 주소)');
    for (const k of ['formNo', 'formLabel', 'regPurpose', 'regReason', 'newHqAddress', 'relocationDate', 'regLicenseTax', 'localEduTax', 'taxTotal', 'regFee']) console.log(`  ${k}: ${JSON.stringify(values[k])}`);
    console.log(`  attachments: ${JSON.stringify(values.attachments)}`);

    // 코드 · 설정 · 이름 — 이미 있으면 멈춘다
    const { rows: [have] } = await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_code_masters WHERE category = $1)::int AS m,
              (SELECT count(*) FROM public.tb_s080_code_categories WHERE category = $1 AND use_tp = $2)::int AS p,
              (SELECT count(*) FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2 AND code = $3)::int AS l,
              (SELECT count(*) FROM public.tb_s080_codes_line WHERE line_id = $4)::int AS id,
              (SELECT coalesce(max(sort_order), 0) FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2)::int AS max_sort`,
      [CODE.category, CODE.useTp, CODE.code, `cl_${CODE.buildId}_${CODE.category}_${CODE.code}`],
    );
    if (have.m !== 1 || have.p !== 1) problems.push(`분류 ${CODE.category} 머리 ${have.m} · 파티션 ${have.p}(1건씩이어야 한다)`);
    if (have.l || have.id) problems.push(`코드 ${CODE.category}/${CODE.code} 가 이미 있다`);
    const sort = have.max_sort + 1;
    for (const f of forms) if ((await c.query(`SELECT 1 FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [f.meta.name])).rows.length) problems.push(`이미 있는 이름: ${f.meta.name}`);

    console.log(`\n■ 코드 줄 cl_${CODE.buildId}_${CODE.category}_${CODE.code} — ${sort}. ${CODE.code} = ${CODE.name}`);
    console.log(`■ 등기 설정 법인변경 ${SETTING.regTypeKey} · 회사유형 ${SETTING.companyType} — ${SETTING.label} · ${SETTING.formNo} · 목적 ${SETTING.regPurpose} · 세금 ${JSON.stringify(SETTING.taxes)} · 첨부 ${SETTING.attachments.length}개`);

    if (problems.length) throw new Error(problems.join(' / '));
    if (!APPLY) {
      console.log('\n보기만 했습니다 — 코드 1줄 · 등기 설정 1줄 · 양식 3건. 쓰려면 --apply');
      return;
    }
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO public.tb_s080_codes_line
         (line_id, build_id, category, use_tp, code, name, description, sort_order, is_active, is_system, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false, CURRENT_TIMESTAMP)`,
      [`cl_${CODE.buildId}_${CODE.category}_${CODE.code}`, CODE.buildId, CODE.category, CODE.useTp, CODE.code, CODE.name, CODE.description, sort],
    );
    await c.query(
      `INSERT INTO public.tb_s080_doc_form_settings
         (id, operator_id, domain, reg_type_key, company_type, label, form_no, matter, matter_body, reg_purpose, reg_reason,
          is_active, tax_mode, taxes, attachments, created_by, updated_by, updated_at)
       VALUES ($1, 1, 'corp-change', $2, $3, $4, $5, NULL, NULL, $6, $7, true, 'fixed', $8::jsonb, $9::jsonb, $10, $10, now())`,
      [randomUUID(), SETTING.regTypeKey, SETTING.companyType, SETTING.label, SETTING.formNo, SETTING.regPurpose, SETTING.regReason, JSON.stringify(SETTING.taxes), JSON.stringify(SETTING.attachments), BY],
    );
    for (const f of forms) {
      await c.query(
        `INSERT INTO public.tb_s080_form_templates
           (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
         VALUES ($1, 1, $2, $3, 'T', $4::jsonb, now(), now(), $5, $5)`,
        [randomUUID(), f.meta.name, `법인변경(유한회사 · 타관할로의 본점이전) — 표양식 「${f.meta.from}」 복사(2026-11-01)`, JSON.stringify(f.def), BY],
      );
    }
    await c.query('COMMIT');
    console.log('\n썼습니다 — 코드 1줄 · 등기 설정 1줄 · 양식 3건');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
