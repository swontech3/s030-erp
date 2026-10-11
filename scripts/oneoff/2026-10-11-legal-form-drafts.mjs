/**
 * 일회용(2026-10-11) — `doc/forms-src/` 의 워드 문서를 **법무 표양식 초안**으로 등록한다.
 *
 * 지금 들어 있는 문서: 사임서. (나머지 6개는 사용자 확인 뒤 이 목록에 더한다.)
 *
 * ★ 기본은 **보기만** 한다 — 장 · 행 · 칸 · 자리표시 · 법무 표시 · 쪽 높이를 찍는다. `--apply` 일 때만
 *   한 트랜잭션으로 쓴다. `--only=사임서,…` 로 고를 수 있다.
 * ★ 같은 이름의 양식이 하나라도 있으면 **아무것도 쓰지 않고 멈춘다**(두 번 돌려도 안전).
 * ★ 정의는 shared `parseDefinition` 을 통과해야 한다(표양식 화면 · 서버와 같은 검사).
 * ★ 문구는 원문 그대로다. 바꾼 곳은 샘플 값뿐이다(OOO 주식회사 · 샘플 날짜 · 샘플 직위 → 자리표시,
 *   사유 예시 글 → 빈칸) — 문서마다 `changes` 에 적었다.
 * ★ 원문이 1장이면 1장 — 행 높이 합 + 위 여백이 종이 안쪽 높이(29.7 − 위아래 1.2)를 넘으면 멈춘다.
 *
 *   npx tsx scripts/oneoff/2026-10-11-legal-form-drafts.mjs .env              (보기)
 *   npx tsx scripts/oneoff/2026-10-11-legal-form-drafts.mjs .env --apply      (쓰기)
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseDefinition, definitionTokens, DEFAULT_MARGIN_TOP } from '../../packages/shared/src/domain/form-template.ts';
import { CORP_CHANGE_PRINT_FIELDS } from '../../packages/shared/src/domain/corp-change-print.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
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

const DOCS = [SAIMSEO].filter((d) => only.length === 0 || only.includes(d.name));

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
  console.log('  바뀌는 곳(원문 → 초안):');
  for (const [where, from, to] of doc.changes) console.log(`    · ${where}: ${from} → ${to}`);
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
