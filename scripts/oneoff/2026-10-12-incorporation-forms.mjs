/**
 * 일회용(2026-10-12) — 법인설립 서류 7종을 **법무 표양식**(법무 표시: 업무 법인설립)으로 등록한다(10-5).
 *
 *   설립등기신청서(건마다 · 3장) · 주주전원서면결의서(건마다) · 취임승낙서(임원마다) · 주식발행사항동의서(건마다)
 *   · 주식인수증(발기인마다) · 조사보고서(건마다) · 정관(건마다 · 표지 + 본문 여러 장)
 *
 * ★ 원문은 **레거시 화면**이다(결정 2026-10-11 — 5): `S-WonERP/src/components/incorporation/documents/*.tsx`.
 *   문구는 그대로 옮기고(주식회사 용어로 푼 것), 값 자리만 자리표시(shared `INCORP_PRINT_FIELDS`)로 바꿨다.
 *   · 정관은 `2026-10-12-incorporation-articles.json`(ArticlesDoc 53조를 뽑은 것 — 바꾼 곳은 그 파일의 `replaced`)
 *   · 나머지 6종은 이 파일에 옮겨 적었다. 레거시 원본이 이 PC 에 있으면 **글자 조각이 원본에 있는지** 대조한다
 *     (`--check` 기본 켬, 원본이 없으면 건너뛴다)
 * ★ 행 높이는 **최대 인원**으로 잰다 — 표양식 엔진은 칸 높이가 고정이라 그보다 많으면 칸이 넘친다.
 *   최대(아래 `CAPACITY`)는 보고 대상이다. 재는 법: 헤드리스 Chrome 으로 엔진과 같은 칸 규칙(줄간격 1.5 ·
 *   좌우 2px · 줄바꿈 유지 · 글자 단위 줄넘김)으로 그리고 행마다 높이를 읽는다(그래서 Chrome 이 있어야 한다).
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 한 트랜잭션으로 쓴다. 같은 이름의 양식이 하나라도 있으면
 *   아무것도 쓰지 않고 멈춘다(두 번 돌려도 안전). 정의는 shared `parseDefinition` 을 통과해야 한다.
 * ★ 1장 서류가 1장을 넘거나, 이름표 밖 자리표시가 있거나, 대조가 실패하면 멈춘다.
 *
 *   npx tsx scripts/oneoff/2026-10-12-incorporation-forms.mjs .env              (보기)
 *   npx tsx scripts/oneoff/2026-10-12-incorporation-forms.mjs .env --apply      (쓰기)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseDefinition, definitionTokens } from '../../packages/shared/src/domain/form-template.ts';
import {
  INCORP_PRINT_FIELDS,
  buildIncorpCasePrintValues,
  buildIncorpPersonPrintValues,
} from '../../packages/shared/src/domain/incorporation-print.ts';
import { buildIncorporationSnapshot, parseIncorpInfo } from '../../packages/shared/src/domain/incorporation-detail.ts';
import { pickDocFormSetting } from '../../packages/shared/src/domain/corp-change-print.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-10-12-incorporation-forms.mjs <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '../..');
const LEGACY = path.join(ROOT, 'S-WonERP/S-WonERP/src/components/incorporation/documents');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** 종이 안쪽 높이(cm) — A4 29.7 에서 `form-doc.module.css` 의 위아래 12mm 를 뺀다. */
const PAGE_INNER_CM = 29.7 - 1.2 * 2;
/** 위 여백 — 법인변경 법무 양식과 같다(종이 1.2 + 0.8 = 2.0cm). */
const MARGIN_TOP = 0.8;
const USABLE = PAGE_INNER_CM - MARGIN_TOP;
const FONT = '바탕';
const W = 17; // 본문 폭(cm)
const px = (n) => +(n * 2.54 / 96).toFixed(2); // 레거시 Tailwind px → cm
const pt = (n) => +(n * 0.75).toFixed(2); // 레거시 px → pt
const NO = { top: false, right: false, bottom: false, left: false };
const LABELS = Object.fromEntries(INCORP_PRINT_FIELDS.map((f) => [f.name, f.label]));

/**
 * 최대 인원 — 이 수까지는 칸이 넘치지 않게 높이를 잡는다(보고 대상).
 * 사업목적 · 발기인은 정관 고정 배치의 한도(결정 2026-10-11 — 20줄 · 5명)와 같다.
 */
const CAPACITY = { purposes: 20, founders: 5, directorsAuditors: 5, representatives: 2, reporters: 3 };

// =============================================================================
// 행 만들기 — { h: 최소 높이(cm), cells: [{ col, span, rowSpan, text, align, valign, bold, fontSize, border }] }
// =============================================================================
const gap = (h) => ({ h, cells: [] }); // 빈 줄(테두리 없음)
/** 테두리 없는 한 줄(모든 열). */
const text = (t, o = {}) => ({ h: o.h ?? 0, keepWithNext: o.keepWithNext, cells: [{ col: 0, span: 'all', text: t, align: o.align ?? 'left', valign: o.valign ?? 'top', bold: o.bold, fontSize: o.fontSize, border: o.border ?? NO }] });

// =============================================================================
// 1장짜리 글 서류 — 레거시 DocTitle(24px 굵게 가운데) · 본문 14px
// =============================================================================
const BODY = pt(14); // 10.5pt
const TITLE = pt(24); // 18pt
const title = (t) => text(t, { align: 'center', valign: 'middle', bold: true, fontSize: TITLE, h: 1.2 });

/** 주주전원서면결의서 — 레거시 ShareholderResolutionDoc. */
const RESOLUTION = [
  title('주주전원서면결의서'),
  gap(px(40)),
  text('1. 상 호 : {{companyName}}'),
  text('2. 본 점 : {{hqAddress}}'),
  text('3. 발행할 주식의 총수 : {{unitsAuthorized}} 주'),
  text('4. 1주의 금액 : 금 {{parValue}} 원'),
  text('5. 설립 시 발행하는 주식의 총수 : 보통주식 {{unitsIssued}} 주'),
  text('6. 자본금의 액 : 금 {{capitalAmount}} 원'),
  gap(px(32)),
  text('　위 회사의 주주 전원은 상법 제363조 제4항에 의거하여 총회의 소집 절차 없이 서면으로써 아래 의안에 대하여 전원 일치로 결의한다.'),
  gap(px(24)),
  text('[기재 변경 및 출석 주주 현황]', { bold: true }),
  text('- 총 발행주식수 : {{unitsIssued}} 주\n- 주주 전원의 주식수 : {{founderUnitsTotal}} 주 (100%)\n- 가결 주식수 : {{founderUnitsTotal}} 주 (전원 일치)'),
  gap(px(24)),
  text('[제1호 의안] 정관 승인의 건', { bold: true }),
  text('　주주 전원은 발기인이 작성한 {{companyName}}의 정관 초안을 면밀히 검토하고, 전원 일치로 이를 승인 가결하다.'),
  gap(px(24)),
  text('[제2호 의안] 이사 및 감사 선임의 건', { bold: true }),
  text('　회사의 규정에 따라 본 회사를 경영하고 감시할 임원으로 아래의 사람들을 전원 일치로 선임하다.\n{{resolutionOfficerList}}\n　(위 피선임자들은 즉석에서 그 취임을 각 승낙하다.)'),
  gap(px(24)),
  text('[제3호 의안] 대표이사 선임 및 본점 구체적 장소 결정의 건', { bold: true }),
  text('　본 회사는 자본금 10억 원 이하의 소규모 법인으로서 상법 제383조 특례 및 주주 전원의 동의에 따라, 이사회 권한인 대표이사 선임 및 본점의 구체적인 장소 결정을 본 주주전원서면결의로 통합하여 처리하기로 합의하고 다음과 같이 전원 일치로 결의하다.'),
  text('1) 대표이사 선임 :\n{{resolutionRepresentativeList}}\n2) 본점 구체적 장소 결정 :\n- 본점의 구체적인 영업 장소를 아래 주소지로 결정한다.\n- 본점 소재지 : {{hqAddress}}'),
  gap(px(32)),
  text('　이상으로써 의안의 심의를 모두 마쳤으므로 본 서면결의를 명확히 하기 위하여 결의서를 작성하고 주주 전원이 기명날인 또는 서명한다.'),
  gap(px(40)),
  text('{{writeDate}}', { align: 'center' }),
  gap(px(40)),
  text('{{companyName}}'),
  gap(px(24)),
  text('{{shareholderSignList}}'),
];

/** 취임승낙서 — 레거시 AcceptanceDoc(임원마다 한 장). */
const ACCEPTANCE = [
  gap(px(24)),
  text('{{personRole}} 취임승낙서', { align: 'center', valign: 'middle', bold: true, fontSize: pt(26), h: 1.3 }),
  gap(px(48)),
  text('주소 : {{personAddress}}'),
  text('성명 : {{personName}}'),
  text('주민등록번호 : {{personRrn}}'),
  gap(px(64)),
  text('　본인은 {{appointedDate}} 귀사의 이사회에서 {{personRole}}로 선임되었으므로 그 취임을 승낙합니다.'),
  gap(px(80)),
  text('{{writeDate}}', { align: 'center' }),
  gap(px(48)),
  text('{{personName}}　　(인)', { align: 'center', fontSize: pt(15) }),
  gap(6), // mt-auto — 맺음을 아래로 민다
  text('{{companyName}} 귀중', { align: 'center', fontSize: pt(15) }),
];

/** 주식발행사항동의서 — 레거시 StockIssuanceConsentDoc. */
const ISSUANCE = [
  title('주식 발행사항 동의서'),
  gap(px(40)),
  text('　발기인 전원의 동의로서 회사 설립시 발행할 주식에 관한 사항을 다음과 같이 결정함.'),
  gap(px(24)),
  text('다　음', { align: 'center' }),
  gap(px(24)),
  text('1. 주식의 종류와 수 : 보통주식 {{unitsIssued}} 주'),
  text('2. 주식의 발행가액 : 1주의 금액 금 {{parValue}} 원'),
  text('3. 주식의 총수와 주식금액 : {{unitsIssued}} 주, 금 {{capitalAmount}} 원'),
  gap(px(48)),
  text('　위 동의사항을 확실히 하기 위하여 발기인 전원이 다음에 기명날인하다.'),
  gap(px(40)),
  text('{{writeDate}}', { align: 'center' }),
  gap(px(40)),
  text('{{companyName}}'),
  gap(px(32)),
  text('{{founderSignList}}'),
];

/** 주식인수증 — 레거시 SubscriptionDoc(발기인마다 한 장). */
const SUBSCRIPTION = [
  title('주식인수증'),
  gap(px(40)),
  text('1. 상호 : {{companyName}}'),
  text('2. 인수할 주식의 종류와 수 : 보통주 {{personUnits}} 주'),
  text('3. 위 총액 : 금 {{personAmount}} 원'),
  text('4. 1주의 금액 : 금 {{parValue}} 원'),
  text('5. 납입기관 및 장소 : ____________________'),
  gap(px(56)),
  text('　위의 주식을 발기인으로서 인수합니다.'),
  gap(px(64)),
  text('{{writeDate}}', { align: 'center' }),
  gap(px(48)),
  text('발기인 {{personName}} (주민등록번호 {{personRrn}})　　(인)', { align: 'right' }),
  text('주소 : {{personAddress}}', { align: 'right' }),
];

/** 조사보고서 — 레거시 InvestigationReportDoc. */
const INVESTIGATION = [
  title('조　사　보　고　서'),
  gap(px(40)),
  text('1. 상 호 : {{companyName}}'),
  text('2. 본 점 : {{hqAddress}}'),
  text('3. 조사의 목적 : {{companyName}} 설립에 관한 제반의 사항 조사'),
  gap(px(32)),
  text('　본인은 상기 회사의 설립에 있어 상법 제298조의 규정에 의거, 회사의 설립에 관한 다음 사항을 조사하였기에 보고합니다.'),
  gap(px(24)),
  text('[조사 사항 및 결과]', { bold: true }),
  gap(px(16)),
  text('1. 정관의 점검\n- 발기인이 작성한 정관의 내용을 면밀히 검토한바, 상법 및 기타 관계 법령에 배치되거나 부당한 사항이 없음을 확인하였습니다.'),
  gap(px(16)),
  text('2. 주식의 인수 및 주금의 납입 상황\n- 회사가 설립 시 발행하는 보통주식 총수 {{unitsIssued}}주에 대하여 발기인이 정당하게 인수하였음을 주식인수증과 대조하여 확인하였습니다.\n- 또한, 해당 주식에 대한 주금 총액 {{capitalAmount}}원이 지정 금융기관(은행)의 발기인 대표 계좌에 전액 이상 없이 납입되었음을 잔고증명서와 대조하여 검증하였습니다.'),
  gap(px(16)),
  text('3. 현물출자 등에 관한 사항\n- 상법 제289조 제2항 각호에 규정된 변태설립사항(현물출자, 재산인수 등)은 본 회사 정관에 전혀 기재된 바 없으므로, 이에 대한 별도의 감정인 조사 절차는 필요치 않음을 확인하였습니다.'),
  gap(px(16)),
  text('4. 결론\n- 본 회사의 설립 절차는 상법 등 제반 법령을 전적으로 준수하였으며, 설립 경위 및 주금 납입 과정에 있어 어떠한 위법이나 부당한 사항도 발견되지 아니하였음을 보고합니다.'),
  gap(px(40)),
  text('{{writeDate}}', { align: 'center' }),
  gap(px(40)),
  text('{{companyName}}'),
  gap(px(24)),
  text('{{reporterList}}'),
];

// =============================================================================
// 설립등기신청서 — 레거시 RegistrationAppDoc([양식 제65-1호] 3장). 표 칸 = 테두리 있는 칸
// =============================================================================
/** 열 경계(%) 여럿을 합쳐 한 격자로 — 표마다 열이 달라도 한 장의 표 하나로 그린다. */
function unionCols(...percentLists) {
  const edges = new Set([0, 100]);
  for (const list of percentLists) {
    let acc = 0;
    for (const p of list) { acc += p; edges.add(+acc.toFixed(4)); }
  }
  const e = [...edges].sort((a, b) => a - b);
  return { edges: e, widths: e.slice(1).map((v, i) => +(((v - e[i]) / 100) * W).toFixed(3)) };
}
const REG = pt(10.5); // 8pt
const regCell = (o) => ({ align: 'left', valign: 'top', fontSize: REG, ...o });
const L = (o) => regCell({ align: 'center', valign: 'middle', ...o }); // 라벨 칸
/** 표 하나의 열(%)을 합친 격자의 열 번호로 바꾼다. */
const spanOf = (grid, fromPct, toPct) => {
  const a = grid.edges.indexOf(+fromPct.toFixed(4));
  const b = grid.edges.indexOf(+toPct.toFixed(4));
  if (a < 0 || b < 0) throw new Error(`격자에 없는 경계 ${fromPct}~${toPct}`);
  return { col: a, span: b - a };
};

const regPage1 = (() => {
  const head = [15, 35, 16, 17, 17];
  const two = [27, 73];
  const g = unionCols(head, two);
  const hc = (i, j = i) => spanOf(g, head.slice(0, i).reduce((a, b) => a + b, 0), head.slice(0, j + 1).reduce((a, b) => a + b, 0));
  const lab = spanOf(g, 0, 27);
  const val = spanOf(g, 27, 100);
  const all = spanOf(g, 0, 100);
  const pair = (label, value, h = 0) => ({ h, cells: [L({ ...lab, text: label }), regCell({ ...val, text: value })] });
  return {
    cols: g.widths,
    rows: [
      { h: 0, cells: [L({ ...all, text: '주식회사 설립 등기신청', fontSize: pt(15), bold: true })] },
      { h: 0, cells: [L({ ...hc(0), rowSpan: 2, text: '접   수' }), L({ ...hc(1), text: '년    월    일' }), L({ ...hc(2), rowSpan: 2, text: '처 리 인' }), L({ ...hc(3), text: '등기관 확인' }), L({ ...hc(4), text: '각종 통지' })] },
      { h: 0, cells: [L({ ...hc(1), text: '제      호' }), L({ ...hc(3) }), L({ ...hc(4) })] },
      { h: px(4), cells: [] },
      pair('등 기 의 목 적', '{{regPurpose}}'),
      pair('등 기 의 사 유', '{{regReason}}', px(64)),
      { h: 0, cells: [L({ ...all, text: '등 기 할 사 항', bold: true })] },
      pair('상      호', '{{companyName}}'),
      pair('본      점', '{{hqAddress}}'),
      pair('공 고 방 법', '{{publicNoticeMethod}}', px(48)),
      pair('1 주 의 금 액', '금 {{parValue}} 원'),
      pair('발행할 주식의 총수', '{{unitsAuthorized}} 주'),
      pair('발행주식의 총수와 그 종류 및 각각의 수', '발행주식의 총수   {{unitsIssued}} 주\n보통주식   {{unitsIssued}} 주'),
      pair('자본금총액', '{{capitalAmountKorean}} (금 {{capitalAmount}} 원)'),
      pair('목      적', '{{purposeList}}', px(192)),
    ],
  };
})();

const regPage2 = (() => {
  const g = unionCols([27, 73]);
  const lab = spanOf(g, 0, 27);
  const val = spanOf(g, 27, 100);
  const all = spanOf(g, 0, 100);
  const pair = (label, value, h = 0) => ({ h, cells: [L({ ...lab, text: label }), regCell({ ...val, ...(value ? { text: value } : {}) })] });
  return {
    cols: g.widths,
    rows: [
      { h: 0, cells: [L({ ...all, text: '등 기 할 사 항', bold: true })] },
      pair('이사ㆍ감사의 성명 및 주민등록번호', '{{directorAuditorList}}', px(192)),
      pair('대표이사의 성명과 주소', '{{representativeList}}', px(80)),
      pair('종류주식의 내용', '', px(160)),
      pair('지      점', '', px(80)),
      pair('존립기간 또는 해산사유', '', px(80)),
      // 「기 타」 — 라벨 아래 작은 글씨 설명이 붙는다(레거시 8.5px). 한 칸에 두 크기를 못 쓰니 라벨을 두 행으로 나눈다
      { h: 0, cells: [L({ ...lab, text: '기      타', border: { top: true, right: true, bottom: false, left: true } }), regCell({ ...val, rowSpan: 2, text: '주식의 양도에 관하여 이사회의 승인을 얻어야 한다.' })] },
      { h: px(150), cells: [L({ ...lab, valign: 'top', fontSize: pt(8.5), text: '(주식의 양도에 관하여 이사회의 승인을 얻도록 정한 때에는 그 규정, 명의개서대리인을 둔 때에는 그 상호와 본점소재지 등)', border: { top: false, right: true, bottom: true, left: true } })] },
    ],
  };
})();

const regPage3 = (() => {
  const six = [100 / 6, 100 / 6, 100 / 6, 100 / 6, 100 / 6, 100 / 6];
  const g = unionCols(six, [18, 82]);
  const c6 = (i, j = i) => spanOf(g, (100 / 6) * i, (100 / 6) * (j + 1));
  const all = spanOf(g, 0, 100);
  const sign = (t, align = 'left') => ({ h: 0, cells: [regCell({ ...all, text: t, align, border: { top: false, right: true, bottom: false, left: true } })] });
  return {
    cols: g.widths,
    rows: [
      { h: 0, cells: [L({ ...c6(0), text: '등록면허세' }), regCell({ ...c6(1), text: '금 {{regLicenseTax}} 원' }), L({ ...c6(2), text: '지방교육세' }), regCell({ ...c6(3), text: '금 {{localEduTax}} 원' }), L({ ...c6(4), text: '농어촌특별세' }), regCell({ ...c6(5), text: '금      원' })] },
      { h: 0, cells: [L({ ...c6(0), text: '세 액 합 계' }), regCell({ ...c6(1, 2), text: '금 {{taxTotal}} 원' }), L({ ...c6(3), text: '등기신청수수료' }), regCell({ ...c6(4, 5), text: '금 {{regFee}} 원' })] },
      { h: 0, cells: [L({ ...c6(0, 1), text: '등기신청수수료 납부번호' }), regCell({ ...c6(2, 5) })] },
      { h: 0, cells: [L({ ...c6(0, 1), text: '과 세 표 준 액' }), regCell({ ...c6(2, 5), text: '금      원' })] },
      { h: px(4), cells: [] },
      { h: 0, cells: [L({ ...all, text: '첨 부 서 면', bold: true })] },
      { h: 0, cells: [regCell({ ...all, text: '{{attachments}}' })] },
      { h: 0, cells: [regCell({ ...all, text: '{{applyDate}}', align: 'center', border: { top: true, right: true, bottom: false, left: true } })] },
      sign('신청인    상  호 : {{companyName}}'),
      sign('          본  점 : {{hqAddress}}'),
      sign('대표이사  성  명 : {{ceoName}}   (인)   (전화 :          )'),
      sign('          주  소 : {{ceoAddress}}'),
      sign('대리인    성  명 :          (인)   (전화 :          )'),
      sign('          주  소 :'),
      { h: 0, cells: [regCell({ ...all, text: '지방법원      등기소  귀중', align: 'center', border: { top: false, right: true, bottom: true, left: true } })] },
      { h: px(4), cells: [] },
      {
        h: 0,
        cells: [
          L({ ...spanOf(g, 0, 18), text: '알림서비스\n(선택)' }),
          regCell({ ...spanOf(g, 18, 100), text: '등기접수 및 처리결과에 대한 문자 수신에 동의합니다.  (□동의   □미동의)\n(성명 :              휴대전화번호 :            )' }),
        ],
      },
    ],
  };
})();

// =============================================================================
// 정관 — 레거시 ArticlesDoc(표지 + 본문). 본문은 조항마다 「제목 행(굵게) + 본문 행」, 장을 앞에서부터 채운다
// =============================================================================
const ARTICLES = JSON.parse(fs.readFileSync(path.join(HERE, '2026-10-12-incorporation-articles.json'), 'utf8'));
const ART = pt(12); // 9pt
/** 표지 — 가운데 「定　款」 상자 · 아래 상호. */
const cover = {
  cols: [4.5, 8, 4.5],
  rows: [
    gap(7),
    { h: 2.4, cells: [{ col: 1, span: 1, text: '定　款', align: 'center', valign: 'middle', bold: true, fontSize: 36 }] },
    gap(12.5),
    { h: 1.6, cells: [{ col: 0, span: 3, text: '{{companyName}}', align: 'center', valign: 'middle', bold: true, fontSize: pt(30), border: NO }] },
  ],
};
/** 본문 블록 — 장 머리 · 조항(제목 + 본문). 블록은 장을 넘기지 않는다. */
const ITEM = /^\s*\d+\./;
const articleBlocks = ARTICLES.items.map((it) => {
  if (it.head) {
    return [text(it.head, it.first
      ? { align: 'center', bold: true, fontSize: pt(15), border: { top: false, right: false, bottom: true, left: false } }
      : { bold: true, fontSize: pt(13), border: { top: false, right: false, bottom: true, left: false } })];
  }
  const rows = [text(`제${it.no}조 (${it.title})`, { bold: true, fontSize: ART })];
  const body = it.lines.filter((l) => l !== '{{articlesPurposeList}}').map((l) => (ITEM.test(l) ? `   ${l}` : l));
  if (body.length) rows.push(text(body.join('\n'), { fontSize: ART }));
  if (it.lines.includes('{{articlesPurposeList}}')) {
    // 목적 목록은 들여 쓴 칸(레거시 ml-5)에 — 줄마다 들여쓰기를 글자로 넣지 않으려고 왼쪽 빈 열을 둔다
    rows.push({ h: 0, cells: [{ col: 0, span: 1, border: NO }, { col: 1, span: 1, text: '{{articlesPurposeList}}', align: 'left', valign: 'top', fontSize: ART, border: NO }] });
  }
  return rows;
});
articleBlocks.push([text('{{plannedDate}}', { align: 'center', fontSize: ART }), gap(0.3)]);
articleBlocks.push([text('발기인', { bold: true, fontSize: pt(13), border: { top: false, right: false, bottom: true, left: false } }), text('{{articlesFounderList}}', { fontSize: ART })]);

// =============================================================================
// 서류 목록
// =============================================================================
const one = (rows) => [{ cols: [W], rows }];
const DOCS = [
  { name: '설립등기신청서', unit: 'case', font: REG, pages: [regPage1, regPage2, regPage3], sourcePages: 3, legacy: 'RegistrationAppDoc.tsx' },
  { name: '주주전원서면결의서', unit: 'case', font: BODY, pages: one(RESOLUTION), sourcePages: 1, legacy: 'ShareholderResolutionDoc.tsx' },
  { name: '취임승낙서(설립)', unit: 'officer', font: BODY, pages: one(ACCEPTANCE), sourcePages: 1, legacy: 'AcceptanceDoc.tsx' },
  { name: '주식발행사항동의서', unit: 'case', font: BODY, pages: one(ISSUANCE), sourcePages: 1, legacy: 'StockIssuanceConsentDoc.tsx' },
  { name: '주식인수증', unit: 'founder', font: BODY, pages: one(SUBSCRIPTION), sourcePages: 1, legacy: 'SubscriptionDoc.tsx' },
  { name: '조사보고서', unit: 'case', font: BODY, pages: one(INVESTIGATION), sourcePages: 1, legacy: 'InvestigationReportDoc.tsx' },
  { name: '정관', unit: 'case', font: ART, cover, blocks: articleBlocks, cols: [px(20), W - px(20)], sourcePages: null, legacy: 'ArticlesDoc.tsx' },
];

// =============================================================================
// 최대 인원 값 — 이 값으로 높이를 잰다(shared 출력값 함수 그대로)
// =============================================================================
const PURPOSE_SAMPLES = ['소프트웨어 개발 및 공급업', '전자상거래 소매업(통신판매업)', '경영 컨설팅업', '정보통신 관련 연구개발 및 기술용역업', '광고 대행업 및 광고물 제작업', '부동산 임대업', '교육 서비스업(온라인 강의 포함)', '수출입업 및 무역 대행업', '데이터베이스 구축 및 온라인 정보 제공업', '인공지능 관련 소프트웨어 개발업'];
const ADDR = { zipCode: '06164', address: '서울 강남구 테헤란로 123', addressDetail: '4층 401호 (역삼동, 에스원비즈빌딩)' };
function worstValues(settingRows) {
  const info = parseIncorpInfo({
    nameKo: '가나다라마바사아자차카타', nameEn: 'Ganadara Global Solutions', companyTypePosition: 'F', hq: ADDR,
    capitalAmount: 987_654_321_000, parValue: 100_000, unitsAuthorized: 98_765_432, unitsIssued: 9_876_543,
    publicNoticeMethod: '회사의 인터넷 홈페이지(https://www.ganadara-global.co.kr)', fiscalStart: '01-01', fiscalEnd: '12-31', plannedDate: '2026-12-31',
    purposes: Array.from({ length: CAPACITY.purposes }, (_, i) => PURPOSE_SAMPLES[i % PURPOSE_SAMPLES.length]).join('\n'),
  });
  if (!info.ok) throw new Error('표본 설립 정보가 틀렸다');
  const P = (name, roles, units) => ({ name, isFounder: roles.includes('F'), isDirector: roles.includes('D'), isAuditor: roles.includes('A'), isRepresentative: roles.includes('R'), unitsSubscribed: units, appointmentDate: '2026-12-31', ...ADDR, rrn: '9001011234567' });
  // 발기인 5 · 이사·감사 5 · 대표이사 2 · 조사보고인 3(발기인 아닌 이사 · 감사)
  const persons = [P('홍길동', 'FDR', 2_000_000), P('김철수', 'FDR', 2_000_000), P('이영희', 'F', 2_000_000), P('박민수', 'F', 2_000_000), P('최지은', 'F', 1_876_543), P('정우성', 'D', 0), P('한지민', 'D', 0), P('오감사', 'A', 0)];
  const snapshot = buildIncorporationSnapshot(info.value, persons.map((p, i) => ({ ...p, id: `p${i}`, rrnMasked: null, sortOrder: i + 1 })));
  const src = { snapshot, persons, setting: pickDocFormSetting(settingRows, 'R_PROMOTER', 'R'), methodName: '주식회사 발기설립', inputs: { applyDate: '2026-12-31', writeDate: '2026-12-31' } };
  const caseValues = buildIncorpCasePrintValues(src);
  // 사람 칸은 가장 긴 직위(대표이사·이사)의 사람으로
  const personValues = buildIncorpPersonPrintValues(src, persons[0]);
  return { caseValues, personValues };
}
const fill = (t, values) => t.replace(/\{\{([^}]+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);

// =============================================================================
// 재기 — 헤드리스 Chrome
// =============================================================================
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function tableHtml(id, cols, rows, values, fontSize) {
  const n = cols.length;
  const covered = new Set();
  const trs = rows.map((r, ri) => {
    const tds = [];
    const anchors = new Map(r.cells.map((c) => [c.col, c]));
    for (let ci = 0; ci < n; ci++) {
      if (covered.has(`${ri}:${ci}`)) continue;
      const c = anchors.get(ci);
      if (!c) { tds.push('<td style="border:0"></td>'); continue; }
      const span = c.span === 'all' ? n - ci : c.span ?? 1;
      const rs = c.rowSpan ?? 1;
      for (let a = 0; a < rs; a++) for (let b = 0; b < span; b++) if (a || b) covered.add(`${ri + a}:${ci + b}`);
      const bd = c.border ?? {};
      const side = (k) => (bd[k] === false ? '0' : '1px solid #000');
      tds.push(`<td colspan="${span}" rowspan="${rs}" style="border-top:${side('top')};border-right:${side('right')};border-bottom:${side('bottom')};border-left:${side('left')};text-align:${c.align ?? 'left'};vertical-align:${c.valign ?? 'middle'};font-size:${c.fontSize ?? fontSize}pt;font-weight:${c.bold ? 700 : 400}">${esc(fill(c.text ?? '', values))}</td>`);
      ci += span - 1;
    }
    return `<tr style="height:${r.h}cm">${tds.join('')}</tr>`;
  });
  return `<table data-id="${id}" style="width:${cols.reduce((a, b) => a + b, 0)}cm"><colgroup>${cols.map((w) => `<col style="width:${w}cm">`).join('')}</colgroup><tbody>${trs.join('')}</tbody></table>`;
}
function measureAll(tables) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font-family:'${FONT}'} table{border-collapse:collapse;table-layout:fixed;margin-bottom:40px}
td{padding:0 2px;word-break:break-all;white-space:pre-wrap;line-height:1.5}
</style></head><body>${tables.map((t) => tableHtml(t.id, t.cols, t.rows, t.values, t.fontSize)).join('')}<script>
const cm=(p)=>p*2.54/96; const out=[];
document.querySelectorAll('table').forEach((t)=>out.push(t.dataset.id+'='+[...t.querySelectorAll('tr')].map((tr)=>cm(tr.getBoundingClientRect().height).toFixed(3)).join(',')));
document.body.setAttribute('data-out',out.join(';'));
</script></body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incorp-forms-'));
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome 이 없다 — ${CHROME}`);
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${path.join(dir, 'prof')}`, '--virtual-time-budget=3000', '--dump-dom', 'file:///' + file.split(path.sep).join('/')], { maxBuffer: 1 << 26, timeout: 90000 }).toString('utf8');
  const m = dom.match(/data-out="([^"]*)"/);
  if (!m) throw new Error('잰 값을 읽지 못했다');
  return Object.fromEntries(m[1].split(';').map((s) => { const [id, list] = s.split('='); return [id, list.split(',').map(Number)]; }));
}
/** 잰 높이를 0.05cm 단위로 올린다(글꼴 차이 여유). */
const roundUp = (h) => Math.ceil((h + 0.02) / 0.05) * 0.05;

// =============================================================================
// 정의로 바꾸기
// =============================================================================
function toCells(rows, nCols) {
  const cells = [];
  rows.forEach((r, ri) => {
    for (const c of r.cells) {
      const span = c.span === 'all' ? nCols - c.col : c.span ?? 1;
      const cell = { row: ri, col: c.col };
      if (span > 1) cell.colSpan = span;
      if ((c.rowSpan ?? 1) > 1) cell.rowSpan = c.rowSpan;
      if (c.text) cell.text = c.text;
      if (c.border) cell.border = c.border;
      if (c.align && c.align !== 'left') cell.align = c.align;
      if (c.valign && c.valign !== 'middle') cell.valign = c.valign;
      if (c.fontSize) cell.fontSize = c.fontSize;
      if (c.bold) cell.bold = true;
      cells.push(cell);
    }
  });
  return cells;
}
const page = (cols, rows, heights) => ({ colWidths: cols, rowHeights: heights, marginTop: MARGIN_TOP, cells: toCells(rows, cols.length) });

/** 정관 본문 블록을 장에 채운다 — 블록(장 머리 + 조항)은 장을 넘기지 않는다. 장 머리는 다음 블록과 붙여 둔다. */
function paginate(blocks, blockHeights) {
  const pages = [];
  let cur = { rows: [], heights: [] };
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    let rows = blocks[i];
    let hs = blockHeights[i];
    // 장 머리(행 1개 · 굵게 · 밑줄)는 다음 조항과 함께 옮긴다
    const isHead = rows.length === 1 && rows[0].cells[0]?.border?.bottom === true && i + 1 < blocks.length;
    if (isHead) { rows = [...rows, ...blocks[i + 1]]; hs = [...hs, ...blockHeights[i + 1]]; i++; }
    const h = hs.reduce((a, b) => a + b, 0);
    if (h > USABLE) throw new Error(`정관 — 한 장보다 큰 블록(${h.toFixed(2)}cm)`);
    if (used + h > USABLE && cur.rows.length) { pages.push(cur); cur = { rows: [], heights: [] }; used = 0; }
    cur.rows.push(...rows); cur.heights.push(...hs); used += h;
  }
  if (cur.rows.length) pages.push(cur);
  return pages;
}

// =============================================================================
// 레거시 대조 — 옮겨 적은 글자 조각이 원본에 있는가(원본이 있을 때만)
// =============================================================================
const LEGACY_TERMS = { '{t.unit}': '주', '{t.holder}': '주주', '{t.founder}': '발기인', '{t.roster}': '주주명부', '{t.subscription}': '주식인수증', '{t.entityName}': '주식회사' };
function legacyText(file) {
  let s = fs.readFileSync(path.join(LEGACY, file), 'utf8');
  for (const [k, v] of Object.entries(LEGACY_TERMS)) s = s.split(k).join(v);
  return s.replace(/\{"\s"\}/g, ' ').replace(/&nbsp;/g, ' ').replace(/<br\s*\/?>/g, ' ').replace(/\s+/g, ' ');
}
function checkAgainstLegacy(doc) {
  if (!fs.existsSync(LEGACY)) return { skipped: true, misses: [] };
  const src = legacyText(doc.legacy);
  const misses = [];
  const rows = doc.pages ? doc.pages.flatMap((p) => p.rows) : [];
  for (const r of rows) for (const c of r.cells) {
    if (!c.text) continue;
    for (const line of c.text.split('\n')) {
      for (const frag of line.split(/\{\{[^}]+\}\}/)) {
        const f = frag.replace(/^[\s　\-]+|[\s　]+$/g, '').replace(/\s+/g, ' ');
        if (f.length < 4) continue;
        if (!src.includes(f)) misses.push(f);
      }
    }
  }
  return { skipped: false, misses };
}

// =============================================================================
// 보기 · 쓰기
// =============================================================================
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => n.toFixed(2);

(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const settingRows = (await c.query(
      `SELECT reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes, attachments, reg_purpose, reg_reason, matter_body
         FROM public.tb_s080_doc_form_settings WHERE operator_id = 1 AND domain = 'incorporation'`,
    )).rows.map((r) => ({ regTypeKey: r.reg_type_key, companyType: r.company_type ?? '', isActive: r.is_active, label: r.label, formNo: r.form_no, matter: r.matter, taxMode: r.tax_mode, taxes: r.taxes, attachments: r.attachments, regPurpose: r.reg_purpose, regReason: r.reg_reason, matterBody: r.matter_body }));
    const { caseValues, personValues } = worstValues(settingRows);

    // 재기 — 장마다 표 하나, 정관 본문은 블록마다 표 하나
    const tables = [];
    for (const d of DOCS) {
      const values = d.unit === 'case' ? caseValues : personValues;
      if (d.pages) d.pages.forEach((p, i) => tables.push({ id: `${d.name}#${i}`, cols: p.cols, rows: p.rows, values, fontSize: d.font }));
      else {
        tables.push({ id: `${d.name}#cover`, cols: d.cover.cols, rows: d.cover.rows, values, fontSize: d.font });
        d.blocks.forEach((b, i) => tables.push({ id: `${d.name}#b${i}`, cols: d.cols, rows: b, values, fontSize: d.font }));
      }
    }
    const measured = measureAll(tables);

    const problems = [];
    const ready = [];
    for (const d of DOCS) {
      let pages;
      if (d.pages) pages = d.pages.map((p, i) => page(p.cols, p.rows, measured[`${d.name}#${i}`].map(roundUp)));
      else {
        const body = paginate(d.blocks, d.blocks.map((_, i) => measured[`${d.name}#b${i}`].map(roundUp)));
        pages = [page(d.cover.cols, d.cover.rows, measured[`${d.name}#cover`].map(roundUp)), ...body.map((b) => page(d.cols, b.rows, b.heights))];
      }
      const def = parseDefinition({ version: 2, font: { family: FONT, size: d.font }, legal: { domain: 'incorporation', unit: d.unit }, pages });
      def.manualFields = definitionTokens(def).map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);

      console.log(`\n■ ${d.name}  (법무 표시: 법인설립 · ${{ case: '건마다', officer: '임원마다', founder: '발기인마다' }[d.unit]} · 글꼴 ${FONT} ${d.font}pt · 원문 ${d.legacy})`);
      def.pages.forEach((p, pi) => {
        const h = sum(p.rowHeights) + MARGIN_TOP;
        const fits = h <= PAGE_INNER_CM + 1e-9;
        if (!fits) problems.push(`${d.name} ${pi + 1}장: 높이 넘침(${fmt(h)}cm)`);
        console.log(`  ${pi + 1}장 — 열 ${p.colWidths.length}개 · 행 ${p.rowHeights.length}개 · 높이 ${fmt(sum(p.rowHeights))} + 위 여백 ${MARGIN_TOP} = ${fmt(h)} / ${fmt(PAGE_INNER_CM)}cm ${fits ? '' : '★ 넘침'}`);
      });
      if (d.sourcePages !== null && def.pages.length !== d.sourcePages) problems.push(`${d.name}: 장 수 ${def.pages.length}(원문 ${d.sourcePages})`);
      const tokens = definitionTokens(def);
      const unknown = tokens.filter((t) => !LABELS[t]);
      if (unknown.length) problems.push(`${d.name}: 이름표 밖 자리표시 ${unknown.join(',')}`);
      console.log(`  자리표시 ${tokens.length}개: ${tokens.join(' · ')}`);
      const chk = d.pages ? checkAgainstLegacy(d) : { skipped: true, misses: [], note: '정관은 뽑은 자료(articles.json)를 그대로 쓴다' };
      if (chk.skipped) console.log(`  레거시 대조: 건너뜀${chk.note ? ` — ${chk.note}` : ' — 원본 없음'}`);
      else if (chk.misses.length) { problems.push(`${d.name}: 레거시에 없는 글자 ${chk.misses.length}곳`); console.log(`  ★ 레거시에 없는 글자: ${chk.misses.map((m) => JSON.stringify(m)).join(' / ')}`); }
      else console.log('  레거시 대조: 글자 조각 전부 원본에 있음');
      ready.push({ d, def });
    }

    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT name FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = ANY($1)`, [ready.map((r) => r.d.name)]);
    if (rows.length) problems.push(`이미 있는 이름: ${rows.map((r) => r.name).join(', ')}`);
    if (problems.length) throw new Error(problems.join(' / '));
    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log(`\n최대 인원: ${JSON.stringify(CAPACITY)}\n보기만 했습니다 — ${ready.length}건. 쓰려면 --apply`);
      return;
    }
    for (const { d, def } of ready) {
      await c.query(
        `INSERT INTO public.tb_s080_form_templates
           (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
         VALUES ($1, 1, $2, $3, 'T', $4::jsonb, now(), now(), 'oneoff-2026-10-12', 'oneoff-2026-10-12')`,
        [randomUUID(), d.name, `법인설립 — 레거시 ${d.legacy} 기준(2026-10-12)`, JSON.stringify(def)],
      );
    }
    await c.query('COMMIT');
    console.log(`\n썼습니다 — ${ready.length}건`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
