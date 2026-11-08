import { describe, expect, it } from 'vitest';
import {
  HANDOFF_SHEETS,
  handoffFileName,
  handoffMailText,
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

describe('파일 이름 · 기간 글자 · 메일 제목 · 내용', () => {
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

  it('★ 내용 처음 값 — 안녕하세요. 회사명 {기간} 부가세 신고 자료입니다. · 회사명이 없으면 빼고(11-08 ⑧)', () => {
    expect(handoffMailText('(주)브릿지랩', Q3)).toBe('안녕하세요. (주)브릿지랩 2026년 3분기 부가세 신고 자료입니다.');
    expect(handoffMailText('개인상회', H2)).toBe('안녕하세요. 개인상회 2026년 2기 부가세 신고 자료입니다.');
    expect(handoffMailText(null, Q3)).toBe('안녕하세요. 2026년 3분기 부가세 신고 자료입니다.');
  });
});

describe('세는 날짜 — [첫날, 끝 다음 날) → 첫날 · 끝날(항목 지정 · 납부 화면의 기간 직접 지정 꼴)', () => {
  it('7~9월 · 해 넘김', () => {
    expect(handoffRangeDates(['2026-07-01', '2026-10-01'])).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(handoffRangeDates(['2026-10-01', '2027-01-01'])).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(handoffRangeDates(['2028-02-01', '2028-03-01'])).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('보내기 본문', () => {
  const base = { month: '2026-09', tp: 'T', period: '2026-Q3', to: ['tax@example.com'], subject: ' 제목 ', text: '첫 줄\n둘째 줄 ' };

  it('받는 사람 · 제목 · 내용(앞뒤 빈칸만 걷음 · 여러 줄 그대로) · 겹친 받는 사람은 하나로', () => {
    expect(parseHandoffSend(base)).toEqual({
      ok: true, value: { month: '2026-09', tp: 'T', periodId: '2026-Q3', to: ['tax@example.com'], subject: '제목', text: '첫 줄\n둘째 줄' },
    });
    const r = parseHandoffSend({ ...base, to: ['a@x.com', 'a@x.com', 'b@x.com'] });
    expect(r.ok && r.value.to).toEqual(['a@x.com', 'b@x.com']);
  });

  it('★ 받는 사람 0명 — 「받는 사람을 한 명 이상 선택하세요」', () => {
    const r = parseHandoffSend({ ...base, to: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ field: 'to', message: '받는 사람을 한 명 이상 선택하세요' });
  });

  it('★ 제목 · 내용 — 비었으면 거절 · 제목 200자 · 내용 5,000자까지', () => {
    const errs = (x: Record<string, unknown>) => {
      const r = parseHandoffSend({ ...base, ...x });
      return r.ok ? [] : r.errors.map((e) => `${e.field}:${e.message}`);
    };
    expect(errs({ subject: '  ', text: undefined })).toEqual(['subject:제목을 넣으세요', 'text:내용을 넣으세요']);
    expect(errs({ subject: 'a'.repeat(200), text: 'b'.repeat(5000) })).toEqual([]);
    expect(errs({ subject: 'a'.repeat(201), text: 'b'.repeat(5001) })).toEqual(['subject:제목은 200자까지입니다', 'text:내용은 5,000자까지입니다']);
  });

  it('★ 참조는 받지 않는다 — 본문에 cc 를 실어도 결과에 없다(서버가 정한다)', () => {
    const r = parseHandoffSend({ ...base, cc: 'other@x.com' });
    expect(r.ok && 'cc' in r.value).toBe(false);
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
