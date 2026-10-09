/**
 * 법인변경(s040200010) — `GET /legal/corp-changes` 목록 + 선택지 (2단계, 2026-10-10).
 *
 * 새 건 · 상세 · 임원 · 상태 전이는 3단계 이후다. 이 파일에는 **읽기만** 있다.
 *
 * =============================================================================
 * ★★★ 운영사 · 회사 모두 부른다 — 무엇이 보이는지는 RLS 가 가른다
 * =============================================================================
 * 법무 서비스는 회사가 직접 로그인해 쓴다(결정 2026-10-09). 그래서 역할로 403 을 내지 않고,
 * `scopeOfSession` 이 실은 단체 ID 로 037 의 RLS 가 가른다 — 운영사는 전체, 회사는 자기
 * 단체 건만. ★ `scopeOf`(단체 ID 없음)로 바꾸면 회사 세션은 0건이 된다(닫힌 쪽).
 *
 * ★ 선택지(구분 5종 · 상태 4종 + 이름 다섯)를 목록과 **같은 응답에** 싣는다 — 화면이 코드표를
 *   따로 부르지 않는다. `/codes` 는 운영사 전용이라 회사 화면이 부를 수 없기도 하다.
 *   거르는 기준은 shared 의 `CORP_CHANGE_TYPES` · `CORP_CHANGE_STATUSES` 한 곳이다.
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import {
  CORP_CHANGE_CODE_USE_TP,
  CORP_CHANGE_STATUS_CATEGORY,
  CORP_CHANGE_TYPE_CATEGORY,
} from '@swonbiz/shared/domain/corp-change';
import {
  parseCorpChangeListQuery,
  pickCorpChangeOptions,
  type CodeOption,
  type CorpChangeListFilter,
  type CorpChangeListItem,
} from '@swonbiz/shared/domain/corp-change-list';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope } from '../db/withCompanyScope.ts';
import { listCorpChanges } from '../db/corpChanges.ts';
import { listCodes } from '../db/lookups.ts';

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB 없이 필터 · 선택지 · 스코프를 본다. */
export interface CorpChangeDeps {
  list(session: ErpSession, filter: CorpChangeListFilter): Promise<CorpChangeListItem[]>;
  /** 코드표의 두 분류(코드표 순서). */
  codes(session: ErpSession): Promise<{ types: CodeOption[]; statuses: CodeOption[] }>;
}

const defaultDeps: CorpChangeDeps = {
  list: (session, filter) => withCompanyScope(scopeOfSession(session), (client) => listCorpChanges(client, filter)),
  codes: async (session) => {
    const rows = await withCompanyScope(scopeOfSession(session), (client) =>
      listCodes(client, [
        { category: CORP_CHANGE_TYPE_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP },
        { category: CORP_CHANGE_STATUS_CATEGORY, useTp: CORP_CHANGE_CODE_USE_TP },
      ]),
    );
    const pick = (category: string) =>
      rows.filter((r) => r.category === category).map((r) => ({ code: r.code, name: r.name }));
    return { types: pick(CORP_CHANGE_TYPE_CATEGORY), statuses: pick(CORP_CHANGE_STATUS_CATEGORY) };
  },
};

export function registerCorpChangeRoutes(app: FastifyInstance, deps: CorpChangeDeps = defaultDeps): void {
  app.get<{ Querystring: Record<string, unknown> }>('/legal/corp-changes', async (req, reply) => {
    const session = requireSession(req);

    const parsed = parseCorpChangeListQuery(req.query ?? {});
    if (!parsed.ok) return reply.code(400).send({ error: 'bad_filter', message: parsed.message });

    const [items, codes] = await Promise.all([deps.list(session, parsed.filter), deps.codes(session)]);
    return reply.send({ items, ...pickCorpChangeOptions(codes.types, codes.statuses) });
  });
}
