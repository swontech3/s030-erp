/**
 * 225 검증 — 세무(S05) 은행 거래내역의 이체 받는 계좌번호 전체 칸(2026-11-08 대표 결정).
 *
 *   tb_s050_bank_txns.xfer_account_no varchar(30) NULL · CHECK ck_s050_bank_txns_xfer_account_no
 *     (비었거나 · 숫자 4~30자리 · 덧붙인 줄만 · 끝 4자리 = xfer_account_last4) · erp_app UPDATE (xfer_account_no) 칸 단위
 *
 * 사용: node scripts/verify-225.js .env packages/api/.env
 * 적용 전 시험: node scripts/verify-225.js .env packages/api/.env --dry-run supabase/migrations/225_tax_xfer_account_no.sql
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
 *   ★ 시험은 표 주인(postgres)으로 잰다 — 권한이 다 있어 「키 칸 고치기 막힘」은 건너뛰고, 적용 뒤 보통 실행이 erp_app 으로 잰다.
 *
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다. 시험 값은 모두 지어낸 값이다.
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
const dryAt = process.argv.indexOf('--dry-run');
const dryFiles = dryAt >= 0 ? process.argv.slice(dryAt + 1) : null;

const U = 'tb_s050_upload_files';
const B = 'tb_s050_bank_txns';
const C = 'xfer_account_no';
const CK = 'ck_s050_bank_txns_xfer_account_no';
const TXN_MAP = 'BANK_004_TXN';
const XFER_MAP = 'BANK_020_XFER';
/** 시험용 단체 ID — verify-212 와 같은 대역. */
const ORG_A = 990001;
const ACCT_A = '12345678901234';
const ACCT_W = '1234567890123';
const hash = (c) => c.repeat(64);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
const skip = (id, what, note) => results.push({ 항목: id, 내용: what, 결과: '건너뜀', 비고: note });

async function structure(q) {
  const col = (await q(`SELECT data_type, is_nullable, character_maximum_length n FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [B, C]))[0];
  check('S1', `${B}.${C} — varchar(30) · 비울 수 있음`, col && col.data_type === 'character varying' && col.is_nullable === 'YES' && col.n === 30,
    JSON.stringify(col ?? null));
  if (!col) return false;
  const def = (await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = to_regclass('public.${B}') AND conname = $1`, [CK]))[0]?.d ?? '';
  check('S2', `${CK} — 숫자 4~30 · 덧붙인 줄만 · 끝 4자리 = xfer_account_last4`,
    def.includes('{4,30}') && def.includes('xfer_file_id IS NOT NULL') && def.includes('xfer_account_last4'), def || '없음');
  const pr = (await q(`SELECT has_column_privilege('erp_app', 'public.${B}', '${C}', 'UPDATE') u,
      has_column_privilege('erp_app', 'public.${B}', '${C}', 'SELECT') s,
      has_column_privilege('erp_app', 'public.${B}', 'out_amount', 'UPDATE') amt,
      has_table_privilege('erp_app', 'public.${B}', 'UPDATE') tbl`))[0];
  check('S3', `★ erp_app — ${C} 읽기 · 칸 단위 UPDATE · 표 UPDATE 없음 · 금액 고치기 없음(212 그대로)`, pr.u && pr.s && !pr.tbl && !pr.amt, JSON.stringify(pr));
  const left = await q(`SELECT grantee FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2 AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [B, C]);
  check('S4', 'check-grants 기준 — anon · authenticated · PUBLIC 칸 권한 0건', left.length === 0, left.map((r) => r.grantee).join(','));
  const last4 = (await q(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='xfer_account_last4'`, [B]))[0];
  check('S5', '끝 4자리 칸 xfer_account_last4 는 그대로(다른 화면이 쓴다)', last4?.data_type === 'character', JSON.stringify(last4 ?? null));
  return true;
}

/** erp_app 길. `tx.begin()` · `tx.end()` 로 감싼다 — 보통은 BEGIN/ROLLBACK, --dry-run 은 SAVEPOINT(표 주인, `tx.asOwner`). */
async function rowChecks(ec, tx) {
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
  const file = (id, x) =>
    tryRun(`INSERT INTO public.${U} (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count,
        bank_file_tp, account_no, bank_code)
      VALUES ($1, $2, 'BANK', $3, NULL, $4, $5, 30720, 2, 2, $6, $7, $8)`,
    [id, ORG_A, x.map, `${id}.xls`, x.hash, x.tp, x.acct, x.bank]);
  const txn = (id) =>
    tryRun(`INSERT INTO public.${B} (id, org_id, file_id, account_no, bank_code, txn_at, in_amount, out_amount, balance)
      VALUES ($1, $2, 'v225-ft', $3, '004', TIMESTAMP '2026-09-05 10:00:01', 0, 10000, 50000)`, [id, ORG_A, ACCT_A]);
  const attach = (id, no, last4 = '5678') =>
    tryRun(`UPDATE public.${B} SET xfer_file_id = 'v225-fx', xfer_bank_src = '시험은행', xfer_account_last4 = $2,
        xfer_holder_src = '시험 받는분', ${C} = $3 WHERE id = $1`, [id, last4, no]);
  const clear = (id) => tryRun(`UPDATE public.${B} SET xfer_file_id = NULL, xfer_bank_src = NULL, xfer_account_last4 = NULL,
      xfer_holder_src = NULL, xfer_to_memo_src = NULL, xfer_from_memo_src = NULL, ${C} = NULL WHERE id = $1`, [id]);

  await tx.begin();
  try {
    await ec.query(`SELECT set_config('app.current_role', 'operator', true)`);
    await ec.query(`SELECT set_config('app.current_org_id', '', true)`);
    const prep = [
      await file('v225-ft', { map: TXN_MAP, hash: hash('c'), tp: 'TXN', acct: ACCT_A, bank: '004' }),
      await file('v225-fx', { map: XFER_MAP, hash: hash('d'), tp: 'XFER', acct: ACCT_W, bank: '020' }),
      await txn('v225-t1'), await txn('v225-t2'), await txn('v225-t3'),
    ];
    check('R0', '시험 파일 둘 · 출금 줄 셋을 넣는다', prep.every((r) => r.code === null), prep.map((r) => r.code).join(' '));

    const ok = [await attach('v225-t1', '110123455678'), await attach('v225-t2', null)];
    const got = (await ec.query(`SELECT id, ${C} n, xfer_account_last4 l FROM public.${B} WHERE id IN ('v225-t1', 'v225-t2') ORDER BY id`)).rows;
    check('R1', '★ 덧붙이기 — 전체 번호 + 끝 4자리 함께 · 전체 번호 없이(225 전 줄과 같은 모양)도 된다',
      ok.every((r) => r.code === null && r.rowCount === 1) && got[0]?.n === '110123455678' && got[0]?.l === '5678' && got[1]?.n === null,
      JSON.stringify(got));

    const bad = [
      await attach('v225-t3', '11012345567X'),
      await attach('v225-t3', '123'),
      await attach('v225-t3', '110123451111'),
      await tryRun(`UPDATE public.${B} SET ${C} = '110123455678' WHERE id = 'v225-t3'`),
      await attach('v225-t3', '1'.repeat(27) + '5678'),
    ];
    const max = await attach('v225-t3', '1'.repeat(26) + '5678');
    check('R2', '★ CHECK — 숫자 아님 · 4자리 못 됨 · 끝 4자리 다름 · 덧붙이지 않은 줄(23514) · 31자리(22001) · 30자리는 된다',
      bad.slice(0, 4).every((r) => r.code === '23514') && bad[4].code === '22001' && max.code === null,
      `${bad.map((r) => r.code).join(' ')} / 30자리=${max.code}`);

    const cl = await clear('v225-t1');
    const after = (await ec.query(`SELECT ${C} n FROM public.${B} WHERE id = 'v225-t1'`)).rows[0];
    check('R3', '비우기 — 이체 칸과 함께 전체 번호도 비운다', cl.code === null && after?.n === null, JSON.stringify({ code: cl.code, after }));

    if (tx.asOwner) skip('R4', '★ erp_app — 금액 고치기는 여전히 막힌다(42501)', '시험(표 주인)은 권한이 다 있다 — 적용 뒤 erp_app 으로');
    else {
      const deny = await tryRun(`UPDATE public.${B} SET out_amount = 1 WHERE id = 'v225-t1'`);
      check('R4', '★ erp_app — 금액 고치기는 여전히 막힌다(42501)', deny.code === '42501', String(deny.code));
    }
  } finally {
    await tx.end();
  }

  await tx.begin();
  try {
    await ec.query(`SELECT set_config('app.current_role', 'operator', true)`);
    const left = (await ec.query(`SELECT count(*)::int n FROM public.${B} WHERE id LIKE 'v225-%'`)).rows[0].n;
    check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', left === 0, String(left));
  } finally {
    await tx.end();
  }
}

/** 마이그레이션 파일을 트랜잭션 안에서 돌릴 수 있게 — 파일 자체의 BEGIN; · COMMIT; 줄만 걷는다. */
const bodyOf = (file) => fs.readFileSync(file, 'utf8').replace(/^BEGIN;[ \t]*$/m, '').replace(/^COMMIT;[ \t]*$/m, '');

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  const pq = (s, p) => pc.query(s, p).then((r) => r.rows);
  if (dryFiles) {
    if (dryFiles.length === 0) throw new Error('--dry-run 뒤에 마이그레이션 파일을 적는다');
    await pc.query('BEGIN');
    try {
      for (const f of dryFiles) { await pc.query(bodyOf(f)); console.log(`(시험) 돌림: ${f}`); }
      if (await structure(pq)) {
        await rowChecks(pc, { asOwner: true, begin: () => pc.query('SAVEPOINT vr'), end: () => pc.query('ROLLBACK TO SAVEPOINT vr') });
      }
    } finally {
      await pc.query('ROLLBACK');
    }
    const gone = (await pq(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [B, C]))[0].n;
    check('Z2', '(시험) ROLLBACK 뒤 새 칸이 없다 — DB 는 그대로', gone === 0, String(gone));
    await pc.end();
  } else {
    let has = false;
    try {
      has = await structure(pq);
    } finally {
      await pc.end();
    }
    const erpUrl = apiEnv.ERP_DATABASE_URL || '';
    if (!has) { /* 칸이 없으면 행 검사는 하지 않는다 — S1 실패로 이미 알렸다 */ }
    else if (!erpUrl) check('R*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
    else {
      const ec = new Client({ connectionString: erpUrl });
      await ec.connect();
      try { await rowChecks(ec, { begin: () => ec.query('BEGIN'), end: () => ec.query('ROLLBACK') }); } finally { await ec.end(); }
    }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 === '실패').length;
  const skipped = results.filter((r) => r.결과 === '건너뜀').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length - skipped}건${skipped ? ` · 건너뜀 ${skipped}` : ''})` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
