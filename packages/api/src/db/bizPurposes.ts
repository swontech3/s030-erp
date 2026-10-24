/**
 * 사업목적 카탈로그(`tb_s080_biz_purpose_catalog`) 저장소 — 목록 · 추가 · 고치기(30-3, 2026-10-11).
 *
 * ★ 표는 레거시가 만든 그대로 쓴다. 누가 무엇을 하는지는 041 의 RLS 가 가른다 — 읽기 = 운영사 전부 /
 *   회사는 사용 중인 줄만, 넣기 · 고치기 = 운영사만, 지우기 = 없음(erp_app 에 DELETE 권한 없음).
 * ★ 문구 = `biz_name`. 업종코드 · KSIC · 인허가 칸은 **읽지도 쓰지도 않는다**(지금은 문구만).
 *   새 줄의 `biz_code` 는 **NULL** 이다 — 빈 문자열('')은 UNIQUE 에 걸려 한 줄만 들어간다(041).
 *   `license_type` · `review_status` 는 표 기본값(UNKNOWN · manual_pending)에 맡긴다.
 * ★ 같은 문구(앞뒤 공백 무시) 거절은 여기서 센다 — DB 유일 인덱스는 없다(041 머리말).
 *   사용 끈 줄도 센다 — 같은 문구가 꺼져 있으면 새로 만들지 말고 다시 켜야 한다.
 */
import { randomUUID } from 'node:crypto';
import type { BizPurposeItem, BizPurposeListFilter } from '@swonbiz/shared/domain/biz-purpose';
import type { ScopedClient } from './withCompanyScope.ts';

/** 목록 한 번에 돌려주는 최대 줄 수. 넘으면 `truncated` — 검색어로 좁힌다. */
export const BIZ_PURPOSE_LIST_LIMIT = 500;

type Row = { id: string; biz_name: string; active: boolean };
const toItem = (r: Row): BizPurposeItem => ({ id: r.id, text: r.biz_name, active: r.active });

/** ILIKE 의 `%` · `_` · `\` 를 글자로 읽게 한다. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 목록 — 문구 순. 사용 끈 줄은 `includeInactive` 일 때만(회사 세션은 RLS 가 한 번 더 가린다). */
export async function listBizPurposes(
  client: ScopedClient,
  filter: BizPurposeListFilter,
): Promise<{ items: BizPurposeItem[]; truncated: boolean }> {
  const { rows } = (await client.query(
    `SELECT id, biz_name, active
       FROM public.tb_s080_biz_purpose_catalog
      WHERE ($1::boolean OR active)
        AND ($2::text IS NULL OR biz_name ILIKE '%' || $2 || '%')
      ORDER BY biz_name, id
      LIMIT $3`,
    [filter.includeInactive, filter.q === null ? null : likeEscape(filter.q), BIZ_PURPOSE_LIST_LIMIT + 1],
  )) as { rows: Row[] };
  return { items: rows.slice(0, BIZ_PURPOSE_LIST_LIMIT).map(toItem), truncated: rows.length > BIZ_PURPOSE_LIST_LIMIT };
}

/** 같은 문구(앞뒤 공백 무시)가 있는 줄 — 사용 끈 줄 포함. `exceptId` 는 고치는 그 줄. */
export async function findSameText(
  client: ScopedClient,
  text: string,
  exceptId: string | null = null,
): Promise<BizPurposeItem | null> {
  const { rows } = (await client.query(
    `SELECT id, biz_name, active
       FROM public.tb_s080_biz_purpose_catalog
      WHERE btrim(biz_name) = btrim($1) AND ($2::text IS NULL OR id <> $2)
      LIMIT 1`,
    [text, exceptId],
  )) as { rows: Row[] };
  return rows[0] ? toItem(rows[0]) : null;
}

export async function insertBizPurpose(client: ScopedClient, text: string): Promise<BizPurposeItem> {
  const { rows } = (await client.query(
    `INSERT INTO public.tb_s080_biz_purpose_catalog (id, biz_code, biz_name, active, updated_at)
     VALUES ($1, NULL, $2, true, now())
     RETURNING id, biz_name, active`,
    [randomUUID(), text],
  )) as { rows: Row[] };
  return toItem(rows[0]!);
}

/** 문구 · 사용 여부 고치기. 없는(또는 보이지 않는) 줄이면 null. */
export async function updateBizPurpose(
  client: ScopedClient,
  id: string,
  patch: { text?: string; active?: boolean },
): Promise<BizPurposeItem | null> {
  const { rows } = (await client.query(
    `UPDATE public.tb_s080_biz_purpose_catalog
        SET biz_name = COALESCE($2, biz_name),
            active = COALESCE($3, active),
            updated_at = now()
      WHERE id = $1
      RETURNING id, biz_name, active`,
    [id, patch.text ?? null, patch.active ?? null],
  )) as { rows: Row[] };
  return rows[0] ? toItem(rows[0]) : null;
}
