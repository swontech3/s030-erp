import { describe, expect, it } from 'vitest';
import { PINNED_CODES } from './code-usage.ts';
import {
  CARD_NOTE_MAX,
  CLASSIFY_KINDS,
  CLASSIFY_STATUSES,
  TAX_CLS_SOURCE_CATEGORY,
  TAX_CLS_STATUS_CATEGORY,
  TAX_CLS_DONE,
  TAX_CLS_LEFT,
  TAX_ITEM_PARTITION_BY_BIZ,
  classifyBulk,
  classifyContentOf,
  classifyPlaceOf,
  classifySourceLabel,
  filterClassifyRows,
  classifyDateRange,
  classifyExportFileName,
  classifyPlan,
  classifyRowKey,
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
  it('처음 값 — 구분 전체 · 출처 전체 · 기간 없음 · 파일 없음', () => {
    expect(parseClassifyQuery({ month: '2026-09' })).toEqual({
      ok: true,
      value: { month: '2026-09', status: 'all', kind: 'all', from: null, to: null, fileId: null, item: null },
    });
  });

  it('달이 틀리면 400 칸 오류', () => {
    expect(parseClassifyQuery({ month: '2026-9' })).toMatchObject({ ok: false, errors: [{ field: 'month' }] });
  });

  it('구분(전체 · 미지정 L · 지정 D) · 출처는 정해진 값만', () => {
    expect(parseClassifyQuery({ month: '2026-09', status: 'L' })).toMatchObject({ ok: true, value: { status: 'L' } });
    expect(parseClassifyQuery({ month: '2026-09', status: 'D' })).toMatchObject({ ok: true, value: { status: 'D' } });
    expect(parseClassifyQuery({ month: '2026-09', status: 'x' })).toMatchObject({ ok: false, errors: [{ field: 'status' }] });
    expect(parseClassifyQuery({ month: '2026-09', kind: 'X' })).toMatchObject({ ok: false, errors: [{ field: 'kind' }] });
    expect(parseClassifyQuery({ month: '2026-09', kind: 'CARD' })).toMatchObject({ ok: true, value: { kind: 'CARD' } });
    // 개인카드 · 은행 — 코드는 있으나 「사용 안 함」(선택지에 안 보임). 주소로 와도 빈 목록
    expect(parseClassifyQuery({ month: '2026-09', kind: 'PCARD' })).toMatchObject({ ok: true, value: { kind: 'PCARD' } });
    expect(parseClassifyQuery({ month: '2026-09', kind: 'PPIYONG' })).toMatchObject({ ok: false, errors: [{ field: 'kind' }] });
  });

  it('계정과목(2026-11-08 추가) — 코드값 하나 · 없거나 빈 글이면 null(전체)', () => {
    expect(parseClassifyQuery({ month: '2026-09', item: ' RENT ' })).toMatchObject({ ok: true, value: { item: 'RENT' } });
    expect(parseClassifyQuery({ month: '2026-09', item: '' })).toMatchObject({ ok: true, value: { item: null } });
  });

  it('옛 주소의 view(자료 올리기 [보기] 의 view=all)는 보지 않는다', () => {
    expect(parseClassifyQuery({ month: '2026-09', view: 'all', file: 'f1' })).toEqual({
      ok: true,
      value: { month: '2026-09', status: 'all', kind: 'all', from: null, to: null, fileId: 'f1', item: null },
    });
  });

  it('기간 직접 지정(세무사 전달이 쓴다) — 시작 · 끝 둘 다, 날짜 모양, 시작 ≤ 끝', () => {
    expect(parseClassifyQuery({ month: '2026-09', from: '2026-08-01', to: '2026-09-30' })).toMatchObject({
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

  it('파일로 들어오면 기간 거르기 없음(결정) — 구분은 그대로', () => {
    expect(parseClassifyQuery({ month: '2026-09', status: 'L', file: ' f1 ', from: '2026-08-01', to: '2026-08-31' })).toEqual({
      ok: true,
      value: { month: '2026-09', status: 'L', kind: 'all', from: null, to: null, fileId: 'f1', item: null },
    });
  });
});

describe('classifyDateRange — 줄을 고르는 날짜 [첫날, 끝 다음 날)', () => {
  it('처음은 작업할 달', () => {
    expect(classifyDateRange({ month: '2026-12', status: 'all', kind: 'all', from: null, to: null, fileId: null, item: null })).toEqual([
      '2026-12-01',
      '2027-01-01',
    ]);
  });

  it('기간 직접 지정 — 끝 날짜까지 넣는다', () => {
    expect(classifyDateRange({ month: '2026-09', status: 'all', kind: 'all', from: '2026-08-15', to: '2026-09-30', fileId: null, item: null })).toEqual([
      '2026-08-15',
      '2026-10-01',
    ]);
  });

  it('파일이면 날짜로 거르지 않는다', () => {
    expect(classifyDateRange({ month: '2026-09', status: 'all', kind: 'all', from: null, to: null, fileId: 'f1', item: null })).toBeNull();
  });
});

describe('classifyExportFileName — 항목지정_YYYY-MM.xlsx', () => {
  const base = { month: '2026-09', status: 'all' as const, kind: 'all' as const, from: null, to: null, fileId: null, item: null };
  it('작업할 달', () => {
    expect(classifyExportFileName(base)).toBe('항목지정_2026-09.xlsx');
  });
  it('기간 직접 지정이면 YYYY-MM~YYYY-MM', () => {
    expect(classifyExportFileName({ ...base, from: '2026-07-01', to: '2026-09-30' })).toBe('항목지정_2026-07~2026-09.xlsx');
  });
  it('파일로 들어왔으면 작업할 달 이름', () => {
    expect(classifyExportFileName({ ...base, fileId: 'f1', item: null })).toBe('항목지정_2026-09.xlsx');
  });
});

describe('parseClassifyConfirm — [확정] · [선택한 줄에 붙이기]', () => {
  const items = ['RENT', 'TEL'];

  it('줄마다 자료 종류 · 항목 — 그대로(1-4 결정 20 — kind 로 표를 고른다). 카드 줄은 내용이 없으면 null', () => {
    expect(
      parseClassifyConfirm({ rows: [{ kind: 'INVOICE', id: 'a', itemCode: 'RENT' }, { kind: 'CARD', id: 'b', itemCode: 'TEL' }, { kind: 'CASH', id: 'c', itemCode: 'TEL' }] }, items),
    ).toEqual({
      ok: true,
      value: [{ kind: 'INVOICE', id: 'a', itemCode: 'RENT' }, { kind: 'CARD', id: 'b', itemCode: 'TEL', note: null }, { kind: 'CASH', id: 'c', itemCode: 'TEL' }],
    });
  });

  it('카드 줄 내용(222) — 앞뒤 공백을 걷고, 빈 글은 null, 100자까지', () => {
    expect(parseClassifyConfirm({ rows: [{ kind: 'CARD', id: 'b', itemCode: 'TEL', note: '  거래처 점심 ' }] }, items)).toEqual({
      ok: true,
      value: [{ kind: 'CARD', id: 'b', itemCode: 'TEL', note: '거래처 점심' }],
    });
    expect(parseClassifyConfirm({ rows: [{ kind: 'CARD', id: 'b', itemCode: 'TEL', note: '   ' }] }, items)).toMatchObject({
      ok: true,
      value: [{ note: null }],
    });
    expect(parseClassifyConfirm({ rows: [{ kind: 'CARD', id: 'b', itemCode: 'TEL', note: '가'.repeat(CARD_NOTE_MAX) }] }, items)).toMatchObject({ ok: true });
    expect(parseClassifyConfirm({ rows: [{ kind: 'CARD', id: 'b', itemCode: 'TEL', note: '가'.repeat(CARD_NOTE_MAX + 1) }] }, items)).toMatchObject({
      ok: false,
      errors: [{ field: 'note' }],
    });
    expect(parseClassifyConfirm({ rows: [{ kind: 'CARD', id: 'b', itemCode: 'TEL', note: 3 }] }, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
  });

  it('내용은 카드 줄에만 — 계산서 · 현금 줄에 내용이 오면 note 오류(현금은 품명이 따로 있다)', () => {
    expect(parseClassifyConfirm({ rows: [{ kind: 'CASH', id: 'c', itemCode: 'TEL', note: '메모' }] }, items)).toMatchObject({
      ok: false,
      errors: [{ field: 'note' }],
    });
    expect(parseClassifyConfirm({ rows: [{ kind: 'INVOICE', id: 'a', itemCode: 'TEL', note: null }] }, items)).toMatchObject({ ok: true });
  });

  it('고른 줄이 없거나 모양이 틀리면 rows 오류 — 자료 종류가 없거나 모르는 값이어도', () => {
    expect(parseClassifyConfirm({ rows: [] }, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
    expect(parseClassifyConfirm({ rows: [{ kind: 'INVOICE', id: '', itemCode: 'RENT' }] }, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
    expect(parseClassifyConfirm({ rows: [{ id: 'a', itemCode: 'RENT' }] }, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
    expect(parseClassifyConfirm({ rows: [{ kind: 'BANK', id: 'a', itemCode: 'RENT' }] }, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
    expect(parseClassifyConfirm(null, items)).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
  });

  it('같은 줄을 두 번 보내면 rows 오류 — 종류가 다르면 같은 id 라도 다른 줄', () => {
    expect(
      parseClassifyConfirm({ rows: [{ kind: 'CARD', id: 'a', itemCode: 'RENT' }, { kind: 'CARD', id: 'a', itemCode: 'TEL' }] }, items),
    ).toMatchObject({ ok: false, errors: [{ field: 'rows' }] });
    expect(
      parseClassifyConfirm({ rows: [{ kind: 'CARD', id: 'a', itemCode: 'RENT' }, { kind: 'CASH', id: 'a', itemCode: 'TEL' }] }, items),
    ).toMatchObject({ ok: true });
  });

  it('그 회사 목록에 없는 항목은 itemCode 오류', () => {
    expect(parseClassifyConfirm({ rows: [{ kind: 'INVOICE', id: 'a', itemCode: 'ENTERTAIN' }] }, items)).toMatchObject({
      ok: false,
      errors: [{ field: 'itemCode', message: '없는 항목입니다' }],
    });
  });

  it('사업자 유형이 없어 목록이 비면 — 세무 설정 안내', () => {
    expect(parseClassifyConfirm({ rows: [{ kind: 'INVOICE', id: 'a', itemCode: 'RENT' }] }, [])).toMatchObject({
      ok: false,
      errors: [{ field: 'itemCode', message: '세무 설정에서 사업자 유형을 먼저 고르세요' }],
    });
  });
});

describe('classifyRowKey — 화면이 줄을 가리키는 열쇠(세 표의 id 가 겹쳐도 갈린다)', () => {
  it('자료 종류:id', () => {
    expect(classifyRowKey({ kind: 'CARD', id: 'x' })).toBe('CARD:x');
    expect(classifyRowKey({ kind: 'CASH', id: 'x' })).not.toBe(classifyRowKey({ kind: 'CARD', id: 'x' }));
  });
});

describe('classifyPlan — 버튼 줄 [확정] · [수정]이 할 일(고른 줄 기준)', () => {
  const rows = [
    { kind: 'INVOICE' as const, id: 'a', direction: 'P', itemCode: null, suggestedItemCode: 'RENT', note: null }, // 골라 둔 항목 있음
    { kind: 'CARD' as const, id: 'b', direction: 'P', itemCode: null, suggestedItemCode: null, note: '저장된 내용' }, // 항목 없음
    { kind: 'CASH' as const, id: 'c', direction: 'P', itemCode: 'TEL', suggestedItemCode: null, note: null }, // 확정함
    { kind: 'INVOICE' as const, id: 'd', direction: 'P', itemCode: 'AD', suggestedItemCode: null, note: null }, // 확정했고 [수정] 중
    { kind: 'INVOICE' as const, id: 's', direction: 'S', itemCode: null, suggestedItemCode: null, note: null }, // 매출 — 항목 없음
  ];
  const [A, B, C, D, S] = ['INVOICE:a', 'CARD:b', 'CASH:c', 'INVOICE:d', 'INVOICE:s'];

  it('[확정] — 아직 확정 안 된 줄 중 항목이 있는 줄(고른 값 > 골라 둔 값), 없는 줄은 건너뜀 · [수정]은 확정한 줄', () => {
    expect(classifyPlan(rows, [A, B, C], {}, new Set())).toEqual({
      confirm: [{ kind: 'INVOICE', id: 'a', itemCode: 'RENT' }],
      skipped: 1,
      reopen: [C],
    });
    expect(classifyPlan(rows, [A, B], { [A]: 'MEAL', [B]: 'AD' }, new Set()).confirm).toEqual([
      { kind: 'INVOICE', id: 'a', itemCode: 'MEAL' },
      { kind: 'CARD', id: 'b', itemCode: 'AD', note: '저장된 내용' },
    ]);
  });

  it('카드 줄 내용 — 고쳐 쓴 글이 있으면 그것(빈 글 포함), 없으면 저장된 내용을 함께 보낸다', () => {
    expect(classifyPlan(rows, [B], { [B]: 'AD' }, new Set(), { [B]: '회의 다과' }).confirm).toEqual([
      { kind: 'CARD', id: 'b', itemCode: 'AD', note: '회의 다과' },
    ]);
    expect(classifyPlan(rows, [B], { [B]: 'AD' }, new Set(), { [B]: '' }).confirm).toEqual([{ kind: 'CARD', id: 'b', itemCode: 'AD', note: '' }]);
  });

  it('[수정] 중인 줄은 다시 확정 대상 — 처음 값은 지금 항목, 고르면 덮는다', () => {
    expect(classifyPlan(rows, [D], {}, new Set([D]))).toEqual({ confirm: [{ kind: 'INVOICE', id: 'd', itemCode: 'AD' }], skipped: 0, reopen: [] });
    expect(classifyPlan(rows, [D], { [D]: 'TEL' }, new Set([D])).confirm).toEqual([{ kind: 'INVOICE', id: 'd', itemCode: 'TEL' }]);
  });

  it('매출 줄은 고를 일이 없다 — 확정 · 건너뜀 · 수정 어디에도 세지 않는다(구분 「전체」에서 섞여 골라도)', () => {
    expect(classifyPlan(rows, [S], {}, new Set())).toEqual({ confirm: [], skipped: 0, reopen: [] });
    expect(classifyPlan(rows, [A, S, C], {}, new Set())).toEqual({ confirm: [{ kind: 'INVOICE', id: 'a', itemCode: 'RENT' }], skipped: 0, reopen: [C] });
  });

  it('고른 줄이 없으면 할 일 없음', () => {
    expect(classifyPlan(rows, [], {}, new Set())).toEqual({ confirm: [], skipped: 0, reopen: [] });
  });
});

describe('classifyBulk — [선택한 줄에 붙이기] (지금 규칙 그대로 — 열린 매입 줄만)', () => {
  const rows = [
    { kind: 'INVOICE' as const, id: 'a', direction: 'P', itemCode: null, suggestedItemCode: null, note: null },
    { kind: 'CARD' as const, id: 'b', direction: 'P', itemCode: null, suggestedItemCode: null, note: '저장된 내용' },
    { kind: 'CASH' as const, id: 'c', direction: 'P', itemCode: 'TEL', suggestedItemCode: null, note: null }, // 확정함(수정 중 아님)
    { kind: 'INVOICE' as const, id: 's', direction: 'S', itemCode: null, suggestedItemCode: null, note: null },
  ];
  it('고른 줄 중 미지정 · 수정 중인 매입 줄에 같은 항목 — 카드는 내용을 함께', () => {
    expect(classifyBulk(rows, ['INVOICE:a', 'CARD:b', 'CASH:c', 'INVOICE:s'], 'AD', new Set(), { 'CARD:b': '새 내용' })).toEqual([
      { kind: 'INVOICE', id: 'a', itemCode: 'AD' },
      { kind: 'CARD', id: 'b', itemCode: 'AD', note: '새 내용' },
    ]);
    expect(classifyBulk(rows, ['CASH:c'], 'AD', new Set(['CASH:c']), {})).toEqual([{ kind: 'CASH', id: 'c', itemCode: 'AD' }]);
  });
});

describe('filterClassifyRows — 검색조건 「구분」(전체 · 미지정 · 지정)', () => {
  const rows = [
    { id: 'a', direction: 'P', itemCode: null },
    { id: 'b', direction: 'P', itemCode: 'RENT' },
    { id: 's', direction: 'S', itemCode: null },
  ];
  it('전체 — 매출 줄까지 모두', () => {
    expect(filterClassifyRows(rows, 'all').map((r) => r.id)).toEqual(['a', 'b', 's']);
  });
  it('계정과목을 고르면 그 계정과목으로 확정된 줄만 — 구분과 함께 걸린다', () => {
    expect(filterClassifyRows(rows, 'all', 'RENT').map((r) => r.id)).toEqual(['b']);
    expect(filterClassifyRows(rows, TAX_CLS_DONE, 'RENT').map((r) => r.id)).toEqual(['b']);
    expect(filterClassifyRows(rows, TAX_CLS_LEFT, 'RENT')).toEqual([]);
    expect(filterClassifyRows(rows, 'all', 'TEL')).toEqual([]);
    expect(filterClassifyRows(rows, 'all', null).map((r) => r.id)).toEqual(['a', 'b', 's']);
  });
  it('미지정 L — 항목이 빈 매입 줄 · 지정 D — 항목이 있는 매입 줄(매출은 어느 쪽도 아니다)', () => {
    expect(filterClassifyRows(rows, TAX_CLS_LEFT).map((r) => r.id)).toEqual(['a']);
    expect(filterClassifyRows(rows, TAX_CLS_DONE).map((r) => r.id)).toEqual(['b']);
  });
});

describe('목록 · 엑셀 칸 글자 — 출처 · 사용처 · 내용(화면과 엑셀이 같은 함수)', () => {
  const names = {
    invDirs: [{ code: 'P', name: '매입' }, { code: 'S', name: '매출' }],
    kinds: [{ code: 'CARD', name: '카드 사용 내역' }, { code: 'CASH', name: '현금 경비' }],
  };
  const base = { kind: 'INVOICE' as const, direction: 'P', vendorName: '지어낸 임대인', description: null, note: null, cardAlias: null, cardLast4: null };
  it('출처 — 계산서는 「매입 계산서」 · 카드는 별칭(없으면 「카드 사용 내역 · 끝 4821」) · 현금은 자료 종류 이름', () => {
    expect(classifySourceLabel(base, names)).toBe('매입 계산서');
    expect(classifySourceLabel({ ...base, direction: 'S' }, names)).toBe('매출 계산서');
    expect(classifySourceLabel({ ...base, kind: 'CARD', cardLast4: '4821' }, names)).toBe('카드 사용 내역 · 끝 4821');
    expect(classifySourceLabel({ ...base, kind: 'CARD', cardLast4: '4821', cardAlias: '법인카드 1' }, names)).toBe('법인카드 1');
    expect(classifySourceLabel({ ...base, kind: 'CASH' }, names)).toBe('현금 경비');
  });
  it('사용처 — 거래처 · 가맹점 이름, 비었으면 null(화면 「—」)', () => {
    expect(classifyPlaceOf(base)).toBe('지어낸 임대인');
    expect(classifyPlaceOf({ ...base, kind: 'CASH', vendorName: '  ' })).toBeNull();
  });
  it('내용 — 카드는 적은 내용 · 현금은 품명 · 계산서는 null(화면 「—」)', () => {
    expect(classifyContentOf({ ...base, kind: 'CARD', note: '회의 다과' })).toBe('회의 다과');
    expect(classifyContentOf({ ...base, kind: 'CARD' })).toBeNull();
    expect(classifyContentOf({ ...base, kind: 'CASH', description: '복사 용지' })).toBe('복사 용지');
    expect(classifyContentOf({ ...base, note: '오면 안 됨' })).toBeNull();
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
  const base = { month: '2026-09', status: 'all' as const, kind: 'all' as const, from: null, to: null, fileId: null, item: null };
  const roundTrip = (s: string) => parseClassifyQuery(Object.fromEntries(new URLSearchParams(s)));

  it('처음 값은 달만 싣는다', () => {
    expect(classifySearch(base)).toBe('?month=2026-09');
  });

  it('구분 · 출처 · 기간 — 다시 읽으면 같은 값', () => {
    const q = { ...base, status: 'D' as const, kind: 'S' as const, from: '2026-08-01', to: '2026-09-30' };
    expect(classifySearch(q)).toBe('?month=2026-09&status=D&kind=S&from=2026-08-01&to=2026-09-30');
    expect(classifySearch({ ...q, item: 'RENT' })).toBe('?month=2026-09&status=D&kind=S&item=RENT&from=2026-08-01&to=2026-09-30');
    expect(roundTrip(classifySearch({ ...q, item: 'RENT' }))).toEqual({ ok: true, value: { ...q, item: 'RENT' } });
    expect(roundTrip(classifySearch(q))).toEqual({ ok: true, value: q });
  });

  it('파일이면 기간을 싣지 않는다', () => {
    const q = { ...base, status: 'L' as const, fileId: 'f 1' };
    expect(classifySearch({ ...q, from: '2026-08-01', to: '2026-08-31' })).toBe('?month=2026-09&status=L&file=f+1');
    expect(roundTrip(classifySearch(q))).toEqual({ ok: true, value: q });
  });
});

describe('★ 고정 코드(code-usage PINNED_CODES) — 구분 · 출처 코드값 = 서버가 거르는 값(222)', () => {
  it('TAX_CLS_STATUS 000 = L · D, TAX_CLS_SOURCE 000 = 출처 값(「전체」 빼고) 빠짐없이 · 더하지 않고', () => {
    const pin = (category: string) => PINNED_CODES.find((p) => p.category === category && p.useTp === '000');
    expect(pin(TAX_CLS_STATUS_CATEGORY)?.codes).toEqual(CLASSIFY_STATUSES.filter((s) => s !== 'all'));
    expect(pin(TAX_CLS_SOURCE_CATEGORY)?.codes).toEqual(CLASSIFY_KINDS.filter((k) => k !== 'all'));
  });
});
