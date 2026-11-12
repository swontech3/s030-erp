/**
 * 211 검증 — 세무(S05) 개인사업자(파티션 002) 출금 항목에 접대비(ENTERTAIN).
 *
 *   개인 002  1~14 그대로 · 15 접대비(풀이 「거래처 식사·선물」) · 16 거래처 경조사비 · 17 사업과 무관 — 대표 인출 · 18 잘 모름 — 세무사에게 묻기
 *   법인 001  17개 그대로(15 접대비 · 16 사업과 무관 — 세무사 판단 · 17 잘 모름)
 *
 * 사용: node scripts/verify-211.js .env packages/api/.env
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 앱과 같은 길로 erp_app 접속 · 운영사 스코프에서 읽는다
 *   (트랜잭션은 ROLLBACK 으로 닫는다). verify-210 과 같은 방식. 전체 항목 표(이름 · 풀이)는 verify-207 이 잰다.
 * ★ `run211(q)` 를 내보낸다 — 적용 전 시험(마이그레이션을 트랜잭션 안에서 돌려 ROLLBACK)에서 같은 검사를 쓴다.
 * ★★ 순서는 대표가 승인한 값(2026-10-31) 그대로 여기 적어 둔다 — 코드 관리에서 순서를 고치면 실패로 나온다.
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
const fs = require('fs');
const { Client } = require('pg');

const CAT = 'TAX_ITEM_OUT';
const INDIV = ['RENT', 'TEL', 'SUPPLY', 'MEAL', 'TRAVEL', 'DELIVERY', 'AD', 'FEE', 'OUTSOURCE', 'INSURANCE', 'REPAIR', 'EDU',
  'UTILITY', 'VEHICLE', 'ENTERTAIN', 'CONDOLENCE', 'NONBIZ_OWNER', 'UNKNOWN'];
const CORP = ['RENT', 'TEL', 'SUPPLY', 'MEAL', 'TRAVEL', 'DELIVERY', 'AD', 'FEE', 'OUTSOURCE', 'INSURANCE', 'REPAIR', 'EDU',
  'UTILITY', 'VEHICLE', 'ENTERTAIN', 'NONBIZ_TAXPRO', 'UNKNOWN'];

/** 검사 — `q(sql, params)` 는 줄 배열을 준다. 결과 줄 배열을 돌려준다. */
async function run211(q) {
  const results = [];
  const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
  const lines = await q(`SELECT line_id, use_tp, code, name, description, sort_order, is_active, is_system FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 ORDER BY use_tp, sort_order, code`, [CAT]);
  const of = (useTp) => lines.filter((l) => l.use_tp === useTp);
  const order = (rows) => rows.map((l) => `${l.sort_order}.${l.code}`).join(' ');
  const want = (codes) => codes.map((c, i) => `${i + 1}.${c}`).join(' ');

  const e = of('002').find((l) => l.code === 'ENTERTAIN');
  check('E1', '★ 개인(002) 접대비 — 코드값 ENTERTAIN · 이름 「접대비」 · 풀이 「거래처 식사·선물」 · 순서 15 · 켜짐 · 시스템 아님',
    !!e && e.line_id === 'cl_1_TAX_ITEM_OUT_002_ENTERTAIN' && e.name === '접대비' && e.description === '거래처 식사·선물' &&
    e.sort_order === 15 && e.is_active && !e.is_system,
    e ? JSON.stringify(e) : '없음');
  check('E2', '★ 개인(002) 18개 — 1~14 그대로 · 15 접대비 · 16 경조사비 · 17 대표 인출 · 18 잘 모름(빈틈 · 겹침 없이)',
    order(of('002')) === want(INDIV), order(of('002')));
  check('E3', '법인(001) 17개 그대로 — 15 접대비 · 16 세무사 판단 · 17 잘 모름',
    order(of('001')) === want(CORP), order(of('001')));
  const corpE = of('001').find((l) => l.code === 'ENTERTAIN');
  check('E4', '두 파티션의 접대비 이름 · 풀이가 같다',
    !!corpE && !!e && corpE.name === e.name && corpE.description === e.description,
    `${corpE?.name}/${corpE?.description} · ${e?.name}/${e?.description}`);
  check('E5', `${CAT} 코드 줄 합계 35 · 모두 켜짐`, lines.length === 35 && lines.every((l) => l.is_active), String(lines.length));
  return results;
}

module.exports = { run211 };

if (require.main === module) {
  const readEnv = (file) =>
    Object.fromEntries(
      fs.readFileSync(file, 'utf8').split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
    );
  const apiEnv = readEnv(process.argv[3] || 'packages/api/.env');
  (async () => {
    let results;
    const erpUrl = apiEnv.ERP_DATABASE_URL || '';
    if (!erpUrl) {
      results = [{ 항목: 'E*', 내용: 'erp_app 접속', 결과: '실패', 비고: 'packages/api/.env 에 ERP_DATABASE_URL 이 없다' }];
    } else {
      const ec = new Client({ connectionString: erpUrl });
      await ec.connect();
      try {
        await ec.query('BEGIN');
        await ec.query(`SELECT set_config('app.current_role', 'operator', true)`);
        results = await run211((s, p) => ec.query(s, p).then((r) => r.rows));
      } finally {
        await ec.query('ROLLBACK');
        await ec.end();
      }
    }
    console.table(results);
    const failed = results.filter((r) => r.결과 !== '통과').length;
    console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
    process.exit(failed === 0 ? 0 : 1);
  })().catch((e) => {
    console.error('✘ 실행 실패:', e.message);
    process.exit(2);
  });
}
