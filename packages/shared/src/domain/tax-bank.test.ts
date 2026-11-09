/**
 * 세무 은행 거래내역 · 이체 내역 — 표준 양식 변환 · 개수 맞추기 열쇠 · 이체 짝 짓기 (1-5, 2026-11-01).
 *
 * ★ 값은 모두 지어낸 것이다. 원본 샘플(doc/data-src/)의 값은 쓰지 않는다 — 제목 줄 이름과 칸 위치만 213 대응표 그대로다.
 */
import { describe, expect, it } from 'vitest';
import { PINNED_CODES } from './code-usage.ts';
import { TAX_UPLOADABLE_KINDS } from './tax-uploads.ts';
import {
  XFER_MATCH_SECONDS,
  bankTxnDedupKey,
  convertBankTxnSheet,
  convertBankXferSheet,
  matchTransfers,
  parseBankUploadQuery,
  type BankTxnImportMap,
  type BankXferImportMap,
  type BankXferStdRow,
} from './tax-bank.ts';

const ACCT = '12345678901234';

const KB_HEADER = ['No', '거래일시', '보낸분/받는분', '출금액(원)', '입금액(원)', '잔액(원)', '내 통장 표시', '메모', '적요', '처리점', '구분'];
const KB_MAP: BankTxnImportMap = {
  id: 'BANK_004_TXN', kind: 'BANK', bankCode: '004', bankFileTp: 'TXN', headerRow: 7, headerSignature: KB_HEADER,
  columns: {
    seq: 1, txnAt: 2, counterparty: 3, outAmount: 4, inAmount: 5, balance: 6, myNote: 7, memo: 8, description: 9,
    accountNo: { row: 1, label: '계좌번호', stopAt: null },
  },
};
/** 국민 모양 — 1~6줄 머리(1줄 첫 칸 계좌번호), 7줄 제목, 8줄부터 자료. */
const kbSheet = (rows: unknown[][], acct = '123456-78-901234'): unknown[][] => [
  [`계좌번호 : ${acct}`, null, null, null, null, '최초대출일 : '],
  ['총잔액 : 1,000'], ['계좌명 : 시험'], ['출금가능액 : 1,000'], ['출금합계 : 0', null, null, null, null, '입금합계 : 0'],
  ['조회기간 : 2026.09.01 ~ 2026.09.30'],
  KB_HEADER,
  ...rows,
];
const kbLine = (no: number, at: string, out: number, inn: number, bal: number, x: { cp?: string; note?: string; memo?: string; desc?: string } = {}) =>
  [no, at, x.cp ?? '시험상대', out, inn, bal, x.note ?? '', x.memo ?? '', x.desc ?? '전자금융', '시험점', ''];

const WR_HEADER = ['No.', '거래일시', '적요', '기재내용', '지급(원)', '입금(원)', '거래후 잔액(원)', '취급점', '메모', '수표·어음·증권금액(원)'];
const WR_MAP: BankTxnImportMap = {
  id: 'BANK_020_TXN', kind: 'BANK', bankCode: '020', bankFileTp: 'TXN', headerRow: 4, headerSignature: WR_HEADER,
  columns: {
    seq: 1, txnAt: 2, description: 3, counterparty: 4, outAmount: 5, inAmount: 6, balance: 7, myNote: null, memo: 9,
    accountNo: { row: 2, label: '계좌번호', stopAt: '예금주' },
  },
};
const wrSheet = (rows: unknown[][], acct = '1234567890123'): unknown[][] => [
  Array(10).fill('우리은행 거래내역조회'),
  Array(10).fill(`계좌번호 : ${acct}        예금주 : (시험)`),
  Array(10).fill('조회기간 : 2026.09.01~2026.09.30     '),
  WR_HEADER,
  ...rows,
];

const HN_HEADER = ['No', '거래일시', '적요', '메모', '의뢰인/수취인', '입금', '출금', '거래후잔액', '구분', '거래점', '거래특이사항'];
const HN_MAP: BankTxnImportMap = {
  id: 'BANK_081_TXN', kind: 'BANK', bankCode: '081', bankFileTp: 'TXN', headerRow: 2, headerSignature: HN_HEADER,
  columns: {
    seq: 1, txnAt: 2, description: 3, memo: 4, counterparty: 5, inAmount: 6, outAmount: 7, balance: 8, myNote: null, accountNo: null,
  },
};
const hnSheet = (rows: unknown[][]): unknown[][] => [['거래내역조회'], HN_HEADER, ...rows];

const XF_HEADER = ['No.', '이체일시', '출금계좌번호', '입금은행', '입금계좌번호', '이체금액(원)', '수수료(원)', '수수료후불여부', '받는분',
  '받는분 통장표시', '보내는분 통장표시', '이체결과', '처리내용', '전문(타행)번호', '집금(CMS)번호'];
const XF_MAP: BankXferImportMap = {
  id: 'BANK_020_XFER', kind: 'BANK', bankCode: '020', bankFileTp: 'XFER', headerRow: 2, headerSignature: XF_HEADER,
  columns: {
    seq: 1, xferAt: 2, fromAccount: 3, toBank: 4, toAccount: 5, amount: 6, holder: 9, toMemo: 10, fromMemo: 11,
    done: { col: 12, values: ['처리완료'] },
  },
};
const W_ACCT = '1234567890123';
const xfSheet = (rows: unknown[][]): unknown[][] => [Array(15).fill('인터넷 이체 결과조회'), XF_HEADER, ...rows];
const xfLine = (no: number, at: string, amount: unknown, x: { from?: string; bank?: string; to?: string; holder?: string; done?: string; toMemo?: string; fromMemo?: string } = {}) =>
  [no, at, x.from ?? '1234-567-890123', x.bank ?? '시험은행', x.to ?? '99988877766', amount, 0, '', x.holder ?? '시험받는분',
    x.toMemo ?? '받는표시', x.fromMemo ?? '보낸표시', x.done ?? '처리완료', '정상 처리되었습니다.', '', ''];

/* ── 거래내역 ────────────────────────────────────────────────────────────── */

describe('convertBankTxnSheet — 은행 거래내역 → 표준 양식', () => {
  it('국민 모양 — 칸 번호로 읽고 거래일시는 초까지 · 안 쓰는 쪽 0 · 내 통장 표시까지', () => {
    const r = convertBankTxnSheet(kbSheet([
      kbLine(1, '2026.09.01 09:10:11', 1000, 0, 9000, { note: '표시', memo: '메모1' }),
      kbLine(2, '2026.09.02 10:00:00', 0, 500, 9500, { cp: '' }),
    ]), KB_MAP, ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(2);
    expect(r.rows[0]).toEqual({
      txnAt: '2026-09-01 09:10:11', description: '전자금융', counterparty: '시험상대', myNote: '표시', memo: '메모1',
      inAmount: 0, outAmount: 1000, balance: 9000,
    });
    expect(r.rows[1]!.counterparty).toBeNull();
    expect(r.rows[1]!.myNote).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it('우리 모양 — 「예금주」 앞까지가 계좌번호 · 마지막 합계 줄(No 빔)은 조용히 뺀다 · 내 통장 표시 없음', () => {
    const r = convertBankTxnSheet(wrSheet([
      [1, '2026.09.03 11:00:00', '인터넷', '시험상대', 2000, 0, 8000, '시험점', '', 0],
      [2, '2026.09.03 11:00:00', '인터넷', '시험상대', 2000, 0, 6000, '시험점', '임대', 0],
      ['', '총 2건', '', '', '4,000원', '0원', 6000, '', '', 0],
    ]), WR_MAP, '1234567890123');
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(2);
    expect(r.rows.map((x) => x.balance)).toEqual([8000, 6000]);
    expect(r.rows[1]!.memo).toBe('임대');
    expect(r.rows[0]!.myNote).toBeNull();
    expect(Object.values(r.excluded).every((n) => n === 0)).toBe(true);
  });

  it('하나 모양 — 빈 금액 칸은 0 · 글자 「null」은 빈 칸 · 날짜 yyyy-mm-dd · 합계 줄 뺌 · 계좌번호가 없어 경고하고 받는다', () => {
    const r = convertBankTxnSheet(hnSheet([
      [1, '2026-09-05 08:00:01', null, null, '시험의뢰인', 3000, null, 13000, '타행이체', '시험점', null],
      [2, '2026-09-06 08:00:02', '대체', null, null, null, 1000, 12000, 'null', '시험점', 'null'],
      [null, '합   계', null, null, null, 3000, 1000, null, null, null, null],
    ]), HN_MAP, ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(2);
    expect(r.rows[0]).toMatchObject({ txnAt: '2026-09-05 08:00:01', description: null, inAmount: 3000, outAmount: 0, balance: 13000 });
    expect(r.rows[1]).toMatchObject({ description: '대체', counterparty: null, inAmount: 0, outAmount: 1000 });
    expect(r.warnings.map((w) => w.code)).toEqual(['bank_account_unchecked']);
  });

  it('엑셀 날짜 값(UTC 로 읽은 Date)도 받는다', () => {
    const r = convertBankTxnSheet(hnSheet([[1, new Date(Date.UTC(2026, 8, 7, 14, 5, 6)), '대체', null, null, 0, 100, 900, null, null, null]]), HN_MAP, ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows[0]!.txnAt).toBe('2026-09-07 14:05:06');
  });

  it('★ 파일의 계좌번호가 고른 계좌와 다르면 막는다', () => {
    const r = convertBankTxnSheet(kbSheet([kbLine(1, '2026.09.01 09:00:00', 100, 0, 900)], '999999-99-999999'), KB_MAP, ACCT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('account_mismatch');
  });

  it('계좌번호 이름표가 그 줄에 없으면 경고하고 받는다', () => {
    const sheet = kbSheet([kbLine(1, '2026.09.01 09:00:00', 100, 0, 900)]);
    sheet[0] = ['시험 머리'];
    const r = convertBankTxnSheet(sheet, KB_MAP, ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.warnings.map((w) => w.code)).toEqual(['bank_account_unchecked']);
  });

  it('제목 줄이 다르면 「양식이 맞지 않습니다」', () => {
    const sheet = kbSheet([kbLine(1, '2026.09.01 09:00:00', 100, 0, 900)]);
    sheet[6] = [...KB_HEADER.slice(0, 10), '다른칸'];
    const r = convertBankTxnSheet(sheet, KB_MAP, ACCT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('format_mismatch');
  });

  it('뺀 줄 — 날짜 · 금액 글자 · 음수 · 둘 다 0 · 둘 다 있음 · 잔액 없음', () => {
    const r = convertBankTxnSheet(kbSheet([
      kbLine(1, '2026.13.01 09:00:00', 100, 0, 900),
      kbLine(2, '2026.09.01 25:00:00', 100, 0, 900),
      [3, '2026.09.01 09:00:00', '가', '백원', 0, 900, '', '', '전자금융', '', ''],
      kbLine(4, '2026.09.01 09:00:00', -100, 0, 900),
      kbLine(5, '2026.09.01 09:00:00', 0, 0, 900),
      kbLine(6, '2026.09.01 09:00:00', 100, 100, 900),
      [7, '2026.09.01 09:00:00', '가', 100, 0, '', '', '', '전자금융', '', ''],
      [8, '2026.09.01 09:00:00', '가', 100, 0, '모름', '', '', '전자금융', '', ''],
      kbLine(9, '2026.09.01 09:00:00', 100, 0, 900),
    ]), KB_MAP, ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(9);
    expect(r.rows).toHaveLength(1);
    expect(r.excluded).toEqual({ badDate: 2, badAmount: 2, noAmount: 1, bothInOut: 1, noBalance: 2 });
  });

  it('잔액은 음수도 받는다(마이너스 통장)', () => {
    const r = convertBankTxnSheet(kbSheet([kbLine(1, '2026.09.01 09:00:00', 100, 0, -900)]), KB_MAP, ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows[0]!.balance).toBe(-900);
  });

  it('★ 개수 맞추기 열쇠 — 거래일시 · 입금 · 출금 · 잔액(잔액이 다르면 다른 줄)', () => {
    const r = convertBankTxnSheet(kbSheet([
      kbLine(1, '2026.09.01 09:00:00', 100, 0, 900, { cp: '가' }),
      kbLine(2, '2026.09.01 09:00:00', 100, 0, 800, { cp: '가' }),
      kbLine(3, '2026.09.01 09:00:00', 100, 0, 900, { cp: '나', memo: '다름' }),
    ]), KB_MAP, ACCT);
    if (!r.ok) throw new Error(r.error.message);
    const [a, b, c] = r.rows.map(bankTxnDedupKey);
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
});

/* ── 이체 내역 ───────────────────────────────────────────────────────────── */

describe('convertBankXferSheet — 우리 이체 결과 → 이체 줄', () => {
  it('★ 받는 계좌는 끝 4자리 + 전체 번호(숫자만, 225) · 받는 은행 · 받는분 · 메모 둘 · 합계 줄 뺌', () => {
    const r = convertBankXferSheet(xfSheet([
      xfLine(1, '2026.09.10 10:00:00', 5000, { to: '111-2222-33334444' }),
      xfLine(2, '2026.09.10 11:00:00', 7000, { toMemo: '', fromMemo: '' }),
      ['', '총 2건', '', '', '', '12,000원', '0원', '', '', '', '', '', '', '', ''],
    ]), XF_MAP, W_ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.totalRows).toBe(2);
    expect(r.rows[0]).toEqual({
      xferAt: '2026-09-10 10:00:00', amount: 5000, toBank: '시험은행', toAccountLast4: '4444', toAccountNo: '111222233334444',
      holder: '시험받는분', toMemo: '받는표시', fromMemo: '보낸표시',
    });
    expect(r.rows[1]!.toMemo).toBeNull();
    expect(r.rows[1]!.fromMemo).toBeNull();
  });

  it('뺀 줄 — 처리완료 아님 · 고른 계좌가 아닌 줄 · 날짜 · 금액 · 받는 은행/계좌/받는분 빔 · 받는 계좌 30자리 넘음(225 칸)', () => {
    const r = convertBankXferSheet(xfSheet([
      xfLine(1, '2026.09.10 10:00:00', 5000, { done: '처리중' }),
      xfLine(2, '2026.09.10 10:00:00', 5000, { from: '9999-999-999999' }),
      xfLine(3, '2026.09.99 10:00:00', 5000),
      xfLine(4, '2026.09.10 10:00:00', ''),
      xfLine(5, '2026.09.10 10:00:00', '오천'),
      xfLine(6, '2026.09.10 10:00:00', 0),
      xfLine(7, '2026.09.10 10:00:00', 5000, { bank: '' }),
      xfLine(8, '2026.09.10 10:00:00', 5000, { to: '12-3' }),
      xfLine(9, '2026.09.10 10:00:00', 5000, { holder: '' }),
      xfLine(10, '2026.09.10 10:00:00', 5000),
      xfLine(11, '2026.09.10 10:00:00', 5000, { to: '1'.repeat(31) }),
      xfLine(12, '2026.09.10 10:00:00', 5000, { to: '1'.repeat(30) }),
    ]), XF_MAP, W_ACCT);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.rows.map((x) => x.toAccountNo)).toEqual(['99988877766', '1'.repeat(30)]);
    expect(r.excluded).toEqual({ badDate: 1, badAmount: 2, noAmount: 1, xferNotDone: 1, otherAccount: 1, noToAccount: 4 });
  });
});

/* ── 짝 짓기 ─────────────────────────────────────────────────────────────── */

describe('matchTransfers — 이체 줄 ↔ 출금 줄(같은 계좌 · 이체금액 = 출금액 · ±60초 · 가장 가까운 줄)', () => {
  const x = (at: string, amount: number): BankXferStdRow => ({
    xferAt: at, amount, toBank: '시험은행', toAccountLast4: '4444', toAccountNo: '1234444', holder: '가', toMemo: null, fromMemo: null,
  });
  const out = (id: string, at: string, amount: number, attachedFile: string | null = null) => ({ id, txnAt: at, outAmount: amount, attachedFile });

  it('허용 시각 차는 60초', () => expect(XFER_MATCH_SECONDS).toBe(60));

  it('같은 날 같은 금액 출금이 여럿이면 시각이 가장 가까운 줄과 짝짓는다 · 한 출금 줄은 한 번만', () => {
    const m = matchTransfers(
      [x('2026-09-10 10:00:00', 5000), x('2026-09-10 15:00:01', 5000)],
      [out('a', '2026-09-10 10:00:01', 5000), out('b', '2026-09-10 15:00:00', 5000), out('c', '2026-09-10 12:00:00', 5000)],
    );
    expect(m.pairs.map((p) => p.txnId)).toEqual(['a', 'b']);
    expect(m.unmatched).toBe(0);
  });

  it('60초를 넘거나 금액이 다르면 짝을 찾지 못한다(경고만 — 보관하지 않음)', () => {
    const m = matchTransfers(
      [x('2026-09-10 10:00:00', 5000), x('2026-09-10 11:00:00', 5000)],
      [out('a', '2026-09-10 10:01:01', 5000), out('b', '2026-09-10 11:00:00', 5001)],
    );
    expect(m.pairs).toEqual([]);
    expect(m.unmatched).toBe(2);
    expect(m.statuses).toEqual(['none', 'none']);
  });

  it('★ 60초 경계 — 정확히 60초는 짝', () => {
    const m = matchTransfers([x('2026-09-10 10:00:00', 5000)], [out('a', '2026-09-10 10:01:00', 5000)]);
    expect(m.pairs.map((p) => p.txnId)).toEqual(['a']);
  });

  it('가장 가까운 줄이 둘(같은 시각 차)이면 덧붙이지 않고 「짝을 정할 수 없음」', () => {
    const m = matchTransfers(
      [x('2026-09-10 10:00:00', 5000)],
      [out('a', '2026-09-10 09:59:59', 5000), out('b', '2026-09-10 10:00:01', 5000)],
    );
    expect(m.pairs).toEqual([]);
    expect(m.ambiguous).toBe(1);
    expect(m.statuses).toEqual(['ambiguous']);
  });

  it('★ 가장 가까운 줄에 이미 이체가 덧붙어 있으면 건너뛴다(이미 덧붙인 줄) — 그 파일 이름을 알려 준다', () => {
    const m = matchTransfers(
      [x('2026-09-10 10:00:00', 5000), x('2026-09-11 10:00:00', 7000)],
      [out('a', '2026-09-10 10:00:00', 5000, '먼저_이체.xlsx'), out('b', '2026-09-10 10:00:30', 5000), out('c', '2026-09-11 10:00:00', 7000)],
    );
    expect(m.pairs.map((p) => p.txnId)).toEqual(['c']);
    expect(m.alreadyAttached).toEqual([{ xfer: expect.objectContaining({ amount: 5000 }), fileName: '먼저_이체.xlsx' }]);
    expect(m.statuses).toEqual(['already', 'match']);
  });

  it('상태는 이체 줄 순서 그대로 돌려준다(이체 시각 순으로 짝짓더라도)', () => {
    const m = matchTransfers(
      [x('2026-09-10 15:00:00', 5000), x('2026-09-10 10:00:00', 5000)],
      [out('a', '2026-09-10 10:00:00', 5000)],
    );
    expect(m.statuses).toEqual(['none', 'match']);
    expect(m.pairs).toEqual([{ index: 1, xfer: expect.objectContaining({ xferAt: '2026-09-10 10:00:00' }), txnId: 'a' }]);
  });
});

describe('parseBankUploadQuery — 은행 올리기 주소의 계좌 · 파일 종류', () => {
  it('계좌 id 와 TXN · XFER 를 받는다', () => {
    expect(parseBankUploadQuery({ account: ' fa-1 ', fileTp: 'XFER' })).toEqual({ ok: true, value: { accountId: 'fa-1', fileTp: 'XFER' } });
  });
  it('계좌가 없거나 파일 종류가 TXN · XFER 가 아니면 칸마다 알린다', () => {
    const r = parseBankUploadQuery({ account: '', fileTp: 'X' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toEqual(['account', 'fileTp']);
  });
});

describe('TAX_UPLOADABLE_KINDS — 은행 입출금 카드가 켜진다', () => {
  it('BANK 가 있다', () => expect(TAX_UPLOADABLE_KINDS).toContain('BANK'));
});

describe('★ 고정 코드(code-usage PINNED_CODES) — 은행 뺀 줄 종류 = 응답 키', () => {
  it('BankTxnExcluded · BankXferExcluded 키(badDate · badAmount · noAmount 는 205 · 209 몫)와 빠짐없이 · 더하지 않고 같다', () => {
    const t = convertBankTxnSheet(kbSheet([kbLine(1, '2026.09.01 09:00:00', 100, 0, 900)]), KB_MAP, ACCT);
    const x = convertBankXferSheet(xfSheet([xfLine(1, '2026.09.10 10:00:00', 5000)]), XF_MAP, W_ACCT);
    if (!t.ok || !x.ok) throw new Error('변환 실패');
    const keys = [...new Set([...Object.keys(t.excluded), ...Object.keys(x.excluded)])]
      .filter((k) => !['badDate', 'badAmount', 'noAmount'].includes(k)).sort();
    const pinned = PINNED_CODES.find((p) => p.category === 'TAX_SKIP_REASON' && p.label === '세무 은행 뺀 줄 종류');
    expect([...(pinned?.codes ?? [])].sort()).toEqual(keys);
  });
});
