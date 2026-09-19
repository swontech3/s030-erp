/**
 * 013_code_categories.sql 검증.
 *
 * 마이그레이션이 만든 코드 카테고리 테이블과, 그것이 실제로 **막는지**를 확인한다.
 *
 * ★ 이 마이그레이션의 값어치는 테이블이 생긴 것이 아니라 **FK 가 생긴 것**이다.
 *   그래서 "없는 use_tp 를 넣어 보고 거부당하는지"를 직접 시험한다 — 제약이 있는지
 *   카탈로그로만 보고 통과로 읽으면, 이름만 있고 안 걸리는 제약을 놓친다.
 *
 * 사용: node scripts/verify-013.js .env
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

  console.log('\n013 — 코드 카테고리 테이블');

  const t = await one(`SELECT count(*)::int n FROM information_schema.tables
                        WHERE table_schema='public' AND table_name='tb_s080_code_categories'`);
  check('테이블이 있다', t.n === 1);

  if (t.n === 1) {
    // ★ 숫자를 박지 않는다. 013 적용 시점에는 27행이었으나 014 가 NAME_POSITION 을
    //   더해 28행이 됐다 — 스냅샷을 박아 두면 뒤 마이그레이션이 통과를 깨뜨린다.
    //   확인할 것은 "라인이 쓰는 파티션마다 카테고리가 하나씩 있다"는 불변식이다.
    //   (운영자가 라인 없는 빈 파티션을 만들면 이 등식은 정당하게 깨진다. 그때 고친다.)
    const rows = await one(`
      SELECT (SELECT count(*)::int FROM public.tb_s080_code_categories) cats,
             (SELECT count(*)::int FROM (SELECT DISTINCT build_id, category, use_tp
                                           FROM public.tb_s080_codes_line) x) combos`);
    check('카테고리 수가 라인의 파티션 조합 수와 같다', rows.cats === rows.combos,
          `카테고리 ${rows.cats} · 조합 ${rows.combos}`);
    check('013 이 이관한 27행 이상이다', rows.cats >= 27, `실제 ${rows.cats}`);

    const orphan = await one(`
      SELECT count(*)::int n
        FROM (SELECT DISTINCT build_id, category, use_tp FROM public.tb_s080_codes_line) l
       WHERE NOT EXISTS (SELECT 1 FROM public.tb_s080_code_categories g
                          WHERE g.build_id = l.build_id AND g.category = l.category AND g.use_tp = l.use_tp)`);
    check('짝 없는 파티션이 0이다', orphan.n === 0, `${orphan.n}건`);

    // ★ 숫자가 아니라 **규칙**을 본다(015). `000` 은 어느 카테고리에서나 공통 파티션이니
    //   이름도 「공통」이어야 한다. 쓰임새는 name 이 아니라 description 이 담는다.
    const common = await one(`SELECT count(*)::int n FROM public.tb_s080_code_categories
                               WHERE use_tp='000' AND name <> '공통'`);
    check("use_tp='000' 은 이름이 전부 「공통」이다", common.n === 0, `어긋난 행 ${common.n}건`);

    // `000` 이 아닌 파티션은 **공통이 아니다.** 이름이 「공통」이면 013 의 이름표에서
    // 빠져 기본값을 받았다는 뜻이다(EXEC_TP 001 이 실제로 그랬다 — 015 가 고쳤다).
    const subCommon = await one(`SELECT count(*)::int n FROM public.tb_s080_code_categories
                                  WHERE use_tp <> '000' AND name = '공통'`);
    check("use_tp<>'000' 인데 이름이 「공통」인 행이 없다", subCommon.n === 0, `${subCommon.n}건`);

    // 역산표(§B-3) 기준 5개: EXEC_TP 001 · MEMBER_TYPE 001·002 · PAY_ST 001 · ROOM_TP 001.
    // (`RES_TP 001` 은 레거시가 부르지만 이 DB 에 행이 없어 카테고리도 없다.)
    const sub = await one(`SELECT count(*)::int n FROM public.tb_s080_code_categories
                            WHERE use_tp <> '000'`);
    check('000 이 아닌 파티션이 5개다', sub.n === 5, `실제 ${sub.n}`);

    const blank = await one(`SELECT count(*)::int n FROM public.tb_s080_code_categories
                              WHERE btrim(name) = ''`);
    check('이름이 빈 파티션이 없다', blank.n === 0, `${blank.n}건`);

    const desc = await one(`SELECT count(*)::int n FROM public.tb_s080_code_categories
                             WHERE description IS NULL OR btrim(description) = ''`);
    check('설명이 빈 파티션이 없다 — 쓰임새는 여기 남는다', desc.n === 0, `${desc.n}건`);

    const grant = await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                              WHERE table_schema='public' AND table_name='tb_s080_code_categories'
                                AND grantee='erp_app' AND privilege_type='SELECT'`);
    check('erp_app 이 읽을 수 있다', grant.n === 1);
  } else {
    check('카테고리 수가 라인의 파티션 조합 수와 같다', false, '테이블 없음');
    check('013 이 이관한 27행 이상이다', false, '테이블 없음');
    check('짝 없는 파티션이 0이다', false, '테이블 없음');
    check("use_tp='000' 은 이름이 전부 「공통」이다", false, '테이블 없음');
    check("use_tp<>'000' 인데 이름이 「공통」인 행이 없다", false, '테이블 없음');
    check('000 이 아닌 파티션이 5개다', false, '테이블 없음');
    check('이름이 빈 파티션이 없다', false, '테이블 없음');
    check('설명이 빈 파티션이 없다 — 쓰임새는 여기 남는다', false, '테이블 없음');
    check('erp_app 이 읽을 수 있다', false, '테이블 없음');
  }

  const fk = await one(`SELECT count(*)::int n FROM pg_constraint
                         WHERE conname='tb_s080_codes_line_category_fkey' AND contype='f'`);
  check('codes_line FK 가 use_tp 까지 건다', fk.n === 1);

  const oldFk = await one(
    `SELECT count(*)::int n FROM pg_constraint WHERE conname='tb_s080_codes_line_build_id_category_fkey'`,
  );
  check('예전 FK 가 사라졌다', oldFk.n === 0);

  // ★ FK 가 실제로 막는지 — 없는 use_tp 로 INSERT 를 시도하고 반드시 롤백한다
  let blocked = false;
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO public.tb_s080_codes_line
      (line_id, build_id, category, code, name, use_tp, sort_order, is_active, is_system, updated_at)
      VALUES ('__probe__','1','ROOM_TP','__X__','probe','999',99,true,false,CURRENT_TIMESTAMP)`);
  } catch {
    blocked = true;
  } finally {
    await c.query('ROLLBACK');
  }
  check('없는 use_tp 는 FK 가 거부한다', blocked);

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
