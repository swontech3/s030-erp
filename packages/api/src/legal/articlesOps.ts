/**
 * 법무 정관 최종본 처리(설계 `doc/법무_정관_최종본_설계.md` §8, 1단계 2026-11-08) — 법인변경 처리(`corpChangeOps.ts`) ·
 * 출력(`corpChangePrint.ts`)이 부른다. 규칙은 shared `legal-articles.ts` 에 있다.
 *
 * ★ 1단계는 우리 시스템으로 설립한 회사만 — 최종본이 없으면 그 단체의 **완료된 법인설립 건**(가장 최근)의 자료로 만든다:
 *   설립 정관 양식(회사 형태에 맞는 「정관」 · 「정관(유한회사)」) + 설립 출력값(`buildIncorpCasePrintValues`).
 *   만들기는 첫 정관 변경 건의 작성완료(P→E) 때 — 확인 화면 없이 바로 확정(FINAL · 개정 번호 1).
 *   그 전(서류작성중)의 미리 채움은 같은 함수로 **메모리에서만** 만든다(쓰지 않는다).
 * ★ 주민번호는 다루지 않는다 — 설립 출력값의 주민번호 칸은 빈칸으로 만들고, 정관 말미(서명란)는 버린다.
 * ★ 단체 번호는 RLS 를 통과한 건의 것만 넣는다.
 */
import type { ErpSession } from '@swonbiz/shared';
import { pickDocFormSetting } from '@swonbiz/shared/domain/corp-change-print';
import type { CorpChangeSubmitSnapshot } from '@swonbiz/shared/domain/corp-change-transition';
import { incorpTaxSettingOf } from '@swonbiz/shared/domain/doc-form-setting';
import { migrateDefinition } from '@swonbiz/shared/domain/form-template';
import { INCORP_METHOD_CATEGORY, INCORP_METHOD_USE_TP, incorpMethodOf } from '@swonbiz/shared/domain/incorporation';
import { buildIncorpCasePrintValues, readIncorporationSnapshot } from '@swonbiz/shared/domain/incorporation-print';
import { incorpArticlesFormName } from '@swonbiz/shared/domain/legal-articles-file';
import {
  ARTICLES_RULE_CATEGORY,
  ARTICLES_RULE_USE_TP,
  articleItemsFromForm,
  parseArticlesRules,
  type ArticleChangeContext,
  type ArticleItem,
  type ArticlesRules,
} from '@swonbiz/shared/domain/legal-articles';
import type { ScopedClient } from '../db/withCompanyScope.ts';
import { listCodes } from '../db/lookups.ts';
import { listChangeTypeRuleRows } from '../db/corpChanges.ts';
import { listMarkedFormTemplates } from '../db/formTemplates.ts';
import { listIncorporationSettings } from '../db/docFormSettings.ts';
import { readIncorporationSnapshotRaw } from '../db/incorporations.ts';
import { completedIncorporationIdOf } from '../db/legalArticlesFile.ts';
import { getArticlesHead, insertFinalArticles, listArticleItems } from '../db/legalArticles.ts';

/** 정관이 바뀌는 구분(공통 코드 `LAW_CNG_AR`, §1-3). */
export async function readArticlesRules(client: ScopedClient): Promise<ArticlesRules> {
  return parseArticlesRules(await listChangeTypeRuleRows(client, ARTICLES_RULE_CATEGORY, ARTICLES_RULE_USE_TP));
}

/** 그 단체의 완료된 설립 건 → 조항(메모리). 설립 건 · 스냅샷 · 정관 양식이 없으면 null. */
export async function articlesFromIncorporation(
  client: ScopedClient,
  orgId: number,
): Promise<{ items: ArticleItem[]; companyType: string; incorporationId: string } | null> {
  const incorporationId = await completedIncorporationIdOf(client, orgId);
  if (!incorporationId) return null;
  const snapshot = readIncorporationSnapshot(await readIncorporationSnapshotRaw(client, incorporationId));
  if (!snapshot) return null;

  // ★ 차례로 읽는다 — 한 트랜잭션의 클라이언트 하나
  const formName = incorpArticlesFormName(snapshot.entityType);
  let definition = null;
  for (const r of await listMarkedFormTemplates(client)) {
    if (r.name !== formName) continue;
    try {
      const def = migrateDefinition(r.definition);
      if (def.legal?.domain === 'incorporation') definition = def;
    } catch {
      // 정의를 읽지 못하는 양식은 건너뛴다(출력과 같다)
    }
  }
  if (!definition) return null;

  const settings = await listIncorporationSettings(client);
  const method = incorpMethodOf(snapshot.entityType);
  const codes = await listCodes(client, [{ category: INCORP_METHOD_CATEGORY, useTp: INCORP_METHOD_USE_TP }]);
  const values = buildIncorpCasePrintValues({
    snapshot,
    // ★ 주민번호는 넣지 않는다 — 정관 말미(서명란)는 어차피 버린다
    persons: snapshot.persons.map((p) => ({ ...p, rrn: null })),
    setting: pickDocFormSetting(settings, method, snapshot.entityType),
    taxSetting: incorpTaxSettingOf(settings, method),
    methodName: codes.find((c) => c.code === method)?.name ?? null,
    inputs: {},
  });
  const items = articleItemsFromForm(definition, values);
  return items.length > 0 ? { items, companyType: snapshot.entityType, incorporationId } : null;
}

/**
 * 정관 최종본 — 있으면 그것(개정 번호와), 없으면 설립 건으로 만들 모양(개정 번호 null, 쓰지 않는다).
 * 둘 다 없으면 null(다른 곳 설립 회사 — 1단계 밖).
 */
export async function articlesBase(
  client: ScopedClient,
  orgId: number,
): Promise<{ revision: number | null; items: ArticleItem[] } | null> {
  const head = await getArticlesHead(client, orgId);
  if (head) return head.state === 'FINAL' ? { revision: head.revision, items: await listArticleItems(client, orgId) } : null;
  const built = await articlesFromIncorporation(client, orgId);
  return built ? { revision: null, items: built.items } : null;
}

/**
 * 첫 정관 변경 건의 작성완료(P→E) — 최종본이 없으면 설립 건으로 만들어 확정한다(§8 결정 「확인 화면 없이」).
 * 돌려주는 것은 확정된 최종본(개정 번호 · 조항). 만들 수 없으면 null.
 */
export async function ensureFinalArticles(
  client: ScopedClient,
  session: ErpSession,
  orgId: number,
): Promise<{ revision: number; items: ArticleItem[] } | null> {
  const head = await getArticlesHead(client, orgId);
  if (!head) {
    const built = await articlesFromIncorporation(client, orgId);
    if (!built) return null;
    await insertFinalArticles(client, {
      orgId,
      companyType: built.companyType,
      origin: 'INCORP',
      originRef: built.incorporationId,
      actor: String(session.s020MemberId),
      items: built.items,
    });
  }
  const now = await getArticlesHead(client, orgId);
  if (!now || now.state !== 'FINAL') return null;
  return { revision: now.revision, items: await listArticleItems(client, orgId) };
}

/** 미리 채움 · 작성완료가 쓰는 건 값 — 작성완료 스냅샷과 같은 회사값(등기상 상호 · 회사유형 · 본점). */
export function articleContext(args: {
  changeType: string;
  payload: Record<string, unknown>;
  company: { legalName: string | null; memberType: string | null; headAddress: string | null };
  namePosition: string | null;
}): ArticleChangeContext {
  return {
    changeType: args.changeType,
    payload: args.payload,
    company: { name: args.company.legalName, memberType: args.company.memberType, headAddress: args.company.headAddress },
    namePosition: args.namePosition,
  };
}

/** 작성완료 스냅샷 → 건 값(출력 · 완료 반영). */
export function articleContextOfSnapshot(snapshot: CorpChangeSubmitSnapshot, namePosition: string | null): ArticleChangeContext {
  return articleContext({
    changeType: snapshot.changeType,
    payload: snapshot.payload,
    company: { legalName: snapshot.company.name, memberType: snapshot.company.memberType, headAddress: snapshot.company.head.address },
    namePosition,
  });
}
