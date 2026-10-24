/**
 * 일회용(2026-10-11) — `doc/forms-src/` 의 워드 문서를 **법무 표양식 초안**으로 등록한다.
 *
 * 들어 있는 문서 7개:
 *   · 사임서 — 손으로 옮겼다(2026-10-11 등록함, `registered`). 기본 선택에서 빠진다
 *   · 이사회 의사록 · 주주 서면결의서 · 주주명부 · 주주총회 의사록 · 취임승낙서 · 표준위임장(2026-10-11 등록함) — 워드를
 *     `…docx.mjs` 로 옮긴 뒤 문서마다 `edits`(샘플 값 → 자리표시 · 빈칸, 결정 2026-10-11)를 건다.
 *     edit 하나는 **정확히 한 칸**에 맞아야 한다(0칸 · 2칸 이상이면 멈춘다 — 원문이 바뀌면 조용히 지나가지 않게)
 *
 * ★ 기본은 **보기만** 한다 — 장 · 행 · 칸 · 자리표시 · 법무 표시 · 쪽 높이를 찍는다. `--apply` 일 때만
 *   한 트랜잭션으로 쓴다. `--only=사임서,…` 로 고를 수 있다. `--dump=파일` 은 정의를 JSON 으로 남긴다
 *   (헤드리스 브라우저로 실제 높이를 잴 때).
 * ★ 같은 이름의 양식이 하나라도 있으면 **아무것도 쓰지 않고 멈춘다**(두 번 돌려도 안전).
 * ★ 정의는 shared `parseDefinition` 을 통과해야 한다(표양식 화면 · 서버와 같은 검사).
 * ★ 문구는 원문 그대로다. 바꾼 곳은 샘플 값뿐이다(OOO 주식회사 · 샘플 날짜 · 샘플 직위 → 자리표시,
 *   사유 예시 글 → 빈칸) — 문서마다 `changes` 에 적었다.
 * ★ 원문이 1장이면 1장 — 행 높이 합 + 위 여백이 종이 안쪽 높이(29.7 − 위아래 1.2)를 넘으면 멈춘다.
 *   넘치는 문서는 줄인다(사용자 지시 순서: 행 높이 · 문단 앞 간격 → 빈 줄 → 글자 크기 최소 9.5pt, `fitOnePage`).
 *
 *   npx tsx scripts/oneoff/2026-10-11-legal-form-drafts.mjs .env              (보기)
 *   npx tsx scripts/oneoff/2026-10-11-legal-form-drafts.mjs .env --apply      (쓰기)
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseDefinition, definitionTokens, DEFAULT_MARGIN_TOP } from '../../packages/shared/src/domain/form-template.ts';
import { CORP_CHANGE_PRINT_FIELDS } from '../../packages/shared/src/domain/corp-change-print.ts';
import { convertDocx, fitOnePage, toPage } from './2026-10-11-legal-form-drafts.docx.mjs';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const dumpPath = (process.argv.find((a) => a.startsWith('--dump=')) ?? '').slice(7);
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-10-11-legal-form-drafts.mjs <.env> [--apply] [--only=이름,…]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

/** 종이 안쪽 높이(cm) — A4 29.7 에서 `form-doc.module.css` 의 위아래 12mm 를 뺀다. */
const PAGE_INNER_CM = 29.7 - 1.2 * 2;
/** 원문 1.8cm 좌우 여백 → 본문 폭 17.35cm. 표는 가운데 놓인다. */
const NO = { top: false, right: false, bottom: false, left: false };
const LABELS = Object.fromEntries(CORP_CHANGE_PRINT_FIELDS.map((f) => [f.name, f.label]));

/** 테두리 없는 한 줄(모든 열을 덮는다). 빈 줄이면 text 없이. */
const line = (row, cols, text, extra = {}) => ({ row, col: 0, colSpan: cols, border: NO, ...(text ? { text } : {}), ...extra });

// =============================================================================
// 사임서 — 원문 1장. 열은 세 표의 경계를 합친 6열(3.39 · 9.07 · 1.83 · 0.85 · 0.94 · 1.27 = 17.35)
// =============================================================================
const SAIMSEO = (() => {
  const C = 6;
  const label = (row, text, top) => ({
    row, col: 0, text, align: 'center', valign: 'middle', bold: true,
    border: { top, right: true, bottom: true, left: false },
  });
  const value = (row, text, top, extra = {}) => ({
    row, col: 1, colSpan: C - 1, ...(text ? { text } : {}), align: 'left', valign: 'middle',
    border: { top, right: false, bottom: true, left: false }, ...extra,
  });
  // 행 높이(cm) — 원문 문단의 앞 간격 + 「정확히」 줄 간격, 표 행은 원문 행 높이(twip ÷ 567)
  const rowHeights = [
    1.28, // 0 제목
    0.89, // 1 빈 줄
    1.23, // 2 성명
    1.22, // 3 주민등록번호
    1.22, // 4 주소
    1.22, // 5 직위
    2.38, // 6 본문 문장(앞 간격 0.85 + 두 줄)
    1.16, // 7 「사임 사유」(앞 간격 0.61 + 한 줄)
    0.33, // 8 빈 줄
    1.91, // 9 사유 칸(손으로 쓴다)
    4.11, // 10 날짜(앞 간격 3.39 + 한 줄)
    3.15, // 11 빈 줄
    0.64, // 12 사임인 : (인)
    1.27, // 13 빈 줄
    1.01, // 14 귀중
  ];
  const cells = [
    line(0, C, '사 임 서', { align: 'center', valign: 'middle', fontSize: 24, bold: true }),
    line(1, C),
    label(2, '성 명', true), value(2, '{{officerName}}', true),
    label(3, '주민등록번호', false), value(3, '{{officerRrn}}', false),
    label(4, '주 소', false), value(4, '{{officerAddress}}', false),
    label(5, '직 위', false), value(5, '{{officerPosition}}', false, { bold: true }),
    line(6, C, '본인은 {{companyName}}의 {{officerPosition}} 직을 아래 사유로 {{officerEffectiveDate}}자로 사임하고자 하오니 처리하여 주시기 바랍니다.', { align: 'left', valign: 'bottom' }),
    line(7, C, '사임 사유', { align: 'left', valign: 'bottom', bold: true }),
    line(8, C),
    { row: 9, col: 0, colSpan: C, align: 'left', valign: 'top', border: { top: true, right: false, bottom: true, left: false } },
    line(10, C, '{{writeDate}}', { align: 'center', valign: 'bottom', fontSize: 13.5, bold: true }),
    line(11, C),
    { row: 12, col: 0, colSpan: 2, border: NO },
    { row: 12, col: 2, text: '사임인 :', align: 'left', valign: 'middle', fontSize: 12, border: NO },
    { row: 12, col: 3, border: NO },
    { row: 12, col: 4, text: '(인)', align: 'left', valign: 'middle', fontSize: 12, border: NO },
    { row: 12, col: 5, border: NO },
    line(13, C),
    line(14, C, '{{companyName}} 귀중', { align: 'center', valign: 'top', bold: true, border: { top: true, right: false, bottom: false, left: false } }),
  ];
  return {
    name: '사임서',
    registered: '2026-10-11',
    kind: 'T',
    description: '법인변경 임원 사임 — doc/forms-src/사임서.docx 초안(2026-10-11)',
    sourcePages: 1,
    definition: {
      version: 2,
      font: { family: '바탕', size: 10.5 },
      legal: { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['RESIGN'] },
      pages: [{ colWidths: [3.39, 9.07, 1.83, 0.85, 0.94, 1.27], rowHeights, marginTop: 0.8, cells }],
    },
    changes: [
      ['성 명 값 칸', '(빈칸)', '{{officerName}}'],
      ['주민등록번호 값 칸', '(빈칸)', '{{officerRrn}}'],
      ['주 소 값 칸', '(빈칸)', '{{officerAddress}}'],
      ['직 위 값 칸', '대표이사', '{{officerPosition}}'],
      ['문장 속 회사명', 'OOO 주식회사', '{{companyName}}'],
      ['문장 속 직위', '대표이사', '{{officerPosition}}'],
      ['문장 속 날짜', '2026년 10월 11일', '{{officerEffectiveDate}}'],
      ['문장 굵기', '회사명 · 직위 · 날짜만 굵게', '문장 전체 보통'],
      ['사임 사유 칸', '일신상의 사유', '(빈칸 — 손으로 쓴다)'],
      ['날짜 줄', '2026년 10월 11일', '{{writeDate}}'],
      ['맺음', 'OOO 주식회사 귀중', '{{companyName}} 귀중'],
    ],
  };
})();

// =============================================================================
// 워드에서 옮기는 6개 — 결정 2026-10-11(장 수 · 값 1~10 · 공통 원칙 · 법무 표시)
// =============================================================================
const SRC = 'doc/forms-src';
const ALL_CASE = ['NAME', 'HQ', 'PURPOSE', 'OFFICER', 'CEO_ADDR'];
const SHAREHOLDER_TYPES = ['NAME', 'HQ', 'PURPOSE', 'OFFICER']; // 상호 · 목적 · 본점이전 · 임원변경
const caseMark = (changeTypes, companyType) => ({ domain: 'corp-change', changeTypes, companyType, unit: 'case' });

/**
 * edit 하나 — `from` 이 든 칸을 찾아 그 부분을 `to` 로 바꾼다(`to` 가 '' 이고 칸 글자가 `from` 뿐이면 빈칸).
 * `whole: true` 면 칸 글자 전체가 `from` 과 같은 칸만. `count` 개(기본 1)에 정확히 맞아야 한다.
 * `plain: true` 면 그 칸의 굵기를 뗀다(문장 전체 보통).
 */
const E = (where, from, to, opts = {}) => ({ where, from, to, ...opts });

const WORD_DOCS = [
  {
    name: '이사회 의사록',
    file: '이사회 의사록.docx',
    registered: '2026-10-11',
    legal: caseMark(['HQ', 'OFFICER'], 'R'),
    edits: [
      E('일시 값 칸', '2026년 10월 11일', '{{resolutionDate}}', { whole: true, count: 2, note: '일시 칸 · 아래 날짜 줄 둘 다' }),
      E('의장 문장', '의장인 대표이사 은(는)', '의장인 대표이사 {{ceoName}}은(는)'),
      E('안건 칸', '제1호 의안: 본점 이전의 건\n제2호 의안: 대표이사 중임의 건', '{{matterBody}}', { whole: true }),
    ],
    keep: ['장소 「본 회사 본점 회의실」(결정 3)', '회의 종료시각 「( )」 빈칸(결정 2)', '출석 수 칸 빈칸(결정 4)', '서명 5줄 · 이름 빈칸(결정 6)'],
  },
  {
    name: '주주 서면결의서',
    file: '주주 서면결의서.docx',
    registered: '2026-10-11',
    legal: caseMark(SHAREHOLDER_TYPES, 'R'),
    edits: [
      E('첫 문장 날짜', '본 회사는 2026년 10월 11일 상법', '본 회사는 {{resolutionDate}} 상법'),
      E('안건 칸', '제1호 의안: 상호에 관한 정관 변경의 건\n제2호 의안: 이사 선임의 건', '{{matterBody}}', { whole: true }),
      E('아래 날짜 줄', '2026년 10월 11일', '{{resolutionDate}}', { whole: true }),
    ],
    keep: ['주주 · 주식 수 칸 — 숫자 빈칸, 단위(명 · 주)는 원문 그대로(결정 4)', '주주 서명 3줄 · 이름 빈칸(결정 6)'],
  },
  {
    name: '주주명부',
    file: '주주명부.docx',
    registered: '2026-10-11',
    legal: caseMark(SHAREHOLDER_TYPES, 'R'),
    edits: [
      E('상호 값 칸', null, '{{companyName}}', { label: '상 호' }),
      E('본점 소재지 값 칸', null, '{{hqAddress}}', { label: '본점 소재지' }),
      E('발행주식 총수', '10,000 주', '주', { whole: true, note: '숫자만 지우고 단위는 둔다' }),
      E('1주의 금액', '5,000 원', '원', { whole: true, note: '숫자만 지우고 단위는 둔다' }),
      E('자본금', '50,000,000 원', '원', { whole: true, note: '숫자만 지우고 단위는 둔다' }),
      E('주주 줄 종류', '보통주', '', { whole: true, count: 3 }),
      E('주주 줄 · 합계 지분율', '0.00%', '', { whole: true, count: 4 }),
      E('합계 주식 수', '0', '', { whole: true }),
      E('아래 날짜 줄', '2026년 10월 11일', '{{writeDate}}', { whole: true }),
    ],
    keep: ['주주 줄 3개 고정 · No 1~3 그대로(결정 7)', '대표이사 서명 이름 칸(0.42cm) 빈칸'],
  },
  {
    name: '주주총회 의사록',
    file: '주주총회 의사록.docx',
    registered: '2026-10-11',
    legal: caseMark(SHAREHOLDER_TYPES, 'R'),
    edits: [
      E('총회 종류', '정기주주총회', '임시주주총회', { whole: true }),
      E('회사명 줄(위 · 아래)', '주식회사', '{{companyName}}', { whole: true, count: 2, note: '「OOO」가 빠진 회사명 줄' }),
      E('소집 문장의 총회 종류', '정기 주주총회를 개최하다', '임시 주주총회를 개최하다'),
      E('일시 줄', '일시 : 2026년 10월 11일 10:00', '일시 : {{resolutionDate}}', { whole: true, note: '시각은 빈칸(결정 2)' }),
      E('의장 문장', '의장 은(는)', '의장 {{ceoName}}은(는)'),
      E('안건 칸', '제1호 의안: 결산보고 승인의 건\n제2호 의안: 이사 선임의 건\n제3호 의안: 감사 해임 및 선임의 건', '{{matterBody}}', { whole: true }),
      E('회의 종료시각', '(회의 종료시각 11:00)', '(회의 종료시각 )', { note: '시각 빈칸 — 이사회 의사록 원문과 같은 꼴' }),
      E('아래 날짜 줄', '2026년 10월 11일', '{{resolutionDate}}', { whole: true }),
    ],
    keep: ['장소 「본 회사 본점 회의실」(결정 3)', '출석 수 칸 — 숫자 빈칸, 단위(명 · 주) 그대로(결정 4)', '서명 3줄 · 이름 빈칸(결정 6)'],
  },
  {
    name: '취임승낙서',
    file: '취임승낙서.docx',
    registered: '2026-10-11',
    legal: { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'R', unit: 'officer', officerKinds: ['APPOINT'] },
    edits: [
      E('성 명 값 칸', null, '{{officerName}}', { label: '성 명' }),
      E('주민등록번호 값 칸', null, '{{officerRrn}}', { label: '주민등록번호' }),
      E('주 소 값 칸', null, '{{officerAddress}}', { label: '주 소' }),
      E(
        '본문 문장',
        '본인은 2026년 10월 11일 개최된 OOO 주식회사 주주총회에서 사내이사로 선임되었으므로',
        '본인은 {{resolutionDate}} 개최된 {{companyName}} 주주총회에서 {{officerPosition}}로 선임되었으므로',
        { plain: true },
      ),
      E('날짜 줄', '2026년 10월 11일', '{{writeDate}}', { whole: true }),
      E('맺음', 'OOO 주식회사 귀중', '{{companyName}} 귀중', { whole: true }),
    ],
    keep: ['취임승낙인 서명 이름 칸(0.85cm) 빈칸'],
  },
  {
    name: '표준위임장',
    file: '표준위임장.docx',
    registered: '2026-10-11',
    legal: caseMark(ALL_CASE, 'ALL'),
    edits: [
      E('위임자 성명', '홍길동', '{{companyName}} (대표자 {{ceoName}})', { whole: true, label: '성 명 :', nth: 0 }),
      E('위임자 주소', '서울시 강남구...', '{{hqAddress}}', { whole: true }),
      E('수임자 성명', '이몽룡', '', { whole: true }),
      E('수임자 주소', '서울시 서초구...', '', { whole: true }),
      E('수임자 관계', '지인', '', { whole: true }),
      E(
        '위임 사항',
        '1. 주민등록등본 및 초본 발급 신청 및 수령에 관한 일체의 권한\n2. 인감증명서 발급 신청 및 수령에 관한 일체의 권한',
        '{{regPurpose}} 신청 및 이에 관련된 서류 제출 일체',
        { whole: true },
      ),
      E('날짜 줄', '2026년 10월 11일', '{{applyDate}}', { whole: true }),
      E('위임자 서명 이름', '홍길동', '', { whole: true, nth: 0 }),
    ],
    keep: ['「1. 위 임 자」 등 소제목 밑줄은 빠진다(수용)'],
  },
];

/** 칸 하나에 edit 를 건다. `label` 이 있으면 「그 라벨 칸이 있는 행의 다음 칸(값 칸)」을 찾는다. */
function applyEdits(rows, edits) {
  const done = [];
  for (const e of edits) {
    let hits = [];
    rows.forEach((r) =>
      r.cells.forEach((c, ci) => {
        if (e.label !== undefined && e.from === null) {
          if (c.text === e.label && r.cells[ci + 1] && !r.cells[ci + 1].text) hits.push(r.cells[ci + 1]);
          return;
        }
        if (typeof c.text !== 'string') return;
        if (e.whole ? c.text === e.from : c.text.includes(e.from)) hits.push(c);
      }),
    );
    if (e.nth !== undefined) hits = hits.slice(e.nth, e.nth + 1);
    const want = e.count ?? 1;
    if (hits.length !== want) throw new Error(`「${e.where}」 — 맞는 칸이 ${hits.length}개(기대 ${want})`);
    for (const c of hits) {
      const before = c.text ?? '(빈칸)';
      const next = e.from === null ? e.to : c.text.replace(e.from, e.to);
      if (next === '') delete c.text;
      else c.text = next;
      if (e.plain) delete c.bold;
      done.push([e.where, before, next === '' ? '(빈칸)' : next, e.note]);
    }
  }
  return done;
}

const PAGE_MARGIN_TOP = 0.8; // 종이 1.2 + 0.8 = 원문 위 여백 2.0cm

function buildWordDoc(spec) {
  const conv = convertDocx(`${SRC}/${spec.file}`);
  const changes = applyEdits(conv.rows, spec.edits);
  const before = conv.rows.reduce((a, r) => a + r.height, 0);
  const fit = fitOnePage(conv.rows, PAGE_INNER_CM - PAGE_MARGIN_TOP);
  return {
    name: spec.name,
    registered: spec.registered,
    kind: 'T',
    description: `법인변경 — doc/forms-src/${spec.file} 초안(2026-10-11)`,
    sourcePages: 1,
    definition: {
      version: 2,
      font: { family: '바탕', size: 10.5 },
      legal: spec.legal,
      pages: [toPage(conv.colWidths, fit.rows, PAGE_MARGIN_TOP)],
    },
    changes: changes.map(([w, f, t, n]) => [w + (n ? ` (${n})` : ''), f, t]),
    keep: spec.keep,
    notes: conv.notes,
    fit: { before, steps: fit.steps, overflow: fit.overflow },
  };
}

const ALL_DOCS = [SAIMSEO, ...WORD_DOCS.map(buildWordDoc)];
const DOCS = ALL_DOCS.filter((d) => (only.length > 0 ? only.includes(d.name) : !d.registered));

// =============================================================================
// 보기 · 쓰기
// =============================================================================
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => n.toFixed(2);

function report(doc, def) {
  console.log(`\n■ ${doc.name}  (종류 ${doc.kind} · 글꼴 ${def.font.family} ${def.font.size}pt)`);
  console.log(`  법무 표시: ${JSON.stringify(def.legal)}`);
  def.pages.forEach((p, pi) => {
    const h = sum(p.rowHeights) + (p.marginTop ?? DEFAULT_MARGIN_TOP);
    const fits = h <= PAGE_INNER_CM;
    console.log(`  ${pi + 1}장 — 열 ${p.colWidths.length}개(${p.colWidths.join(' · ')} = ${fmt(sum(p.colWidths))}cm) · 행 ${p.rowHeights.length}개`);
    console.log(`        높이 = 행 ${fmt(sum(p.rowHeights))} + 위 여백 ${p.marginTop ?? DEFAULT_MARGIN_TOP} = ${fmt(h)}cm / 안쪽 ${fmt(PAGE_INNER_CM)}cm → ${fits ? '1장에 들어감' : '★ 넘침'}`);
    const byRow = new Map();
    for (const c of p.cells) (byRow.get(c.row) ?? byRow.set(c.row, []).get(c.row)).push(c);
    p.rowHeights.forEach((rh, r) => {
      const texts = (byRow.get(r) ?? []).filter((c) => c.text).map((c) => `[${c.col}${c.colSpan > 1 ? `~${c.col + c.colSpan - 1}` : ''}] ${JSON.stringify(c.text)}`);
      console.log(`        행${String(r).padStart(2)} ${fmt(rh)}cm  ${texts.join('  ') || '(빈 줄)'}`);
    });
  });
  if (def.pages.length !== doc.sourcePages) console.log(`  ★ 장 수가 원문(${doc.sourcePages})과 다르다`);
  const tokens = definitionTokens(def);
  const unknown = tokens.filter((t) => !LABELS[t]);
  console.log(`  자리표시 ${tokens.length}개: ${tokens.map((t) => `${t}(${LABELS[t] ?? '?'})`).join(' · ')}`);
  if (unknown.length) console.log(`  ★ 이름표에 없는 자리표시: ${unknown.join(', ')}`);
  if (doc.fit) {
    console.log(`  1장 맞추기: 원문 행 합 ${fmt(doc.fit.before)}cm → ${doc.fit.steps.length ? doc.fit.steps.join(' / ') : '줄일 필요 없음'}${doc.fit.overflow ? ' / ★ 그래도 넘침' : ''}`);
  }
  console.log('  바뀌는 곳(원문 → 초안):');
  for (const [where, from, to] of doc.changes) console.log(`    · ${where}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  for (const k of doc.keep ?? []) console.log(`    = ${k}`);
  for (const n of doc.notes ?? []) console.log(`    ※ ${n}`);
}

(async () => {
  const problems = [];
  const ready = DOCS.map((doc) => {
    const def = parseDefinition(doc.definition);
    const labels = definitionTokens(def).map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);
    def.manualFields = labels;
    report(doc, def);
    for (const p of def.pages) {
      if (sum(p.rowHeights) + (p.marginTop ?? DEFAULT_MARGIN_TOP) > PAGE_INNER_CM) problems.push(`${doc.name}: 쪽 높이 넘침`);
    }
    if (def.pages.length !== doc.sourcePages) problems.push(`${doc.name}: 장 수가 원문과 다름`);
    if (definitionTokens(def).some((t) => !LABELS[t])) problems.push(`${doc.name}: 이름표 밖 자리표시`);
    return { doc, def };
  });
  if (dumpPath) fs.writeFileSync(dumpPath, JSON.stringify(ready.map((r) => ({ name: r.doc.name, definition: r.def }))));

  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query('BEGIN');
  try {
    const { rows } = await c.query(
      `SELECT name FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = ANY($1)`,
      [ready.map((r) => r.doc.name)],
    );
    if (rows.length > 0) problems.push(`이미 있는 이름: ${rows.map((r) => r.name).join(', ')}`);
    if (problems.length > 0) throw new Error(problems.join(' / '));

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log(`\n보기만 했습니다 — ${ready.length}건. 쓰려면 --apply`);
      return;
    }
    for (const { doc, def } of ready) {
      await c.query(
        `INSERT INTO public.tb_s080_form_templates
           (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
         VALUES ($1, 1, $2, $3, $4, $5::jsonb, now(), now(), 'oneoff-2026-10-11', 'oneoff-2026-10-11')`,
        [randomUUID(), doc.name, doc.description, doc.kind, JSON.stringify(def)],
      );
    }
    await c.query('COMMIT');
    console.log(`\n썼습니다 — ${ready.length}건`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
