/**
 * 3-5 검증 — 삐용 **퇴실 · 재입주 · 수정**이 실제 라우트로 도는가 (회신 2026-10-02).
 *
 * ★ 왜 vitest 가 아닌가. 보내는 본문·응답 해석·판정 규칙은 순수 함수 쪽에 시험이 있다
 *   (`bbiyong/orgSync.test.ts` · `bbiyong/HttpBbiyongOrg.test.ts`). 여기서 보는 것은
 *   **라우트 · 트랜잭션 경계 · 세션 토큰 경로가 실제로 그렇게 도는가**다. verify-3-2 와 같다.
 *
 * ★★ **삐용을 실제로 부르지 않는다** — `MockBbiyongOrg` 가 답한다. 실호출은
 *    `HttpBbiyongOrg` 이고 `BBIYONG_MOCK=false` 일 때만 꽂힌다.
 *
 * ★★★ **넣은 것은 전부 지운다.** 개발계 공용 DB 라 흔적을 남기지 않는다.
 *
 * 이 검증이 지키는 것:
 *   ① 계약이 종료되면 퇴실이 나간다 — 연결은 끊지 않는다
 *   ② 살아 있는 계약이 남아 있으면 **퇴실을 보내지 않는다**
 *   ③ 종료됐던 회사가 새 계약을 확정하면 재입주 — **회사를 다시 만들지 않는다**
 *   ④ 회사명이 바뀌면 수정이 나가고, 안 바뀌면 부르지 않는다
 *   ⑤ [다시 시도]는 고칠 것이 없으면 삐용을 부르지 않는다
 *
 * 사용: npm run verify:3-5
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerContractRoutes } from '../packages/api/src/routes/contracts.ts';
import { registerCompanyRoutes } from '../packages/api/src/routes/companies.ts';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { syncAllSpaceStatuses } from '../packages/api/src/db/spaceStatus.ts';
import { encrypt, hashSessionId, newSessionId } from '../packages/api/src/lib/crypto.ts';

/** ★ RLS 가 걸린 표는 `pool.query` 로 못 읽는다 — GUC 없는 커넥션은 0행을 본다. */
const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);

const { itemCountGate } = require('./verify-count.js');

const EXPECTED_ITEMS = 30;
let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 이 검증이 만든 것만 골라 지우기 위한 표식. */
const TAG = `verify-3-5-${Date.now()}`;
const STAMP = String(Date.now()).slice(-9);
/** 만든 회사들. 끝에서 전부 지운다. */
const companies = [];

const json = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return { __raw: res.body };
  }
};

/*
 * ★★ 세션을 **실제로 만든다.** verify-billing 은 세션 훅을 우회하지만 여기서는 안 된다 —
 *    삐용 호출이 `callBbiyong(session.erpSid, …)` 를 타고, 그것은 `tb_s080_auth_session`
 *    에서 암호화된 토큰을 읽는다. 행이 없으면 「다시 로그인해 주세요」가 된다.
 *    즉 이 검증은 **3-2 가 토큰 경로(②③)를 제대로 타는지도** 같이 본다.
 */
async function makeSession(memberId) {
  const rawSid = newSessionId();
  const erpSid = hashSessionId(rawSid);
  await pool.query(
    `INSERT INTO public.tb_s080_auth_session
       (erp_sid, bbiyong_member_id, org_tp, org_id,
        bbiyong_access_encrypted, bbiyong_refresh_encrypted, expires_at)
     VALUES ($1, $2, 'S', 1, $3, $4, now() + interval '1 hour')`,
    [erpSid, memberId, encrypt(`verify-access.${memberId}`), encrypt(`verify-refresh.${memberId}`)],
  );
  return { rawSid, erpSid };
}

function buildApp(session) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.session = session;
  });
  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) return reply.code(500).send({ error: 'internal_error', message: err.message });
    return reply.code(status).send({ error: 'bad_request', message: err.message });
  });
  registerContractRoutes(app);
  registerCompanyRoutes(app);
  return app;
}

/** 회사를 새로 만든다. ★ 확정이 통과하려면 신분증 서류 1건이 필요하다(회원구분 미선택). */
async function makeCompany(buildId, over = {}) {
  const companyId = `V35-${STAMP}-${companies.length}`;
  companies.push(companyId);
  await asOperator(async (c) => {
    await c.query(
      `INSERT INTO public.tb_s080_companies
         (company_id, build_id, company_name, ceo_name, tel, email, memo, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        companyId,
        buildId,
        over.companyName ?? `검증회사 ${TAG} ${companies.length}`,
        over.ceoName ?? '김검증',
        over.tel ?? '010-1234-5678',
        // ★ `undefined` 와 `null` 을 가른다 — 「칸을 비웠다」를 시험하려면 null 이 들어가야 한다.
        'email' in over ? over.email : `v35-${STAMP}-${companies.length}@example.test`,
        TAG,
      ],
    );
    /*
     * 신분증 1건. 회원구분이 비어 있으면 이것만 필수다(`docRuleFor`).
     *
     * ★ 칸 이름은 **실제 DB 를 보고** 적었다 — `doc/existing_schema.sql` 은 스냅샷이라
     *   `tenant_id`·`storage_url` 이 있지만, 019 가 이름을 바꾼 뒤 실제 표에는
     *   `operator_id`(정수 · NOT NULL · tb_s080_tenant010 FK)가 있고 그 둘은 없다. 개발계 운영사는 1 뿐이다.
     */
    await c.query(
      `INSERT INTO public.tb_cm_file
         (id, operator_id, target_type, target_id, file_purpose, original_name,
          storage_path, file_size, mime_type)
       VALUES ($1, 1, 'COMPANY', $2, 'CEO_ID', 'id.png', $3, 1, 'image/png')`,
      [randomUUID(), companyId, `verify/${companyId}/id.png`],
    );
  });
  return companyId;
}

(async () => {
  const { rows: buildRows } = await pool.query(`SELECT build_id FROM public.tb_s080_buildings LIMIT 1`);
  const BUILD_ID = buildRows[0]?.build_id;

  /* 아무도 안 쓰는 비상주 호실. 비상주는 한 호실에 한 회사라 겹침이 가장 빡빡하다. */
  const { rows: spaceRows } = await asOperator((c) =>
    c.query(
      `SELECT s.space_id, s.room_type, s.standard_fee
         FROM public.tb_s080_spaces s
        WHERE s.build_id = $1 AND s.room_type = 'VR' AND s.is_active
          AND NOT EXISTS (
            SELECT 1 FROM public.tb_s080_contract_spaces cs
              JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
             WHERE cs.space_id = s.space_id AND k.status IN ('confirmed', 'draft'))
        ORDER BY s.room_name LIMIT 8`,
      [BUILD_ID],
    ),
  );

  if (!BUILD_ID || spaceRows.length < 4) {
    console.error(`✘ 준비 부족 — build=${BUILD_ID} 빈비상주=${spaceRows.length}(4 필요)`);
    process.exit(1);
  }
  /* ★ 이 검증은 번호를 기대하지 않는다 — 채번 규칙은 verify-3-2 가 본다.
     몇 개가 쓰여 있는지만 적어 둔다(실패를 읽을 때의 맥락이다). */
  const { rows: takenRows } = await asOperator((c) =>
    c.query(`SELECT link_org_code FROM public.tb_s080_companies WHERE link_org_code IS NOT NULL`),
  );
  const takenBefore = takenRows.map((r) => r.link_org_code);
  console.log(`준비 — build=${BUILD_ID} 빈 비상주 ${spaceRows.length}실`);
  console.log(`       이미 쓰인 단채코드 ${takenBefore.length}개
`);

  const session = await makeSession(9935);
  const op = buildApp({
    s020MemberId: 9935,
    s020OrgId: 1,
    companyId: null,
    role: 'operator',
    erpSid: session.erpSid,
  });

  let spaceCursor = 0;
  let roomCursor = 0;
  const contractPayload = (companyId, status) => {
    const space = spaceRows[spaceCursor++];
    return {
      companyId,
      buildId: BUILD_ID,
      contractRoom: `V35${STAMP}-${roomCursor++}`,
      paymentMethod: 'M',
      periodMonths: 12,
      freeMonths: 0,
      contractDate: '2026-02-25',
      startDate: '2026-03-15',
      status,
      memo: TAG,
      spaces: [
        {
          roomType: space.room_type,
          spaceId: space.space_id,
          standardFee: space.standard_fee ?? 0,
          deposit: 0,
          monthlyFee: 500_000,
          vatYn: true,
        },
      ],
    };
  };

  const linkOf = (companyId) =>
    asOperator(async (c) => {
      const { rows } = await c.query(
        `SELECT link_s020_org_id, link_org_code, link_status, link_failed_reason, link_failed_at
           FROM public.tb_s080_companies WHERE company_id = $1`,
        [companyId],
      );
      return rows[0];
    });

  try {
    /* ── 1. 계약 종료 → 퇴실이 나간다 ─────────────────────────────────────── */
    console.log('1. 계약 종료 — 삐용에 퇴실이 나간다');
    let outCompany;
    {
      outCompany = await makeCompany(BUILD_ID);
      const made = json(await op.inject({
        method: 'POST', url: '/contracts', payload: contractPayload(outCompany, 'confirmed'),
      }));
      check('확정은 linked', made.bbiyong === 'linked', `${made.bbiyong} / ${made.bbiyongReason ?? ''}`);

      const res = await op.inject({
        method: 'POST',
        url: `/contracts/${made.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-06-30', terminationReason: '검증' },
      });
      const body = json(res);
      check('종료 전이 200', res.statusCode === 200, `${res.statusCode} ${JSON.stringify(body).slice(0, 140)}`);
      check('★ bbiyong: synced — 퇴실이 나갔다', body.bbiyong === 'synced', `${body.bbiyong} / ${body.bbiyongReason ?? ''}`);

      const link = await linkOf(outCompany);
      check('★ 연결은 그대로다 — 퇴실은 연결을 끊는 것이 아니다', typeof link.link_s020_org_id === 'number',
        String(link.link_s020_org_id));
      check('단체코드도 그대로다', /^Z[0-9]{2}$/.test(link.link_org_code ?? ''), String(link.link_org_code));
      check('link_status = linked — 대기 사유가 남지 않았다', link.link_status === 'linked', String(link.link_status));
      check('실패 사유는 비어 있다', link.link_failed_reason === null, String(link.link_failed_reason));
    }

    /* ── 2. 살아 있는 계약이 남아 있으면 퇴실을 보내지 않는다 ──────────────── */
    console.log('\n2. 호실 둘 중 하나만 끝났다 — 퇴실을 보내지 않는다');
    {
      const company = await makeCompany(BUILD_ID);
      const first = json(await op.inject({
        method: 'POST', url: '/contracts', payload: contractPayload(company, 'confirmed'),
      }));
      const second = json(await op.inject({
        method: 'POST', url: '/contracts', payload: contractPayload(company, 'confirmed'),
      }));
      check('둘째 계약 확정에서는 보낼 것이 없다 (이미 입주 중)', second.bbiyong === 'skipped', String(second.bbiyong));

      const res = await op.inject({
        method: 'POST',
        url: `/contracts/${first.contractId}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-06-30', terminationReason: '검증' },
      });
      const body = json(res);
      check('종료 전이 200', res.statusCode === 200, String(res.statusCode));
      check('★★ bbiyong: skipped — 아직 입주 중이라 끄지 않는다', body.bbiyong === 'skipped',
        `${body.bbiyong} / ${body.bbiyongReason ?? ''}`);

      const link = await linkOf(company);
      check('link_status 는 linked 그대로 — 배너를 띄우지 않는다', link.link_status === 'linked', String(link.link_status));
    }

    /* ── 3. 재입주 — 회사를 다시 만들지 않는다 ────────────────────────────── */
    console.log('\n3. 종료된 회사가 새 계약 — 재입주 (회사를 다시 만들지 않는다)');
    {
      const before = await linkOf(outCompany);
      const res = await op.inject({
        method: 'POST', url: '/contracts', payload: contractPayload(outCompany, 'confirmed'),
      });
      const body = json(res);
      check('확정 201', res.statusCode === 201, `${res.statusCode} ${JSON.stringify(body).slice(0, 140)}`);
      check('★ bbiyong: synced — 재입주가 나갔다', body.bbiyong === 'synced', `${body.bbiyong} / ${body.bbiyongReason ?? ''}`);

      const after = await linkOf(outCompany);
      check('★★★ org_id 가 그대로다 — 회사를 다시 만들지 않았다',
        after.link_s020_org_id === before.link_s020_org_id,
        `${before.link_s020_org_id} → ${after.link_s020_org_id}`);
      check('★★ 단체코드도 그대로다 — 번호를 새로 뽑지 않았다',
        after.link_org_code === before.link_org_code,
        `${before.link_org_code} → ${after.link_org_code}`);
      check('link_status = linked', after.link_status === 'linked', String(after.link_status));
    }

    /* ── 4. 회사명 수정 → 수정이 나간다 ───────────────────────────────────── */
    console.log('\n4. 회사명 수정 — 삐용에 수정이 나간다');
    {
      const res = await op.inject({
        method: 'PATCH',
        url: `/companies/${outCompany}`,
        payload: { companyName: `검증회사 ${TAG} 이름바꿈` },
      });
      const body = json(res);
      check('수정 200', res.statusCode === 200, `${res.statusCode} ${JSON.stringify(body).slice(0, 140)}`);
      check('★ bbiyong: synced — 수정이 나갔다', body.bbiyong === 'synced', `${body.bbiyong} / ${body.bbiyongReason ?? ''}`);

      const link = await linkOf(outCompany);
      check('연결은 그대로다', typeof link.link_s020_org_id === 'number', String(link.link_s020_org_id));
      check('대기 사유가 남지 않았다', link.link_failed_reason === null, String(link.link_failed_reason));
    }

    /* ── 5. 이름이 안 바뀌면 보내지 않는다 ────────────────────────────────── */
    console.log('\n5. 연락처만 고쳤다 — 삐용을 부르지 않는다');
    {
      const res = await op.inject({
        method: 'PATCH', url: `/companies/${outCompany}`, payload: { tel: '010-9999-8888' },
      });
      const body = json(res);
      check('수정 200', res.statusCode === 200, String(res.statusCode));
      check('★ bbiyong 은 null — 회사명이 안 바뀌어 부르지 않았다', body.bbiyong === null, String(body.bbiyong));
    }

    /* ── 6. 연결되지 않은 회사의 이름을 고쳐도 조용하다 ───────────────────── */
    console.log('\n6. 삐용에 없는 회사의 이름 수정 — 보낼 곳이 없다');
    {
      const company = await makeCompany(BUILD_ID);
      const res = await op.inject({
        method: 'PATCH', url: `/companies/${company}`, payload: { companyName: `미연동 ${TAG}` },
      });
      const body = json(res);
      check('수정 200', res.statusCode === 200, String(res.statusCode));
      check('★ bbiyong: skipped — 연결되지 않아 보낼 곳이 없다', body.bbiyong === 'skipped', String(body.bbiyong));

      const link = await linkOf(company);
      check('연동 상태를 만들지 않았다', link.link_status === null, String(link.link_status));
    }

    /* ── 7. [다시 시도] 는 고칠 것이 없으면 삐용을 부르지 않는다 ───────────── */
    console.log('\n7. [다시 시도] — 멀쩡한 회사는 already (삐용을 부르지 않는다)');
    {
      const res = await op.inject({ method: 'POST', url: `/companies/${outCompany}/bbiyong-link` });
      const body = json(res);
      check('재시도 200', res.statusCode === 200, String(res.statusCode));
      check('★★ already — 버튼을 눌러 상태를 망가뜨리지 않는다', body.bbiyong === 'already', String(body.bbiyong));

      const link = await linkOf(outCompany);
      check('link_status 는 linked 그대로', link.link_status === 'linked', String(link.link_status));
      check('실패 사유가 생기지 않았다', link.link_failed_reason === null, String(link.link_failed_reason));
    }

  } finally {
    await op.close();

    /* ── 정리 — 넣은 것은 전부 지운다 ────────────────────────────────────── */
    console.log('\n정리');
    const cleanup = await asOperator(async (c) => {
      const { rows } = await c.query(
        `SELECT contract_id FROM public.tb_s080_contracts WHERE memo = $1`, [TAG],
      );
      const ids = rows.map((r) => r.contract_id);
      let invoices = 0;
      let deposits = 0;
      if (ids.length > 0) {
        // ★ 수납이 청구서를 참조한다(`tb_s080_payments_invoice_company_fkey`) — 먼저 지운다.
        //   확정 시 예치금 「받음」이 수납 한 줄을 만들기 때문에 실제로 행이 있다.
        await c.query(
          `DELETE FROM public.tb_s080_payments p
            USING public.tb_s080_invoices i
            WHERE i.invoice_id = p.invoice_id AND i.contract_id = ANY($1::text[])`,
          [ids],
        );
        invoices = (await c.query(
          `DELETE FROM public.tb_s080_invoices WHERE contract_id = ANY($1::text[])`, [ids])).rowCount;
        await c.query(`DELETE FROM public.tb_s080_settlements WHERE contract_id = ANY($1::text[])`, [ids]);
        deposits = (await c.query(
          `DELETE FROM public.tb_s080_deposit_ledger WHERE contract_id = ANY($1::text[])`, [ids])).rowCount;
      }
      // 계약 항목·상태 이력은 계약에서 CASCADE 된다.
      const contracts = (await c.query(
        `DELETE FROM public.tb_s080_contracts WHERE memo = $1`, [TAG])).rowCount;
      const files = (await c.query(
        `DELETE FROM public.tb_cm_file WHERE target_id = ANY($1::text[])`, [companies])).rowCount;
      // ★ 회사를 지우면 이 검증이 태운 단체코드도 함께 사라진다 — 다음 실행이 같은 번호를 쓴다.
      const removed = (await c.query(
        `DELETE FROM public.tb_s080_companies WHERE company_id = ANY($1::text[])`, [companies])).rowCount;
      return { invoices, deposits, contracts, files, removed };
    });
    await pool.query(`DELETE FROM public.tb_s080_auth_session WHERE bbiyong_member_id = 9935`);
    console.log(
      `  청구서 ${cleanup.invoices} · 예치금 ${cleanup.deposits} · 계약 ${cleanup.contracts} · ` +
      `서류 ${cleanup.files} · 회사 ${cleanup.removed} 삭제`,
    );

    /* ★ 정말 남지 않았는지 확인한다 — 「지웠다」고 출력하는 것과 다른 일이다. */
    const left = await asOperator(async (c) => {
      const co = await c.query(
        `SELECT count(*)::int n FROM public.tb_s080_companies WHERE company_id = ANY($1::text[])`, [companies]);
      const ct = await c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]);
      return { companies: co.rows[0].n, contracts: ct.rows[0].n };
    });
    check('★ 흔적이 남지 않았다', left.companies === 0 && left.contracts === 0,
      `회사 ${left.companies} · 계약 ${left.contracts}`);

    /*
     * ★★ 호실상태를 되맞춘다 — **계약을 SQL 로 지웠기 때문이다.**
     *
     * 호실상태는 계약이 정한다(`packages/api/src/db/spaceStatus.ts`). 업무 경로는 계약을
     * 지우지 않고 종료·취소로 닫으므로 앱이 알아서 맞춘다. 뒷정리는 그 길을 건너뛰고
     * 행을 지우므로, 여기서 한 번 다시 세지 않으면 **개발계 DB 에 「입주중」이 남는다**
     * (실측 2026-10-03: 검증을 몇 번 돌리자 72실 중 18실이 어긋났다).
     */
    const restored = await withCompanyScope({ role: 'operator', companyId: null }, (c) =>
      syncAllSpaceStatuses(c, 'verify-cleanup'),
    );
    if (restored > 0) console.log(`  호실상태 ${restored}실 되맞춤`);

    await closePool();
  }

  console.log(fail === 0 ? `\n통과 ${pass}항목` : `\n실패 ${fail}건 / ${pass + fail}항목`);
  if (failures.length > 0) for (const f of failures) console.log(`  - ${f}`);
  const short = itemCountGate({ expected: EXPECTED_ITEMS, actual: pass + fail, script: 'verify-3-5.js' });
  process.exit(fail === 0 && !short ? 0 : 1);
})().catch(async (e) => {
  console.error('✘ 검증 중 오류:', e);
  try { await closePool(); } catch {}
  process.exit(1);
});
