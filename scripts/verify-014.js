/**
 * 014_name_position.sql 검증.
 *
 * 상호 표기위치(앞/뒤)를 MEMBER_TYPE 의 자식 코드에서 떼어내 NAME_POSITION 카테고리로
 * 옮겼는지, 그리고 parent_line_id 가 사라졌는지 본다.
 *
 * ★ 「MEMBER_TYPE 에 F/B 가 남아 있지 않다」를 따로 본다. 행 수만 맞추면 엉뚱한 8행을
 *   지우고도 통과할 수 있다 — 지워야 할 것은 표기위치이지 법인형태가 아니다.
 *
 * 사용: node scripts/verify-014.js .env
 */
const fs = require('fs');
const { Client } = require('pg');

const readEnv = (p) =>
  Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );

const env = readEnv(process.argv[2] || '.env');

const { itemCountGate } = require('./verify-count.js');

/**
 * 기대 항목 수 — 모자라면 **실패**다. 항목이 조용히 사라지는 것을 막는 유일한 장치이고,
 * 경위는 `verify-count.js` 머리말에 있다. 항목을 늘리면 끝에서 이 수를 고치라고 알려 준다.
 */
const EXPECTED_ITEMS = 12;
let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  const c = new Client({
    host: env.DB_HOST,
    port: +env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionTimeoutMillis: 15000,
  });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  console.log('\n014 — NAME_POSITION 분리 · parent_line_id 삭제');

  const col = await one(`SELECT count(*)::int n FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='tb_s080_codes_line'
                            AND column_name='parent_line_id'`);
  check('parent_line_id 가 사라졌다', col.n === 0);

  const npMaster = await one(
    `SELECT count(*)::int n FROM public.tb_s080_code_masters WHERE category='NAME_POSITION'`,
  );
  check('NAME_POSITION 마스터가 있다', npMaster.n === 1);

  const npCat = await one(
    `SELECT count(*)::int n FROM public.tb_s080_code_categories WHERE category='NAME_POSITION'`,
  );
  check('NAME_POSITION 파티션(000)이 있다', npCat.n === 1);

  const np = await one(
    `SELECT count(*)::int n FROM public.tb_s080_codes_line WHERE category='NAME_POSITION'`,
  );
  check('NAME_POSITION 라인이 2행이다', np.n === 2, `실제 ${np.n}`);

  const npNames = await one(`SELECT string_agg(code || '=' || name, ',' ORDER BY sort_order) s
                               FROM public.tb_s080_codes_line WHERE category='NAME_POSITION'`);
  check('F=앞 · B=뒤 다', npNames.s === 'F=앞,B=뒤', npNames.s);

  const mt = await one(
    `SELECT count(*)::int n FROM public.tb_s080_codes_line WHERE category='MEMBER_TYPE'`,
  );
  check('MEMBER_TYPE 이 10행으로 줄었다', mt.n === 10, `실제 ${mt.n}`);

  const mixed = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line
                            WHERE category='MEMBER_TYPE' AND code IN ('F','B')`);
  check('MEMBER_TYPE 에 표기위치(F/B)가 남아 있지 않다', mixed.n === 0, `${mixed.n}건`);

  const kept = await one(`SELECT string_agg(DISTINCT code, ',' ORDER BY code) s
                            FROM public.tb_s080_codes_line WHERE category='MEMBER_TYPE'`);
  check('법인형태 5종은 그대로다', kept.s === 'A,C,P,R,S', kept.s);

  const total = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line`);
  check('라인 총계가 106이다', total.n === 106, `실제 ${total.n}`);

  const uniq = await one(`SELECT indexdef FROM pg_indexes
                           WHERE schemaname='public'
                             AND indexname='tb_s080_codes_line_build_id_category_code_use_tp_key'`);
  check(
    '유니크가 parent 없이 재생성됐다',
    !!uniq && !uniq.indexdef.includes('parent_line_id'),
    uniq ? uniq.indexdef : '인덱스 없음',
  );

  const dup = await one(`SELECT count(*)::int n FROM (
      SELECT build_id, category, code, use_tp FROM public.tb_s080_codes_line
       GROUP BY 1,2,3,4 HAVING count(*) > 1) x`);
  check('(build_id,category,code,use_tp) 중복이 0이다', dup.n === 0, `${dup.n}건`);

  // ── 계약 폼이 보게 될 것 (Task 3 이 앱에서 지정할 파티션) ──────────────────
  const roomTp = await one(`SELECT string_agg(code, ',' ORDER BY sort_order) s
                              FROM public.tb_s080_codes_line
                             WHERE category='ROOM_TP' AND use_tp='000' AND is_active=true`);
  check('계약 폼이 볼 ROOM_TP 가 6종이고 ET 가 없다', roomTp.s === 'R1,R2,R3,FI,FR,VR', roomTp.s);

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-014.js' });
  await c.end();
  process.exit(fail || short ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
