/**
 * 207 검증 — 세무(S05) 거래 분류: 계산서 표 분류 칸 셋 · 출금 항목 코드(TAX_ITEM_OUT).
 *
 * 사용: node scripts/verify-207.js .env packages/api/.env
 *
 * ★ 구조 · 권한은 postgres 로 읽는다(카탈로그). 코드 · 고치기는 erp_app 으로 접속해 잰다 — 앱과 같은 길
 *   (verify-203 과 같은 이유 — postgres 는 bypassrls).
 * ★ 시험 행은 erp_app 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다.
 * ★★ 항목 목록(코드값 · 이름 · 풀이 · 순서)은 대표가 승인한 표(2026-10-27) 그대로 여기 적어 둔다 —
 *    코드 관리에서 이름을 고치면 C 항목이 실패로 나온다(비고의 실제 값을 보고 판단).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
const fs = require('fs');
const { Client } = require('pg');

const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );

const rootEnv = readEnv(process.argv[2] || '.env');
const apiEnv = readEnv(process.argv[3] || 'packages/api/.env');
const I = 'tb_s050_invoices';
const CAT = 'TAX_ITEM_OUT';
const MAP_ID = 'HOMETAX_TAX_INVOICE';
/** 시험용 단체 ID — verify-201 · 203 과 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;

/** 승인된 항목 표 — [코드값, 이름, 풀이, 순서, 어디에(A 둘 다 · C 법인 · I 개인)]. */
const ITEMS = [
  ['RENT', '사무실 월세', null, 1, 'A'],
  ['TEL', '통신비', null, 2, 'A'],
  ['SUPPLY', '소모품비', '사무용품·작은 비품', 3, 'A'],
  ['MEAL', '식대·회의비', '직원 식사·회의 다과', 4, 'A'],
  ['TRAVEL', '교통·출장비', null, 5, 'A'],
  ['DELIVERY', '택배·운송비', null, 6, 'A'],
  ['AD', '광고비', null, 7, 'A'],
  ['FEE', '수수료', '은행·플랫폼 수수료', 8, 'A'],
  ['OUTSOURCE', '외주 용역비', null, 9, 'A'],
  ['INSURANCE', '보험료', null, 10, 'A'],
  ['REPAIR', '수선비', null, 11, 'A'],
  ['EDU', '교육·도서비', null, 12, 'A'],
  ['UTILITY', '수도광열비', '전기 · 수도 · 가스', 13, 'A'],
  ['VEHICLE', '차량유지비', '주유 · 차량 수리 · 주차', 14, 'A'],
  ['ENTERTAIN', '접대비', '거래처 식사·선물', 15, 'C'],
  ['CONDOLENCE', '거래처 경조사비', null, 15, 'I'],
  ['NONBIZ_TAXPRO', '사업과 무관 — 세무사 판단', '세무사가 처리 방법을 정합니다', 16, 'C'],
  ['NONBIZ_OWNER', '사업과 무관 — 대표 인출', '대표가 개인 용도로 쓴 돈', 16, 'I'],
  ['UNKNOWN', '잘 모름 — 세무사에게 묻기', null, 17, 'A'],
];
const PARTS = [['001', 'C', '법인'], ['002', 'I', '개인 일반과세자']];
const expectedOf = (biz) => ITEMS.filter((i) => i[4] === 'A' || i[4] === biz);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function structure(q) {
  const cols = await q(`SELECT column_name, data_type, is_nullable, character_maximum_length len
    FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2)`,
  [I, ['item_code', 'classified_at', 'classified_by']]);
  const col = (n) => cols.find((c) => c.column_name === n);
  check('S1', `${I} — 분류 칸 셋이 있고 모두 비울 수 있다`,
    cols.length === 3 && cols.every((c) => c.is_nullable === 'YES'), cols.map((c) => `${c.column_name}:${c.data_type}`).join(','));
  check('S2', '칸 모양 — item_code varchar(20) · classified_at timestamp · classified_by text',
    col('item_code')?.data_type === 'character varying' && col('item_code')?.len === 20 &&
    col('classified_at')?.data_type === 'timestamp without time zone' && col('classified_by')?.data_type === 'text',
    JSON.stringify(cols));

  const ck = await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE conrelid = 'public.${I}'::regclass AND conname = 'ck_s050_invoices_item_purchase'`);
  check('S3', 'CHECK ck_s050_invoices_item_purchase — 매출이면 item_code 가 비어 있다',
    ck.length === 1 && /direction/.test(ck[0].d) && /item_code IS NULL/.test(ck[0].d), ck.map((r) => r.d).join());

  const g = (await q(`SELECT
      has_column_privilege('erp_app', 'public.${I}', 'item_code', 'UPDATE') item,
      has_column_privilege('erp_app', 'public.${I}', 'classified_at', 'UPDATE') at,
      has_column_privilege('erp_app', 'public.${I}', 'classified_by', 'UPDATE') by,
      has_column_privilege('erp_app', 'public.${I}', 'vendor_id', 'UPDATE') vendor,
      has_column_privilege('erp_app', 'public.${I}', 'direction', 'UPDATE') dir,
      has_column_privilege('erp_app', 'public.${I}', 'supply_amount', 'UPDATE') amt,
      has_table_privilege('erp_app', 'public.${I}', 'UPDATE') whole,
      has_table_privilege('erp_app', 'public.${I}', 'DELETE') del`))[0];
  check('S4', '★ erp_app — 분류 세 칸 + vendor_id 만 고친다(구분 · 금액 · 표 전체 고치기 · 지우기 없음)',
    g.item && g.at && g.by && g.vendor && !g.dir && !g.amt && !g.whole && !g.del, JSON.stringify(g));

  const leftover = await q(`SELECT grantee, privilege_type FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
  [I, ['item_code', 'classified_at', 'classified_by']]);
  check('S5', 'check-grants 기준 — 새 칸에 anon · authenticated · PUBLIC 권한 0건', leftover.length === 0,
    leftover.map((r) => `${r.grantee}:${r.privilege_type}`).join(','));
}

async function codeChecks(q) {
  const master = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [CAT]);
  check('C1', `분류 ${CAT} — 이름 「출금 항목」`, master.length === 1 && master[0].name === '출금 항목', master.map((m) => m.name).join(','));

  const parts = await q(`SELECT use_tp, name FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1 ORDER BY use_tp`, [CAT]);
  check('C2', '★ 파티션 둘 — 001 법인 · 002 개인 일반과세자(숫자 3자, 고정)',
    parts.map((p) => `${p.use_tp}:${p.name}`).join(',') === PARTS.map(([u, , n]) => `${u}:${n}`).join(','),
    parts.map((p) => `${p.use_tp}:${p.name}`).join(','));

  const lines = await q(`SELECT use_tp, code, name, description, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 ORDER BY use_tp, sort_order, code`, [CAT]);
  let n = 3;
  for (const [useTp, biz, label] of PARTS) {
    const got = lines.filter((l) => l.use_tp === useTp);
    const want = expectedOf(biz);
    const fmt = (code, name, desc, sort) => `${sort}.${code}=${name}${desc ? ' — ' + desc : ''}`;
    check(`C${n++}`, `${useTp} ${label} — 항목 ${want.length}개 · 코드값 · 이름 · 풀이 · 순서가 승인 표 그대로`,
      got.length === want.length &&
      got.every((l, k) => {
        const [code, name, desc, sort] = want[k];
        return l.code === code && l.name === name && (l.description ?? null) === desc && l.sort_order === sort;
      }),
      got.map((l) => fmt(l.code, l.name, l.description, l.sort_order)).join(' / '));
  }
  check(`C${n++}`, '모두 켜짐(is_active)', lines.length > 0 && lines.every((l) => l.is_active));
  check(`C${n++}`, '코드 줄 합계 34', lines.length === 34, String(lines.length));
}

async function rowChecks(ec) {
  const q = (s, p) => ec.query(s, p).then((r) => r.rows);
  const scope = async (role, orgId) => {
    await ec.query(`SELECT set_config('app.current_role', $1, true)`, [role]);
    await ec.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId === null ? '' : String(orgId)]);
  };
  const tryRun = async (sql, params) => {
    await ec.query('SAVEPOINT s');
    try {
      const r = await ec.query(sql, params);
      await ec.query('RELEASE SAVEPOINT s');
      return { code: null, rowCount: r.rowCount };
    } catch (e) {
      await ec.query('ROLLBACK TO SAVEPOINT s');
      return { code: e.code, rowCount: 0 };
    }
  };
  const invoice = (id, dir, approvalNo, itemCode = null) =>
    tryRun(`INSERT INTO public.${I} (id, org_id, file_id, vendor_id, direction, approval_no, write_date,
        partner_name_src, partner_biz_no_src, supply_amount, tax_amount, total_amount, inv_class, inv_type, item_code)
      VALUES ($1, $2, 'v207-f', 'v207-v', $3, $4, DATE '2026-09-05', '시험 거래처', '1234567890', 100000, 10000, 110000, 'TAX', 'GEN', $5)`,
    [id, ORG_A, dir, approvalNo, itemCode]);
  const classify = (id, itemCode) =>
    tryRun(`UPDATE public.${I} SET item_code = $2, classified_at = CURRENT_TIMESTAMP, classified_by = '7' WHERE id = $1`, [id, itemCode]);

  await ec.query('BEGIN');
  try {
    await scope('operator', null);
    const ins = [
      await tryRun(`INSERT INTO public.tb_s050_upload_files (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count)
        VALUES ('v207-f', $1, 'INVOICE', $2, 'P', 'v207.xls', $3, 27136, 2, 2)`, [ORG_A, MAP_ID, '7'.repeat(64)]),
      await tryRun(`INSERT INTO public.tb_s050_vendors (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
        VALUES ('v207-v', $1, '시험 거래처', '1234567890', 'M', 'INVOICE', 'P')`, [ORG_A]),
      await invoice('v207-p', 'P', 'V207-P'),
      await invoice('v207-s', 'S', 'V207-S'),
    ];
    check('R1', '운영사 — 시험 파일 · 거래처 · 매입 · 매출 계산서를 넣는다(항목 없이 = 분류 필요)',
      ins.every((r) => r.code === null), ins.map((r) => r.code).join(' '));
    if (!ins.every((r) => r.code === null)) return;

    const before = (await q(`SELECT item_code, classified_at, classified_by FROM public.${I} WHERE id = 'v207-p'`))[0];
    check('R2', '새 줄의 분류 칸 셋은 비어 있다(기본값 없음)',
      before.item_code === null && before.classified_at === null && before.classified_by === null, JSON.stringify(before));

    await scope('tenant', ORG_A);
    const okP = await classify('v207-p', 'RENT');
    const row = (await q(`SELECT item_code, classified_at IS NOT NULL at, classified_by FROM public.${I} WHERE id = 'v207-p'`))[0];
    check('R3', '★ 회사 A — 자기 매입 계산서에 항목을 확정한다(세 칸 고치기)',
      okP.code === null && okP.rowCount === 1 && row.item_code === 'RENT' && row.at && row.classified_by === '7', JSON.stringify(row));
    const again = await classify('v207-p', 'TEL');
    check('R4', '다시 확정하면 덮는다', again.code === null &&
      (await q(`SELECT item_code FROM public.${I} WHERE id = 'v207-p'`))[0].item_code === 'TEL');

    const sale = await classify('v207-s', 'RENT');
    const saleIns = await invoice('v207-s2', 'S', 'V207-S2', 'RENT');
    check('R5', '★ 매출 계산서에 항목 — 고치기 · 넣기 모두 거절(23514)', sale.code === '23514' && saleIns.code === '23514',
      `고치기 ${sale.code} · 넣기 ${saleIns.code}`);

    const dir = await tryRun(`UPDATE public.${I} SET direction = 'S' WHERE id = 'v207-p'`);
    const amt = await tryRun(`UPDATE public.${I} SET supply_amount = 1 WHERE id = 'v207-p'`);
    check('R6', '★ 분류 칸 말고는 여전히 못 고친다 — 구분 · 금액(42501)', dir.code === '42501' && amt.code === '42501',
      `구분 ${dir.code} · 금액 ${amt.code}`);

    await scope('tenant', ORG_B);
    const other = await classify('v207-p', 'AD');
    check('R7', '★ 회사 B — 회사 A 계산서의 항목 고치기는 0줄', other.code === null && other.rowCount === 0, JSON.stringify(other));
    await scope('tenant', ORG_A);
    check('R8', '회사 B 가 손댄 뒤에도 회사 A 의 항목은 그대로',
      (await q(`SELECT item_code FROM public.${I} WHERE id = 'v207-p'`))[0].item_code === 'TEL');
  } finally {
    await ec.query('ROLLBACK');
  }

  // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
  await ec.query('BEGIN');
  try {
    await scope('operator', null);
    const left = (await q(`SELECT count(*)::int n FROM public.${I} WHERE id LIKE 'v207-%'`))[0].n;
    check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', left === 0, String(left));
  } finally {
    await ec.query('ROLLBACK');
  }
}

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  try { await structure((s, p) => pc.query(s, p).then((r) => r.rows)); } finally { await pc.end(); }

  const erpUrl = apiEnv.ERP_DATABASE_URL || '';
  if (!erpUrl) check('C* · R*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
  else {
    const ec = new Client({ connectionString: erpUrl });
    await ec.connect();
    try {
      await ec.query('BEGIN');
      try {
        await ec.query(`SELECT set_config('app.current_role', 'operator', true)`);
        await codeChecks((s, p) => ec.query(s, p).then((r) => r.rows));
      } finally {
        await ec.query('ROLLBACK');
      }
      await rowChecks(ec);
    } finally {
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
