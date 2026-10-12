/**
 * 일회용(2026-10-12) — 법인설립 서류 9종을 **법무 표양식**(법무 표시: 업무 법인설립)으로 등록한다(10-5).
 *
 *   설립등기신청서(건마다 · 3장) · 발기인총회의사록 · 조사보고서 · 주식발행사항동의서 · 인감대지 · 인감·개인신고서
 *   · 정관(이상 건마다) · 취임승낙서(설립)(임원마다) · 주식인수증(발기인마다)
 *
 * ★ 원문(결정 2026-10-12):
 *   · **새 docx**(`doc/forms-src/`) — 설립등기신청서(65-1) · 발기인총회의사록 · 조사보고서 · 주식발행사항동의서(1장 본문만,
 *     2장 「유의사항」은 뺀다) · 주식인수증(양식_첨부4) · 인감대지 · 인감·개인신고서.
 *     문구는 그대로 옮기고(**원본 오타 · 번호 오류도 그대로**, 아래 `TYPOS`), 표본 값(실명 · 주소 · 날짜 · 금액 · 회사명)은
 *     자리표시나 빈칸으로 바꿨다. 옮겨 적은 글자 조각이 원본에 있는지 대조한다 — 원본에 없는데 결정으로 넣은 글자는
 *     문서의 `added` 에 적고 보고한다
 *   · 정관 — 레거시 ArticlesDoc 53조(`2026-10-12-incorporation-articles.json`, 바꾼 곳은 그 파일의 `replaced`)
 *   · 취임승낙서(설립) — 표양식의 「취임승낙서」(법인변경)를 **복사**해 자리표시를 설립 것으로 바꾸고(`ACCEPT_RENAME`)
 *     「주주총회」→「발기인총회」. 칸 배치는 그대로
 *   · 주주전원서면결의서는 만들지 않는다(발기인총회의사록으로 대체)
 * ★ 설립등기신청서의 등기 설정 칸(목적 · 사유 · 세금 · 첨부서면)은 설정 자리표시(결정 1(가) 유지).
 *   첨부서면은 docx 의 2단 고정 목록 대신 `{{attachments}}` 한 칸(두 단을 합친 폭)
 * ★ 값이 이름표에 없는 칸(총회 시각 · 장소 · 참석 수 · 인수일 · 납입일 · 은행 · 기타비상무이사 · 등기번호 · 주식종류 2행 ·
 *   의장 · 대표이사 주민번호 등)은 **빈칸**이다(결정 2026-10-12).
 * ★ 행 높이는 **최대 인원**(`CAPACITY`)으로 잰다 — 표양식 엔진은 칸 높이가 고정이라 그보다 많으면 칸이 넘친다.
 *   재는 법: 헤드리스 Chrome 으로 엔진과 같은 칸 규칙(줄간격 1.5 · 좌우 2px · 줄바꿈 유지 · 글자 단위 줄넘김)으로 그리고
 *   행마다 높이를 읽는다. 행 높이 = max(원문 높이, 잰 높이 + 0.01cm 를 0.01cm 로 올림).
 * ★ 1장에 넣기(결정 2026-10-12) — 넘칠 때만, 이 순서로: 1) 글자 행의 남는 높이 2) 빈 줄 3) 글자 크기(B4 원본인
 *   발기인총회의사록 · 조사보고서만, 10.5 → 10 → 9.5pt). 그래도 넘치면 **멈춘다**(2장 허용은 사용자 결정).
 * ★ 엔진은 칸이 없는 자리에 테두리를 그린다(`FormDocument` 의 `edge(undefined)`) — 빈 자리는 모두 테두리 없는 칸으로 채운다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 한 트랜잭션으로 쓴다. 같은 이름의 양식이 하나라도 있으면
 *   아무것도 쓰지 않고 멈춘다(두 번 돌려도 안전). 정의는 shared `parseDefinition` 을 통과해야 한다.
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
const SRC = path.join(ROOT, 'doc/forms-src');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** 종이 안쪽 높이(cm) — A4 29.7 에서 `form-doc.module.css` 의 위아래 12mm 를 뺀다. */
const PAGE_INNER_CM = 29.7 - 1.2 * 2;
/** 위 여백 — 법인변경 법무 양식과 같다(종이 1.2 + 0.8 = 2.0cm). */
const MARGIN_TOP = 0.8;
const USABLE = PAGE_INNER_CM - MARGIN_TOP;
const FONT = '바탕';
const W = 17; // B4 원본 두 서류 · 정관의 본문 폭(cm)
const px = (n) => +(n * 2.54 / 96).toFixed(2); // 레거시 px → cm(정관)
const pt = (n) => +(n * 0.75).toFixed(2); // 레거시 px → pt(정관)
const lineCm = (size) => (size * 2.54 / 72) * 1.5; // 한 줄 높이(줄간격 1.5)
const NO = { top: false, right: false, bottom: false, left: false };
const ALL = { top: true, right: true, bottom: true, left: true };
const LABELS = Object.fromEntries(INCORP_PRINT_FIELDS.map((f) => [f.name, f.label]));

/**
 * 최대 인원 — 이 수까지는 칸이 넘치지 않게 높이를 잡는다(보고 대상).
 * 사업목적 · 발기인은 정관 고정 배치의 한도(결정 2026-10-11 — 20줄 · 5명)와 같다.
 */
const CAPACITY = { purposes: 20, founders: 5, directorsAuditors: 5, representatives: 2, reporters: 3 };

/** 원본 오타 · 번호 오류 — 고치지 않고 그대로 옮긴다(결정 2026-10-12). 보고용. */
const TYPOS = {
  발기인총회의사록: ['제2호 의안 「전월 일치되어」(전원)', '5번째 의안이 「제3호 의안: 상법 제298조 …」(제3호가 두 번)', '「위 감사 는」 · 「발기인 이 다음에」 띄어쓰기'],
  조사보고서: ['「설림비용」(설립)', '「주급납입증명」(주금)', '「상법제 290조 규정사항 을」 띄어쓰기'],
  주식발행사항동의서: ['「발행인 전원이 다음에 기명날인하다」(발기인)'],
};

// =============================================================================
// 행 만들기 — { h: 최소 높이(cm), blank?: 빈 줄, cells: [{ col, span, rowSpan, text, align, valign, bold, fontSize, border }] }
// =============================================================================
const gap = (h) => ({ h: +h.toFixed(3), blank: true, cells: [] });
const lines = (n, size) => gap(n * lineCm(size));
/** 테두리 없는 한 줄(모든 열). */
const text = (t, o = {}) => ({ h: o.h ?? 0, cells: [{ col: 0, span: 'all', text: t, align: o.align ?? 'left', valign: o.valign ?? 'top', bold: o.bold, fontSize: o.fontSize, border: o.border ?? NO }] });
const center = (t, o = {}) => text(t, { ...o, align: 'center' });
/** 들여 쓴 한 줄 — 열 `col` 부터. 여러 줄 자리표시를 줄마다 같은 자리에서 시작하게 한다. */
const at = (col, t, o = {}) => (col === 0 ? text(t, o) : { h: o.h ?? 0, cells: [{ col: 0, span: col, border: NO }, { col, span: 'all', text: t, align: o.align ?? 'left', valign: 'top', fontSize: o.fontSize, bold: o.bold, border: NO }] });

// =============================================================================
// 발기인총회의사록 — 새 docx(B4 · 15pt → A4). 본문 크기 s 에 따라 만든다
// =============================================================================
const MINUTES_COLS = [3.5, W - 3.5];
const MINUTES = (s) => {
  const br = (n = 1) => lines(n, s);
  return [
    center('발기인총회의사록', { valign: 'middle', fontSize: Math.round(s * 4 / 3 * 2) / 2 }),
    br(),
    // 원본 「2021년 12월 24일 오전 10시 서울특별시 강남구 …(삼정빌딩)에서」 — 시각 · 장소는 빈칸
    text(' {{meetingDate}}          시                                        에서 발기인총회를 개최하다. '),
    br(),
    // 주주총수 · 출석주주수(참석 수)는 빈칸
    at(1, '주주총수          명          주식총수   {{unitsIssued}} 주'),
    at(1, '출석주주수        명          인수주식수 {{founderUnitsTotal}} 주'),
    br(),
    // 원본 「발기인 주식회사 큐원의 회의진행자로 지명받은 임○○는」 — 발기인 · 진행자는 빈칸
    text('  발기인                    의 회의진행자로 지명받은              는 위와 같이 상법 소정의 법정수에 달하는 주주가 출석하였으므로 본 총회는 적법하게 성립됨을 알리고, 의사를 진행하기 전에 의장을 선임할 것을 구한 바, 주주전원 만장일치로 발기인 대표를 의장으로 선임한 즉 동인은 그 취임을 승낙하고 의장석에 등단하여 개회를 선언하고 다음 의안의 심의를 구하다. '),
    br(),
    center('제1호 의안: 정관 승인의 건 '),
    br(),
    text('  의장은 정관을 낭독하고 축조 설명을 가한 후 그 가부를 물은 바, 전원일치로 원안대로 승인하다. '),
    br(),
    center('제2호 의안: 이사 감사 선임의 건'),
    br(),
    // 인원 수(사내이사 · 기타 비상무 이사 · 감사)는 빈칸
    text('   의장은 이사, 감사의 선임방법을 물은 바, 발기인 전원 사내이사    명 기타 비상무 이사    명, 감사    명을 무기명 비밀투표로 선출하기로 전월 일치되어 즉시 투표한 결과 다음과 같이 선출되다. '),
    br(),
    at(1, '{{officerNameList}}'),
    br(),
    center('제3호 의안: 대표 이사 선임의 건'),
    br(),
    text('의장은 이사중에서 본 회사를 대표할 대표이사를 선임한다는 취지를 말하고 그 선임방법을 자문한 즉 기명 투표로 선출하기로 전원일치되어 즉시 투표를 한 즉 다음 사람을 대표이사로 선임하다.   '),
    text('{{representativeList}}'),
    br(),
    center('제4호 의안: 본점설치장소 결정의 건'),
    br(),
    text('의장은 본 회사 본점을 다음 장소에 설치함이 적당한 뜻을 설명하고 그 가부를 자문한 즉 만장일치로 이의 없이 승인하다.   '),
    text('본점 : {{hqAddress}} '),
    br(),
    center('제3호 의안: 상법 제298조 소정사항 조사보고의 건 '),
    br(),
    text('  의장은 상법 제298조 소정 사항의 조사 보고를 발기인 아닌 사내이사, 기타비상무이사, 감사로 하여금 조사보고를 하여야 함을 설명하자 전원 이의 없이 아래 임원을 검사인으로 선임할 것을 만장일치로 가결하다. '),
    br(),
    at(1, '{{reporterNameList}}'),
    br(),
    text('위 감사 는 즉석에서 이를 승낙하고 조사에 착수하다. '),
    text('의장은 위 조사보고를 기다리기 위하여 잠시 휴회한 후 속회하다. '),
    text('검사인은 별지 조사보고서와 같이 보고한 즉 만장일치로 승인하다. '),
    // 폐회 시각은 빈칸
    text('이상으로서 금일 총회의 목적인 의안이 전부 심의 종료하였으므로 의장은 폐회를 선언하다. (폐회시각은     시) '),
    text('위 의사의 결의를 명확히 하기 위하여 이 의사록을 작성하고 의장과 출석한 발기인 이 다음에 기명날인하다. '),
    br(),
    center('{{writeDate}} '),
    br(),
    center('{{companyName}}  '),
    br(),
    // 원본 「의장겸 발기인 주식회사 큐원 / 대표이사 임○○ (법인)」 — 의장 이름은 빈칸
    at(1, '의장겸 발기인 '),
    center('대표이사                  (법인) '),
  ];
};

// =============================================================================
// 조사보고서 — 새 docx(B4 · 15pt → A4)
// =============================================================================
const REPORT_COLS = [1, 1.5, 4, W - 6.5];
const REPORT = (s) => {
  const br = (n = 1) => lines(n, s);
  return [
    center('조 사 보 고 서 ', { valign: 'middle', fontSize: Math.round(s * 4 / 3 * 2) / 2 }),
    br(),
    // 원본 「2021년 12월 24일 주식회사 우리오피스…부동사투자회사 발기인총회」 — 총회일 = meetingDate, 회사 = companyName
    text('  {{meetingDate}} {{companyName}} 발기인총회에서 본인등은 검사인으로 선임되었으므로 상법 제298조 제1항 규정에 의하여 조사한 결과는 다음과 같음. '),
    br(),
    center('조 사 사 항 및 조 사 결 과'),
    br(),
    text('1. 회사 설립시 발행하는 주식총수에 대한 인수와 정확여부 '),
    text('   본 회사가 발행할 주식의 총수는 {{unitsAuthorized}}주 이며 설립시 발행하는 주식의 총수 {{unitsIssued}}주 (액면주식 1주의 금액 금{{parValue}}원)로 그 인수내역은 다음과 같다. '),
    at(1, '발기인이 인수한 주수 '),
    // 인수완료일은 빈칸
    at(3, '보통주식 {{founderUnitsTotal}}주        년      월      일 인수완료 '),
    br(),
    text('2. 인수 주식수에 대한 납입의 정확여부 '),
    // 납입일 · 납입은행(지점)은 빈칸
    text('   설립시에 발행하는 주식총수 {{unitsIssued}}주에 대하여 금{{capitalAmount}}원의 납입금이        년      월      일 납입이 완료되었음은                              이 발행한 주급납입증명에 의하여 명확함. '),
    br(),
    text('3. 현물출자 기타 조사사항 '),
    text('   회사가 부담할 설림비용이나 기타 현물출자를 하는 자와 상법제 290조 규정사항 을 정관에 정한 바 없으므로 검사인을 선임할 필요가 없으므로 그에 대한 정확여부는 조사할 필요가 없었음. '),
    br(),
    text('4. 기타 설립에 관한 모든 사항이 법령 또는 정관 규정에 위반하지 아니함이 인정된다. '),
    text('   이상 상법의 규정에 의하여 보고함. '),
    br(),
    center('{{writeDate}}'),
    br(),
    center('{{companyName}} '),
    br(),
    // 원본 서명 3줄(대표이사 · 기타비상무이사 · 감사) — 검사인 목록 한 칸(결정 2026-10-12)
    at(3, '{{reporterSignList}}'),
  ];
};

// =============================================================================
// 주식발행사항동의서 — 새 docx(A4 · 13pt · 제목 20pt). 1장 본문만(2장 「유의사항」은 뺀다)
// 들여쓰기(원본 twip): 본문 200 · 「-」줄 600 · 발기인 2000 · 날짜 3000
// =============================================================================
const ISSUANCE_COLS = [0.35, 0.71, 2.47, 1.76, 12.71]; // 합 18.0 = 21 − 1.5 × 2
const ISSUANCE = (s) => {
  const br = (n = 1) => lines(n, s);
  return [
    center('주식 발행사항 동의서', { valign: 'middle', fontSize: 20 }),
    br(),
    at(1, '발기인 전원의 동의로서 회사 설립시 발행할 주식에 관한 사항을 다음과 같이 결정함.'),
    br(2),
    center('다    음'),
    br(),
    at(1, '1. 주식의 종류와 수 : '),
    at(2, '- 보통주식 {{unitsIssued}} 주'), // 결정 2026-10-12 — 「보통주식」 고정 글자
    at(2, '- '), // 주식종류 2행 — 빈칸
    at(1, '2. 주식의 발행가액 : 1주의 금액 {{parValue}} 원'),
    at(1, '3. 주식의 총수와 주식금액'),
    at(2, '- {{unitsIssued}} 주, 금 {{capitalAmount}} 원'),
    at(1, '  위 동의사항을 확실히 하기 위하여 발행인 전원이 다음에 기명날인하다. '),
    br(),
    at(4, '{{writeDate}}'),
    br(),
    text('{{companyName}}'),
    br(),
    // 원본 서명 4칸 고정 — founderSignList 한 칸(결정 2026-10-12)
    at(3, '{{founderSignList}}'),
  ];
};

// =============================================================================
// 주식인수증 — 새 docx(양식_첨부4, A4 · 10pt · 제목 14pt)
// =============================================================================
const SUBSCRIPTION_COLS = [4.6, 1.2, 9.2]; // 합 15.0 = 21 − 3 × 2
const SUBSCRIPTION = (s) => {
  const br = (n = 1) => lines(n, s);
  return [
    br(),
    center('주식인수증', { valign: 'middle', fontSize: 14 }),
    br(),
    text('1. 상호 : {{companyName}}'),
    br(),
    text('2. 인수할 주식의 종류와 수 : 보통주 {{personUnits}} 주'),
    br(),
    text('3. 위 총액 : 금 {{personAmount}} 원 '),
    br(),
    text('4. 1주의 금액 : 금 {{parValue}} 원'),
    br(),
    text('5. 납입기관 및 장소 : '), // 은행 · 지점은 빈칸
    br(),
    text('   위의 주식을 발기인으로서 인수합니다.'),
    br(2),
    center('{{writeDate}}'),
    br(2),
    at(1, '발기인 {{personName}} (주민등록번호 {{personRrn}})       (인)'),
    br(),
    at(2, '주소 {{personAddress}}'),
  ];
};

// =============================================================================
// 인감대지 — 새 docx(A4 · 10pt). 대표이사 1장 기준(결정 2026-10-12)
// =============================================================================
const SEAL_COLS = [1.12, 4.02, 11.65, 2.21]; // 합 19.0 = 21 − 1 × 2, 표는 앞 세 열
const SEAL_SHEET = (s) => {
  const br = (n = 1) => lines(n, s);
  return [
    br(),
    text('별지 제2호 양식(인감대지)   '),
    br(),
    center('인  감  대  지', { valign: 'middle', fontSize: 15, bold: true }),
    lines(1, 16),
    {
      h: 4.75,
      cells: [
        { col: 0, span: 1, border: ALL },
        { col: 1, span: 1, text: '\n신고하는 인감날인란', align: 'center', valign: 'top', border: ALL },
        // 자격 「대표이사」는 고정 글자(결정 2026-10-12, 대표이사 1장 기준)
        { col: 2, span: 1, text: '\n  상  호(명 칭) : {{companyName}}\n  자격 및 성명 : 대표이사 {{ceoName}}', valign: 'top', fontSize: 11, border: ALL },
        { col: 3, span: 1, border: NO },
      ],
    },
    br(2),
    text(' 주1. 자격은 대표이사(이사), 이사장, 지배인, 대리인, 상호사용자, 미성년자, 법정대리인 등으로  기재합니다. '),
  ];
};

// =============================================================================
// 인감·개인신고서 — 새 docx(A4 · 10pt). 표 안에 표가 든 원본을 **한 격자**로 편다(결정 2026-10-12)
//   열 경계(cm): 0 · 0.31(날인란) · 3.63 · 4.22(제출자 표) · 5.26 · 7.74 · 12.05 · 13.17(보증 날인란) · 13.87 · 15.89 · 16.39 · 17.10
// =============================================================================
const REPORT_SEAL_COLS = [0.31, 3.32, 0.59, 1.04, 2.48, 4.31, 1.12, 0.7, 2.02, 0.5, 0.71];
const RN = REPORT_SEAL_COLS.length;
/** 큰 테두리 상자 — 행마다 맨 왼쪽 칸에 왼쪽 선, 맨 오른쪽 칸에 오른쪽 선, 첫 행 위 · 끝 행 아래. */
function framed(rows) {
  rows.forEach((r, i) => {
    for (const c of r.cells) {
      const span = c.span === 'all' ? RN - c.col : c.span ?? 1;
      c.border = { ...(c.border ?? NO) };
      if (c.col === 0) c.border.left = true;
      if (c.col + span === RN) c.border.right = true;
      if (i === 0) c.border.top = true;
      if (i + (c.rowSpan ?? 1) - 1 === rows.length - 1) c.border.bottom = true;
    }
  });
  return rows;
}
const full = (t, o = {}) => ({ h: o.h ?? 0, cells: [{ col: 0, span: 'all', text: t, align: o.align ?? 'left', valign: o.valign ?? 'top', fontSize: o.fontSize, border: NO }] });
const box = (col, span, t, o = {}) => ({ col, span, text: t, align: o.align ?? 'left', valign: o.valign ?? 'middle', fontSize: o.fontSize, rowSpan: o.rowSpan, border: ALL });
const sp = (col, span) => ({ col, span, border: NO });
const SEAL_REPORT = (s) => [
  text('별지 제1호 양식(인감 ․ 개인(改印) 신고서)   '),
  lines(1, s),
  ...framed([
    full(''),
    full('인감 ․ 개인(改印) 신고서', { align: 'center', valign: 'middle', fontSize: 15 }),
    full(''),
    { h: 0, cells: [sp(0, 1), { col: 1, span: 1, text: '(신고하는 인감날인란)', align: 'center', border: NO }, sp(2, 1), { col: 3, span: 6, text: '(인감제출자에 관한 사항)', align: 'center', border: NO }, sp(9, 2)] },
    // 제출자 표 — 상호 · 등기번호(빈칸) · 본점 · 자격/성명 · 주민등록번호(빈칸) · 주소. 날인란은 앞 네 행(원본 3.35cm)
    { h: 0.8, cells: [sp(0, 1), box(1, 1, '', { rowSpan: 4 }), sp(2, 1), box(3, 2, '상호(명칭)', { align: 'center' }), box(5, 1, '{{companyName}}'), box(6, 2, '등기번호', { align: 'center' }), box(8, 2, ''), sp(10, 1)] },
    { h: 0.75, cells: [sp(0, 1), sp(2, 1), box(3, 2, '본점(주사무소)', { align: 'center' }), box(5, 5, '{{hqAddress}}'), sp(10, 1)] },
    { h: 0.9, cells: [sp(0, 1), sp(2, 1), box(3, 1, '인\n감\n제\n출\n자', { align: 'center', rowSpan: 3 }), box(4, 1, '자격/성명', { align: 'center' }), box(5, 5, '대표이사 {{ceoName}}'), sp(10, 1)] },
    { h: 0.9, cells: [sp(0, 1), sp(2, 1), box(4, 1, '주민등록번호', { align: 'center' }), box(5, 5, ''), sp(10, 1)] },
    { h: 0.9, cells: [sp(0, 3), box(4, 1, '주  소', { align: 'center' }), box(5, 5, '{{ceoAddress}}'), sp(10, 1)] },
    full(''),
    full('          □ 위와 같이 인감을 신고합니다.  □ 위와 같이 개인(改印)하였음을 신고합니다.'),
    full('                       년      월      일         '),
    full(''),
    full('               신고인   본  인   성   명                          (인)# (전화 :                )'),
    full('                        대리인   성   명                          (인)* (전화 :                )'),
    {
      h: 4.22,
      cells: [
        sp(0, 1),
        box(1, 9, ' 주 1. 인감·개인(改印) 신고서의 신고인의 날인란(#)에는 ｢인감증명법｣에 따라 신고한 인감을 날인하고 그 인감증명서(발행일로부터 3개월 이내의 것)를 첨부하거나, 등기소에 제출한 유효한 종전 인감(법인인감)을 날인하여야 합니다. 또한 인감제출자가 기명날인 또는 서명하였다는 공증인의 인증서면으로 갈음할 수 있습니다.\n    2. 인감·개인신고서에는 신고하는 인감을 날인한 인감대지를 첨부하여야 합니다.\n    3. 지배인이 인감을 신고하는 경우에는 인감제출자의 주소란에 지배인을 둔 장소를 기재하고, 위 1. 의 방법 대신 ｢상업등기규칙｣ 제35조제3항의 보증서면(영업주가 등기소에 제출한 인감날인)을 첨부하여야 합니다. 위 보증서면은 아래의 보증서면란에 기재하는 것으로 갈음할 수 있습니다.\n    4. 위임에 의한 대리인이 인감을 신고하거나 개인(改印)을 신고하는 경우에는 위 1. 대신에 위임인의 날인란(**)에 「인감증명법」에 따라 신고한 인감을 날인한 위임장을 첨부하고 그 인감증명서를 첨부하거나 등기소에 제출한 유효한 종전 인감을 날인한 위임장을 첨부하여야 하고 신고인의 날인란(*)에는 대리인이 기명날인 또는 서명하여야 합니다.\n    5. 법인인감증명서 발급사실 등 문자전송 서비스를 신청하면, 발급사실을 휴대폰 문자로 통보받을 수 있습니다(전국 등기소 및 인터넷등기소에서 별도 신청해야 합니다).', { valign: 'top', fontSize: 9 }),
        sp(10, 1),
      ],
    },
    full('  지방법원           등기소  귀중', { align: 'center' }),
    full('', { h: 0.2 }),
  ]),
  // 보증서면(지배인) — 법인인감 날인란(원본 2.72 × 2.65cm)은 오른쪽 상자
  ...framed([
    full('', { h: 0.15 }),
    { h: 0.9, cells: [{ col: 0, span: 7, text: '                              보 증 서 면               (법인인감 날인란)  ', fontSize: 13, border: NO }, box(7, 2, '', { rowSpan: 3 }), sp(9, 2)] },
    { h: 0.85, cells: [{ col: 0, span: 7, text: '위 신고하는 인감은 지배인          의 인감임이 틀림없음을 보증합니다.', border: NO }, sp(9, 2)] },
    { h: 0.9, cells: [{ col: 0, span: 7, text: '       대표이사             ', align: 'center', border: NO }, sp(9, 2)] },
    full('', { h: 0.15 }),
  ]),
  // 위임장(대리인) — 전부 빈칸
  ...framed([
    full('위  임  장', { align: 'center', valign: 'middle', fontSize: 13 }),
    full('         성 명 :                               생년월일 : (            ) (전화           )'),
    full('         주 소 :                                                        '),
    full('              위의 사람에게, 위 인감(개인)신고에 관한 일체의 권한을 위임함.    '),
    full('                                             년     월     일          '),
    full('                             인감(개인) 신고인  성 명           (인)**        '),
  ]),
];

// =============================================================================
// 설립등기신청서 — 새 docx(65-1, A4 · 9pt · 3장). 칸 배치 · 행 높이는 docx, 값은 자리표시
//   · 등기 설정 칸(목적 · 사유 · 세금 · 첨부서면)은 설정 자리표시(결정 2026-10-12 — 1(가) 유지)
// =============================================================================
const REG = 9;
const L = (o) => ({ align: 'center', valign: 'middle', border: ALL, ...o }); // 라벨 칸
const V = (o) => ({ align: 'left', valign: 'top', border: ALL, ...o }); // 값 칸
// 1 · 2장 격자 — docx 1번 표(0.02cm 실 열은 옆 열에 합침)
const REG12_COLS = [3.04, 1.19, 0.81, 1.48, 1.07, 2.51, 2.53, 2.52];
const pair = (label, value, h) => ({ h, cells: [L({ col: 0, span: 1, text: label }), V({ col: 1, span: 7, ...(value ? { text: value } : {}) })] });
const REG_PAGE1 = [
  text('[양식 제65-1호] 주식회사 설립 등기(발기설립) '),
  gap(0.3),
  {
    h: 0,
    cells: [
      { col: 0, span: 3, border: { ...NO, right: true, bottom: true } },
      L({ col: 3, span: 3, text: '주식회사 설립 등기신청', fontSize: 11 }),
      { col: 6, span: 2, border: { ...NO, left: true, bottom: true } },
    ],
  },
  { h: 0.92, cells: [L({ col: 0, span: 1, rowSpan: 2, text: '접       수' }), L({ col: 1, span: 4, text: '      년       월      일' }), L({ col: 5, span: 1, rowSpan: 2, text: '처 리 인' }), L({ col: 6, span: 1, text: '등기관 확인' }), L({ col: 7, span: 1, text: '각종 통지' })] },
  { h: 1.07, cells: [L({ col: 1, span: 4, text: '제                     호' }), L({ col: 6, span: 1 }), L({ col: 7, span: 1 })] },
  { h: 0.12, cells: [{ col: 0, span: 8, border: { ...NO, top: true, bottom: true } }] },
  pair('등 기 의 목 적', '{{regPurpose}}', 1.04),
  pair('등 기 의 사 유', '{{regReason}}', 2.43),
  { h: 0.92, cells: [L({ col: 0, span: 8, text: '등      기      할      사      항' })] },
  pair('상        호', '{{companyName}}', 1.08),
  pair('본        점', '{{hqAddress}}', 1.08),
  pair('공 고 방 법', '{{publicNoticeMethod}}', 1.28),
  pair('1 주 의 금 액', '금 {{parValue}} 원', 1.28),
  pair('발행할\n주식의 총수', '{{unitsAuthorized}} 주', 1.38),
  pair('발행주식의 총수와 그 종류 및 각각의 수', '발행주식의 총수   {{unitsIssued}} 주\n보통주식   {{unitsIssued}} 주', 1.44),
  pair('자본금총액', '{{capitalAmountKorean}} (금 {{capitalAmount}} 원)', 1.26),
  pair('목        적', '{{purposeList}}', 4.26),
];
const REG_PAGE2 = [
  { h: 0.92, cells: [L({ col: 0, span: 8, text: '등      기      할      사      항' })] },
  pair('이사⋅감사의 성명 및 주민등록번호', '{{directorAuditorList}}', 4.95),
  pair('대표이사의\n성명과 주소', '{{representativeList}}', 1.39),
  pair('종류주식의\n내용', '', 4.23),
  pair('지        점', '', 2.33),
  pair(' 존립기간 또는 해산사유', '', 2.52),
  // 「기 타」 — 원본 값 칸은 빈칸
  pair('기        타\n(주식의 양도에 관하여 이사회의 승인을 얻도록 정한 때에는 그 규정, 명의개서대리인을 둔 때에는 그 상호와 본점소재지 등)', '', 6.29),
];
// 3장 격자 — docx 2번 표
const REG3_COLS = [2.52, 0.69, 1.83, 2.53, 2.53, 2.53, 2.53];
const signLine = (t, o = {}) => ({ h: 0, cells: [{ col: 0, span: 7, text: t, align: o.align ?? 'left', valign: 'top', border: { top: !!o.top, right: true, bottom: !!o.bottom, left: true } }] });
const REG_PAGE3 = [
  { h: 0.84, cells: [L({ col: 0, span: 1, text: '등록면허세' }), L({ col: 1, span: 2, text: '금 {{regLicenseTax}} 원' }), L({ col: 3, span: 1, text: '지방교육세' }), L({ col: 4, span: 1, text: '금 {{localEduTax}} 원' }), L({ col: 5, span: 1, text: '농어촌특별세' }), L({ col: 6, span: 1, text: '금          원' })] },
  { h: 0.84, cells: [L({ col: 0, span: 1, text: '세 액 합 계' }), L({ col: 1, span: 3, text: '금 {{taxTotal}} 원' }), L({ col: 4, span: 1, text: '등기신청수수료' }), L({ col: 5, span: 2, text: '금 {{regFee}} 원' })] },
  { h: 0.78, cells: [L({ col: 0, span: 4, text: '등기신청수수료 납부번호' }), L({ col: 4, span: 3 })] },
  { h: 0.82, cells: [L({ col: 0, span: 2, text: '과 세 표 준 액' }), L({ col: 2, span: 5, text: '금                                                                    원' })] },
  { h: 0.68, cells: [L({ col: 0, span: 7, text: '첨      부      서      면' })] },
  // docx 2단 고정 목록 대신 설정 값 한 칸(결정 2026-10-12)
  { h: 7.64, cells: [V({ col: 0, span: 7, text: '{{attachments}}' })] },
  // 신청인 칸 — docx 는 한 칸에 여러 줄(날짜만 오른쪽). 줄마다 행으로 나누고 바깥 선만 긋는다
  signLine('{{applyDate}}', { top: true, align: 'right' }),
  signLine('신청인   상  호  {{companyName}}'),
  signLine('         본  점  {{hqAddress}}'),
  signLine(''),
  signLine('대표이사 성  명  {{ceoName}}                    (인)     (전화 :             )'),
  signLine('         주  소  {{ceoAddress}}'),
  signLine(''),
  signLine('대리인   성  명                                 (인)     (전화 :             )'),
  signLine('         주  소'),
  signLine('지방법원      등기소  귀중', { bottom: true, align: 'center' }),
  gap(0.08),
  { h: 0.43, cells: [L({ col: 0, span: 1, text: '알림서비스\n(선택)' }), V({ col: 1, span: 6, text: ' 등기접수 및 처리결과에 대한 문자 수신에 동의합니다.  (□동의   □미동의)\n  (성명:                           휴대전화번호:                         )' })] },
  gap(0.17),
  { h: 0, cells: [{ col: 0, span: 7, text: '- 신청서 작성요령 -', align: 'center', valign: 'top', border: { ...ALL, bottom: false } }] },
  {
    h: 0,
    cells: [{
      col: 0,
      span: 7,
      text: '1. 해당 등기신청과 관계없는 사항은“해당없음”으로 기재하거나 삭제하고, 필요한 사항은 추가 기   재하며, 해당란이 부족할 때에는 별지를 이용합니다.\n1.「인감증명법」에 따른 인감증명서 제출과 함께 관련 서면에 인감을 날인하여야 하는 경우, 본인서명사실확인서를 제출하고 관련 서면에 서명을 하거나 전자본인서명확인서 발급증을 제출하고 관련 서면에 서명을 하면 인감증명서를 제출하고 관련 서면에 인감을 날인한 것으로 봅니다.\n1. 알림서비스에 동의하는 경우 「개인정보보호법」제15조 및 제17조에 근거하여 성명과 휴대전화번호가 통신사에 제공되고, 동의에 따라 수집된 정보는 등기사무의 접수 및 처리 시까지 그 결과의 알림의 목적으로만 사용되며, 동의하지 않을 경우 알림서비스가 제공되지 않습니다.',
      align: 'left',
      valign: 'top',
      border: { ...ALL, top: false },
    }],
  },
];

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
    { h: 2.4, cells: [{ col: 0, span: 1, border: NO }, { col: 1, span: 1, text: '定　款', align: 'center', valign: 'middle', bold: true, fontSize: 36, border: ALL }, { col: 2, span: 1, border: NO }] },
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
//   pages(s) — 본문 크기 s 로 장들을 만든다. sizes — 넘칠 때 내려 볼 크기(첫 값이 기본)
//   source — 원문 docx(대조) · added — 원본에 없는데 결정으로 넣은 글자 조각
// =============================================================================
const one = (cols, build) => (s) => [{ cols, rows: build(s) }];
const DOCS = [
  { name: '설립등기신청서', unit: 'case', sizes: [REG], pages: () => [{ cols: REG12_COLS, rows: REG_PAGE1 }, { cols: REG12_COLS, rows: REG_PAGE2 }, { cols: REG3_COLS, rows: REG_PAGE3 }], sourcePages: 3, source: '65-1(40-1).주식회사설립등기(발기설립).docx', added: ['발행주식의 총수', '보통주식'] },
  { name: '발기인총회의사록', unit: 'case', sizes: [10.5, 10, 9.5], pages: one(MINUTES_COLS, MINUTES), sourcePages: 1, source: '발기인총회의사록.docx', added: [] },
  { name: '조사보고서', unit: 'case', sizes: [10.5, 10, 9.5], pages: one(REPORT_COLS, REPORT), sourcePages: 1, source: '조사보고서.docx', added: [] },
  { name: '주식발행사항동의서', unit: 'case', sizes: [13], pages: one(ISSUANCE_COLS, ISSUANCE), sourcePages: 1, source: '주식 발행사항 동의서.docx', added: ['보통주식'] },
  { name: '인감대지', unit: 'case', sizes: [10], pages: one(SEAL_COLS, SEAL_SHEET), sourcePages: 1, source: '인감대지.docx', added: ['대표이사'] },
  { name: '인감·개인신고서', unit: 'case', sizes: [10], pages: one(REPORT_SEAL_COLS, SEAL_REPORT), sourcePages: 1, source: '인감_개인신고서.docx', added: ['대표이사'] },
  { name: '주식인수증', unit: 'founder', sizes: [10], pages: one(SUBSCRIPTION_COLS, SUBSCRIPTION), sourcePages: 1, source: '양식_첨부4_주식인수증.docx', added: [] },
  { name: '정관', unit: 'case', sizes: [ART], cover, blocks: articleBlocks, cols: [px(20), W - px(20)], sourcePages: null, source: null },
];
/** 취임승낙서(설립) — 법인변경 「취임승낙서」를 복사한다. 자리표시 이름만 설립 것으로(결정 2026-10-12). */
const ACCEPT_FROM = '취임승낙서';
const ACCEPT_NAME = '취임승낙서(설립)';
const ACCEPT_RENAME = { officerName: 'personName', officerRrn: 'personRrn', officerAddress: 'personAddress', officerPosition: 'personRole', resolutionDate: 'appointedDate' };

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
// 재기 — 헤드리스 Chrome. 행 높이 0 으로 그려 **글자가 차지하는 높이**만 읽는다
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
    return `<tr style="height:0">${tds.join('')}</tr>`;
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
/** 잰 높이에 0.01cm 를 더해 0.01cm 단위로 올린다. */
const roundUp = (h) => Math.ceil((h + 0.01) * 100 - 1e-9) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const fmt = (n) => n.toFixed(2);

/**
 * 장 하나의 행 높이 — max(원문 높이, 잰 높이). 넘치면 1) 글자 행의 남는 높이 2) 빈 줄 순으로 줄인다.
 * 돌려주는 것: 높이 · 한 일 · 남은 넘침(cm).
 */
function fitPage(rows, content, limit) {
  const need = rows.map((r, i) => (r.blank ? 0 : roundUp(content[i])));
  const hs = rows.map((r, i) => (r.blank ? r.h : Math.max(+r.h.toFixed(2), need[i])));
  const steps = [];
  let over = sum(hs) - limit;
  if (over > 1e-9) {
    const idx = rows.map((r, i) => i).filter((i) => !rows[i].blank && hs[i] > need[i]);
    const room = sum(idx.map((i) => hs[i] - need[i]));
    if (room > 0) {
      const f = Math.min(1, over / room);
      for (const i of idx) hs[i] = Math.ceil((hs[i] - (hs[i] - need[i]) * f) * 100 - 1e-9) / 100;
      steps.push(`1) 글자 행 남는 높이 ${fmt(room)}cm 의 ${Math.round(f * 100)}%`);
      over = sum(hs) - limit;
    }
  }
  if (over > 1e-9) {
    const idx = rows.map((r, i) => i).filter((i) => rows[i].blank);
    const room = sum(idx.map((i) => hs[i]));
    if (room > 0) {
      const f = Math.min(1, over / room);
      for (const i of idx) hs[i] = Math.floor(hs[i] * (1 - f) * 100) / 100;
      steps.push(`2) 빈 줄 ${fmt(room)}cm 의 ${Math.round(f * 100)}%`);
      over = sum(hs) - limit;
    }
  }
  return { hs, steps, over };
}

// =============================================================================
// 정의로 바꾸기 — 칸이 없는 자리는 테두리 없는 빈 칸으로 채운다(엔진은 빈 자리에 선을 긋는다)
// =============================================================================
function toPage(cols, rows, heights) {
  // 높이 0.01 이하로 줄어든 빈 줄은 뺀다
  const keep = rows.map((r, i) => !(r.blank && heights[i] < 0.01));
  const rs = rows.filter((_, i) => keep[i]);
  const hs = heights.filter((_, i) => keep[i]);
  const n = cols.length;
  const covered = new Set();
  const cells = [];
  rs.forEach((r, ri) => {
    for (const c of r.cells) {
      const span = c.span === 'all' ? n - c.col : c.span ?? 1;
      const rowSpan = c.rowSpan ?? 1;
      for (let a = 0; a < rowSpan; a++) for (let b = 0; b < span; b++) covered.add(`${ri + a}:${c.col + b}`);
      const cell = { row: ri, col: c.col };
      if (span > 1) cell.colSpan = span;
      if (rowSpan > 1) cell.rowSpan = rowSpan;
      if (c.text) cell.text = c.text;
      cell.border = c.border ?? ALL;
      if (c.align && c.align !== 'left') cell.align = c.align;
      if (c.valign && c.valign !== 'middle') cell.valign = c.valign;
      if (c.fontSize) cell.fontSize = c.fontSize;
      if (c.bold) cell.bold = true;
      cells.push(cell);
    }
  });
  rs.forEach((_, ri) => {
    for (let ci = 0; ci < n; ci++) if (!covered.has(`${ri}:${ci}`)) cells.push({ row: ri, col: ci, border: NO });
  });
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return { colWidths: cols, rowHeights: hs.map((h) => Math.max(0.01, +h.toFixed(2))), marginTop: MARGIN_TOP, cells };
}

/** 정관 본문 블록을 장에 채운다 — 블록(장 머리 + 조항)은 장을 넘기지 않는다. 장 머리는 다음 블록과 붙여 둔다. */
function paginate(blocks, blockHeights) {
  const pages = [];
  let cur = { rows: [], heights: [] };
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    let rows = blocks[i];
    let hs = blockHeights[i];
    const isHead = rows.length === 1 && rows[0].cells[0]?.border?.bottom === true && i + 1 < blocks.length;
    if (isHead) { rows = [...rows, ...blocks[i + 1]]; hs = [...hs, ...blockHeights[i + 1]]; i++; }
    const h = sum(hs);
    if (h > USABLE) throw new Error(`정관 — 한 장보다 큰 블록(${h.toFixed(2)}cm)`);
    if (used + h > USABLE && cur.rows.length) { pages.push(cur); cur = { rows: [], heights: [] }; used = 0; }
    cur.rows.push(...rows); cur.heights.push(...hs); used += h;
  }
  if (cur.rows.length) pages.push(cur);
  return pages;
}

/** 정의의 장 → 재기용 행(취임승낙서 복사본). */
function defPageRows(p) {
  return p.rowHeights.map((h, r) => ({
    h,
    cells: p.cells.filter((c) => c.row === r).map((c) => ({ col: c.col, span: c.colSpan ?? 1, rowSpan: c.rowSpan, text: c.text, align: c.align, valign: c.valign, fontSize: c.fontSize, bold: c.bold, border: c.border })),
  }));
}

// =============================================================================
// 원본 대조 — 옮겨 적은 글자 조각이 docx 에 있는가(공백 무시). 자리표시 · 두 칸 넘는 공백 · 줄바꿈에서 자른다
// =============================================================================
function docxText(file) {
  const xml = execFileSync('unzip', ['-p', path.join(SRC, file), 'word/document.xml'], { maxBuffer: 1 << 26 }).toString('utf8');
  const dec = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => dec(m[1])).join('').replace(/\s/g, '');
}
function checkAgainstSource(d, pages) {
  const src = docxText(d.source);
  const misses = [];
  const added = [];
  for (const p of pages) for (const r of p.rows) for (const c of r.cells) {
    if (!c.text) continue;
    for (const frag of c.text.split(/\{\{[^}]+\}\}|\n| {2,}|　/)) {
      const f = frag.replace(/\s/g, '');
      if (f.length < 4 || src.includes(f)) continue;
      if (d.added.some((a) => f.includes(a.replace(/\s/g, '')))) added.push(f);
      else misses.push(f);
    }
  }
  return { misses: [...new Set(misses)], added: [...new Set(added)] };
}

// =============================================================================
// 보기 · 쓰기
// =============================================================================
(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const settingRows = (await c.query(
      `SELECT reg_type_key, company_type, is_active, label, form_no, matter, tax_mode, taxes, attachments, reg_purpose, reg_reason, matter_body
         FROM public.tb_s080_doc_form_settings WHERE operator_id = 1 AND domain = 'incorporation'`,
    )).rows.map((r) => ({ regTypeKey: r.reg_type_key, companyType: r.company_type ?? '', isActive: r.is_active, label: r.label, formNo: r.form_no, matter: r.matter, taxMode: r.tax_mode, taxes: r.taxes, attachments: r.attachments, regPurpose: r.reg_purpose, regReason: r.reg_reason, matterBody: r.matter_body }));
    const { caseValues, personValues } = worstValues(settingRows);
    const problems = [];

    // 취임승낙서(설립) — 법인변경 양식을 읽어 복사
    const from = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [ACCEPT_FROM])).rows;
    if (from.length !== 1) throw new Error(`「${ACCEPT_FROM}」 양식이 ${from.length}개다(1개여야 한다)`);
    const accept = JSON.parse(JSON.stringify(from[0].definition));
    if (accept.legal?.domain !== 'corp-change') throw new Error(`「${ACCEPT_FROM}」 이 법인변경 양식이 아니다`);
    let meetingWords = 0;
    for (const p of accept.pages) for (const cell of p.cells) {
      if (!cell.text) continue;
      cell.text = cell.text.replace(/\{\{([^}]+)\}\}/g, (all, k) => (ACCEPT_RENAME[k] ? `{{${ACCEPT_RENAME[k]}}}` : all));
      meetingWords += cell.text.split('주주총회').length - 1;
      cell.text = cell.text.split('주주총회').join('발기인총회');
    }
    if (meetingWords !== 1) problems.push(`${ACCEPT_NAME}: 「주주총회」가 ${meetingWords}곳(1곳이어야 한다)`);
    delete accept.manualFields;
    accept.legal = { domain: 'incorporation', unit: 'officer' };

    // 재기 — 서류마다 크기마다 장마다 표 하나, 정관 본문은 블록마다 표 하나
    const tables = [];
    const built = new Map(); // `${name}#${size}` → pages
    for (const d of DOCS) {
      const values = d.unit === 'case' ? caseValues : personValues;
      if (d.blocks) {
        tables.push({ id: `${d.name}#cover`, cols: d.cover.cols, rows: d.cover.rows, values, fontSize: d.sizes[0] });
        d.blocks.forEach((b, i) => tables.push({ id: `${d.name}#b${i}`, cols: d.cols, rows: b, values, fontSize: d.sizes[0] }));
        continue;
      }
      for (const s of d.sizes) {
        const pages = d.pages(s);
        built.set(`${d.name}#${s}`, pages);
        pages.forEach((p, i) => tables.push({ id: `${d.name}#${s}#${i}`, cols: p.cols, rows: p.rows, values, fontSize: s }));
      }
    }
    accept.pages.forEach((p, i) => tables.push({ id: `${ACCEPT_NAME}#${i}`, cols: p.colWidths, rows: defPageRows(p), values: personValues, fontSize: accept.font.size }));
    const measured = measureAll(tables);

    const ready = [];
    const report = (name, unit, size, def, notes) => {
      console.log(`\n■ ${name}  (법인설립 · ${{ case: '건마다', officer: '임원마다', founder: '발기인마다' }[unit]} · ${FONT} ${size}pt)`);
      for (const n of notes) console.log(`  ${n}`);
      def.pages.forEach((p, pi) => {
        const h = sum(p.rowHeights) + MARGIN_TOP;
        const fits = h <= PAGE_INNER_CM + 1e-9;
        if (!fits) problems.push(`${name} ${pi + 1}장: 높이 넘침(${fmt(h)}cm)`);
        console.log(`  ${pi + 1}장 — 열 ${p.colWidths.length}개(폭 ${fmt(sum(p.colWidths))}cm) · 행 ${p.rowHeights.length}개 · 높이 ${fmt(sum(p.rowHeights))} + 위 여백 ${MARGIN_TOP} = ${fmt(h)} / ${fmt(PAGE_INNER_CM)}cm ${fits ? '' : '★ 넘침'}`);
      });
      const tokens = definitionTokens(def);
      const unknown = tokens.filter((t) => !LABELS[t]);
      if (unknown.length) problems.push(`${name}: 이름표 밖 자리표시 ${unknown.join(',')}`);
      console.log(`  자리표시 ${tokens.length}개: ${tokens.join(' · ')}`);
    };

    for (const d of DOCS) {
      let def;
      const notes = [];
      let size = d.sizes[0];
      if (d.blocks) {
        const body = paginate(d.blocks, d.blocks.map((b, i) => b.map((r, j) => (r.blank ? r.h : Math.max(r.h, roundUp(measured[`${d.name}#b${i}`][j]))))));
        const coverH = fitPage(d.cover.rows, measured[`${d.name}#cover`], USABLE).hs;
        const pages = [toPage(d.cover.cols, d.cover.rows, coverH), ...body.map((b) => toPage(d.cols, b.rows, b.heights))];
        def = parseDefinition({ version: 2, font: { family: FONT, size }, legal: { domain: 'incorporation', unit: d.unit }, pages });
        notes.push('원문: 레거시 ArticlesDoc 53조(articles.json 그대로)');
      } else {
        // 크기를 앞에서부터 — 모든 장이 들어가는 첫 크기
        let chosen = null;
        const tried = [];
        for (const s of d.sizes) {
          const pages = built.get(`${d.name}#${s}`);
          const fits = pages.map((p, i) => fitPage(p.rows, measured[`${d.name}#${s}#${i}`], USABLE));
          const worst = Math.max(...fits.map((f) => f.over));
          tried.push(`${s}pt ${worst > 1e-9 ? `넘침 ${fmt(worst)}cm` : '들어감'}${fits.some((f) => f.steps.length) ? `(${fits.flatMap((f) => f.steps).join(' · ')})` : ''}`);
          if (worst <= 1e-9) { chosen = { s, pages, fits }; break; }
        }
        if (!chosen) {
          problems.push(`${d.name}: ${d.sizes[d.sizes.length - 1]}pt 까지 내려도 1장을 넘는다 — 2장 허용 여부 결정 필요`);
          const s = d.sizes[d.sizes.length - 1];
          const pages = built.get(`${d.name}#${s}`);
          chosen = { s, pages, fits: pages.map((p, i) => fitPage(p.rows, measured[`${d.name}#${s}#${i}`], USABLE)) };
        }
        size = chosen.s;
        const pages = chosen.pages.map((p, i) => toPage(p.cols, p.rows, chosen.fits[i].hs));
        def = parseDefinition({ version: 2, font: { family: FONT, size }, legal: { domain: 'incorporation', unit: d.unit }, pages });
        notes.push(`원문: ${d.source}`);
        notes.push(`1장에 넣기: ${tried.join(' → ')}`);
        if (def.pages.length !== d.sourcePages) problems.push(`${d.name}: 장 수 ${def.pages.length}(원문 ${d.sourcePages})`);
        const chk = checkAgainstSource(d, chosen.pages);
        if (chk.misses.length) { problems.push(`${d.name}: 원본에 없는 글자 ${chk.misses.length}곳`); notes.push(`★ 원본에 없는 글자: ${chk.misses.map((m) => JSON.stringify(m)).join(' / ')}`); }
        else notes.push('원본 대조: 옮겨 적은 글자 조각 전부 원본에 있음');
        if (chk.added.length) notes.push(`결정으로 넣은 글자(원본에 없음): ${chk.added.map((m) => JSON.stringify(m)).join(' / ')}`);
        if (TYPOS[d.name]) notes.push(`원본 오타 · 번호 오류(그대로 옮김): ${TYPOS[d.name].join(' · ')}`);
      }
      def.manualFields = definitionTokens(def).map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);
      report(d.name, d.unit, size, def, notes);
      ready.push({ name: d.name, def, description: `법인설립 — ${d.source ?? '레거시 ArticlesDoc'} 기준(2026-10-12)` });
    }

    // 취임승낙서(설립) — 칸 배치 그대로, 최대 값이 넘치는 행만 높인다
    {
      const notes = [`원문: 표양식 「${ACCEPT_FROM}」(법인변경) 복사 — 자리표시 ${Object.entries(ACCEPT_RENAME).map(([a, b]) => `${a}→${b}`).join(' · ')} · 「주주총회」→「발기인총회」`];
      accept.pages = accept.pages.map((p, i) => {
        const content = measured[`${ACCEPT_NAME}#${i}`];
        const grown = [];
        const rowHeights = p.rowHeights.map((h, r) => {
          const need = roundUp(content[r]);
          if (need > h + 1e-9) { grown.push(`${r + 1}행 ${fmt(h)}→${fmt(need)}`); return need; }
          return h;
        });
        notes.push(grown.length ? `높인 행: ${grown.join(' · ')}` : '최대 값에서도 원래 행 높이 그대로 들어감');
        return { ...p, rowHeights };
      });
      const def = parseDefinition(accept);
      def.manualFields = definitionTokens(def).map((t) => ({ name: t, label: LABELS[t] })).filter((m) => m.label);
      const sentence = def.pages.flatMap((p) => p.cells).find((x) => x.text?.includes('발기인총회'))?.text;
      notes.push(`문장: ${sentence}`);
      report(ACCEPT_NAME, 'officer', def.font.size, def, notes);
      ready.push({ name: ACCEPT_NAME, def, description: `법인설립 — 표양식 「${ACCEPT_FROM}」 복사(2026-10-12)` });
    }

    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT name FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = ANY($1)`, [ready.map((r) => r.name)]);
    if (rows.length) problems.push(`이미 있는 이름: ${rows.map((r) => r.name).join(', ')}`);
    if (problems.length) throw new Error(problems.join(' / '));
    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log(`\n최대 인원: ${JSON.stringify(CAPACITY)}\n보기만 했습니다 — ${ready.length}건. 쓰려면 --apply`);
      return;
    }
    for (const r of ready) {
      await c.query(
        `INSERT INTO public.tb_s080_form_templates
           (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
         VALUES ($1, 1, $2, $3, 'T', $4::jsonb, now(), now(), 'oneoff-2026-10-12', 'oneoff-2026-10-12')`,
        [randomUUID(), r.name, r.description, JSON.stringify(r.def)],
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
