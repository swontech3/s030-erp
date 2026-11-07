/**
 * 일회용(2026-11-01) — 법무 서식 넘침 점검 + 넘치는 서식의 장 나누기.
 *
 * ★ 점검: 개발 DB 의 법무 서식 전부(정의에 `legal` 표시가 있는 양식 — 법인설립 · 법인변경 · 주식회사 · 유한회사)를
 *   **앱과 같은 인쇄 규칙**으로 헤드리스 Chrome 에 그려 장마다 높이를 잰다.
 *   · 앱 규칙(`form-doc.module.css` · `styles/print.css`): A4 · `@page` 여백 0 · 장(section)마다 높이 297mm ·
 *     위아래 padding 12mm · `overflow: hidden` · 표 위 여백 = 장의 `marginTop`(없으면 1.2cm) · 칸 줄 간격 1.5 ·
 *     `white-space: pre-wrap` · `word-break: break-all` · 칸 padding 0 2px · 행 높이 = 정의 값(글이 길면 늘어난다)
 *   · 한 장 = 27.30cm(297mm − 위아래 12mm). 이 높이를 넘으면 「넘침」, 28.50cm(아래 padding 끝)를 넘는 줄은
 *     종이에서 **잘린다**(overflow hidden).
 *   · 값: 출력 값 함수(shared)를 그대로 부른다 — 법인설립은 `buildIncorpPrintDocuments`, 법인변경은
 *     `buildPrintDocuments` · 등기 설정은 개발 DB 의 줄(`pickDocFormSetting`). 시험 건은 아래 `STOCK` · `LTD` · `CORP`.
 *     사람마다 양식은 장마다 재서 가장 높은 장을 쓴다. 법인변경은 그 양식이 뜨는 구분마다 재서 가장 높은 값을 쓴다.
 * ★ 고치기: 넘치는 장만 **의안 경계**(「제n호 의안」 행 앞)에서 다음 장으로 나눈다. 의안 경계로 못 나누면 문단 경계
 *   (글 없는 행 다음)에서 나눈다. 글 · 자리표시 · 칸 모양(열 폭 · 행 높이 · 테두리 · 글꼴) · 위 여백은 그대로다 —
 *   행을 옮기고 행 번호만 새 장 기준으로 다시 매긴다. 행을 걸치는 칸(rowSpan)이 경계에 걸리면 그 경계는 쓰지 않는다.
 *   나눈 뒤 모든 장을 같은 값으로 다시 재서 27.30cm 안인지, 마지막 글 줄(서명 줄)까지 장 안에 드는지 확인한다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 한 트랜잭션으로 넘치는 양식의 `definition` 만 고친다(`pages` 만 바뀐다).
 *   멈추는 경우(아무것도 쓰지 않는다): 나눌 경계가 없음 · 나눈 뒤에도 넘침 · 양식이 보기 때와 달라짐(수정 시각).
 *   쓰는 표: `tb_s080_form_templates`(고치기만).
 *
 *   npx tsx scripts/oneoff/2026-11-01-legal-form-page-split.mjs <admin.env>              (보기)
 *   npx tsx scripts/oneoff/2026-11-01-legal-form-page-split.mjs <admin.env> --apply      (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { migrateDefinition, parseDefinition, definitionTokens, DEFAULT_MARGIN_TOP } from '../../packages/shared/src/domain/form-template.ts';
import { buildIncorpPrintDocuments } from '../../packages/shared/src/domain/incorporation-print.ts';
import { buildIncorporationSnapshot, parseIncorpInfo } from '../../packages/shared/src/domain/incorporation-detail.ts';
import { INCORP_PURPOSE_MAX } from '../../packages/shared/src/domain/incorporation.ts';
import { readIncorpTaxSetting } from '../../packages/shared/src/domain/incorporation-tax.ts';
import { buildPrintDocuments, pickDocFormSetting } from '../../packages/shared/src/domain/corp-change-print.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-01-legal-form-page-split.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/** 한 장 안쪽 높이 · 잘리는 선(cm). */
const PAGE_INNER_CM = 29.7 - 1.2 * 2;
const CLIP_CM = 29.7 - 1.2;
const fmt = (n) => n.toFixed(2);

// =============================================================================
// 시험 건 — 긴 이름 · 긴 주소 · 목적 20줄
// =============================================================================
const PURPOSE_SAMPLES = ['소프트웨어 개발 및 공급업', '전자상거래 소매업(통신판매업)', '경영 컨설팅업', '정보통신 관련 연구개발 및 기술용역업', '광고 대행업 및 광고물 제작업', '부동산 임대업', '교육 서비스업(온라인 강의 포함)', '수출입업 및 무역 대행업', '데이터베이스 구축 및 온라인 정보 제공업', '인공지능 관련 소프트웨어 개발업'];
const PURPOSES = Array.from({ length: INCORP_PURPOSE_MAX }, (_, i) => PURPOSE_SAMPLES[i % PURPOSE_SAMPLES.length]).join('\n');
const ADDR = { zipCode: '06164', address: '서울 강남구 테헤란로 123', addressDetail: '4층 401호 (역삼동, 에스원비즈빌딩)' };
const RRN = '9001011234567';
const INPUTS = { applyDate: '2026-12-31', writeDate: '2026-12-31' };

/**
 * 주식회사 설립 시험 건 — 발기인 5명(정관 고정 배치의 최대) · 그중 이사 2명(대표 1) · 발기인 아닌 이사 1 · 감사 1
 * (조사보고인 둘). 유한회사 — 사원 2명(최대) 둘 다 이사 · 대표.
 */
const STOCK = {
  info: { nameKo: '가나다라마바사아자차카타', nameEn: 'Ganadara Global Solutions', hq: ADDR, capitalAmount: 500_000_000, parValue: 10_000, unitsAuthorized: 200_000, unitsIssued: 50_000, publicNoticeMethod: null, fiscalStart: '01-01', fiscalEnd: '12-31', plannedDate: '2026-12-31', meetingTime: '10:00', paymentBank: '국민은행 테헤란로중앙지점', ceoPhone: '02-1234-5678', purposes: PURPOSES },
  persons: [
    ['남궁가나다', { isFounder: true, isDirector: true, isRepresentative: true, unitsSubscribed: 10_000 }],
    ['선우라마바', { isFounder: true, isDirector: true, unitsSubscribed: 10_000 }],
    ['제갈사아자', { isFounder: true, unitsSubscribed: 10_000 }],
    ['황보차카타', { isFounder: true, unitsSubscribed: 10_000 }],
    ['독고파하가', { isFounder: true, unitsSubscribed: 10_000 }],
    ['사공나다라', { isDirector: true }],
    ['서문마바사', { isAuditor: true }],
  ],
  entity: 'R',
};
const LTD = {
  info: { nameKo: '유한회사 가나다라마바사아자차카타', nameEn: 'Ganadara Global Solutions', hq: ADDR, capitalAmount: 999_990_000, parValue: 10_000, fiscalStart: '01-01', fiscalEnd: '12-31', plannedDate: '2026-12-31', meetingTime: '10:00', ceoPhone: '02-1234-5678', purposes: PURPOSES },
  persons: [
    ['남궁가나다', { isFounder: true, isDirector: true, isRepresentative: true, unitsSubscribed: 50_000 }],
    ['선우라마바', { isFounder: true, isDirector: true, isRepresentative: true, unitsSubscribed: 49_999 }],
  ],
  entity: 'A',
};
function incorpSource(t, settings) {
  const info = parseIncorpInfo(t.info);
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

/** 법인변경 시험 건 — 구분마다. 임원은 선임 2 · 중임 1 · 사임 1(긴 주소 · 긴 사임사유). */
const CORP_OFFICERS = [
  { name: '남궁가나다', changeKind: 'APPOINT', position: '사내이사' },
  { name: '선우라마바', changeKind: 'APPOINT', position: '사내이사' },
  { name: '제갈사아자', changeKind: 'REELECT', position: '대표이사' },
  { name: '황보차카타', changeKind: 'RESIGN', position: '감사', resignReason: '일신상의 사유로 인하여 감사직을 사임하고자 하오니 이를 수리하여 주시기 바랍니다' },
].map((o) => ({ effectiveDate: '2026-12-31', ...ADDR, resignReason: null, ...o, rrn: RRN }));
function corpSource(changeType, memberType, settings) {
  const payload = {
    NAME: { newName: '주식회사 가나다라마바사아자차카타파하글로벌솔루션', resolutionDate: '2026-12-31' },
    HQ: { newHqAddress: ADDR, resolutionDate: '2026-12-31' },
    PURPOSE: { purposes: PURPOSES, resolutionDate: '2026-12-31' },
    OFFICER: { resolutionDate: '2026-12-31' },
    CEO_ADDR: { newCeoAddress: ADDR, moveInDate: '2026-12-31' },
  }[changeType] ?? {};
  const snapshot = {
    version: 3, changeType,
    company: { isTenant: false, name: '주식회사 가나다라마바사아자차카타', corpNumber: '110111-1234567', bizNumber: '123-45-67890', ceoName: '제갈사아자', tel: '02-1234-5678', memberType, head: ADDR, ceoHome: ADDR },
    payload,
    officers: changeType === 'OFFICER' ? CORP_OFFICERS.map(({ rrn: _r, ...o }) => o) : [],
  };
  return {
    src: { snapshot, setting: pickDocFormSetting(settings, changeType, memberType), changeTypeName: changeType, inputs: INPUTS },
    officers: changeType === 'OFFICER' ? CORP_OFFICERS : [],
  };
}

// =============================================================================
// 그리기 · 재기 — FormDocument 와 같은 칸(덮인 자리는 건너뛰고, 칸이 없는 자리는 테두리 있는 빈 칸)
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
/** 장마다 — 행 끝 위치(장 안쪽 맨 위에서, cm). */
function measure(items) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0} .page{width:210mm;box-sizing:border-box;padding:12mm 0;display:flex;flex-direction:column;align-items:center;margin-bottom:20px}
table{border-collapse:collapse;table-layout:fixed} td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5}
</style></head><body>${items.map((t) => pageHtml(t.id, t.page, t.values, t.font)).join('')}<script>
const cm=(p)=>p*2.54/96; const out={};
document.querySelectorAll('section').forEach((s)=>{const top=s.getBoundingClientRect().top+s.getBoundingClientRect().height-s.clientHeight+(parseFloat(getComputedStyle(s).paddingTop));
 const t0=s.getBoundingClientRect().top+parseFloat(getComputedStyle(s).paddingTop);
 out[s.dataset.id]=[...s.querySelectorAll('tr')].map((tr)=>+cm(tr.getBoundingClientRect().bottom-t0).toFixed(3));});
document.body.setAttribute('data-out',encodeURIComponent(JSON.stringify(out)));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-split-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=5000', '--dump-dom', 'file:///' + file.split(path.sep).join('/')], { maxBuffer: 1 << 28, timeout: 180000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return JSON.parse(decodeURIComponent(m[1]));
}

const rowText = (page, r) => page.cells.filter((c) => c.row === r && c.text).map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
const isAgenda = (page, r) => /^제\s*\d+\s*호\s*의\s*안/.test(rowText(page, r));
const isBlank = (page, r) => rowText(page, r) === '';
const crosses = (page, b) => page.cells.some((c) => c.row < b && c.row + (c.rowSpan ?? 1) > b);
const lastTextRow = (page) => { for (let r = page.rowHeights.length - 1; r >= 0; r--) if (!isBlank(page, r)) return r; return -1; };

/** 행 [from, to) 를 새 장으로 — 칸 · 높이 · 열 폭 · 위 여백 그대로, 행 번호만 당긴다. */
function slicePage(page, from, to) {
  return {
    ...page,
    rowHeights: page.rowHeights.slice(from, to),
    cells: page.cells.filter((c) => c.row >= from && c.row < to).map((c) => ({ ...c, row: c.row - from })),
  };
}

/** 조 · 장 제목 — 「제n조 (…)」 · 「제 n 장 …」(굵게). */
const isArticle = (page, r) => /^제\s*\d+\s*(조|장)/.test(rowText(page, r)) && page.cells.some((c) => c.row === r && c.text && c.bold);
/** 제목 행 — 한 줄을 다 쓰는 굵은 칸 하나(자리표시만 든 줄은 빼고). 「결의안건 및 내용」 · 「출석 현황」 등. */
const isHeading = (page, r) => {
  const cs = page.cells.filter((c) => c.row === r && c.text);
  return cs.length === 1 && cs[0].bold && (cs[0].colSpan ?? 1) === page.colWidths.length && !/^\s*\{\{[^}]+\}\}\s*$/.test(cs[0].text);
};
const isTitleLike = (page, r) => isAgenda(page, r) || isArticle(page, r) || isHeading(page, r);

/**
 * 넘치는 장 하나를 나눈다 — 잰 행 끝(`ends`, 위 여백 포함)으로 첫 조각이 27.30cm 안에 드는 가장 늦은 경계.
 * 경계 순서: ① 의안 경계(「제n호 의안」 행 앞) ② 조 · 장 제목 행 앞 ③ 제목 행 앞 ④ 문단 경계(글 없는 행 다음).
 * ★ 제목을 장 끝에 홀로 남기지 않는다 — 경계 바로 앞(빈 행 건너)의 글 줄이 제목이면 그 경계는 쓰지 않는다.
 * 남은 조각은 다시 재서 또 나눈다(부르는 쪽).
 */
function splitPoint(page, ends) {
  const prevText = (b) => { for (let r = b - 1; r >= 0; r--) if (!isBlank(page, r)) return r; return -1; };
  const ok = (b) => b > 0 && ends[b - 1] <= PAGE_INNER_CM + 1e-9 && !crosses(page, b) && prevText(b) >= 0 && !isTitleLike(page, prevText(b));
  const n = page.rowHeights.length;
  const lists = [
    ['의안 경계', (b) => isAgenda(page, b)],
    ['조 · 장 경계', (b) => isArticle(page, b)],
    ['제목 경계', (b) => isHeading(page, b)],
    ['문단 경계', (b) => isBlank(page, b - 1) && !isBlank(page, b)],
  ];
  for (const [kind, test] of lists) {
    let at;
    for (let b = 1; b < n; b++) if (test(b) && ok(b)) at = b;
    if (at !== undefined) return { at, kind };
  }
  return null;
}

// =============================================================================
// 보기 · 쓰기
// =============================================================================
(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const problems = [];
    const forms = (await c.query(
      `SELECT id, name, definition, updated_at FROM public.tb_s080_form_templates WHERE operator_id = 1 AND definition ? 'legal' ORDER BY name`,
    )).rows.map((r) => ({ id: r.id, name: r.name, raw: r.definition, updatedAt: r.updated_at.toISOString(), def: migrateDefinition(r.definition) }));
    const settingRows = (await c.query(
      `SELECT domain, reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes, attachments, reg_purpose, reg_reason, matter_body
         FROM public.tb_s080_doc_form_settings WHERE operator_id = 1`,
    )).rows.map((r) => ({ domain: r.domain, regTypeKey: r.reg_type_key, companyType: r.company_type ?? '', isActive: r.is_active, label: r.label, formNo: r.form_no, matter: r.matter, taxMode: r.tax_mode, taxes: r.taxes, attachments: r.attachments, regPurpose: r.reg_purpose, regReason: r.reg_reason, matterBody: r.matter_body }));
    const incorpSettings = settingRows.filter((r) => r.domain === 'incorporation');
    const corpSettings = settingRows.filter((r) => r.domain === 'corp-change');

    // 양식마다 값 묶음(장 하나 = 값 하나) — 출력 값 함수가 이 양식에 내는 장 전부
    const valueSets = new Map(forms.map((f) => [f.id, []]));
    const marked = (domain) => forms.filter((f) => f.def.legal?.domain === domain).map((f) => ({ id: f.id, name: f.name, mark: f.def.legal, definition: f.def, tokens: definitionTokens(f.def) }));
    for (const t of [STOCK, LTD]) {
      for (const d of buildIncorpPrintDocuments(marked('incorporation'), incorpSource(t, incorpSettings))) {
        for (const s of d.sheets) valueSets.get(d.formId).push({ label: `${t.entity === 'A' ? '유한회사' : '주식회사'}${s.personName ? ` · ${s.personName}` : ''}`, values: s.values });
      }
    }
    for (const changeType of ['NAME', 'HQ', 'PURPOSE', 'OFFICER', 'CEO_ADDR']) {
      for (const memberType of ['R', 'A']) {
        const { src, officers } = corpSource(changeType, memberType, corpSettings);
        for (const d of buildPrintDocuments(marked('corp-change'), src, officers)) {
          for (const s of d.sheets) valueSets.get(d.formId).push({ label: `${changeType} · ${memberType}${s.officerName ? ` · ${s.officerName}` : ''}`, values: s.values });
        }
      }
    }

    // 재기 — 양식 · 장 · 값마다. 장마다 가장 높은 값을 쓴다
    const measureForms = (list) => {
      const items = [];
      for (const f of list) {
        const sets = valueSets.get(f.id);
        f.def.pages.forEach((p, pi) => sets.forEach((s, si) => items.push({ id: `${f.id}|${pi}|${si}`, page: p, values: s.values, font: f.def.font })));
      }
      const got = measure(items);
      const out = new Map();
      for (const f of list) {
        const sets = valueSets.get(f.id);
        out.set(f.id, f.def.pages.map((p, pi) => {
          let worst = null;
          sets.forEach((s, si) => {
            const ends = got[`${f.id}|${pi}|${si}`];
            const h = ends[ends.length - 1] ?? 0;
            if (!worst || h > worst.h) worst = { h, ends, label: s.label, values: s.values };
          });
          return worst;
        }));
      }
      return out;
    };

    const noValues = forms.filter((f) => valueSets.get(f.id).length === 0);
    for (const f of noValues) problems.push(`「${f.name}」 — 시험 건에서 뜨지 않는다(값 없음)`);
    const live = forms.filter((f) => valueSets.get(f.id).length > 0);
    const before = measureForms(live);

    console.log('■ 점검 — 앱 인쇄 규칙 · 한 장 27.30cm · 28.50cm 넘는 줄은 잘린다');
    console.log('| 서식 | 장 | 높이(cm) | 가장 높은 값 | 넘침 · 잘리는 줄 |');
    console.log('|---|---|---|---|---|');
    const over = [];
    for (const f of live) {
      before.get(f.id).forEach((w, pi) => {
        const page = f.def.pages[pi];
        const overRows = w.ends.map((e, r) => ({ e, r })).filter((x) => x.e > PAGE_INNER_CM + 1e-9 && !isBlank(page, x.r));
        const clipRows = overRows.filter((x) => x.e > CLIP_CM);
        const note = overRows.length === 0 ? '' : `★ 넘침 — 잘리는 줄 ${clipRows.length}개: ${clipRows.map((x) => `r${x.r} 「${fillText(rowText(page, x.r), w.values).slice(0, 18)}」`).join(' · ') || '없음(아래 여백 안)'}`;
        console.log(`| ${f.name} | ${pi + 1}/${f.def.pages.length} | ${fmt(w.h)} | ${w.label} | ${note} |`);
        if (overRows.length) over.push(f);
      });
    }
    const overForms = [...new Set(over)];

    // 고치기 — 넘치는 양식만, 넘치는 장만 나눈다(나눈 조각을 다시 재며 반복)
    const fixed = [];
    for (const f of overForms) {
      const sets = valueSets.get(f.id);
      let pages = [...f.def.pages];
      const log = [];
      for (let guard = 0; guard < 20; guard++) {
        const tmp = { ...f, def: { ...f.def, pages } };
        const m = measureForms([tmp]).get(f.id);
        const pi = m.findIndex((w) => w.h > PAGE_INNER_CM + 1e-9);
        if (pi < 0) break;
        // 값마다 재서 가장 높은 행 끝으로 경계를 고른다(어느 값이든 첫 조각이 들어가게)
        const page = pages[pi];
        const all = measure(sets.map((s, si) => ({ id: `s${si}`, page, values: s.values, font: f.def.font })));
        const ends = page.rowHeights.map((_, r) => Math.max(...Object.values(all).map((e) => e[r])));
        const sp = splitPoint(page, ends);
        if (!sp) { problems.push(`「${f.name}」 ${pi + 1}장 — 나눌 경계가 없다`); break; }
        const head = slicePage(page, 0, sp.at);
        const tail = slicePage(page, sp.at, page.rowHeights.length);
        const after = pages[pi + 1];
        // 다음 장이 같은 열 폭 · 위 여백이면 남은 행을 그 장 맨 앞으로 넘긴다(장이 반쯤 빈 채로 늘어나지 않게).
        // 다르면(표지 · 다른 표) 새 장을 끼운다. 어느 쪽이든 행 순서 · 칸 모양은 그대로다
        const sameShape = after && JSON.stringify(after.colWidths) === JSON.stringify(page.colWidths) && (after.marginTop ?? null) === (page.marginTop ?? null);
        if (sameShape) {
          const merged = { ...after, rowHeights: [...tail.rowHeights, ...after.rowHeights], cells: [...tail.cells, ...after.cells.map((x) => ({ ...x, row: x.row + tail.rowHeights.length }))] };
          pages = [...pages.slice(0, pi), head, merged, ...pages.slice(pi + 2)];
          log.push(`${pi + 1}장 r${sp.at} 「${rowText(page, sp.at).slice(0, 20)}」부터 다음 장 앞으로(${sp.kind})`);
        } else {
          pages = [...pages.slice(0, pi), head, tail, ...pages.slice(pi + 1)];
          log.push(`${pi + 1}장 r${sp.at} 「${rowText(page, sp.at).slice(0, 20)}」부터 새 장(${sp.kind})`);
        }
      }
      const next = parseDefinition({ ...f.def, pages });
      if (f.def.manualFields) next.manualFields = f.def.manualFields;
      // 장 말고는 그대로인가(글꼴 · 법무 표시 · 이름표 등)
      const rest = (d) => JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'pages').sort()));
      if (rest(next) !== rest(f.def)) problems.push(`「${f.name}」 — 장 말고 다른 칸이 달라졌다`);
      // 대조 — 글 · 자리표시 · 칸 모양이 그대로인가(행을 이어 붙이면 원래 장과 같아야 한다)
      const flat = (def) => JSON.stringify(def.pages.flatMap((p) => p.rowHeights.map((h, r) => ({ h, cs: p.colWidths, mt: p.marginTop ?? null, cells: p.cells.filter((x) => x.row === r).map(({ row: _r, ...x }) => x).sort((a, b) => a.col - b.col) }))));
      if (flat(next) !== flat(f.def)) problems.push(`「${f.name}」 — 나눈 뒤 행을 이어 붙인 것이 원래와 다르다`);
      if (JSON.stringify(definitionTokens(next)) !== JSON.stringify(definitionTokens(f.def))) problems.push(`「${f.name}」 — 자리표시가 달라졌다`);
      fixed.push({ f, next, log });
    }

    if (fixed.length) {
      console.log('\n■ 고치기 — 넘치는 서식만 장을 나눈다(글 · 자리표시 · 칸 모양 그대로)');
      const after = measureForms(fixed.map((x) => ({ ...x.f, def: x.next })));
      for (const { f, next, log } of fixed) {
        console.log(`  「${f.name}」 ${f.def.pages.length}장 → ${next.pages.length}장 · ${log.join(' · ')}`);
        after.get(f.id).forEach((w, pi) => {
          const page = next.pages[pi];
          const lt = lastTextRow(page);
          const fits = w.h <= PAGE_INNER_CM + 1e-9;
          if (!fits) problems.push(`「${f.name}」 나눈 뒤 ${pi + 1}장 넘침(${fmt(w.h)}cm)`);
          console.log(`    ${pi + 1}장 — 행 ${page.rowHeights.length}개 · ${fmt(w.h)} / ${fmt(PAGE_INNER_CM)}cm (${w.label})${fits ? '' : ' ★ 넘침'} · 마지막 줄 r${lt} 「${fillText(rowText(page, lt), w.values).slice(0, 30)}」 끝 ${fmt(w.ends[lt])}cm`);
        });
      }
    } else {
      console.log('\n넘치는 서식이 없다 — 고칠 것 없음');
    }

    if (problems.length) throw new Error(problems.join(' / '));
    if (!APPLY) {
      console.log(`\n보기만 했습니다 — 고칠 양식 ${fixed.length}건. 쓰려면 --apply`);
      return;
    }
    await c.query('BEGIN');
    for (const { f, next } of fixed) {
      const { rows } = await c.query(`SELECT updated_at FROM public.tb_s080_form_templates WHERE id = $1 FOR UPDATE`, [f.id]);
      if (rows.length !== 1 || rows[0].updated_at.toISOString() !== f.updatedAt) throw new Error(`「${f.name}」 이 보기 뒤에 바뀌었다`);
      await c.query(`UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = 'oneoff-2026-11-01' WHERE id = $1`, [f.id, JSON.stringify(next)]);
    }
    await c.query('COMMIT');
    console.log(`\n썼습니다 — 양식 ${fixed.length}건`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
