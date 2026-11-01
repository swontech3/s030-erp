/**
 * 212 검증 — 세무(S05) 은행 거래내역 줄 표 · 올린 파일의 은행 칸 셋 · 대응표의 은행 칸 둘.
 *
 * 사용: node scripts/verify-212.js .env packages/api/.env
 *   ★ 213 을 적용한 뒤 돌린다 — 시험 파일 줄이 213 의 대응표 줄(BANK_004_TXN · BANK_020_XFER)을 가리킨다.
 * 적용 전 시험: node scripts/verify-212.js .env packages/api/.env --dry-run <212.sql> <213.sql>
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
 *   ★ 시험은 표 주인(postgres)으로 잰다 — Supabase 의 postgres 는 슈퍼유저가 아니라 erp_app 으로 SET ROLE 을 못 한다.
 *   게다가 개발 DB 의 postgres 는 BYPASSRLS 라 RLS 도 잴 수 없다 → RLS(R7 · R8 · R9 · R18) · 권한 없음(R14)은 「건너뜀」으로 두고
 *   (S3 · S12 가 카탈로그로 정책 · 권한을 본다), 적용 뒤 보통 실행이 erp_app 접속으로 실제로 잰다.
 *   CHECK · FK · CASCADE · RESTRICT · 덧붙이기 · 비우기는 시험에서도 잰다.
 *
 * ★ 구조 · 권한은 postgres 로 읽는다(카탈로그). RLS · 고치기는 erp_app 으로 잰다 — 앱과 같은 길(verify-208 과 같은 이유).
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다.
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
const M = 'tb_s050_import_maps';
const B = 'tb_s050_bank_txns';
const TXN_MAP = 'BANK_004_TXN';
const XFER_MAP = 'BANK_020_XFER';
/** 시험용 단체 ID — verify-201 · 203 · 207 · 208 과 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;
const ACCT_A = '12345678901234';
const ACCT_W = '1234567890123';
const hash = (c) => c.repeat(64);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
const skip = (id, what, note) => results.push({ 항목: id, 내용: what, 결과: '건너뜀', 비고: note });

/** 칸 이름 → [자료형, NULL 허용(YES/NO)] — 승인된 설계(2026-11-01) 그대로. */
const BANK_COLS = {
  id: ['text', 'NO'], org_id: ['integer', 'NO'], file_id: ['text', 'NO'],
  account_no: ['character varying', 'NO'], bank_code: ['character varying', 'NO'],
  txn_at: ['timestamp without time zone', 'NO'],
  description_src: ['character varying', 'YES'], counterparty_src: ['character varying', 'YES'],
  my_note_src: ['character varying', 'YES'], memo_src: ['character varying', 'YES'],
  in_amount: ['bigint', 'NO'], out_amount: ['bigint', 'NO'], balance: ['bigint', 'NO'],
  xfer_file_id: ['text', 'YES'], xfer_bank_src: ['character varying', 'YES'], xfer_account_last4: ['character', 'YES'],
  xfer_holder_src: ['character varying', 'YES'], xfer_to_memo_src: ['character varying', 'YES'],
  xfer_from_memo_src: ['character varying', 'YES'],
  created_at: ['timestamp without time zone', 'NO'],
};
/** 이체를 덧붙일 때 고치는 칸 — erp_app 이 고칠 수 있는 칸은 이것뿐. */
const XFER_COLS = ['xfer_file_id', 'xfer_bank_src', 'xfer_account_last4', 'xfer_holder_src', 'xfer_to_memo_src', 'xfer_from_memo_src'];

async function structure(q) {
  let n = 1;
  const cols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1`, [B]);
  const got = Object.fromEntries(cols.map((c) => [c.column_name, [c.data_type, c.is_nullable]]));
  const diff = [...new Set([...Object.keys(BANK_COLS), ...Object.keys(got)])]
    .filter((k) => JSON.stringify(BANK_COLS[k]) !== JSON.stringify(got[k]));
  check(`S${n++}`, `${B} — 칸 ${Object.keys(BANK_COLS).length}개 · 자료형 · NULL 허용이 설계 그대로(더하지도 빼지도 않음)`,
    cols.length > 0 && diff.length === 0, diff.map((k) => `${k}: 설계 ${BANK_COLS[k]} / DB ${got[k]}`).join(' · ') || `${cols.length}칸`);
  if (cols.length === 0) return false; // 표가 없다 — 아래 권한 함수가 「없는 표」로 멈춘다

  const cm = await q(`SELECT obj_description('public.${B}'::regclass, 'pg_class') d`).catch(() => [{ d: null }]);
  check(`S${n++}`, '표 설명이 「세무(S05)」로 시작', (cm[0]?.d || '').startsWith('세무(S05)'), (cm[0]?.d || '').slice(0, 20));

  const rls = await q(`SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE relname = $1`, [B]);
  const pol = await q(`SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='erp_org_scope' AND tablename = $1`, [B]);
  check(`S${n++}`, '★ RLS ENABLE + FORCE + erp_org_scope 정책', rls.length === 1 && rls[0].r && rls[0].f && pol.length === 1,
    JSON.stringify({ rls, pol: pol.length }));

  const fks = await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE contype='f' AND conrelid = to_regclass('public.${B}') ORDER BY 1`);
  const fk = (re) => fks.some((f) => re.test(f.d));
  check(`S${n++}`, '★ FK 둘 — 거래내역 파일 (org_id, file_id) CASCADE · 이체 파일 (org_id, xfer_file_id) RESTRICT, 단체까지 묶음',
    fks.length === 2 &&
    fk(/^FOREIGN KEY \(org_id, file_id\) REFERENCES tb_s050_upload_files\(org_id, id\) ON DELETE CASCADE$/) &&
    fk(/^FOREIGN KEY \(org_id, xfer_file_id\) REFERENCES tb_s050_upload_files\(org_id, id\)( ON DELETE RESTRICT)?$/) &&
    !fks.some((f) => /xfer_file_id/.test(f.d) && /CASCADE|SET NULL/.test(f.d)),
    fks.map((f) => `${f.conname}: ${f.d}`).join(' | '));

  const cks = (await q(`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid = to_regclass('public.${B}')`)).map((r) => r.conname);
  const wantCk = ['ck_s050_bank_txns_account_no', 'ck_s050_bank_txns_in_amount', 'ck_s050_bank_txns_out_amount',
    'ck_s050_bank_txns_one_side', 'ck_s050_bank_txns_xfer_last4', 'ck_s050_bank_txns_xfer_all', 'ck_s050_bank_txns_xfer_out'];
  check(`S${n++}`, `CHECK ${wantCk.length}개 이름 그대로`, wantCk.every((c) => cks.includes(c)) && cks.length === wantCk.length, cks.sort().join(','));

  const idx = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1`, [B])).map((r) => r.indexname);
  const wantIx = ['ix_s050_bank_txns_dedup', 'ix_s050_bank_txns_org_date', 'ix_s050_bank_txns_file', 'ix_s050_bank_txns_xfer_file'];
  const uniq = await q(`SELECT 1 FROM pg_index WHERE indrelid = to_regclass('public.${B}') AND indisunique AND NOT indisprimary`);
  check(`S${n++}`, '색인 넷(개수 맞추기 열쇠 · 날짜 · 파일 · 이체 파일) · PK 말고 UNIQUE 없음(개수 맞추기)',
    wantIx.every((i) => idx.includes(i)) && uniq.length === 0, idx.sort().join(','));

  // --- 올린 파일 · 대응표의 은행 칸 ------------------------------------------------------
  const colsOf = async (t) => Object.fromEntries((await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1`, [t])).map((c) => [c.column_name, [c.data_type, c.is_nullable]]));
  const uc = await colsOf(U);
  check(`S${n++}`, `${U} — 은행 칸 셋(bank_file_tp · account_no · bank_code) 비울 수 있는 글자 칸, 칸 17개(214 가 4대보험 칸 둘을 더함)`,
    ['bank_file_tp', 'account_no', 'bank_code'].every((c) => JSON.stringify(uc[c]) === '["character varying","YES"]') &&
    Object.keys(uc).length === 17, Object.keys(uc).join(','));
  const ucks = (await q(`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid = 'public.${U}'::regclass`)).map((r) => r.conname);
  check(`S${n++}`, `${U} — CHECK 「은행 파일만 은행 칸 셋을 채움」 · 파일 종류 TXN/XFER · 계좌번호 숫자 10~14`,
    ['ck_s050_upload_files_bank_kind', 'ck_s050_upload_files_bank_file_tp', 'ck_s050_upload_files_account_no'].every((c) => ucks.includes(c)),
    ucks.sort().join(','));

  const mc = await colsOf(M);
  check(`S${n++}`, `${M} — 은행 칸 둘(bank_code · bank_file_tp) 비울 수 있는 글자 칸, 칸 12개(214 가 4대보험 칸 하나를 더함)`,
    ['bank_code', 'bank_file_tp'].every((c) => JSON.stringify(mc[c]) === '["character varying","YES"]') && Object.keys(mc).length === 12,
    Object.keys(mc).join(','));
  const mcks = (await q(`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid = 'public.${M}'::regclass`)).map((r) => r.conname);
  const mix = await q(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexname='uq_s050_import_maps_bank'`, [M]);
  check(`S${n++}`, `${M} — CHECK 「은행 대응표만 은행 칸 둘을 채움」 · 켜진 은행 대응표는 (은행, 파일 종류)마다 하나(UNIQUE 부분 색인)`,
    ['ck_s050_import_maps_bank_kind', 'ck_s050_import_maps_bank_file_tp'].every((c) => mcks.includes(c)) &&
    mix.length === 1 && /UNIQUE/.test(mix[0].indexdef) && /\(bank_code, bank_file_tp\)/.test(mix[0].indexdef) && /is_active/.test(mix[0].indexdef),
    `${mcks.sort().join(',')} / ${mix[0]?.indexdef ?? '없음'}`);
  const mapRls = (await q(`SELECT relrowsecurity r FROM pg_class WHERE relname = $1`, [M]))[0];
  check(`S${n++}`, `${M} — 그대로 RLS 없음(공용)`, mapRls && !mapRls.r);

  // --- 권한 ---------------------------------------------------------------------------
  const other = ['in_amount', 'out_amount', 'balance', 'txn_at', 'account_no', 'file_id', 'org_id'];
  const pb = (await q(`SELECT
      has_table_privilege('erp_app', 'public.${B}', 'SELECT') sel,
      has_table_privilege('erp_app', 'public.${B}', 'INSERT') ins,
      has_table_privilege('erp_app', 'public.${B}', 'UPDATE') upd,
      has_table_privilege('erp_app', 'public.${B}', 'DELETE') del,
      ${[...XFER_COLS, ...other].map((c) => `has_column_privilege('erp_app', 'public.${B}', '${c}', 'UPDATE') "${c}"`).join(', ')}`))[0];
  check(`S${n++}`, `★ ${B} — erp_app 읽기 · 넣기 · 이체 칸 여섯만 고치기 · 지우기 없음`,
    pb.sel && pb.ins && !pb.upd && !pb.del && XFER_COLS.every((c) => pb[c]) && other.every((c) => !pb[c]), JSON.stringify(pb));

  const leftover = await q(`SELECT grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name = $1 AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [B]);
  const leftCol = await q(`SELECT grantee FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name = $1 AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [B]);
  check(`S${n++}`, 'check-grants 기준 — anon · authenticated · PUBLIC 권한 0건', leftover.length === 0 && leftCol.length === 0,
    [...leftover, ...leftCol].map((r) => r.grantee).join(','));
  return true;
}

/**
 * erp_app 길. `tx.begin()` · `tx.end()` 로 감싼다 — 보통은 BEGIN/ROLLBACK, --dry-run 은 SAVEPOINT(표 주인, `tx.asOwner`).
 */
async function rowChecks(ec, tx) {
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
  const file = (id, org, x = {}) =>
    tryRun(`INSERT INTO public.${U} (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count,
        bank_file_tp, account_no, bank_code)
      VALUES ($1, $2, $3, $4, NULL, $5, $6, 30720, 2, 2, $7, $8, $9)`,
    [id, org, x.kind ?? 'BANK', x.map ?? TXN_MAP, `${id}.xls`, x.hash,
      x.tp === undefined ? 'TXN' : x.tp, x.acct === undefined ? ACCT_A : x.acct, x.bank === undefined ? '004' : x.bank]);
  const txn = (id, org, fileId, x = {}) =>
    tryRun(`INSERT INTO public.${B} (id, org_id, file_id, account_no, bank_code, txn_at, description_src, counterparty_src,
        my_note_src, memo_src, in_amount, out_amount, balance)
      VALUES ($1, $2, $3, $4, '004', TIMESTAMP '2026-09-05 10:00:01', '시험 적요', '시험 상대', $5, NULL, $6, $7, $8)`,
    [id, org, fileId, x.acct ?? ACCT_A, x.myNote ?? null, x.inn ?? 0, x.out ?? 10000, x.bal ?? 50000]);
  const attach = (id, xferFileId, x = {}) =>
    tryRun(`UPDATE public.${B} SET xfer_file_id = $2, xfer_bank_src = $3, xfer_account_last4 = $4, xfer_holder_src = $5,
        xfer_to_memo_src = $6, xfer_from_memo_src = $7 WHERE id = $1`,
    [id, xferFileId, x.bank === undefined ? '시험은행' : x.bank, x.last4 === undefined ? '1234' : x.last4,
      x.holder === undefined ? '시험 받는분' : x.holder, x.toMemo ?? null, x.fromMemo ?? null]);
  const clear = (where) => tryRun(`UPDATE public.${B} SET ${XFER_COLS.map((c) => `${c} = NULL`).join(', ')} WHERE ${where}`);
  const idsOf = async (t) => (await q(`SELECT id FROM public.${t} WHERE id LIKE 'v212-%' ORDER BY 1`)).map((r) => r.id).join();

  await tx.begin();
  try {
    await scope('operator', null);
    const maps = (await q(`SELECT id FROM public.${M} WHERE id = ANY($1) ORDER BY 1`, [[TXN_MAP, XFER_MAP]])).map((r) => r.id);
    check('R0', `대응표 ${TXN_MAP} · ${XFER_MAP} 가 있다(213 적용 확인)`, maps.length === 2, maps.join(','));
    if (maps.length !== 2) return; // 아래 파일 넣기가 FK 로 전부 실패한다

    // --- 넣기 -----------------------------------------------------------------------
    const ins = [
      await file('v212-ft', ORG_A, { hash: hash('a') }),
      await file('v212-fx', ORG_A, { hash: hash('b'), map: XFER_MAP, tp: 'XFER', acct: ACCT_W, bank: '020' }),
      await file('v212-ftb', ORG_B, { hash: hash('a') }),
      await txn('v212-t1', ORG_A, 'v212-ft', { myNote: '시험 표시' }),
      await txn('v212-t2', ORG_A, 'v212-ft', { inn: 20000, out: 0, bal: 70000 }),
      await txn('v212-t3', ORG_A, 'v212-ft'),
      await txn('v212-t4', ORG_A, 'v212-ft', { bal: -5000 }),
      await txn('v212-tb', ORG_B, 'v212-ftb'),
    ];
    check('R1', '운영사 — 은행 거래내역 · 이체 내역 파일(은행 칸 셋) · 출금 · 입금 줄을 넣는다',
      ins.every((r) => r.code === null), ins.map((r) => r.code).join(' '));
    check('R2', '같은 열쇠 두 줄(t1 · t3)도 들어간다(UNIQUE 없음 — 개수 맞추기) · 잔액 음수(마이너스 통장) 줄도 들어간다',
      ins[5].code === null && ins[6].code === null);

    // --- 올린 파일 은행 칸 ------------------------------------------------------------
    const fileBad = [
      { label: '은행 파일에 파일 종류 없음', ...(await file('v212-y1', ORG_A, { hash: hash('c'), tp: null })) },
      { label: '은행 파일에 계좌번호 없음', ...(await file('v212-y2', ORG_A, { hash: hash('d'), acct: null })) },
      { label: '은행 파일에 은행 없음', ...(await file('v212-y3', ORG_A, { hash: hash('e'), bank: null })) },
      { label: '카드 파일에 계좌번호', ...(await file('v212-y4', ORG_A, { hash: hash('f'), kind: 'CARD', map: 'HOMETAX_BIZ_CARD', tp: null, bank: null })) },
      { label: '파일 종류 X', ...(await file('v212-y5', ORG_A, { hash: hash('0'), tp: 'X' })) },
      { label: '계좌번호 하이픈', ...(await file('v212-y6', ORG_A, { hash: hash('1'), acct: '123-456-789012' })) },
      { label: '계좌번호 9자리', ...(await file('v212-y7', ORG_A, { hash: hash('2'), acct: '123456789' })) },
    ];
    check('R3', '★ 올린 파일 — 은행 파일만 은행 칸 셋을 모두 채움 · 파일 종류 TXN/XFER · 계좌번호 숫자 10~14(23514)',
      fileBad.every((r) => r.code === '23514'), fileBad.map((r) => `${r.label}=${r.code}`).join(' '));

    // --- 거래내역 줄 CHECK ------------------------------------------------------------
    const bad = [
      { label: '입금 · 출금 둘 다', ...(await txn('v212-z1', ORG_A, 'v212-ft', { inn: 1, out: 1 })) },
      { label: '입금 · 출금 둘 다 0', ...(await txn('v212-z2', ORG_A, 'v212-ft', { inn: 0, out: 0 })) },
      { label: '출금 음수', ...(await txn('v212-z3', ORG_A, 'v212-ft', { out: -1 })) },
      { label: '입금 음수', ...(await txn('v212-z4', ORG_A, 'v212-ft', { inn: -1, out: 0 })) },
      { label: '계좌번호 하이픈', ...(await txn('v212-z5', ORG_A, 'v212-ft', { acct: '1234-5678-90' })) },
    ];
    check('R4', '★ 거래내역 CHECK — 입금 · 출금 중 한쪽만 0 보다 큼 · 음수 없음 · 계좌번호 숫자 10~14(23514)',
      bad.every((r) => r.code === '23514'), bad.map((r) => `${r.label}=${r.code}`).join(' '));
    const noFile = await txn('v212-z6', ORG_A, 'v212-none');
    check('R5', '없는 파일을 가리키는 줄 — 거절(23503)', noFile.code === '23503', `code=${noFile.code}`);

    // --- RLS ------------------------------------------------------------------------
    check('R6', '운영사 — 두 단체의 은행 줄이 보인다(앱이 org_id 를 직접 걸어야 하는 까닭)',
      (await idsOf(B)) === 'v212-t1,v212-t2,v212-t3,v212-t4,v212-tb', await idsOf(B));
    await scope('tenant', ORG_A);
    // ★ 시험(표 주인 postgres)은 BYPASSRLS 라 RLS 를 잴 수 없다 — R7 · R8 · R9 · R18 은 건너뛰고 적용 뒤 erp_app 으로 잰다.
    //   건너뛸 때는 남의 단체 줄 넣기 · 고치기 문장도 돌리지 않는다(주인이면 정말 들어가 아래 셈이 틀어진다).
    const RLS_NOTE = '시험(표 주인 postgres)은 BYPASSRLS — 적용 뒤 erp_app 으로';
    if (tx.asOwner) {
      skip('R7', '회사 A — 자기 단체 줄만', RLS_NOTE);
      skip('R8', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501)', RLS_NOTE);
      skip('R9', '회사 A — 남의 단체 줄에 덧붙이기는 0줄', RLS_NOTE);
    } else {
      check('R7', '회사 A — 자기 단체 줄만', (await idsOf(B)) === 'v212-t1,v212-t2,v212-t3,v212-t4', await idsOf(B));
      const otherIns = await txn('v212-o1', ORG_B, 'v212-ftb');
      check('R8', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501)', otherIns.code === '42501', `code=${otherIns.code}`);
      const touchB = await attach('v212-tb', 'v212-fx');
      check('R9', '회사 A — 남의 단체 줄에 덧붙이기는 0줄', touchB.code === null && touchB.rowCount === 0, `${touchB.code}/${touchB.rowCount}`);
    }
    const crossFile = await txn('v212-w1', ORG_A, 'v212-ftb');
    check('R10', '★ 회사 A 줄이 회사 B 의 파일 id 를 가리키면 거절(23503)', crossFile.code === '23503', `code=${crossFile.code}`);

    // --- 이체 덧붙이기 ----------------------------------------------------------------
    const ok = await attach('v212-t1', 'v212-fx', { toMemo: '시험 받는 표시', fromMemo: '시험 보낸 표시' });
    const okNoMemo = await attach('v212-t3', 'v212-fx');
    check('R11', '★ 회사 A — 출금 줄에 이체 정보를 덧붙인다(메모 둘은 비워도 됨)', ok.rowCount === 1 && okNoMemo.rowCount === 1,
      `${ok.code}/${ok.rowCount} ${okNoMemo.code}/${okNoMemo.rowCount}`);
    const xBad = [
      { label: '입금 줄에 덧붙임', ...(await attach('v212-t2', 'v212-fx')) },
      { label: '받는 은행 빔', ...(await attach('v212-t4', 'v212-fx', { bank: null })) },
      { label: '받는 계좌 빔', ...(await attach('v212-t4', 'v212-fx', { last4: null })) },
      { label: '예금주 빔', ...(await attach('v212-t4', 'v212-fx', { holder: null })) },
      { label: '파일 없이 정보만', ...(await attach('v212-t4', null)) },
      { label: '파일 없이 메모만', ...(await tryRun(`UPDATE public.${B} SET xfer_to_memo_src = '시험' WHERE id = 'v212-t4'`)) },
      { label: '받는 계좌 끝 4자리에 글자', ...(await attach('v212-t4', 'v212-fx', { last4: '12a4' })) },
      { label: '받는 계좌 5자리', ...(await attach('v212-t4', 'v212-fx', { last4: '12345' })) },
    ];
    check('R12', '★ 이체 CHECK — 출금 줄만 · 파일 · 받는 은행 · 끝 4자리 · 예금주는 모두 차 있음/모두 비어 있음 · 메모는 덧붙인 줄만 · 끝 4자리 숫자(23514, 5자리는 22001)',
      xBad.every((r) => r.code === '23514' || (r.label === '받는 계좌 5자리' && r.code === '22001')),
      xBad.map((r) => `${r.label}=${r.code}`).join(' '));
    const crossXfer = await attach('v212-t4', 'v212-ftb');
    check('R13', '★ 회사 B 의 파일을 이체 파일로 가리키면 거절(23503)', crossXfer.code === '23503', `code=${crossXfer.code}`);
    // ★ 시험(표 주인)은 권한이 다 있어 아래 문장이 정말 고치고 지운다 — 돌리지 않고 건너뛴다(S12 가 카탈로그로 본다)
    if (tx.asOwner) skip('R14', '★ 금액 · 잔액 · 거래일시 · 계좌 고치기 · 줄 직접 지우기 — 권한 없음(42501)', '시험(표 주인)은 권한이 다 있다 — 적용 뒤 erp_app 으로');
    else {
      const deny = [
        await tryRun(`UPDATE public.${B} SET out_amount = 1 WHERE id = 'v212-t1'`),
        await tryRun(`UPDATE public.${B} SET balance = 1 WHERE id = 'v212-t1'`),
        await tryRun(`UPDATE public.${B} SET txn_at = CURRENT_TIMESTAMP WHERE id = 'v212-t1'`),
        await tryRun(`UPDATE public.${B} SET account_no = '99999999999' WHERE id = 'v212-t1'`),
        await tryRun(`DELETE FROM public.${B} WHERE id = 'v212-t1'`),
      ];
      check('R14', '★ 금액 · 잔액 · 거래일시 · 계좌 고치기 · 줄 직접 지우기 — 권한 없음(42501)', deny.every((r) => r.code === '42501'),
        deny.map((r) => r.code).join(' '));
    }

    // --- 파일 지우기 ------------------------------------------------------------------
    const delXferAttached = await tryRun(`DELETE FROM public.${U} WHERE id = 'v212-fx'`);
    check('R15', '★ 덧붙인 줄이 있는 이체 파일은 바로 못 지운다(23503 — 앱이 먼저 비운다)', delXferAttached.code === '23503',
      `code=${delXferAttached.code}`);
    const cleared = await clear(`xfer_file_id = 'v212-fx'`);
    const delXfer = await tryRun(`DELETE FROM public.${U} WHERE id = 'v212-fx'`);
    // 회사 A 줄만 센다 — 보통 실행은 RLS 가, 시험은 이 조건이 가른다(두 길에서 같은 뜻)
    const idsOfA = async () => (await q(`SELECT id FROM public.${B} WHERE id LIKE 'v212-%' AND org_id = $1 ORDER BY 1`, [ORG_A]))
      .map((r) => r.id).join();
    const keep = (await q(`SELECT count(*)::int n FROM public.${B} WHERE id LIKE 'v212-%' AND org_id = $1 AND xfer_file_id IS NULL`, [ORG_A]))[0].n;
    check('R16', '★ 이체 칸을 비운 뒤 이체 파일을 지운다 — 거래내역 줄은 남는다',
      cleared.rowCount === 2 && delXfer.code === null && delXfer.rowCount === 1 && keep === 4,
      `비움 ${cleared.rowCount} · 지움 ${delXfer.code}/${delXfer.rowCount} · 남은 줄 ${keep}`);
    const delTxn = await tryRun(`DELETE FROM public.${U} WHERE id = 'v212-ft'`);
    check('R17', '★ 거래내역 파일을 지우면 그 줄이 함께 지워진다(CASCADE)', delTxn.code === null && (await idsOfA()) === '',
      `${delTxn.code}/${delTxn.rowCount} 남은 줄=${await idsOfA()}`);

    await scope('tenant', null);
    if (tx.asOwner) skip('R18', '단체 ID 없는 회사 세션 — 0건', RLS_NOTE);
    else check('R18', '단체 ID 없는 회사 세션 — 0건', (await idsOf(B)) === '');
  } finally {
    await tx.end();
  }

  await tx.begin();
  try {
    await scope('operator', null);
    const left = (await q(`SELECT (SELECT count(*) FROM public.${U} WHERE id LIKE 'v212-%')
      + (SELECT count(*) FROM public.${B} WHERE id LIKE 'v212-%') AS n`))[0].n;
    check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', Number(left) === 0, String(left));
  } finally {
    await tx.end();
  }
}

/** 마이그레이션 파일을 트랜잭션 안에서 돌릴 수 있게 — 파일 자체의 BEGIN; · COMMIT; 줄만 걷는다(주석 · DO 블록은 그대로). */
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
      if (await structure(pq)) await rowChecks(pc, {
        // ★ Supabase 의 postgres 는 슈퍼유저가 아니고 erp_app 구성원도 아니라 SET ROLE 을 못 한다 — 표 주인(postgres)으로 잰다.
        //   postgres 는 BYPASSRLS · 권한이 다 있어 R7 · R8 · R9 · R14 · R18 은 건너뛴다 — 적용 뒤 보통 실행(erp_app 접속)이 잰다.
        asOwner: true,
        begin: () => pc.query('SAVEPOINT vr'),
        end: () => pc.query('ROLLBACK TO SAVEPOINT vr'),
      });
    } finally {
      await pc.query('ROLLBACK');
    }
    const gone = (await pq(`SELECT to_regclass('public.${B}') t`))[0].t;
    check('Z2', '(시험) ROLLBACK 뒤 새 표가 없다 — DB 는 그대로', gone === null, String(gone));
    await pc.end();
  } else {
    let hasTable = false;
    try { hasTable = await structure(pq); } finally { await pc.end(); }
    const erpUrl = apiEnv.ERP_DATABASE_URL || '';
    if (!hasTable) { /* 표가 없으면 행 검사는 하지 않는다 — S1 실패로 이미 알렸다 */ }
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
