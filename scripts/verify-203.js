/**
 * 203 검증 — 세무(S05) 자료 올리기 · 거래처 표 넷
 *   (tb_s050_upload_files · tb_s050_vendors · tb_s050_invoices · tb_s050_import_maps).
 *
 * 사용: node scripts/verify-203.js .env packages/api/.env
 *
 * ★ 204 를 적용한 뒤 돌린다 — 시험 파일 줄이 204 의 대응표 줄(HOMETAX_TAX_INVOICE)을 가리킨다.
 *   erp_app 은 대응표에 넣을 권한이 없어(읽기만) 시험용 대응표를 따로 만들 수 없다.
 * ★★ RLS 는 erp_app 으로 접속해서만 잰다(verify-201 과 같은 이유 — postgres 는 bypassrls).
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
const M = 'tb_s050_import_maps';
const U = 'tb_s050_upload_files';
const V = 'tb_s050_vendors';
const I = 'tb_s050_invoices';
const ORG_TABLES = [U, V, I];
const MAP_ID = 'HOMETAX_TAX_INVOICE';
/** 시험용 단체 ID — verify-201 과 같은 대역. */
const ORG_A = 990001;
const ORG_B = 990002;
const hash = (ch) => ch.repeat(64);

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function structure(q) {
  const colsOf = async (t) =>
    (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).map((r) => r.column_name);
  const want = {
    [M]: ['id', 'kind', 'name', 'header_row', 'header_signature', 'columns', 'is_active', 'created_at', 'updated_at'],
    [U]: ['id', 'org_id', 'kind', 'map_id', 'direction', 'file_name', 'file_hash', 'file_size', 'row_count',
      'inserted_count', 'uploaded_at', 'uploaded_by'],
    [V]: ['id', 'org_id', 'name', 'biz_no', 'vendor_tp', 'tp_set_by_user', 'first_kind', 'first_direction',
      'created_at', 'updated_at', 'created_by', 'updated_by'],
    [I]: ['id', 'org_id', 'file_id', 'vendor_id', 'direction', 'approval_no', 'write_date', 'partner_name_src',
      'partner_biz_no_src', 'supply_amount', 'tax_amount', 'total_amount', 'inv_class', 'inv_type', 'created_at'],
  };
  let n = 1;
  for (const [t, cols] of Object.entries(want)) {
    const got = await colsOf(t);
    check(`S${n++}`, `${t} 칸 ${cols.length}개`, cols.every((c) => got.includes(c)) && got.length === cols.length, got.join(','));
  }

  const uploadCols = await colsOf(U);
  check(`S${n++}`, '★ 원본 파일을 담는 칸이 없다(지문만)', !uploadCols.some((c) => /storage|path|bytes|content|blob/i.test(c)),
    uploadCols.join(','));

  const cm = await q(`SELECT c.relname, obj_description(c.oid, 'pg_class') d FROM pg_class c
    WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`, [[M, U, V, I]]);
  check(`S${n++}`, '표 설명이 「세무(S05)」로 시작', cm.length === 4 && cm.every((r) => (r.d || '').startsWith('세무(S05)')),
    cm.map((r) => `${r.relname}=${(r.d || '').slice(0, 12)}`).join(' '));

  const colList = (rel, keys) => `(SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(${keys}) WITH ORDINALITY k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = ${rel} AND a.attnum = k.attnum)`;

  // UNIQUE — (org_id, file_hash) · (org_id, approval_no) + FK 가 단체까지 묶어 가리키는 (org_id, id) 둘.
  // 거래처 사업자번호에는 없다(결정 8)
  const uniq = await q(`SELECT conrelid::regclass::text t, ${colList('c.conrelid', 'c.conkey')} cols
    FROM pg_constraint c WHERE contype = 'u' AND conrelid = ANY($1::regclass[])`, [[`public.${U}`, `public.${V}`, `public.${I}`]]);
  const uq = uniq.map((r) => `${r.t.replace('public.', '')}(${r.cols})`).sort();
  check(`S${n++}`, 'UNIQUE 넷 — 파일 (org_id, file_hash) · (org_id, id) / 계산서 (org_id, approval_no) / 거래처 (org_id, id)',
    uq.join(' ') === `${I}(org_id,approval_no) ${U}(org_id,file_hash) ${U}(org_id,id) ${V}(org_id,id)`, uq.join(' '));
  const vendorBizUniq = await q(`SELECT i.indexrelid::regclass::text n FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'public.${V}'::regclass AND i.indisunique AND a.attname = 'biz_no'`);
  check(`S${n++}`, '거래처 — 사업자번호 UNIQUE 없음(같은 번호 허용)', vendorBizUniq.length === 0, vendorBizUniq.map((r) => r.n).join(','));

  // FK — 계산서 → 파일 CASCADE · → 거래처 RESTRICT(둘 다 단체까지 묶음), 파일 → 대응표 RESTRICT
  const fks = await q(`SELECT conrelid::regclass::text t, confrelid::regclass::text r, confdeltype d,
      ${colList('c.conrelid', 'c.conkey')} cols, ${colList('c.confrelid', 'c.confkey')} rcols
    FROM pg_constraint c WHERE contype = 'f' AND conrelid = ANY($1::regclass[])`, [[`public.${M}`, `public.${U}`, `public.${V}`, `public.${I}`]]);
  const fk = fks.map((r) => `${r.t.replace('public.', '')}(${r.cols})->${r.r.replace('public.', '')}(${r.rcols}):${r.d}`).sort();
  check(`S${n++}`, '★ FK 셋 — 계산서 (org_id, file_id)→파일 CASCADE(c) · (org_id, vendor_id)→거래처 RESTRICT(r) · 파일→대응표 RESTRICT(r)',
    fk.join(' ') === `${I}(org_id,file_id)->${U}(org_id,id):c ${I}(org_id,vendor_id)->${V}(org_id,id):r ${U}(map_id)->${M}(id):r`,
    fk.join(' '));

  for (const t of ORG_TABLES) {
    const rls = (await q(`SELECT relrowsecurity r, relforcerowsecurity f,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) n,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'erp_org_scope') o
      FROM pg_class c WHERE relnamespace = 'public'::regnamespace AND relname = $1`, [t]))[0];
    check(`S${n++}`, `${t} — RLS ENABLE + FORCE + 정책은 erp_org_scope 하나`, rls && rls.r && rls.f && rls.n === 1 && rls.o === 1, JSON.stringify(rls));
  }
  const mapRls = (await q(`SELECT relrowsecurity r, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) n
    FROM pg_class c WHERE relnamespace = 'public'::regnamespace AND relname = $1`, [M]))[0];
  check(`S${n++}`, `${M} — RLS 없음 · 정책 없음(공용)`, mapRls && !mapRls.r && mapRls.n === 0, JSON.stringify(mapRls));

  const priv = async (t) => (await q(`SELECT
      has_table_privilege('erp_app', 'public.${t}', 'SELECT') sel,
      has_table_privilege('erp_app', 'public.${t}', 'INSERT') ins,
      has_table_privilege('erp_app', 'public.${t}', 'UPDATE') upd,
      has_table_privilege('erp_app', 'public.${t}', 'DELETE') del,
      has_any_column_privilege('erp_app', 'public.${t}', 'UPDATE') updcol,
      has_table_privilege('anon', 'public.${t}', 'SELECT') anon,
      has_table_privilege('authenticated', 'public.${t}', 'SELECT') auth`))[0];
  const none = (g) => !g.anon && !g.auth;
  const gm = await priv(M);
  check(`S${n++}`, `${M} — erp_app 읽기만`, gm.sel && !gm.ins && !gm.updcol && !gm.del && none(gm), JSON.stringify(gm));
  const gu = await priv(U);
  check(`S${n++}`, `${U} — erp_app 읽기 · 넣기 · 지우기(고치기 없음)`, gu.sel && gu.ins && !gu.updcol && gu.del && none(gu), JSON.stringify(gu));
  const gv = await priv(V);
  check(`S${n++}`, `${V} — erp_app 읽기 · 넣기 · 고치기 · 지우기`, gv.sel && gv.ins && gv.upd && gv.del && none(gv), JSON.stringify(gv));
  const gi = await priv(I);
  const vendorCol = (await q(`SELECT has_column_privilege('erp_app', 'public.${I}', 'vendor_id', 'UPDATE') v,
      has_column_privilege('erp_app', 'public.${I}', 'supply_amount', 'UPDATE') a,
      has_column_privilege('erp_app', 'public.${I}', 'approval_no', 'UPDATE') n`))[0];
  check(`S${n++}`, `${I} — erp_app 읽기 · 넣기 · vendor_id 만 고치기 · 지우기 없음`,
    gi.sel && gi.ins && !gi.upd && !gi.del && vendorCol.v && !vendorCol.a && !vendorCol.n && none(gi),
    JSON.stringify({ ...gi, ...vendorCol }));

  const leftover = await q(`SELECT table_name, grantee FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name = ANY($1) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [[M, U, V, I]]);
  check(`S${n++}`, 'check-grants 기준 — 네 표에 anon · authenticated · PUBLIC 권한 0건', leftover.length === 0,
    leftover.map((r) => `${r.grantee}:${r.table_name}`).join(','));
}

async function rlsChecks(ec) {
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
  const file = (id, org, h, extra = {}) =>
    tryRun(`INSERT INTO public.${U} (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count)
      VALUES ($1, $2, 'INVOICE', $3, $4, $5, $6, $7, $8, $9)`,
    [id, org, MAP_ID, extra.direction ?? 'S', `${id}.xls`, h, extra.size ?? 27136, extra.rows ?? 2, extra.inserted ?? 2]);
  const vendor = (id, org, extra = {}) =>
    tryRun(`INSERT INTO public.${V} (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
      VALUES ($1, $2, $3, $4, $5, 'INVOICE', 'S')`,
    [id, org, extra.name ?? '시험 거래처', extra.bizNo === undefined ? '1234567890' : extra.bizNo, extra.tp ?? 'M']);
  const invoice = (id, org, fileId, vendorId, approvalNo, extra = {}) =>
    tryRun(`INSERT INTO public.${I} (id, org_id, file_id, vendor_id, direction, approval_no, write_date,
        partner_name_src, partner_biz_no_src, supply_amount, tax_amount, total_amount, inv_class, inv_type)
      VALUES ($1, $2, $3, $4, $5, $6, DATE '2026-09-05', '시험 거래처', $7, 100000, 10000, 110000, 'TAX', 'GEN')`,
    [id, org, fileId, vendorId, extra.direction ?? 'S', approvalNo, extra.bizNo ?? '1234567890']);
  const idsOf = async (t) => (await q(`SELECT id FROM public.${t} WHERE id LIKE 'v203-%' ORDER BY 1`)).map((r) => r.id).join();

  await ec.query('BEGIN');
  try {
    await scope('operator', null);
    const mapRow = (await q(`SELECT id, header_row, cardinality(header_signature) n FROM public.${M} WHERE id = $1`, [MAP_ID]))[0];
    check('R0', `대응표 ${MAP_ID} 가 있다(204 적용 확인 · erp_app 이 읽을 수 있다)`, !!mapRow, JSON.stringify(mapRow));
    if (!mapRow) return; // 아래 넣기가 FK 로 전부 실패한다 — 원인은 이 한 줄로 충분하다

    // --- 넣기 -----------------------------------------------------------------------
    const ins = [
      await file('v203-fa', ORG_A, hash('a')), await file('v203-fb', ORG_B, hash('b')),
      await vendor('v203-va', ORG_A), await vendor('v203-va2', ORG_A, { name: '같은 번호 거래처' }), await vendor('v203-vb', ORG_B),
      await invoice('v203-ia1', ORG_A, 'v203-fa', 'v203-va', 'T-0001'),
      await invoice('v203-ia2', ORG_A, 'v203-fa', 'v203-va2', 'T-0002'),
      await invoice('v203-ib1', ORG_B, 'v203-fb', 'v203-vb', 'T-0001'),
    ];
    check('R1', '운영사 — 두 단체의 파일 · 거래처 · 계산서를 넣는다(같은 사업자번호 거래처 둘 포함)',
      ins.every((r) => r.code === null), ins.map((r) => r.code).join(' '));
    const tp = (await q(`SELECT tp_set_by_user t FROM public.${V} WHERE id = 'v203-va'`))[0];
    check('R2', '거래처 tp_set_by_user 기본값 false', tp && tp.t === false, JSON.stringify(tp));

    // --- 중복 막기 ------------------------------------------------------------------
    const dupFile = await file('v203-fa-dup', ORG_A, hash('a'));
    check('R3', '★ 같은 단체 · 같은 파일 지문 두 번 — 거절(23505)', dupFile.code === '23505', `code=${dupFile.code}`);
    const dupInv = await invoice('v203-ia-dup', ORG_A, 'v203-fa', 'v203-va', 'T-0001');
    check('R4', '★ 같은 단체 · 같은 승인번호 두 번 — 거절(23505)', dupInv.code === '23505', `code=${dupInv.code}`);
    check('R5', '다른 단체의 같은 승인번호 · 같은 지문은 들어간다(R1 의 ib1 · fb)', ins[7].code === null && ins[1].code === null);

    // --- CHECK ----------------------------------------------------------------------
    const bad = [
      { label: '파일 구분 X', ...(await file('v203-x1', ORG_A, hash('c'), { direction: 'X' })) },
      { label: '지문 대문자', ...(await file('v203-x2', ORG_A, 'A'.repeat(64))) },
      { label: '지문 63자', ...(await file('v203-x3', ORG_A, 'd'.repeat(63))) },
      { label: '5MB 넘음', ...(await file('v203-x4', ORG_A, hash('e'), { size: 5242881 })) },
      { label: '크기 0', ...(await file('v203-x5', ORG_A, hash('f'), { size: 0 })) },
      { label: '10,000줄 넘음', ...(await file('v203-x6', ORG_A, '1'.repeat(64), { rows: 10001, inserted: 0 })) },
      { label: '넣은 줄 > 파일 줄', ...(await file('v203-x7', ORG_A, '2'.repeat(64), { rows: 2, inserted: 3 })) },
      { label: '거래처 구분 X', ...(await vendor('v203-x8', ORG_A, { tp: 'X' })) },
      { label: '거래처 번호 9자리', ...(await vendor('v203-x9', ORG_A, { bizNo: '123456789' })) },
      { label: '거래처 번호 하이픈', ...(await vendor('v203-x10', ORG_A, { bizNo: '123-456789' })) },
      { label: '거래처 이름 빈칸', ...(await vendor('v203-x11', ORG_A, { name: '  ' })) },
      { label: '계산서 구분 X', ...(await invoice('v203-x12', ORG_A, 'v203-fa', 'v203-va', 'T-0091', { direction: 'X' })) },
      { label: '계산서 번호 빈칸', ...(await invoice('v203-x13', ORG_A, 'v203-fa', 'v203-va', 'T-0092', { bizNo: '' })) },
      { label: '승인번호 빈칸', ...(await invoice('v203-x14', ORG_A, 'v203-fa', 'v203-va', ' ')) },
    ];
    check('R6', 'CHECK — 구분 · 지문 · 크기 · 줄 수 · 사업자번호 · 이름 · 승인번호 틀리면 거절(23514)',
      bad.every((r) => r.code === '23514'), bad.map((r) => `${r.label}=${r.code}`).join(' '));
    const noBiz = await vendor('v203-vnull', ORG_A, { bizNo: null });
    check('R7', '거래처 사업자번호는 비울 수 있다(고치기 창)', noBiz.code === null, `code=${noBiz.code}`);

    // --- FK -------------------------------------------------------------------------
    const noFile = await invoice('v203-x15', ORG_A, 'v203-none', 'v203-va', 'T-0093');
    const noVendor = await invoice('v203-x16', ORG_A, 'v203-fa', 'v203-none', 'T-0094');
    check('R8', '없는 파일 · 없는 거래처를 가리키는 계산서 — 거절(23503)', noFile.code === '23503' && noVendor.code === '23503',
      `${noFile.code} ${noVendor.code}`);

    // --- RLS ------------------------------------------------------------------------
    check('R9', '운영사 — 세 표 모두 두 단체가 보인다(앱이 org_id 를 직접 걸어야 하는 까닭)',
      (await idsOf(U)) === 'v203-fa,v203-fb' && (await idsOf(I)) === 'v203-ia1,v203-ia2,v203-ib1',
      `${await idsOf(U)} / ${await idsOf(I)}`);

    await scope('tenant', ORG_A);
    check('R10', '회사 A — 자기 단체 줄만(파일 · 거래처 · 계산서)',
      (await idsOf(U)) === 'v203-fa' && (await idsOf(V)) === 'v203-va,v203-va2,v203-vnull' && (await idsOf(I)) === 'v203-ia1,v203-ia2',
      `${await idsOf(U)} / ${await idsOf(V)} / ${await idsOf(I)}`);
    const mineFile = await file('v203-fa2', ORG_A, hash('9'));
    check('R11', '회사 A — 자기 단체로 넣기는 된다', mineFile.code === null, `code=${mineFile.code}`);
    const other = [
      await file('v203-y1', ORG_B, hash('8')),
      await vendor('v203-y2', ORG_B),
      await invoice('v203-y3', ORG_B, 'v203-fb', 'v203-vb', 'T-0095'),
    ];
    check('R12', '★ 회사 A — 남의 단체로 넣기는 막힌다(42501, 세 표)', other.every((r) => r.code === '42501'),
      other.map((r) => r.code).join(' '));
    const touchB = [
      await tryRun(`UPDATE public.${V} SET name = '변조' WHERE id = 'v203-vb'`),
      await tryRun(`DELETE FROM public.${V} WHERE id = 'v203-vb'`),
      await tryRun(`DELETE FROM public.${U} WHERE id = 'v203-fb'`),
      await tryRun(`UPDATE public.${I} SET vendor_id = 'v203-va' WHERE id = 'v203-ib1'`),
    ];
    check('R13', '회사 A — 남의 단체 줄 고치기 · 지우기는 0줄', touchB.every((r) => r.code === null && r.rowCount === 0),
      touchB.map((r) => `${r.code}/${r.rowCount}`).join(' '));
    const moveOut = await tryRun(`UPDATE public.${V} SET org_id = $1 WHERE id = 'v203-va2'`, [ORG_B]);
    check('R14', '회사 A — 자기 거래처를 남의 단체로 옮기기는 막힌다(42501)', moveOut.code === '42501', `code=${moveOut.code}`);
    // FK 검사는 RLS 를 거치지 않는다 — id 만 묶었다면 아래 둘이 들어간다. (org_id, id) 로 묶어서 막힌다
    const crossFile = await invoice('v203-z1', ORG_A, 'v203-fb', 'v203-va', 'T-0096');
    const crossVendor = await invoice('v203-z2', ORG_A, 'v203-fa', 'v203-vb', 'T-0097');
    const crossMove = await tryRun(`UPDATE public.${I} SET vendor_id = 'v203-vb' WHERE id = 'v203-ia1'`);
    check('R14b', '★ 회사 A 계산서가 회사 B 의 파일 · 거래처 id 를 가리키면 거절(23503) — 넣기 · 거래처 옮기기',
      crossFile.code === '23503' && crossVendor.code === '23503' && crossMove.code === '23503',
      `${crossFile.code} ${crossVendor.code} ${crossMove.code}`);

    // --- 계산서 고치기는 거래처만 ------------------------------------------------------
    const amt = await tryRun(`UPDATE public.${I} SET supply_amount = 1 WHERE id = 'v203-ia1'`);
    const delInv = await tryRun(`DELETE FROM public.${I} WHERE id = 'v203-ia1'`);
    check('R15', '★ 계산서 금액 고치기 · 줄 직접 지우기 — 권한 없음(42501)', amt.code === '42501' && delInv.code === '42501',
      `${amt.code} ${delInv.code}`);

    // --- 거래처 지우기 막기 · 합치기 --------------------------------------------------
    const delUsed = await tryRun(`DELETE FROM public.${V} WHERE id = 'v203-va2'`);
    check('R16', '★ 계산서가 가리키는 거래처는 못 지운다(23503)', delUsed.code === '23503', `code=${delUsed.code}`);
    const move = await tryRun(`UPDATE public.${I} SET vendor_id = 'v203-va' WHERE org_id = $1 AND vendor_id = 'v203-va2'`, [ORG_A]);
    const delMerged = await tryRun(`DELETE FROM public.${V} WHERE id = 'v203-va2'`);
    check('R17', '합치기 순서 — 계산서를 남길 곳으로 옮긴 뒤 지우기는 된다', move.code === null && move.rowCount === 1
      && delMerged.code === null && delMerged.rowCount === 1, `${move.code}/${move.rowCount} ${delMerged.code}/${delMerged.rowCount}`);

    // --- 파일 지우기 = 줄 지우기 ------------------------------------------------------
    const delFile = await tryRun(`DELETE FROM public.${U} WHERE id = 'v203-fa'`);
    check('R18', '★ 회사 A — 파일을 지우면 그 파일의 계산서가 함께 지워지고 거래처는 남는다',
      delFile.code === null && delFile.rowCount === 1 && (await idsOf(I)) === '' && (await idsOf(V)) === 'v203-va,v203-vnull',
      `${delFile.code}/${delFile.rowCount} 계산서=${await idsOf(I)} 거래처=${await idsOf(V)}`);

    // --- 대응표는 읽기만 ---------------------------------------------------------------
    const mapIns = await tryRun(`INSERT INTO public.${M} (id, kind, name, header_row, header_signature, columns)
      VALUES ('v203-map', 'INVOICE', '시험', 1, ARRAY['a'], '{}'::jsonb)`);
    const mapUpd = await tryRun(`UPDATE public.${M} SET is_active = false WHERE id = $1`, [MAP_ID]);
    check('R19', '★ 회사 세션 — 대응표 넣기 · 고치기 권한 없음(42501)', mapIns.code === '42501' && mapUpd.code === '42501',
      `${mapIns.code} ${mapUpd.code}`);

    await scope('tenant', null);
    check('R20', '단체 ID 없는 회사 세션 — 세 표 0건',
      (await idsOf(U)) === '' && (await idsOf(V)) === '' && (await idsOf(I)) === '');
  } finally {
    await ec.query('ROLLBACK');
  }
}

(async () => {
  const pc = new Client({ host: rootEnv.DB_HOST, port: +rootEnv.DB_PORT, user: rootEnv.DB_USER, password: rootEnv.DB_PASSWORD, database: rootEnv.DB_NAME });
  await pc.connect();
  await structure((s, p) => pc.query(s, p).then((r) => r.rows));
  await pc.end();

  const erpUrl = apiEnv.ERP_DATABASE_URL || '';
  if (!erpUrl) check('R*', 'erp_app 접속 RLS 검사', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
  else {
    const ec = new Client({ connectionString: erpUrl });
    await ec.connect();
    try { await rlsChecks(ec); } finally { await ec.end(); }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
