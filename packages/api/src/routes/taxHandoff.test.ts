/**
 * `/tax/handoff` — 주소 해석(400) · 세션 단체 · 시트 아홉 · 은행 시트 칸 · 보내기 흐름(1-9) · 참조 · 최종 발송(11-08 ⑧).
 *
 * ★ DB 에 붙지 않고 메일도 보내지 않는다 — 메일은 가짜 `Mailer`, 준비 · 사람 · 최종 발송은 가짜 `HandoffSendParts`.
 *   실제 DB 는 `scripts/verify-tax-handoff.js` 가 잰다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErpSession, ScopeRole } from '@swonbiz/shared';
import { HANDOFF_SHEETS, type HandoffLastView, type TaxHandoffResponse } from '@swonbiz/shared/domain/tax-handoff';
import type { TaxClassifyRow } from '@swonbiz/shared/domain/tax-classify';
import type { LoanTxnRow, TaxPaymentRow } from '@swonbiz/shared/domain/tax-payments';
import { vatPeriodById } from '@swonbiz/shared/domain/tax-vat';
import { buildXlsx } from '../lib/xlsxExport.ts';
import type { Mailer, MailMessage } from '../lib/mailer.ts';
import {
  bankAccountLabel,
  buildHandoffSheets,
  handoffCc,
  registerTaxHandoffRoutes,
  sendHandoff,
  sheetView,
  type HandoffBankRow,
  type HandoffLastKey,
  type HandoffPeople,
  type HandoffPrepared,
  type HandoffSendParts,
  type HandoffSources,
  type NewHandoffLast,
  type TaxHandoffDeps,
} from './taxHandoff.ts';

const session = (role: ScopeRole): ErpSession => ({
  erpSid: 'sid-hash',
  s020MemberId: 7,
  s020OrgId: role === 'operator' ? 1 : 9001,
  companyId: null,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

/* ── 시트 ────────────────────────────────────────────────────────────────── */

const row = (over: Partial<TaxClassifyRow>): TaxClassifyRow => ({
  kind: 'INVOICE', id: 'r', direction: 'P', writeDate: '2026-07-01', approvalNo: 'A1', vendorId: null, vendorName: '지어낸 거래처',
  description: null, note: null, bizNo: '9900000011', supplyAmount: 1000, taxAmount: 100, totalAmount: 1100, invClass: 'TAX', cardLast4: null,
  cardAlias: null, vatDeduct: null, payMethod: null, proof: null, fileId: 'f', itemCode: null, suggestedItemCode: null, ...over,
});
const pay = (id: string): TaxPaymentRow => ({
  id, kind: 'NTAX', payDate: '2026-07-10', taxItem: '부가가치세', expense: false, amount: 5000, penalty: 0, belongMonth: null, office: '세무서',
  payMethod: null, payNo: id,
});
const loan: LoanTxnRow = {
  id: 'l1', bankCode: '020', loanLast4: '5678', txnDate: '2026-07-20', txnTp: 'R', txnType: '이자납입', principal: 0, interest: 3000, fee: 0, balance: 100,
};
const bank = (over: Partial<HandoffBankRow>): HandoffBankRow => ({
  txnAt: '2026-07-05 10:20:30', accountNo: '1002123456789', bankCode: '004', alias: null, description: '적요', counterparty: '상대', memo: null,
  inAmount: 0, outAmount: 7000, balance: 50000, xfer: null, ...over,
});

const SRC: HandoffSources = {
  classify: [
    row({ id: 'p1' }),
    row({ id: 'p2', itemCode: 'MEAL' }),
    row({ id: 's1', direction: 'S' }),
    row({ kind: 'CARD', id: 'c1', cardLast4: '4821', cardAlias: '법인카드', vatDeduct: 'Y' }),
    row({ kind: 'CASH', id: 'x1', direction: 'P', totalAmount: 4000, supplyAmount: null, taxAmount: null }),
  ],
  classifyNames: {
    invDirs: [{ code: 'P', name: '매입' }, { code: 'S', name: '매출' }],
    invClasses: [{ code: 'TAX', name: '세금계산서' }],
    itemNames: [{ code: 'MEAL', name: '식대' }],
    deducts: [{ code: 'Y', name: '공제' }],
    payMethods: [],
    proofs: [],
    payMethodHeader: '결제방법',
    proofHeader: '증빙',
  },
  bank: [
    bank({ alias: '운영 통장', inAmount: 9000, outAmount: 0 }),
    bank({
      txnAt: '2026-07-06 09:00:00', outAmount: 3000,
      xfer: { bank: '국민', last4: '1111', accountNo: '99988871111', holder: '받는분', toMemo: '받는 통장 글', fromMemo: '보낸 통장 글' },
    }),
    bank({
      txnAt: '2026-07-07 09:00:00', alias: '운영 통장', outAmount: 2000,
      xfer: { bank: '신한', last4: '2222', accountNo: null, holder: '옛 줄', toMemo: null, fromMemo: null },
    }),
  ],
  ntax: [pay('n1')],
  ltax: [pay('t1'), pay('t2')],
  loans: [loan],
  banks: [{ code: '004', name: '국민은행' }, { code: '020', name: '우리은행' }],
  loanTps: [{ code: 'R', name: '상환' }],
};

describe('buildHandoffSheets — 시트 아홉', () => {
  it('★ 이 순서 · 이 이름 · 줄 수(매입 2 · 매출 1 · 카드 1 · 은행 2 · 이체 1 · 현금 1 · 국세 1 · 지방세 2 · 대출 1)', () => {
    const sheets = buildHandoffSheets(SRC);
    expect(sheets.map((s) => s.key)).toEqual(HANDOFF_SHEETS.map((s) => s.key));
    expect(sheets.map((s) => `${s.sheet.name}:${s.sheet.rows.length}`)).toEqual([
      '매입:2', '매출:1', '카드:1', '은행거래내역:3', '이체내역:2', '현금:1', '국세:1', '지방세:2', '대출:1',
    ]);
  });

  it('매입 · 매출 · 카드 · 현금 · 국세 · 지방세 · 대출은 지금 시트 함수의 칸 그대로', () => {
    const s = Object.fromEntries(buildHandoffSheets(SRC).map((x) => [x.key, x.sheet.columns.map((c) => c.header).join()]));
    expect(s.P).toBe('구분,작성일,승인번호,거래처명,사업자번호,공급가액,세액,종류,계정과목');
    expect(s.S).toBe(s.P);
    expect(s.CARD).toBe('사용일,카드,가맹점명,내용,사업자번호,공급가액,세액,합계,공제 여부,계정과목');
    expect(s.CASH).toBe('날짜,품명,거래처,구분,금액,결제방법,증빙,계정과목');
    expect(s.NTAX).toBe('납부일,세목,비용 여부,금액,가산금,수납관서,전자납부번호');
    expect(s.LTAX).toBe('납부일,세목,비용 여부,금액,귀속 연월,납부기관,납부방법,납세번호');
    expect(s.LOAN).toBe('거래일,대출,구분,거래종류,원금,이자,수수료,잔액');
  });

  it('★ 은행거래내역 — 거래일시 · 계좌 · 적요 · 상대 · 입금 · 출금 · 잔액 · 메모, 계좌는 별칭 또는 끝 4자리(전체 번호 안 나감)', () => {
    const v = sheetView('BANK', buildHandoffSheets(SRC)[3]!.sheet);
    expect(v.columns).toEqual(['거래일시', '계좌', '적요', '상대', '입금', '출금', '잔액', '메모']);
    expect(v.rows).toEqual([
      ['2026-07-05 10:20:30', '운영 통장', '적요', '상대', 9000, 0, 50000, null],
      ['2026-07-06 09:00:00', '끝 6789', '적요', '상대', 0, 3000, 50000, null],
      ['2026-07-07 09:00:00', '운영 통장', '적요', '상대', 0, 2000, 50000, null],
    ]);
    expect(JSON.stringify(v.rows)).not.toContain('1002123456789');
    expect(JSON.stringify(v.rows)).not.toContain('99988871111');
  });

  it('★ 이체내역(225) — 이체 칸이 붙은 출금 줄만 · 보낸 은행 · 보낸 계좌번호(전체) · 보낸이(별칭, 없으면 —) · 받는 계좌번호(전체, 없으면 …끝 4자리) · 통장표시 보내는분 → 받는분', () => {
    const v = sheetView('XFER', buildHandoffSheets(SRC)[4]!.sheet);
    expect(v.columns).toEqual(['거래일시', '보낸 은행', '보낸 계좌번호', '보낸이', '받는 은행', '받는 계좌번호', '받는분', '금액', '보내는분 통장표시', '받는분 통장표시']);
    expect(v.rows).toEqual([
      ['2026-07-06 09:00:00', '국민은행', '1002123456789', '—', '국민', '99988871111', '받는분', 3000, '보낸 통장 글', '받는 통장 글'],
      ['2026-07-07 09:00:00', '국민은행', '1002123456789', '운영 통장', '신한', '…2222', '옛 줄', 2000, null, null],
    ]);
  });

  it('계좌 글자 — 별칭이 있으면 별칭, 없으면 「끝 1234」(★ 전체 번호를 내보내지 않는다)', () => {
    expect(bankAccountLabel('운영 통장', '1002123456789')).toBe('운영 통장');
    expect(bankAccountLabel(null, '1002123456789')).toBe('끝 6789');
    expect(bankAccountLabel('  ', '1002123456789')).toBe('끝 6789');
  });

  it('미리보기 — 엑셀과 같은 값(매입 항목 비면 「분류 필요」, 사업자번호 하이픈)', () => {
    const v = sheetView('P', buildHandoffSheets(SRC)[0]!.sheet);
    expect(v).toMatchObject({ key: 'P', name: '매입' });
    expect(v.rows[0]).toEqual(['매입', '2026-07-01', 'A1', '지어낸 거래처', '990-00-00011', 1000, 100, '세금계산서', '분류 필요']);
    expect(v.rows[1]![8]).toBe('식대');
  });
});

/* ── 보내기 흐름 ─────────────────────────────────────────────────────────── */

const Q3 = vatPeriodById('C', '2026-Q3')!;
const PREPARED: HandoffPrepared = {
  recipients: [{ name: '김세무', email: 'tax@example.com' }, { name: null, email: 'ceo@example.com' }],
  period: Q3,
  fileName: '세무자료_부가세_2026년3분기.xlsx',
  bytes: new Uint8Array([9]),
};
const BODY = {
  month: '2026-09', tp: 'T' as const, periodId: '2026-Q3', to: ['tax@example.com'],
  subject: '[고친 회사] 2026년 3분기 부가세 신고 자료', text: '안녕하세요.\n고친 내용입니다.',
};
const STAFF: HandoffPeople = { sender: { name: '김사원', email: 'staff@x.com' }, rep: { name: '최대표', email: 'ceo@x.com' } };

function fakes(over: { mailer?: Partial<Mailer>; prepared?: Awaited<ReturnType<HandoffSendParts['prepare']>>; people?: HandoffPeople } = {}) {
  const mails: MailMessage[] = [];
  const saved: [HandoffLastKey, NewHandoffLast][] = [];
  const mailer: Mailer = {
    ready: true,
    send: async (m) => {
      mails.push(m);
    },
    ...over.mailer,
  };
  const parts: HandoffSendParts = {
    prepare: async () => over.prepared ?? { ok: true, data: PREPARED },
    people: async () => over.people ?? { sender: { name: '홍길동', email: null }, rep: null },
    saveLast: async (_s, k, l) => {
      saved.push([k, l]);
      return { sentAt: '2026-11-08 10:00', ...l };
    },
  };
  return { mails, saved, mailer, parts };
}

describe('handoffCc — 참조(서버가 정한다)', () => {
  it('★ 발송인이 대표자가 아니면 대표자 · 대표자면 없음(메일로 견줌, 큰 글자 무시)', () => {
    expect(handoffCc(STAFF)).toEqual({ name: '최대표', email: 'ceo@x.com' });
    expect(handoffCc({ ...STAFF, sender: { name: '최대표', email: 'CEO@x.com' } })).toBeNull();
  });

  it('대표자를 모르거나 대표자 메일이 없으면 없음 · 발송인 메일을 모르면 대표자를 참조', () => {
    expect(handoffCc({ ...STAFF, rep: null })).toBeNull();
    expect(handoffCc({ ...STAFF, rep: { name: '최대표', email: null } })).toBeNull();
    expect(handoffCc({ ...STAFF, sender: { name: '김사원', email: null } })).toEqual({ name: '최대표', email: 'ceo@x.com' });
  });
});

describe('sendHandoff', () => {
  it('★ 성공 — 화면이 보낸 제목 · 내용 · 엑셀 첨부로 보내고 최종 발송을 덮어쓴다(단체 · 종류 · 기간 · 보낸 사람 번호 + 이름)', async () => {
    const f = fakes();
    const r = await sendHandoff(session('tenant'), BODY, f.mailer, f.parts);
    expect(r).toEqual({ ok: true, data: { ok: true, last: { sentAt: '2026-11-08 10:00', ...f.saved[0]![1] } } });
    expect(f.mails).toHaveLength(1);
    expect(f.mails[0]).toMatchObject({ to: ['tax@example.com'], subject: BODY.subject, text: BODY.text, fromName: '홍길동', replyTo: null, cc: null });
    expect(f.mails[0]!.attachments).toEqual([{ filename: '세무자료_부가세_2026년3분기.xlsx', content: new Uint8Array([9]) }]);
    expect(f.saved).toEqual([[
      { tp: 'T', periodId: '2026-Q3' },
      { recipients: ['tax@example.com'], cc: null, fileName: '세무자료_부가세_2026년3분기.xlsx', sentBy: '7', sentByName: '홍길동' },
    ]]);
  });

  it('★ 발송인이 대표자가 아니면 대표자를 참조 · 보내는 이름 · 답장 주소는 발송인 — 최종 발송에도 참조', async () => {
    const f = fakes({ people: STAFF });
    await sendHandoff(session('tenant'), BODY, f.mailer, f.parts);
    expect(f.mails[0]).toMatchObject({ fromName: '김사원', replyTo: 'staff@x.com', cc: 'ceo@x.com' });
    expect(f.saved[0]![1]).toMatchObject({ cc: 'ceo@x.com', sentByName: '김사원' });
  });

  it('★ 메일 서버 실패 — 저장하지 않고 결과는 ok false · 사유(500자까지)', async () => {
    const f = fakes({ mailer: { send: async () => { throw new Error('Invalid login: 535 Authentication failed'); } } });
    const r = await sendHandoff(session('tenant'), BODY, f.mailer, f.parts);
    expect(r).toEqual({ ok: true, data: { ok: false, message: '메일을 보내지 못했습니다 — Invalid login: 535 Authentication failed' } });
    expect(f.saved).toHaveLength(0);
    const long = fakes({ mailer: { send: async () => { throw new Error('x'.repeat(900)); } } });
    const r2 = await sendHandoff(session('tenant'), BODY, long.mailer, long.parts);
    expect(r2.ok && !r2.data.ok && r2.data.message).toBe(`메일을 보내지 못했습니다 — ${'x'.repeat(500)}`);
  });

  it('★ 설정이 없으면 503 「메일 발송 설정이 아직 없습니다 — 엑셀을 내려받아 보내 주세요」· 보내지도 남기지도 않는다', async () => {
    const f = fakes({ mailer: { ready: false } });
    const r = await sendHandoff(session('tenant'), BODY, f.mailer, f.parts);
    expect(r).toEqual({ ok: false, status: 503, error: 'mail_not_ready', message: '메일 발송 설정이 아직 없습니다 — 엑셀을 내려받아 보내 주세요' });
    expect(f.mails).toHaveLength(0);
    expect(f.saved).toHaveLength(0);
  });

  it('★ 세무 설정에 없는 메일은 400 — 아무 주소로나 보내지 않는다', async () => {
    const f = fakes();
    const r = await sendHandoff(session('tenant'), { ...BODY, to: ['tax@example.com', 'someone@else.com'] }, f.mailer, f.parts);
    expect(r).toMatchObject({ ok: false, status: 400, error: 'not_recipient' });
    expect(f.mails).toHaveLength(0);
    expect(f.saved).toHaveLength(0);
  });

  it('세무 설정에 세무사 메일이 없으면 400 「세무 설정에서 세무사 메일을 먼저 넣으세요」', async () => {
    const f = fakes({ prepared: { ok: true, data: { ...PREPARED, recipients: [] } } });
    const r = await sendHandoff(session('tenant'), BODY, f.mailer, f.parts);
    expect(r).toMatchObject({ ok: false, status: 400, message: '세무 설정에서 세무사 메일을 먼저 넣으세요' });
  });

  it('준비 실패(기간 · 설정)는 그대로 돌려준다', async () => {
    const bad = { ok: false as const, status: 400 as const, error: 'invalid_request', message: '신고 기간이 올바르지 않습니다' };
    const f = fakes({ prepared: bad });
    expect(await sendHandoff(session('tenant'), BODY, f.mailer, f.parts)).toEqual(bad);
    expect(f.mails).toHaveLength(0);
  });
});

/* ── 라우트 ──────────────────────────────────────────────────────────────── */

const DATA = { query: { month: '2026-09', tp: 'T', periodId: null } } as unknown as TaxHandoffResponse;

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function build(role: ScopeRole, over: Partial<TaxHandoffDeps> = {}) {
  const calls: unknown[][] = [];
  const deps: TaxHandoffDeps = {
    get: async (s, q) => {
      calls.push(['get', s.s020OrgId, q]);
      return { ok: true, data: DATA };
    },
    exportFile: async (s, q) => {
      calls.push(['export', s.s020OrgId, q]);
      return { ok: true, data: { fileName: '세무자료_부가세_2026년3분기.xlsx', bytes: buildXlsx([{ name: 's', columns: [], rows: [] }]) } };
    },
    send: async (s, b) => {
      calls.push(['send', s.s020OrgId, b]);
      return { ok: true, data: { ok: true, last: {} as HandoffLastView } };
    },
    ...over,
  };
  app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.session = session(role);
  });
  registerTaxHandoffRoutes(app, deps);
  await app.ready();
  return { a: app, calls };
}

describe('GET /tax/handoff', () => {
  it('달 · 종류 · 기간으로 세션 단체를 읽는다 — 운영사도 자기 단체', async () => {
    const { a, calls } = await build('operator');
    const res = await a.inject({ method: 'GET', url: '/tax/handoff?month=2026-09&tp=T&period=2026-Q3' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual([['get', 1, { month: '2026-09', tp: 'T', periodId: '2026-Q3' }]]);
  });

  it('★ 원천세 납부(M)는 400 「준비 중」 — 읽지 않는다', async () => {
    const { a, calls } = await build('tenant');
    const res = await a.inject({ method: 'GET', url: '/tax/handoff?month=2026-09&tp=M' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('원천세 납부는 준비 중입니다 — 인사 시스템 뒤에 엽니다');
    expect(calls).toEqual([]);
  });
});

describe('GET /tax/handoff/export', () => {
  it('xlsx 를 한글 파일 이름으로 내려보낸다', async () => {
    const { a, calls } = await build('tenant');
    const res = await a.inject({ method: 'GET', url: '/tax/handoff/export?month=2026-09&tp=T&period=2026-Q3' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('세무자료_부가세_2026년3분기.xlsx'));
    expect(calls).toEqual([['export', 9001, { month: '2026-09', tp: 'T', periodId: '2026-Q3' }]]);
  });
});

describe('POST /tax/handoff/send', () => {
  it('본문을 읽어 보낸다 — 제목 · 내용을 받고 ★ 화면이 보낸 참조는 버린다', async () => {
    const { a, calls } = await build('tenant');
    const res = await a.inject({
      method: 'POST', url: '/tax/handoff/send',
      payload: { month: '2026-09', tp: 'T', period: '2026-Q3', to: ['tax@example.com'], subject: BODY.subject, text: BODY.text, cc: 'x@evil.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([['send', 9001, BODY]]);
  });

  it('제목 · 내용이 비면 400 — 보내지 않는다', async () => {
    const { a, calls } = await build('tenant');
    const res = await a.inject({ method: 'POST', url: '/tax/handoff/send', payload: { month: '2026-09', tp: 'T', period: '2026-Q3', to: ['a@x.com'], subject: ' ', text: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { field: string }) => e.field)).toEqual(['subject', 'text']);
    expect(calls).toEqual([]);
  });

  it('받는 사람 0명 · 원천세는 400 — 보내지 않는다', async () => {
    const { a, calls } = await build('tenant');
    const none = await a.inject({ method: 'POST', url: '/tax/handoff/send', payload: { month: '2026-09', tp: 'T', period: '2026-Q3', to: [] } });
    const wh = await a.inject({ method: 'POST', url: '/tax/handoff/send', payload: { month: '2026-09', tp: 'M', period: '2026-Q3', to: ['a@x.com'] } });
    expect([none.statusCode, wh.statusCode]).toEqual([400, 400]);
    expect(calls).toEqual([]);
  });

  it('503 · 400 실패는 상태와 사유 그대로', async () => {
    const { a } = await build('tenant', {
      send: async () => ({ ok: false, status: 503, error: 'mail_not_ready', message: '메일 발송 설정이 아직 없습니다 — 엑셀을 내려받아 보내 주세요' }),
    });
    const res = await a.inject({ method: 'POST', url: '/tax/handoff/send', payload: { month: '2026-09', tp: 'T', period: '2026-Q3', to: ['a@x.com'], subject: '제목', text: '내용' } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'mail_not_ready', message: '메일 발송 설정이 아직 없습니다 — 엑셀을 내려받아 보내 주세요' });
  });
});
