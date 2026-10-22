/**
 * 일회용(2026-10-22) — 사업목적 「추천」 탭의 「바꿔 부르는 말」 시작 목록을 공통 코드로 등록한다.
 *
 * 사용자 결정(2026-10-22):
 *   · 공통 코드 분류 `BIZ_ALIAS`, 파티션 `000`(공통). 코드값 = 업종코드 6자리(047), 이름 = 바꿔 부르는 말을 「, 」로 이은 것
 *   · 시작 목록은 설계 보고의 21줄에서 「떡집」(154101)을 빼고 「네일샵」 · 「홈페이지 제작」은 넣는다 → 20줄(아래 LINES)
 *   · 등록 뒤 말을 늘리고 줄이는 것은 코드 관리(s030100030)에서 이름을 고친다(한 업무는 한 화면)
 *   · 「SI」는 뺀다(2026-10-22 — 영문 2글자라 다른 영문 입력에 잘못 걸린다)
 *
 * 모양은 기존 시드와 같다 — 머리 `cm_1_BIZ_ALIAS` · 파티션 `cc_1_BIZ_ALIAS_000` · 값 `cl_1_BIZ_ALIAS_<업종코드>`,
 * 건물 `1`, `is_system = false`, 사용 중, 순서 = 아래 순서(1부터).
 *
 * ★ 분류가 이미 있으면(머리 · 파티션 · 값 중 하나라도) 멈춘다 — 첫 등록만 한다.
 * ★ 업종코드가 047 에 없거나 사용 안 함이면 멈춘다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 *
 *   node scripts/oneoff/2026-10-22-biz-alias-codes.js .env            (보기)
 *   node scripts/oneoff/2026-10-22-biz-alias-codes.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-22-biz-alias-codes.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const BUILD_ID = '1';
const CATEGORY = 'BIZ_ALIAS';
const USE_TP = '000';
const MASTER = {
  name: '업종 바꿔 부르는 말',
  description: '사업목적 고르기 팝업 「추천」 탭이 읽는다. 코드값 = 업종코드 6자리(업종 사전 047), 이름 = 바꿔 부르는 말을 「, 」로 이은 것',
};
const PARTITION_DESC = '단일 파티션. 사업목적 「추천」 탭이 쓴다';

/** [업종코드, 바꿔 부르는 말] — 순서대로 sort_order 1.. */
const LINES = [
  ['525101', '쇼핑몰, 온라인몰, 스마트스토어, 인터넷 판매'],
  ['525103', '쇼핑몰, 오픈마켓'],
  ['552303', '카페, 커피숍'],
  ['552307', '카페, 주스'],
  ['552301', '빵집, 베이커리'],
  ['552101', '식당, 음식점, 한식당'],
  ['552107', '치킨집'],
  ['552108', '분식, 김밥집'],
  ['522109', '반찬가게'],
  ['930203', '미용실, 헤어샵'],
  ['930205', '피부관리실, 에스테틱'],
  ['930207', '네일샵'],
  ['930201', '이발소, 바버샵'],
  ['551002', '모텔, 여관'],
  ['551005', '민박'],
  ['930100', '세탁소'],
  ['722000', '앱 개발, 소프트웨어 개발, SaaS'],
  ['722005', '외주 개발, 홈페이지 제작'],
  ['741400', '컨설팅'],
  ['154104', '빵 제조'],
];

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    if (new Set(LINES.map(([k]) => k)).size !== LINES.length) throw new Error('업종코드가 겹칩니다');
    const { rows: [have] } = await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_code_masters WHERE category = $1)::int AS m,
              (SELECT count(*) FROM public.tb_s080_code_categories WHERE category = $1)::int AS p,
              (SELECT count(*) FROM public.tb_s080_codes_line WHERE category = $1)::int AS l`,
      [CATEGORY],
    );
    if (have.m || have.p || have.l) {
      throw new Error(`분류 ${CATEGORY} 가 이미 있습니다(머리 ${have.m} · 파티션 ${have.p} · 값 ${have.l}) — 첫 등록만 합니다. 아무것도 쓰지 않았습니다`);
    }
    const dict = new Map((await c.query(
      'SELECT biz_code, item_name, active FROM public.tb_s080_biz_code WHERE biz_code = ANY($1)', [LINES.map(([k]) => k)],
    )).rows.map((r) => [r.biz_code, r]));
    const bad = [];
    console.log(`■ 머리 cm_1_${CATEGORY} — ${MASTER.name}`);
    console.log(`■ 파티션 cc_1_${CATEGORY}_${USE_TP} — 공통`);
    LINES.forEach(([code, names], i) => {
      const d = dict.get(code);
      if (!d) bad.push(`${code}: 047 에 없습니다`);
      else if (!d.active) bad.push(`${code}: 047 에서 사용 안 함입니다`);
      console.log(`  ${String(i + 1).padStart(2)}. ${code} ${d ? d.item_name : '(없음)'}  ←  ${names}`);
    });
    if (bad.length) throw new Error(`어긋남 ${bad.length} — 아무것도 쓰지 않았습니다\n  ${bad.join('\n  ')}`);
    const words = LINES.reduce((n, [, names]) => n + names.split(',').filter((w) => w.trim()).length, 0);
    console.log(`\n합계 — 값 ${LINES.length}줄 · 바꿔 부르는 말 ${words}개`);

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    await c.query(
      `INSERT INTO public.tb_s080_code_masters (code_id, build_id, category, name, description, is_system, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP)`,
      [`cm_${BUILD_ID}_${CATEGORY}`, BUILD_ID, CATEGORY, MASTER.name, MASTER.description],
    );
    await c.query(
      `INSERT INTO public.tb_s080_code_categories (code_category_id, build_id, category, use_tp, name, description, is_system, updated_at)
       VALUES ($1, $2, $3, $4, '공통', $5, false, CURRENT_TIMESTAMP)`,
      [`cc_${BUILD_ID}_${CATEGORY}_${USE_TP}`, BUILD_ID, CATEGORY, USE_TP, PARTITION_DESC],
    );
    for (const [i, [code, names]] of LINES.entries()) {
      await c.query(
        `INSERT INTO public.tb_s080_codes_line
           (line_id, build_id, category, use_tp, code, name, description, sort_order, is_active, is_system, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, true, false, CURRENT_TIMESTAMP)`,
        [`cl_${BUILD_ID}_${CATEGORY}_${code}`, BUILD_ID, CATEGORY, USE_TP, code, names, i + 1],
      );
    }
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 머리 1 · 파티션 1 · 값 ${LINES.length}`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
