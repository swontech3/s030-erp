/**
 * 세무 거래 분류(s050300010) 검증 — **앱이 실제 DB 에서** 하는 일만 잰다(1-3, 2026-10-27).
 *
 * 사용: npm run verify:tax-classify   (= npx tsx scripts/verify-tax-classify.js)
 *
 * ★★ 표 구조 · 권한 · 매출 CHECK · 항목 코드는 `scripts/verify-207.js` 가 잰다. 여기는 그 위의 앱 처리다:
 *    확인할 줄 셈 · 확정 · 덮기 · 매출 막기 · 거래처 기억(골라 두기만) · 기간 · 파일 거르기 · 자료 종류 칩 ·
 *    엑셀 · 회사별 막기 · 세무 설정 없음 · 두 파티션 이름.
 * ★★ API 의 풀(`db/pool.ts`)로 접속한다 — erp_app. 라우트가 쓰는 처리(`routes/taxClassify.ts` 의 …Op)를 그대로 부른다.
 * ★ 1-4(2026-10-30): 카드 사용 내역 · 현금 경비 줄도 — 미지정 셈 · 지난번 항목(카드는 거래처, 현금은 거래처 글) ·
 *   확정(kind) · 현금 매출 막기 · 자료 종류 칩 · 엑셀 시트 나누기 · 회사별 막기(K18~K24).
 * ★ 시험 줄은 지어낸 값으로 **한 트랜잭션 안에서 넣고 ROLLBACK 한다.** DB 에 남는 것이 없다(마지막 Z1 이 센다).
 *   시험 단체는 verify-201 · 203 과 같은 대역(990001 · 990002).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
import * as XLSX from 'xlsx';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { applyCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { confirmClassifyOp, exportClassifyOp, listClassifyOp } from '../packages/api/src/routes/taxClassify.ts';
import { mergeVendorsOp } from '../packages/api/src/routes/taxVendors.ts';

const ORG_A = 990001;
const ORG_B = 990002;
const ACTOR = 'v-tax-cls';
const MONTH = '2026-09';
const results = [];
const check = (id, what, cond, note = '') =>
  results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: typeof note === 'string' ? note : JSON.stringify(note) });

const tenant = (orgId) => ({ role: 'tenant', companyId: null, orgId });
const OPERATOR = { role: 'operator', companyId: null, orgId: ORG_A };
const query = (over = {}) => ({ month: MONTH, view: 'left', kind: 'all', from: null, to: null, fileId: null, ...over });

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    try {
      // ── 시험 줄 — 운영사 세션으로 두 단체에 넣는다(지어낸 값) ──
      await applyCompanyScope(c, OPERATOR);
      const file = (id, org, dir, h) =>
        c.query(`INSERT INTO public.tb_s050_upload_files (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count)
          VALUES ($1, $2, 'INVOICE', 'HOMETAX_TAX_INVOICE', $3, $4, $5, 1000, 3, 3)`, [id, org, dir, `${id}.xls`, h.repeat(64)]);
      const vendor = (id, org, name) =>
        c.query(`INSERT INTO public.tb_s050_vendors (id, org_id, name, biz_no, vendor_tp, first_kind, first_direction)
          VALUES ($1, $2, $3, NULL, 'M', 'INVOICE', 'P')`, [id, org, name]);
      const invoice = (id, org, fileId, vendorId, dir, date) =>
        c.query(`INSERT INTO public.tb_s050_invoices (id, org_id, file_id, vendor_id, direction, approval_no, write_date,
            partner_name_src, partner_biz_no_src, supply_amount, tax_amount, total_amount, inv_class, inv_type)
          VALUES ($1, $2, $3, $4, $5, $6, $7::date, '지어낸 거래처', '9900000011', 100000, 10000, 110000, 'TAX', 'GEN')`,
        [id, org, fileId, vendorId, dir, `V-CLS-${id}`, date]);
      await file('vcls-fp', ORG_A, 'P', '1');
      await file('vcls-fs', ORG_A, 'S', '2');
      await file('vcls-fb', ORG_B, 'P', '3');
      await vendor('vcls-v1', ORG_A, '지어낸 임대인');
      await vendor('vcls-v2', ORG_A, '지어낸 통신사');
      await vendor('vcls-v3', ORG_A, '지어낸 손님');
      await vendor('vcls-vb', ORG_B, '남의 거래처');
      await invoice('vcls-p1', ORG_A, 'vcls-fp', 'vcls-v1', 'P', '2026-09-01');
      await invoice('vcls-p2', ORG_A, 'vcls-fp', 'vcls-v1', 'P', '2026-09-20');
      await invoice('vcls-p3', ORG_A, 'vcls-fp', 'vcls-v2', 'P', '2026-09-10');
      await invoice('vcls-p8', ORG_A, 'vcls-fp', 'vcls-v2', 'P', '2026-08-28'); // 같은 파일 · 8월 줄
      await invoice('vcls-s1', ORG_A, 'vcls-fs', 'vcls-v3', 'S', '2026-09-15');
      await invoice('vcls-b1', ORG_B, 'vcls-fb', 'vcls-vb', 'P', '2026-09-05');

      // ── 세무 설정 없음 ──
      await applyCompanyScope(c, tenant(ORG_A));
      const noSet = await listClassifyOp(c, ORG_A, query());
      check('K1', '★ 세무 설정이 없으면 사업자 유형 null · 선택 항목 0 — 화면은 막고 안내(결정) · 목록은 보인다',
        noSet.ok && noSet.data.bizType === null && noSet.data.codes.items.length === 0 && noSet.data.rows.length === 3,
        noSet.ok ? { bizType: noSet.data.bizType, items: noSet.data.codes.items.length, rows: noSet.data.rows.length } : noSet);
      await c.query(`INSERT INTO public.tb_s050_settings (org_id, biz_type, withholding_cycle, tax_emails, unused_kinds)
        VALUES ($1, 'C', 'M', '[]'::jsonb, '{}')`, [ORG_A]);

      // ── 확인할 줄만 ──
      const l1 = await listClassifyOp(c, ORG_A, query());
      check('K2', '★ 확인할 줄 — 그 달 매입 계산서만(8월 줄 · 매출 빠짐) · 남은 줄 3 / 모두 3 · 날짜 최신순 · 법인 항목 17개',
        l1.ok && l1.data.rows.map((r) => r.id).join() === 'vcls-p2,vcls-p3,vcls-p1' &&
        l1.data.counts.left === 3 && l1.data.counts.total === 3 && l1.data.bizType === 'C' && !!l1.data.bizTypeName &&
        l1.data.codes.items.length === 17,
        l1.ok ? { rows: l1.data.rows.map((r) => r.id), counts: l1.data.counts, items: l1.data.codes.items.length } : l1);
      check('K3', '항목 선택지 — 「이름 — 풀이」의 풀이는 설명 칸에서(소모품비 → 사무용품·작은 비품)',
        l1.ok && l1.data.codes.items.find((i) => i.code === 'SUPPLY')?.description === '사무용품·작은 비품' &&
        l1.data.codes.items.find((i) => i.code === 'RENT')?.description === null);

      // ── 확정 · 덮기 ──
      const ok1 = await confirmClassifyOp(c, ORG_A, [{ kind: 'INVOICE', id: 'vcls-p1', itemCode: 'RENT' }], ACTOR);
      const l2 = await listClassifyOp(c, ORG_A, query());
      const p1 = l2.ok ? l2.data.rows.find((r) => r.id === 'vcls-p1') : null;
      check('K4', '★ 확정 — 그 줄에 항목이 붙고 남은 줄이 하나 준다(2 / 3)',
        ok1.ok && ok1.data.confirmed === 1 && p1?.itemCode === 'RENT' && l2.data.counts.left === 2 && l2.data.counts.total === 3,
        { ok1, counts: l2.ok ? l2.data.counts : l2 });
      const p2 = l2.ok ? l2.data.rows.find((r) => r.id === 'vcls-p2') : null;
      const p3 = l2.ok ? l2.data.rows.find((r) => r.id === 'vcls-p3') : null;
      check('K5', '★ 거래처 기억 — 같은 거래처의 다음 줄에 최근 확정 항목을 골라 두기만(확정 아님) · 기록 없는 거래처는 없음',
        p2?.suggestedItemCode === 'RENT' && p2.itemCode === null && p3?.suggestedItemCode === null && p1?.suggestedItemCode === null,
        { p2, p3 });

      const ok2 = await confirmClassifyOp(c, ORG_A, [{ kind: 'INVOICE', id: 'vcls-p2', itemCode: 'TEL' }, { kind: 'INVOICE', id: 'vcls-p3', itemCode: 'TEL' }], ACTOR);
      // 같은 트랜잭션이라 확정 시각이 같다 — p1 을 앞선 때로 돌려 「가장 최근」을 가린다
      await applyCompanyScope(c, OPERATOR);
      await c.query(`UPDATE public.tb_s050_invoices SET classified_at = classified_at - interval '1 day' WHERE id = 'vcls-p1'`);
      await applyCompanyScope(c, tenant(ORG_A));
      const again = await confirmClassifyOp(c, ORG_A, [{ kind: 'INVOICE', id: 'vcls-p3', itemCode: 'UTILITY' }], ACTOR);
      const l3 = await listClassifyOp(c, ORG_A, query());
      check('K6', '여러 줄 한 번에 · 다시 확정하면 덮는다 — 남은 줄 0',
        ok2.ok && ok2.data.confirmed === 2 && again.ok && l3.ok && l3.data.counts.left === 0 &&
        l3.data.rows.find((r) => r.id === 'vcls-p3')?.itemCode === 'UTILITY',
        l3.ok ? l3.data.rows.map((r) => `${r.id}=${r.itemCode}`) : l3);

      // ── 매출 · 남의 줄 막기 ──
      const sale = await confirmClassifyOp(c, ORG_A, [{ kind: 'INVOICE', id: 'vcls-p8', itemCode: 'RENT' }, { kind: 'INVOICE', id: 'vcls-s1', itemCode: 'RENT' }], ACTOR);
      const ghost = await confirmClassifyOp(c, ORG_A, [{ kind: 'INVOICE', id: 'vcls-p8', itemCode: 'RENT' }, { kind: 'INVOICE', id: 'vcls-b1', itemCode: 'RENT' }], ACTOR);
      const p8 = (await c.query(`SELECT item_code FROM public.tb_s050_invoices WHERE id = 'vcls-p8'`)).rows[0];
      check('K7', '★ 매출 계산서가 섞이면 400 · 남의 단체 줄이 섞이면 404 — 둘 다 아무것도 붙이지 않는다',
        !sale.ok && sale.status === 400 && !ghost.ok && ghost.status === 404 && p8.item_code === null,
        { sale: sale.status, ghost: ghost.status, p8 });

      // ── 전체 보기 · 자료 종류 · 기간 ──
      const all = await listClassifyOp(c, ORG_A, query({ view: 'all' }));
      check('K8', '전체 보기 — 그 달 매입 · 매출(8월 줄 빠짐) · 칩 수 전체 4 · 매입 3 · 매출 1 · 카드 · 현금 · 삐용 경비 · 은행 0',
        all.ok && all.data.rows.length === 4 &&
        JSON.stringify(all.data.counts.kinds) === JSON.stringify({ all: 4, P: 3, S: 1, CARD: 0, CASH: 0, PPIYONG: 0, BANK: 0 }),
        all.ok ? all.data.counts.kinds : all);
      const sOnly = await listClassifyOp(c, ORG_A, query({ view: 'all', kind: 'S' }));
      const card = await listClassifyOp(c, ORG_A, query({ view: 'all', kind: 'CARD' }));
      check('K9', '자료 종류 거르기 — 매출만 1줄(항목 없음) · 카드는 0줄 · 칩 수는 거르기 전 그대로',
        sOnly.ok && sOnly.data.rows.map((r) => r.id).join() === 'vcls-s1' && sOnly.data.rows[0].itemCode === null &&
        card.ok && card.data.rows.length === 0 && sOnly.data.counts.kinds.all === 4);
      const per = await listClassifyOp(c, ORG_A, query({ view: 'all', from: '2026-08-01', to: '2026-09-10' }));
      check('K10', '기간 직접 지정 — 8.01 ~ 9.10 (끝 날 포함): 8.28 · 9.10 · 9.01',
        per.ok && per.data.rows.map((r) => r.id).join() === 'vcls-p3,vcls-p1,vcls-p8',
        per.ok ? per.data.rows.map((r) => r.id) : per);

      // ── 파일로 들어옴 ──
      const byFile = await listClassifyOp(c, ORG_A, query({ view: 'all', fileId: 'vcls-fp' }));
      check('K11', '★ 파일로 들어오면 그 파일 줄 전부(다른 달 8월 줄 포함 · 기간 거르기 없음) · 파일 띠 이름',
        byFile.ok && byFile.data.rows.length === 4 && byFile.data.rows.every((r) => r.fileId === 'vcls-fp') &&
        byFile.data.file?.fileName === 'vcls-fp.xls' && byFile.data.counts.kinds.all === 4,
        byFile.ok ? { rows: byFile.data.rows.map((r) => r.id), file: byFile.data.file } : byFile);
      const otherFile = await listClassifyOp(c, ORG_A, query({ view: 'all', fileId: 'vcls-fb' }));
      check('K12', '남의 단체 파일 · 없는 파일은 404', !otherFile.ok && otherFile.status === 404, otherFile);

      // ── 엑셀 ──
      const ex = await exportClassifyOp(c, ORG_A, query({ view: 'all' }));
      const sheet = ex.ok ? XLSX.read(ex.data.bytes, { type: 'array' }) : null;
      const aoa = sheet ? XLSX.utils.sheet_to_json(sheet.Sheets[sheet.SheetNames[0]], { header: 1 }) : [];
      // 1-4 설계 7 — 시트는 자료 종류마다(계산서 · 카드 · 현금). 첫 시트가 계산서, 카드 · 현금 줄은 아직 없다(K23 에서 본다)
      check('K13', '★ 엑셀 — 파일 이름 · 첫 시트 = 계산서(자료 종류 이름) · 줄 = 화면 거르기 결과 · 항목 이름(수도광열비) · 매출은 「매출」',
        ex.ok && ex.data.fileName === '항목지정_2026-09.xlsx' && sheet.SheetNames.length === 3 && aoa.length === 1 + 4 &&
        aoa[0].at(-1) === '항목' && aoa.some((r) => r.at(-1) === '수도광열비') && aoa.some((r) => r[0] === '매출' && r.at(-1) === '매출'),
        { name: ex.ok ? ex.data.fileName : ex, sheets: sheet?.SheetNames, rows: aoa.length });

      // ── 사업자 유형을 바꾼 회사 — 이름은 두 파티션에서, 골라 두기는 그 회사 목록에 있는 것만 ──
      await confirmClassifyOp(c, ORG_A, [{ kind: 'INVOICE', id: 'vcls-p8', itemCode: 'NONBIZ_TAXPRO' }], ACTOR); // 법인 전용 항목(211 부터 접대비는 개인에도 있다)
      await c.query(`UPDATE public.tb_s050_settings SET biz_type = 'I' WHERE org_id = $1`, [ORG_A]);
      await applyCompanyScope(c, OPERATOR);
      await c.query(`UPDATE public.tb_s050_invoices SET item_code = NULL, classified_at = NULL WHERE id = 'vcls-p3'`);
      await applyCompanyScope(c, tenant(ORG_A));
      const indiv = await listClassifyOp(c, ORG_A, query({ view: 'all', fileId: 'vcls-fp' }));
      const p3b = indiv.ok ? indiv.data.rows.find((r) => r.id === 'vcls-p3') : null;
      check('K14', '★ 개인으로 바꾼 뒤 — 선택 항목은 개인 목록 18개(세무사 판단 없음 · 접대비 있음, 211) · 세무사 판단 이름은 그대로 보임 · 법인 전용 항목은 골라 두지 않음',
        indiv.ok && !indiv.data.codes.items.some((i) => i.code === 'NONBIZ_TAXPRO') && indiv.data.codes.items.some((i) => i.code === 'ENTERTAIN') &&
        indiv.data.codes.items.length === 18 &&
        indiv.data.codes.itemNames.find((n) => n.code === 'NONBIZ_TAXPRO')?.name === '사업과 무관 — 세무사 판단' && p3b?.suggestedItemCode === null,
        { p3b, items: indiv.ok ? indiv.data.codes.items.length : indiv });

      // ── 거래처 합치기 뒤에도 기억이 따라온다 ──
      await c.query(`UPDATE public.tb_s050_settings SET biz_type = 'C' WHERE org_id = $1`, [ORG_A]);
      await applyCompanyScope(c, OPERATOR);
      await c.query(`UPDATE public.tb_s050_invoices SET classified_at = classified_at - interval '2 day' WHERE id = 'vcls-p8'`);
      await applyCompanyScope(c, tenant(ORG_A));
      const merged = await mergeVendorsOp(c, ORG_A, 'vcls-v2', ['vcls-v1'], ACTOR);
      const afterMerge = await listClassifyOp(c, ORG_A, query());
      const p3c = afterMerge.ok ? afterMerge.data.rows.find((r) => r.id === 'vcls-p3') : null;
      check('K15', '거래처를 합친 뒤 — 합친 거래처의 최근 확정 항목(통신비)을 골라 둔다(저장하지 않고 그때 셈)',
        merged.ok && p3c?.vendorId === 'vcls-v2' && p3c.suggestedItemCode === 'TEL', p3c);

      // ── 회사 B ──
      await applyCompanyScope(c, tenant(ORG_B));
      const bList = await listClassifyOp(c, ORG_B, query({ view: 'all' }));
      const bConfirm = await confirmClassifyOp(c, ORG_B, [{ kind: 'INVOICE', id: 'vcls-p3', itemCode: 'RENT' }], ACTOR);
      check('K16', '★ 회사 B — A 의 줄이 안 보이고(자기 1줄만), A 의 줄 확정은 404',
        bList.ok && bList.data.rows.map((r) => r.id).join() === 'vcls-b1' && !bConfirm.ok && bConfirm.status === 404,
        { rows: bList.ok ? bList.data.rows.map((r) => r.id) : bList, confirm: bConfirm.status });

      // ── 운영사 세션도 자기 단체만 ──
      await applyCompanyScope(c, OPERATOR);
      const op = await listClassifyOp(c, ORG_A, query({ view: 'all' }));
      check('K17', '운영사 세션 — 넘긴 단체(A)의 줄만, B 의 줄은 섞이지 않는다', op.ok && op.data.rows.every((r) => r.id !== 'vcls-b1'));

      // ── 카드 사용 내역 · 현금 경비(1-4) — 지어낸 줄을 운영사 세션으로 넣는다 ──
      await applyCompanyScope(c, tenant(ORG_A));
      const before = await listClassifyOp(c, ORG_A, query());
      await applyCompanyScope(c, OPERATOR);
      await c.query(`INSERT INTO public.tb_s050_fin_accounts (id, org_id, kind, card_co_code, number, alias)
        VALUES ('vcc-card', $1, 'C', 'KB', '4821', '법인카드 1')`, [ORG_A]);
      await c.query(`INSERT INTO public.tb_s050_upload_files (id, org_id, kind, map_id, direction, file_name, file_hash, file_size, row_count, inserted_count)
        VALUES ('vcc-fc', $1, 'CARD', 'HOMETAX_BIZ_CARD', NULL, 'vcc-fc.xls', $2, 1000, 3, 3),
               ('vcc-fx', $1, 'CASH', 'TAX_CASH_STD', NULL, 'vcc-fx.xlsx', $3, 1000, 4, 4)`, [ORG_A, '4'.repeat(64), '5'.repeat(64)]);
      const cardRow = (id, vendorId, last4, total, date) =>
        c.query(`INSERT INTO public.tb_s050_card_txns (id, org_id, file_id, vendor_id, card_last4, use_date, merchant_name_src,
            merchant_biz_no_src, supply_amount, tax_amount, nontax_amount, total_amount, vat_deduct)
          VALUES ($1, $2, 'vcc-fc', $3, $4, $5::date, '지어낸 가맹점', NULL, $6, 0, 0, $6, 'Y')`, [id, ORG_A, vendorId, last4, date, total]);
      const cashRow = (id, dir, vendor, item, date) =>
        c.query(`INSERT INTO public.tb_s050_cash_txns (id, org_id, file_id, use_date, description, vendor_name_src, direction, amount,
            pay_method, item_code, classified_at, classified_by)
          VALUES ($1, $2, 'vcc-fx', $3::date, '지어낸 품명', $4, $5, 5000, 'CASH', $6::text,
                  CASE WHEN $6::text IS NULL THEN NULL ELSE CURRENT_TIMESTAMP - interval '1 day' END,
                  CASE WHEN $6::text IS NULL THEN NULL ELSE 'v' END)`, [id, ORG_A, date, vendor, dir, item]);
      await cardRow('vcc-c1', 'vcls-v2', '4821', 11000, '2026-09-21');
      await cardRow('vcc-c2', null, '0001', 3000, '2026-09-22');
      await cardRow('vcc-c3', 'vcls-v3', '4821', -5000, '2026-09-23');
      await cashRow('vcc-x1', 'P', '지어낸 식당', 'MEAL', '2026-09-24');
      await cashRow('vcc-x2', 'P', '지어낸 식당', null, '2026-09-25');
      await cashRow('vcc-x3', 'P', null, null, '2026-09-26');
      await cashRow('vcc-s1', 'S', '지어낸 손님', null, '2026-09-27');

      await applyCompanyScope(c, tenant(ORG_A));
      const l4 = await listClassifyOp(c, ORG_A, query());
      const kindsOf = (rows) => rows.map((r) => `${r.kind}:${r.id}`).filter((k) => k.includes('vcc-')).sort().join();
      check('K18', '★ 미지정 셈 — 카드 3줄 · 현금 매입 빈 2줄이 남은 줄에, 카드 3 · 현금 매입 3이 전체에 더해진다(현금 매출 빠짐)',
        before.ok && l4.ok && l4.data.counts.left === before.data.counts.left + 5 && l4.data.counts.total === before.data.counts.total + 6 &&
        kindsOf(l4.data.rows) === 'CARD:vcc-c1,CARD:vcc-c2,CARD:vcc-c3,CASH:vcc-x1,CASH:vcc-x2,CASH:vcc-x3',
        l4.ok ? { before: before.ok ? before.data.counts : before, after: l4.data.counts, rows: kindsOf(l4.data.rows) } : l4);
      const r = (id) => (l4.ok ? l4.data.rows.find((x) => x.id === id) : null);
      check('K19', '★ 줄 모양 · 지난번 항목 — 카드는 거래처(계산서에서 붙인 통신비) · 별칭 · 끝 4자리, 현금은 같은 거래처 글(식대)',
        r('vcc-c1')?.vendorName === '지어낸 통신사' && r('vcc-c1').cardAlias === '법인카드 1' && r('vcc-c1').cardLast4 === '4821' &&
        r('vcc-c1').suggestedItemCode === 'TEL' && r('vcc-c2')?.vendorName === '지어낸 가맹점' && r('vcc-c2').suggestedItemCode === null &&
        r('vcc-c3')?.totalAmount === -5000 && r('vcc-x1')?.itemCode === 'MEAL' && r('vcc-x2')?.suggestedItemCode === 'MEAL' &&
        r('vcc-x2').description === '지어낸 품명' && r('vcc-x3')?.suggestedItemCode === null,
        { c1: r('vcc-c1'), c2: r('vcc-c2'), x2: r('vcc-x2'), x3: r('vcc-x3') });

      const ok3 = await confirmClassifyOp(c, ORG_A, [{ kind: 'CARD', id: 'vcc-c1', itemCode: 'MEAL' }, { kind: 'CASH', id: 'vcc-x2', itemCode: 'SUPPLY' }], ACTOR);
      const l5 = await listClassifyOp(c, ORG_A, query());
      check('K20', '★ 확정(kind) — 카드 · 현금 줄에 항목이 붙고 남은 줄이 2 준다',
        ok3.ok && ok3.data.confirmed === 2 && l5.ok && l5.data.counts.left === l4.data.counts.left - 2 &&
        l5.data.rows.find((x) => x.id === 'vcc-c1')?.itemCode === 'MEAL' && l5.data.rows.find((x) => x.id === 'vcc-x2')?.itemCode === 'SUPPLY',
        { ok3, counts: l5.ok ? l5.data.counts : l5 });
      const cashSale = await confirmClassifyOp(c, ORG_A, [{ kind: 'CASH', id: 'vcc-x3', itemCode: 'RENT' }, { kind: 'CASH', id: 'vcc-s1', itemCode: 'RENT' }], ACTOR);
      const wrongKind = await confirmClassifyOp(c, ORG_A, [{ kind: 'CASH', id: 'vcc-x3', itemCode: 'RENT' }, { kind: 'CARD', id: 'vcc-x1', itemCode: 'RENT' }], ACTOR);
      const x3 = (await c.query(`SELECT item_code FROM public.tb_s050_cash_txns WHERE id = 'vcc-x3'`)).rows[0];
      check('K21', '★ 현금 매출이 섞이면 400 · 종류가 틀린 줄(카드라며 현금 id)이 섞이면 404 — 둘 다 아무것도 붙이지 않는다',
        !cashSale.ok && cashSale.status === 400 && !wrongKind.ok && wrongKind.status === 404 && x3.item_code === null,
        { cashSale, wrongKind, x3 });

      const all2 = await listClassifyOp(c, ORG_A, query({ view: 'all' }));
      const onlyCard = await listClassifyOp(c, ORG_A, query({ view: 'all', kind: 'CARD' }));
      const onlyCash = await listClassifyOp(c, ORG_A, query({ view: 'all', kind: 'CASH' }));
      check('K22', '자료 종류 칩 — 카드 3 · 현금 4(매출 포함) · 전체 11, 카드 · 현금 거르기는 그 줄만 · 칩 이름은 자료 종류 코드',
        all2.ok && JSON.stringify(all2.data.counts.kinds) === JSON.stringify({ all: 11, P: 3, S: 1, CARD: 3, CASH: 4, PPIYONG: 0, BANK: 0 }) &&
        onlyCard.ok && onlyCard.data.rows.length === 3 && onlyCard.data.rows.every((x) => x.kind === 'CARD') &&
        onlyCash.ok && onlyCash.data.rows.length === 4 && onlyCash.data.rows.every((x) => x.kind === 'CASH') &&
        ['CARD', 'CASH'].every((k) => all2.data.codes.kinds.some((x) => x.code === k && x.name)),
        all2.ok ? all2.data.counts.kinds : all2);

      const ex2 = await exportClassifyOp(c, ORG_A, query({ view: 'all' }));
      const wb2 = ex2.ok ? XLSX.read(ex2.data.bytes, { type: 'array' }) : null;
      const exCard = await exportClassifyOp(c, ORG_A, query({ view: 'all', kind: 'CARD' }));
      const wb3 = exCard.ok ? XLSX.read(exCard.data.bytes, { type: 'array' }) : null;
      const kindName = (k) => (all2.ok ? all2.data.codes.kinds.find((x) => x.code === k)?.name : null);
      const cardAoa = wb2 ? XLSX.utils.sheet_to_json(wb2.Sheets[kindName('CARD')], { header: 1 }) : [];
      check('K23', '★ 엑셀 — 「전체」는 계산서 · 카드 · 현금 시트 셋(자료 종류 이름), 카드만 거르면 카드 시트 하나 · 카드번호는 끝 4자리만',
        wb2 && JSON.stringify(wb2.SheetNames) === JSON.stringify([kindName('INVOICE'), kindName('CARD'), kindName('CASH')]) &&
        cardAoa.length === 1 + 3 && cardAoa.some((row) => row[1] === '법인카드 1 · 끝 4821') &&
        wb3 && JSON.stringify(wb3.SheetNames) === JSON.stringify([kindName('CARD')]),
        { all: wb2?.SheetNames, card: wb3?.SheetNames, cardRows: cardAoa.length });

      // 1-4 보완 — 현금 시트의 결제방법 · 증빙 칸 이름은 코드 분류 이름(글자로 박지 않는다)
      const catName = async (cat) => (await c.query(`SELECT name FROM public.tb_s080_code_masters WHERE category = $1`, [cat])).rows[0]?.name;
      const [payName, proofName] = [await catName('TAX_PAY_METHOD'), await catName('TAX_PROOF')];
      const cashHead = wb2 ? XLSX.utils.sheet_to_json(wb2.Sheets[kindName('CASH')], { header: 1 })[0] : [];
      check('K25', '★ 엑셀 현금 시트 — 결제방법 · 증빙 칸 이름 = 코드 분류 TAX_PAY_METHOD · TAX_PROOF 이름',
        !!payName && !!proofName && cashHead?.[5] === payName && cashHead?.[6] === proofName,
        { payName, proofName, cashHead });

      await applyCompanyScope(c, tenant(ORG_B));
      const bList2 = await listClassifyOp(c, ORG_B, query({ view: 'all' }));
      const bCard = await confirmClassifyOp(c, ORG_B, [{ kind: 'CARD', id: 'vcc-c2', itemCode: 'RENT' }], ACTOR);
      check('K24', '★ 회사 B — A 의 카드 · 현금 줄이 안 보이고, A 의 카드 줄 확정은 404',
        bList2.ok && !bList2.data.rows.some((x) => x.id.startsWith('vcc-')) && bList2.data.counts.kinds.CARD === 0 &&
        !bCard.ok && bCard.status === 404, { kinds: bList2.ok ? bList2.data.counts.kinds : bList2, bCard });
    } finally {
      await c.query('ROLLBACK');
    }

    // ★ 스코프(set_config … true)는 트랜잭션 안에서만 산다 — 밖에서 세면 RLS 가 0줄을 줘서 늘 통과한다
    await c.query('BEGIN');
    try {
      await applyCompanyScope(c, OPERATOR);
      const n = async (t) => (await c.query(`SELECT count(*)::int n FROM public.${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]])).rows[0].n;
      const [f, v, i, s] = [await n('tb_s050_upload_files'), await n('tb_s050_vendors'), await n('tb_s050_invoices'), await n('tb_s050_settings')];
      const [cd, cs, fa] = [await n('tb_s050_card_txns'), await n('tb_s050_cash_txns'), await n('tb_s050_fin_accounts')];
      check('Z1', '롤백 후 시험 줄 0 (운영사 스코프로 센다)', f === 0 && v === 0 && i === 0 && s === 0 && cd === 0 && cs === 0 && fa === 0,
        `파일 ${f} · 거래처 ${v} · 계산서 ${i} · 설정 ${s} · 카드 ${cd} · 현금 ${cs} · 계좌·카드 ${fa}`);
    } finally {
      await c.query('ROLLBACK');
    }
  } finally {
    c.release();
  }
}

main()
  .then(async () => {
    await closePool();
    console.table(results);
    const failed = results.filter((r) => r.결과 !== '통과').length;
    console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error('✘ 실행 실패:', e.message);
    await closePool().catch(() => {});
    process.exit(2);
  });
