/**
 * 법무 정관 최종본(051, 설계 `doc/법무_정관_최종본_설계.md` §2 · §8) — DB 만 만진다. 판정은 `legal/articlesOps.ts`.
 *
 * ★ RLS(051 erp_org_scope) — 운영사 전부 · 회사 세션은 자기 단체 줄만. 단체 번호는 RLS 를 통과한 건의 것만 넣는다.
 * ★ 조항은 통째로 바꿔 쓴다(지우고 차례로 넣기) — 같은 트랜잭션 안에서 머리 줄을 잠근 뒤에만.
 */
import type { ArticleItem, ArticleRole, ArticleSection, ArticleItemKind } from '@swonbiz/shared/domain/legal-articles';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

export interface ArticlesHead {
  orgId: number;
  state: 'DRAFT' | 'FINAL';
  revision: number;
  origin: string;
}

/** 최종본 머리 — 없으면 null. `forUpdate` 면 잠근다(완료 반영). */
export async function getArticlesHead(client: ScopedClient, orgId: number, opts: { forUpdate?: boolean } = {}): Promise<ArticlesHead | null> {
  const { rows } = await q<{ org_id: number; state: 'DRAFT' | 'FINAL'; revision: number; origin: string }>(
    client,
    `SELECT org_id, state, revision, origin FROM public.tb_s080_legal_articles WHERE org_id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [orgId],
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, state: r.state, revision: r.revision, origin: r.origin } : null;
}

/** 조항 — seq 순서. */
export async function listArticleItems(client: ScopedClient, orgId: number): Promise<ArticleItem[]> {
  const { rows } = await q<{
    kind: ArticleItemKind;
    article_no: string | null;
    title: string | null;
    body: string;
    role: ArticleRole | null;
    section: ArticleSection;
    change_id: string | null;
  }>(
    client,
    `SELECT kind, article_no, title, body, role, section, change_id
       FROM public.tb_s080_legal_article_items WHERE org_id = $1 ORDER BY seq`,
    [orgId],
  );
  return rows.map((r) => ({
    kind: r.kind,
    articleNo: r.article_no,
    title: r.title,
    body: r.body,
    role: r.role,
    section: r.section,
    changeId: r.change_id,
  }));
}

async function writeItems(client: ScopedClient, orgId: number, items: readonly ArticleItem[]): Promise<void> {
  await q(client, `DELETE FROM public.tb_s080_legal_article_items WHERE org_id = $1`, [orgId]);
  for (const [i, it] of items.entries()) {
    await q(
      client,
      `INSERT INTO public.tb_s080_legal_article_items (org_id, seq, kind, article_no, title, body, role, section, change_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orgId, i + 1, it.kind, it.articleNo, it.title, it.body, it.role, it.section, it.changeId],
    );
  }
}

/**
 * 확정된 최종본을 처음 넣는다(1단계 — 설립 건에서 만듦, 확인 화면 없이 FINAL · 개정 번호 1).
 * 이미 있으면(다른 요청이 먼저 만듦) 아무것도 쓰지 않고 false.
 */
export async function insertFinalArticles(
  client: ScopedClient,
  args: { orgId: number; companyType: string | null; origin: 'INCORP'; originRef: string; actor: string; items: readonly ArticleItem[] },
): Promise<boolean> {
  const { rowCount } = await q(
    client,
    `INSERT INTO public.tb_s080_legal_articles
       (org_id, company_type, origin, origin_ref, state, revision, confirmed_at, confirmed_by, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, 'FINAL', 1, now(), $5, now(), $5)
     ON CONFLICT (org_id) DO NOTHING`,
    [args.orgId, args.companyType, args.origin, args.originRef, args.actor],
  );
  if ((rowCount ?? 0) === 0) return false;
  await writeItems(client, args.orgId, args.items);
  return true;
}

/** 건 완료 반영 — 조항을 바꿔 쓰고 개정 번호 +1 · 마지막 건. 머리는 부르는 쪽이 잠갔다. */
export async function replaceArticles(
  client: ScopedClient,
  args: { orgId: number; items: readonly ArticleItem[]; changeId: string; actor: string },
): Promise<void> {
  await writeItems(client, args.orgId, args.items);
  await q(
    client,
    `UPDATE public.tb_s080_legal_articles
        SET revision = revision + 1, last_change_id = $2, updated_at = now(), updated_by = $3
      WHERE org_id = $1`,
    [args.orgId, args.changeId, args.actor],
  );
}

/** 이 건이 최종본에 반영됐는가 — 그 건의 개정 부칙 줄이 있으면. */
export async function isChangeApplied(client: ScopedClient, orgId: number, changeId: string): Promise<boolean> {
  const { rows } = await q<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM public.tb_s080_legal_article_items WHERE org_id = $1 AND change_id = $2`,
    [orgId, changeId],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** 같은 단체의 다른 작성완료(E) 건의 스냅샷 — 같은 조항을 바꾸는 건 찾기(§8-5). */
export async function listOtherWrittenSnapshots(
  client: ScopedClient,
  orgId: number,
  exceptId: string,
): Promise<{ id: string; snapshot: unknown }[]> {
  const { rows } = await q<{ id: string; submit_snapshot: unknown }>(
    client,
    `SELECT id, submit_snapshot FROM public.tb_s080_corp_changes WHERE org_id = $1 AND status = 'E' AND id <> $2 ORDER BY id`,
    [orgId, exceptId],
  );
  return rows.map((r) => ({ id: r.id, snapshot: r.submit_snapshot }));
}
