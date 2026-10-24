/**
 * 공용 회사 조회 — `GET /org-lookup` (목록) · `GET /org-lookup/one` (단건).
 *
 * 삐용 단체를 찾아 고르는 팝업(`web/src/components/org-lookup/`)의 서버 쪽이다. 법무
 * 서비스(S04)가 처음 쓰지만 법무 것이 아니다 — 세무 등도 같이 쓴다(결정 2026-10-09).
 *
 * =============================================================================
 * ★★★ 운영사 전용이다 — 회사 사용자는 403
 * =============================================================================
 * 목록은 **다른 회사들의 이름·대표자**다. 회사 사용자가 부를 이유가 없다(자기 회사는
 * 세션이 이미 안다). 화면에서 팝업을 감추는 것으로는 부족하다 — 주소를 직접 부를 수 있다.
 * ★ 화면 코드(`requireScreen`)를 걸지 않는다. 이 경로는 화면이 아니라 여러 화면이 부르는
 *   부품이고, 부르는 화면이 각자 자기 코드로 접근을 기록한다.
 *
 * =============================================================================
 * ★★ 브라우저가 삐용을 직접 부르지 않는다
 * =============================================================================
 * 삐용 토큰은 서버에만 있다(지시문 1-4). 조회도 `callBbiyong` 을 거친다 — 토큰 만료 시
 * 재발급이 그 안에서 돈다(`session/bbiyongToken.ts`).
 *
 * ★ 삐용 단체 조회 **규격이 아직 없다.** 실연동(`BBIYONG_MOCK=false`)에서는 어댑터가
 *   `unsupported` 를 돌려주고, 여기서 503 + 그 문구로 내린다. 장애(삐용 꺼짐)와는 문구가 다르다.
 *
 * ★ 응답은 단체 + 입주사 딱지까지다. 팝업이 부르는 화면에 넘기는 것은 그중 셋뿐이다
 *   (`domain/org-lookup.ts` 의 `toOrgPick`).
 */
import type { FastifyInstance } from 'fastify';
import type { ErpSession } from '@swonbiz/shared';
import {
  markTenants,
  normalizeOrgQuery,
  parseOrgKey,
  type OrgInfo,
  type OrgKey,
} from '@swonbiz/shared/domain/org-lookup';
import { requireSession } from '../session/hook.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';
import { bbiyongOrg, type OrgLookupOutcome } from '../bbiyong/index.ts';
import { scopeOfSession, withCompanyScope } from '../db/withCompanyScope.ts';
import { listLinkedOrgIds } from '../db/orgLookup.ts';

/** 바꿔 끼울 수 있는 바깥 — 시험이 삐용·DB 없이 권한과 딱지 판정을 본다. */
export interface OrgLookupDeps {
  listOrgs(session: ErpSession, name: string): Promise<OrgLookupOutcome<OrgInfo[]>>;
  getOrg(session: ErpSession, key: OrgKey): Promise<OrgLookupOutcome<OrgInfo | null>>;
  /** 주어진 단체 ID 중 ERP 입주사에 연결된 것. */
  linkedOrgIds(session: ErpSession, orgIds: readonly number[]): Promise<number[]>;
}

const defaultDeps: OrgLookupDeps = {
  listOrgs: (session, name) => callBbiyong(session.erpSid, (token) => bbiyongOrg.listOrgs({ name }, token)),
  getOrg: (session, key) => callBbiyong(session.erpSid, (token) => bbiyongOrg.getOrg(key, token)),
  linkedOrgIds: (session, orgIds) =>
    withCompanyScope(scopeOfSession(session), (client) => listLinkedOrgIds(client, orgIds)),
};

const FORBIDDEN = { error: 'forbidden', message: '회사 조회는 운영사만 할 수 있습니다' } as const;

export function registerOrgLookupRoutes(app: FastifyInstance, deps: OrgLookupDeps = defaultDeps): void {
  app.get<{ Querystring: { q?: string } }>('/org-lookup', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== 'operator') return reply.code(403).send(FORBIDDEN);

    const out = await deps.listOrgs(session, normalizeOrgQuery(req.query.q));
    if (out.kind === 'unsupported') {
      return reply.code(503).send({ error: 'org_lookup_unsupported', message: out.message });
    }
    // ★ 받은 목록을 그대로 보여 준다 — 「법무 서비스를 받은 회사」로 거르는 것은 삐용 몫이다
    //   (삐용 회신 2026-10-09). 단체코드 대역(Z 등)으로 거르지 않는다.
    const orgs = out.value;
    const linked = await deps.linkedOrgIds(session, orgs.map((o) => o.orgId));
    return reply.send({ orgs: markTenants(orgs, linked) });
  });

  app.get<{ Querystring: { orgId?: string; orgCode?: string } }>('/org-lookup/one', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== 'operator') return reply.code(403).send(FORBIDDEN);

    const key = parseOrgKey(req.query);
    if (!key) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: '단체 ID 또는 단체코드 중 하나를 바르게 주세요' });
    }

    const out = await deps.getOrg(session, key);
    if (out.kind === 'unsupported') {
      return reply.code(503).send({ error: 'org_lookup_unsupported', message: out.message });
    }
    if (!out.value) return reply.send({ org: null });
    const linked = await deps.linkedOrgIds(session, [out.value.orgId]);
    return reply.send({ org: markTenants([out.value], linked)[0] });
  });
}
