/**
 * 「사업목적 고르기」 팝업의 「추천」 탭 저장소 — **읽기만** 한다(2026-10-22).
 *
 * 읽는 표:
 *   · 업종 사전 047(`tb_s080_biz_code` · `_ksic`) — 사용 중인 줄
 *   · 바꿔 부르는 말 — 공통 코드 `BIZ_ALIAS` / `000` 의 사용 중인 값(코드값 = 업종코드, 이름 = 말들).
 *     소비용 `listCodes`(`db/lookups.ts`)처럼 건물을 가리지 않는다
 *   · 인허가 기준표 049 — **「검토됨」 · 사용 중인 규칙만**. 근거 조문은 048 에서 읽는다
 *   · 카탈로그 030(`tb_s080_biz_purpose_catalog`) — 업종코드 · 문구만, 사용 중인 줄만
 * ★ 047 · 048 · 049 는 RLS 읽기 정책(운영사 · 회사)이 있다 — `withCompanyScope` 안에서 부른다.
 */
import {
  BIZ_ALIAS_CATEGORY,
  BIZ_ALIAS_USE_TP,
  articleFirstLine,
  articleLabel,
  type BizAliasRow,
  type BizDictEntry,
  type BizRecommendLicense,
} from '@swonbiz/shared/domain/biz-purpose-recommend';
import type { ScopedClient } from './withCompanyScope.ts';

type DictRow = { biz_code: string; biz_type: string; item_name: string; ksic: { code: string; name: string }[] };

const toEntry = (r: DictRow): BizDictEntry => ({
  bizCode: r.biz_code,
  bizType: r.biz_type,
  itemName: r.item_name,
  ksic: r.ksic,
});

const DICT_SQL = `
  SELECT d.biz_code, d.biz_type, d.item_name,
         COALESCE(json_agg(json_build_object('code', k.ksic_code, 'name', k.ksic_name) ORDER BY k.ksic_code)
                  FILTER (WHERE k.ksic_code IS NOT NULL), '[]'::json) AS ksic
    FROM public.tb_s080_biz_code d
    LEFT JOIN public.tb_s080_biz_code_ksic k ON k.biz_code = d.biz_code AND k.active
   WHERE d.active`;

/** 업종 사전 전부(사용 중) — 검색은 shared `rankBizCandidates` 가 한다. 1,614줄(2026 귀속). */
export async function loadBizDict(client: ScopedClient): Promise<BizDictEntry[]> {
  const { rows } = (await client.query(`${DICT_SQL} GROUP BY d.biz_code ORDER BY d.biz_code`)) as { rows: DictRow[] };
  return rows.map(toEntry);
}

/** 업종 한 줄(사용 중). 없으면 null. */
export async function loadBizEntry(client: ScopedClient, bizCode: string): Promise<BizDictEntry | null> {
  const { rows } = (await client.query(`${DICT_SQL} AND d.biz_code = $1 GROUP BY d.biz_code`, [bizCode])) as {
    rows: DictRow[];
  };
  return rows[0] ? toEntry(rows[0]) : null;
}

/** 바꿔 부르는 말(사용 중). */
export async function loadBizAliases(client: ScopedClient): Promise<BizAliasRow[]> {
  const { rows } = (await client.query(
    `SELECT code, name FROM public.tb_s080_codes_line
      WHERE category = $1 AND use_tp = $2 AND is_active = true
      ORDER BY sort_order, code`,
    [BIZ_ALIAS_CATEGORY, BIZ_ALIAS_USE_TP],
  )) as { rows: { code: string; name: string }[] };
  return rows.map((r) => ({ bizCode: r.code, names: r.name }));
}

type LicenseRow = {
  rule_id: string;
  license_kind: string;
  license_name: string | null;
  note: string | null;
  law_name: string | null;
  article_no: number | null;
  branch_no: number | null;
  part: string | null;
  body: string | null;
};

/**
 * 그 업종코드에 이어진 **「검토됨」** 인허가와 근거 조문. 규칙은 rule_id 순, 근거는 법률 → 시행령 · 조문 순.
 * ★ 「확인 필요」 규칙은 내보내지 않는다(결정 2026-10-22).
 */
export async function loadReviewedLicenses(client: ScopedClient, bizCode: string): Promise<BizRecommendLicense[]> {
  const { rows } = (await client.query(
    `SELECT r.rule_id, r.license_kind, r.license_name, r.note,
            l.law_name, a.article_no, a.branch_no, b.part, a.body
       FROM public.tb_s080_license_rule_biz_code k
       JOIN public.tb_s080_license_rule r ON r.rule_id = k.rule_id AND r.active AND r.review_status = '검토됨'
       LEFT JOIN public.tb_s080_license_rule_basis b ON b.rule_id = r.rule_id AND b.active
       LEFT JOIN public.tb_s080_law_article a
              ON a.law_id = b.law_id AND a.article_no = b.article_no AND a.branch_no = b.branch_no AND a.active
       LEFT JOIN public.tb_s080_law l ON l.law_id = a.law_id
      WHERE k.biz_code = $1 AND k.active
      ORDER BY r.rule_id, l.law_kind = '시행령', l.law_name, a.article_no, a.branch_no`,
    [bizCode],
  )) as { rows: LicenseRow[] };
  const byRule = new Map<string, BizRecommendLicense>();
  for (const r of rows) {
    let lic = byRule.get(r.rule_id);
    if (!lic) {
      lic = { kind: r.license_kind, name: r.license_name, note: r.note, basis: [] };
      byRule.set(r.rule_id, lic);
    }
    if (r.law_name !== null && r.article_no !== null && r.body !== null) {
      lic.basis.push({
        lawName: r.law_name,
        article: articleLabel(r.article_no, r.branch_no ?? 0, r.part),
        firstLine: articleFirstLine(r.body),
      });
    }
  }
  return [...byRule.values()];
}

/** 카탈로그에서 그 업종코드의 사용 중인 문구들. */
export async function loadCatalogTexts(client: ScopedClient, bizCode: string): Promise<{ bizCode: string; text: string }[]> {
  const { rows } = (await client.query(
    `SELECT biz_code, biz_name FROM public.tb_s080_biz_purpose_catalog
      WHERE biz_code = $1 AND active ORDER BY biz_name, id`,
    [bizCode],
  )) as { rows: { biz_code: string; biz_name: string }[] };
  return rows.map((r) => ({ bizCode: r.biz_code, text: r.biz_name }));
}
