/**
 * 일회용(2026-11-05) — 이미 「완료」(C)인 법인설립 건에 「완료 → 회사유형」 규칙을 적용한다(결정 2026-11-05).
 *
 * 규칙은 앱의 완료 처리와 같은 함수다(`packages/api/src/legal/incorpCompanyType.ts`):
 *   · 비입주사 → 법무 회사 정보(`tb_s080_legal_orgs.member_type`) — 줄이 없으면 새 줄(회사유형만, 나머지 칸 비움)
 *   · 입주사   → ERP 회사 정보(`tb_s080_companies.member_type`)
 *   · 비어 있으면 채움 · 이미 같으면 그대로 · 다른 값이면 바꾸지 않음(보기에 「다름」으로 찍는다)
 *   · 회사유형 말고 다른 칸은 그대로
 * ★ 운영사 스코프로 돈다 — 입주사도 적는다(앱에서 회사 사용자가 완료할 때만 적지 않는다).
 * ★ 한 단체에 완료 건이 여럿이면 완료 시각 순서로 차례로 본다(앞 건이 채우면 뒤 건은 「그대로」 또는 「다름」).
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 한 트랜잭션으로 쓰고 되읽는다.
 *   멈추는 경우(아무것도 쓰지 않는다): 설립 형태가 R · A 가 아닌 건이 있음.
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   npx tsx scripts/oneoff/2026-11-05-incorporation-company-type.mjs <admin.env>            (보기)
 *   npx tsx scripts/oneoff/2026-11-05-incorporation-company-type.mjs <admin.env> --apply    (쓰기)
 */
import fs from 'node:fs';
import pg from 'pg';
import { applyCompanyScope } from '../../packages/api/src/db/withCompanyScope.ts';
import { planCompanyTypeOnComplete, writeCompanyTypeOnComplete } from '../../packages/api/src/legal/incorpCompanyType.ts';
import { companyTypeOnComplete, isIncorpEntityType } from '../../packages/shared/src/domain/incorporation.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-11-05-incorporation-company-type.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const ACTOR = 'oneoff-2026-11-05';
const DECISION_NAME = { fill: '채움', same: '그대로', differ: '다름(바꾸지 않음)' };

const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });

async function main() {
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await applyCompanyScope(c, { role: 'operator', companyId: null, orgId: null });

    const cases = (await c.query(
      `SELECT id, org_id, org_code, entity_type, name_ko, completed_at
         FROM public.tb_s080_incorporations
        WHERE status = 'C'
        ORDER BY completed_at NULLS FIRST, id`,
    )).rows;
    const badEntity = cases.filter((r) => !isIncorpEntityType(r.entity_type));
    if (badEntity.length > 0) {
      console.table(badEntity.map((r) => ({ 건: r.id, 단체: r.org_id, 형태: r.entity_type })));
      throw new Error('설립 형태가 R · A 가 아닌 완료 건이 있다 — 멈춘다');
    }

    // 보기 — 단체마다 앞 건의 결과를 이어 받아 차례로 판정한다(쓰지 않는다).
    /** @type {Map<number, string | null>} */
    const simulated = new Map();
    const plan = [];
    for (const r of cases) {
      const p = await planCompanyTypeOnComplete(c, r.org_id, r.entity_type);
      const current = simulated.has(r.org_id) ? simulated.get(r.org_id) : p.source.memberType;
      const decision = companyTypeOnComplete(current, r.entity_type);
      if (decision === 'fill') simulated.set(r.org_id, r.entity_type);
      else if (!simulated.has(r.org_id)) simulated.set(r.org_id, current);
      plan.push({
        건: r.id.slice(0, 8),
        단체: r.org_id,
        단체코드: r.org_code ?? '',
        상호: r.name_ko ?? '',
        설립형태: r.entity_type,
        구분: p.source.isTenant ? '입주사(ERP)' : '비입주사(법무)',
        지금값: current ?? '(비어 있음)',
        결정: DECISION_NAME[decision],
        // 채움은 단체마다 한 번뿐이다(채운 뒤 같은 단체의 건은 그대로 · 다름).
        새줄: decision === 'fill' && !p.source.isTenant && !p.source.hasLegalOrg ? '예' : '',
        _row: r,
        _decision: decision,
      });
    }
    console.log(`완료된 설립 건 ${cases.length}개`);
    console.table(plan.map(({ _row, _decision, ...rest }) => rest));
    const fills = plan.filter((p) => p._decision === 'fill');
    console.log(`바뀔 회사: ${fills.length}곳 · 그대로: ${plan.filter((p) => p._decision === 'same').length} · 다름: ${plan.filter((p) => p._decision === 'differ').length}`);

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('보기만 했다 — 쓰려면 --apply');
      return;
    }

    // 쓰기 — 같은 순서로 실제 판정을 다시 하고 쓴다. 보기와 다르면 멈춘다(되돌린다).
    for (const p of plan) {
      const real = await planCompanyTypeOnComplete(c, p._row.org_id, p._row.entity_type);
      if (real.decision !== p._decision) throw new Error(`판정이 보기와 다르다(건 ${p.건}) — 멈춘다`);
      await writeCompanyTypeOnComplete(c, real, ACTOR);
    }
    // 되읽기
    const after = [];
    for (const p of fills) {
      const again = await planCompanyTypeOnComplete(c, p._row.org_id, p._row.entity_type);
      after.push({ 단체: p.단체, 구분: p.구분, 회사유형: again.source.memberType, 맞음: again.source.memberType === p._row.entity_type ? '예' : '아니오' });
    }
    console.table(after);
    if (after.some((a) => a.맞음 !== '예')) throw new Error('되읽은 값이 다르다 — 되돌린다');
    await c.query('COMMIT');
    console.log(`적용했다 — ${fills.length}곳`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

main()
  .then(() => c.end())
  .catch(async (e) => {
    console.error('✘ 실패:', e.message);
    await c.end().catch(() => {});
    process.exit(1);
  });
