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
            s.room_name, s.room_type, s.standard_fee, s.deposit
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

/**
 * 코드 라인 — `(build_id, category)` 로 묶인 건물별 코드다(회사별이 아니다).
 *
 * ★ **같은 코드가 여러 행으로 온다.** `use_tp`(000/001/002)가 같은 코드를 쓰임새별로
 *   나눠 두었는데 **그 의미가 어디에도 적혀 있지 않다**(`doc/LEGACY_DATA_SURVEY.md` §B-1).
 *   예: `ROOM_TP` 는 코드 7개가 13행이다. 뜻을 모르는 칸으로 거를 수 없으므로
 *   **코드값 단위로 하나만** 남긴다(`DISTINCT ON`). 셀렉트에 같은 항목이 두 번 뜨는
 *   것보다 낫고, 화면이 저장하는 것은 코드값 하나다.
 *
 * ★ 건물이 하나뿐이라(`우리빌딩`) `build_id` 로 거르지 않는다. 건물이 늘면 거르는
 *   조건이 필요해진다 — 그때는 계약의 건물을 받아 여기로 넘긴다.
 */
export async function listCodes(client: ScopedClient, categories: readonly string[]): Promise<CodeRow[]> {
  const { rows } = await q<CodeRow>(
    client,
    `SELECT DISTINCT ON (category, code) category, code, name, sort_order
       FROM public.tb_s080_codes_line
      WHERE category = ANY($1::text[]) AND is_active = true
      ORDER BY category, code, sort_order`,
    [categories as string[]],
  );
  // DISTINCT ON 이 요구하는 정렬(category, code)과 화면이 원하는 정렬(sort_order)이
  // 달라 여기서 다시 세운다. SQL 한 번으로는 둘을 같이 만족시킬 수 없다.
  return rows.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.sort_order - b.sort_order || a.code.localeCompare(b.code),
  );
}
