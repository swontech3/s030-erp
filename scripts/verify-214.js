/**
 * 214 검증 — 세무(S05) 국세 · 지방세 납부 줄 · 4대보험 고지 줄 · 대출 거래 줄 표 셋 ·
 *   올린 파일의 4대보험 칸 둘 · 대응표의 4대보험 칸 하나 · 대응표 은행 칸 CHECK(대출에도 은행).
 *
 * 사용: node scripts/verify-214.js .env packages/api/.env
 *   ★ 215 를 적용한 뒤 돌린다 — 시험 파일 줄이 215 의 대응표 줄(HOMETAX_NTAX_PAY · WETAX_LTAX_PAY · SOCIAL_* · BANK_020_LOAN)을 가리킨다.
 * 적용 전 시험: node scripts/verify-214.js .env packages/api/.env --dry-run <214.sql> <215.sql>
 *   postgres 한 접속 · 한 트랜잭션 안에서 파일을 돌리고(파일의 BEGIN; · COMMIT; 줄은 걷음) 검증한 뒤 **늘 ROLLBACK** 한다.
 *   ★ 시험은 표 주인(postgres)으로 잰다 — Supabase 의 postgres 는 erp_app 으로 SET ROLE 을 못 하고 BYPASSRLS 다.
 *   → RLS(R10 · R11 · R15) · 권한 없음(R12)은 「건너뜀」(S 항목이 카탈로그로 정책 · 권한을 본다), 적용 뒤 보통 실행이 erp_app 으로 잰다.
 *   CHECK · UNIQUE · FK · CASCADE 는 시험에서도 잰다. (verify-212 와 같은 방식)
 *
 * ★ 시험 행은 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다. 시험 값은 모두 지어낸 값이다(샘플 값 아님).
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
const P = 'tb_s050_tax_payments';
const S = 'tb_s050_social_ins';
const L = 'tb_s050_loan_txns';
const NEW_TABLES = [P, S, L];
const MAP_NTAX = 'HOMETAX_NTAX_PAY';
const MAP_LTAX = 'WETAX_LTAX_PAY';
const MAP_HI = 'SOCIAL_HI';
const MAP_EI = 'SOCIAL_EI_IA';
const MAP_LOAN = 'BANK_020_LOAN';
/** 시험용 단체 ID — verify-201 · 203 · 208 · 212 와 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;
const hash = (c) => c.repeat(64);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });
const skip = (id, what, note) => results.push({ 항목: id, 내용: what, 결과: '건너뜀', 비고: note });

/** 칸 이름 → [자료형, NULL 허용] — 승인된 설계(2026-11-01 멈춤 1 · 답변) 그대로. */
const COLS = {
  [P]: {
    id: ['text', 'NO'], org_id: ['integer', 'NO'], file_id: ['text', 'NO'], kind: ['character varying', 'NO'],
    pay_date: ['date', 'NO'], tax_item_src: ['character varying', 'NO'], pay_no: ['character varying', 'NO'],
    amount: ['bigint', 'NO'], penalty_amount: ['bigint', 'YES'], belong_month: ['date', 'YES'],
    office_src: ['character varying', 'YES'], pay_method_src: ['character varying', 'YES'],
    created_at: ['timestamp without time zone', 'NO'],
  },
  [S]: {
    id: ['text', 'NO'], org_id: ['integer', 'NO'], file_id: ['text', 'NO'], notice_month: ['date', 'NO'],
    ins_tp: ['character varying', 'NO'], member_name_src: ['character varying', 'NO'], member_no_last4: ['character', 'YES'],
    notice_amount: ['bigint', 'NO'], pay_base: ['bigint', 'YES'],
    created_at: ['timestamp without time zone', 'NO'],
  },
  [L]: {
    id: ['text', 'NO'], org_id: ['integer', 'NO'], file_id: ['text', 'NO'], bank_code: ['character varying', 'NO'],
    loan_no_last4: ['character', 'NO'], txn_date: ['date', 'NO'], txn_tp: ['character varying', 'NO'],
    txn_type_src: ['character varying', 'YES'], principal_amount: ['bigint', 'NO'], interest_amount: ['bigint', 'NO'],
    fee_amount: ['bigint', 'NO'], balance: ['bigint', 'NO'],
    created_at: ['timestamp without time zone', 'NO'],
  },
};
/** 표마다 CHECK 이름 · 색인 이름 · UNIQUE(PK 말고) 개수. */
const CKS = {
  [P]: ['ck_s050_tax_payments_kind', 'ck_s050_tax_payments_tax_item', 'ck_s050_tax_payments_pay_no', 'ck_s050_tax_payments_amount',
    'ck_s050_tax_payments_penalty', 'ck_s050_tax_payments_penalty_kind', 'ck_s050_tax_payments_pay_method_kind',
    'ck_s050_tax_payments_belong_month'],
  [S]: ['ck_s050_social_ins_tp', 'ck_s050_social_ins_name', 'ck_s050_social_ins_last4', 'ck_s050_social_ins_month',
    'ck_s050_social_ins_pay_base'],
  [L]: ['ck_s050_loan_txns_last4', 'ck_s050_loan_txns_tp', 'ck_s050_loan_txns_principal', 'ck_s050_loan_txns_fee',
    'ck_s050_loan_txns_balance', 'ck_s050_loan_txns_some_amount'],
};
const IXS = {
  [P]: ['uq_s050_tax_payments_pay_no', 'ix_s050_tax_payments_org_date', 'ix_s050_tax_payments_file'],
  [S]: ['ix_s050_social_ins_org_month', 'ix_s050_social_ins_file'],
  [L]: ['ix_s050_loan_txns_dedup', 'ix_s050_loan_txns_org_date', 'ix_s050_loan_txns_file'],
};
const UNIQ = { [P]: 1, [S]: 0, [L]: 0 };

async function structure(q) {
  let n = 1;
  for (const t of NEW_TABLES) {
    const cols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [t]);
    const got = Object.fromEntries(cols.map((c) => [c.column_name, [c.data_type, c.is_nullable]]));
    const want = COLS[t];
    const diff = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
    check(`S${n++}`, `${t} — 칸 ${Object.keys(want).length}개 · 자료형 · NULL 허용이 설계 그대로(더하지도 빼지도 않음)`,
      cols.length > 0 && diff.length === 0, diff.map((k) => `${k}: 설계 ${want[k]} / DB ${got[k]}`).join(' · ') || `${cols.length}칸`);
    if (cols.length === 0) return false; // 표가 없다 — 아래가 「없는 표」로 멈춘다

    const cm = await q(`SELECT obj_description('public.${t}'::regclass, 'pg_class') d`);
    check(`S${n++}`, `${t} — 표 설명이 「세무(S05)」로 시작`, (cm[0]?.d || '').startsWith('세무(S05)'), (cm[0]?.d || '').slice(0, 24));

    const rls = await q(`SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE relname = $1`, [t]);
    const pol = await q(`SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='erp_org_scope' AND tablename = $1
      AND qual LIKE '%erp_is_operator()%' AND qual LIKE '%erp_current_org_id()%' AND with_check LIKE '%erp_current_org_id()%'`, [t]);
    check(`S${n++}`, `★ ${t} — RLS ENABLE + FORCE + erp_org_scope(운영사 · 자기 단체) 정책`,
      rls.length === 1 && rls[0].r && rls[0].f && pol.length === 1, JSON.stringify({ rls, pol: pol.length }));

    const fks = await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE contype='f' AND conrelid = to_regclass('public.${t}')`);
    check(`S${n++}`, `★ ${t} — FK 하나: 올린 파일 (org_id, file_id) CASCADE(단체까지 묶음)`,
      fks.length === 1 && /^FOREIGN KEY \(org_id, file_id\) REFERENCES tb_s050_upload_files\(org_id, id\) ON DELETE CASCADE$/.test(fks[0].d),
      fks.map((f) => f.d).join(' | '));

    const cks = (await q(`SELECT conname FROM pg_constraint WHERE contype='c' AND conrelid = to_regclass('public.${t}')`)).map((r) => r.conname);
    check(`S${n++}`, `${t} — CHECK ${CKS[t].length}개 이름 그대로`, CKS[t].every((c) => cks.includes(c)) && cks.length === CKS[t].length,
      cks.sort().join(','));

    const idx = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1`, [t])).map((r) => r.indexname);
    const uniq = await q(`SELECT 1 FROM pg_index WHERE indrelid = to_regclass('public.${t}') AND indisunique AND NOT indisprimary`);
    check(`S${n++}`, `${t} — 색인 ${IXS[t].length}개 · PK 말고 UNIQUE ${UNIQ[t]}개${UNIQ[t] ? '(단체 · 종류 · 납부번호)' : '(없음)'}`,
      IXS[t].every((i) => idx.includes(i)) && uniq.length === UNIQ[t], idx.sort().join(','));

    const pr = (await q(`SELECT
        has_table_privilege('erp_app', 'public.${t}', 'SELECT') sel,
        has_table_privilege('erp_app', 'public.${t}', 'INSERT') ins,
        has_table_privilege('erp_app', 'public.${t}', 'UPDATE') upd,
        has_table_privilege('erp_app', 'public.${t}', 'DELETE') del,
        (SELECT count(*)::int FROM information_schema.column_privileges
          WHERE table_schema='public' AND table_name='${t}' AND grantee='erp_app' AND privilege_type='UPDATE') colupd`))[0];
    check(`S${n++}`, `★ ${t} — erp_app 읽기 · 넣기만(고치기 · 지우기 없음, 칸 고치기도 없음)`,
      pr.sel && pr.ins && !pr.upd && !pr.del && pr.colupd === 0, JSON.stringify(pr));

    const left = await q(`SELECT grantee FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name = $1 AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [t]);
    check(`S${n++}`, `${t} — check-grants 기준 anon · authenticated · PUBLIC 권한 0건`, left.length === 0, left.map((r) => r.grantee).join(','));
  }

  // 특별 확인 — 납부번호 UNIQUE 의 칸, 4대보험 표에 주민번호 · 생년월일 칸 없음
  const uq = await q(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='uq_s050_tax_payments_pay_no'`);
  check(`S${n++}`, `★ ${P} — 납부번호 UNIQUE 는 (org_id, kind, pay_no)`, uq.length === 1 && /\(org_id, kind, pay_no\)/.test(uq[0].indexdef),
    uq[0]?.indexdef ?? '없음');
  const pii = await q(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1) AND column_name ~ '(rrn|resident|jumin|birth|ssn)'`, [NEW_TABLES]);
  check(`S${n++}`, '★ 새 표 셋에 주민번호 · 생년월일 칸이 없다', pii.length === 0, pii.map((r) => `${r.table_name}.${r.column_name}`).join(','));

  // --- 올린 파일 · 대응표 -------------------------------------------------------------
  const colsOf = async (t) => Object.fromEntries((await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1`, [t])).map((c) => [c.column_name, [c.data_type, c.is_nullable]]));
  const uc = await colsOf(U);
  check(`S${n++}`, `${U} — 4대보험 칸 둘(social_ins_tp 글자 · notice_month 날짜, 비울 수 있음), 칸 17개`,
    JSON.stringify(uc.social_ins_tp) === '["character varying","YES"]' && JSON.stringify(uc.notice_month) === '["date","YES"]' &&
    Object.keys(uc).length === 17, Object.keys(uc).join(','));
  const ucks = Object.fromEntries((await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE contype='c' AND conrelid = 'public.${U}'::regclass`)).map((r) => [r.conname, r.d]));
  check(`S${n++}`, `${U} — CHECK 「4대보험 파일만 보험 종류 · 고지 연월을 채움」 · 보험 종류 NP/HI/EI/IA · 고지 연월은 달 첫날 · 은행 CHECK 셋 그대로`,
    ['ck_s050_upload_files_social_kind', 'ck_s050_upload_files_social_ins_tp', 'ck_s050_upload_files_notice_month',
      'ck_s050_upload_files_bank_kind', 'ck_s050_upload_files_bank_file_tp', 'ck_s050_upload_files_account_no'].every((c) => c in ucks),
    Object.keys(ucks).sort().join(','));
  const umi = await q(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexname='uq_s050_upload_files_social_month'`, [U]);
  check(`S${n++}`, `★ ${U} — 같은 단체 · 같은 보험 · 같은 고지 연월 4대보험 파일은 하나(UNIQUE 부분 색인, 결정 11)`,
    umi.length === 1 && /UNIQUE/.test(umi[0].indexdef) && /\(org_id, social_ins_tp, notice_month\)/.test(umi[0].indexdef) &&
    /SOCIAL/.test(umi[0].indexdef), umi[0]?.indexdef ?? '없음');

  const mc = await colsOf(M);
  check(`S${n++}`, `${M} — 4대보험 칸 하나(social_ins_tps 글자 목록, 비울 수 있음), 칸 12개`,
    JSON.stringify(mc.social_ins_tps) === '["ARRAY","YES"]' && Object.keys(mc).length === 12, Object.keys(mc).join(','));
  const mcks = Object.fromEntries((await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE contype='c' AND conrelid = 'public.${M}'::regclass`)).map((r) => [r.conname, r.d]));
  const bk = mcks.ck_s050_import_maps_bank_kind || '';
  check(`S${n++}`, `★ ${M} — 은행 CHECK 가 「파일 종류는 은행만 · 은행 코드는 은행 · 대출만」으로 바뀜`,
    /LOAN/.test(bk) && /bank_file_tp IS NOT NULL/.test(bk) && /bank_code IS NOT NULL/.test(bk), bk);
  check(`S${n++}`, `${M} — CHECK 「4대보험 대응표만 보험 종류 목록을 채움」 · 목록은 NP/HI/EI/IA 안에서 하나 이상`,
    'ck_s050_import_maps_social_kind' in mcks && 'ck_s050_import_maps_social_tps' in mcks, Object.keys(mcks).sort().join(','));
  const mapRls = (await q(`SELECT relrowsecurity r FROM pg_class WHERE relname = $1`, [M]))[0];
  check(`S${n++}`, `${M} — 그대로 RLS 없음(공용)`, mapRls && !mapRls.r);
  return true;
}

/** erp_app 길. `tx.begin()` · `tx.end()` 로 감싼다 — 보통은 BEGIN/ROLLBACK, --dry-run 은 SAVEPOINT(표 주인, `tx.asOwner`). */
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
  /** 올린 파일 — 4대보험만 보험 종류 · 고지 연월. */
  const file = (id, org, kind, map, h, x = {}) =>
    tryRun(`INSERT INTO public.${U} (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count,
        social_ins_tp, notice_month)
      VALUES ($1, $2, $3, $4, NULL, $5, $6, 4096, 2, 2, $7, $8)`,
    [id, org, kind, map, `${id}.xls`, h,
      x.tp === undefined ? (kind === 'SOCIAL' ? 'HI' : null) : x.tp,
      x.month === undefined ? (kind === 'SOCIAL' ? '2026-09-01' : null) : x.month]);
  const pay = (id, org, fileId, x = {}) =>
    tryRun(`INSERT INTO public.${P} (id, org_id, file_id, kind, pay_date, tax_item_src, pay_no, amount, penalty_amount,
        belong_month, office_src, pay_method_src)
      VALUES ($1, $2, $3, $4, DATE '2026-09-10', $5, $6, $7, $8, $9, '시험 관서', $10)`,
    [id, org, fileId, x.kind ?? 'NTAX', x.item === undefined ? '시험세목' : x.item, x.no === undefined ? `${id}-no` : x.no,
      x.amount ?? 10000, x.penalty === undefined ? ((x.kind ?? 'NTAX') === 'NTAX' ? 0 : null) : x.penalty,
      x.belong === undefined ? null : x.belong, x.method === undefined ? null : x.method]);
  const ins = (id, org, fileId, x = {}) =>
    tryRun(`INSERT INTO public.${S} (id, org_id, file_id, notice_month, ins_tp, member_name_src, member_no_last4, notice_amount, pay_base)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, org, fileId, x.month ?? '2026-09-01', x.tp ?? 'HI', x.name === undefined ? '시험 가입자' : x.name,
      x.last4 === undefined ? '1234' : x.last4, x.amount ?? 50000, x.base === undefined ? 1000000 : x.base]);
  const loan = (id, org, fileId, x = {}) =>
    tryRun(`INSERT INTO public.${L} (id, org_id, file_id, bank_code, loan_no_last4, txn_date, txn_tp, txn_type_src,
        principal_amount, interest_amount, fee_amount, balance)
      VALUES ($1, $2, $3, '020', $4, DATE '2026-09-20', $5, '시험 거래', $6, $7, $8, $9)`,
    [id, org, fileId, x.last4 === undefined ? '5678' : x.last4, x.tp ?? 'R', x.principal ?? 0, x.interest ?? 3000,
      x.fee ?? 0, x.balance ?? 1000000]);
  const idsOf = async (t) => (await q(`SELECT id FROM public.${t} WHERE id LIKE 'v214-%' ORDER BY 1`)).map((r) => r.id).join();
  const idsOfOrg = async (t, org) => (await q(`SELECT id FROM public.${t} WHERE id LIKE 'v214-%' AND org_id = $1 ORDER BY 1`, [org]))
    .map((r) => r.id).join();

  await tx.begin();
  try {
    await scope('operator', null);
    const maps = (await q(`SELECT id FROM public.${M} WHERE id = ANY($1) ORDER BY 1`, [[MAP_NTAX, MAP_LTAX, MAP_HI, MAP_EI, MAP_LOAN]])).map((r) => r.id);
    check('R0', '대응표 다섯(국세 · 지방세 · 건강 · 고용·산재 · 대출)이 있다(215 적용 확인)', maps.length === 5, maps.join(','));
    if (maps.length !== 5) return; // 아래 파일 넣기가 FK 로 전부 실패한다

    // --- 넣기 -----------------------------------------------------------------------
    const ok = [
      await file('v214-fn', ORG_A, 'NTAX', MAP_NTAX, hash('a')),
      await file('v214-fl', ORG_A, 'LTAX', MAP_LTAX, hash('b')),
      await file('v214-fs', ORG_A, 'SOCIAL', MAP_HI, hash('c')),
      await file('v214-fe', ORG_A, 'SOCIAL', MAP_EI, hash('d'), { tp: 'EI' }),
      await file('v214-fo', ORG_A, 'LOAN', MAP_LOAN, hash('e')),
      await file('v214-fnb', ORG_B, 'NTAX', MAP_NTAX, hash('a')),
      await file('v214-fsb', ORG_B, 'SOCIAL', MAP_HI, hash('c')),
      await pay('v214-p1', ORG_A, 'v214-fn', { penalty: 500 }),
      await pay('v214-p2', ORG_A, 'v214-fl', { kind: 'LTAX', belong: '2026-08-01', method: '시험 방법' }),
      await ins('v214-s1', ORG_A, 'v214-fs'),
      await ins('v214-s2', ORG_A, 'v214-fs', { tp: 'LTC', amount: 6000 }),
      await ins('v214-s3', ORG_A, 'v214-fe', { tp: 'EI', last4: null }),
      await loan('v214-l1', ORG_A, 'v214-fo'),
      await loan('v214-l2', ORG_A, 'v214-fo', { tp: 'D', principal: 1000000, interest: 0, balance: 1000000 }),
      await pay('v214-pb', ORG_B, 'v214-fnb'),
      await ins('v214-sb', ORG_B, 'v214-fsb'),
    ];
    check('R1', '운영사 — 네 종류 파일(4대보험은 보험 종류 · 고지 연월) · 납부 · 4대보험(건강 · 장기요양 · 고용, 끝 4자리 빈 줄 포함) · 대출(상환 · 실행) 줄을 넣는다',
      ok.every((r) => r.code === null), ok.map((r) => r.code).join(' '));
    const samePayNoOtherOrg = ok[14];
    check('R2', '다른 단체는 같은 납부번호를 넣을 수 있다(UNIQUE 는 단체마다)', samePayNoOtherOrg.code === null, `code=${samePayNoOtherOrg.code}`);

    // --- 납부번호 중복 ----------------------------------------------------------------
    const dupSame = await pay('v214-p3', ORG_A, 'v214-fn', { no: 'v214-p1-no' });
    const dupOtherKind = await pay('v214-p4', ORG_A, 'v214-fl', { kind: 'LTAX', no: 'v214-p1-no' });
    check('R3', '★ 같은 단체 · 같은 종류 · 같은 납부번호는 막힌다(23505) · 국세와 지방세는 따로 센다',
      dupSame.code === '23505' && dupOtherKind.code === null, `같은 종류=${dupSame.code} 다른 종류=${dupOtherKind.code}`);

    // --- 납부 줄 CHECK ---------------------------------------------------------------
    const payBad = [
      { label: '종류 X', ...(await pay('v214-y1', ORG_A, 'v214-fn', { kind: 'X' })) },
      { label: '세목 빔', ...(await pay('v214-y2', ORG_A, 'v214-fn', { item: ' ' })) },
      { label: '납부번호 빔', ...(await pay('v214-y3', ORG_A, 'v214-fn', { no: ' ' })) },
      { label: '금액 0', ...(await pay('v214-y4', ORG_A, 'v214-fn', { amount: 0 })) },
      { label: '가산금 음수', ...(await pay('v214-y5', ORG_A, 'v214-fn', { penalty: -1 })) },
      { label: '가산금 > 금액', ...(await pay('v214-y6', ORG_A, 'v214-fn', { amount: 100, penalty: 101 })) },
      { label: '국세에 가산금 없음', ...(await pay('v214-y7', ORG_A, 'v214-fn', { penalty: null })) },
      { label: '지방세에 가산금', ...(await pay('v214-y8', ORG_A, 'v214-fl', { kind: 'LTAX', penalty: 0 })) },
      { label: '국세에 납부방법', ...(await pay('v214-y9', ORG_A, 'v214-fn', { method: '시험' })) },
      { label: '귀속 연월 15일', ...(await pay('v214-ya', ORG_A, 'v214-fl', { kind: 'LTAX', belong: '2026-08-15' })) },
    ];
    check('R4', '★ 납부 줄 CHECK — 종류 NTAX/LTAX · 세목 · 납부번호 빈칸 없음 · 금액 > 0 · 가산금은 국세만 0 이상 금액 이하 · 납부방법은 지방세만 · 귀속 연월은 달 첫날(23514)',
      payBad.every((r) => r.code === '23514'), payBad.map((r) => `${r.label}=${r.code}`).join(' '));

    // --- 올린 파일 4대보험 칸 ----------------------------------------------------------
    const fileBad = [
      { label: '4대보험에 보험 종류 없음', ...(await file('v214-z1', ORG_A, 'SOCIAL', MAP_HI, hash('1'), { tp: null })) },
      { label: '4대보험에 고지 연월 없음', ...(await file('v214-z2', ORG_A, 'SOCIAL', MAP_HI, hash('2'), { month: null })) },
      { label: '국세에 보험 종류', ...(await file('v214-z3', ORG_A, 'NTAX', MAP_NTAX, hash('3'), { tp: 'HI' })) },
      { label: '대출에 고지 연월', ...(await file('v214-z4', ORG_A, 'LOAN', MAP_LOAN, hash('4'), { month: '2026-09-01' })) },
      { label: '보험 종류 LTC(파일로는 없음)', ...(await file('v214-z5', ORG_A, 'SOCIAL', MAP_HI, hash('5'), { tp: 'LTC', month: '2026-07-01' })) },
      { label: '고지 연월 2일', ...(await file('v214-z6', ORG_A, 'SOCIAL', MAP_HI, hash('6'), { month: '2026-07-02' })) },
    ];
    check('R5', '★ 올린 파일 — 4대보험만 보험 종류 · 고지 연월을 둘 다 채움 · 보험 종류 NP/HI/EI/IA · 고지 연월은 달 첫날(23514)',
      fileBad.every((r) => r.code === '23514'), fileBad.map((r) => `${r.label}=${r.code}`).join(' '));
    const sameMonth = await file('v214-z7', ORG_A, 'SOCIAL', MAP_HI, hash('7'));
    const otherMonth = await file('v214-z8', ORG_A, 'SOCIAL', MAP_HI, hash('8'), { month: '2026-10-01' });
    const otherTp = await file('v214-z9', ORG_A, 'SOCIAL', MAP_EI, hash('9'), { tp: 'IA' });
    check('R6', '★ 같은 단체 · 같은 보험 · 같은 고지 연월 파일은 막힌다(23505) — 다른 달 · 다른 보험(고용 뒤 산재)은 들어간다',
      sameMonth.code === '23505' && otherMonth.code === null && otherTp.code === null,
      `같은 달=${sameMonth.code} 다른 달=${otherMonth.code} 산재=${otherTp.code}`);

    // --- 4대보험 줄 CHECK -------------------------------------------------------------
    const insBad = [
      { label: '보험 종류 X', ...(await ins('v214-x1', ORG_A, 'v214-fs', { tp: 'X' })) },
      { label: '이름 빔', ...(await ins('v214-x2', ORG_A, 'v214-fs', { name: ' ' })) },
      { label: '끝 4자리에 글자', ...(await ins('v214-x3', ORG_A, 'v214-fs', { last4: '12a4' })) },
      { label: '고지 연월 2일', ...(await ins('v214-x4', ORG_A, 'v214-fs', { month: '2026-09-02' })) },
      { label: '보수월액 음수', ...(await ins('v214-x5', ORG_A, 'v214-fs', { base: -1 })) },
    ];
    check('R7', '★ 4대보험 줄 CHECK — 보험 종류 NP/HI/LTC/EI/IA · 이름 빈칸 없음 · 끝 4자리 숫자 · 고지 연월 달 첫날 · 보수월액 0 이상(23514)',
      insBad.every((r) => r.code === '23514'), insBad.map((r) => `${r.label}=${r.code}`).join(' '));
    const fiveDigits = await ins('v214-x6', ORG_A, 'v214-fs', { last4: '12345' });
    check('R8', '4대보험 — 가입자 번호 5자리는 들어가지 않는다(22001 — 끝 4자리 칸)', fiveDigits.code === '22001', `code=${fiveDigits.code}`);

    // --- 대출 줄 CHECK ----------------------------------------------------------------
    const loanBad = [
      { label: '구분 X', ...(await loan('v214-w1', ORG_A, 'v214-fo', { tp: 'X' })) },
      { label: '원금 · 이자 · 수수료 모두 0', ...(await loan('v214-w2', ORG_A, 'v214-fo', { interest: 0 })) },
      { label: '대출번호 끝 4자리에 글자', ...(await loan('v214-w3', ORG_A, 'v214-fo', { last4: 'ab12' })) },
      { label: '원금 음수', ...(await loan('v214-w4', ORG_A, 'v214-fo', { principal: -1 })) },
      { label: '수수료 음수', ...(await loan('v214-w5', ORG_A, 'v214-fo', { fee: -1 })) },
      { label: '잔액 음수', ...(await loan('v214-w6', ORG_A, 'v214-fo', { balance: -1 })) },
    ];
    check('R9', '★ 대출 줄 CHECK — 구분 D/R · 원금 · 이자 · 수수료 중 하나는 있음 · 끝 4자리 숫자 · 원금 · 수수료 · 잔액 0 이상(23514)',
      loanBad.every((r) => r.code === '23514'), loanBad.map((r) => `${r.label}=${r.code}`).join(' '));

    // --- 남의 단체 파일 · RLS ------------------------------------------------------------
    const cross = [
      await pay('v214-c1', ORG_A, 'v214-fnb'),
      await ins('v214-c2', ORG_A, 'v214-fsb'),
      await loan('v214-c3', ORG_A, 'v214-none'),
    ];
    check('R10a', '★ 회사 A 줄이 회사 B 의 파일 · 없는 파일을 가리키면 거절(23503)', cross.every((r) => r.code === '23503'),
      cross.map((r) => r.code).join(' '));

    await scope('tenant', ORG_A);
    const RLS_NOTE = '시험(표 주인 postgres)은 BYPASSRLS — 적용 뒤 erp_app 으로';
    if (tx.asOwner) {
      skip('R10', '회사 A — 자기 단체 줄만 보인다(표 셋)', RLS_NOTE);
      skip('R11', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501, 표 셋)', RLS_NOTE);
      skip('R12', '★ 고치기 · 줄 직접 지우기 — 권한 없음(42501, 표 셋)', '시험(표 주인)은 권한이 다 있다 — 적용 뒤 erp_app 으로');
    } else {
      const seen = [await idsOf(P), await idsOf(S), await idsOf(L)];
      check('R10', '회사 A — 자기 단체 줄만 보인다(표 셋)',
        seen[0] === 'v214-p1,v214-p2,v214-p4' && seen[1] === 'v214-s1,v214-s2,v214-s3' && seen[2] === 'v214-l1,v214-l2', seen.join(' / '));
      const other = [
        await pay('v214-o1', ORG_B, 'v214-fnb', { no: 'v214-o1-no' }),
        await ins('v214-o2', ORG_B, 'v214-fsb'),
        await loan('v214-o3', ORG_B, 'v214-fo'),
      ];
      check('R11', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501, 표 셋)', other.every((r) => r.code === '42501'), other.map((r) => r.code).join(' '));
      const deny = [
        await tryRun(`UPDATE public.${P} SET amount = 1 WHERE id = 'v214-p1'`),
        await tryRun(`UPDATE public.${S} SET notice_amount = 1 WHERE id = 'v214-s1'`),
        await tryRun(`UPDATE public.${L} SET interest_amount = 1 WHERE id = 'v214-l1'`),
        await tryRun(`DELETE FROM public.${P} WHERE id = 'v214-p1'`),
        await tryRun(`DELETE FROM public.${S} WHERE id = 'v214-s1'`),
        await tryRun(`DELETE FROM public.${L} WHERE id = 'v214-l1'`),
      ];
      check('R12', '★ 고치기 · 줄 직접 지우기 — 권한 없음(42501, 표 셋)', deny.every((r) => r.code === '42501'), deny.map((r) => r.code).join(' '));
    }

    // --- 파일 지우기 → 줄도 지워짐 -------------------------------------------------------
    const del = await tryRun(`DELETE FROM public.${U} WHERE id = ANY($1)`, [['v214-fn', 'v214-fl', 'v214-fs', 'v214-fe', 'v214-fo']]);
    const leftA = [await idsOfOrg(P, ORG_A), await idsOfOrg(S, ORG_A), await idsOfOrg(L, ORG_A)];
    check('R13', '★ 파일을 지우면 그 파일의 납부 · 4대보험 · 대출 줄이 함께 지워진다(CASCADE)',
      del.code === null && del.rowCount === 5 && leftA.every((s) => s === ''), `${del.code}/${del.rowCount} 남은 줄=${leftA.join(' / ')}`);
    const again = await file('v214-z10', ORG_A, 'SOCIAL', MAP_HI, hash('f'));
    check('R14', '★ 그 달 파일을 지운 뒤에는 같은 보험 · 같은 고지 연월 파일을 다시 올릴 수 있다', again.code === null, `code=${again.code}`);

    await scope('tenant', null);
    if (tx.asOwner) skip('R15', '단체 ID 없는 회사 세션 — 0건(표 셋)', RLS_NOTE);
    else check('R15', '단체 ID 없는 회사 세션 — 0건(표 셋)', (await idsOf(P)) + (await idsOf(S)) + (await idsOf(L)) === '');
  } finally {
    await tx.end();
  }

  await tx.begin();
  try {
    await scope('operator', null);
    const left = (await q(`SELECT (SELECT count(*) FROM public.${U} WHERE id LIKE 'v214-%')
      + (SELECT count(*) FROM public.${P} WHERE id LIKE 'v214-%') + (SELECT count(*) FROM public.${S} WHERE id LIKE 'v214-%')
      + (SELECT count(*) FROM public.${L} WHERE id LIKE 'v214-%') AS n`))[0].n;
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
        asOwner: true,
        begin: () => pc.query('SAVEPOINT vr'),
        end: () => pc.query('ROLLBACK TO SAVEPOINT vr'),
      });
    } finally {
      await pc.query('ROLLBACK');
    }
    const gone = (await pq(`SELECT to_regclass('public.${P}') a, to_regclass('public.${S}') b, to_regclass('public.${L}') c,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='${U}' AND column_name='notice_month') u`))[0];
    check('Z2', '(시험) ROLLBACK 뒤 새 표 · 새 칸이 없다 — DB 는 그대로', gone.a === null && gone.b === null && gone.c === null && gone.u === 0,
      JSON.stringify(gone));
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
