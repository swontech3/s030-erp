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
const EXPECTED_ITEMS = 11;
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

  const mixed = await one(`SELECT count(*)::int n FROM public.tb_s080_codes_line
                            WHERE category='MEMBER_TYPE' AND code IN ('F','B')`);
  check('MEMBER_TYPE 에 표기위치(F/B)가 남아 있지 않다', mixed.n === 0, `${mixed.n}건`);

  /*
   * ══════════════════════════════════════════════════════════════════════
   * ★★ **「몇 행인가」가 아니라 「지워야 할 것만 지웠는가」를 본다**
   * ══════════════════════════════════════════════════════════════════════
   * 예전에는 세 가지를 수로 못 박았다 — MEMBER_TYPE 10행 · 법인형태가 정확히
   * `A,C,P,R,S` · 라인 총계 106. 전부 **2026-09-19 그 순간의 사진**이고, 그 뒤
   * 마이그레이션이 정당하게 바꿨다:
   *
   *   017  MEMBER_TYPE 에 개인(`Z`)을 더했다  → 10행이 11행, 5종이 6종
   *   016·그 뒤  코드값이 늘었다              → 총계 106이 118
   *
   * 그래서 이 셋은 **014 와 아무 상관 없이** 실패하고 있었다(2026-10-04). 수를
   * 못 박으면 뒤에 오는 모든 정당한 변경이 이 시험을 깨뜨린다.
   *
   * 014 가 실제로 보장한 것은 「표기위치를 떼어냈다」와 「법인형태는 건드리지
   * 않았다」 둘이다. 그 둘만 본다 — **더 늘어나는 것은 허용한다.**
   */
  const kept = await one(`
    SELECT count(*)::int n FROM (VALUES ('A'),('C'),('P'),('R'),('S')) want(code)
     WHERE NOT EXISTS (SELECT 1 FROM public.tb_s080_codes_line l
                        WHERE l.category='MEMBER_TYPE' AND l.use_tp='000' AND l.code=want.code)`);
  check(
    '법인형태 5종(A·C·P·R·S)이 그대로 있다 — 014 가 엉뚱한 행을 지우지 않았다',
    kept.n === 0,
    `${kept.n}종 없어짐`,
  );

  /*
   * ★ 총계 대신 **깨짐**을 본다. 014 는 `parent_line_id IS NOT NULL` 인 행을
   *   무더기로 지웠다. 엉뚱한 범위를 지웠다면 가리킬 파티션이 없는 코드값이나
   *   빈 분류가 남는다 — 그것을 직접 보는 편이 「106이어야 한다」보다 낫고,
   *   코드값이 늘어도 깨지지 않는다.
   */
  const orphanLine = await one(`
    SELECT count(*)::int n, string_agg(DISTINCT l.category || '/' || l.use_tp, ', ') d
      FROM public.tb_s080_codes_line l
     WHERE NOT EXISTS (SELECT 1 FROM public.tb_s080_code_categories g
                        WHERE g.build_id=l.build_id AND g.category=l.category AND g.use_tp=l.use_tp)`);
  check(
    '★ 파티션 없는 코드값이 0건이다 — 014 가 코드표를 깨지 않았다',
    orphanLine.n === 0,
    `${orphanLine.n}건 (${orphanLine.d})`,
  );

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
