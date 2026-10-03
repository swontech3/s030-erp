/**
 * 코드 관리(s030100030) 저장소 — 머리 · 파티션 · 값 3층.
 *
 * =============================================================================
 * ★★ 3층이다. `use_tp` 는 **파티션**이고 상속이 아니다
 * =============================================================================
 *   tb_s080_code_masters      머리     (category, name)            ROOM_TP 「계약타입」
 *     └ tb_s080_code_categories 파티션 (category, use_tp, name)    ROOM_TP/000 「공통」
 *         └ tb_s080_codes_line  값     (category, use_tp, code)    R1 「1인실」
 *
 * `000` 이 공통이지만 `001` 이 `000` 을 물려받지 **않는다** — 각 파티션이 완결된 목록이고
 * 빼기도 한다(`PAY_ST/001` 은 `000` 의 「취소」가 없다). 그래서 `ROOM_TP/001` 은 `000` 의
 * 여섯 개를 **복제**하고 `ET 기타` 하나를 더 가진다.
 * 근거: `doc/CODE_MASTER_ANALYSIS.md` §B-1.
 *
 * =============================================================================
 * ★★★ 쓰고 있는 코드는 못 지운다 — 근거는 **선언표**다
 * =============================================================================
 * 업무 표에서 이 세 표로 오는 FK 가 **0건**이다(실측). DB 가 막아 주지 않으니
 * `domain/code-usage.ts` 의 `CODE_USAGE` 를 읽어 **지우기 전에 센다.** 그 표를 빠뜨리면
 * 쓰고 있는 코드가 지워진다 — 위험과 이유는 그 파일 머리말에 적어 두었다.
 *
 * ★ 파티션 삭제(값이 남음)·머리 삭제(파티션이 남음)는 **세지 않는다.** FK
 *   `ON DELETE RESTRICT` 가 DB 에서 막는다(마이그레이션 013). 다만 화면에 이유를 적어
 *   주려고 **먼저 세어** 409 문구를 만든다 — 23505 를 그대로 올리면 사람이 읽을 문구가 없다.
 *
 * ★ 이 세 표에는 RLS 가 없다(실측: `relrowsecurity = false` 셋 다). 그래도 다른 저장소와
 *   같이 `ScopedClient` 로 받는다 — 경로가 둘이 되지 않게 한다(`routes/facility.ts` 와 같은 이유).
 */
import { randomUUID } from 'node:crypto';
import type { ScopedClient } from './withCompanyScope.ts';
import {
  CODE_USAGE,
  isSafeIdentifier,
  usageRefsFor,
  type CodeUsageRef,
} from '@swonbiz/shared/domain/code-usage';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/**
 * 새 행의 PK.
 *
 * ★ 기존 행의 모양은 **섞여 있다** — 레거시 Prisma 가 만든 cuid(`cmq0qn94e001b…`)와
 *   마이그레이션이 만든 파생 키(`cl_1_EMAIL_DOMAIN_daum`)가 함께 있다(실측). 파생 키를
 *   흉내내면 `(category, code)` 가 같고 파티션만 다른 행에서 충돌한다 — `ROOM_TP` 의
 *   `R1` 은 `000`·`001` 둘 다 있다. 그래서 불투명 UUID 를 쓴다(센터 관리와 같다).
 */
const newId = (): string => randomUUID();

// =============================================================================
// 조회 — 화면이 한 번에 받는 3층
// =============================================================================

export interface MasterRow {
  code_id: string;
  build_id: string;
  category: string;
  name: string;
  description: string | null;
  is_system: boolean;
  partition_count: number;
  line_count: number;
}

export interface CategoryRow {
  code_category_id: string;
  build_id: string;
  category: string;
  use_tp: string;
  name: string;
  description: string | null;
  is_system: boolean;
  line_count: number;
}

export interface LineRow {
  line_id: string;
  build_id: string;
  category: string;
  use_tp: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
}

/**
 * 머리 전체 — 파티션 수·값 수를 함께 센다.
 *
 * ★ 값 수는 **머리 아래 전부**다(파티션 합). 트리에서 「계약타입 (13)」처럼 보여 준다.
 */
export async function listMasters(client: ScopedClient): Promise<MasterRow[]> {
  const { rows } = await q<MasterRow>(
    client,
    `SELECT m.code_id, m.build_id, m.category, m.name, m.description, m.is_system,
            (SELECT count(*)::int FROM public.tb_s080_code_categories cc
              WHERE cc.build_id = m.build_id AND cc.category = m.category) AS partition_count,
            (SELECT count(*)::int FROM public.tb_s080_codes_line l
              WHERE l.build_id = m.build_id AND l.category = m.category) AS line_count
       FROM public.tb_s080_code_masters m
      ORDER BY m.category`,
  );
  return rows;
}

/** 파티션 전체. ★ `000` 단독 머리의 파티션도 **숨기지 않고** 내려보낸다(결정 2026-10-03). */
export async function listCategories(client: ScopedClient): Promise<CategoryRow[]> {
  const { rows } = await q<CategoryRow>(
    client,
    `SELECT cc.code_category_id, cc.build_id, cc.category, cc.use_tp, cc.name, cc.description,
            cc.is_system,
            (SELECT count(*)::int FROM public.tb_s080_codes_line l
              WHERE l.build_id = cc.build_id AND l.category = cc.category AND l.use_tp = cc.use_tp)
              AS line_count
       FROM public.tb_s080_code_categories cc
      ORDER BY cc.category, cc.use_tp`,
  );
  return rows;
}

/**
 * 한 파티션의 값들.
 *
 * ★ `is_active = false` 도 내려보낸다 — 코드 관리는 **끈 코드를 다시 켜는 화면**이다.
 *   거르는 것은 소비 쪽(`db/lookups.ts` 의 `listCodes`)이 한다.
 */
export async function listLines(
  client: ScopedClient,
  category: string,
  useTp: string,
): Promise<LineRow[]> {
  const { rows } = await q<LineRow>(
    client,
    `SELECT line_id, build_id, category, use_tp, code, name, description,
            sort_order, is_active, is_system
       FROM public.tb_s080_codes_line
      WHERE category = $1 AND use_tp = $2
      ORDER BY sort_order, code`,
    [category, useTp],
  );
  return rows;
}

export async function findMaster(
  client: ScopedClient,
  buildId: string,
  category: string,
): Promise<MasterRow | null> {
  const { rows } = await q<MasterRow>(
    client,
    `SELECT code_id, build_id, category, name, description, is_system,
            0 AS partition_count, 0 AS line_count
       FROM public.tb_s080_code_masters
      WHERE build_id = $1 AND category = $2`,
    [buildId, category],
  );
  return rows[0] ?? null;
}

export async function findCategory(
  client: ScopedClient,
  buildId: string,
  category: string,
  useTp: string,
): Promise<CategoryRow | null> {
  const { rows } = await q<CategoryRow>(
    client,
    `SELECT code_category_id, build_id, category, use_tp, name, description, is_system,
            0 AS line_count
       FROM public.tb_s080_code_categories
      WHERE build_id = $1 AND category = $2 AND use_tp = $3`,
    [buildId, category, useTp],
  );
  return rows[0] ?? null;
}

export async function findLine(client: ScopedClient, lineId: string): Promise<LineRow | null> {
  const { rows } = await q<LineRow>(
    client,
    `SELECT line_id, build_id, category, use_tp, code, name, description,
            sort_order, is_active, is_system
       FROM public.tb_s080_codes_line
      WHERE line_id = $1`,
    [lineId],
  );
  return rows[0] ?? null;
}

// =============================================================================
// ★★★ 쓰임 — 「못 지운다」의 근거
// =============================================================================

/** 어느 업무 표에서 몇 건 쓰고 있는가. */
export interface UsageHit {
  /** 사람이 읽는 이름 — 409 문구에 들어간다. */
  label: string;
  table: string;
  column: string;
  count: number;
}

/**
 * 이 코드값을 업무 자료가 몇 건 쓰고 있는가 — **선언표에 적힌 자리만** 센다.
 *
 * ★★ 표에 없는 자리는 세지 않는다. 즉 **표를 빠뜨리면 「안 쓴다」고 답한다.** 그 위험을
 *    `domain/code-usage.ts` 머리말에 적어 두었고, `scripts/verify-codes.js` 가 표의
 *    표·컬럼이 실제로 존재하는지 대조한다.
 *
 * ★ 표·컬럼은 식별자라 파라미터로 묶을 수 없다. 문장에 박기 전에 `isSafeIdentifier` 로
 *   한 번 거른다 — 값은 이 저장소의 상수뿐이지만 그 사실에 기대지 않는다.
 *
 * ★ 0건인 자리는 결과에서 뺀다. 화면이 「계약 0건에서 사용 중」 같은 문구를 만들지 않게.
 */
export async function countCodeUsage(
  client: ScopedClient,
  category: string,
  useTp: string,
  code: string,
): Promise<UsageHit[]> {
  const refs = usageRefsFor(category, useTp);
  const hits: UsageHit[] = [];

  for (const ref of refs) {
    if (!isSafeIdentifier(ref.table) || !isSafeIdentifier(ref.column)) {
      throw new Error(
        `CODE_USAGE 의 표·컬럼 이름이 식별자가 아니다: ${ref.table}.${ref.column} — domain/code-usage.ts 를 확인할 것`,
      );
    }
    const { rows } = await q<{ n: number }>(
      client,
      `SELECT count(*)::int AS n FROM public.${ref.table} WHERE ${ref.column} = $1`,
      [code],
    );
    const n = rows[0]?.n ?? 0;
    if (n > 0) hits.push({ label: ref.label, table: ref.table, column: ref.column, count: n });
  }
  return hits;
}

/**
 * 한 파티션의 **모든** 코드값 쓰임을 한 번에 센다 — 화면이 표를 그릴 때 쓴다.
 *
 * ★ 코드마다 왕복하면 값 7개짜리 파티션에서 질의가 7×컬럼수가 된다. 자리마다 한 번씩
 *   `GROUP BY` 로 긁어 와 코드별로 접는다.
 *
 * 돌려주는 것: `code` → 그 코드를 쓰는 자리들.
 */
export async function countUsageByCode(
  client: ScopedClient,
  category: string,
  useTp: string,
): Promise<Map<string, UsageHit[]>> {
  const out = new Map<string, UsageHit[]>();

  for (const ref of usageRefsFor(category, useTp)) {
    if (!isSafeIdentifier(ref.table) || !isSafeIdentifier(ref.column)) {
      throw new Error(
        `CODE_USAGE 의 표·컬럼 이름이 식별자가 아니다: ${ref.table}.${ref.column} — domain/code-usage.ts 를 확인할 것`,
      );
    }
    const { rows } = await q<{ v: string; n: number }>(
      client,
      `SELECT ${ref.column} AS v, count(*)::int AS n
         FROM public.${ref.table}
        WHERE ${ref.column} IS NOT NULL
        GROUP BY ${ref.column}`,
      [],
    );
    for (const r of rows) {
      if (r.n <= 0) continue;
      const list = out.get(r.v) ?? [];
      list.push({ label: ref.label, table: ref.table, column: ref.column, count: r.n });
      out.set(r.v, list);
    }
  }
  return out;
}

/** 선언표 전체가 가리키는 표·컬럼이 실제로 있는가 — `verify-codes` 와 기동 점검이 쓴다. */
export async function checkUsageTableRefs(
  client: ScopedClient,
): Promise<{ ref: CodeUsageRef; exists: boolean }[]> {
  const out: { ref: CodeUsageRef; exists: boolean }[] = [];
  for (const ref of CODE_USAGE) {
    const { rows } = await q<{ n: number }>(
      client,
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [ref.table, ref.column],
    );
    out.push({ ref, exists: (rows[0]?.n ?? 0) > 0 });
  }
  return out;
}

// =============================================================================
// 머리 (code_masters)
// =============================================================================

export interface MasterPatch {
  name: string;
  description: string | null;
}

/**
 * 머리를 만든다. ★ 파티션 `000`(공통)을 **함께** 만든다.
 *
 * 안 만들면 값을 넣을 자리가 없다 — 라인의 FK 가 파티션을 가리키므로 파티션 없는 머리는
 * 코드를 하나도 담을 수 없다(`doc/CODE_MASTER_ANALYSIS.md` §F-5 「`000` 은 기본 파티션으로
 * 고정, 카테고리 생성 시 자동 생성」).
 */
export async function insertMaster(
  client: ScopedClient,
  input: { buildId: string; category: string; patch: MasterPatch; actor: string },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_code_masters
       (code_id, build_id, category, name, description, is_system, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP, $6, $6)`,
    [newId(), input.buildId, input.category, input.patch.name, input.patch.description, input.actor],
  );
  await q(
    client,
    `INSERT INTO public.tb_s080_code_categories
       (code_category_id, build_id, category, use_tp, name, description, is_system,
        updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, '000', '공통', $4, false, CURRENT_TIMESTAMP, $5, $5)`,
    [
      newId(),
      input.buildId,
      input.category,
      '단일 파티션. 이 카테고리는 use_tp 로 갈리지 않는다',
      input.actor,
    ],
  );
}

export async function updateMaster(
  client: ScopedClient,
  input: { buildId: string; category: string; patch: MasterPatch; actor: string },
): Promise<number> {
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_code_masters
        SET name = $3, description = $4, updated_at = CURRENT_TIMESTAMP, updated_by = $5
      WHERE build_id = $1 AND category = $2`,
    [input.buildId, input.category, input.patch.name, input.patch.description, input.actor],
  );
  return rowCount ?? 0;
}

export async function deleteMaster(
  client: ScopedClient,
  buildId: string,
  category: string,
): Promise<number> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_s080_code_masters WHERE build_id = $1 AND category = $2`,
    [buildId, category],
  );
  return rowCount ?? 0;
}

/** 머리 아래 파티션 수 — 삭제를 막는 이유 문구에 쓴다. */
export async function countMasterPartitions(
  client: ScopedClient,
  buildId: string,
  category: string,
): Promise<{ partitions: number; lines: number }> {
  const { rows } = await q<{ partitions: number; lines: number }>(
    client,
    `SELECT (SELECT count(*)::int FROM public.tb_s080_code_categories
              WHERE build_id = $1 AND category = $2) AS partitions,
            (SELECT count(*)::int FROM public.tb_s080_codes_line
              WHERE build_id = $1 AND category = $2) AS lines`,
    [buildId, category],
  );
  return rows[0] ?? { partitions: 0, lines: 0 };
}

// =============================================================================
// 파티션 (code_categories)
// =============================================================================

export interface CategoryPatch {
  name: string;
  description: string | null;
}

export async function insertCategory(
  client: ScopedClient,
  input: {
    buildId: string;
    category: string;
    useTp: string;
    patch: CategoryPatch;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_code_categories
       (code_category_id, build_id, category, use_tp, name, description, is_system,
        updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, false, CURRENT_TIMESTAMP, $7, $7)`,
    [
      newId(),
      input.buildId,
      input.category,
      input.useTp,
      input.patch.name,
      input.patch.description,
      input.actor,
    ],
  );
}

export async function updateCategory(
  client: ScopedClient,
  input: {
    buildId: string;
    category: string;
    useTp: string;
    patch: CategoryPatch;
    actor: string;
  },
): Promise<number> {
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_code_categories
        SET name = $4, description = $5, updated_at = CURRENT_TIMESTAMP, updated_by = $6
      WHERE build_id = $1 AND category = $2 AND use_tp = $3`,
    [
      input.buildId,
      input.category,
      input.useTp,
      input.patch.name,
      input.patch.description,
      input.actor,
    ],
  );
  return rowCount ?? 0;
}

export async function deleteCategory(
  client: ScopedClient,
  buildId: string,
  category: string,
  useTp: string,
): Promise<number> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_s080_code_categories
      WHERE build_id = $1 AND category = $2 AND use_tp = $3`,
    [buildId, category, useTp],
  );
  return rowCount ?? 0;
}

/** 파티션 아래 값 수 — 삭제를 막는 이유 문구에 쓴다. */
export async function countCategoryLines(
  client: ScopedClient,
  buildId: string,
  category: string,
  useTp: string,
): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM public.tb_s080_codes_line
      WHERE build_id = $1 AND category = $2 AND use_tp = $3`,
    [buildId, category, useTp],
  );
  return rows[0]?.n ?? 0;
}

// =============================================================================
// 값 (codes_line)
// =============================================================================

export interface LinePatch {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function insertLine(
  client: ScopedClient,
  input: {
    buildId: string;
    category: string;
    useTp: string;
    patch: LinePatch;
    actor: string;
  },
): Promise<string> {
  const lineId = newId();
  await q(
    client,
    `INSERT INTO public.tb_s080_codes_line
       (line_id, build_id, category, use_tp, code, name, description, sort_order,
        is_active, is_system, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, CURRENT_TIMESTAMP, $10, $10)`,
    [
      lineId,
      input.buildId,
      input.category,
      input.useTp,
      input.patch.code,
      input.patch.name,
      input.patch.description,
      input.patch.sortOrder,
      input.patch.isActive,
      input.actor,
    ],
  );
  return lineId;
}

/**
 * 값을 고친다.
 *
 * ★ `code` 도 고칠 수 있는 칸이다 — 다만 **쓰이는 중이면 라우트가 먼저 막는다**.
 *   저장소는 막지 않는다. 막는 자리를 라우트 하나로 모아야 「세지 않고 쓰는 경로」가
 *   생기지 않는다(`routes/facility.ts` 와 같은 구조).
 */
export async function updateLine(
  client: ScopedClient,
  input: { lineId: string; patch: LinePatch; actor: string },
): Promise<number> {
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_codes_line
        SET code = $2, name = $3, description = $4, sort_order = $5, is_active = $6,
            updated_at = CURRENT_TIMESTAMP, updated_by = $7
      WHERE line_id = $1`,
    [
      input.lineId,
      input.patch.code,
      input.patch.name,
      input.patch.description,
      input.patch.sortOrder,
      input.patch.isActive,
      input.actor,
    ],
  );
  return rowCount ?? 0;
}

export async function deleteLine(client: ScopedClient, lineId: string): Promise<number> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_s080_codes_line WHERE line_id = $1`,
    [lineId],
  );
  return rowCount ?? 0;
}

/** 같은 파티션에 같은 `code` 가 이미 있는가 — 유니크 인덱스가 막기 전에 문구를 만든다. */
export async function findLineByCode(
  client: ScopedClient,
  buildId: string,
  category: string,
  useTp: string,
  code: string,
): Promise<LineRow | null> {
  const { rows } = await q<LineRow>(
    client,
    `SELECT line_id, build_id, category, use_tp, code, name, description,
            sort_order, is_active, is_system
       FROM public.tb_s080_codes_line
      WHERE build_id = $1 AND category = $2 AND use_tp = $3 AND code = $4`,
    [buildId, category, useTp, code],
  );
  return rows[0] ?? null;
}

/** 새 값의 기본 순서 — 그 파티션의 마지막 + 1. 레거시는 99 고정이라 여러 개가 같아졌다. */
export async function nextSortOrder(
  client: ScopedClient,
  buildId: string,
  category: string,
  useTp: string,
): Promise<number> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT COALESCE(max(sort_order), 0)::int + 1 AS n
       FROM public.tb_s080_codes_line
      WHERE build_id = $1 AND category = $2 AND use_tp = $3`,
    [buildId, category, useTp],
  );
  return rows[0]?.n ?? 1;
}
