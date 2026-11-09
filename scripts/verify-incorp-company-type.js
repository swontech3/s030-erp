/**
 * 법인설립 완료 → 회사유형(결정 2026-11-05) 검증 — 완료 전이를 **RLS 를 거쳐** 누르고 회사 정보를 되읽는다.
 *
 * 사용: npm run verify:incorp-company-type   (= npx tsx scripts/verify-incorp-company-type.js)
 *
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app 이다(RLS 는 erp_app 으로만 잰다).
 * ★★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *    라우트가 쓰는 그 함수(`transitionIncorporation`)를 스코프를 바꿔 가며 부른다.
 *
 * 경우: 비입주사(N) · 입주사(T) × 빈 값 · 같은 값 · 다른 값, 회사 사용자 완료, 완료 뒤 법인변경 [새 건] 구분.
 * 시험 단체: 990101~990199(실제 삐용 번호 · mock 9001~9199 와 겹치지 않는 대역).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { randomUUID } from 'node:crypto';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope, scopeOfSession } from '../packages/api/src/db/withCompanyScope.ts';
import { insertIncorporation } from '../packages/api/src/db/incorporations.ts';
import { transitionIncorporation } from '../packages/api/src/legal/incorporationOps.ts';
import { readCorpChangeCompanyType } from '../packages/api/src/legal/corpChangeOps.ts';
import { parseIncorpInfo } from '../packages/shared/src/domain/incorporation-detail.ts';
import { changeTypeAllowedFor } from '../packages/shared/src/domain/corp-change.ts';

const PREFIX = 'v-ict-';
const ORG = (n) => 990100 + n;

const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const session = (role, s020OrgId, companyId = null, s020MemberId = 7101) => ({
  erpSid: 'verify',
  s020MemberId,
  s020OrgId,
  companyId,
  role,
  expiresAt: new Date(Date.now() + 60_000),
  lastActiveAt: null,
});

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      const OP = session('operator', 1);
      const as = (s) => applyCompanyScope(c, scopeOfSession(s));
      const info = parseIncorpInfo({});
      if (!info.ok) throw new Error('빈 설립 정보를 읽지 못했다');

      /** 작성완료(E) 건 하나 — 운영사 스코프로 넣는다. */
      const caseE = async (orgId, entityType) => {
        await as(OP);
        const id = randomUUID();
        await insertIncorporation(c, { id, status: 'E', orgId, orgCode: null, entityType, info: info.value, actor: 'verify' });
        return id;
      };
      const complete = async (s, id) => {
        await as(s);
        return transitionIncorporation(c, s, id, { from: 'E', to: 'C' });
      };
      const legalRow = async (orgId) => {
        await as(OP);
        return (await c.query(`SELECT * FROM public.tb_s080_legal_orgs WHERE org_id = $1`, [orgId])).rows[0] ?? null;
      };
      const companyRow = async (orgId) => {
        await as(OP);
        return (await c.query(`SELECT * FROM public.tb_s080_companies WHERE link_s020_org_id = $1`, [orgId])).rows[0] ?? null;
      };
      /** 회사유형 · 수정 시각 말고 나머지 칸이 같은가. */
      const sameExceptType = (a, b) => {
        const strip = (r) => {
          const { member_type, updated_at, updated_by, ...rest } = r;
          return JSON.stringify(rest);
        };
        return strip(a) === strip(b);
      };
      const putLegal = async (orgId, memberType) => {
        await as(OP);
        await c.query(
          `INSERT INTO public.tb_s080_legal_orgs (org_id, legal_name, ceo_name, tel, head_address, member_type, created_at, updated_at, created_by, updated_by)
           VALUES ($1, '시험비입주사', '박법무', '0212345678', '서울 종로구 시험로 1', $2, now() - interval '1 day', now() - interval '1 day', 'seed', 'seed')`,
          [orgId, memberType],
        );
      };
      await as(OP);
      const build = (await c.query(`SELECT build_id FROM public.tb_s080_buildings ORDER BY 1 LIMIT 1`)).rows[0].build_id;
      const putTenant = async (orgId, memberType) => {
        await as(OP);
        const companyId = `${PREFIX}${orgId}`;
        await c.query(
          `INSERT INTO public.tb_s080_companies
             (company_id, build_id, company_name, corp_number, ceo_name, business_type, email, memo,
              ceo_zip_code, ceo_address, member_type, updated_at, link_s020_org_id)
           VALUES ($1, $2, '시험입주사', '110111-9901000', '김입주', '서비스', 'a@test.com', '메모',
                   '04524', '서울 중구 자택로 1', $3, now() - interval '1 day', $4)`,
          [companyId, build, memberType, orgId],
        );
        return companyId;
      };

      // ── 비입주사 ────────────────────────────────────────────────────────
      // N1 줄 없음 → 새 줄(회사유형만)
      const n1 = ORG(1);
      const r1 = await complete(OP, await caseE(n1, 'A'));
      const l1 = await legalRow(n1);
      check('N1', '비입주사 · 줄 없음 → 새 줄(회사유형 A, 나머지 칸 비움)',
        r1.ok && r1.value.status === 'C' && r1.value.companyTypeNotice === null && l1?.member_type === 'A' &&
          [l1.legal_name, l1.corp_number, l1.biz_number, l1.ceo_name, l1.tel, l1.head_address, l1.ceo_address].every((v) => v === null),
        l1);

      // N2 줄 있음 · 빈 값 → 채움, 다른 칸 그대로
      const n2 = ORG(2);
      await putLegal(n2, null);
      const before2 = await legalRow(n2);
      const r2 = await complete(OP, await caseE(n2, 'A'));
      const l2 = await legalRow(n2);
      check('N2', '비입주사 · 빈 값 → A 로 채움 · 다른 칸 그대로',
        r2.ok && r2.value.companyTypeNotice === null && l2.member_type === 'A' && sameExceptType(before2, l2));

      // N3 같은 값 → 그대로(수정 시각도)
      const n3 = ORG(3);
      await putLegal(n3, 'A');
      const before3 = await legalRow(n3);
      const r3 = await complete(OP, await caseE(n3, 'A'));
      const l3 = await legalRow(n3);
      check('N3', '비입주사 · 같은 값 → 줄을 건드리지 않음 · 안내 없음',
        r3.ok && r3.value.companyTypeNotice === null && JSON.stringify(before3) === JSON.stringify(l3));

      // N4 다른 값 → 바꾸지 않음 · 완료는 그대로 · 안내
      const n4 = ORG(4);
      await putLegal(n4, 'R');
      const before4 = await legalRow(n4);
      const r4 = await complete(OP, await caseE(n4, 'A'));
      const l4 = await legalRow(n4);
      check('N4', '비입주사 · 다른 값(R) → 바꾸지 않음 · 완료 C · 안내 한 줄',
        r4.ok && r4.value.status === 'C' && JSON.stringify(before4) === JSON.stringify(l4) &&
          typeof r4.value.companyTypeNotice === 'string' && r4.value.companyTypeNotice.includes('주식회사') && r4.value.companyTypeNotice.includes('유한회사'),
        r4.ok ? r4.value.companyTypeNotice : r4);

      // N5 회사 사용자가 완료 → 적는다(자기 단체 줄)
      const n5 = ORG(5);
      const r5 = await complete(session('tenant', n5), await caseE(n5, 'A'));
      const l5 = await legalRow(n5);
      check('N5', '비입주사 · 회사 사용자 완료 → 새 줄 A', r5.ok && r5.value.companyTypeNotice === null && l5?.member_type === 'A', r5.ok ? '' : r5);

      // K1 완료 뒤 법인변경 [새 건] — 유한회사 구분
      await as(OP);
      const k1 = await readCorpChangeCompanyType(c, { orgId: n1, orgCode: null });
      const mt = k1.ok ? k1.value.memberType : null;
      check('K1', '완료 뒤 법인변경 [새 건] 회사유형 A → HQ_OUT 보임 · HQ 안 보임',
        mt === 'A' && changeTypeAllowedFor('HQ_OUT', mt) && !changeTypeAllowedFor('HQ', mt), mt);

      // ── 입주사 ──────────────────────────────────────────────────────────
      // T1 빈 값 · 운영자 → 채움, 다른 칸 그대로
      const t1 = ORG(11);
      await putTenant(t1, null);
      const beforeT1 = await companyRow(t1);
      const s1 = await complete(OP, await caseE(t1, 'A'));
      const c1 = await companyRow(t1);
      check('T1', '입주사 · 빈 값 · 운영자 → A 로 채움 · 다른 칸 그대로',
        s1.ok && s1.value.companyTypeNotice === null && c1.member_type === 'A' && sameExceptType(beforeT1, c1));

      // T2 같은 값 → 그대로
      const t2 = ORG(12);
      await putTenant(t2, 'R');
      const beforeT2 = await companyRow(t2);
      const s2 = await complete(OP, await caseE(t2, 'R'));
      const c2 = await companyRow(t2);
      check('T2', '입주사 · 같은 값 → 줄을 건드리지 않음', s2.ok && s2.value.companyTypeNotice === null && JSON.stringify(beforeT2) === JSON.stringify(c2));

      // T3 다른 값 → 바꾸지 않음 · 안내
      const t3 = ORG(13);
      await putTenant(t3, 'P');
      const beforeT3 = await companyRow(t3);
      const s3 = await complete(OP, await caseE(t3, 'A'));
      const c3 = await companyRow(t3);
      check('T3', '입주사 · 다른 값(개인사업자) → 바꾸지 않음 · 완료 C · 안내 한 줄',
        s3.ok && s3.value.status === 'C' && JSON.stringify(beforeT3) === JSON.stringify(c3) &&
          typeof s3.value.companyTypeNotice === 'string' && s3.value.companyTypeNotice.includes('개인사업자'),
        s3.ok ? s3.value.companyTypeNotice : s3);

      // T4 빈 값 · 회사 사용자 → 적지 않음 · 완료 C · 안내
      const t4 = ORG(14);
      const companyT4 = await putTenant(t4, null);
      const beforeT4 = await companyRow(t4);
      const s4 = await complete(session('tenant', t4, companyT4), await caseE(t4, 'A'));
      const c4 = await companyRow(t4);
      check('T4', '입주사 · 빈 값 · 회사 사용자 → 적지 않음 · 완료 C · 운영자 안내',
        s4.ok && s4.value.status === 'C' && JSON.stringify(beforeT4) === JSON.stringify(c4) &&
          typeof s4.value.companyTypeNotice === 'string' && s4.value.companyTypeNotice.includes('운영자'),
        s4.ok ? s4.value.companyTypeNotice : s4);

      // K2 입주사 완료 뒤 법인변경 [새 건]
      await as(OP);
      const k2 = await readCorpChangeCompanyType(c, { orgId: t1, orgCode: null });
      check('K2', '입주사 완료 뒤 법인변경 [새 건] 회사유형 A', k2.ok && k2.value.memberType === 'A', k2.ok ? k2.value : k2);

      // X1 완료가 아닌 전이는 회사유형을 보지 않는다(E→X)
      const x1 = ORG(21);
      await as(OP);
      const xid = await caseE(x1, 'A');
      await as(OP);
      const rx = await transitionIncorporation(c, OP, xid, { from: 'E', to: 'X', cancelReason: '시험' });
      check('X1', '취소(E→X) — 회사 정보에 쓰지 않음', rx.ok && rx.value.companyTypeNotice === null && (await legalRow(x1)) === null);
    } finally {
      await c.query('ROLLBACK');
    }

    // ── 남은 것 없음 ──────────────────────────────────────────────────
    await c.query('BEGIN');
    await applyCompanyScope(c, scopeOfSession(session('operator', 1)));
    const left = (await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_incorporations WHERE org_id BETWEEN 990101 AND 990199)::int
            + (SELECT count(*) FROM public.tb_s080_legal_orgs WHERE org_id BETWEEN 990101 AND 990199)::int
            + (SELECT count(*) FROM public.tb_s080_companies WHERE company_id LIKE $1)::int AS n`,
      [`${PREFIX}%`],
    )).rows[0].n;
    await c.query('ROLLBACK');
    check('Z1', '롤백 후 — 시험 행이 남지 않았다', left === 0, String(left));
  } finally {
    c.release();
  }
}

main()
  .then(async () => {
    await closePool();
    console.table(results);
    const failed = results.filter((r) => r.결과 !== '통과').length;
    console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error('✘ 실행 실패:', e.message);
    await closePool().catch(() => {});
    process.exit(2);
  });
