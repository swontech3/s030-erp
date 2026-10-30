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

export type ClassifyView = 'left' | 'all';
/**
 * 「전체」 보기의 자료 종류 칩 — 결과서 S05-05 순서. 매입 · 매출은 계산서 구분 코드값(P · S), 카드 · 현금은 자료 종류 코드값(1-4).
 * 삐용 경비 · 은행은 아직 자료가 없어 늘 0건(뒤 단계).
 */
export const CLASSIFY_KINDS = ['all', TAX_INV_DIR_PURCHASE, TAX_INV_DIR_SALES, 'CARD', 'CASH', 'PPIYONG', 'BANK'] as const;
export type ClassifyKind = (typeof CLASSIFY_KINDS)[number];

export interface ClassifyQuery {
  month: string;
  view: ClassifyView;
  kind: ClassifyKind;
  /** 기간 직접 지정(`YYYY-MM-DD`) — 둘 다 있거나 둘 다 없다. 없으면 작업할 달. */
  from: string | null;
  to: string | null;
  /** 자료 올리기 [보기]로 들어온 파일 — 있으면 「전체」 보기 · 기간 없음. */
  fileId: string | null;
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

  const viewRaw = text(raw.view) ?? 'left';
  if (viewRaw !== 'left' && viewRaw !== 'all') errors.push({ field: 'view', message: '보기가 올바르지 않습니다' });
  const kindRaw = text(raw.kind) ?? 'all';
  if (!(CLASSIFY_KINDS as readonly string[]).includes(kindRaw)) errors.push({ field: 'kind', message: '자료 종류가 올바르지 않습니다' });

  const fileId = text(raw.file);
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
    value: { month: month!, view: fileId ? 'all' : (viewRaw as ClassifyView), kind: kindRaw as ClassifyKind, from, to, fileId },
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

/** 주소 글자 — 화면 목록 · 엑셀이 같은 거르기를 쓴다. 처음 값(보기 left · 종류 all)은 싣지 않고, 파일이면 기간을 싣지 않는다. */
export function classifySearch(q: ClassifyQuery): string {
  const p = new URLSearchParams({ month: q.month });
  if (q.view !== 'left') p.set('view', q.view);
  if (q.kind !== 'all') p.set('kind', q.kind);
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

export interface ClassifyConfirmRow {
  kind: ClassifyRowKind;
  id: string;
  itemCode: string;
}
export type ClassifyConfirmParsed = { ok: true; value: ClassifyConfirmRow[] } | { ok: false; errors: TaxFieldError[] };

/**
 * [확정] · [선택한 줄에 붙이기] `{ rows: [{ kind, id, itemCode }] }` — 붙이기는 모든 줄이 같은 itemCode.
 * `itemCodes` = 그 회사 사업자 유형 파티션의 켜진 항목. 비었으면 세무 설정이 없는 것.
 */
export function parseClassifyConfirm(raw: unknown, itemCodes: readonly string[]): ClassifyConfirmParsed {
  const rows = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).rows : undefined;
  const shapeOk =
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows.every((r) => {
      if (typeof r !== 'object' || r === null) return false;
      const o = r as Record<string, unknown>;
      return (CLASSIFY_ROW_KINDS as readonly unknown[]).includes(o.kind) && text(o.id) && text(o.itemCode);
    });
  if (!shapeOk) return { ok: false, errors: [{ field: 'rows', message: '항목을 붙일 줄을 고르세요' }] };
  const value = (rows as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as ClassifyRowKind,
    id: text(r.id)!,
    itemCode: text(r.itemCode)!,
  }));
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

/* ── 화면 — 목록 위 버튼(결과서 S05-05 5번) ───────────────────────────────── */

export interface ClassifyPlanRow {
  kind: ClassifyRowKind;
  id: string;
  itemCode: string | null;
  suggestedItemCode: string | null;
}

/**
 * 고른 줄로 할 일. `selected` · `picks` · `editing` · `reopen` 은 줄 열쇠(`classifyRowKey`)로 가리킨다.
 *   confirm — [확정 (N)]: 아직 확정 안 된 줄(또는 [고치기] 중인 줄) 중 항목이 있는 줄. 항목 = 고른 값 > (고치기 중이면 지금 항목 · 아니면 골라 둔 값)
 *   skipped — 항목이 없어 건너뛸 줄 수(토스트 「· N줄은 항목이 없어 건너뜀」)
 *   reopen  — [고치기 (N)]: 확정했고 아직 고치기 중이 아닌 줄(화면 안에서만 선택 칸으로)
 */
export function classifyPlan(
  rows: readonly ClassifyPlanRow[],
  selected: readonly string[],
  picks: Readonly<Record<string, string>>,
  editing: ReadonlySet<string>,
): { confirm: ClassifyConfirmRow[]; skipped: number; reopen: string[] } {
  const confirm: ClassifyConfirmRow[] = [];
  const reopen: string[] = [];
  let skipped = 0;
  for (const r of rows) {
    const key = classifyRowKey(r);
    if (!selected.includes(key)) continue;
    const open = r.itemCode === null || editing.has(key);
    if (!open) {
      reopen.push(key);
      continue;
    }
    const code = picks[key] || (editing.has(key) ? r.itemCode : r.suggestedItemCode);
    if (code) confirm.push({ kind: r.kind, id: r.id, itemCode: code });
    else skipped++;
  }
  return { confirm, skipped, reopen };
}

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
  /** 「전체」 보기 자료 종류 칩 — 기간 · 파일 거르기 뒤, 종류 거르기 전. */
  kinds: Record<ClassifyKind, number>;
}

export interface TaxClassifyResponse {
  query: ClassifyQuery;
  /** 사업자 유형 — 세무 설정이 없으면 null(항목 선택 · 확정을 막고 안내). */
  bizType: string | null;
  /** 사업자 유형 이름(작업할 달 줄 오른쪽 안내) — 설정이 없으면 null. */
  bizTypeName: string | null;
  counts: TaxClassifyCounts;
  /** 「확인할 줄만」 = 그 달 매입 계산서 / 「전체」 = 거르기 결과. 날짜 최신순. */
  rows: TaxClassifyRow[];
  /** 파일로 들어왔으면 그 파일(띠). */
  file: { id: string; fileName: string } | null;
  codes: {
    /** 그 회사 파티션의 켜진 항목 — 선택 칸. 사업자 유형이 없으면 빈 목록. */
    items: TaxItemOption[];
    /** 이름 찾기 — 두 파티션 모두. */
    itemNames: TaxCodeName[];
    invDirs: TaxCodeName[];
    /** 자료 종류(TAX_KIND) 이름 — 카드 · 현금 칩 · 출처 칸(판단 16, 1-4). */
    kinds: TaxCodeName[];
  };
}
