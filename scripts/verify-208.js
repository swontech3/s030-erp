/**
 * 208 검증 — 세무(S05) 카드 사용 내역 · 현금 경비 줄 표 둘, 올린 파일의 매입/매출 칸.
 *
 * 사용: node scripts/verify-208.js .env packages/api/.env
 *   ★ 209 를 적용한 뒤 돌린다 — 시험 파일 줄이 209 의 대응표 줄(HOMETAX_BIZ_CARD · TAX_CASH_STD)을 가리킨다.
 *
 * ★ 구조 · 권한은 postgres 로 읽는다(카탈로그). RLS · 고치기는 erp_app 으로 접속해 잰다 — 앱과 같은 길
 *   (verify-203 과 같은 이유 — postgres 는 bypassrls).
 * ★ 시험 행은 erp_app 트랜잭션 안에서 넣고 ROLLBACK 한다. 남는 것이 없다.
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
const U = 'tb_s050_upload_files';
const V = 'tb_s050_vendors';
const CT = 'tb_s050_card_txns';
const XT = 'tb_s050_cash_txns';
const CARD_MAP = 'HOMETAX_BIZ_CARD';
const CASH_MAP = 'TAX_CASH_STD';
const INVOICE_MAP = 'HOMETAX_TAX_INVOICE';
/** 시험용 단체 ID — verify-201 · 203 · 207 과 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;
const hash = (c) => c.repeat(64);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

/** 칸 이름 → [자료형, NULL 허용(YES/NO)] — 승인된 설계(2026-10-30) 그대로. */
const CARD_COLS = {
  id: ['text', 'NO'], org_id: ['integer', 'NO'], file_id: ['text', 'NO'], vendor_id: ['text', 'YES'],
  card_last4: ['character', 'NO'], use_date: ['date', 'NO'],
  merchant_name_src: ['character varying', 'NO'], merchant_biz_no_src: ['character varying', 'YES'],
  supply_amount: ['bigint', 'NO'], tax_amount: ['bigint', 'NO'], nontax_amount: ['bigint', 'NO'], total_amount: ['bigint', 'NO'],
  vat_deduct: ['character varying', 'YES'], deduct_note_src: ['character varying', 'YES'],
  item_code: ['character varying', 'YES'], classified_at: ['timestamp without time zone', 'YES'], classified_by: ['text', 'YES'],
  created_at: ['timestamp without time zone', 'NO'],
};
const CASH_COLS = {
  id: ['text', 'NO'], org_id: ['integer', 'NO'], file_id: ['text', 'NO'], use_date: ['date', 'NO'],
  description: ['character varying', 'NO'], vendor_name_src: ['character varying', 'YES'],
  direction: ['character varying', 'NO'], amount: ['bigint', 'NO'],
  pay_method: ['character varying', 'NO'], proof: ['character varying', 'YES'],
  item_code: ['character varying', 'YES'], classified_at: ['timestamp without time zone', 'YES'], classified_by: ['text', 'YES'],
  created_at: ['timestamp without time zone', 'NO'],
};

async function structure(q) {
  let n = 1;
  for (const [t, want] of [[CT, CARD_COLS], [XT, CASH_COLS]]) {
    const cols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [t]);
    const got = Object.fromEntries(cols.map((c) => [c.column_name, [c.data_type, c.is_nullable]]));
    const diff = [...new Set([...Object.keys(want), ...Object.keys(got)])]
      .filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
    check(`S${n++}`, `${t} — 칸 ${Object.keys(want).length}개 · 자료형 · NULL 허용이 설계 그대로(더하지도 빼지도 않음)`,
      cols.length > 0 && diff.length === 0, diff.map((k) => `${k}: 설계 ${want[k]} / DB ${got[k]}`).join(' · ') || `${cols.length}칸`);
  }

  const rls = await q(`SELECT relname, relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE relname = ANY($1)`, [[CT, XT]]);
  const pol = await q(`SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='erp_org_scope' AND tablename = ANY($1)`, [[CT, XT]]);
  check(`S${n++}`, '★ 두 표 RLS ENABLE + FORCE + erp_org_scope 정책',
    rls.length === 2 && rls.every((r) => r.r && r.f) && pol.length === 2, JSON.stringify({ rls, pol: pol.map((p) => p.tablename) }));

  const fks = await q(`SELECT conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE contype='f' AND conrelid IN ('public.${CT}'::regclass, 'public.${XT}'::regclass) ORDER BY 1, 2`);
  const fk = (t, re) => fks.some((f) => f.t === t && re.test(f.d));
  check(`S${n++}`, '★ FK — 파일은 (org_id, file_id) CASCADE · 카드 거래처는 (org_id, vendor_id) RESTRICT, 단체까지 묶음',
    fk(CT, /\(org_id, file_id\) REFERENCES tb_s050_upload_files\(org_id, id\) ON DELETE CASCADE/) &&
    fk(CT, /\(org_id, vendor_id\) REFERENCES tb_s050_vendors\(org_id, id\) ON DELETE RESTRICT/) &&
    fk(XT, /\(org_id, file_id\) REFERENCES tb_s050_upload_files\(org_id, id\) ON DELETE CASCADE/) &&
    fks.filter((f) => f.t === XT).length === 1 && fks.filter((f) => f.t === CT).length === 2,
    fks.map((f) => `${f.t}.${f.conname}: ${f.d}`).join(' | '));

  const dirCol = (await q(`SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name='direction'`, [U]))[0];
  const dirCk = await q(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
    WHERE conrelid = 'public.${U}'::regclass AND conname = 'ck_s050_upload_files_direction_kind'`);
  check(`S${n++}`, `${U}.direction — 비울 수 있고, 계산서 파일만 채운다(CHECK ck_s050_upload_files_direction_kind)`,
    dirCol?.is_nullable === 'YES' && dirCk.length === 1, JSON.stringify({ dirCol, dirCk }));

  const priv = async (t, cols) => (await q(`SELECT
      has_table_privilege('erp_app', 'public.${t}', 'SELECT') sel,
      has_table_privilege('erp_app', 'public.${t}', 'INSERT') ins,
      has_table_privilege('erp_app', 'public.${t}', 'UPDATE') upd,
      has_table_privilege('erp_app', 'public.${t}', 'DELETE') del,
      ${cols.map((c) => `has_column_privilege('erp_app', 'public.${t}', '${c}', 'UPDATE') "${c}"`).join(', ')}`))[0];
  const pc = await priv(CT, ['item_code', 'classified_at', 'classified_by', 'vendor_id', 'total_amount', 'card_last4', 'use_date']);
  check(`S${n++}`, `★ ${CT} — erp_app 읽기 · 넣기 · 항목 세 칸 + vendor_id 만 고치기 · 지우기 없음`,
    pc.sel && pc.ins && !pc.upd && !pc.del && pc.item_code && pc.classified_at && pc.classified_by && pc.vendor_id &&
    !pc.total_amount && !pc.card_last4 && !pc.use_date, JSON.stringify(pc));
  const px = await priv(XT, ['item_code', 'classified_at', 'classified_by', 'amount', 'direction', 'pay_method']);
  check(`S${n++}`, `★ ${XT} — erp_app 읽기 · 넣기 · 항목 세 칸만 고치기 · 지우기 없음`,
    px.sel && px.ins && !px.upd && !px.del && px.item_code && px.classified_at && px.classified_by &&
    !px.amount && !px.direction && !px.pay_method, JSON.stringify(px));

  const leftover = await q(`SELECT table_name, grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name = ANY($1) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [[CT, XT]]);
  const leftCol = await q(`SELECT table_name, grantee FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name = ANY($1) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [[CT, XT]]);
  check(`S${n++}`, 'check-grants 기준 — 두 표에 anon · authenticated · PUBLIC 권한 0건', leftover.length === 0 && leftCol.length === 0,
    [...leftover, ...leftCol].map((r) => `${r.grantee}:${r.table_name}`).join(','));
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
  const file = (id, org, kind, mapId, direction, h) =>
    tryRun(`INSERT INTO public.${U} (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 30720, 2, 2)`, [id, org, kind, mapId, direction, `${id}.xls`, h]);
  const vendor = (id, org) =>
    tryRun(`INSERT INTO public.${V} (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
      VALUES ($1, $2, '시험 가맹점', '1234567890', 'G', 'CARD', NULL)`, [id, org]);
  const card = (id, org, fileId, vendorId, x = {}) =>
    tryRun(`INSERT INTO public.${CT} (id, org_id, file_id, vendor_id, card_last4, use_date, merchant_name_src, merchant_biz_no_src,
        supply_amount, tax_amount, nontax_amount, total_amount, vat_deduct, deduct_note_src, item_code)
      VALUES ($1, $2, $3, $4, $5, DATE '2026-09-05', '시험 가맹점', $6, $7, $8, 0, $9, $10, $11, $12)`,
    [id, org, fileId, vendorId, x.last4 ?? '1234', x.bizNo === undefined ? '1234567890' : x.bizNo,
      x.supply ?? 10000, x.tax ?? 1000, x.total ?? 11000, x.deduct === undefined ? 'Y' : x.deduct, x.note ?? null, x.item ?? null]);
  const cash = (id, org, fileId, x = {}) =>
    tryRun(`INSERT INTO public.${XT} (id, org_id, file_id, use_date, description, vendor_name_src, direction, amount, pay_method, proof, item_code)
      VALUES ($1, $2, $3, DATE '2026-09-06', $4, $5, $6, $7, $8, $9, $10)`,
    [id, org, fileId, x.desc ?? '시험 품명', x.vendor ?? null, x.dir ?? 'P', x.amount ?? 5000, x.pay ?? 'CASH', x.proof ?? null, x.item ?? null]);
  const idsOf = async (t) => (await q(`SELECT id FROM public.${t} WHERE id LIKE 'v208-%' ORDER BY 1`)).map((r) => r.id).join();
  const classify = (t, id, item) =>
    tryRun(`UPDATE public.${t} SET item_code = $2, classified_at = CURRENT_TIMESTAMP, classified_by = '7' WHERE id = $1`, [id, item]);

  await ec.query('BEGIN');
  try {
    await scope('operator', null);
    const maps = (await q(`SELECT id FROM public.tb_s050_import_maps WHERE id = ANY($1) ORDER BY 1`, [[CARD_MAP, CASH_MAP]])).map((r) => r.id);
    check('R0', `대응표 ${CARD_MAP} · ${CASH_MAP} 가 있다(209 적용 확인)`, maps.length === 2, maps.join(','));
    if (maps.length !== 2) return; // 아래 파일 넣기가 FK 로 전부 실패한다

    // --- 넣기 -----------------------------------------------------------------------
    const ins = [
      await file('v208-fc', ORG_A, 'CARD', CARD_MAP, null, hash('a')),
      await file('v208-fx', ORG_A, 'CASH', CASH_MAP, null, hash('b')),
      await file('v208-fcb', ORG_B, 'CARD', CARD_MAP, null, hash('a')),
      await vendor('v208-va', ORG_A), await vendor('v208-vb', ORG_B),
      await card('v208-c1', ORG_A, 'v208-fc', 'v208-va'),
      await card('v208-c2', ORG_A, 'v208-fc', null, { bizNo: null }),
      await card('v208-c3', ORG_A, 'v208-fc', 'v208-va', { supply: -5000, tax: 0, total: -5000, deduct: 'N', note: '당연불공제' }),
      await card('v208-c4', ORG_A, 'v208-fc', 'v208-va'),
      await card('v208-c5', ORG_A, 'v208-fc', 'v208-va', { deduct: null }),
      await card('v208-cb', ORG_B, 'v208-fcb', 'v208-vb'),
      await cash('v208-x1', ORG_A, 'v208-fx', { vendor: '시험 가게', proof: 'RECEIPT' }),
      await cash('v208-x2', ORG_A, 'v208-fx', { dir: 'S', pay: 'TRANSFER' }),
      await cash('v208-x3', ORG_A, 'v208-fx', { item: 'MEAL' }),
    ];
    check('R1', '운영사 — 카드 · 현금 파일(매입/매출 칸 비움) · 가맹점 거래처(일반) · 카드 줄 · 현금 줄을 넣는다',
      ins.every((r) => r.code === null), ins.map((r) => r.code).join(' '));
    check('R2', '카드 — 가맹점 번호 없는 줄은 거래처 없이 · 취소(음수) 줄 · 같은 열쇠 두 줄(c1 · c4) · 공제 여부 비움(c5) 모두 들어간다',
      ins[6].code === null && ins[7].code === null && ins[8].code === null && ins[9].code === null);
    check('R3', '현금 — 거래처 · 증빙 비움 · 매출 줄 · 파일에서 온 항목(매입) 모두 들어간다',
      ins[11].code === null && ins[12].code === null && ins[13].code === null);

    // --- 올린 파일 매입/매출 칸 --------------------------------------------------------
    const dirBad = [
      { label: '카드 파일에 매입(P)', ...(await file('v208-y1', ORG_A, 'CARD', CARD_MAP, 'P', hash('c'))) },
      { label: '현금 파일에 매출(S)', ...(await file('v208-y2', ORG_A, 'CASH', CASH_MAP, 'S', hash('d'))) },
      { label: '계산서 파일에 비움', ...(await file('v208-y3', ORG_A, 'INVOICE', INVOICE_MAP, null, hash('e'))) },
    ];
    check('R4', '★ 매입/매출 칸 — 계산서 파일만 채우고, 카드 · 현금 파일은 비운다(23514)',
      dirBad.every((r) => r.code === '23514'), dirBad.map((r) => `${r.label}=${r.code}`).join(' '));

    // --- CHECK ----------------------------------------------------------------------
    const bad = [
      { label: '카드번호 16자리', ...(await card('v208-z1', ORG_A, 'v208-fc', 'v208-va', { last4: '1234123412341234' })) },
      { label: '카드번호 3자리', ...(await card('v208-z2', ORG_A, 'v208-fc', 'v208-va', { last4: '123' })) },
      { label: '카드번호 별표', ...(await card('v208-z3', ORG_A, 'v208-fc', 'v208-va', { last4: '12**' })) },
      { label: '가맹점번호 하이픈', ...(await card('v208-z4', ORG_A, 'v208-fc', 'v208-va', { bizNo: '123-45-67890' })) },
      { label: '공제 여부 X', ...(await card('v208-z5', ORG_A, 'v208-fc', 'v208-va', { deduct: 'X' })) },
      { label: '현금 구분 X', ...(await cash('v208-z6', ORG_A, 'v208-fx', { dir: 'X' })) },
      { label: '현금 금액 0', ...(await cash('v208-z7', ORG_A, 'v208-fx', { amount: 0 })) },
      { label: '현금 금액 음수', ...(await cash('v208-z8', ORG_A, 'v208-fx', { amount: -1 })) },
      { label: '현금 품명 빈칸', ...(await cash('v208-z9', ORG_A, 'v208-fx', { desc: '  ' })) },
      { label: '현금 매출 줄에 항목', ...(await cash('v208-z10', ORG_A, 'v208-fx', { dir: 'S', item: 'MEAL' })) },
    ];
    // card_last4 는 char(4) · 가맹점번호는 varchar(10) — 칸보다 긴 값은 길이 오류(22001), 나머지는 CHECK(23514)
    check('R5', '★ CHECK — 카드번호는 숫자 4자리만 · 가맹점번호 숫자 10자리 · 공제 Y/N(비움 허용) · 현금 구분 P/S · 금액 > 0 · 품명 · 매출엔 항목 없음',
      bad.every((r) => r.code === '23514' || (['카드번호 16자리', '가맹점번호 하이픈'].includes(r.label) && r.code === '22001')),
      bad.map((r) => `${r.label}=${r.code}`).join(' '));

    // --- FK -------------------------------------------------------------------------
    const noFile = await card('v208-z11', ORG_A, 'v208-none', 'v208-va');
    const noVendor = await card('v208-z12', ORG_A, 'v208-fc', 'v208-none');
    const noFileCash = await cash('v208-z13', ORG_A, 'v208-none');
    check('R6', '없는 파일 · 없는 거래처를 가리키는 줄 — 거절(23503)',
      noFile.code === '23503' && noVendor.code === '23503' && noFileCash.code === '23503',
      `${noFile.code} ${noVendor.code} ${noFileCash.code}`);

    // --- RLS ------------------------------------------------------------------------
    check('R7', '운영사 — 두 단체의 카드 줄이 보인다(앱이 org_id 를 직접 걸어야 하는 까닭)',
      (await idsOf(CT)) === 'v208-c1,v208-c2,v208-c3,v208-c4,v208-c5,v208-cb', await idsOf(CT));

    await scope('tenant', ORG_A);
    check('R8', '회사 A — 자기 단체 줄만(카드 · 현금)',
      (await idsOf(CT)) === 'v208-c1,v208-c2,v208-c3,v208-c4,v208-c5' && (await idsOf(XT)) === 'v208-x1,v208-x2,v208-x3',
      `${await idsOf(CT)} / ${await idsOf(XT)}`);
    const other = [
      await card('v208-o1', ORG_B, 'v208-fcb', 'v208-vb'),
      await cash('v208-o2', ORG_B, 'v208-fcb'),
    ];
    check('R9', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501, 두 표)', other.every((r) => r.code === '42501'),
      other.map((r) => r.code).join(' '));
    const touchB = [
      await classify(CT, 'v208-cb', 'MEAL'),
      await tryRun(`UPDATE public.${CT} SET vendor_id = 'v208-va' WHERE id = 'v208-cb'`),
    ];
    check('R10', '회사 A — 남의 단체 줄 고치기는 0줄', touchB.every((r) => r.code === null && r.rowCount === 0),
      touchB.map((r) => `${r.code}/${r.rowCount}`).join(' '));
    // FK 검사는 RLS 를 거치지 않는다 — (org_id, id) 로 묶어서 막힌다
    const crossFile = await card('v208-w1', ORG_A, 'v208-fcb', 'v208-va');
    const crossVendor = await card('v208-w2', ORG_A, 'v208-fc', 'v208-vb');
    const crossMove = await tryRun(`UPDATE public.${CT} SET vendor_id = 'v208-vb' WHERE id = 'v208-c1'`);
    const crossCash = await cash('v208-w3', ORG_A, 'v208-fcb');
    check('R11', '★ 회사 A 줄이 회사 B 의 파일 · 거래처 id 를 가리키면 거절(23503) — 넣기 · 거래처 옮기기',
      [crossFile, crossVendor, crossMove, crossCash].every((r) => r.code === '23503'),
      [crossFile, crossVendor, crossMove, crossCash].map((r) => r.code).join(' '));

    // --- 고치기는 항목 세 칸(+ 카드 거래처)만 -------------------------------------------
    const okCard = await classify(CT, 'v208-c1', 'MEAL');
    const okCash = await classify(XT, 'v208-x1', 'SUPPLY');
    check('R12', '★ 회사 A — 카드 · 현금 줄에 항목을 확정한다(세 칸 고치기)',
      okCard.rowCount === 1 && okCash.rowCount === 1, `${okCard.code}/${okCard.rowCount} ${okCash.code}/${okCash.rowCount}`);
    const saleItem = await classify(XT, 'v208-x2', 'MEAL');
    check('R13', '★ 현금 매출 줄에 항목 고치기 — 거절(23514)', saleItem.code === '23514', `code=${saleItem.code}`);
    const deny = [
      await tryRun(`UPDATE public.${CT} SET total_amount = 1 WHERE id = 'v208-c1'`),
      await tryRun(`UPDATE public.${CT} SET card_last4 = '9999' WHERE id = 'v208-c1'`),
      await tryRun(`UPDATE public.${XT} SET amount = 1 WHERE id = 'v208-x1'`),
      await tryRun(`UPDATE public.${XT} SET direction = 'S' WHERE id = 'v208-x1'`),
      await tryRun(`DELETE FROM public.${CT} WHERE id = 'v208-c1'`),
      await tryRun(`DELETE FROM public.${XT} WHERE id = 'v208-x1'`),
    ];
    check('R14', '★ 금액 · 카드번호 · 구분 고치기 · 줄 직접 지우기 — 권한 없음(42501)', deny.every((r) => r.code === '42501'),
      deny.map((r) => r.code).join(' '));

    // --- 거래처 지우기 막기 · 파일 지우기 = 줄 지우기 ------------------------------------
    const delUsed = await tryRun(`DELETE FROM public.${V} WHERE id = 'v208-va'`);
    check('R15', '★ 카드 줄이 가리키는 거래처는 못 지운다(23503)', delUsed.code === '23503', `code=${delUsed.code}`);
    const delFiles = await tryRun(`DELETE FROM public.${U} WHERE id = ANY($1)`, [['v208-fc', 'v208-fx']]);
    check('R16', '★ 회사 A — 파일을 지우면 그 파일의 카드 · 현금 줄이 함께 지워지고 거래처는 남는다',
      delFiles.code === null && delFiles.rowCount === 2 && (await idsOf(CT)) === '' && (await idsOf(XT)) === '' &&
      (await idsOf(V)) === 'v208-va', `${delFiles.code}/${delFiles.rowCount} 카드=${await idsOf(CT)} 현금=${await idsOf(XT)} 거래처=${await idsOf(V)}`);

    await scope('tenant', null);
    check('R17', '단체 ID 없는 회사 세션 — 두 표 0건', (await idsOf(CT)) === '' && (await idsOf(XT)) === '');
  } finally {
    await ec.query('ROLLBACK');
  }

  // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
  await ec.query('BEGIN');
  try {
    await scope('operator', null);
    const left = (await q(`SELECT (SELECT count(*) FROM public.${U} WHERE id LIKE 'v208-%')
      + (SELECT count(*) FROM public.${V} WHERE id LIKE 'v208-%')
      + (SELECT count(*) FROM public.${CT} WHERE id LIKE 'v208-%')
      + (SELECT count(*) FROM public.${XT} WHERE id LIKE 'v208-%') AS n`))[0].n;
    check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', Number(left) === 0, String(left));
  } finally {
    await ec.query('ROLLBACK');
  }
}

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  try { await structure((s, p) => pc.query(s, p).then((r) => r.rows)); } finally { await pc.end(); }

  const erpUrl = apiEnv.ERP_DATABASE_URL || '';
  if (!erpUrl) check('R*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
  else {
    const ec = new Client({ connectionString: erpUrl });
    await ec.connect();
    try { await rowChecks(ec); } finally { await ec.end(); }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
