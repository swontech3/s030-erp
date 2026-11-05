/**
 * 일회용(2026-11-05) — 「내용에 맞춤」 넓히기: 사람 수 · 항목 수로 줄 수가 바뀌는 목록 칸(결정 2026-11-05).
 *
 * 법무 표시가 있는 서식 전부에서 목록 자리표시(아래 LIST_TOKENS)가 든 칸을 찾아, **목록 1명(1항목)** 값으로
 * 앱 인쇄 규칙(`FormDocument` 와 같은 칸 · form-doc CSS)대로 헤드리스 Chrome 에 그려
 * 「저장 높이로 그린 행 높이 − 내용에 맞춘 행 높이」 = 남는 공백(cm)을 잰다.
 *   · 공백 > 0.5cm · 걸침 1 · 표시 없음 · 제외 제안 아님 → `fitHeight: true` 를 그 칸 하나에 붙인다
 *   · 제외 제안(표에만 적고 붙이지 않는다) — ① 서명 · 날인란(자리표시 이름에 Sign): 아래 여백이 일부러 필요할 수 있다
 *     ② 테두리 상자 칸(테두리가 한 변이라도 그려지는 칸): 서식의 칸 틀 자체가 내용만큼 줄어든다(신청서 칸 등)
 *   · 「효과」 칸 — 그 행 아래에 글 행이 없으면(장 끝) 끌어올릴 것이 없어 보이는 변화가 없다
 * 값: 주식회사 = 한 사람(발기인 · 이사 · 대표이사, 목적 1개). 조사보고인 목록 셋은 조사보고인이 1명이어야 하므로
 *     감사(발기인 아님) 1명을 더한 건의 값. 유한회사 = 한 사람(사원 · 이사 · 대표이사, 목적 1개). 법인변경 서식에는
 *     목록 자리표시가 없다(임원마다 한 장).
 * ★ 저장 높이 · 다른 칸 · 다른 행은 그대로다. 장 나누기는 다시 하지 않는다(줄어들기만 한다).
 *
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 한 트랜잭션으로 쓰고 되읽는다.
 *   멈추는 경우(아무것도 쓰지 않는다): 양식이 보기 뒤에 바뀜(수정 시각) · 고친 정의가 검사에 걸림.
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다. Chrome 이 있어야 한다.
 *
 *   npx tsx scripts/oneoff/2026-11-05-legal-list-fit.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-05-legal-list-fit.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { DEFAULT_MARGIN_TOP, extractTokens, fitRowsOf, migrateDefinition, definitionTokens } from '../../packages/shared/src/domain/form-template.ts';
import { buildIncorpPrintDocuments } from '../../packages/shared/src/domain/incorporation-print.ts';
import { buildIncorporationSnapshot, parseIncorpInfo } from '../../packages/shared/src/domain/incorporation-detail.ts';
import { readIncorpTaxSetting } from '../../packages/shared/src/domain/incorporation-tax.ts';
import { pickDocFormSetting } from '../../packages/shared/src/domain/corp-change-print.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-05-legal-list-fit.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const ACTOR = 'oneoff-2026-11-05';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIN_SPARE_CM = 0.5;
/** 사람 수 · 항목 수로 줄 수가 바뀌는 자리표시(`incorporation-print.ts` 의 lines(...) 값). 정관 목적 목록은 24번이 했다. */
const LIST_TOKENS = [
  'purposeList', 'directorAuditorList', 'representativeList', 'resolutionOfficerList', 'resolutionRepresentativeList',
  'shareholderSignList', 'founderSignList', 'reporterList', 'officerNameList', 'reporterNameList', 'reporterSignList',
  'articlesFounderList', 'articlesMemberTable', 'articlesMemberSignList', 'representativeRrnList', 'minutesOfficerRrnList',
  'directorSignList',
];
const REPORTER_TOKENS = new Set(['reporterList', 'reporterNameList', 'reporterSignList']);
const isSignToken = (t) => /Sign/.test(t);
/** 테두리가 한 변이라도 그려지는가(생략 = 실선). */
const hasBorder = (cell) => ['top', 'right', 'bottom', 'left'].some((e) => cell.border?.[e] !== false);

// ── 시험 값 — 목록 1명 ─────────────────────────────────────────────────
const ADDR = { zipCode: '06164', address: '서울 강남구 테헤란로 123', addressDetail: '4층 401호 (역삼동, 에스원비즈빌딩)' };
const RRN = '9001011234567';
const INPUTS = { applyDate: '2026-12-31', writeDate: '2026-12-31' };
const ONE = ['남궁가나다', { isFounder: true, isDirector: true, isRepresentative: true, unitsSubscribed: 10_000 }];
const CASES = [
  { key: 'R1', entity: 'R', persons: [ONE], nameKo: '가나다라마바사아자차카타' },
  { key: 'R1+감사', entity: 'R', persons: [ONE, ['서문마바사', { isAuditor: true }]], nameKo: '가나다라마바사아자차카타' },
  { key: 'A1', entity: 'A', persons: [ONE], nameKo: '유한회사 가나다라마바사아자차카타' },
];
function incorpSource(t, settings) {
  const info = parseIncorpInfo({
    nameKo: t.nameKo, nameEn: 'Ganadara Global Solutions', hq: ADDR, capitalAmount: 100_000_000, parValue: 10_000,
    ...(t.entity === 'R' ? { unitsAuthorized: 200_000, unitsIssued: 10_000, paymentBank: '국민은행 테헤란로중앙지점' } : {}),
    fiscalStart: '01-01', fiscalEnd: '12-31', plannedDate: '2026-12-31', meetingTime: '10:00', ceoPhone: '02-1234-5678',
    purposes: '소프트웨어 개발 및 공급업',
  });
  if (!info.ok) throw new Error(`시험 설립 정보가 틀렸다: ${JSON.stringify(info)}`);
  const persons = t.persons.map(([name, o]) => ({ name, isFounder: false, isDirector: false, isAuditor: false, isRepresentative: false, unitsSubscribed: 0, appointmentDate: '2026-12-31', ...ADDR, rrn: RRN, ...o }));
  const snapshot = buildIncorporationSnapshot(info.value, persons.map((p, i) => ({ ...p, id: `p${i}`, rrnMasked: null, sortOrder: i + 1 })), t.entity);
  const method = t.entity === 'A' ? 'U_P' : 'R_PROMOTER';
  const base = settings.find((r) => r.regTypeKey === method && r.companyType === '' && r.isActive);
  return {
    snapshot, persons,
    setting: pickDocFormSetting(settings, method, t.entity),
    taxSetting: base ? readIncorpTaxSetting(base.taxes) : null,
    methodName: t.entity === 'A' ? '유한회사 발기설립' : '주식회사 발기설립',
    inputs: INPUTS,
  };
}

// ── 그리기 · 재기 — FormDocument 와 같은 칸 ────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fillText = (t, values) => t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => values[String(k).trim()] ?? '');
function pageHtml(id, page, values, font, fitRow) {
  const covered = new Set();
  for (const c of page.cells) for (let a = 0; a < (c.rowSpan ?? 1); a++) for (let b = 0; b < (c.colSpan ?? 1); b++) if (a || b) covered.add(`${c.row + a},${c.col + b}`);
  const at = new Map(page.cells.map((c) => [`${c.row},${c.col}`, c]));
  const fit = fitRowsOf(page);
  if (fitRow !== null) fit.add(fitRow);
  const edge = (on) => (on === false ? 'none' : '1px solid #000');
  const trs = page.rowHeights.map((h, r) => `<tr${fit.has(r) ? '' : ` style="height:${h}cm"`}>${page.colWidths.map((_, c) => {
    if (covered.has(`${r},${c}`)) return '';
    const x = at.get(`${r},${c}`);
    const b = x?.border;
    return `<td colspan="${x?.colSpan ?? 1}" rowspan="${x?.rowSpan ?? 1}" style="text-align:${x?.align ?? 'left'};vertical-align:${x?.valign ?? 'middle'};font-size:${x?.fontSize ?? font.size}pt;font-weight:${x?.bold ? 700 : 400};border-top:${edge(b?.top)};border-right:${edge(b?.right)};border-bottom:${edge(b?.bottom)};border-left:${edge(b?.left)}">${x?.text ? esc(fillText(x.text, values)) : ''}</td>`;
  }).join('')}</tr>`).join('');
  const w = page.colWidths.reduce((a, b) => a + b, 0);
  return `<section data-id="${id}" class="page"><table style="width:${w}cm;margin-top:${page.marginTop ?? DEFAULT_MARGIN_TOP}cm;font-family:'${font.family}'"><colgroup>${page.colWidths.map((cw) => `<col style="width:${cw}cm">`).join('')}</colgroup><tbody>${trs}</tbody></table></section>`;
}
/** 장마다 행 높이(cm) 목록. */
function measure(items) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0} .page{width:210mm;box-sizing:border-box;padding:12mm 0;display:flex;flex-direction:column;align-items:center;margin-bottom:20px}
table{border-collapse:collapse;table-layout:fixed} td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5}
</style></head><body>${items.map((t) => pageHtml(t.id, t.page, t.values, t.font, t.fitRow)).join('')}<script>
const cm=(p)=>p*2.54/96; const out={};
document.querySelectorAll('section').forEach((s)=>{ out[s.dataset.id]=[...s.querySelectorAll('tr')].map((tr)=>+cm(tr.getBoundingClientRect().height).toFixed(3)); });
document.body.setAttribute('data-out',encodeURIComponent(JSON.stringify(out)));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-list-fit-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=5000', '--dump-dom', 'file:///' + file.split(path.sep).join('/')], { maxBuffer: 1 << 28, timeout: 180000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return JSON.parse(decodeURIComponent(m[1]));
}

const rowText = (page, r) => page.cells.filter((c) => c.row === r && c.text).map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
/** 그 행 아래 첫 글 행(무엇이 끌려 올라오는가). */
function nextTextRow(page, r) {
  for (let k = r + 1; k < page.rowHeights.length; k++) { const t = rowText(page, k); if (t) return t.slice(0, 20); }
  return '(장 끝)';
}

async function main() {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const forms = (await c.query(
      `SELECT id, name, definition, updated_at FROM public.tb_s080_form_templates WHERE operator_id = 1 AND definition ? 'legal' ORDER BY name`,
    )).rows.map((r) => ({ id: r.id, name: r.name, raw: r.definition, updatedAt: r.updated_at.toISOString(), def: migrateDefinition(r.definition) }));
    const settings = (await c.query(
      `SELECT reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes, attachments, reg_purpose, reg_reason, matter_body
         FROM public.tb_s080_doc_form_settings WHERE operator_id = 1 AND domain = 'incorporation'`,
    )).rows.map((r) => ({ regTypeKey: r.reg_type_key, companyType: r.company_type ?? '', isActive: r.is_active, label: r.label, formNo: r.form_no, matter: r.matter, taxMode: r.tax_mode, taxes: r.taxes, attachments: r.attachments, regPurpose: r.reg_purpose, regReason: r.reg_reason, matterBody: r.matter_body }));

    // 법인변경 서식에 목록 자리표시가 있으면 이 스크립트가 값을 모른다 — 멈춘다
    const corpWithList = forms.filter((f) => f.def.legal?.domain === 'corp-change' && definitionTokens(f.def).some((t) => LIST_TOKENS.includes(t)));
    if (corpWithList.length) throw new Error(`법인변경 서식에 목록 자리표시가 있다: ${corpWithList.map((f) => f.name).join(', ')}`);

    // 양식마다 값 — 경우별
    const marked = forms.filter((f) => f.def.legal?.domain === 'incorporation').map((f) => ({ id: f.id, name: f.name, mark: f.def.legal, definition: f.def, tokens: definitionTokens(f.def) }));
    const valuesOf = new Map(); // `${formId}|${caseKey}` → values(첫 장)
    for (const t of CASES) {
      for (const d of buildIncorpPrintDocuments(marked, incorpSource(t, settings))) {
        if (d.sheets[0]) valuesOf.set(`${d.formId}|${t.key}`, d.sheets[0].values);
      }
    }

    // 후보 칸
    const cands = [];
    for (const f of forms) {
      f.def.pages.forEach((page, pi) => page.cells.forEach((cell, ci) => {
        const toks = extractTokens(cell.text ?? '').filter((t) => LIST_TOKENS.includes(t));
        if (toks.length === 0) return;
        // 서식은 회사 형태가 맞는 경우에만 뜬다(유한회사 서식 = A1). 주식회사는 조사보고인 목록이면 R1+감사, 아니면 R1
        const rKey = toks.some((t) => REPORTER_TOKENS.has(t)) ? 'R1+감사' : 'R1';
        const values = valuesOf.get(`${f.id}|A1`) ?? valuesOf.get(`${f.id}|${rKey}`);
        cands.push({ f, pi, ci, cell, toks, values, rawCell: f.raw.pages[pi].cells[ci] });
      }));
    }
    const items = [];
    cands.forEach((k, i) => {
      if (!k.values) return;
      const page = k.f.def.pages[k.pi];
      items.push({ id: `${i}|fixed`, page, values: k.values, font: k.f.def.font, fitRow: null });
      items.push({ id: `${i}|fit`, page, values: k.values, font: k.f.def.font, fitRow: k.cell.row });
    });
    const got = measure(items);

    const rows = cands.map((k, i) => {
      const page = k.f.def.pages[k.pi];
      const span = k.cell.rowSpan ?? 1;
      const saved = page.rowHeights.slice(k.cell.row, k.cell.row + span).reduce((a, b) => a + b, 0);
      const already = k.cell.fitHeight === true;
      let spare = null;
      if (k.values) spare = got[`${i}|fixed`][k.cell.row] - got[`${i}|fit`][k.cell.row];
      const sign = k.toks.some(isSignToken);
      let decision;
      if (!k.values) decision = '대상 아님(시험 건에 뜨지 않음)';
      else if (already) decision = '이미 표시';
      else if (span !== 1) decision = `대상 아님(걸침 ${span})`;
      else if (spare <= MIN_SPARE_CM) decision = '붙이지 않음(0.5cm 이하)';
      else if (sign) decision = '제외 제안(서명 · 날인란)';
      else if (hasBorder(k.cell)) decision = '제외 제안(테두리 상자)';
      else decision = '붙임';
      return {
        k, decision,
        view: {
          서식: k.f.name, 장: `${k.pi + 1}/${k.f.def.pages.length}`, 행: k.cell.row + 1, 자리표시: k.toks.join(','),
          '저장 높이': +saved.toFixed(2), '1명 공백': spare === null ? '-' : +spare.toFixed(2), 아래: nextTextRow(page, k.cell.row + span - 1),
          효과: nextTextRow(page, k.cell.row + span - 1) === '(장 끝)' ? '없음(장 끝)' : '아래 글이 올라옴', 결정: decision,
        },
      };
    });
    console.table(rows.map((r) => r.view));
    const apply = rows.filter((r) => r.decision === '붙임');
    console.log(`붙임 ${apply.length}칸 · 제외 제안 ${rows.filter((r) => r.decision.startsWith('제외')).length}칸 · 그 밖 ${rows.length - apply.length - rows.filter((r) => r.decision.startsWith('제외')).length}칸`);

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('보기만 했다 — 쓰려면 --apply');
      return;
    }
    // 쓰기 — 양식마다 원본 JSON 에서 그 칸들만 바꾼 사본
    const byForm = new Map();
    for (const r of apply) {
      if (!byForm.has(r.k.f.id)) byForm.set(r.k.f.id, { f: r.k.f, next: structuredClone(r.k.f.raw), cells: [] });
      const e = byForm.get(r.k.f.id);
      e.next.pages[r.k.pi].cells[r.k.ci].fitHeight = true;
      e.cells.push(`${r.k.pi + 1}장 ${r.k.cell.row + 1}행`);
    }
    for (const { f, next, cells } of byForm.values()) {
      const def = migrateDefinition(next);
      const want = new Set(cells);
      const fitAll = def.pages.flatMap((p, pi) => [...fitRowsOf(p)].map((row) => `${pi + 1}장 ${row + 1}행`));
      const before = f.def.pages.flatMap((p, pi) => [...fitRowsOf(p)].map((row) => `${pi + 1}장 ${row + 1}행`));
      if (fitAll.length !== before.length + want.size || ![...want].every((x) => fitAll.includes(x))) throw new Error(`「${f.name}」 — 고친 뒤 맞춤 행이 기대와 다르다`);
      const { rows: cur } = await c.query(`SELECT updated_at FROM public.tb_s080_form_templates WHERE id = $1 FOR UPDATE`, [f.id]);
      if (cur.length !== 1 || cur[0].updated_at.toISOString() !== f.updatedAt) throw new Error(`「${f.name}」 이 보기 뒤에 바뀌었다`);
      await c.query(`UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = $3 WHERE id = $1`, [f.id, JSON.stringify(next), ACTOR]);
    }
    // 되읽기
    const after = [];
    for (const { f, cells } of byForm.values()) {
      const r = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE id = $1`, [f.id])).rows[0];
      const def = migrateDefinition(r.definition);
      const fitAll = def.pages.flatMap((p, pi) => [...fitRowsOf(p)].map((row) => `${pi + 1}장 ${row + 1}행`));
      const sameHeights = JSON.stringify(def.pages.map((p) => p.rowHeights)) === JSON.stringify(f.def.pages.map((p) => p.rowHeights));
      after.push({ 서식: f.name, 맞춤행: fitAll.join(', '), 붙인것: cells.join(', '), '저장 높이 그대로': sameHeights ? '예' : '아니오', 장수: def.pages.length });
      if (!sameHeights || !cells.every((x) => fitAll.includes(x))) throw new Error(`「${f.name}」 되읽은 값이 다르다 — 되돌린다`);
    }
    console.table(after);
    await c.query('COMMIT');
    console.log(`적용했다 — 서식 ${byForm.size}건 · 칸 ${apply.length}개`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error('✘ 멈춤:', e.message, '(아무것도 쓰지 않았다)');
  process.exit(1);
});
