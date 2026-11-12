/**
 * 세무(S05) 거래 분류(s050300010) — 1-3 (2026-10-27).
 *
 * ★ 결정(대표 2026-10-27):
 *   - 매입 계산서도 분류한다. 항목이 빈 매입 계산서 = 「확인할 줄」. 매출은 항목이 없다(코드 TAX_INV_DIR 의 「매출」 이름으로 보인다)
 *   - 거래처 기억은 저장하지 않는다 — 그 거래처의 가장 최근 확정 항목을 **골라 두기만**. 확정은 사업주가
 *   - 항목은 코드 TAX_ITEM_OUT, 파티션 = 사업자 유형(아래 바꿈표). 이름은 두 파티션 모두에서 찾는다
 *   - 파일로 들어오면 「전체」 보기 + 그 파일 줄 전부(기간 거르기 없음)
 *   - [고치기]는 화면 안에서만 — 다시 확정하면 덮는다
 * ★ 1-4(2026-10-30): 카드 사용 내역 · 현금 경비 줄도 항목을 붙인다. 미지정 건 = 그 달 (매입 계산서 + 카드 줄 + 현금 매입 줄) 중
 *   항목이 빈 줄. 현금 매출 줄은 매출 계산서처럼 항목이 없다. 표가 셋이라 줄은 (kind, id) 로 가리킨다.
 * ★ 2026-11-08 대표 수정 ⑤: 탭 · 칩 · 기간 직접 지정을 없애고 검색조건(년월 · 구분 · 출처)으로 합쳤다 — 한 목록에서 [확정] · [수정].
 *   [고치기]는 [수정]으로 이름만 바뀌었다(동작 그대로). 카드 줄에 「내용」(222 `note`)을 적어 [확정] 때 함께 저장한다.
 */
import { TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES, parseMonth, type TaxCodeName, type TaxFieldError } from './tax-uploads.ts';

export const TAX_ITEM_OUT_CATEGORY = 'TAX_ITEM_OUT';

/**
 * ★ 고정 — 사업자 유형(TAX_BIZ_TP 코드값) → 출금 항목 파티션(207). 코드 관리 규약대로 숫자 3자.
 *   파티션 줄을 지우거나 번호를 바꾸면 그 유형의 항목 목록이 빈다.
 */
export const TAX_ITEM_PARTITION_BY_BIZ: Readonly<Record<string, string>> = { C: '001', I: '002' };
/** 이름을 찾을 때 보는 파티션 전부 — 사업자 유형을 바꾼 회사의 옛 항목도 이름이 보이게. */
export const TAX_ITEM_PARTITIONS: readonly string[] = Object.values(TAX_ITEM_PARTITION_BY_BIZ);

/** 사업자 유형의 출금 항목 파티션 — 세무 설정이 없거나 모르는 유형이면 null(화면은 막고 안내). */
export function itemPartitionOf(bizType: string | null): string | null {
  return bizType !== null && Object.hasOwn(TAX_ITEM_PARTITION_BY_BIZ, bizType) ? TAX_ITEM_PARTITION_BY_BIZ[bizType]! : null;
}

/* ── 주소 ────────────────────────────────────────────────────────────────── */

/**
 * ★ 2026-11-08 대표 수정 ⑤ — 탭(미지정 건 · 지정 건 · 이번 달 자료 전체) · 칩 · 기간 직접 지정을 없애고 검색조건 셋으로 합쳤다:
 *   년월(세무 공통) · 구분(코드 TAX_CLS_STATUS) · 출처(코드 TAX_CLS_SOURCE). 「전체」는 선택 상자 첫 줄이고 코드가 아니다.
 * ★ 고정 코드 — 서버가 코드값으로 거른다(`filterClassifyRows` · `listClassifyOp`). 이름 · 켜짐은 코드 관리에서 바꿀 수 있다.
 */
export const TAX_CLS_STATUS_CATEGORY = 'TAX_CLS_STATUS';
export const TAX_CLS_SOURCE_CATEGORY = 'TAX_CLS_SOURCE';
/** 구분 — 미지정(항목이 빈 매입 줄) · 지정(항목이 있는 매입 줄). 매출 줄은 「전체」에서만 보인다. */
export const TAX_CLS_LEFT = 'L';
export const TAX_CLS_DONE = 'D';
export const CLASSIFY_STATUSES = ['all', TAX_CLS_LEFT, TAX_CLS_DONE] as const;
export type ClassifyStatus = (typeof CLASSIFY_STATUSES)[number];

/**
 * 출처 — 결과서 S05-05 순서. 매입 · 매출은 계산서 구분 코드값(P · S), 카드 · 현금은 자료 종류 코드값(1-4).
 * 개인카드(PCARD) · 은행(BANK)은 코드 「사용 안 함」(기능이 생기면 켠다) — 주소로 와도 빈 목록. 옛 칩 「삐용 경비」(PPIYONG)는 없앴다.
 */
export const CLASSIFY_KINDS = ['all', TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES, 'CARD', 'CASH', 'PCARD', 'BANK'] as const;
export type ClassifyKind = (typeof CLASSIFY_KINDS)[number];

export interface ClassifyQuery {
  month: string;
  /** 구분 — 전체 · 미지정 L · 지정 D. */
  status: ClassifyStatus;
  /** 출처. */
  kind: ClassifyKind;
  /**
   * 기간(`YYYY-MM-DD`) — 둘 다 있거나 둘 다 없다. 없으면 작업할 달.
   * ★ 항목 지정 화면은 싣지 않는다(2026-11-08 기간 직접 지정 없앰). 세무사 전달 서류가 신고 기간으로 쓴다.
   */
  from: string | null;
  to: string | null;
  /** 자료 올리기 [보기]로 들어온 파일 — 있으면 기간 없음(그 파일 줄 전부). */
  fileId: string | null;
  /**
   * 계정과목(2026-11-08 추가) — 출금 항목 코드값(TAX_ITEM_OUT) 하나. 고르면 그 계정과목으로 확정된 줄만, null 이면 전체.
   * 모르는 코드값이면 빈 목록(400 을 내지 않는다 — 선택지는 그 회사 파티션의 켜진 항목).
   */
  item?: string | null;
}

export type ClassifyQueryParsed = { ok: true; value: ClassifyQuery } | { ok: false; errors: TaxFieldError[] };

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** `YYYY-MM-DD` 이고 달력에 있는 날. */
function isDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

export function parseClassifyQuery(raw: Record<string, unknown>): ClassifyQueryParsed {
  const errors: TaxFieldError[] = [];
  const month = parseMonth(raw.month);
  if (!month) errors.push({ field: 'month', message: '작업할 달은 YYYY-MM 입니다' });

  // ★ 옛 주소의 view(자료 올리기 [보기] 의 `view=all`)는 보지 않는다(2026-11-08 탭 없앰)
  const statusRaw = text(raw.status) ?? 'all';
  if (!(CLASSIFY_STATUSES as readonly string[]).includes(statusRaw)) errors.push({ field: 'status', message: '구분이 올바르지 않습니다' });
  const kindRaw = text(raw.kind) ?? 'all';
  if (!(CLASSIFY_KINDS as readonly string[]).includes(kindRaw)) errors.push({ field: 'kind', message: '출처가 올바르지 않습니다' });

  const fileId = text(raw.file);
  const item = text(raw.item);
  let from = text(raw.from);
  let to = text(raw.to);
  if (fileId) {
    from = null;
    to = null;
  } else if ((from === null) !== (to === null)) {
    errors.push({ field: 'period', message: '기간은 시작과 끝을 함께 고르세요' });
  } else if (from !== null && to !== null) {
    if (!isDate(from) || !isDate(to)) errors.push({ field: 'period', message: '기간 날짜가 올바르지 않습니다' });
    else if (from > to) errors.push({ field: 'period', message: '기간의 시작이 끝보다 늦습니다' });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { month: month!, status: statusRaw as ClassifyStatus, kind: kindRaw as ClassifyKind, from, to, fileId, item },
  };
}

const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** 줄을 고르는 작성일 범위 [첫날, 끝 다음 날) — 파일로 들어왔으면 null(그 파일 줄 전부). */
export function classifyDateRange(q: ClassifyQuery): [string, string] | null {
  if (q.fileId) return null;
  if (q.from && q.to) return [q.from, nextDay(q.to)];
  const [y, m] = q.month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${q.month}-01`, `${next}-01`];
}

/** 엑셀 파일 이름 — 항목지정_YYYY-MM.xlsx, 기간 직접 지정이면 항목지정_YYYY-MM~YYYY-MM.xlsx(결정). */
export function classifyExportFileName(q: ClassifyQuery): string {
  if (!q.fileId && q.from && q.to) return `항목지정_${q.from.slice(0, 7)}~${q.to.slice(0, 7)}.xlsx`;
  return `항목지정_${q.month}.xlsx`;
}

/** 주소 글자 — 화면 목록 · 엑셀이 같은 거르기를 쓴다. 처음 값(구분 · 출처 all)은 싣지 않고, 파일이면 기간을 싣지 않는다. */
export function classifySearch(q: ClassifyQuery): string {
  const p = new URLSearchParams({ month: q.month });
  if (q.status !== 'all') p.set('status', q.status);
  if (q.kind !== 'all') p.set('kind', q.kind);
  if (q.item) p.set('item', q.item);
  if (q.fileId) p.set('file', q.fileId);
  else if (q.from && q.to) {
    p.set('from', q.from);
    p.set('to', q.to);
  }
  return `?${p.toString()}`;
}

/* ── 본문 ────────────────────────────────────────────────────────────────── */

/** 항목을 붙이는 자료 — 계산서(매입) · 카드 사용 내역 · 현금 경비(매입). 표가 셋이라 줄은 (kind, id) 로 가리킨다(1-4). */
export const CLASSIFY_ROW_KINDS = ['INVOICE', 'CARD', 'CASH'] as const;
export type ClassifyRowKind = (typeof CLASSIFY_ROW_KINDS)[number];

/** 화면이 줄을 가리키는 열쇠 — 세 표의 id 가 겹쳐도 갈린다. */
export const classifyRowKey = (r: { kind: string; id: string }): string => `${r.kind}:${r.id}`;

/** 카드 줄 「내용」(사용 내용) 최대 글자 수 — 222 `tb_s050_card_txns.note varchar(100)`. */
export const CARD_NOTE_MAX = 100;

export interface ClassifyConfirmRow {
  kind: ClassifyRowKind;
  id: string;
  itemCode: string;
  /**
   * 카드 줄 「내용」(222) — 카드 줄에만 있고 [확정] 때 항목과 함께 저장한다(빈 글은 null). 계산서 · 현금 줄에는 없다.
   * 화면이 보내는 값은 걷기 전 글자일 수 있다 — 서버가 `parseClassifyConfirm` 으로 걷는다.
   */
  note?: string | null;
}
export type ClassifyConfirmParsed = { ok: true; value: ClassifyConfirmRow[] } | { ok: false; errors: TaxFieldError[] };

/**
 * [확정] · [선택한 줄에 붙이기] `{ rows: [{ kind, id, itemCode, note? }] }` — 붙이기는 모든 줄이 같은 itemCode.
 * `itemCodes` = 그 회사 사업자 유형 파티션의 켜진 항목. 비었으면 세무 설정이 없는 것.
 * ★ note(내용)는 카드 줄만 — 카드 줄은 늘 note 를 싣는다(없으면 null 로 덮는다), 다른 줄에 글이 오면 note 오류.
 */
export function parseClassifyConfirm(raw: unknown, itemCodes: readonly string[]): ClassifyConfirmParsed {
  const rows = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).rows : undefined;
  const shapeOk =
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every((r) => {
      if (typeof r !== 'object' || r === null) return false;
      const o = r as Record<string, unknown>;
      const noteOk = o.note === undefined || o.note === null || typeof o.note === 'string';
      return (CLASSIFY_ROW_KINDS as readonly unknown[]).includes(o.kind) && text(o.id) && text(o.itemCode) && noteOk;
    });
  if (!shapeOk) return { ok: false, errors: [{ field: 'rows', message: '항목을 붙일 줄을 고르세요' }] };
  const src = rows as Record<string, unknown>[];
  if (src.some((r) => r.kind !== 'CARD' && text(r.note) !== null)) {
    return { ok: false, errors: [{ field: 'note', message: '내용은 카드 줄에만 적습니다' }] };
  }
  if (src.some((r) => (text(r.note) ?? '').length > CARD_NOTE_MAX)) {
    return { ok: false, errors: [{ field: 'note', message: `내용은 ${CARD_NOTE_MAX}자까지 적습니다` }] };
  }
  const value: ClassifyConfirmRow[] = src.map((r) => {
    const row: ClassifyConfirmRow = { kind: r.kind as ClassifyRowKind, id: text(r.id)!, itemCode: text(r.itemCode)! };
    if (row.kind === 'CARD') row.note = text(r.note);
    return row;
  });
  if (new Set(value.map(classifyRowKey)).size !== value.length) {
    return { ok: false, errors: [{ field: 'rows', message: '같은 줄이 두 번 들어 있습니다' }] };
  }
  if (itemCodes.length === 0) {
    return { ok: false, errors: [{ field: 'itemCode', message: '세무 설정에서 사업자 유형을 먼저 고르세요' }] };
  }
  if (!value.every((r) => itemCodes.includes(r.itemCode))) {
    return { ok: false, errors: [{ field: 'itemCode', message: '없는 항목입니다' }] };
  }
  return { ok: true, value };
}

/* ── 화면 — 버튼 줄(결과서 S05-05, 2026-11-08 대표 수정 ⑤) ─────────────────── */

export interface ClassifyPlanRow {
  kind: ClassifyRowKind;
  id: string;
  /** P 매입 · S 매출 — 매출 줄은 항목이 없어 버튼이 세지 않는다. */
  direction: string;
  itemCode: string | null;
  suggestedItemCode: string | null;
  /** 카드 줄의 저장된 내용 — 다른 줄은 null. */
  note: string | null;
}

/** 확정 본문 한 줄 — 카드 줄이면 내용(고쳐 쓴 글 > 저장된 내용)을 함께 싣는다. */
const confirmRowOf = (r: ClassifyPlanRow, itemCode: string, notes: Readonly<Record<string, string>>): ClassifyConfirmRow => {
  const key = classifyRowKey(r);
  return r.kind === 'CARD'
    ? { kind: r.kind, id: r.id, itemCode, note: Object.hasOwn(notes, key) ? notes[key]! : r.note }
    : { kind: r.kind, id: r.id, itemCode };
};

/** 항목을 고를 수 있는 줄 — 아직 확정 안 된 매입 줄 · [수정] 중인 줄. */
const isOpen = (r: ClassifyPlanRow, editing: ReadonlySet<string>) =>
  r.direction === TAX_INV_DIR_PURCHASE && (r.itemCode === null || editing.has(classifyRowKey(r)));

/**
 * 고른 줄로 할 일. `selected` · `picks` · `editing` · `notes` · `reopen` 은 줄 열쇠(`classifyRowKey`)로 가리킨다.
 *   confirm — [확정 (N)]: 아직 확정 안 된 줄(또는 [수정] 중인 줄) 중 항목이 있는 줄. 항목 = 고른 값 > (수정 중이면 지금 항목 · 아니면 골라 둔 값)
 *   skipped — 항목이 없어 건너뛸 줄 수(토스트 「· N줄은 항목이 없어 건너뜀」)
 *   reopen  — [수정 (N)]: 확정했고 아직 수정 중이 아닌 줄(화면 안에서만 선택 칸으로 — 옛 [고치기])
 * ★ 매출 줄은 어디에도 세지 않는다 — 구분 「전체」에서는 매출 줄도 목록에 있다(2026-11-08).
 */
export function classifyPlan(
  rows: readonly ClassifyPlanRow[],
  selected: readonly string[],
  picks: Readonly<Record<string, string>>,
  editing: ReadonlySet<string>,
  notes: Readonly<Record<string, string>> = {},
): { confirm: ClassifyConfirmRow[]; skipped: number; reopen: string[] } {
  const confirm: ClassifyConfirmRow[] = [];
  const reopen: string[] = [];
  let skipped = 0;
  for (const r of rows) {
    const key = classifyRowKey(r);
    if (!selected.includes(key) || r.direction !== TAX_INV_DIR_PURCHASE) continue;
    if (!isOpen(r, editing)) {
      reopen.push(key);
      continue;
    }
    const code = picks[key] || (editing.has(key) ? r.itemCode : r.suggestedItemCode);
    if (code) confirm.push(confirmRowOf(r, code, notes));
    else skipped++;
  }
  return { confirm, skipped, reopen };
}

/** [선택한 줄에 붙이기] — 고른 줄 중 항목을 고를 수 있는 매입 줄(미지정 · 수정 중)에 같은 항목. 카드 줄은 내용을 함께. */
export function classifyBulk(
  rows: readonly ClassifyPlanRow[],
  selected: readonly string[],
  itemCode: string,
  editing: ReadonlySet<string>,
  notes: Readonly<Record<string, string>>,
): ClassifyConfirmRow[] {
  return rows.filter((r) => selected.includes(classifyRowKey(r)) && isOpen(r, editing)).map((r) => confirmRowOf(r, itemCode, notes));
}

/**
 * 검색조건 「구분」 — 미지정 L = 항목이 빈 매입 줄, 지정 D = 항목이 있는 매입 줄, 전체 = 매출 줄까지 모두.
 * 「계정과목」(2026-11-08) — 고르면 그 코드값으로 확정된 줄만(구분과 함께 걸린다).
 * 서버(목록 · 엑셀)가 이 함수 하나로 거른다.
 */
export function filterClassifyRows<T extends { direction: string; itemCode: string | null }>(
  rows: readonly T[],
  status: ClassifyStatus,
  item: string | null = null,
): T[] {
  const byItem = item ? rows.filter((r) => r.itemCode === item) : rows;
  if (status === TAX_CLS_LEFT) return byItem.filter((r) => r.direction === TAX_INV_DIR_PURCHASE && r.itemCode === null);
  if (status === TAX_CLS_DONE) return byItem.filter((r) => r.direction === TAX_INV_DIR_PURCHASE && r.itemCode !== null);
  return [...byItem];
}

/* ── 목록 · 엑셀 칸 글자(2026-11-08) — 화면과 엑셀이 같은 함수 ─────────────────── */

type LabelRow = Pick<TaxClassifyRow, 'kind' | 'direction' | 'vendorName' | 'description' | 'note' | 'cardAlias' | 'cardLast4'>;

/** 출처 — 계산서는 「매입 계산서」, 카드는 별칭(없으면 「카드 사용 내역 · 끝 4821」), 현금은 자료 종류 이름. ★ 카드는 끝 4자리만. */
export function classifySourceLabel(r: LabelRow, names: { invDirs: readonly TaxCodeName[]; kinds: readonly TaxCodeName[] }): string {
  const of = (list: readonly TaxCodeName[], code: string) => list.find((c) => c.code === code)?.name ?? code;
  if (r.kind === 'CARD') return r.cardAlias ?? `${of(names.kinds, 'CARD')} · 끝 ${r.cardLast4}`;
  if (r.kind === 'CASH') return of(names.kinds, 'CASH');
  return `${of(names.invDirs, r.direction)} 계산서`;
}

/** 사용처(옛 「내용」 칸) — 거래처 · 가맹점 이름(현금은 거래처 글). 비었으면 null(화면 「—」). */
export const classifyPlaceOf = (r: LabelRow): string | null => (r.vendorName.trim() === '' ? null : r.vendorName);

/** 내용 — 카드는 적은 내용(222) · 현금은 품명 · 계산서는 null(화면 「—」). */
export const classifyContentOf = (r: LabelRow): string | null =>
  r.kind === 'CARD' ? r.note : r.kind === 'CASH' ? r.description : null;

/** 이름 뒤 「을 / 를」 — 붙이기 토스트(결과서 C-1 받침). 한글이 아닌 글자로 끝나면 「(을)를」. */
export function withEulReul(name: string): string {
  const code = name.charCodeAt(name.length - 1) - 0xac00;
  if (Number.isNaN(code) || code < 0 || code > 11171) return `${name}(을)를`;
  return code % 28 === 0 ? `${name}를` : `${name}을`;
}

/* ── 응답 모양 ───────────────────────────────────────────────────────────── */

export interface TaxItemOption extends TaxCodeName {
  /** 풀이 — 선택 칸에 「이름 — 풀이」. 없으면 null. */
  description: string | null;
}

export interface TaxClassifyRow {
  /** 자료 종류 — 계산서 · 카드 사용 내역 · 현금 경비(1-4). 줄은 (kind, id) 로 가리킨다. */
  kind: ClassifyRowKind;
  id: string;
  /** P 매입 · S 매출 — 카드는 늘 P(취소 줄도), 현금은 매입액 P · 매출액 S. */
  direction: string;
  /** 계산서 작성일 · 카드 사용일 · 현금 날짜. */
  writeDate: string;
  /** 승인번호 — 계산서만. */
  approvalNo: string | null;
  /** 거래처 — 계산서 · 카드(가맹점 번호가 있을 때). 현금은 null(거래처는 글만). */
  vendorId: string | null;
  /** 거래처 표의 이름(고친 이름이 모든 달에 보인다) · 거래처 없는 카드 줄은 파일의 가맹점명 · 현금은 거래처 글(없으면 빈 글자). */
  vendorName: string;
  /** 현금 품명 — 계산서 · 카드는 null. */
  description: string | null;
  /** 카드 사용 내용(222, 사업주가 적는 짧은 글) — 카드만, 비었으면 null. */
  note: string | null;
  /** 사업자번호(숫자 10자리) — 계산서 · 카드(있을 때). */
  bizNo: string | null;
  /** 공급가액 · 세액 — 계산서 · 카드. 현금은 null. */
  supplyAmount: number | null;
  taxAmount: number | null;
  /** 합계(현금은 금액). 카드 취소 줄은 음수. */
  totalAmount: number;
  /** 계산서 종류 — 계산서만. */
  invClass: string | null;
  /** 카드 끝 4자리 · 세무 설정의 카드 별칭(끝 4자리로 찾음, 없으면 null) — 카드만. */
  cardLast4: string | null;
  cardAlias: string | null;
  /** 카드 공제 여부(TAX_CARD_DEDUCT) — 카드만, 모르면 null. */
  vatDeduct: string | null;
  /** 현금 지급방법(TAX_PAY_METHOD) · 증빙(TAX_PROOF) — 현금만. */
  payMethod: string | null;
  proof: string | null;
  fileId: string;
  /** 확정한 항목 — 비었으면 「분류 필요」(매입만). 매출은 늘 null. */
  itemCode: string | null;
  /** 지난번 항목 — 계산서 · 카드는 그 거래처, 현금은 같은 거래처 글의 가장 최근 확정 항목. 골라 두기만(확정 아님). */
  suggestedItemCode: string | null;
}

export interface TaxClassifyCounts {
  /** 확인할 줄 — 그 달 항목이 빈 매입(계산서 · 카드 · 현금 매입) 줄(서버 한 곳 `countClassify` 에서 센다). */
  left: number;
  /** 그 달 매입(계산서 · 카드 · 현금 매입) 줄 전부. */
  total: number;
  /** 출처별 줄 수 — 기간 · 파일 거르기 뒤, 출처 · 구분 거르기 전(세무사 전달 검증이 맞춰 본다. 화면은 쓰지 않는다 — 2026-11-08 칩 없앰). */
  kinds: Record<ClassifyKind, number>;
}

export interface TaxClassifyResponse {
  query: ClassifyQuery;
  /** 사업자 유형 — 세무 설정이 없으면 null(항목 선택 · 확정을 막고 안내). */
  bizType: string | null;
  /** 사업자 유형 이름(작업할 달 줄 오른쪽 안내) — 설정이 없으면 null. */
  bizTypeName: string | null;
  counts: TaxClassifyCounts;
  /** 검색조건(년월 · 구분 · 출처 · 파일) 결과. 날짜 최신순. */
  rows: TaxClassifyRow[];
  /** 파일로 들어왔으면 그 파일(띠). */
  file: { id: string; fileName: string } | null;
  codes: {
    /** 그 회사 파티션의 켜진 항목 — 선택 칸. 사업자 유형이 없으면 빈 목록. */
    items: TaxItemOption[];
    /** 이름 찾기 — 두 파티션 모두. */
    itemNames: TaxCodeName[];
    invDirs: TaxCodeName[];
    /** 자료 종류(TAX_KIND) 이름 — 출처 칸(판단 16, 1-4). */
    kinds: TaxCodeName[];
    /** 검색조건 「구분」 선택지(TAX_CLS_STATUS, 켜진 것만 · 코드 순서) — 「전체」는 화면이 첫 줄로 더한다. */
    statuses: TaxCodeName[];
    /** 검색조건 「출처」 선택지(TAX_CLS_SOURCE, 켜진 것만 — 개인카드 · 은행은 사용 안 함이라 빠진다). */
    sources: TaxCodeName[];
  };
}
