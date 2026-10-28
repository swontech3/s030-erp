import { describe, expect, it } from 'vitest';
import {
  TAX_ITEM_PARTITION_BY_BIZ,
  classifyDateRange,
  classifyExportFileName,
  classifyPlan,
  classifySearch,
  itemPartitionOf,
  parseClassifyConfirm,
  parseClassifyQuery,
  withEulReul,
} from './tax-classify.ts';

describe('itemPartitionOf — 사업자 유형 → 출금 항목 파티션(고정)', () => {
  it('C → 001 법인 · I → 002 개인 일반과세자', () => {
    expect(TAX_ITEM_PARTITION_BY_BIZ).toEqual({ C: '001', I: '002' });
    expect(itemPartitionOf('C')).toBe('001');
    expect(itemPartitionOf('I')).toBe('002');
  });

  it('세무 설정이 없거나 모르는 유형이면 null — 화면은 막고 안내', () => {
    expect(itemPartitionOf(null)).toBeNull();
    expect(itemPartitionOf('X')).toBeNull();
  });
});

describe('parseClassifyQuery — 주소', () => {
  it('처음 값 — 「확인할 줄만」 · 자료 종류 전체 · 기간 없음 · 파일 없음', () => {
    expect(parseClassifyQuery({ month: '2026-09' })).toEqual({
      ok: true,
      value: { month: '2026-09', view: 'left', kind: 'all', from: null, to: null, fileId: null },
    });
  });

  it('달이 틀리면 400 칸 오류', () => {
    expect(parseClassifyQuery({ month: '2026-9' })).toMatchObject({ ok: false, errors: [{ field: 'month' }] });
  });

  it('보기 · 자료 종류는 정해진 값만', () => {
    expect(parseClassifyQuery({ month: '2026-09', view: 'x' })).toMatchObject({ ok: false, errors: [{ field: 'view' }] });
    expect(parseClassifyQuery({ month: '2026-09', view: 'all', kind: 'X' })).toMatchObject({ ok: false, errors: [{ field: 'kind' }] });
    expect(parseClassifyQuery({ month: '2026-09', view: 'all', kind: 'CARD' })).toMatchObject({ ok: true, value: { kind: 'CARD' } });
  });

  it('기간 직접 지정 — 시작 · 끝 둘 다, 날짜 모양, 시작 ≤ 끝', () => {
    expect(parseClassifyQuery({ month: '2026-09', view: 'all', from: '2026-08-01', to: '2026-09-30' })).toMatchObject({
      ok: true,
      value: { from: '2026-08-01', to: '2026-09-30' },
    });
    expect(parseClassifyQuery({ month: '2026-09', from: '2026-08-01' })).toMatchObject({ ok: false, errors: [{ field: 'period' }] });
    expect(parseClassifyQuery({ month: '2026-09', from: '2026-02-30', to: '2026-03-01' })).toMatchObject({
      ok: false,
      errors: [{ field: 'period' }],
    });
    expect(parseClassifyQuery({ month: '2026-09', from: '2026-09-30', to: '2026-09-01' })).toMatchObject({
      ok: false,
      errors: [{ field: 'period' }],
    });
  });

  it('파일로 들어오면 「전체」 보기 + 기간 거르기 없음(결정)', () => {
    expect(parseClassifyQuery({ month: '2026-09', view: 'left', file: ' f1 ', from: '2026-08-01', to: '2026-08-31' })).toEqual({
      ok: true,
      value: { month: '2026-09', view: 'all', kind: 'all', from: null, to: null, fileId: 'f1' },
    });
  });
});

describe('classifyDateRange — 줄을 고르는 날짜 [첫날, 끝 다음 날)', () => {
  it('처음은 작업할 달', () => {
    expect(classifyDateRange({ month: '2026-12', view: 'all', kind: 'all', from: null, to: null, fileId: null })).toEqual([
      '2026-12-01',
      '2027-01-01',
    ]);
  });

  it('기간 직접 지정 — 끝 날짜까지 넣는다', () => {
    expect(classifyDateRange({ month: '2026-09', view: 'all', kind: 'all', from: '2026-08-15', to: '2026-09-30', fileId: null })).toEqual([
      '2026-08-15',
      '2026-10-01',
    ]);
  });

  it('파일이면 날짜로 거르지 않는다', () => {
    expect(classifyDateRange({ month: '2026-09', view: 'all', kind: 'all', from: null, to: null, fileId: 'f1' })).toBeNull();
  });
});

describe('classifyExportFileName — 항목지정_YYYY-MM.xlsx', () => {
  const base = { month: '2026-09', view: 'all' as const, kind: 'all' as const, from: null, to: null, fileId: null };
  it('작업할 달', () => {
    expect(classifyExportFileName(base)).toBe('항목지정_2026-09.xlsx');
  });
  it('기간 직접 지정이면 YYYY-MM~YYYY-MM', () => {
    expect(classifyExportFileName({ ...base, from: '2026-07-01', to: '2026-09-30' })).toBe('항목지정_2026-07~2026-09.xlsx');
  });
  it('파일로 들어왔으면 작업할 달 이름', () => {
    expect(classifyExportFileName({ ...base, fileId: 'f1' })).toBe('항목지정_2026-09.xlsx');
  });
});

describe('parseClassifyConfirm — [확정] · [선택한 줄에 붙이기]', () => {
  const items = ['RENT', 'TEL'];

  it('줄마다 항목 — 그대로', () => {
    expect(parseClassifyConfirm({ rows: [{ id: 'a', itemCode: 'RENT' }, { id: 'b', itemCode: 'TEL' }] }, items)).toEqual({
      ok: true,
      value: [{ id: 'a', itemCode: 'RENT' }, { id: 'b', itemCode: 'TEL' }],
    });
  });

  it('고른 줄이 없거나 모양이 틀리면 rows 오류', () => {
    expect(parseClassifyConfirm({ rows: [] }, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
    expect(parseClassifyConfirm({ rows: [{ id: '', itemCode: 'RENT' }] }, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
    expect(parseClassifyConfirm(null, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
  });

  it('같은 줄을 두 번 보내면 rows 오류', () => {
    expect(parseClassifyConfirm({ rows: [{ id: 'a', itemCode: 'RENT' }, { id: 'a', itemCode: 'TEL' }] }, items)).toMatchObject({
      ok: false,
      errors: [{ field: 'rows' }],
    });
  });

  it('그 회사 목록에 없는 항목은 itemCode 오류', () => {
    expect(parseClassifyConfirm({ rows: [{ id: 'a', itemCode: 'ENTERTAIN' }] }, items)).toMatchObject({
      ok: false,
      errors: [{ field: 'itemCode', message: '없는 항목입니다' }],
    });
  });

  it('사업자 유형이 없어 목록이 비면 — 세무 설정 안내', () => {
    expect(parseClassifyConfirm({ rows: [{ id: 'a', itemCode: 'RENT' }] }, [])).toMatchObject({
      ok: false,
      errors: [{ field: 'itemCode', message: '세무 설정에서 사업자 유형을 먼저 고르세요' }],
    });
  });
});

describe('classifyPlan — 목록 위 버튼이 할 일', () => {
  const rows = [
    { id: 'a', itemCode: null, suggestedItemCode: 'RENT' }, // 골라 둔 항목 있음
    { id: 'b', itemCode: null, suggestedItemCode: null }, // 항목 없음
    { id: 'c', itemCode: 'TEL', suggestedItemCode: null }, // 확정함
    { id: 'd', itemCode: 'AD', suggestedItemCode: null }, // 확정했고 [고치기] 중
  ];

  it('[확정] — 아직 확정 안 된 줄 중 항목이 있는 줄(고른 값 > 골라 둔 값), 없는 줄은 건너뜀', () => {
    expect(classifyPlan(rows, ['a', 'b', 'c'], {}, new Set())).toEqual({
      confirm: [{ id: 'a', itemCode: 'RENT' }],
      skipped: 1,
      reopen: ['c'],
    });
    expect(classifyPlan(rows, ['a', 'b'], { a: 'MEAL', b: 'AD' }, new Set()).confirm).toEqual([
      { id: 'a', itemCode: 'MEAL' },
      { id: 'b', itemCode: 'AD' },
    ]);
  });

  it('[고치기] 중인 줄은 다시 확정 대상 — 처음 값은 지금 항목, 고르면 덮는다', () => {
    expect(classifyPlan(rows, ['d'], {}, new Set(['d']))).toEqual({ confirm: [{ id: 'd', itemCode: 'AD' }], skipped: 0, reopen: [] });
    expect(classifyPlan(rows, ['d'], { d: 'TEL' }, new Set(['d'])).confirm).toEqual([{ id: 'd', itemCode: 'TEL' }]);
  });

  it('고른 줄이 없으면 할 일 없음', () => {
    expect(classifyPlan(rows, [], {}, new Set())).toEqual({ confirm: [], skipped: 0, reopen: [] });
  });
});

describe('withEulReul — 「항목」을/를', () => {
  it('받침이 있으면 을, 없으면 를, 한글이 아니면 (을)를', () => {
    expect(withEulReul('사무실 월세')).toBe('사무실 월세를');
    expect(withEulReul('통신비')).toBe('통신비를');
    expect(withEulReul('수수료')).toBe('수수료를');
    expect(withEulReul('식대·회의비')).toBe('식대·회의비를');
    expect(withEulReul('잘 모름 — 세무사에게 묻기')).toBe('잘 모름 — 세무사에게 묻기를');
    expect(withEulReul('접대비')).toBe('접대비를');
    expect(withEulReul('사업과 무관 — 대표 인출')).toBe('사업과 무관 — 대표 인출을');
    expect(withEulReul('ABC')).toBe('ABC(을)를');
  });
});

describe('classifySearch — 화면 · 엑셀이 같은 주소', () => {
  const base = { month: '2026-09', view: 'left' as const, kind: 'all' as const, from: null, to: null, fileId: null };
  const roundTrip = (s: string) => parseClassifyQuery(Object.fromEntries(new URLSearchParams(s)));

  it('처음 값은 달만 싣는다', () => {
    expect(classifySearch(base)).toBe('?month=2026-09');
  });

  it('보기 · 종류 · 기간 — 다시 읽으면 같은 값', () => {
    const q = { ...base, view: 'all' as const, kind: 'S' as const, from: '2026-08-01', to: '2026-09-30' };
    expect(roundTrip(classifySearch(q))).toEqual({ ok: true, value: q });
  });

  it('파일이면 기간을 싣지 않는다', () => {
    const q = { ...base, view: 'all' as const, fileId: 'f 1' };
    expect(classifySearch({ ...q, from: '2026-08-01', to: '2026-08-31' })).toBe('?month=2026-09&view=all&file=f+1');
    expect(roundTrip(classifySearch(q))).toEqual({ ok: true, value: q });
  });
});
