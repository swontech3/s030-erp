import { describe, expect, it } from 'vitest';
import {
  HANDOFF_SHEETS,
  handoffFileName,
  handoffLogPeriodLabel,
  handoffMailBody,
  handoffPeriodLabel,
  handoffRangeDates,
  handoffSearch,
  handoffSubject,
  parseHandoffQuery,
  parseHandoffSend,
} from './tax-handoff.ts';
import { vatPeriodById } from './tax-vat.ts';

const Q3 = vatPeriodById('C', '2026-Q3')!;
const H2 = vatPeriodById('I', '2026-H2')!;

describe('시트 아홉 — 이 순서 그대로(2026-11-07 지시 4)', () => {
  it('매입 · 매출 · 카드 · 은행거래내역 · 이체내역 · 현금 · 국세 · 지방세 · 대출', () => {
    expect(HANDOFF_SHEETS.map((s) => s.name)).toEqual(['매입', '매출', '카드', '은행거래내역', '이체내역', '현금', '국세', '지방세', '대출']);
    expect(new Set(HANDOFF_SHEETS.map((s) => s.key)).size).toBe(9);
  });
});

describe('주소 — 종류 · 신고 기간', () => {
  it('종류를 빼면 부가세 납부(T) · 기간을 빼면 null', () => {
    expect(parseHandoffQuery({ month: '2026-09' })).toEqual({ ok: true, value: { month: '2026-09', tp: 'T', periodId: null } });
    expect(parseHandoffQuery({ month: '2026-09', tp: 'T', period: '2026-Q2' })).toEqual({
      ok: true, value: { month: '2026-09', tp: 'T', periodId: '2026-Q2' },
    });
  });

  it('★ 원천세 납부(M)는 준비 중 — 400 거리', () => {
    const r = parseHandoffQuery({ month: '2026-09', tp: 'M' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ field: 'tp', message: '원천세 납부는 준비 중입니다 — 인사 시스템 뒤에 엽니다' });
  });

  it('모르는 종류 · 틀린 달 · 틀린 기간은 거절', () => {
    expect(parseHandoffQuery({ month: '2026-09', tp: 'X' }).ok).toBe(false);
    expect(parseHandoffQuery({ month: '2026-9' }).ok).toBe(false);
    expect(parseHandoffQuery({ month: '2026-09', period: '2026-Q5' }).ok).toBe(false);
  });

  it('주소 글자 — 기간이 있으면 싣는다', () => {
    expect(handoffSearch({ month: '2026-09', tp: 'T', periodId: null })).toBe('?month=2026-09&tp=T');
    expect(handoffSearch({ month: '2026-09', tp: 'T', periodId: '2026-Q3' })).toBe('?month=2026-09&tp=T&period=2026-Q3');
  });
});

describe('파일 이름 · 기간 글자 · 메일 제목', () => {
  it('파일 이름 — 세무자료_부가세_2026년3분기.xlsx · 개인은 2기', () => {
    expect(handoffFileName(Q3)).toBe('세무자료_부가세_2026년3분기.xlsx');
    expect(handoffFileName(H2)).toBe('세무자료_부가세_2026년2기.xlsx');
  });

  it('기간 글자 — 2026년 3분기 · 2026년 2기', () => {
    expect(handoffPeriodLabel(Q3)).toBe('2026년 3분기');
    expect(handoffPeriodLabel(H2)).toBe('2026년 2기');
  });

  it('★ 제목 — [회사명] {기간} 부가세 신고 자료 · 회사명이 없으면 대괄호 없이', () => {
    expect(handoffSubject('(주)브릿지랩', Q3)).toBe('[(주)브릿지랩] 2026년 3분기 부가세 신고 자료');
    expect(handoffSubject(null, Q3)).toBe('2026년 3분기 부가세 신고 자료');
    expect(handoffSubject('  ', Q3)).toBe('2026년 3분기 부가세 신고 자료');
  });

  it('이력의 기간 — 첫 달 ~ 끝 달, 한 달이면 그 달', () => {
    expect(handoffLogPeriodLabel('2026-07-01', '2026-09-30')).toBe('2026-07 ~ 2026-09');
    expect(handoffLogPeriodLabel('2026-07-01', '2026-07-31')).toBe('2026-07');
  });
});

describe('세는 날짜 — [첫날, 끝 다음 날) → 첫날 · 끝날(항목 지정 · 납부 화면의 기간 직접 지정 꼴)', () => {
  it('7~9월 · 해 넘김', () => {
    expect(handoffRangeDates(['2026-07-01', '2026-10-01'])).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(handoffRangeDates(['2026-10-01', '2027-01-01'])).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(handoffRangeDates(['2028-02-01', '2028-03-01'])).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('메일 본문 — 시안 S05-10 미리보기 꼴', () => {
  const sheets = HANDOFF_SHEETS.map((s, i) => ({ name: s.name, count: i === 0 ? 3 : 0 }));

  it('인사 · 첨부(시트 아홉과 줄 수) · 남은 일', () => {
    expect(handoffMailBody({ companyName: '(주)브릿지랩', period: Q3, rangeLabel: '7~9월', fileName: '세무자료_부가세_2026년3분기.xlsx', sheets, unassignedCount: 5 }))
      .toBe([
        '안녕하세요, (주)브릿지랩입니다. 2026년 3분기(7~9월) 부가세 신고 자료를 보내 드립니다.',
        '첨부: 세무자료_부가세_2026년3분기.xlsx — 매입 3줄 · 매출 0줄 · 카드 0줄 · 은행거래내역 0줄 · 이체내역 0줄 · 현금 0줄 · 국세 0줄 · 지방세 0줄 · 대출 0줄',
        '아직 남은 일: 미지정 5줄',
      ].join('\n'));
  });

  it('남은 일이 없으면 「남은 일 없음」 · 회사명이 없으면 「안녕하세요.」', () => {
    const body = handoffMailBody({ companyName: null, period: Q3, rangeLabel: '7~8월', fileName: 'f.xlsx', sheets, unassignedCount: 0 });
    expect(body.split('\n')[0]).toBe('안녕하세요. 2026년 3분기(7~8월) 부가세 신고 자료를 보내 드립니다.');
    expect(body.split('\n')[2]).toBe('남은 일 없음');
  });
});

describe('보내기 본문', () => {
  const base = { month: '2026-09', tp: 'T', period: '2026-Q3', to: ['tax@example.com'] };

  it('받는 사람 1~3명 · 겹치면 하나로', () => {
    expect(parseHandoffSend(base)).toEqual({ ok: true, value: { month: '2026-09', tp: 'T', periodId: '2026-Q3', to: ['tax@example.com'] } });
    const r = parseHandoffSend({ ...base, to: ['a@x.com', 'a@x.com', 'b@x.com'] });
    expect(r.ok && r.value.to).toEqual(['a@x.com', 'b@x.com']);
  });

  it('★ 받는 사람 0명 — 「세무 설정에서 세무사 메일을 먼저 넣으세요」', () => {
    const r = parseHandoffSend({ ...base, to: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ field: 'to', message: '받는 사람을 한 명 이상 고르세요' });
  });

  it('★ 받는 사람 4명까지 — 4명 통과(2026-11-07 대표 결정)', () => {
    const r = parseHandoffSend({ ...base, to: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'] });
    expect(r.ok && r.value.to).toHaveLength(4);
  });

  it('다섯 이상 · 메일 꼴이 아님 · 목록이 아님 · 기간 없음 · 원천세는 거절', () => {
    expect(parseHandoffSend({ ...base, to: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'] }).ok).toBe(false);
    expect(parseHandoffSend({ ...base, to: ['not-mail'] }).ok).toBe(false);
    expect(parseHandoffSend({ ...base, to: 'tax@example.com' }).ok).toBe(false);
    expect(parseHandoffSend({ ...base, period: undefined }).ok).toBe(false);
    expect(parseHandoffSend({ ...base, tp: 'M' }).ok).toBe(false);
    expect(parseHandoffSend(null).ok).toBe(false);
  });
});
