/**
 * 001~003 적용 검증 — 페이즈 1 지시서 2-1 체크리스트 9항목 + ACL-13 + 교차 스키마.
 * 쓰기 테스트는 전부 트랜잭션 안에서 하고 ROLLBACK 한다. 데이터를 남기지 않는다.
 * 사용: node scripts/verify-001-003.js .env
 */
const fs = require('fs');
const { Client } = require('pg');

const readEnv = (p) => {
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs.readFileSync(p, 'utf8').split(/\r?\n/)
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
};
// 루트 .env = postgres 접속(스크립트용), packages/api/.env = erp_app 접속(Fastify용).
// 2-2 스캐폴딩에서 갈렸으므로 둘 다 읽는다.
const env = { ...readEnv(process.argv[2] || '.env'), ...readEnv('packages/api/.env') };

const c = new Client({
  host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER,
  password: env.DB_PASSWORD, database: env.DB_NAME,
});
const q = (s, p) => c.query(s, p).then(r => r.rows);

const { itemCountGate } = require('./verify-count.js');

/**
 * 기대 항목 수 — 모자라면 **실패**다. 이 장치가 없어서 16항목이 조용히 안 돌던 것이
 * 이 스크립트였다(`verify-count.js` 머리말). ★ **보류도 「돈 것」으로 센다.**
 */
const EXPECTED_ITEMS = 23;

const results = [];
const ok = (id, name, detail) => {
  results.push({ 항목: id, 내용: name, 결과: '통과', 비고: detail || '' });
  console.log(`OK  ${id} ${name}${detail ? ' — ' + detail : ''}`);
};
const ng = (id, name, detail) => {
  results.push({ 항목: id, 내용: name, 결과: '실패', 비고: detail || '' });
  console.log(`NG  ${id} ${name} — ${detail}`);
};
/** 보류 — 시험할 **조건이 갖춰지지 않았다.** 통과도 실패도 아니고, 요약이 따로 센다. */
const hold = (id, name, detail) => {
  results.push({ 항목: id, 내용: name, 결과: '보류', 비고: detail || '' });
  console.log(`--  ${id} ${name} — 보류: ${detail}`);
};

/**
 * 한 항목이 예외로 죽어도 **뒤 항목은 계속 돈다.**
 *
 * =============================================================================
 * ★★★ 2026-09-27 에 넣었다 — 검증이 중간에 죽는 것이 가장 나쁜 실패 방식이다
 * =============================================================================
 * 예약 행 하나가 없어서 이 스크립트가 116행에서 TypeError 로 죽었고, 그 뒤
 * **16항목(V6·V7·V8·V9·A1~A7d·X1·X2)이 조용히 안 돌았다.** 007 이 예약 2행을 지운
 * 뒤로 아무도 RLS·권한 검사 결과를 본 적이 없었는데, 화면에는 「NG 1건」만 보여서
 * 아무도 몰랐다.
 *
 * ★ 그래서 규칙 둘 —
 *   ① 남의 데이터가 **있어야** 도는 검증을 만들지 않는다. 필요한 행은 시험이 직접
 *      만들고 롤백한다(`tryInTx`).
 *   ② 그래도 예외가 나면 그 항목만 실패로 적고 **넘어간다.** 이 함수가 그것이다.
 */
const step = async (id, name, fn) => {
  try {
    await fn();
  } catch (e) {
    ng(id, name, `예외 — ${e.message}`);
  }
};

/** 첫 행이나 `null`. **`[0].컬럼` 으로 바로 꺼내지 않는다** — 빈 표에서 죽는다. */
const firstRow = async (sql, params) => (await q(sql, params))[0] ?? null;

/** 트랜잭션 안에서 실행하고 무조건 롤백. 에러코드를 돌려준다. */
async function tryInTx(sqls) {
  await c.query('BEGIN');
  try {
    for (const s of sqls) await c.query(s);
    await c.query('ROLLBACK');
    return { code: null };
  } catch (e) {
    await c.query('ROLLBACK');
    return { code: e.code, message: e.message };
  }
}

const RLS_TABLES = ['tb_s080_contracts', 'tb_s080_invoices', 'tb_s080_payments',
  'tb_s080_settlements', 'tb_s080_members', 'tb_s080_reservations'];

(async () => {
  await c.connect();
  console.log(`접속: ${(await q('SELECT current_user u'))[0].u}@${env.DB_HOST}:${env.DB_PORT}\n`);
  console.log('===== 2-1 검증 체크리스트 =====');

  // V1 ------------------------------------------------------------------
  const c1 = await q(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tb_s080_companies'
      AND column_name LIKE 'link\\_%' ORDER BY 1`);
  const got1 = c1.map(r => r.column_name);
  const want1 = ['link_linked_at', 'link_linked_by', 'link_s020_org_id'];
  want1.every(x => got1.includes(x))
    ? ok('V1', 'companies 연결 컬럼 3종', got1.join(', '))
    : ng('V1', 'companies 연결 컬럼 3종', `있는 것: ${got1.join(', ')}`);

  // V2 ------------------------------------------------------------------
  const two = await q(`SELECT company_id FROM public.tb_s080_companies ORDER BY company_id LIMIT 2`);
  const r2 = await tryInTx([
    `UPDATE public.tb_s080_companies SET link_s020_org_id=999999 WHERE company_id='${two[0].company_id}'`,
    `UPDATE public.tb_s080_companies SET link_s020_org_id=999999 WHERE company_id='${two[1].company_id}'`,
  ]);
  r2.code === '23505'
    ? ok('V2', '같은 link_s020_org_id 두 번째 → UNIQUE 위반', '23505 unique_violation')
    : ng('V2', '같은 link_s020_org_id 두 번째 → UNIQUE 위반', `기대 23505, 실제 ${r2.code || '성공(막히지 않음)'}`);

  // V3 ------------------------------------------------------------------
  /*
   * ★ 001 이 만든 확장 컬럼은 넷이었지만 `billing_start_date` 는 **022 에서 지웠다.**
   *   001 이후 읽는 코드도 쓰는 코드도 생기지 않았고(11행 전부 NULL), 무상기간을
   *   날짜가 아니라 `free_months`(개월수)로 정했기 때문이다. 그래서 여기서 셋을 본다.
   */
  const c3 = await q(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tb_s080_contracts'
      AND column_name IN ('deposit_return_status','biz_info_snapshot','renewed_from_contract_id')
    ORDER BY 1`);
  c3.length === 3
    ? ok('V3a', 'contracts 확장 3컬럼 (billing_start_date 는 022 에서 삭제)', c3.map(r => r.column_name).join(', '))
    : ng('V3a', 'contracts 확장 3컬럼', `${c3.length}개만 존재`);

  /*
   * ★ 계약이 한 건도 없으면 **보류다.** 예전에는 `oneC[0].contract_id` 로 바로 꺼내서
   *   빈 표에서 스크립트가 죽었다 — 그러면 뒤 항목이 전부 안 돈다(`step` 머리말).
   */
  /** 기준 계약 한 건 — V3b 와 V9 가 같이 쓴다. **없을 수 있다**(빈 개발계). */
  const oneC = await firstRow(`SELECT contract_id FROM public.tb_s080_contracts LIMIT 1`);

  await step('V3b', "deposit_return_status='X' → CHECK 위반", async () => {
    if (!oneC) {
      hold('V3b', "deposit_return_status='X' → CHECK 위반", '계약이 0건 — 고칠 행이 없다');
      return;
    }
    const r3 = await tryInTx([
      `UPDATE public.tb_s080_contracts SET deposit_return_status='X' WHERE contract_id='${oneC.contract_id}'`]);
    r3.code === '23514'
      ? ok('V3b', "deposit_return_status='X' → CHECK 위반", '23514 check_violation')
      : ng('V3b', "deposit_return_status='X' → CHECK 위반", `기대 23514, 실제 ${r3.code || '성공(막히지 않음)'}`);
  });

  // V4 ------------------------------------------------------------------
  const t4 = await q(`SELECT to_regclass('public.tb_s080_contract_status_history') t`);
  const fk4 = await q(`SELECT conname FROM pg_constraint
    WHERE conrelid='public.tb_s080_contract_status_history'::regclass AND contype='f'`);
  /*
   * ★★ `to_status` 는 **어휘 안의 값**이어야 한다. 010 이 CHECK 를 붙였고
   *    (`draft`·`confirmed`·`terminated`·`cancelled`), Postgres 는 CHECK 를 행 삽입
   *    시점에 보고 FK 는 문장 끝 트리거로 본다 — 그래서 예전의 `'A'` 는 **FK 까지 가지도
   *    못하고** 23514(CHECK 위반)로 끝났다. 여기서 보려는 것은 FK 이므로 어휘 안의 값을
   *    쓴다. 어휘 밖 값이 막히는지는 010 머리말의 검증 3번이 따로 적어 두었다.
   */
  const r4 = await tryInTx([`INSERT INTO public.tb_s080_contract_status_history(history_id,contract_id,to_status)
    VALUES ('vtest','no-such-contract','draft')`]);
  (t4[0].t && fk4.length && r4.code === '23503')
    ? ok('V4', 'contract_status_history 존재 + FK 동작', `FK ${fk4.length}건, 없는 계약 INSERT → 23503`)
    : ng('V4', 'contract_status_history 존재 + FK 동작', `테이블=${t4[0].t} FK=${fk4.length} 코드=${r4.code}`);

  // V5 ------------------------------------------------------------------
  const t5 = await q(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tb_s080_auth_session' ORDER BY ordinal_position`);
  t5.length >= 10
    ? ok('V5', 'tb_s080_auth_session 존재', `컬럼 ${t5.length}개`)
    : ng('V5', 'tb_s080_auth_session 존재', `컬럼 ${t5.length}개`);

  /* ── V6 / V7 — 예약 배타 제약 ─────────────────────────────────────────────
     ★★★ **시험이 쓸 행을 시험이 직접 만든다.** 예전에는 기존 예약 한 건을
        `row_to_json` 으로 복제해서 썼는데, 007(시험 데이터 정리)이 그 2행을 지운 뒤로
        `[0]` 이 undefined 가 되어 **스크립트가 여기서 죽었다** — 그리고 뒤 16항목이
        조용히 안 돌았다(`step` 머리말).

     ★ 시설까지 만든다. 남의 회의실을 빌려 쓰면 ① 그 회의실이 없는 환경에서 또 죽고
       ② 실제 예약과 시간이 겹쳐 23P01 이 **엉뚱한 이유로** 나올 수 있다.
       배타 제약은 `facility_id` 단위라, 우리 시설 안에서는 우리 두 행만 다툰다.

     ★ 전부 `tryInTx` 안이라 **롤백된다** — 건물 한 채만 빌리고 아무것도 남기지 않는다. */
  const bldg = await firstRow(`SELECT build_id FROM public.tb_s080_buildings LIMIT 1`);
  /** 예약 탐침용 시설 — 트랜잭션 안에서만 산다. */
  const PROBE_FAC = 'vtest-facility';
  const mkFacility = `INSERT INTO public.tb_s080_facilities
    (facility_id, building_id, name, facility_type, updated_at)
    VALUES ('${PROBE_FAC}', '${bldg?.build_id}', 'vtest 회의실', 'MEETING', now())`;
  const mkRes = (id, status, s, e) => `INSERT INTO public.tb_s080_reservations
    (reservation_id, build_id, facility_id, title, start_at, end_at, status, created_at, updated_at)
    VALUES ('${id}', '${bldg?.build_id}', '${PROBE_FAC}', 'vtest', '${s}', '${e}', '${status}', now(), now())`;

  await step('V6', '겹치는 confirmed 예약 → 배타 제약 위반', async () => {
    if (!bldg) {
      hold('V6', '겹치는 confirmed 예약 → 배타 제약 위반', '건물이 0건 — 예약을 걸 곳이 없다');
      return;
    }
    const r6 = await tryInTx([
      mkFacility,
      mkRes('vtest_a', 'confirmed', '2099-01-01 10:00:00', '2099-01-01 11:00:00'),
      mkRes('vtest_b', 'confirmed', '2099-01-01 10:30:00', '2099-01-01 11:30:00'),
    ]);
    r6.code === '23P01'
      ? ok('V6', '겹치는 confirmed 예약 → 배타 제약 위반', '23P01 exclusion_violation')
      : ng('V6', '겹치는 confirmed 예약 → 배타 제약 위반', `기대 23P01, 실제 ${r6.code || '성공(막히지 않음)'}`);
  });

  await step('V7', 'cancelled와 시간이 겹쳐도 INSERT 성공', async () => {
    if (!bldg) {
      hold('V7', 'cancelled와 시간이 겹쳐도 INSERT 성공', '건물이 0건 — 예약을 걸 곳이 없다');
      return;
    }
    const r7 = await tryInTx([
      mkFacility,
      mkRes('vtest_c', 'confirmed', '2099-02-01 10:00:00', '2099-02-01 11:00:00'),
      mkRes('vtest_d', 'cancelled', '2099-02-01 10:30:00', '2099-02-01 11:30:00'),
    ]);
    r7.code === null
      ? ok('V7', 'cancelled와 시간이 겹쳐도 INSERT 성공', '제약이 confirmed에만 걸림')
      : ng('V7', 'cancelled와 시간이 겹쳐도 INSERT 성공', `실패 ${r7.code} ${r7.message}`);
  });

  /*
   * ★ V7b — 붙는 예약(10~11 · 11~12)은 **겹치지 않는다.** 제약이 `tsrange` 의 기본
   *   경계 `[)` 를 쓰기 때문이고, 회의실을 연달아 빌리는 흔한 경우가 여기 달려 있다.
   *   `[]` 로 바뀌면 조용히 막히기 시작한다 — 그래서 시험으로 박아 둔다.
   */
  await step('V7b', '붙는 예약(10~11 · 11~12)은 막히지 않는다', async () => {
    if (!bldg) {
      hold('V7b', '붙는 예약(10~11 · 11~12)은 막히지 않는다', '건물이 0건 — 예약을 걸 곳이 없다');
      return;
    }
    const r = await tryInTx([
      mkFacility,
      mkRes('vtest_e', 'confirmed', '2099-03-01 10:00:00', '2099-03-01 11:00:00'),
      mkRes('vtest_f', 'confirmed', '2099-03-01 11:00:00', '2099-03-01 12:00:00'),
    ]);
    r.code === null
      ? ok('V7b', '붙는 예약(10~11 · 11~12)은 막히지 않는다', 'tsrange 경계가 [) 다')
      : ng('V7b', '붙는 예약(10~11 · 11~12)은 막히지 않는다', `실패 ${r.code} ${r.message}`);
  });

  // V8 ------------------------------------------------------------------
  await c.query('BEGIN');
  let v8;
  try {
    await c.query('SET LOCAL ROLE anon');
    await c.query('SELECT * FROM public.tb_s080_contracts LIMIT 1');
    v8 = null;
  } catch (e) { v8 = e.code; }
  await c.query('ROLLBACK');
  v8 === '42501'
    ? ok('V8', 'anon 역할로 contracts SELECT → 거부', '42501 insufficient_privilege')
    : ng('V8', 'anon 역할로 contracts SELECT → 거부', `기대 42501, 실제 ${v8 || '성공(조회됨)'}`);

  // V9 — 기존 앱이 쓰는 접속(postgres)으로 데이터 경로 스모크 --------------
  // ★ 계약이 0건이면 스모크할 경로가 없다 — 보류다(실패가 아니다).
  if (!oneC) hold('V9', '기존 앱 데이터 경로 스모크(postgres)', '계약이 0건 — 스모크할 데이터가 없다');
  else try {
    const list = await q(`SELECT ct.contract_id, ct.contract_no, ct.status, ct.start_date, ct.end_date, ct.company_id
      FROM public.tb_s080_contracts ct
      LEFT JOIN public.tb_s080_companies co ON co.company_id = ct.company_id
      LEFT JOIN public.tb_s080_buildings b ON b.build_id = ct.build_id
      ORDER BY ct.created_at DESC LIMIT 20`);
    const detail = await q(`SELECT ct.*,
        (SELECT count(*)::int FROM public.tb_s080_invoices i WHERE i.contract_id=ct.contract_id) inv
      FROM public.tb_s080_contracts ct WHERE ct.contract_id=$1`, [oneC.contract_id]);
    (list.length && detail.length)
      ? ok('V9', '기존 앱 데이터 경로 스모크(postgres)', `목록 ${list.length}건 · 상세 1건(청구 ${detail[0].inv}건)`)
      : ng('V9', '기존 앱 데이터 경로 스모크(postgres)', `목록 ${list.length} 상세 ${detail.length}`);
  } catch (e) {
    ng('V9', '기존 앱 데이터 경로 스모크(postgres)', e.message);
  }

  // ===== ACL-13 =========================================================
  console.log('\n===== ACL-13 (RLS 실동작) =====');

  const a1 = await q(`SELECT c.relname AS "테이블", c.relrowsecurity AS "relrowsecurity",
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) AS "정책수"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY($1) ORDER BY 1`, [RLS_TABLES]);
  console.table(a1);
  const bad1 = a1.filter(r => !r.relrowsecurity || r['정책수'] < 1);
  (a1.length === 6 && bad1.length === 0)
    ? ok('A1', 'RLS ENABLE + 정책 6테이블 개별 확인', '6/6 relrowsecurity=true, 정책 각 1건')
    : ng('A1', 'RLS ENABLE + 정책 6테이블 개별 확인', `문제: ${bad1.map(r => r['테이블']).join(', ') || '테이블 수 ' + a1.length}`);

  // ★ A2~A6 은 반드시 erp_app 으로 "접속"해서 해야 한다.
  //   postgres 는 rolbypassrls=true 라 RLS 를 그냥 통과하므로, postgres 로 재면
  //   행이 다 보이고 "RLS 가 안 걸렸다"고 잘못 판단하게 된다.
  //   SET ROLE 로 대신하는 방법은 이 서버에서 쓸 수 없다 —
  //   GRANT erp_app TO postgres WITH SET TRUE 를 실행하면 백엔드 연결이 끊긴다
  //   (2026-09-06 확인. 서버는 살아 있고 멤버십도 안 바뀐다).
  //   → .env 의 ERP_DATABASE_URL 에 실제 비밀번호가 채워져야 실행된다.
  const erpUrl = env.ERP_DATABASE_URL || '';
  const erpReady = erpUrl && !erpUrl.includes('<PASSWORD>');
  let ec = null;
  if (!erpReady) {
    console.log('\n  ※ A2~A6·X2 건너뜀 — .env 의 ERP_DATABASE_URL 에 erp_app 비밀번호가 아직 없다.');
    console.log('    비밀번호 설정 후 이 스크립트를 다시 실행하면 자동으로 수행된다.');
    results.push({ 항목: 'A2~A6', 내용: 'erp_app 접속 RLS 검사', 결과: '보류', 비고: 'erp_app 비밀번호 미설정' });
  } else {
    ec = new Client({ connectionString: erpUrl });
    await ec.connect();
    const who = (await ec.query('SELECT current_user u')).rows[0].u;
    console.log(`\n  erp_app 접속 확인: current_user=${who}`);
  }
  const eq = (s, p) => ec.query(s, p).then(r => r.rows);

  /**
   * 트랜잭션 스코프 GUC 설정.
   * ★ `SET LOCAL app.current_role = '...'` 은 쓸 수 없다 — current_role 이 예약어라
   *   파서가 거부한다(syntax error). 게다가 SET 은 $1 바인딩도 못 받는다.
   *   set_config(name, value, is_local=true) 가 둘 다 해결한다. Fastify 도 이 형태로 쓴다.
   */
  const setScope = async (role, companyId) => {
    await ec.query(`SELECT set_config('app.current_role', $1, true)`, [role]);
    if (companyId !== undefined) {
      await ec.query(`SELECT set_config('app.current_company_id', $1, true)`, [companyId]);
    }
  };

  // 원본(스코프 없는) 수치는 postgres 로 재고, 비교 대상만 erp_app 으로 잰다
  /*
   * 비교 대상 입주사 — 계약을 가장 많이 든 회사. ★ **없을 수 있다.** 계약이 0건이면
   * A3·A6·A7d 는 보류다(스코프를 잴 기준이 없다). 예전에는 `[0]` 을 그대로 써서
   * 빈 개발계에서 스크립트가 죽었고, 그러면 뒤 항목이 전부 안 돌았다.
   */
  const target = await firstRow(`SELECT company_id, count(*)::int n FROM public.tb_s080_contracts
    WHERE company_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 1`);
  const totalContracts = (await q(`SELECT count(*)::int n FROM public.tb_s080_contracts`))[0].n;
  if (!target) {
    console.log('\n  ※ A3·A6·A7d 보류 — 입주사가 딸린 계약이 0건이라 스코프를 잴 기준이 없다.');
  }

  if (erpReady) {
    // A2 GUC 없이 → 0건 (fail-closed)
    const a2 = [];
    for (const t of RLS_TABLES) {
      a2.push({ 테이블: t, 행수: (await eq(`SELECT count(*)::int n FROM public.${t}`))[0].n });
    }
    console.table(a2);
    a2.every(r => r.행수 === 0)
      ? ok('A2', 'erp_app + GUC 없음 → 전 테이블 0건 (fail-closed)', '6/6 = 0건')
      : ng('A2', 'erp_app + GUC 없음 → 전 테이블 0건', a2.filter(r => r.행수).map(r => `${r.테이블}=${r.행수}`).join(', '));

    // A3 tenant 스코프
    await step('A3', 'erp_app + tenant → 자기 회사만', async () => {
      if (!target) {
        hold('A3', 'erp_app + tenant → 자기 회사만', '입주사가 딸린 계약이 0건');
        return;
      }
      await ec.query('BEGIN');
      let a3, a3other;
      try {
        await setScope('tenant', target.company_id);
        a3 = (await eq(`SELECT count(*)::int n FROM public.tb_s080_contracts`))[0].n;
        a3other = (await eq(`SELECT count(*)::int n FROM public.tb_s080_contracts
          WHERE company_id <> '${target.company_id}'`))[0].n;
      } finally { await ec.query('ROLLBACK'); }
      (a3 === target.n && a3other === 0)
        ? ok('A3', 'erp_app + tenant → 자기 회사만', `${a3}건 (전체 ${totalContracts}건 중), 타사 0건`)
        : ng('A3', 'erp_app + tenant → 자기 회사만', `기대 ${target.n}, 실제 ${a3}, 타사 ${a3other}`);
    });

    // A4 operator 전체
    await ec.query('BEGIN');
    await setScope('operator');
    const a4 = (await eq(`SELECT count(*)::int n FROM public.tb_s080_contracts`))[0].n;
    await ec.query('ROLLBACK');
    a4 === totalContracts
      ? ok('A4', 'erp_app + operator → 전체', `${a4}건 = 전체 ${totalContracts}건`)
      : ng('A4', 'erp_app + operator → 전체', `기대 ${totalContracts}, 실제 ${a4}`);

    // A5 RLS 비대상 테이블은 정상 조회
    const a5 = (await eq(`SELECT count(*)::int n FROM public.tb_s080_spaces`))[0].n;
    a5 > 0
      ? ok('A5', 'RLS 비대상 테이블(spaces)은 erp_app이 정상 조회', `${a5}건`)
      : ng('A5', 'RLS 비대상 테이블(spaces)은 erp_app이 정상 조회', `${a5}건`);

    // A6 WITH CHECK — 남의 회사로 바꿔치기 시도
    await step('A6', 'tenant 가 남의 company_id 로 UPDATE → WITH CHECK 위반', async () => {
      if (!target) {
        hold('A6', 'tenant 가 남의 company_id 로 UPDATE → WITH CHECK 위반', '입주사가 딸린 계약이 0건');
        return;
      }
      await ec.query('BEGIN');
      let a6;
      try {
        await setScope('tenant', target.company_id);
        await ec.query(`UPDATE public.tb_s080_contracts SET company_id='남의회사'
          WHERE company_id='${target.company_id}'`);
        a6 = null;
      } catch (e) { a6 = e.code; }
      await ec.query('ROLLBACK');
      a6 === '42501'
        ? ok('A6', 'tenant 가 남의 company_id 로 UPDATE → WITH CHECK 위반', '42501')
        : ng('A6', 'tenant 가 남의 company_id 로 UPDATE → WITH CHECK 위반', `기대 42501, 실제 ${a6 || '성공(막히지 않음)'}`);
    });

    // ---- A7. erp_app 으로 INSERT 가 실제로 되는가 -------------------------
    // 테이블 GRANT 와 시퀀스 GRANT 는 별개다. 시퀀스 USAGE 가 없으면
    // SELECT 는 다 되고 INSERT 만 막혀서, 세션 행을 만드는 2-8 에서야 터진다.
    const seqs = await q(`SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY 1`);
    const seqPriv = [];
    for (const s of seqs) {
      seqPriv.push({
        시퀀스: s.sequencename,
        USAGE: (await q(`SELECT has_sequence_privilege('erp_app',$1,'USAGE') u`, [`public."${s.sequencename}"`]))[0].u,
        SELECT: (await q(`SELECT has_sequence_privilege('erp_app',$1,'SELECT') u`, [`public."${s.sequencename}"`]))[0].u,
      });
    }
    console.table(seqPriv);
    seqPriv.length && seqPriv.every(s => s.USAGE)
      ? ok('A7a', 'erp_app 시퀀스 USAGE 권한', `${seqPriv.length}개 전부 USAGE 있음`)
      : ng('A7a', 'erp_app 시퀀스 USAGE 권한', seqPriv.filter(s => !s.USAGE).map(s => s.시퀀스).join(', ') || '시퀀스 없음');

    // A7b — nextval 을 쓰는 테이블에 실제 INSERT (RLS 비대상)
    await ec.query('BEGIN');
    let a7b, a7bId = null;
    try {
      const r = await ec.query(`INSERT INTO public.tb_s080_tenant010(name, slug, updated_at)
        VALUES ('vtest-운영사','vtest-slug-'||floor(random()*1e9)::text, now()) RETURNING operator_id`);
      a7bId = r.rows[0].operator_id; a7b = null;
    } catch (e) { a7b = e.code; }
    await ec.query('ROLLBACK');
    a7b === null
      // ★ 컬럼명은 019 에서 tenant_id → operator_id 로 바뀌었다. PK 자체는 그대로다.
      ? ok('A7b', 'nextval 쓰는 테이블 INSERT (tenant010)', `operator_id=${a7bId} 발급됨 → 시퀀스 권한 정상`)
      : ng('A7b', 'nextval 쓰는 테이블 INSERT (tenant010)', `${a7b} — 시퀀스 GRANT 확인 필요`);

    // A7c — 2-8 이 실제로 쓸 경로: 세션 행 INSERT
    await ec.query('BEGIN');
    let a7c;
    try {
      await ec.query(`INSERT INTO public.tb_s080_auth_session
        (erp_sid, bbiyong_member_id, org_tp, org_id, bbiyong_access_encrypted, bbiyong_refresh_encrypted, expires_at)
        VALUES ('vtest-sid-hash', 1, 'S', 1, 'enc-a', 'enc-r', now() + interval '7 days')`);
      a7c = null;
    } catch (e) { a7c = e.code; }
    await ec.query('ROLLBACK');
    a7c === null
      ? ok('A7c', '세션 행 INSERT (tb_s080_auth_session)', '2-8 이 쓸 경로 통과')
      : ng('A7c', '세션 행 INSERT (tb_s080_auth_session)', a7c);

    /* A7d — RLS 대상 테이블 INSERT: 자기 회사는 되고 남의 회사는 막히는가
       ★★ 여기도 **기존 예약 행을 빌려 쓰지 않는다**(V6/V7 과 같은 이유 — 007 이 지운
          뒤로 죽는다). 건물은 빌리고 시설은 만들고, 전부 롤백한다.
       ★ 시설을 만드는 것은 `erp_app` 접속이다 — facilities 는 RLS 대상이 아니라 들어간다.
       ★ 시간대를 서로 다르게 준다 — 같은 시간이면 EXCLUDE(23P01)가 먼저 걸려
         RLS 의 WITH CHECK 를 시험하지 못한다. */
    await step('A7d', 'RLS 테이블 INSERT — 자기 회사 성공 / 남의 회사 차단', async () => {
      if (!target || !bldg) {
        hold('A7d', 'RLS 테이블 INSERT — 자기 회사 성공 / 남의 회사 차단',
             !target ? '입주사가 딸린 계약이 0건' : '건물이 0건');
        return;
      }
      const facId = `vtest-fac-${Math.random().toString(36).slice(2, 8)}`;
      const insRes = (companyId, day) => `INSERT INTO public.tb_s080_reservations
        (reservation_id, build_id, facility_id, company_id, title, start_at, end_at, status, updated_at)
        VALUES ('vtest-res-${Math.random().toString(36).slice(2, 8)}', '${bldg.build_id}', '${facId}',
                '${companyId}', 'vtest', '2098-03-${day} 10:00', '2098-03-${day} 11:00', 'confirmed', now())`;
      await ec.query('BEGIN');
      let a7dOwn, a7dOther;
      try {
        await ec.query(`INSERT INTO public.tb_s080_facilities
          (facility_id, building_id, name, facility_type, updated_at)
          VALUES ('${facId}', '${bldg.build_id}', 'vtest 회의실', 'MEETING', now())`);
        await setScope('tenant', target.company_id);
        try { await ec.query(insRes(target.company_id, '01')); a7dOwn = null; } catch (e) { a7dOwn = e.code; }
        try { await ec.query(insRes('남의회사', '02')); a7dOther = null; } catch (e) { a7dOther = e.code; }
      } finally { await ec.query('ROLLBACK'); }
      (a7dOwn === null && a7dOther === '42501')
        ? ok('A7d', 'RLS 테이블 INSERT — 자기 회사 성공 / 남의 회사 차단', '42501 (WITH CHECK)')
        : ng('A7d', 'RLS 테이블 INSERT — 자기 회사 성공 / 남의 회사 차단',
             `자기회사=${a7dOwn || '성공'} 남의회사=${a7dOther || '★성공(막히지 않음)'}`);
    });
  }

  // ===== 교차 스키마 =====================================================
  console.log('\n===== 교차 스키마 — erp_app이 삐용·메일 스키마에 접근 가능한가 =====');
  const xs = [];
  for (const sch of ['tb_s020_t001', 'tb_s090_t001', 'auth', 'storage']) {
    const usage = (await q(`SELECT has_schema_privilege('erp_app',$1,'USAGE') u`, [sch]))[0].u;
    const tbls = await q(`SELECT tablename FROM pg_tables WHERE schemaname=$1`, [sch]);
    let selectable = 0;
    for (const t of tbls) {
      const r = (await q(`SELECT has_table_privilege('erp_app', $1, 'SELECT') p`, [`"${sch}"."${t.tablename}"`]))[0].p;
      if (r) selectable++;
    }
    xs.push({ 스키마: sch, USAGE: usage, 테이블수: tbls.length, SELECT가능: selectable });
  }
  console.table(xs);
  const leaky = xs.filter(x => x.USAGE || x.SELECT가능 > 0);
  leaky.length === 0
    ? ok('X1', 'erp_app은 삐용·메일·auth·storage 스키마에 권한 없음', '물리적으로 막혀 있음')
    : ng('X1', 'erp_app 교차 스키마 권한 있음', leaky.map(x => `${x.스키마}(USAGE=${x.USAGE}, SELECT=${x.SELECT가능})`).join(' / '));

  // X2 — 실제로 찔러본다 (권한 계산과 실제가 다를 수 있으므로). erp_app 접속 필요.
  if (erpReady) {
    const probes = [];
    for (const sch of ['tb_s020_t001', 'tb_s090_t001']) {
      const t = (await q(`SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY 1 LIMIT 1`, [sch]))[0];
      if (!t) continue;
      let code = null;
      try { await ec.query(`SELECT count(*) FROM "${sch}"."${t.tablename}"`); } catch (e) { code = e.code; }
      probes.push({ 대상: `${sch}.${t.tablename}`, 결과: code === '42501' ? '거부(42501)' : code ? `에러 ${code}` : '조회됨' });
    }
    console.table(probes);
    probes.every(p => p.결과.startsWith('거부'))
      ? ok('X2', 'erp_app 실제 조회 시도 → 전부 거부', probes.map(p => p.대상).join(', '))
      : ng('X2', 'erp_app 실제 조회 시도', probes.map(p => `${p.대상}=${p.결과}`).join(' / '));
  }

  if (ec) await ec.end();

  console.log('\n===== 요약 =====');
  console.table(results);
  const fails = results.filter(r => r.결과 === '실패');
  const held = results.filter(r => r.결과 === '보류');
  console.log(`통과 ${results.length - fails.length - held.length}건 · 보류 ${held.length}건 · 실패 ${fails.length}건 (총 ${results.length}건)`);
  // ★ 보류는 **돈 것**이다 — 안 돈 것과 구분해야 한다(`verify-count.js` 머리말).
  // ★ 항목이 사라졌는지 본다 — 통과·실패만 세면 **덜 돈 것**을 알 수 없다.
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: results.length, script: 'verify-001-003.js' });
  await c.end();
  process.exit(fails.length || short ? 1 : 0);
})().catch(async e => {
  console.error('VERIFY ERROR:', e.message);
  console.error(e.stack);
  try { await c.end(); } catch {}
  process.exit(2);
});
