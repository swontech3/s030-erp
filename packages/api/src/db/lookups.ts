/**
 * 조회 전용 저장소 — 호실과 코드.
 *
 * ★★ **읽기만 한다.** 이 파일에 INSERT·UPDATE·DELETE 를 쓰지 않는다.
 *    호실 CRUD 는 페이즈 2(기준관리)다. 여기는 계약 폼이 셀렉트를 채우려고
 *    **보기만** 하는 자리이고, 페이즈 2 가 CRUD 를 만들 때 이 조회는 그대로 남는다.
 *
 * ★ `tb_s080_spaces` 와 코드 두 테이블에는 RLS 가 없다(`doc/LEGACY_DATA_SURVEY.md` §A-5).
 *   그래도 `withCompanyScope()` 안에서 돈다 — DB 접근 경로를 하나로 두기 위해서다.
 *   RLS 가 없다는 것은 **정책이 거르지 않는다**는 뜻이므로, 누가 볼 수 있는지는
 *   라우트가 역할로 막는다(운영사 전용).
 */
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

export interface SpaceRow {
  space_id: string;
  build_id: string;
  build_name: string | null;
  floor_id: string;
  floor_name: string | null;
  room_name: string | null;
  room_type: string;
  standard_fee: number | null;
  deposit: number | null;
  /** 「입주 가능 회사 수」 — 고를 수 있느냐를 정하는 수다(`domain/space-occupancy`). */
  max_companies: number;
}

/**
 * 호실 전체. 72실이라 필터도 페이징도 두지 않는다 — 전부 내려주고 화면이 거른다.
 *
 * ★★ `room_no` 를 **뽑지 않는다.** 12자리 16진 해시라 사람이 읽는 번호가 아니고
 *    (`doc/LEGACY_DATA_SURVEY.md` §A-3), 응답에 실으면 언젠가 누가 화면에 쓴다.
 *    사람이 보는 이름은 `room_name` 이다.
 *
 * ★ `is_active` 가 false 인 호실은 내려보내지 않는다. 지금은 72건 전부 true 라
 *   결과가 같지만, 폐쇄한 호실이 새 계약의 선택지로 뜨는 것은 규칙 위반이다.
 *
 * 정렬은 계약구분(`room_type`) → 이름이다. 화면이 계약구분으로 거르므로 같은 구분이
 * 붙어 있는 편이 읽기 쉽다.
 *
 * ★ 건물·층은 **이름까지** 가져온다. 식별자만 내려주면 계약 폼 섹션 2 헤더의
 *   건물·층 Select 에 cuid(`kpz4i184…`)가 뜬다 — 시안에 있는 요소를 그릴 수 없다.
 *   조회 범위가 늘어난 것이 아니라 같은 줄에 붙는 이름 두 칸이다. LEFT JOIN 인 이유는
 *   FK 가 걸려 있어 사라질 수 없지만, 이름이 NULL 인 건물·층은 있을 수 있어서다.
 */
export async function listSpaces(client: ScopedClient): Promise<SpaceRow[]> {
  const { rows } = await q<SpaceRow>(
    client,
    `SELECT s.space_id, s.build_id, b.name AS build_name, s.floor_id, f.name AS floor_name,
            s.room_name, s.room_type, s.standard_fee, s.deposit, s.max_companies
       FROM public.tb_s080_spaces s
       LEFT JOIN public.tb_s080_buildings b ON b.build_id = s.build_id
       LEFT JOIN public.tb_s080_floors    f ON f.floor_id = s.floor_id
      WHERE s.is_active = true
      ORDER BY s.room_type, s.room_name, s.space_id`,
  );
  return rows;
}

export interface CodeRow {
  category: string;
  code: string;
  name: string;
  sort_order: number;
}

export interface CodeSpec {
  category: string;
  /** 코드 카테고리(`tb_s080_code_categories.use_tp`). 공통은 `'000'`. */
  useTp: string;
}

/**
 * 코드 라인 — `(build_id, category, use_tp)` 로 묶인 **파티션 단위**로 읽는다.
 *
 * ★ `use_tp` 는 한 카테고리 안의 **독립 파티션**이다(`doc/CODE_MASTER_ANALYSIS.md` §B-1).
 *   `000` 이 공통이지만 `001` 이 `000` 을 물려받지 않는다 — 각 파티션이 완결된 목록이고,
 *   빼기도 한다(`PAY_ST 001` 은 `000` 의 「취소」가 없다). 그래서 **호출자가 어느
 *   파티션인지 말해야 한다.** 이름은 `tb_s080_code_categories` 에 있다(마이그레이션 013).
 *
 * ★ 예전에는 `DISTINCT ON (category, code)` 로 `use_tp` 를 버렸다. 그래서 `ROOM_TP` 의
 *   `ET`(기타)가 계약 폼에 새어 나왔다 — `001` 에만 있어 경쟁자가 없었기 때문이다
 *   (`doc/CODE_MASTER_ANALYSIS.md` §E-1). 정렬 타이가 있으면 어느 행이 이길지도 정해지지
 *   않았다(§E-2). 파티션을 지정하면 둘 다 생기지 않고, 정렬도 SQL 한 번으로 끝난다.
 *
 * ★ 건물이 하나뿐이라(`우리빌딩`) `build_id` 로 거르지 않는다. 건물이 늘면 거르는
 *   조건이 필요해진다 — 그때는 계약의 건물을 받아 여기로 넘긴다.
 */
export async function listCodes(client: ScopedClient, specs: readonly CodeSpec[]): Promise<CodeRow[]> {
  const { rows } = await q<CodeRow>(
    client,
    `SELECT l.category, l.code, l.name, l.sort_order
       FROM public.tb_s080_codes_line l
       JOIN unnest($1::text[], $2::text[]) AS w(category, use_tp)
         ON w.category = l.category AND w.use_tp = l.use_tp
      WHERE l.is_active = true
      ORDER BY l.category, l.sort_order, l.code`,
    [specs.map((s) => s.category), specs.map((s) => s.useTp)],
  );
  return rows;
}
