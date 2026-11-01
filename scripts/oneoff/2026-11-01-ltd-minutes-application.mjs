/**
 * 일회용(2026-11-01) — 유한회사 설립 2단계: 표양식 「사원총회의사록(유한회사)」 · 「설립등기신청서(유한회사)」 ·
 * 등기 설정 유한회사 설립(`U_P`) 줄 등록.
 *
 * 원본(대표가 넣은 docx, git 밖 `doc/forms-src/`): `사원총회의사록.docx` · `91(66).유한회사설립등기.docx`
 * (「유한책임회사」 파일은 쓰지 않는다).
 *
 * ★ 사원총회의사록(유한회사) — 글은 원본 그대로(사람 · 날짜 · 주소 자리만 자리표시), 칸 모양은 표양식
 *   「발기인총회의사록」의 칸(제목 · 본문 · 의안 제목 · 목록 · 날짜 · 서명 줄)을 읽어 쓴다. 열 폭 · 글꼴 · 위 여백도 그 양식.
 *   행 높이는 헤드리스 Chrome 으로 사원 2명(이사 둘 · 대표 둘, 긴 이름 · 주소) 값을 넣어 잰다(10-31 정관 스크립트와 같은 규칙).
 * ★ 설립등기신청서(유한회사) — 표양식 「설립등기신청서」를 **복사**해 원본과 다른 행만 바꾼다:
 *   1쪽 맨 위 「{{formNo}} {{formLabel}}」 · 제목 「유한회사 설립 등기신청」 · 공고방법 · 발행할 주식의 총수 · 발행주식의 총수
 *   행 뺌 · 「1 주 의 금 액」 → 「출자1좌의 금액」(`contributionUnitAmount`) · 「자본금총액」 → 「자본금의 총액」(금 n 원) ·
 *   2쪽 종류주식의 내용 행 뺌 · 대표이사 칸 → `representativeRrnList` · 「기 타」 괄호 설명 뺌. 3쪽(세금 · 첨부서면 · 신청인)은 그대로.
 *   행 높이는 지금 높이를 지키고, 잰 값이 더 크면 늘린다.
 * ★ 둘 다 법무 표시: 법인설립 · 건마다 · 회사 형태 유한회사(`companyType: 'A'`) — 유한회사 건의 [서류 출력]에만 뜬다.
 * ★ 결정 2026-11-01 반영 — 사유(공증 · 날짜 없음) · 의사록 의안 · 의장 · 직위 · 서명 · 첨부서면(`MINUTES_LINES` · `SETTING`).
 * ★ 등기 설정 U_P 줄(법인설립 · 기본 줄) — 양식호수 · 표시명 · 등기의 목적 · 첨부서면은 원본에서. 세금 다섯 칸은
 *   발기설립(R_PROMOTER) 기본 줄의 `taxes` 를 그대로 복사한다(원본 안내 ⑫: 1000분의 4 · 100분의 20 · 대도시 3배 — 같다).
 * ★ 주식회사 양식 · R_PROMOTER 줄은 읽기만 한다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 한 트랜잭션으로 쓴다. 멈추는 경우(아무것도 쓰지 않는다):
 *   원본 양식이 정확히 1건이 아님 · 지울 행 · 바꿀 칸 글자가 기대와 다름 · 새 양식 이름이나 U_P 줄이 이미 있음 ·
 *   U_P 코드가 없거나 꺼짐 · R_PROMOTER 세금이 다섯 칸이 아님 · 장 높이 넘침 · `parseDefinition` 실패 · 이름표 밖 자리표시.
 *   쓰는 표: `tb_s080_form_templates` 두 줄 · `tb_s080_doc_form_settings` 한 줄(넣기만).
 *
 *   npx tsx scripts/oneoff/2026-11-01-ltd-minutes-application.mjs <admin.env>              (보기)
 *   npx tsx scripts/oneoff/2026-11-01-ltd-minutes-application.mjs <admin.env> --apply      (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseDefinition, definitionTokens } from '../../packages/shared/src/domain/form-template.ts';
import { INCORP_PRINT_FIELDS, buildIncorpCasePrintValues } from '../../packages/shared/src/domain/incorporation-print.ts';
import { buildIncorporationSnapshot, parseIncorpInfo } from '../../packages/shared/src/domain/incorporation-detail.ts';
import { INCORP_LTD_MEMBER_MAX, INCORP_PURPOSE_MAX } from '../../packages/shared/src/domain/incorporation.ts';
import { readIncorpTaxSetting } from '../../packages/shared/src/domain/incorporation-tax.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-01-ltd-minutes-application.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MARK = { domain: 'incorporation', unit: 'case', companyType: 'A' };
const MINUTES_FROM = '발기인총회의사록';
const MINUTES_NAME = '사원총회의사록(유한회사)';
const APP_FROM = '설립등기신청서';
const APP_NAME = '설립등기신청서(유한회사)';
/** 종이 안쪽 높이(cm) — A4 29.7 에서 위아래 12mm(10-12 · 10-31 스크립트와 같다). */
const PAGE_INNER_CM = 29.7 - 1.2 * 2;
const LABELS = Object.fromEntries(INCORP_PRINT_FIELDS.map((f) => [f.name, f.label]));
const clone = (x) => JSON.parse(JSON.stringify(x));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => n.toFixed(2);

// =============================================================================
// 등기 설정 U_P 줄 — 원본 「[양식 제91호] 유한회사 설립 등기」 · 작성요령 ① ② · 첨부서면 목록
// =============================================================================
const SETTING = {
  regTypeKey: 'U_P',
  label: '유한회사 설립 등기',
  formNo: '[양식 제91호]',
  regPurpose: '유한회사 설립',
  // 결정 2026-11-01 1 — 공증 · 날짜 없이
  regReason: '정관을 작성하고 출자 전액을 납입하였으므로 다음 사항의 등기를 구함',
  // 원본 첨부서면 11개에서 현물출자재산인도증 · 이사과반수동의서를 뺀 9개(결정 7, 순서 그대로).
  // 통수는 원본이 비어 있다 — 발기설립 줄과 같이 1통
  attachments: [
    '정관(자본금 10억 이상일 경우 공증받은 것)',
    '사원총회의사록(공증받은 것)',
    '출자금납입증명서',
    '취임승낙서(인감증명서나 본인서명사실확인서 또는 전자본인서명확인서의 발급증 포함)',
    '주민등록표등(초)본',
    '대표이사 인감신고서',
    '등록면허세영수필확인서',
    '등기신청수수료영수필확인서',
    '위임장(대리인이 신청할 경우)',
  ].map((name) => ({ name, copies: 1 })),
  sortOrder: 2,
};

// =============================================================================
// 시험 값 — 사원 1명 · 2명(긴 이름 · 주소, 2명은 둘 다 이사 · 대표이사 — 칸이 가장 길어지는 경우)
// =============================================================================
const PURPOSE_SAMPLES = ['소프트웨어 개발 및 공급업', '전자상거래 소매업(통신판매업)', '경영 컨설팅업', '정보통신 관련 연구개발 및 기술용역업', '광고 대행업 및 광고물 제작업', '부동산 임대업', '교육 서비스업(온라인 강의 포함)', '수출입업 및 무역 대행업', '데이터베이스 구축 및 온라인 정보 제공업', '인공지능 관련 소프트웨어 개발업'];
const ADDR = { zipCode: '06164', address: '서울 강남구 테헤란로 123', addressDetail: '4층 401호 (역삼동, 에스원비즈빌딩)' };
function sampleValues(memberCount, setting, taxSetting) {
  const info = parseIncorpInfo({
    nameKo: '유한회사 가나다라마바사아자차카타', nameEn: 'Ganadara Global Solutions', hq: ADDR,
    capitalAmount: 999_990_000, parValue: 10_000, fiscalStart: '01-01', fiscalEnd: '12-31', plannedDate: '2026-12-31', meetingTime: '10:00',
    purposes: Array.from({ length: INCORP_PURPOSE_MAX }, (_, i) => PURPOSE_SAMPLES[i % PURPOSE_SAMPLES.length]).join('\n'),
  });
  if (!info.ok) throw new Error('표본 설립 정보가 틀렸다');
  const P = (name, units) => ({ name, isFounder: true, isDirector: true, isAuditor: false, isRepresentative: true, unitsSubscribed: units, appointmentDate: '2026-12-31', ...ADDR, rrn: '9001011234567' });
  const all = [P('남궁가나다', 50_000), P('선우라마바', 49_999)];
  const persons = memberCount === 1 ? [{ ...all[0], unitsSubscribed: 99_999 }] : all.slice(0, INCORP_LTD_MEMBER_MAX);
  const snapshot = buildIncorporationSnapshot(info.value, persons.map((p, i) => ({ ...p, id: `p${i}`, rrnMasked: null, sortOrder: i + 1 })), 'A');
  return buildIncorpCasePrintValues({ snapshot, persons, setting, taxSetting, methodName: '유한회사 발기설립', inputs: { applyDate: '2026-12-31', writeDate: '2026-12-31' } });
}
const fill = (t, values) => t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);

// =============================================================================
// 재기 — 10-31 정관 스크립트와 같은 규칙(행 높이 0 으로 그려 글자가 차지하는 높이만 읽는다)
// =============================================================================
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function pageHtml(id, page, values, fontSize, family) {
  const n = page.colWidths.length;
  const covered = new Set();
  const at = new Map(page.cells.map((c) => [`${c.row}:${c.col}`, c]));
  const trs = page.rowHeights.map((_, ri) => {
    const tds = [];
    for (let ci = 0; ci < n; ci++) {
      if (covered.has(`${ri}:${ci}`)) continue;
      const c = at.get(`${ri}:${ci}`);
      if (!c) { tds.push('<td style="border:0"></td>'); continue; }
      const span = c.colSpan ?? 1;
      const rs = c.rowSpan ?? 1;
      for (let a = 0; a < rs; a++) for (let b = 0; b < span; b++) if (a || b) covered.add(`${ri + a}:${ci + b}`);
      const bd = c.border ?? {};
      const side = (k) => (bd[k] === false ? '0' : '1px solid #000');
      // 여러 행을 덮는 칸은 재지 않는다(높이를 한 행에 몰지 않게) — 글 없는 칸으로 그린다
      const text = rs > 1 ? '' : fill(c.text ?? '', values);
      tds.push(`<td colspan="${span}" rowspan="${rs}" style="border-top:${side('top')};border-right:${side('right')};border-bottom:${side('bottom')};border-left:${side('left')};text-align:${c.align ?? 'left'};vertical-align:${c.valign ?? 'middle'};font-size:${c.fontSize ?? fontSize}pt;font-weight:${c.bold ? 700 : 400}">${esc(text)}</td>`);
      ci += span - 1;
    }
    return `<tr style="height:0">${tds.join('')}</tr>`;
  });
  return `<table data-id="${id}" style="width:${sum(page.colWidths)}cm;font-family:'${family}'"><colgroup>${page.colWidths.map((w) => `<col style="width:${w}cm">`).join('')}</colgroup><tbody>${trs.join('')}</tbody></table>`;
}
function measureAll(tables) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0} table{border-collapse:collapse;table-layout:fixed;margin-bottom:40px}
td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5}
</style></head><body>${tables.map((t) => pageHtml(t.id, t.page, t.values, t.fontSize, t.family)).join('')}<script>
const cm=(p)=>p*2.54/96; const out=[];
document.querySelectorAll('table').forEach((t)=>out.push(t.dataset.id+'='+[...t.querySelectorAll('tr')].map((tr)=>cm(tr.getBoundingClientRect().height).toFixed(3)).join(',')));
document.body.setAttribute('data-out',out.join(';'));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltd-minutes-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=3000', '--dump-dom', 'file:///' + file.split(path.sep).join('/')], { maxBuffer: 1 << 26, timeout: 90000 }).toString('utf8');
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return Object.fromEntries(m[1].split(';').map((s) => { const [id, list] = s.split('='); return [id, list.split(',').map(Number)]; }));
}
const roundUp = (h) => Math.ceil((h + 0.01) * 100 - 1e-9) / 100;

// =============================================================================
// 사원총회의사록(유한회사) — 원본 글 그대로 · 칸 모양은 발기인총회의사록
// =============================================================================
/**
 * 원본 docx 의 문단 순서. kind 는 발기인총회의사록의 어느 칸 모양을 쓰나. `gap` = 빈 줄(높이 cm).
 * 결정 2026-11-01: 2 「발기인대표 선임의 건」 삭제 · 번호 당김 · 「사원(발기인)」 → 「사원」 · 「발기인 만장일치」 → 「사원 전원 일치」 ·
 * 3 의장 = 첫 번째 사원(`chairName`) · 6 의장과 출석한 이사 기명날인(`directorSignList` — 원본 말미의 사원 줄 대신,
 * 맺음 문장도 「의장이」 → 「의장과 출석한 이사가」).
 */
const MINUTES_LINES = [
  { kind: 'title', text: '사 원 총 회 의 사 록' },
  { gap: 1 },
  { kind: 'body', text: '서기 {{meetingDate}} {{meetingTime}} 본 회사 본점 사무실에서 사원 전원이 모여 의안을 심의하기 위하여 사원총회를 개최하다.' },
  { kind: 'body', text: '사원의 호선으로 사원 {{chairName}} 은 의장으로 선출되다.' },
  { gap: 0.5 },
  { kind: 'agenda', text: '제1호 의안 : 임원 선임의 건' },
  { gap: 0.14 },
  { kind: 'body', text: '의장은 설립할 회사의 임원에 관한 의안을 내어 사원 전원 일치로 다음과 같이 임원을 선임하다' },
  { kind: 'list', text: '{{minutesOfficerRrnList}}' },
  { kind: 'body', text: '피선자는 즉석에서 취임을 승낙하다.' },
  { gap: 0.5 },
  { kind: 'agenda', text: '제2호 의안 : 본점 주소지 결정의 건' },
  { gap: 0.14 },
  { kind: 'body', text: '의장은 설립할 회사의 본점 주소지에 관한 의안을 내어 사원 전원 일치로 다음과 같이 본점주소지를 결정하다' },
  { kind: 'list', text: '본점주소지 : {{hqAddress}}' },
  { gap: 0.5 },
  { kind: 'body', text: '이상으로 회의의 목적인 의안 전부를 종료하였으므로 의장은 폐회를 선언하다' },
  { kind: 'body', text: '위 결의를 명확히 하기 위하여 이 의사록을 작성하고 의장과 출석한 이사가 다음에 기명날인하다.' },
  { gap: 1 },
  { kind: 'date', text: '{{writeDate}}' },
  { gap: 0.5 },
  { kind: 'sign', text: '                                 {{companyName}}' },
  { kind: 'sign', text: '                                 의장 : {{chairName}} (인)' },
  { gap: 0.5 },
  { kind: 'list', text: '{{directorSignList}}' },
];

/** 발기인총회의사록에서 칸 모양을 고른다 — 글자로 찾는다(행 번호에 기대지 않는다). */
function minutesStyles(def) {
  const cells = def.pages[0].cells;
  const by = (pred, what) => {
    const hit = cells.filter((c) => c.text && pred(c.text));
    if (hit.length !== 1) throw new Error(`「${MINUTES_FROM}」 의 ${what} 칸이 ${hit.length}개다(1개여야 한다)`);
    const { row: _r, col: _c, text: _t, ...style } = hit[0];
    return style;
  };
  return {
    title: by((t) => t.startsWith('발 기 인 총 회'), '제목'),
    body: by((t) => t.includes('정관을 낭독하고'), '본문'),
    agenda: by((t) => t.startsWith('제1호 의안'), '의안 제목'),
    list: by((t) => t.trim() === '{{representativeList}}', '목록'),
    date: by((t) => t.trim() === '{{writeDate}}', '날짜'),
    sign: by((t) => t.trim() === '{{companyName}}', '서명 줄'),
    blank: { border: { top: false, left: false, right: false, bottom: false } },
  };
}

function buildMinutes(def, values) {
  const S = minutesStyles(def);
  const page0 = def.pages[0];
  const cols = page0.colWidths;
  const n = cols.length;
  const cells = [];
  const heights = [];
  MINUTES_LINES.forEach((l, r) => {
    if (l.gap) {
      for (let c = 0; c < n; c++) cells.push({ row: r, col: c, ...clone(S.blank) });
      heights.push(l.gap);
      return;
    }
    const st = clone(S[l.kind]);
    cells.push({ row: r, col: 0, ...st, colSpan: n, text: l.text });
    heights.push(0.5); // 잰 뒤 바꾼다
  });
  const page = { colWidths: cols, rowHeights: heights, marginTop: page0.marginTop ?? 0, cells };
  return page;
}

// =============================================================================
// 설립등기신청서(유한회사) — 지금 신청서 복사 · 원본과 다른 행만
// =============================================================================
/** 행 지우기 — 그 행의 칸을 빼고 아래 행 번호를 당긴다. 그 행을 걸치는 칸이 있으면 멈춘다. */
function dropRow(page, row, expectLabel) {
  const label = page.cells.find((c) => c.row === row && c.col === 0)?.text;
  if (label !== expectLabel) throw new Error(`지울 행 r${row} 의 이름이 ${JSON.stringify(label)} 다(${JSON.stringify(expectLabel)} 여야 한다)`);
  if (page.cells.some((c) => c.row < row && c.row + (c.rowSpan ?? 1) - 1 >= row)) throw new Error(`r${row} 을 걸치는 칸이 있다`);
  page.cells = page.cells.filter((c) => c.row !== row).map((c) => (c.row > row ? { ...c, row: c.row - 1 } : c));
  page.rowHeights.splice(row, 1);
}
function setText(page, row, col, from, to) {
  const c = page.cells.find((x) => x.row === row && x.col === col);
  if (!c || c.text !== from) throw new Error(`r${row} c${col} 글자가 ${JSON.stringify(c?.text)} 다(${JSON.stringify(from)} 여야 한다)`);
  c.text = to;
  return { at: `r${row} c${col}`, from, to };
}

function buildApplication(src) {
  const def = clone(src);
  const changes = [];
  const [p1, p2] = def.pages;
  // 1쪽 — 지우기는 아래 행부터(번호가 당겨지기 전에)
  changes.push({ page: 1, ...setText(p1, 0, 0, '{{formNo}}{{ formLabel}}', '{{formNo}} {{formLabel}}') });
  changes.push({ page: 1, ...setText(p1, 2, 3, '주식회사 설립 등기신청', '유한회사 설립 등기신청') });
  changes.push({ page: 1, ...setText(p1, 15, 0, '자본금총액', '자본금의 총액') });
  changes.push({ page: 1, ...setText(p1, 15, 1, '{{capitalAmountKorean}} (금 {{capitalAmount}} 원)', '금 {{capitalAmount}} 원') });
  changes.push({ page: 1, ...setText(p1, 12, 0, '1 주 의 금 액', '출자1좌의 금액') });
  changes.push({ page: 1, ...setText(p1, 12, 1, '금 {{parValue}} 원', '금 {{contributionUnitAmount}} 원') });
  dropRow(p1, 14, '발행주식의 총수와 그 종류 및 각각의 수');
  dropRow(p1, 13, '발행할\n주식의 총수');
  dropRow(p1, 11, '공 고 방 법');
  changes.push({ page: 1, at: '행 뺌', from: '공고방법 · 발행할 주식의 총수 · 발행주식의 총수와 그 종류 및 각각의 수', to: '' });
  // 2쪽
  changes.push({ page: 2, ...setText(p2, 6, 0, '기        타\n(주식의 양도에 관하여 이사회의 승인을 얻도록 정한 때에는 그 규정, 명의개서대리인을 둔 때에는 그 상호와 본점소재지 등)', '기        타') });
  changes.push({ page: 2, ...setText(p2, 2, 1, '{{representativeList}}', '{{representativeRrnList}}') });
  dropRow(p2, 3, '종류주식의\n내용');
  changes.push({ page: 2, at: '행 뺌', from: '종류주식의 내용', to: '' });
  def.legal = MARK;
  return { def, changes };
}

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
      const d = rows[0].definition;
      if (d.legal?.domain !== 'incorporation' || d.legal?.unit !== 'case' || d.legal?.companyType) throw new Error(`「${name}」 이 법인설립 · 건마다 · 주식회사 양식이 아니다(${JSON.stringify(d.legal)})`);
      return d;
    };
    const minutesSrc = await one(MINUTES_FROM);
    const appSrc = await one(APP_FROM);

    // 등기 설정 — U_P 코드 · R_PROMOTER 세금
    const code = (await c.query(`SELECT name, is_active FROM public.tb_s080_codes_line WHERE category = 'LAW_EST_TP' AND use_tp = '000' AND code = 'U_P'`)).rows;
    if (code.length !== 1 || !code[0].is_active) throw new Error(`코드 LAW_EST_TP/U_P 가 없거나 꺼져 있다(${code.length}건)`);
    const promoter = (await c.query(`SELECT taxes, tax_mode FROM public.tb_s080_doc_form_settings WHERE operator_id = 1 AND domain = 'incorporation' AND reg_type_key = 'R_PROMOTER' AND company_type = '' AND is_active`)).rows;
    if (promoter.length !== 1) throw new Error(`발기설립(R_PROMOTER) 기본 줄이 ${promoter.length}건이다(1건이어야 한다)`);
    const taxSetting = readIncorpTaxSetting(promoter[0].taxes);
    if (!taxSetting) throw new Error('발기설립 줄의 세금이 다섯 칸이 아니다');
    const effective = { label: SETTING.label, formNo: SETTING.formNo, matter: null, matterBody: null, regPurpose: SETTING.regPurpose, regReason: SETTING.regReason, taxes: { regLicense: null, localEdu: null, regFee: null }, attachments: SETTING.attachments };

    const v1 = sampleValues(1, effective, taxSetting);
    const v2 = sampleValues(2, effective, taxSetting);

    // 의사록 — 사원 2명 값으로 재서 높이를 정한다
    const minutesPage = buildMinutes(minutesSrc, v2);
    const family = minutesSrc.font.family;
    const mm = measureAll([{ id: 'm', page: minutesPage, values: v2, fontSize: minutesSrc.font.size, family }]).m;
    const gapRows = new Set(MINUTES_LINES.map((l, i) => (l.gap ? i : -1)).filter((i) => i >= 0));
    minutesPage.rowHeights = minutesPage.rowHeights.map((h, i) => (gapRows.has(i) ? h : roundUp(mm[i])));
    const minutes = parseDefinition({ version: 2, font: minutesSrc.font, legal: MARK, pages: [minutesPage] });
    minutes.manualFields = definitionTokens(minutes).map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);

    // 신청서 — 복사 · 바꾸기 · 사원 2명 값으로 재서 모자라면 늘린다
    const { def: appDef, changes } = buildApplication(appSrc);
    const am = measureAll(appDef.pages.map((p, i) => ({ id: `a${i}`, page: p, values: v2, fontSize: appSrc.font.size, family: appSrc.font.family })));
    const grown = [];
    appDef.pages.forEach((p, i) => {
      p.rowHeights = p.rowHeights.map((h, r) => {
        const need = roundUp(am[`a${i}`][r]);
        if (need > h + 0.005) { grown.push(`${i + 1}쪽 r${r} ${fmt(h)} → ${fmt(need)}cm`); return need; }
        return h;
      });
    });
    const app = parseDefinition(appDef);
    app.manualFields = definitionTokens(app).map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);

    // 대조 · 장 높이
    const report = (name, def, values) => {
      const tokens = definitionTokens(def);
      const unknown = tokens.filter((t) => !LABELS[t]);
      if (unknown.length) problems.push(`${name}: 이름표 밖 자리표시 ${unknown.join(',')}`);
      for (const t of tokens) if (values[t] === undefined) problems.push(`${name}: 값 없는 자리표시 ${t}`);
      def.pages.forEach((p, pi) => {
        const h = sum(p.rowHeights) + (p.marginTop ?? 0);
        const fits = h <= PAGE_INNER_CM + 1e-9;
        if (!fits) problems.push(`${name} ${pi + 1}장: 높이 넘침(${fmt(h)}cm)`);
        console.log(`  ${pi + 1}장 — 행 ${p.rowHeights.length}개 · 높이 ${fmt(sum(p.rowHeights))} + 위 여백 ${p.marginTop ?? 0} = ${fmt(h)} / ${fmt(PAGE_INNER_CM)}cm${fits ? '' : ' ★ 넘침'}`);
      });
      console.log(`  자리표시 ${tokens.length}개: ${tokens.join(' · ')}`);
      console.log(`  법무 표시: ${JSON.stringify(def.legal)} · 글꼴 ${def.font.family} ${def.font.size}pt`);
    };
    // 사원 1명 값으로도 각 행이 정한 높이 안에 드는지(1명은 2명보다 짧아야 한다)
    const check1 = (name, def) => {
      const got = measureAll(def.pages.map((p, i) => ({ id: `c${i}`, page: p, values: v1, fontSize: def.font.size, family: def.font.family })));
      def.pages.forEach((p, i) => p.rowHeights.forEach((h, r) => { if (roundUp(got[`c${i}`][r]) > h + 0.005) problems.push(`${name} 사원 1명: ${i + 1}장 r${r} 넘침`); }));
    };

    console.log(`■ ${MINUTES_NAME} — 글: 원본 사원총회의사록.docx · 칸 모양: 표양식 「${MINUTES_FROM}」`);
    report(MINUTES_NAME, minutes, v2);
    // 결정 2 · 5 — 남으면 안 되는 말(글과 값 둘 다)
    const minutesText = minutes.pages.flatMap((p) => p.cells).map((x) => x.text ?? '').join('\n');
    for (const w of ['발기인', '사내이사', '만장일치']) if (fill(minutesText, v2).includes(w)) problems.push(`${MINUTES_NAME}: 「${w}」이 남았다`);
    check1(MINUTES_NAME, minutes);
    console.log(`\n■ ${APP_NAME} — 표양식 「${APP_FROM}」 복사 · 원본 91(66).유한회사설립등기.docx 와 다른 행만`);
    for (const ch of changes) console.log(`  ${ch.page}쪽 ${ch.at}: ${JSON.stringify(ch.from)} → ${JSON.stringify(ch.to)}`);
    console.log(`  늘린 행: ${grown.length ? grown.join(' · ') : '없음'}`);
    report(APP_NAME, app, v2);
    check1(APP_NAME, app);

    console.log(`\n■ 등기 설정 — 법인설립 · ${SETTING.regTypeKey}(${code[0].name}) 기본 줄`);
    console.log(`  표시명 ${JSON.stringify(SETTING.label)} · 양식호수 ${JSON.stringify(SETTING.formNo)} · 등기의 목적 ${JSON.stringify(SETTING.regPurpose)}`);
    console.log(`  등기의 사유 ${JSON.stringify(SETTING.regReason)}`);
    console.log(`  첨부서면 ${SETTING.attachments.length}개(각 1통): ${SETTING.attachments.map((a) => a.name).join(' / ')}`);
    console.log(`  세금(발기설립 줄 복사): ${JSON.stringify(taxSetting)} · tax_mode computed · 순서 ${SETTING.sortOrder}`);

    console.log('\n■ 시험 값으로 그린 값(사원 1명 / 2명, 자본금 999,990,000 · 서울 중과)');
    for (const [k, v] of [['1명', v1], ['2명', v2]]) {
      console.log(`  [${k}] 세금: 등록면허세 ${v.regLicenseTax} · 지방교육세 ${v.localEduTax} · 합계 ${v.taxTotal} · 수수료 ${v.regFee}`);
      console.log(`  [${k}] 맨 위 줄: ${fill('{{formNo}} {{formLabel}}', v)} · 출자1좌 ${v.contributionUnitAmount} · 자본금 ${v.capitalAmount}`);
      console.log(`  [${k}] 대표이사 칸: ${JSON.stringify(v.representativeRrnList.replace(/\d{6}-\d{7}/g, '######-#######'))}`);
      console.log(`  [${k}] 의사록 임원: ${JSON.stringify(v.minutesOfficerRrnList.replace(/\d{6}-\d{7}/g, '######-#######'))}`);
      console.log(`  [${k}] 의장: ${v.chairName} · 이사 기명날인: ${JSON.stringify(v.directorSignList)}`);
    }

    await c.query('BEGIN');
    for (const n of [MINUTES_NAME, APP_NAME]) {
      if ((await c.query(`SELECT 1 FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [n])).rows.length) problems.push(`이미 있는 이름: ${n}`);
    }
    if ((await c.query(`SELECT 1 FROM public.tb_s080_doc_form_settings WHERE operator_id = 1 AND domain = 'incorporation' AND reg_type_key = 'U_P'`)).rows.length) problems.push('등기 설정 U_P 줄이 이미 있다');
    if (problems.length) throw new Error(problems.join(' / '));
    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 양식 2건 · 등기 설정 1줄. 쓰려면 --apply');
      return;
    }
    const by = 'oneoff-2026-11-01';
    for (const [n, def, desc] of [
      [MINUTES_NAME, minutes, '법인설립(유한회사) — 원본 사원총회의사록.docx · 칸 모양은 표양식 「발기인총회의사록」(2026-11-01)'],
      [APP_NAME, app, '법인설립(유한회사) — 표양식 「설립등기신청서」 복사 · 원본 91(66).유한회사설립등기.docx 와 다른 행만(2026-11-01)'],
    ]) {
      await c.query(
        `INSERT INTO public.tb_s080_form_templates
           (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
         VALUES ($1, 1, $2, $3, 'T', $4::jsonb, now(), now(), $5, $5)`,
        [randomUUID(), n, desc, JSON.stringify(def), by],
      );
    }
    await c.query(
      `INSERT INTO public.tb_s080_doc_form_settings
         (id, operator_id, domain, reg_type_key, company_type, label, form_no, matter, matter_body, reg_purpose, reg_reason,
          is_active, tax_mode, taxes, attachments, sort_order, created_by, updated_by, updated_at)
       VALUES ($1, 1, 'incorporation', $2, '', $3, $4, NULL, NULL, $5, $6, true, 'computed', $7::jsonb, $8::jsonb, $9, $10, $10, now())`,
      [randomUUID(), SETTING.regTypeKey, SETTING.label, SETTING.formNo, SETTING.regPurpose, SETTING.regReason, JSON.stringify(taxSetting), JSON.stringify(SETTING.attachments), SETTING.sortOrder, by],
    );
    await c.query('COMMIT');
    console.log('\n썼습니다 — 양식 2건 · 등기 설정 1줄');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
