/**
 * 일회용(2026-11-05) — 유한회사 타관할 본점이전(`HQ_OUT`) 서식 3종 고치기(결정 2026-11-05).
 *
 *   1. 「본점이전(관할외) 등기신청서(유한회사)」 1장 — 표가 한 장(27.30cm)을 채우게 행 높이를 늘린다. 2장은 그대로.
 *      규칙: 원본(92-2, 빈 서식 표)의 행 높이로 맞출 수 있는 행은 원본 값으로(접수 · 제 호 · 상호 · 본점 · 목적 ·
 *      사유 · 새 본점 · 연월일 · 지배인), 남는 높이는 큰 칸 다섯(사유 · 새 본점 · 연월일 · 지배인 · 상호 변경)에
 *      그 높이 비율로 나눈다. 다른 행은 그대로. 재서 장 끝(27.30cm)을 넘지 않게 맞춘다.
 *   2. 「사원총회 의사록(유한회사, 변경)」 — 2장을 1장으로 합친다(열 폭이 같다 — 2장 행을 1장 아래에 잇는다).
 *      · 서명란 「의장 대표이사」 옆 이름 칸 = `{{ceoName}}`(회사 정보의 대표자 = 의장) · 「이사」 첫 줄 이름 칸 =
 *        `{{directorName}}`(동의서와 같은 출력 때 입력, 결정 2026-11-05) · 둘째 줄은 빈칸 그대로
 *      · 출석 현황 6칸 · 회의 종료시각 = 「출력 때 입력」 자리표시(이름표 사전에 더함)
 *      · 한 장에 넘치면 **내용보다 높은 행의 남는 높이만** 같은 비율로 줄인다(글이 잘리지 않는다)
 *   3. 「이사과반수동의서」 — 대표이사 줄 이름 칸 = `{{ceoName}}`, 이사 줄 이름 칸 = `{{directorName}}`(출력 때 입력)
 *   ★ 이름 칸의 글자 크기 · 세로 정렬은 같은 줄의 직위 칸과 같게(12pt · 가운데). 서명란 이름 칸은 오른쪽으로 넓힌다(`widenNameRow` —
 *     0.85cm 라 이름이 세로로 한 자씩 찍혔다, 결정 2026-11-05). 「(인)」은 바로 다음 칸으로 밀린다.
 *     그 밖의 칸 · 자리표시 · 법무 표시는 그대로.
 *   ★ 「출력 때 입력」은 법인변경 [서류 출력] 화면이 서버 값에 없는 자리표시마다 입력칸을 띄운다(`printManualFields`).
 *
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 한 트랜잭션으로 쓰고 되읽는다.
 *   멈추는 경우(아무것도 쓰지 않는다): 서식이 이름으로 정확히 1건이 아님 · 바꿀 칸 글자가 기대와 다름 ·
 *   이미 바꾼 것 같음 · 1장 · 한 장에 넘침 · 양식이 보기 뒤에 바뀜(수정 시각) · 고친 정의가 검사에 걸림.
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다. Chrome 이 있어야 한다.
 *
 *   npx tsx scripts/oneoff/2026-11-05-ltd-hq-out-forms.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-05-ltd-hq-out-forms.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { DEFAULT_MARGIN_TOP, definitionTokens, fitRowsOf, migrateDefinition } from '../../packages/shared/src/domain/form-template.ts';
import { CORP_CHANGE_PRINT_FIELDS, buildPrintDocuments, pickDocFormSetting, withManualValues } from '../../packages/shared/src/domain/corp-change-print.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-05-ltd-hq-out-forms.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const ACTOR = 'oneoff-2026-11-05';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE_INNER_CM = 29.7 - 1.2 * 2; // 27.30
const APP = '본점이전(관할외) 등기신청서(유한회사)';
const MIN = '사원총회 의사록(유한회사, 변경)';
const AGREE = '이사과반수동의서';

/** 신청서 1장 — 원본 92-2 빈 서식 표(table 0)의 행 높이(cm, docx trHeight ÷ 567). 키 = 지금 1장의 행 번호(0부터). */
const APP_ORIGINAL = { 3: 0.92, 4: 1.23, 6: 1.16, 7: 1.31, 8: 1.22, 9: 3.09, 11: 2.43, 12: 1.75, 13: 2.86 };
/** 남는 높이를 나눌 큰 칸 — 사유 · 새 본점 · 연월일 · 지배인 · 상호 변경. */
const APP_BIG = [9, 11, 12, 13, 14];
/** 의사록 · 동의서 「출력 때 입력」 이름표. */
const MIN_MANUAL = [
  ['memberCount', '사원의 총수'], ['unitsTotal', '출자좌수의 총수'],
  ['votingMemberCount', '의결권 있는 사원의 수'], ['votingUnits', '의결권 있는 출자좌수'],
  ['attendMemberCount', '출석 사원의 수'], ['attendUnits', '출석 출자좌수'],
  ['meetingEndTime', '회의 종료시각'],
  ['directorName', '이사 성명'],
];
const AGREE_MANUAL = [['ceoName', '대표자'], ['directorName', '이사 성명']];

// ── 시험 값 — 긴 상호 · 긴 주소(장 나누기 스크립트와 같은 모양) + 출력 때 입력 값 ─────────────
const ADDR = { zipCode: '06164', address: '서울 강남구 테헤란로 123', addressDetail: '4층 401호 (역삼동, 에스원비즈빌딩)' };
const NEW_ADDR = { zipCode: '13494', address: '경기도 성남시 분당구 판교역로 235', addressDetail: '에이치스퀘어 엔동 7층 701호 (삼평동)' };
const MANUAL_SAMPLE = {
  memberCount: '2', unitsTotal: '100,000', votingMemberCount: '2', votingUnits: '100,000', attendMemberCount: '2', attendUnits: '100,000',
  meetingEndTime: '오전 10시 30분', directorName: '선우라마바',
};
function hqOutSource(settings) {
  const snapshot = {
    version: 3, changeType: 'HQ_OUT',
    company: { isTenant: false, name: '유한회사 가나다라마바사아자차카타', corpNumber: '110111-1234567', bizNumber: '123-45-67890', ceoName: '남궁가나다', tel: '02-1234-5678', memberType: 'A', head: ADDR, ceoHome: ADDR },
    payload: { newHqAddress: NEW_ADDR, resolutionDate: '2026-12-31', relocationDate: '2026-12-31' },
    officers: [],
  };
  return { snapshot, setting: pickDocFormSetting(settings, 'HQ_OUT', 'A'), changeTypeName: '타관할로의 본점이전', inputs: { applyDate: '2026-12-31', writeDate: '2026-12-31' } };
}

// ── 그리기 · 재기 — FormDocument 와 같은 칸 ────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fillText = (t, values) => t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => values[String(k).trim()] ?? '');
function pageHtml(id, page, values, font, allFit = false) {
  const covered = new Set();
  for (const c of page.cells) for (let a = 0; a < (c.rowSpan ?? 1); a++) for (let b = 0; b < (c.colSpan ?? 1); b++) if (a || b) covered.add(`${c.row + a},${c.col + b}`);
  const at = new Map(page.cells.map((c) => [`${c.row},${c.col}`, c]));
  const fit = fitRowsOf(page);
  const edge = (on) => (on === false ? 'none' : '1px solid #000');
  const trs = page.rowHeights.map((h, r) => `<tr${allFit || fit.has(r) ? '' : ` style="height:${h}cm"`}>${page.colWidths.map((_, c) => {
    if (covered.has(`${r},${c}`)) return '';
    const x = at.get(`${r},${c}`);
    const b = x?.border;
    return `<td colspan="${x?.colSpan ?? 1}" rowspan="${x?.rowSpan ?? 1}" style="text-align:${x?.align ?? 'left'};vertical-align:${x?.valign ?? 'middle'};font-size:${x?.fontSize ?? font.size}pt;font-weight:${x?.bold ? 700 : 400};border-top:${edge(b?.top)};border-right:${edge(b?.right)};border-bottom:${edge(b?.bottom)};border-left:${edge(b?.left)}">${x?.text ? esc(fillText(x.text, values)) : ''}</td>`;
  }).join('')}</tr>`).join('');
  const w = page.colWidths.reduce((a, b) => a + b, 0);
  return `<section data-id="${id}" class="page"><table style="width:${w}cm;margin-top:${page.marginTop ?? DEFAULT_MARGIN_TOP}cm;font-family:'${font.family}'"><colgroup>${page.colWidths.map((cw) => `<col style="width:${cw}cm">`).join('')}</colgroup><tbody>${trs}</tbody></table></section>`;
}
/** 장마다 { ends: 행 끝(장 안쪽 맨 위에서, cm), heights: 행 높이(cm) }. */
function measure(items) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0} .page{width:210mm;box-sizing:border-box;padding:12mm 0;display:flex;flex-direction:column;align-items:center;margin-bottom:20px}
table{border-collapse:collapse;table-layout:fixed} td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5}
</style></head><body>${items.map((t) => pageHtml(t.id, t.page, t.values, t.font, t.allFit)).join('')}<script>
const cm=(p)=>p*2.54/96; const out={};
document.querySelectorAll('section').forEach((s)=>{ const t0=s.getBoundingClientRect().top+parseFloat(getComputedStyle(s).paddingTop);
 const trs=[...s.querySelectorAll('tr')];
 out[s.dataset.id]={ends:trs.map((tr)=>+cm(tr.getBoundingClientRect().bottom-t0).toFixed(3)),heights:trs.map((tr)=>+cm(tr.getBoundingClientRect().height).toFixed(3))}; });
document.body.setAttribute('data-out',encodeURIComponent(JSON.stringify(out)));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-out-forms-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=5000', '--dump-dom', 'file:///' + file.split(path.sep).join('/')], { maxBuffer: 1 << 28, timeout: 180000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return JSON.parse(decodeURIComponent(m[1]));
}
const last = (a) => a[a.length - 1];
const r2 = (n) => Math.round(n * 100) / 100;
/** 키를 정렬한 JSON — 되읽은 jsonb 와 쓴 값을 키 순서 없이 비교한다. */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

// ── 칸 찾기 · 바꾸기(원본 JSON 사본에서) ──────────────────────────────
function cellOf(page, row, col, what) {
  const c = page.cells.find((x) => x.row === row && x.col === col);
  if (!c) throw new Error(`${what} — ${row + 1}행 ${col + 1}열 칸이 없다`);
  return c;
}
function expectText(cell, text, what) {
  if ((cell.text ?? '') !== text) throw new Error(`${what} — 칸 글자가 기대와 다르다: ${JSON.stringify(cell.text ?? '')} (기대 ${JSON.stringify(text)})`);
}
function addLabels(def, pairs) {
  const have = new Set((def.manualFields ?? []).map((m) => m.name));
  def.manualFields = [...(def.manualFields ?? []), ...pairs.filter(([n]) => !have.has(n)).map(([name, label]) => ({ name, label }))];
}

/** 1. 신청서 — 1장 행 높이(남는 높이 extra 를 큰 칸에 비율로). */
function appHeights(page, extra) {
  const h = [...page.rowHeights];
  for (const [r, v] of Object.entries(APP_ORIGINAL)) h[+r] = v;
  const base = APP_BIG.reduce((a, r) => a + h[r], 0);
  for (const r of APP_BIG) h[r] = r2(h[r] + (extra * h[r]) / base);
  return h;
}

/**
 * 서명란 한 줄 — 이름 칸을 오른쪽으로 넓힌다(결정 2026-11-05: 0.85cm 라 이름이 세로로 한 자씩 찍혔다).
 * 열 폭은 그대로, 그 줄의 칸만 다시 나눈다: 이름 칸 = 지금 자리부터 NAME_MIN_CM 이상이 될 때까지,
 * 「(인)」 = 바로 다음 열부터 원래 너비 이상, 남는 오른쪽 = 빈 칸(없으면 없음). 칸의 모양(정렬 · 테두리 · 글자)은 그대로.
 */
const NAME_MIN_CM = 2.2; // 12pt 다섯 자 + 칸 안쪽 여백
function widenNameRow(page, row, nameCol, what) {
  const width = (from, span) => page.colWidths.slice(from, from + span).reduce((a, b) => a + b, 0);
  const name = cellOf(page, row, nameCol, what);
  const sealCol = nameCol + (name.colSpan ?? 1);
  const seal = cellOf(page, row, sealCol, what);
  expectText(seal, '(인)', what);
  const restCol = sealCol + (seal.colSpan ?? 1);
  const rest = page.cells.find((x) => x.row === row && x.col === restCol);
  const lastCol = page.colWidths.length;
  if (rest && restCol + (rest.colSpan ?? 1) !== lastCol) throw new Error(`${what} — ${row + 1}행 오른쪽 빈 칸이 줄 끝까지가 아니다`);
  if (rest && (rest.text ?? '') !== '') throw new Error(`${what} — ${row + 1}행 오른쪽 칸이 비어 있지 않다`);
  const sealWidth = width(sealCol, seal.colSpan ?? 1);
  let nSpan = name.colSpan ?? 1;
  while (width(nameCol, nSpan) < NAME_MIN_CM) nSpan++;
  const sCol = nameCol + nSpan;
  let sSpan = 1;
  while (sCol + sSpan < lastCol && width(sCol, sSpan) < sealWidth - 1e-9) sSpan++;
  if (sCol + sSpan > lastCol) throw new Error(`${what} — ${row + 1}행에 「(인)」 자리가 남지 않는다`);
  name.colSpan = nSpan;
  seal.col = sCol;
  seal.colSpan = sSpan;
  const rCol = sCol + sSpan;
  if (rest) {
    if (rCol < lastCol) { rest.col = rCol; rest.colSpan = lastCol - rCol; }
    else page.cells = page.cells.filter((x) => x !== rest);
  }
  return { 줄: row + 1, '이름 칸(cm)': r2(width(nameCol, nSpan)), '(인) 칸(cm)': r2(width(sCol, sSpan)) };
}
const widened = [];

/** 2. 의사록 — 2장을 1장으로 · 자리표시. */
function editMinutes(raw) {
  const next = structuredClone(raw);
  if (next.pages.length !== 2) throw new Error(`「${MIN}」 — 장이 ${next.pages.length}장이다(2장이어야 한다, 이미 합쳤으면 멈춘다)`);
  const [p1, p2] = next.pages;
  if (JSON.stringify(p1.colWidths) !== JSON.stringify(p2.colWidths)) throw new Error(`「${MIN}」 — 두 장의 열 폭이 다르다`);
  // 출석 현황 6칸(1장 9~11행)
  const counts = [[8, 'memberCount', 'unitsTotal'], [9, 'votingMemberCount', 'votingUnits'], [10, 'attendMemberCount', 'attendUnits']];
  for (const [r, m, u] of counts) {
    const a = cellOf(p1, r, 1, MIN); expectText(a, '명', MIN); a.text = `{{${m}}}명`;
    const b = cellOf(p1, r, 10, MIN); expectText(b, '좌', MIN); b.text = `{{${u}}}좌`;
  }
  // 회의 종료시각(2장 4행)
  const end = cellOf(p2, 3, 0, MIN);
  const endOld = '의장은 이상으로써 총회의 목적인 의안 전부에 대한 심의를 마쳤으므로 폐회한다고 선언하다. (회의 종료시각 )';
  expectText(end, endOld, MIN);
  end.text = endOld.replace('(회의 종료시각 )', '(회의 종료시각 {{meetingEndTime}})');
  // 서명란 의장 대표이사 이름(2장 9행 6열)
  expectText(cellOf(p2, 8, 2, MIN), '의장 대표이사', MIN);
  const chair = cellOf(p2, 8, 5, MIN); expectText(chair, '', MIN);
  chair.text = '{{ceoName}}'; chair.fontSize = 12; chair.valign = 'middle';
  // 서명란 이사 첫 줄 이름(2장 11행 5열) = 동의서와 같은 입력 `directorName` · 둘째 줄(13행)은 빈칸 그대로
  expectText(cellOf(p2, 10, 3, MIN), '이사', MIN);
  const director = cellOf(p2, 10, 4, MIN); expectText(director, '', MIN);
  director.text = '{{directorName}}'; director.fontSize = 12; director.valign = 'middle';
  // 서명란 이름 칸 넓히기 — 의장 · 이사 두 줄(둘째 이사 줄도 「(인)」 자리를 첫 줄과 맞춘다, 이름은 빈칸 그대로)
  for (const [r, col] of [[8, 5], [10, 4], [12, 4]]) widened.push({ 서식: MIN, ...widenNameRow(p2, r, col, MIN), '(2장 기준)': '' });
  // 합치기 — 2장 행을 1장 아래로
  const off = p1.rowHeights.length;
  p1.rowHeights = [...p1.rowHeights, ...p2.rowHeights];
  p1.cells = [...p1.cells, ...p2.cells.map((c) => ({ ...c, row: c.row + off }))];
  next.pages = [p1];
  addLabels(next, MIN_MANUAL);
  return next;
}

/** 3. 동의서 — 대표이사 · 이사 이름 칸. */
function editAgree(raw) {
  const next = structuredClone(raw);
  const p = next.pages[0];
  expectText(cellOf(p, 9, 3, AGREE), '대표이사', AGREE);
  const ceo = cellOf(p, 9, 6, AGREE); expectText(ceo, '', AGREE);
  ceo.text = '{{ceoName}}'; ceo.fontSize = 12; ceo.valign = 'middle';
  expectText(cellOf(p, 11, 4, AGREE), '이사', AGREE);
  const dir = cellOf(p, 11, 5, AGREE); expectText(dir, '', AGREE);
  dir.text = '{{directorName}}'; dir.fontSize = 12; dir.valign = 'middle';
  for (const [r, col] of [[9, 6], [11, 5]]) widened.push({ 서식: AGREE, ...widenNameRow(p, r, col, AGREE), '(2장 기준)': '' });
  addLabels(next, AGREE_MANUAL);
  return next;
}

async function main() {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const one = async (name) => {
      const rows = (await c.query(`SELECT id, name, definition, updated_at FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [name])).rows;
      if (rows.length !== 1) throw new Error(`「${name}」 이 ${rows.length}건이다(1건이어야 한다)`);
      return { id: rows[0].id, name, raw: rows[0].definition, updatedAt: rows[0].updated_at.toISOString() };
    };
    const app = await one(APP);
    const min = await one(MIN);
    const agree = await one(AGREE);
    const settings = (await c.query(
      `SELECT reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes, attachments, reg_purpose, reg_reason, matter_body
         FROM public.tb_s080_doc_form_settings WHERE operator_id = 1 AND domain = 'corp-change'`,
    )).rows.map((r) => ({ regTypeKey: r.reg_type_key, companyType: r.company_type ?? '', isActive: r.is_active, label: r.label, formNo: r.form_no, matter: r.matter, taxMode: r.tax_mode, taxes: r.taxes, attachments: r.attachments, regPurpose: r.reg_purpose, regReason: r.reg_reason, matterBody: r.matter_body }));
    const src = hqOutSource(settings);
    /** 서류 값 — 서버 값 + 출력 때 입력 견본(화면과 같은 얹기). */
    const valuesFor = (f, def) => {
      const docs = buildPrintDocuments([{ id: f.id, name: f.name, mark: def.legal, definition: def }], src, []);
      if (docs.length !== 1) throw new Error(`「${f.name}」 이 HQ_OUT · 유한회사 건에 뜨지 않는다`);
      return withManualValues(docs[0].sheets[0].values, MANUAL_SAMPLE);
    };

    // ── 1. 신청서 — 남는 높이를 재서 맞춘다(세 번까지 고쳐 잰다) ──
    const appDef0 = migrateDefinition(app.raw);
    const p0 = appDef0.pages[0];
    const appValues = valuesFor(app, appDef0);
    if (p0.rowHeights.length !== 15) throw new Error(`「${APP}」 1장 행이 ${p0.rowHeights.length}개다(15 여야 한다)`);
    const before = measure([{ id: 'b', page: p0, values: appValues, font: appDef0.font }]).b;
    if (before.ends.length && last(before.ends) > 20) throw new Error(`「${APP}」 1장이 이미 ${last(before.ends)}cm 다 — 이미 고친 것 같다`);
    const TARGET = PAGE_INNER_CM - 0.05;
    let extra = 0;
    let got = null;
    for (let i = 0; i < 4; i++) {
      const page = { ...p0, rowHeights: appHeights(p0, extra) };
      got = measure([{ id: 'a', page, values: appValues, font: appDef0.font }]).a;
      const diff = TARGET - last(got.ends);
      if (Math.abs(diff) < 0.02) break;
      extra = r2(extra + diff);
    }
    const appRows = appHeights(p0, extra);
    if (last(got.ends) > PAGE_INNER_CM) throw new Error(`「${APP}」 1장이 넘친다(${last(got.ends)}cm)`);
    const appNext = structuredClone(app.raw);
    appNext.pages[0].rowHeights = appRows;

    // ── 2. 의사록 ──
    let minNext = editMinutes(min.raw);
    let minDef = migrateDefinition(minNext);
    const minValues = valuesFor(min, minDef);
    let m1 = measure([{ id: 'm', page: minDef.pages[0], values: minValues, font: minDef.font }, { id: 'n', page: minDef.pages[0], values: minValues, font: minDef.font, allFit: true }]);
    let shrink = null;
    if (last(m1.m.ends) > PAGE_INNER_CM - 0.05) {
      // 내용보다 높은 행의 남는 높이만 같은 비율로 줄인다
      const natural = m1.n.heights;
      const slack = minDef.pages[0].rowHeights.map((h, r) => Math.max(0, h - natural[r]));
      const need = last(m1.m.ends) - (PAGE_INNER_CM - 0.10);
      const total = slack.reduce((a, b) => a + b, 0);
      if (total < need) throw new Error(`「${MIN}」 — 남는 높이를 다 줄여도 한 장에 안 든다(넘침 ${r2(need)}cm · 남는 높이 ${r2(total)}cm)`);
      const k = need / total;
      const rows = minDef.pages[0].rowHeights.map((h, r) => r2(Math.max(0.01, h - slack[r] * k)));
      minNext.pages[0].rowHeights = rows;
      minDef = migrateDefinition(minNext);
      m1 = measure([{ id: 'm', page: minDef.pages[0], values: minValues, font: minDef.font }]);
      shrink = { 줄인높이: r2(need), 비율: `${Math.round(k * 100)}%` };
    }
    if (last(m1.m.ends) > PAGE_INNER_CM) throw new Error(`「${MIN}」 — 한 장에 넘친다(${last(m1.m.ends)}cm)`);

    // ── 3. 동의서 ──
    const agreeNext = editAgree(agree.raw);
    const agreeDef = migrateDefinition(agreeNext);
    const agreeValues = valuesFor(agree, agreeDef);
    const a1 = measure([{ id: 'a', page: agreeDef.pages[0], values: agreeValues, font: agreeDef.font }]).a;
    if (last(a1.ends) > PAGE_INNER_CM) throw new Error(`「${AGREE}」 — 넘친다(${last(a1.ends)}cm)`);

    // ── 신청서 2장은 그대로 — 재서 보이기만 ──
    const app2 = measure([{ id: 'p2', page: appDef0.pages[1], values: appValues, font: appDef0.font }]).p2;

    // ── 보기 ──
    const names = ['', '양식호수', '(여백)', '제목', '접수', '제 호', '(여백)', '상호', '본점', '등기의 목적', '등기의 사유', '등기할 사항', '새 본점', '이전한 뜻과 연월일', '지배인', '상호 변경'];
    console.log(`\n■ 1. ${APP} — 1장 행 높이(cm). 원본 = 92-2 빈 서식 표 · 남는 높이 ${r2(extra)}cm 를 큰 칸 다섯에 비율로`);
    console.table(p0.rowHeights.map((h, r) => ({ 행: `${r + 1} ${names[r + 1]}`, 지금: h, 원본: APP_ORIGINAL[r] ?? '', 바꿈: appRows[r], 큰칸: APP_BIG.includes(r) ? '예' : '' })));
    console.log(`  표 끝: 지금 ${last(before.ends)}cm → ${last(got.ends)}cm / 한 장 ${PAGE_INNER_CM}cm (2장 그대로: ${last(app2.ends)}cm)`);

    const minTokens = definitionTokens(minDef);
    const known = new Set(CORP_CHANGE_PRINT_FIELDS.map((f) => f.name));
    console.log(`\n■ 2. ${MIN} — 2장 → 1장${shrink ? ` · 남는 높이만 줄임 ${JSON.stringify(shrink)}` : ' · 줄이지 않고 들어감'}`);
    console.log(`  표 끝 ${last(m1.m.ends)}cm / 한 장 ${PAGE_INNER_CM}cm · 행 ${minDef.pages[0].rowHeights.length}개`);
    console.table(minTokens.map((t) => ({ 자리표시: t, 값: known.has(t) ? '서버(건)' : '출력 때 입력', 이름표: (minDef.manualFields ?? []).find((m) => m.name === t)?.label ?? '', '견본 값': (minValues[t] ?? '').slice(0, 30) })));

    console.log('\n■ 서명란 이름 칸 넓히기 — 이름 칸 2.2cm 이상 · 「(인)」은 바로 다음 칸(의사록 줄 번호는 합치기 전 2장 기준)');
    console.table(widened.map(({ '(2장 기준)': _x, ...w }) => w));

    console.log(`\n■ 3. ${AGREE} — 표 끝 ${last(a1.ends)}cm / 한 장 ${PAGE_INNER_CM}cm`);
    console.table(definitionTokens(agreeDef).map((t) => ({ 자리표시: t, 값: known.has(t) ? '서버(건)' : '출력 때 입력', 이름표: (agreeDef.manualFields ?? []).find((m) => m.name === t)?.label ?? '', '견본 값': (agreeValues[t] ?? '').slice(0, 30) })));

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했다 — 쓰려면 --apply');
      return;
    }
    const writes = [[app, appNext], [min, minNext], [agree, agreeNext]];
    for (const [f, next] of writes) {
      migrateDefinition(next); // 검사
      const { rows } = await c.query(`SELECT updated_at FROM public.tb_s080_form_templates WHERE id = $1 FOR UPDATE`, [f.id]);
      if (rows.length !== 1 || rows[0].updated_at.toISOString() !== f.updatedAt) throw new Error(`「${f.name}」 이 보기 뒤에 바뀌었다`);
      await c.query(`UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = $3 WHERE id = $1`, [f.id, JSON.stringify(next), ACTOR]);
    }
    // 되읽기
    const after = [];
    for (const [f, next] of writes) {
      const r = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE id = $1`, [f.id])).rows[0];
      const same = canon(r.definition) === canon(next); // jsonb 는 키 순서를 바꾼다 — 키를 정렬해 비교
      const def = migrateDefinition(r.definition);
      after.push({ 서식: f.name, 장수: def.pages.length, 자리표시: definitionTokens(def).length, 이름표: (def.manualFields ?? []).length, '쓴 그대로': same ? '예' : '아니오' });
      if (!same) throw new Error(`「${f.name}」 되읽은 정의가 다르다 — 되돌린다`);
    }
    console.table(after);
    await c.query('COMMIT');
    console.log('적용했다 — 서식 3건');
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
