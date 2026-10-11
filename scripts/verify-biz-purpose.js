/**
 * 사업목적 카탈로그(s040300010, 30-7) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다.
 *
 * 사용: npm run verify:biz-purpose   (= npx tsx scripts/verify-biz-purpose.js)
 *
 * ★★ RLS(회사는 사용 중인 줄만 · 회사 쓰기 거절 · 지우기 권한 없음 · 역할 없는 접속 0줄)는
 *    `scripts/verify-041.js` 가 잰다 — 여기서 **다시 재지 않는다.** 여기는 그 위의 앱 처리다:
 *    같은 문구 409(앞뒤 공백 무시 · 끈 줄 포함 · 자기 줄 제외) · 없는 줄 404 · 새 줄 업종코드 NULL ·
 *    목록 순서 · 끈 줄 거르기 · 검색어의 `%` `_` 를 글자로.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — `packages/api/.env` 의 erp_app. 라우트가 쓰는 그 함수
 *    (`routes/bizPurposes.ts` 의 처리 · `db/bizPurposes.ts`)를 운영사 스코프로 부른다.
 * ★ 시험 행은 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 문구는 `v-bp-` 로 시작한다.
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { createBizPurposeOp, updateBizPurposeOp } from '../packages/api/src/routes/bizPurposes.ts';
import { listBizPurposes } from '../packages/api/src/db/bizPurposes.ts';

const P = 'v-bp-';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, { role: 'operator', companyId: null });
      const raw = async (id) => (await c.query(`SELECT biz_code, biz_name, active FROM public.tb_s080_biz_purpose_catalog WHERE id = $1`, [id])).rows[0];
      const mine = async (includeInactive) =>
        (await listBizPurposes(c, { q: P, includeInactive })).items.map((i) => i.text);

      // ── 추가 ──
      const a = await createBizPurposeOp(c, `${P}나 소프트웨어 공급업`);
      const aRow = a.ok ? await raw(a.item.id) : null;
      check('B1', '추가 — 켜진 채로 · 업종코드 NULL(빈 문자열 아님)', a.ok && aRow && aRow.biz_code === null && aRow.active === true, aRow);
      const b = await createBizPurposeOp(c, `${P}가 경영 컨설팅업`);
      const b2 = await createBizPurposeOp(c, `${P}나 소프트웨어 공급업`);
      check('B2', '두 번째 NULL 업종코드 줄도 들어간다 · 같은 문구는 409', b.ok && !b2.ok && b2.status === 409, b2);

      // ★ 앞뒤 공백은 무시 — DB 에 공백이 붙은 옛 줄이 있어도 같다고 본다(btrim)
      await c.query(`UPDATE public.tb_s080_biz_purpose_catalog SET biz_name = $2 WHERE id = $1`, [b.item.id, `  ${P}가 경영 컨설팅업 `]);
      const b3 = await createBizPurposeOp(c, `${P}가 경영 컨설팅업`);
      check('B3', '★ DB 쪽 문구에 앞뒤 공백이 있어도 같은 문구 409', !b3.ok && b3.status === 409, b3);

      // ── 사용 끄기 · 끈 줄과 같은 문구 ──
      const off = await updateBizPurposeOp(c, a.item.id, { active: false });
      const again = await createBizPurposeOp(c, `${P}나 소프트웨어 공급업`);
      check('B4', '★ 끈 줄과 같은 문구도 409 — 「다시 켜세요」', off.ok && !again.ok && again.status === 409 && /다시 켜세요/.test(again.message), again);

      // ── 고치기 ──
      const self = await updateBizPurposeOp(c, b.item.id, { text: `${P}가 경영 컨설팅업` });
      const clash = await updateBizPurposeOp(c, b.item.id, { text: `${P}나 소프트웨어 공급업` });
      check('B5', '고치기 — 자기 줄 문구는 통과 · 다른 줄(끈 줄 포함) 문구는 409', self.ok && !clash.ok && clash.status === 409, { self: self.ok, clash });
      const gone = await updateBizPurposeOp(c, `${P}none`, { active: true });
      check('B6', '없는 줄 고치기 — 404', !gone.ok && gone.status === 404, gone);

      // ── 목록 ──
      check('B7', '목록 — 끈 줄은 includeInactive 일 때만', (await mine(false)).join('|') === `${P}가 경영 컨설팅업` &&
        (await mine(true)).join('|') === `${P}가 경영 컨설팅업|${P}나 소프트웨어 공급업`, { off: await mine(false), all: await mine(true) });

      await createBizPurposeOp(c, `${P}수수료 50% 할인업`);
      await createBizPurposeOp(c, `${P}수수료 5000 할인업`);
      await createBizPurposeOp(c, `${P}a_b 업`);
      await createBizPurposeOp(c, `${P}axb 업`);
      const pct = (await listBizPurposes(c, { q: '50%', includeInactive: true })).items.map((i) => i.text);
      const und = (await listBizPurposes(c, { q: 'a_b', includeInactive: true })).items.map((i) => i.text);
      check('B8', '★ 검색어의 % _ 는 글자로 — 50% 는 5000 을, a_b 는 axb 를 잡지 않는다',
        pct.join('|') === `${P}수수료 50% 할인업` && und.join('|') === `${P}a_b 업`, { pct, und });

    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, { role: 'operator', companyId: null });
      const left = (await c.query(`SELECT count(*)::int n FROM public.tb_s080_biz_purpose_catalog WHERE btrim(biz_name) LIKE $1`, [`${P}%`])).rows[0].n;
      const all = (await c.query(`SELECT count(*)::int n FROM public.tb_s080_biz_purpose_catalog`)).rows[0].n;
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', left === 0 && all > 0, `남은 시험 줄 ${left} · 전체 ${all}`);
    } finally {
      await c.query('ROLLBACK');
    }
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
