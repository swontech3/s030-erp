/**
 * 법인변경 목록(s040200010) — 필터 읽기 · 선택지 거르기 · 회사 표시. 순수 함수.
 *
 * 레거시 `S-WonERP/src/lib/corp-change-list.ts` 의 자리다(2026-10-10, 법인변경 2단계).
 * 규칙은 1단계(`corp-change.ts`)를 그대로 쓴다.
 *
 * =============================================================================
 * ★★★ 선택지는 코드표에서 읽되, **앱이 아는 코드만** 남긴다 — 기준은 한 곳
 * =============================================================================
 * 코드표(`LAW_CNG_TP`)에는 `CEO_CHG`(대표이사변경)가 활성으로 있고, `LAW_PROG_ST` 에는
 * `S`(준비중)가 있다. 앱은 둘 다 모른다 — 고르면 거절되거나 아무것도 안 나온다.
 * 그래서 `CORP_CHANGE_TYPES` · `CORP_CHANGE_STATUSES` 에 있는 것만 남긴다. 화면에 코드를
 * 따로 적지 않는다 — 두 벌이면 한쪽만 고쳐진다.
 *
 * ★ 이름은 코드표의 것을 쓴다. 코드 관리에서 이름을 고치면 바로 반영된다.
 * ★ 상태 필터는 **P · E · C 셋**이다. 취소(X)는 「취소 포함」 체크로만 보인다 —
 *   그래도 목록의 상태 열에는 「취소」가 코드표 이름으로 나와야 하므로 이름은 다섯 개를 준다
 *   (결정 2026-10-10).
 *
 * =============================================================================
 * ★★ 입주 여부는 저장하지 않는다 — 읽을 때 판정한다
 * =============================================================================
 * `tb_s080_companies.link_s020_org_id` 에 그 단체가 있으면 입주사다(퇴실해도 입주사).
 * 회사명 · 대표자도 **읽기만** 한다 — 입주사는 ERP 입주사 정보, 비입주사는 법무 회사 정보
 * (`tb_s080_legal_orgs`)에서. 법인변경 건에 복사해 두지 않는다(037 이 그 칸을 지웠다).
 *
 * ★ 비입주사 회사명은 삐용에 있는데 삐용 조회가 아직 실연동이 아니다. 그래서 목록은
 *   회사명 → 단체코드 → 「단체 {ID}」 순으로 보여 준다(`corpChangeCompanyLabel`).
 *   이름 검색 필터는 두지 않는다 — 이름을 DB 가 다 갖고 있지 않아서다.
 */
import { parseDay } from './day.ts';
import {
  CORP_CHANGE_STATUSES,
  CORP_CHANGE_TYPES,
  isCorpChangeType,
  type CorpChangeStatus,
  type CorpChangeType,
} from './corp-change.ts';

/** 상태 필터에 나오는 것 — 취소(X)를 뺀 넷. 취소는 「취소 포함」 체크가 따로 맡는다. */
export const CORP_CHANGE_FILTER_STATUSES: readonly CorpChangeStatus[] = CORP_CHANGE_STATUSES.filter((s) => s !== 'X');

/** 입주 여부 필터. 비우면 전체. */
export const TENANCY_FILTERS = ['tenant', 'nontenant'] as const;
export type TenancyFilter = (typeof TENANCY_FILTERS)[number];

/** 목록 조건 — 비운 칸은 거르지 않는다. */
export interface CorpChangeListFilter {
  /** 작업일자(등록일) 시작 `YYYY-MM-DD` — 그날 0시부터. */
  from: string | null;
  /** 작업일자 끝 `YYYY-MM-DD` — 그날 끝까지. */
  to: string | null;
  changeType: CorpChangeType | null;
  /** P · E · C 중 하나. */
  status: CorpChangeStatus | null;
  tenancy: TenancyFilter | null;
  /** 취소(X) 건도 보인다. **기본은 뺀다.** */
  includeCancelled: boolean;
}

export type ListQueryResult = { ok: true; filter: CorpChangeListFilter } | { ok: false; message: string };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * 주소의 조건을 읽는다. 틀린 값은 **거절한다** — 모르는 조건을 조용히 빼면 「걸렀다」고
 * 믿은 사람이 전체를 본다.
 */
export function parseCorpChangeListQuery(query: Record<string, unknown>): ListQueryResult {
  const from = text(query.from);
  const to = text(query.to);
  const changeType = text(query.changeType);
  const status = text(query.status);
  const tenancy = text(query.tenancy);
  const cancelled = text(query.includeCancelled);

  if (from !== '' && parseDay(from) === null) return { ok: false, message: '시작일이 날짜(YYYY-MM-DD)가 아닙니다' };
  if (to !== '' && parseDay(to) === null) return { ok: false, message: '종료일이 날짜(YYYY-MM-DD)가 아닙니다' };
  if (from !== '' && to !== '' && from > to) return { ok: false, message: '시작일이 종료일보다 늦습니다' };
  if (changeType !== '' && !isCorpChangeType(changeType)) return { ok: false, message: '변경 구분이 올바르지 않습니다' };
  if (status !== '' && !(CORP_CHANGE_FILTER_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: '진행 상태가 올바르지 않습니다' };
  }
  if (tenancy !== '' && !(TENANCY_FILTERS as readonly string[]).includes(tenancy)) {
    return { ok: false, message: '입주 여부가 올바르지 않습니다' };
  }
  if (cancelled !== '' && cancelled !== '1' && cancelled !== '0') {
    return { ok: false, message: '취소 포함 값이 올바르지 않습니다' };
  }

  return {
    ok: true,
    filter: {
      from: from || null,
      to: to || null,
      changeType: (changeType || null) as CorpChangeType | null,
      status: (status || null) as CorpChangeStatus | null,
      tenancy: (tenancy || null) as TenancyFilter | null,
      includeCancelled: cancelled === '1',
    },
  };
}

/** 필터 → 주소 조건. 비운 칸은 싣지 않는다. 화면이 API 를 부를 때 쓴다. */
export function corpChangeListSearch(f: CorpChangeListFilter): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  if (f.changeType) qs.set('changeType', f.changeType);
  if (f.status) qs.set('status', f.status);
  if (f.tenancy) qs.set('tenancy', f.tenancy);
  if (f.includeCancelled) qs.set('includeCancelled', '1');
  return qs;
}

/** 코드 한 줄 — 코드표에서 읽은 것. */
export interface CodeOption {
  code: string;
  name: string;
}

export interface CorpChangeOptions {
  /** 변경 구분 선택지 — 앱이 아는 5종만. 순서는 코드표 순서. */
  changeTypes: CodeOption[];
  /** 상태 필터 선택지 — P · E · C. */
  statuses: CodeOption[];
  /** 상태 이름 — 취소(X)까지 다섯. 목록의 상태 열이 쓴다. */
  statusNames: Record<string, string>;
}

/**
 * 코드표에서 읽은 줄들(이미 코드표 순서) → 선택지. **앱이 모르는 코드는 버린다.**
 *
 * ★ 코드표에 줄이 없는 코드(누가 끈 경우)는 선택지에서 빠진다. 이름 사전에는 코드값을
 *   그대로 넣는다 — 상태 열이 비지 않게.
 */
export function pickCorpChangeOptions(
  typeRows: readonly CodeOption[],
  statusRows: readonly CodeOption[],
): CorpChangeOptions {
  const known = (list: readonly string[]) => (r: CodeOption) => list.includes(r.code);
  const statusNames: Record<string, string> = {};
  for (const s of CORP_CHANGE_STATUSES) statusNames[s] = s;
  for (const r of statusRows.filter(known(CORP_CHANGE_STATUSES))) statusNames[r.code] = r.name;
  return {
    changeTypes: typeRows.filter(known(CORP_CHANGE_TYPES)).map(({ code, name }) => ({ code, name })),
    statuses: statusRows.filter(known(CORP_CHANGE_FILTER_STATUSES)).map(({ code, name }) => ({ code, name })),
    statusNames,
  };
}

/** 목록 한 줄. */
export interface CorpChangeListItem {
  id: string;
  orgId: number;
  orgCode: string | null;
  /** 입주사면 ERP 입주사 회사명. 비입주사는 null(삐용 조회가 실연동이 아니다). */
  companyName: string | null;
  /** ERP 입주사인가 — 읽을 때 판정했다. */
  isTenant: boolean;
  changeType: string;
  status: string;
  /** 입주사는 ERP 입주사 정보, 비입주사는 법무 회사 정보에서. 없으면 null. */
  ceoName: string | null;
  /** 등록일 `YYYY-MM-DD`(DB 시간대 기준). */
  createdOn: string;
}

export interface CorpChangeListResponse extends CorpChangeOptions {
  items: CorpChangeListItem[];
}

/** 회사 열의 글자 — 회사명 → 단체코드 → 「단체 {ID}」(결정 2026-10-10). */
export function corpChangeCompanyLabel(item: Pick<CorpChangeListItem, 'companyName' | 'orgCode' | 'orgId'>): string {
  const name = item.companyName?.trim();
  if (name) return name;
  const code = item.orgCode?.trim();
  if (code) return code;
  return `단체 ${item.orgId}`;
}
