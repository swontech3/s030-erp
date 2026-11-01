/**
 * 세무 국세 · 지방세 납부 · 4대보험 고지 · 대출 거래 — 표준 양식 변환 · 비용 판정 · 개수 맞추기 열쇠 (1-6, 2026-11-01).
 *
 * ★ 값은 모두 지어낸 것이다. 원본 샘플(doc/data-src/)의 값은 쓰지 않는다 — 제목 줄 이름과 칸 위치만 215 대응표 그대로다.
 * ★ 4대보험 파일의 3번째 칸(주민번호)은 읽지 않는다 — 시험 줄의 그 칸은 읽으면 던지는 칸이다.
 */
import { describe, expect, it } from 'vitest';
import { PINNED_CODES } from './code-usage.ts';
import { TAX_UPLOADABLE_KINDS } from './tax-uploads.ts';
import {
  convertLoanSheet,
  convertPaySheet,
  convertSocialSheet,
  firstSeenTaxItems,
  isExpenseTaxItem,
  loanDedupKey,
  parseSocialUploadQuery,
  socialTotals,
  type LoanImportMap,
  type PayImportMap,
  type SocialImportMap,
} from './tax-pay-social-loan.ts';

/* ── 대응표(215 그대로) ───────────────────────────────────────────────────── */

const NTAX_HEADER = ['납부일자', '세목', '납세자명', '납부세액', '전자납부번호', '귀속연도', '수납관서', '내국세액', '교육세액', '방위세액',
  '농어촌특별세액', '가산금', '비고'];
const NTAX_MAP: PayImportMap = {
  id: 'HOMETAX_NTAX_PAY', kind: 'NTAX', headerRow: 2, headerSignature: NTAX_HEADER,
  columns: { payDate: 1, taxItem: 2, amount: 4, payNo: 5, office: 7, penalty: 12, belongMonth: null, payMethod: null },
};
const ntaxSheet = (rows: unknown[][]): unknown[][] => [[], NTAX_HEADER, ...rows];
const ntaxLine = (date: unknown, item: unknown, amount: unknown, no: unknown, penalty: unknown = 0) =>
  [date, item, '시험회사 (가***)', amount, no, null, '시험세무서(000)', amount, 0, 0, 0, penalty, null];

const LTAX_HEADER = ['', '납세번호', '', '', '', '세목', '구분', '납세자', '납부일자', '납부금액', '납부기관', '납부방법', '과세대상'];
const LTAX_MAP: PayImportMap = {
  id: 'WETAX_LTAX_PAY', kind: 'LTAX', headerRow: 3, headerSignature: LTAX_HEADER,
  columns: { payNo: 2, taxItem: 6, payDate: 9, amount: 10, office: 11, payMethod: 12, belongMonth: 13, penalty: null },
};
/** 위택스 모양 — 1줄 제목 · 2줄 총 건수 · 총 금액 · 3줄 제목(A 빔 · 납세번호 B~E 합침) · 뒤 N 칸 빔. */
const ltaxSheet = (rows: unknown[][]): unknown[][] => [
  [null, null, null, '나의 납부확인'],
  [null, '총 건수 : ', '1건', null, '총 금액 : ', '1,000원'],
  [null, '납세번호', null, null, null, '세목', '구분', '납세자', '납부일자', '납부금액', '납부기관', '납부방법', '과세대상', null],
  ...rows,
];
const ltaxLine = (no: unknown, item: unknown, date: unknown, amount: unknown, target: unknown) =>
  [null, no, null, null, null, item, '시험분', '시험회사', date, amount, '시험시청', '시험납부', target, null];

const HI_HEADER = ['순번', '증번호', '주민번호', '성명', '보수월액',
  '구분', '산출보험료', '정산보험료', '정산사유', '정산적용기간', '감면사유', '연말정산', '환급금이자', '고지보험료', '회계', '영업소기호', '직종', '취득일/상실일',
  '구분', '산출보험료', '정산보험료', '정산사유', '정산적용기간', '감면사유', '연말정산', '환급금이자', '고지보험료', '회계', '영업소기호', '직종', '취득일/상실일'];
const HI_MAP: SocialImportMap = {
  id: 'SOCIAL_HI', kind: 'SOCIAL', headerRow: 7, headerSignature: HI_HEADER, socialInsTps: ['HI'],
  columns: { seq: 1, memberNo: 2, name: 4, payBase: 5, lines: { HI: { HI: 14, LTC: 27 } } },
};
const NP_HEADER = ['순번', '국민연금번호', '주민번호', '가입자명', '정산사유', '정산적용기간', '결정보험료'];
const NP_MAP: SocialImportMap = {
  id: 'SOCIAL_NP', kind: 'SOCIAL', headerRow: 7, headerSignature: NP_HEADER, socialInsTps: ['NP'],
  columns: { seq: 1, memberNo: 2, name: 4, payBase: null, lines: { NP: { NP: 7 } } },
};
const EI_HEADER = ['순번', '원부번호', '주민번호', '가입자명', '결정보험료', '월평균보수월액', '비고'];
const EI_MAP: SocialImportMap = {
  id: 'SOCIAL_EI_IA', kind: 'SOCIAL', headerRow: 7, headerSignature: EI_HEADER, socialInsTps: ['EI', 'IA'],
  columns: { seq: 1, memberNo: 2, name: 4, payBase: 6, lines: { EI: { EI: 5 }, IA: { IA: 5 } } },
};

/** ★ 3번째 칸(주민번호)을 읽으면 던진다 — 변환이 그 칸에 손대지 않는지 본다. */
function noRrn(row: unknown[]): unknown[] {
  return new Proxy(row, {
    get(target, p, recv) {
      if (p === '2') throw new Error('주민번호 칸을 읽었다');
      return Reflect.get(target, p, recv);
    },
  });
}
/** 통합징수포털 CSV 모양 — 1~6줄 빔, 7줄 제목, 8줄부터. 값은 모두 글자. */
const csvSheet = (header: string[], rows: unknown[][]): unknown[][] => [[], [], [], [], [], [], header, ...rows.map(noRrn)];
const hiLine = (no: string, name: string, base: string, hi: string, ltc: string) => {
  const r: unknown[] = Array(31).fill('');
  r[0] = '1'; r[1] = no; r[2] = '(가림)'; r[3] = name; r[4] = base;
  r[5] = '건강'; r[6] = hi; r[7] = '0'; r[13] = hi;
  r[18] = '요양'; r[19] = ltc; r[20] = '0'; r[26] = ltc;
  return r;
};

const LOAN_HEADER = ['No.', '거래일', '거래원금(원)', '대출잔액(원)', '원금상환', '정상이자(원)', '연체이자(원)', '환출이자(원)', '수수료(원)',
  '거래종류', '최종이수일', '다음 납입일', '거래점'];
const LOAN_MAP: LoanImportMap = {
  id: 'BANK_020_LOAN', kind: 'LOAN', bankCode: '020', headerRow: 3, headerSignature: LOAN_HEADER,
  columns: {
    seq: 1, txnDate: 2, drawAmount: 3, balance: 4, repayAmount: 5, interest: 6, lateInterest: 7, refundInterest: 8, fee: 9, txnType: 10,
    loanNo: { row: 2, label: '대출 계좌번호', stopAt: null },
  },
};
const loanSheet = (rows: unknown[][], no = '1234-567-890123'): unknown[][] => [
  ['우리은행 대출거래내역'],
  [`대출 계좌번호 : ${no}`],
  LOAN_HEADER,
  ...rows,
];
const loanLine = (date: unknown, x: { draw?: unknown; bal?: unknown; repay?: unknown; int?: unknown; late?: unknown; refund?: unknown; fee?: unknown; tp?: unknown } = {}) =>
  [1, date, x.draw ?? 0, x.bal ?? 1_000_000, x.repay ?? null, x.int ?? 3000, x.late ?? 0, x.refund ?? 0, x.fee ?? 0, x.tp ?? '이자납입',
    '2026.09.01', '2026.10.01', '시험점'];

/* ── 국세 · 지방세 ────────────────────────────────────────────────────────── */

describe('국세 납부(홈택스) — 표준 양식', () => {
  it('2줄 제목 · 납부일 · 세목 · 납부번호 · 금액 · 가산금 · 관서. 귀속 · 납부방법은 없음', () => {
    const r = convertPaySheet(ntaxSheet([ntaxLine('2026-09-10', '부가가치세', 125000, '1111-2222-3-44-55556666', 500)]), NTAX_MAP);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(1);
    expect(r.rows).toEqual([{
      payDate: '2026-09-10', taxItem: '부가가치세', payNo: '1111-2222-3-44-55556666', amount: 125000, penalty: 500,
      belongMonth: null, office: '시험세무서(000)', payMethod: null,
    }]);
  });

  it('가산금 칸이 비면 0', () => {
    const r = convertPaySheet(ntaxSheet([ntaxLine('2026-09-10', '사업소득세', 3300, 'A-1', null)]), NTAX_MAP);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows[0]!.penalty).toBe(0);
  });

  it('뺀 줄 — 납부번호 없음 · 날짜 · 금액 빔 · 금액 숫자 아님/0 이하 · 가산금 > 금액 · 파일 안 겹친 납부번호(첫 줄만)', () => {
    const r = convertPaySheet(ntaxSheet([
      ntaxLine('2026-09-10', '부가가치세', 1000, ''),
      ntaxLine('2026-13-10', '부가가치세', 1000, 'N-1'),
      ntaxLine('2026-09-10', '부가가치세', '', 'N-2'),
      ntaxLine('2026-09-10', '부가가치세', '천원', 'N-3'),
      ntaxLine('2026-09-10', '부가가치세', 0, 'N-4'),
      ntaxLine('2026-09-10', '부가가치세', 100, 'N-5', 101),
      ntaxLine('2026-09-10', '부가가치세', 100, 'N-6'),
      ntaxLine('2026-09-11', '부가가치세', 200, 'N-6'),
    ]), NTAX_MAP);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(8);
    expect(r.rows.map((x) => x.payNo)).toEqual(['N-6']);
    expect(r.rows[0]!.amount).toBe(100);
    expect(r.excluded).toEqual({ badDate: 1, badAmount: 3, noAmount: 1, noPayNo: 1, dupPayNo: 1 });
  });

  it('제목 줄이 다르면 양식이 맞지 않음', () => {
    const r = convertPaySheet([[], ['납부일자', '세목']], NTAX_MAP);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('format_mismatch');
  });
});

describe('지방세 납부(위택스) — 표준 양식', () => {
  it('3줄 제목(빈 이름 칸 · 뒤 빈 칸) · 쉼표 금액 · 점 날짜 · 과세대상에서 귀속 연월 · 납부방법 · 가산금 없음', () => {
    const r = convertPaySheet(ltaxSheet([ltaxLine('1111111-22222222-3333333-4444444', '지방소득세 특별징수분', '2026.10.10', '12,340', '2026년 09월 귀속분')]), LTAX_MAP);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows).toEqual([{
      payDate: '2026-10-10', taxItem: '지방소득세 특별징수분', payNo: '1111111-22222222-3333333-4444444', amount: 12340, penalty: null,
      belongMonth: '2026-09', office: '시험시청', payMethod: '시험납부',
    }]);
  });

  it('과세대상에서 연월을 못 읽으면 귀속은 비우고 줄은 넣는다', () => {
    const r = convertPaySheet(ltaxSheet([ltaxLine('L-1', '주민세', '2026.10.10', '1,000', '시험 과세대상')]), LTAX_MAP);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows[0]!.belongMonth).toBeNull();
  });
});

describe('비용 판정 — 코드 「비용이 아닌 세목」(이름 = 파일 글자)', () => {
  const NOEXP = ['근로소득세(갑)', '사업소득세', '지방소득세 특별징수분', '부가가치세'];
  it('목록에 있으면 비용 아님, 없으면 비용(앞뒤 공백은 걷는다)', () => {
    expect(isExpenseTaxItem(' 부가가치세 ', NOEXP)).toBe(false);
    expect(isExpenseTaxItem('지방소득세 특별징수분', NOEXP)).toBe(false);
    expect(isExpenseTaxItem('주민세', NOEXP)).toBe(true);
  });
  it('★ 처음 보는 세목 — 목록에도 없고 이 단체에서 처음인 세목만, 처음 나온 순서 · 한 번씩', () => {
    expect(firstSeenTaxItems(['자동차세', '부가가치세', '주민세', '자동차세', '등록면허세'], NOEXP, ['주민세'])).toEqual(['자동차세', '등록면허세']);
  });
});

/* ── 4대보험 ─────────────────────────────────────────────────────────────── */

describe('4대보험 — 표준 양식(통합징수포털 CSV)', () => {
  it('★ 건강 파일 한 줄 → 건강 · 장기요양 두 줄(고지보험료) · 보수월액 · 가입자 번호 끝 4자리 · 주민번호 칸은 읽지 않음', () => {
    const r = convertSocialSheet(csvSheet(HI_HEADER, [hiLine('12345678901', '시험가', '3000000', '107850', '14170')]), HI_MAP, 'HI');
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(1);
    expect(r.personCount).toBe(1);
    expect(r.rows).toEqual([
      { insTp: 'HI', memberName: '시험가', memberNoLast4: '8901', noticeAmount: 107850, payBase: 3000000 },
      { insTp: 'LTC', memberName: '시험가', memberNoLast4: '8901', noticeAmount: 14170, payBase: 3000000 },
    ]);
  });

  it('국민연금 — 보수월액 칸이 없어 비움', () => {
    const r = convertSocialSheet(csvSheet(NP_HEADER, [['1', '11122233344', '(가림)', '시험나', '0', '2026.09 ~ 2026.09', '270000']]), NP_MAP, 'NP');
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows).toEqual([{ insTp: 'NP', memberName: '시험나', memberNoLast4: '3344', noticeAmount: 270000, payBase: null }]);
  });

  it('고용 · 산재 대응표 — 고른 보험 종류(산재)의 줄로 만든다', () => {
    const r = convertSocialSheet(csvSheet(EI_HEADER, [['1', '99988877766', '(가림)', '시험다', '22500', '3000000', '']]), EI_MAP, 'IA');
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows.map((x) => x.insTp)).toEqual(['IA']);
  });

  it('고른 보험 종류가 그 대응표에 없으면 양식이 맞지 않음', () => {
    const r = convertSocialSheet(csvSheet(EI_HEADER, [['1', '1', '(가림)', '가', '1', '1', '']]), EI_MAP, 'NP');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('format_mismatch');
  });

  it('뺀 줄 — 이름 없음 · 금액 빔 · 금액(보수월액 포함) 숫자 아님. 번호가 4자리 안 되면 끝 4자리는 비움', () => {
    const r = convertSocialSheet(csvSheet(EI_HEADER, [
      ['1', '11111111111', '(가림)', '', '1000', '100000', ''],
      ['2', '11111111112', '(가림)', '가', '', '100000', ''],
      ['3', '11111111113', '(가림)', '나', '천원', '100000', ''],
      ['4', '11111111114', '(가림)', '다', '1000', '십만', ''],
      ['5', '12', '(가림)', '라', '1000', '', ''],
    ]), EI_MAP, 'EI');
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(5);
    expect(r.rows).toEqual([{ insTp: 'EI', memberName: '라', memberNoLast4: null, noticeAmount: 1000, payBase: null }]);
    expect(r.excluded).toEqual({ badAmount: 2, noAmount: 1, noMemberName: 1 });
    expect(r.personCount).toBe(1);
  });

  it('금액은 0 아래도 받는다(정산 환급 — 214 부호 CHECK 없음)', () => {
    const r = convertSocialSheet(csvSheet(NP_HEADER, [['1', '11122233344', '(가림)', '시험나', '0', '', '-5000']]), NP_MAP, 'NP');
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows[0]!.noticeAmount).toBe(-5000);
  });

  it('보험 종류별 합계 — 줄 수 · 금액, 코드 순서(NP · HI · LTC · EI · IA)', () => {
    const rows = [
      { insTp: 'LTC', memberName: '가', memberNoLast4: null, noticeAmount: 10, payBase: null },
      { insTp: 'HI', memberName: '가', memberNoLast4: null, noticeAmount: 100, payBase: null },
      { insTp: 'HI', memberName: '나', memberNoLast4: null, noticeAmount: 200, payBase: null },
    ];
    expect(socialTotals(rows)).toEqual([{ insTp: 'HI', count: 2, amount: 300 }, { insTp: 'LTC', count: 1, amount: 10 }]);
  });
});

describe('4대보험 올리기 주소 `?insTp=&noticeMonth=`', () => {
  it('보험 종류(NP · HI · EI · IA)와 고지 연월(YYYY-MM)', () => {
    expect(parseSocialUploadQuery({ insTp: 'HI', noticeMonth: '2026-09' })).toEqual({ ok: true, value: { insTp: 'HI', noticeMonth: '2026-09' } });
  });
  it('장기요양(LTC)은 고를 수 없다(건강 파일에서 나온다) · 연월이 틀리면 칸마다 알린다', () => {
    const r = parseSocialUploadQuery({ insTp: 'LTC', noticeMonth: '2026-13' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toEqual(['insTp', 'noticeMonth']);
  });
});

/* ── 대출 ────────────────────────────────────────────────────────────────── */

describe('대출(우리은행 대출거래내역) — 표준 양식', () => {
  it('대출번호 끝 4자리 · 상환(원금상환 · 이자 = 정상 + 연체 − 환출) · 실행(거래원금 > 0) · 수수료 · 잔액 · 거래종류', () => {
    const r = convertLoanSheet(loanSheet([
      loanLine('2026.09.25', { int: 3000, late: 200, refund: 50, fee: 10 }),
      loanLine('2026.09.30', { repay: 1_000_000, int: 1000, bal: 0, tp: '원금상환/이자납입' }),
      loanLine('2026.10.01', { draw: 2_000_000, int: 0, bal: 2_000_000, tp: '대출실행' }),
    ]), LOAN_MAP);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.loanNoLast4).toBe('0123');
    expect(r.rows).toEqual([
      { txnDate: '2026-09-25', txnTp: 'R', txnType: '이자납입', principal: 0, interest: 3150, fee: 10, balance: 1_000_000 },
      { txnDate: '2026-09-30', txnTp: 'R', txnType: '원금상환/이자납입', principal: 1_000_000, interest: 1000, fee: 0, balance: 0 },
      { txnDate: '2026-10-01', txnTp: 'D', txnType: '대출실행', principal: 2_000_000, interest: 0, fee: 0, balance: 2_000_000 },
    ]);
  });

  it('뺀 줄 — 날짜 · 금액(음수 · 글자 · 잔액 빔) · 원금 · 이자 · 수수료 모두 0', () => {
    const r = convertLoanSheet(loanSheet([
      loanLine('2026.02.30'),
      loanLine('2026.09.25', { fee: -1 }),
      loanLine('2026.09.25', { int: '삼천' }),
      loanLine('2026.09.25', { bal: '' }),
      loanLine('2026.09.25', { int: 0 }),
      loanLine('2026.09.26'),
    ]), LOAN_MAP);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows.map((x) => x.txnDate)).toEqual(['2026-09-26']);
    expect(r.excluded).toEqual({ badDate: 1, badAmount: 3, noLoanAmount: 1 });
  });

  it('파일 머리에 대출 계좌번호가 없으면 막는다', () => {
    const r = convertLoanSheet([['우리은행 대출거래내역'], ['조회기간 : 시험'], LOAN_HEADER, loanLine('2026.09.25')], LOAN_MAP);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no_loan_no');
  });

  it('개수 맞추기 열쇠 — 잔액이 다르면 다른 줄', () => {
    const a = { txnDate: '2026-09-25', txnTp: 'R', txnType: '이자납입', principal: 0, interest: 3000, fee: 0, balance: 100 };
    expect(loanDedupKey(a)).toBe(loanDedupKey({ ...a }));
    expect(loanDedupKey(a)).not.toBe(loanDedupKey({ ...a, balance: 99 }));
  });
});

/* ── 카드 · 고정 코드 ─────────────────────────────────────────────────────── */

describe('TAX_UPLOADABLE_KINDS — 국세 · 지방세 · 4대보험 · 대출 카드가 켜진다', () => {
  it('NTAX · LTAX · SOCIAL · LOAN 이 있다', () => {
    for (const k of ['NTAX', 'LTAX', 'SOCIAL', 'LOAN']) expect(TAX_UPLOADABLE_KINDS).toContain(k);
  });
});

describe('★ 고정 코드(code-usage PINNED_CODES) — 214 CHECK · 응답 키', () => {
  it('뺀 줄 종류 — 세 자료의 excluded 키(badDate · badAmount · noAmount 는 205 · 209 몫)와 빠짐없이 · 더하지 않고 같다', () => {
    const p = convertPaySheet(ntaxSheet([ntaxLine('2026-09-10', '부가가치세', 1000, 'N-1')]), NTAX_MAP);
    const s = convertSocialSheet(csvSheet(NP_HEADER, [['1', '11122233344', '(가림)', '가', '0', '', '1000']]), NP_MAP, 'NP');
    const l = convertLoanSheet(loanSheet([loanLine('2026.09.25')]), LOAN_MAP);
    if (!p.ok || !s.ok || !l.ok) throw new Error('변환 실패');
    const keys = [...new Set([...Object.keys(p.excluded), ...Object.keys(s.excluded), ...Object.keys(l.excluded)])]
      .filter((k) => !['badDate', 'badAmount', 'noAmount'].includes(k)).sort();
    const pinned = PINNED_CODES.find((x) => x.category === 'TAX_SKIP_REASON' && x.label === '세무 납부 · 4대보험 · 대출 뺀 줄 종류');
    expect([...(pinned?.codes ?? [])].sort()).toEqual(keys);
  });
  it('4대보험 종류 다섯 · 대출 거래 구분 둘', () => {
    expect(PINNED_CODES.find((x) => x.category === 'TAX_SOCIAL_INS')?.codes).toEqual(['NP', 'HI', 'LTC', 'EI', 'IA']);
    expect(PINNED_CODES.find((x) => x.category === 'TAX_LOAN_TP')?.codes).toEqual(['D', 'R']);
  });
});
