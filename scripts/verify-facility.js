/**
 * 센터 관리(s030100010) 검증 — **실제 라우트로** 도는가.
 *
 * ★ 이 검증이 지키는 것:
 *   ① 입주사 계정은 **어느 경로도** 열 수 없다 (403) — 주소를 직접 쳐도 자료가 안 나간다
 *   ② 건물 ▸ 층 ▸ 호실 ▸ 회의실을 만들고 고칠 수 있다
 *   ③ 만든 호실이 **계약 화면의 호실 목록(`GET /spaces`)에 나온다**
 *   ④ 「사용 안 함」으로 바꾸면 그 목록에서 **사라진다** (지난 계약서는 그대로)
 *   ⑤ 계약이 쓰는 호실은 **지울 수 없다** — 409 에 이유와 대안이 담긴다
 *   ⑥ 호실·회의실이 남은 층, 층이 남은 건물은 지울 수 없다
 *   ⑦ 이력이 없는 호실은 지울 수 있다
 *   ⑧ 건물·층 첨부(임대차계약서·층별 도면)가 **계약 서류와 같은 기계로** 붙는다 —
 *     종류당 한 장 · 바꿔치기 · 기록과 실물이 함께 사라진다 · 대상이 지워지면 함께 사라진다
 *   ⑨ 호실상태(공실·입주중·예약중)는 **계약이 정한다** — 손으로 바꿀 수 없다 (§10)
 *   ⑩ 「입주 가능 회사 수」만큼만 계약된다 (§11) — 호실마다 운영자가 정하고,
 *     **목록과 저장이 같은 답**을 낸다. 세는 단위는 **회사**다(한 회사의 계약 둘은 1곳)
 *
 * ★★ **넣은 것은 전부 지운다.** 개발계 공용 DB 라 흔적을 남기지 않는다 — 건물·층·호실·
 *    회의실·계약을 이 스크립트가 새로 만들어 쓰고 지운다. 기존 72실은 건드리지 않는다.
 *
 * 사용: npm run verify:facility
 */
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerFacilityRoutes } from '../packages/api/src/routes/facility.ts';
import { registerLookupRoutes } from '../packages/api/src/routes/lookups.ts';
import { registerContractRoutes } from '../packages/api/src/routes/contracts.ts';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { syncAllSpaceStatuses } from '../packages/api/src/db/spaceStatus.ts';
import { encrypt, hashSessionId, newSessionId } from '../packages/api/src/lib/crypto.ts';
import { syncSpaceStatuses } from '../packages/api/src/db/spaceStatus.ts';
import { countSpaceCompanies } from '../packages/api/src/db/facility.ts';
import { env } from '../packages/api/src/env.ts';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '../packages/shared/src/domain/contract-files.ts';

/** ★ RLS 가 걸린 표는 `pool.query` 로 못 읽는다 — GUC 없는 커넥션은 0행을 본다. */
const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);

const EXPECTED_ITEMS = 132;
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

const TAG = `verify-facility-${Date.now()}`;
const STAMP = String(Date.now()).slice(-9);

/** 검증이 중간에 멈췄을 때 스토리지에 남을 실물들. 끝에서 지운다. */
const orphanPaths = [];

/** 지울 것들. 끝에서 전부 되돌린다. */
const made = { buildings: [], floors: [], spaces: [], facilities: [], companies: [] };

/* ── 첨부 검증에 쓰는 것들 ───────────────────────────────────────────────── */

const BUCKET = 'erp-files';
const STORAGE_HEADERS = {
  authorization: `Bearer ${env.storageServiceKey}`,
  apikey: env.storageServiceKey,
};
const objectUrl = (path) =>
  `${env.storageUrl}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** 스토리지에 실물이 있는가 — **service_role 로** 본다(비공개 버킷이라 그래야 보인다). */
async function objectExists(path) {
  const res = await fetch(objectUrl(path), { headers: STORAGE_HEADERS });
  return res.status === 200;
}

/** 최소한의 JPEG. 스토리지는 내용을 검사하지 않지만 진짜 파일로 확인한다. */
const jpeg = (size) => {
  const b = Buffer.alloc(Math.max(size, 4));
  b[0] = 0xff;
  b[1] = 0xd8;
  b[b.length - 2] = 0xff;
  b[b.length - 1] = 0xd9;
  return b;
};

/** ★ 한글 파일 이름은 **인코딩해서** 헤더에 넣는다 — 그대로 넣으면 규격 위반이다. */
const upHeaders = {
  'content-type': 'image/jpeg',
  'x-file-name': encodeURIComponent('임대차계약서.jpg'),
};

const json = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return { __raw: res.body };
  }
};

async function makeSession(memberId) {
  const erpSid = hashSessionId(newSessionId());
  await pool.query(
    `INSERT INTO public.tb_s080_auth_session
       (erp_sid, bbiyong_member_id, org_tp, org_id,
        bbiyong_access_encrypted, bbiyong_refresh_encrypted, expires_at)
     VALUES ($1, $2, 'S', 1, $3, $4, now() + interval '1 hour')`,
    [erpSid, memberId, encrypt(`vf-access.${memberId}`), encrypt(`vf-refresh.${memberId}`)],
  );
  return erpSid;
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
  /*
   * ★ 바이트 본문 파서. 진짜 서버는 `index.ts` 에서 한 번 등록한다 — 여기서도 **같은
   *   값**을 쓴다(형식 3종 · 10MB). 이것이 없으면 첨부 업로드가 전부 415 다.
   */
  app.addContentTypeParser(
    [...ALLOWED_MIME_TYPES],
    { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES },
    (_req, body, done) => done(null, body),
  );
  registerFacilityRoutes(app);
  registerLookupRoutes(app);
  registerContractRoutes(app);
  return app;
}

(async () => {
  const opSid = await makeSession(9941);
  const tnSid = await makeSession(9942);

  const op = buildApp({ s020MemberId: 9941, s020OrgId: 1, companyId: null, role: 'operator', erpSid: opSid });
  const tenant = buildApp({
    s020MemberId: 9942,
    s020OrgId: 2,
    // ★ 입주사 세션 — 자기 회사만 보는 역할이다.
    companyId: 'VF-TENANT',
    role: 'tenant',
    erpSid: tnSid,
  });

  try {
    /* ── 1. 입주사는 어느 경로도 열 수 없다 ─────────────────────────────── */
    console.log('1. 입주사 계정 — 주소를 직접 쳐도 403');
    {
      const paths = [
        ['GET', '/facility/tree'],
        ['POST', '/facility/buildings'],
        ['POST', '/facility/floors'],
        ['POST', '/facility/spaces'],
        ['POST', '/facility/facilities'],
        ['GET', '/facility/floors/x/spaces'],
        ['GET', '/facility/floors/x/facilities'],
        ['DELETE', '/facility/spaces/x'],
      ];
      for (const [method, url] of paths) {
        const res = await tenant.inject({ method, url, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
        check(`${method} ${url} → 403`, res.statusCode === 403, `${res.statusCode} ${res.body.slice(0, 80)}`);
      }
    }

    /* ── 2. 건물 ▸ 층 ▸ 호실 ▸ 회의실을 만든다 ──────────────────────────── */
    console.log('\n2. 건물 · 층 · 호실 · 회의실 등록');
    let buildId;
    let floorId;
    let spaceId;
    let facilityId;
    {
      let res = await op.inject({
        method: 'POST',
        url: '/facility/buildings',
        payload: { name: `검증센터 ${TAG}`, address: '서울시 검증구', ownerName: '건물주', memo: TAG },
      });
      buildId = json(res).buildId;
      made.buildings.push(buildId);
      check('건물 등록 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      res = await op.inject({
        method: 'POST',
        url: '/facility/floors',
        payload: { buildingId: buildId, floorNo: 'B1', name: '검증층', monthlyRent: '1,000,000', hasLounge: true },
      });
      floorId = json(res).floorId;
      made.floors.push(floorId);
      check('층 등록 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 층 번호가 글자다 — 「B1」이 들어간다', typeof floorId === 'string' && floorId.length > 0);

      res = await op.inject({
        method: 'POST',
        url: '/facility/spaces',
        payload: {
          floorId,
          roomName: `VF-${STAMP}`,
          roomType: 'VR',
          standardFee: '500,000',
          deposit: '1,000,000',
          areaSqm: '12.5',
          capacity: '2',
          memo: TAG,
        },
      });
      spaceId = json(res).spaceId;
      made.spaces.push(spaceId);
      check('호실 등록 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      res = await op.inject({
        method: 'POST',
        url: '/facility/facilities',
        payload: { floorId, name: `검증회의실 ${STAMP}`, capacity: '6', halfHourFee: '5,000', openTime: '09:00', closeTime: '18:00' },
      });
      facilityId = json(res).facilityId;
      made.facilities.push(facilityId);
      check('회의실 등록 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      /* 콤마·소수가 제대로 들어갔는지 DB 에서 되읽는다 — 화면이 콤마를 붙여 보낸다. */
      const row = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT room_no, room_name, room_type, status, standard_fee, deposit, area_sqm, capacity, is_active
             FROM public.tb_s080_spaces WHERE space_id = $1`,
          [spaceId],
        );
        return rows[0];
      });
      check('★ 콤마가 섞인 금액이 숫자로 들어갔다', row.standard_fee === 500000 && row.deposit === 1000000,
        `${row.standard_fee} / ${row.deposit}`);
      /* ★ `numeric` 은 자릿수를 맞춰 `12.50` 으로 돌아온다 — 값으로 비교한다.
         문자로 비교하면 소수 자릿수가 바뀌는 날 이 검사가 거짓으로 터진다. */
      check('★ 평수는 소수를 지키고 정원도 들어갔다', Number(row.area_sqm) === 12.5 && row.capacity === 2,
        `${row.area_sqm} / ${row.capacity}`);
      check('★ room_no 는 서버가 만든다 (12자리)', /^[0-9a-f]{12}$/.test(row.room_no ?? ''), String(row.room_no));
      check('상태 기본값은 공실(E)', row.status === 'E', String(row.status));
      check('사용함으로 시작한다', row.is_active === true, String(row.is_active));
    }

    /* ── 3. 트리와 목록이 받아진다 ─────────────────────────────────────── */
    console.log('\n3. 트리 · 목록 조회');
    {
      const tree = json(await op.inject({ method: 'GET', url: '/facility/tree' }));
      const b = tree.buildings.find((x) => x.buildId === buildId);
      const f = tree.floors.find((x) => x.floorId === floorId);
      check('트리에 새 건물이 있다', !!b, String(b));
      check('건물의 층 개수가 1', b?.floorCount === 1, String(b?.floorCount));
      check('층의 호실·회의실 개수가 각 1', f?.spaceCount === 1 && f?.facilityCount === 1,
        `${f?.spaceCount} / ${f?.facilityCount}`);
      check('★ 코드가 함께 온다 (ROOM_TP · ROOM_ST)',
        tree.codes.some((c) => c.category === 'ROOM_TP') && tree.codes.some((c) => c.category === 'ROOM_ST'));

      const sp = json(await op.inject({ method: 'GET', url: `/facility/floors/${floorId}/spaces` }));
      check('호실 목록에 나온다', sp.spaces.length === 1 && sp.spaces[0].spaceId === spaceId);
      check('계약 이력은 0건', sp.spaces[0].allContracts === 0, String(sp.spaces[0].allContracts));

      const fc = json(await op.inject({ method: 'GET', url: `/facility/floors/${floorId}/facilities` }));
      check('회의실 목록에 나온다', fc.facilities.length === 1 && fc.facilities[0].facilityId === facilityId);
      check('걸린 예약은 0건', fc.facilities[0].liveReservations === 0, String(fc.facilities[0].liveReservations));
    }

    /* ── 4. ★ 만든 호실이 계약 화면의 호실 목록에 나온다 ────────────────── */
    console.log('\n4. ★ 계약 화면의 호실 목록(GET /spaces)에 나온다');
    {
      const before = json(await op.inject({ method: 'GET', url: '/spaces' }));
      check('★★ 새 호실이 계약 폼 목록에 있다', before.spaces.some((s) => s.spaceId === spaceId),
        `${before.spaces.length}실 중 없음`);

      /* 「사용 안 함」으로 바꾼다 — 삭제가 아니다. */
      const res = await op.inject({
        method: 'PATCH',
        url: `/facility/spaces/${spaceId}`,
        payload: { roomType: 'VR', roomName: `VF-${STAMP}`, isActive: false },
      });
      check('사용 안 함으로 수정 200', res.statusCode === 200, String(res.statusCode));

      const after = json(await op.inject({ method: 'GET', url: '/spaces' }));
      check('★★ 사용 안 함이면 계약 폼 목록에서 사라진다', !after.spaces.some((s) => s.spaceId === spaceId));

      const admin = json(await op.inject({ method: 'GET', url: `/facility/floors/${floorId}/spaces` }));
      check('★ 센터 관리 화면에는 그대로 보인다 — 다시 켤 수 있어야 한다',
        admin.spaces.some((s) => s.spaceId === spaceId && s.isActive === false));

      /* 다시 켠다 — 이어지는 검사가 계약을 붙인다. */
      await op.inject({
        method: 'PATCH',
        url: `/facility/spaces/${spaceId}`,
        payload: { roomType: 'VR', roomName: `VF-${STAMP}`, isActive: true },
      });
    }

    /* ── 5. ★★ 쓰고 있는 호실은 지울 수 없다 ───────────────────────────── */
    console.log('\n5. ★★ 계약이 쓰는 호실 — 지우려 하면 막힌다');
    {
      /* 계약을 한 건 만든다. 계약 라우트를 그대로 쓴다 — 손으로 INSERT 하지 않는다. */
      const companyId = `VF-${STAMP}`;
      made.companies.push(companyId);
      await asOperator(async (c) => {
        await c.query(
          `INSERT INTO public.tb_s080_companies
             (company_id, build_id, company_name, ceo_name, tel, email, memo, updated_at)
           VALUES ($1, $2, $3, '김검증', '010-1234-5678', $4, $5, now())`,
          [companyId, buildId, `검증회사 ${TAG}`, `vf-${STAMP}@example.test`, TAG],
        );
        await c.query(
          `INSERT INTO public.tb_cm_file
             (id, operator_id, target_type, target_id, file_purpose, original_name,
              storage_path, file_size, mime_type)
           VALUES ($1, 1, 'COMPANY', $2, 'CEO_ID', 'id.png', $3, 1, 'image/png')`,
          [randomUUID(), companyId, `verify/${companyId}/id.png`],
        );
      });

      const res = await op.inject({
        method: 'POST',
        url: '/contracts',
        payload: {
          companyId,
          buildId,
          contractRoom: `VF${STAMP}`,
          paymentMethod: 'M',
          periodMonths: 12,
          freeMonths: 0,
          contractDate: '2026-02-25',
          startDate: '2026-03-15',
          status: 'confirmed',
          memo: TAG,
          spaces: [{ roomType: 'VR', spaceId, standardFee: 500000, deposit: 0, monthlyFee: 500000, vatYn: true }],
        },
      });
      check('계약 확정 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 160)}`);

      const list = json(await op.inject({ method: 'GET', url: `/facility/floors/${floorId}/spaces` }));
      const row = list.spaces.find((s) => s.spaceId === spaceId);
      check('★ 목록이 계약 건수를 함께 내려준다', row?.allContracts === 1 && row?.liveContracts === 1,
        `${row?.allContracts} / ${row?.liveContracts}`);

      const del = await op.inject({ method: 'DELETE', url: `/facility/spaces/${spaceId}` });
      const body = json(del);
      check('★★★ 409 로 막힌다', del.statusCode === 409, `${del.statusCode} ${del.body.slice(0, 120)}`);
      check('★ 사유에 건수가 있다', (body.message ?? '').includes('계약 1건'), body.message);
      check('★ 대안(「사용 안 함」)까지 적혀 있다', (body.message ?? '').includes('사용 안 함'), body.message);

      const still = await asOperator(async (c) => {
        const { rows } = await c.query(`SELECT count(*)::int n FROM public.tb_s080_spaces WHERE space_id = $1`, [spaceId]);
        return rows[0].n;
      });
      check('★ 실제로 지워지지 않았다', still === 1, String(still));
    }

    /* ── 6. 호실·회의실이 남은 층, 층이 남은 건물은 못 지운다 ───────────── */
    console.log('\n6. 비우지 않으면 층 · 건물을 지울 수 없다');
    {
      let res = await op.inject({ method: 'DELETE', url: `/facility/floors/${floorId}` });
      check('층 삭제 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유에 호실·회의실 수가 있다',
        (json(res).message ?? '').includes('호실 1실') && (json(res).message ?? '').includes('회의실 1개'),
        json(res).message);

      res = await op.inject({ method: 'DELETE', url: `/facility/buildings/${buildId}` });
      check('건물 삭제 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유에 층·입주사·계약이 함께 적힌다',
        (json(res).message ?? '').includes('층 1개') && (json(res).message ?? '').includes('입주사 1곳'),
        json(res).message);
    }

    /* ── 7. 이력이 없는 호실은 지울 수 있다 ───────────────────────────── */
    console.log('\n7. 계약 이력이 없는 호실 · 예약 없는 회의실은 지울 수 있다');
    {
      const res = await op.inject({
        method: 'POST',
        url: '/facility/spaces',
        payload: { floorId, roomName: `VF-DEL-${STAMP}`, roomType: 'VR', memo: TAG },
      });
      const tmp = json(res).spaceId;
      made.spaces.push(tmp);

      const del = await op.inject({ method: 'DELETE', url: `/facility/spaces/${tmp}` });
      check('★ 이력 없는 호실은 200 으로 지워진다', del.statusCode === 200, `${del.statusCode} ${del.body.slice(0, 120)}`);

      const gone = await asOperator(async (c) => {
        const { rows } = await c.query(`SELECT count(*)::int n FROM public.tb_s080_spaces WHERE space_id = $1`, [tmp]);
        return rows[0].n;
      });
      check('실제로 사라졌다', gone === 0, String(gone));

      const delFac = await op.inject({ method: 'DELETE', url: `/facility/facilities/${facilityId}` });
      check('★ 예약 없는 회의실도 지워진다', delFac.statusCode === 200, `${delFac.statusCode} ${delFac.body.slice(0, 120)}`);
    }

    /* ── 8. 없는 것을 고치거나 지우면 404 ─────────────────────────────── */
    console.log('\n8. 없는 대상은 404');
    {
      const a = await op.inject({ method: 'PATCH', url: '/facility/buildings/NOPE-VF', payload: { name: 'x' } });
      check('없는 건물 수정 404', a.statusCode === 404, String(a.statusCode));
      const b = await op.inject({ method: 'DELETE', url: '/facility/spaces/NOPE-VF' });
      check('없는 호실 삭제 404', b.statusCode === 404, String(b.statusCode));
      const c = await op.inject({ method: 'POST', url: '/facility/spaces', payload: { floorId: 'NOPE', roomType: 'VR' } });
      check('없는 층에 호실 추가 404', c.statusCode === 404, String(c.statusCode));
      const d = await op.inject({ method: 'POST', url: '/facility/buildings', payload: {} });
      check('건물명 없이 등록하면 400', d.statusCode === 400, String(d.statusCode));
    }
    /* ── 9. 건물·층 첨부 ────────────────────────────────────────────────── */
    console.log('\n9. 건물·층 첨부 — 계약 서류와 같은 기계로 붙는가');
    {
      /* 이 절만 쓰는 건물·층을 새로 만든다 — 앞 절의 상태에 기대지 않는다. */
      let res = await op.inject({
        method: 'POST',
        url: '/facility/buildings',
        payload: { name: `VF-ATT-${STAMP}`, memo: TAG },
      });
      const aBuild = json(res).buildId;
      made.buildings.push(aBuild);
      res = await op.inject({
        method: 'POST',
        url: '/facility/floors',
        payload: { buildingId: aBuild, floorNo: '9', name: 'VF-ATT층' },
      });
      const aFloor = json(res).floorId;
      made.floors.push(aFloor);

      /* 입주사는 셋 다 막힌다. ★ 주소를 직접 쳐도 자료가 나가지 않는다. */
      for (const [method, url] of [
        ['GET', `/facility/buildings/${aBuild}/files`],
        ['POST', `/facility/buildings/${aBuild}/files`],
        ['DELETE', `/facility/buildings/${aBuild}/files/x`],
        ['GET', `/facility/floors/${aFloor}/files`],
      ]) {
        const r = await tenant.inject({ method, url, payload: method === 'POST' ? jpeg(64) : undefined, headers: upHeaders });
        check(`입주사 ${method} ${url.replace(aBuild, '{b}').replace(aFloor, '{f}')} 403`, r.statusCode === 403, String(r.statusCode));
      }

      /* 없는 대상 404 — 라우트가 있는데 대상이 없는 경우다. */
      const miss = await op.inject({ method: 'GET', url: '/facility/buildings/NOPE-VF/files' });
      check('없는 건물의 첨부 목록 404', miss.statusCode === 404, String(miss.statusCode));

      /* 처음엔 비어 있다. */
      const empty = await op.inject({ method: 'GET', url: `/facility/buildings/${aBuild}/files` });
      check('새 건물의 첨부는 0건', (json(empty).files ?? []).length === 0, empty.body.slice(0, 120));

      /* 이름 없이 보내면 400. */
      const noName = await op.inject({
        method: 'POST',
        url: `/facility/buildings/${aBuild}/files`,
        payload: jpeg(64),
        headers: { 'content-type': 'image/jpeg' },
      });
      check('파일 이름 없이 올리면 400', noName.statusCode === 400, `${noName.statusCode} ${noName.body.slice(0, 100)}`);

      /* 허용하지 않는 형식은 **파서가** 막는다 — 415. */
      const badType = await op.inject({
        method: 'POST',
        url: `/facility/buildings/${aBuild}/files`,
        payload: 'plain',
        headers: { 'content-type': 'text/plain', 'x-file-name': 'x.txt' },
      });
      check('JPG·PNG·PDF 가 아니면 415', badType.statusCode === 415, String(badType.statusCode));

      /* ① 건물에 임대차계약서. */
      const up1 = await op.inject({
        method: 'POST',
        url: `/facility/buildings/${aBuild}/files`,
        payload: jpeg(2048),
        headers: upHeaders,
      });
      check('건물 첨부 201', up1.statusCode === 201, `${up1.statusCode} ${up1.body.slice(0, 160)}`);
      check('★ 처음 올린 것이라 교체가 아니다', json(up1).replaced === false, String(json(up1).replaced));
      check('서명 URL 이 왔다', typeof json(up1).file?.url === 'string' && json(up1).file.url.length > 0);

      const row1 = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT id, target_type, file_purpose, storage_path, original_name, operator_id
             FROM public.tb_cm_file WHERE target_type = 'BUILDING' AND target_id = $1`,
          [aBuild],
        );
        return rows;
      });
      check('★ tb_cm_file 에 BUILDING 한 줄', row1.length === 1, String(row1.length));
      check('★ file_purpose 가 BUILDING_CONTRACT', row1[0]?.file_purpose === 'BUILDING_CONTRACT', row1[0]?.file_purpose);
      check('★ 운영사 번호가 건물에서 왔다(1)', row1[0]?.operator_id === 1, String(row1[0]?.operator_id));
      check('한글 파일 이름이 그대로 들어갔다', row1[0]?.original_name === '임대차계약서.jpg', row1[0]?.original_name);
      check('경로가 {운영사}/buildings/{id}/BUILDING_CONTRACT/… 모양이다',
        row1[0]?.storage_path === `1/buildings/${aBuild}/BUILDING_CONTRACT/${row1[0]?.id}.jpg`,
        row1[0]?.storage_path);
      check('★ 스토리지에 실물이 있다', await objectExists(row1[0].storage_path), row1[0].storage_path);

      /* ② 같은 건물에 또 올리면 **바꿔치운다** — 두 장이 되지 않는다. */
      const up2 = await op.inject({
        method: 'POST',
        url: `/facility/buildings/${aBuild}/files`,
        payload: jpeg(3072),
        headers: upHeaders,
      });
      check('두 번째 업로드 201', up2.statusCode === 201, String(up2.statusCode));
      check('★ 교체했다고 알려 준다', json(up2).replaced === true, String(json(up2).replaced));

      const row2 = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT id, storage_path FROM public.tb_cm_file WHERE target_type = 'BUILDING' AND target_id = $1`,
          [aBuild],
        );
        return rows;
      });
      check('★ 그래도 한 줄이다', row2.length === 1, String(row2.length));
      check('새 실물이 있다', await objectExists(row2[0].storage_path), row2[0].storage_path);
      check('★ 옛 실물이 스토리지에서 사라졌다', !(await objectExists(row1[0].storage_path)), row1[0].storage_path);

      /* ③ 층에 도면. 건물 것과 섞이지 않는다. */
      const upF = await op.inject({
        method: 'POST',
        url: `/facility/floors/${aFloor}/files`,
        payload: jpeg(1024),
        headers: { 'content-type': 'image/jpeg', 'x-file-name': encodeURIComponent('9층도면.jpg') },
      });
      check('층 첨부 201', upF.statusCode === 201, `${upF.statusCode} ${upF.body.slice(0, 160)}`);

      const fRow = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT id, file_purpose, storage_path FROM public.tb_cm_file WHERE target_type = 'FLOOR' AND target_id = $1`,
          [aFloor],
        );
        return rows;
      });
      check('★ file_purpose 가 FLOOR_PLAN', fRow[0]?.file_purpose === 'FLOOR_PLAN', fRow[0]?.file_purpose);
      check('층 경로가 …/floors/… 다', (fRow[0]?.storage_path ?? '').includes(`/floors/${aFloor}/FLOOR_PLAN/`), fRow[0]?.storage_path);

      const bList = await op.inject({ method: 'GET', url: `/facility/buildings/${aBuild}/files` });
      check('★ 건물 목록에는 건물 것만 1건', (json(bList).files ?? []).length === 1, bList.body.slice(0, 120));
      const fList = await op.inject({ method: 'GET', url: `/facility/floors/${aFloor}/files` });
      check('★ 층 목록에는 층 것만 1건', (json(fList).files ?? []).length === 1, fList.body.slice(0, 120));
      check('목록도 storage_path 를 내보내지 않는다',
        !(fList.body.includes('storage_path') || fList.body.includes('storagePath')), fList.body.slice(0, 120));

      /* ④ 삭제 — 기록과 실물이 함께 사라진다. */
      const del = await op.inject({
        method: 'DELETE',
        url: `/facility/buildings/${aBuild}/files/${row2[0].id}`,
      });
      check('첨부 삭제 204', del.statusCode === 204, String(del.statusCode));
      const after = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT count(*)::int n FROM public.tb_cm_file WHERE target_type = 'BUILDING' AND target_id = $1`,
          [aBuild],
        );
        return rows[0].n;
      });
      check('★ 기록이 사라졌다', after === 0, String(after));
      check('★ 실물도 사라졌다', !(await objectExists(row2[0].storage_path)), row2[0].storage_path);
      const delAgain = await op.inject({
        method: 'DELETE',
        url: `/facility/buildings/${aBuild}/files/${row2[0].id}`,
      });
      check('두 번 지우면 404', delAgain.statusCode === 404, String(delAgain.statusCode));

      /* ⑤ 층을 지우면 그 층의 첨부도 함께 사라진다 — 고아 기록을 남기지 않는다. */
      const floorPath = fRow[0].storage_path;
      const delFloor = await op.inject({ method: 'DELETE', url: `/facility/floors/${aFloor}` });
      check('빈 층은 지워진다', delFloor.statusCode === 200, `${delFloor.statusCode} ${delFloor.body.slice(0, 120)}`);
      const fLeft = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT count(*)::int n FROM public.tb_cm_file WHERE target_type = 'FLOOR' AND target_id = $1`,
          [aFloor],
        );
        return rows[0].n;
      });
      check('★ 층과 함께 첨부 기록도 사라졌다', fLeft === 0, String(fLeft));
      check('★ 층 도면 실물도 사라졌다', !(await objectExists(floorPath)), floorPath);
    }
    /* ── 10. ★★★ 호실상태는 계약이 정한다 ──────────────────────────────── */
    console.log('\n10. ★★★ 호실상태 — 계약이 정한다 (손으로 못 바꾼다)');
    {
      /** 호실 하나의 지금 상태. ★ 라우트가 아니라 **DB 를 본다** — 실제로 쓰였는지가 핵심이다. */
      const statusOf = (id) =>
        asOperator(async (c) => {
          const { rows } = await c.query(`SELECT status FROM public.tb_s080_spaces WHERE space_id = $1`, [id]);
          return rows[0]?.status ?? null;
        });

      /* §5 에서 확정한 계약이 있다 — 그 호실은 이미 「입주중」이어야 한다. */
      check('★ 확정 계약이 있는 호실은 「입주중」(O)', (await statusOf(spaceId)) === 'O', await statusOf(spaceId));

      /* 이 절에서만 쓰는 호실 둘. */
      const mk = async (name) => {
        const r = await op.inject({
          method: 'POST',
          url: '/facility/spaces',
          payload: { floorId, roomName: name, roomType: 'VR', memo: TAG },
        });
        const id = json(r).spaceId;
        made.spaces.push(id);
        return id;
      };
      const roomA = await mk(`VF-ST-A-${STAMP}`);
      const roomB = await mk(`VF-ST-B-${STAMP}`);
      check('새 호실은 「공실」(E) 로 들어간다', (await statusOf(roomA)) === 'E', await statusOf(roomA));

      /* 계약대기(draft) — 「예약중」(R) */
      const companyId2 = `VF2-${STAMP}`;
      made.companies.push(companyId2);
      await asOperator(async (c) => {
        await c.query(
          `INSERT INTO public.tb_s080_companies
             (company_id, build_id, company_name, ceo_name, tel, email, memo, updated_at)
           VALUES ($1, $2, $3, '박검증', '010-2222-3333', $4, $5, now())`,
          [companyId2, buildId, `검증회사2 ${TAG}`, `vf2-${STAMP}@example.test`, TAG],
        );
        await c.query(
          `INSERT INTO public.tb_cm_file
             (id, operator_id, target_type, target_id, file_purpose, original_name,
              storage_path, file_size, mime_type)
           VALUES ($1, 1, 'COMPANY', $2, 'CEO_ID', 'id.png', $3, 1, 'image/png')`,
          [randomUUID(), companyId2, `verify/${companyId2}/id.png`],
        );
      });

      const mkContract = async (spaces, status) => {
        const r = await op.inject({
          method: 'POST',
          url: '/contracts',
          payload: {
            companyId: companyId2,
            buildId,
            contractRoom: `VFS${STAMP}`,
            paymentMethod: 'M',
            periodMonths: 12,
            freeMonths: 0,
            contractDate: '2026-02-25',
            startDate: '2026-03-15',
            status,
            memo: TAG,
            spaces: spaces.map((id, i) => ({
              roomType: 'VR', spaceId: id, standardFee: 100000, deposit: 0, monthlyFee: 100000, vatYn: true, seq: i + 1,
            })),
          },
        });
        return { code: r.statusCode, id: json(r).contractId, body: r.body };
      };

      const c1 = await mkContract([roomA, roomB], 'draft');
      check('계약대기 생성 201', c1.code === 201, `${c1.code} ${c1.body.slice(0, 140)}`);
      check('★ 계약대기면 「예약중」(R)', (await statusOf(roomA)) === 'R', await statusOf(roomA));
      check('★ 같은 계약의 다른 호실도 「예약중」', (await statusOf(roomB)) === 'R', await statusOf(roomB));

      /* 계약대기 상태에서 호실을 빼면 그 호실만 「공실」로 돌아온다.
         ★ 확정된 계약은 조건을 못 고친다(409 contract_locked) — 그래서 대기에서 본다. */
      const patch = await op.inject({
        method: 'PATCH',
        url: `/contracts/${c1.id}`,
        payload: {
          companyId: companyId2, buildId, contractRoom: `VFS${STAMP}`, paymentMethod: 'M',
          periodMonths: 12, freeMonths: 0, contractDate: '2026-02-25', startDate: '2026-03-15',
          status: 'draft', memo: TAG,
          spaces: [{ roomType: 'VR', spaceId: roomA, standardFee: 100000, deposit: 0, monthlyFee: 100000, vatYn: true, seq: 1 }],
        },
      });
      check('계약 수정 200', patch.statusCode === 200, `${patch.statusCode} ${patch.body.slice(0, 140)}`);
      check('★★ 계약에서 뺀 호실은 「공실」로 돌아온다', (await statusOf(roomB)) === 'E', await statusOf(roomB));
      check('★ 남은 호실은 그대로 「예약중」', (await statusOf(roomA)) === 'R', await statusOf(roomA));

      /* 확정 — 「입주중」(O) */
      const conf = await op.inject({ method: 'POST', url: `/contracts/${c1.id}/status`, payload: { to: 'confirmed' } });
      check('확정 전이 200', conf.statusCode === 200, `${conf.statusCode} ${conf.body.slice(0, 140)}`);
      check('★★ 확정하면 「입주중」(O)', (await statusOf(roomA)) === 'O', await statusOf(roomA));

      /* 손으로 못 바꾼다 — 호실 수정에 status 를 실어 보내도 무시된다 */
      const force = await op.inject({
        method: 'PATCH',
        url: `/facility/spaces/${roomA}`,
        payload: { floorId, roomName: `VF-ST-A-${STAMP}`, roomType: 'VR', status: 'E', memo: TAG },
      });
      check('호실 수정 200', force.statusCode === 200, String(force.statusCode));
      check('★★★ 손으로 「공실」을 보내도 덮이지 않는다', (await statusOf(roomA)) === 'O', await statusOf(roomA));

      /*
       * 센 쪽을 쓴다 — 확정 > 대기.
       *
       * ★★ 이 겹침은 **라우트로는 만들 수 없다.** 같은 호실·같은 계약호실 번호로 둘째
       *    계약을 넣으면 409(`space_taken`·`room_taken`)로 막힌다. 그래도 규칙은 필요하다 —
       *    재계약처럼 두 계약이 잠깐 겹치는 길이 생기면 그때 「예약중」으로 내려가면
       *    사람이 들어 있는 방이 비어 보인다. 그래서 **규칙이 사는 자리**에서 직접 본다.
       */
      const ghost = `VF-GHOST-${STAMP}`;
      await asOperator(async (c) => {
        await c.query(
          `INSERT INTO public.tb_s080_contracts
             (contract_id, company_id, build_id, contract_room, status, payment_method,
              period_months, free_months, contract_date, start_date, end_date, memo, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'draft', 'M', 12, 0, '2026-02-25', '2026-03-15', '2027-03-14', $5, now(), now())`,
          [ghost, companyId2, buildId, `VFG${STAMP}`, TAG],
        );
        await c.query(
          `INSERT INTO public.tb_s080_contract_spaces
             (contract_space_id, contract_id, company_id, seq, room_type, space_id,
              standard_fee, deposit, monthly_fee, vat_yn, vat_amount, payment_amount, created_at, updated_at)
           VALUES ($1, $2, $3, 1, 'VR', $4, 0, 0, 0, false, 0, 0, now(), now())`,
          [randomUUID(), ghost, companyId2, roomA],
        );
        await syncSpaceStatuses(c, [roomA], 'verify');
      });
      check('★★ 확정 > 대기 — 겹치면 「입주중」을 지킨다', (await statusOf(roomA)) === 'O', await statusOf(roomA));

      /* 겹친 대기를 치우면 다시 확정만 남는다 */
      await asOperator(async (c) => {
        await c.query(`DELETE FROM public.tb_s080_contract_spaces WHERE contract_id = $1`, [ghost]);
        await c.query(`DELETE FROM public.tb_s080_contracts WHERE contract_id = $1`, [ghost]);
        await syncSpaceStatuses(c, [roomA], 'verify');
      });
      check('★ 대기가 사라져도 확정이 남아 「입주중」', (await statusOf(roomA)) === 'O', await statusOf(roomA));

      /* 종료하면 「공실」로 돌아온다 */
      const term = await op.inject({
        method: 'POST',
        url: `/contracts/${c1.id}/status`,
        payload: { to: 'terminated', terminatedDate: '2026-04-30', terminationReason: TAG },
      });
      check('종료 전이 200', term.statusCode === 200, `${term.statusCode} ${term.body.slice(0, 140)}`);
      check('★★ 계약이 끝나면 「공실」(E) 로 돌아온다', (await statusOf(roomA)) === 'E', await statusOf(roomA));

      /* 전체가 계약과 맞는가 — 어긋난 호실이 하나도 없어야 한다 */
      const drift = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT count(*)::int n
             FROM public.tb_s080_spaces s
             JOIN LATERAL (
               SELECT CASE
                        WHEN bool_or(k.status = 'confirmed') THEN 'O'
                        WHEN bool_or(k.status = 'draft')     THEN 'R'
                        ELSE 'E'
                      END AS next
                 FROM public.tb_s080_contract_spaces cs
                 LEFT JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
                WHERE cs.space_id = s.space_id
             ) x ON true
            WHERE s.status IS DISTINCT FROM x.next`,
        );
        return rows[0].n;
      });
      check('★★★ 계약과 어긋난 호실이 하나도 없다', drift === 0, String(drift));
    }
    /* ── 11. ★★★ 입주 가능 회사 수 — 호실이 정한 만큼만 계약된다 ────────── */
    console.log('\n11. ★★★ 입주 가능 회사 수 — 호실이 정한 만큼만 계약된다');
    {
      /** 호실이 정한 수. ★ 라우트가 아니라 **DB 를 본다** — 실제로 쓰였는지가 핵심이다. */
      const maxOf = (id) =>
        asOperator(async (c) => {
          const { rows } = await c.query(
            `SELECT max_companies FROM public.tb_s080_spaces WHERE space_id = $1`,
            [id],
          );
          return rows[0]?.max_companies ?? null;
        });

      /* ① 기본값 — 안 보내면 1곳이다 */
      const mkRoom = async (payload) => {
        const r = await op.inject({
          method: 'POST',
          url: '/facility/spaces',
          payload: { floorId, roomType: 'R1', memo: TAG, ...payload },
        });
        if (r.statusCode === 201) made.spaces.push(json(r).spaceId);
        return r;
      };

      const roomDefault = await mkRoom({ roomName: `VF-MX-D-${STAMP}` });
      check('새 호실 생성 201', roomDefault.statusCode === 201, String(roomDefault.statusCode));
      const defaultId = json(roomDefault).spaceId;
      check('★ 안 보내면 1곳으로 들어간다 (기본값)', (await maxOf(defaultId)) === 1, String(await maxOf(defaultId)));

      /* ② 1 미만은 받지 않는다 — 0 이면 아무도 고를 수 없는 방이 된다 */
      const zero = await mkRoom({ roomName: `VF-MX-Z-${STAMP}`, maxCompanies: 0 });
      check('★ 0 곳으로는 만들 수 없다 (400)', zero.statusCode === 400, `${zero.statusCode} ${zero.body.slice(0, 120)}`);
      check('★ 이유를 말한다', json(zero).message?.includes('입주 가능 회사 수'), json(zero).message);

      const patchZero = await op.inject({
        method: 'PATCH',
        url: `/facility/spaces/${defaultId}`,
        payload: { floorId, roomName: `VF-MX-D-${STAMP}`, roomType: 'R1', maxCompanies: -1, memo: TAG },
      });
      check('★ 음수로 고칠 수도 없다 (400)', patchZero.statusCode === 400, String(patchZero.statusCode));
      check('★ 거절된 값은 저장되지 않았다', (await maxOf(defaultId)) === 1, String(await maxOf(defaultId)));

      /* ③ 운영자가 2곳으로 올린다 */
      const room = json(await mkRoom({ roomName: `VF-MX-A-${STAMP}`, maxCompanies: 2 })).spaceId;
      check('★ 2곳으로 만들 수 있다', (await maxOf(room)) === 2, String(await maxOf(room)));

      /* ④ 계약 폼의 호실 목록이 **같은 수**를 내려준다 — 화면과 서버가 같은 값을 본다 */
      const list = await op.inject({ method: 'GET', url: '/spaces' });
      const listed = json(list).spaces?.find((s) => s.spaceId === room);
      check('★★ 계약 폼 목록(GET /spaces)이 그 수를 내려준다', listed?.maxCompanies === 2, JSON.stringify(listed?.maxCompanies));

      /* 계약을 넣을 회사 셋 — ★ 세는 단위가 **회사**라 회사가 셋이어야 한다 */
      const makeCompany = async (n) => {
        const id = `VFM${n}-${STAMP}`;
        made.companies.push(id);
        await asOperator(async (c) => {
          await c.query(
            `INSERT INTO public.tb_s080_companies
               (company_id, build_id, company_name, ceo_name, tel, email, memo, updated_at)
             VALUES ($1, $2, $3, '최검증', '010-4444-5555', $4, $5, now())`,
            [id, buildId, `검증회사M${n} ${TAG}`, `vfm${n}-${STAMP}@example.test`, TAG],
          );
          /* 확정에 필요한 서류 — 행만 심는다(§10 과 같은 방식, 실물은 올리지 않는다). */
          await c.query(
            `INSERT INTO public.tb_cm_file
               (id, operator_id, target_type, target_id, file_purpose, original_name,
                storage_path, file_size, mime_type)
             VALUES ($1, 1, 'COMPANY', $2, 'CEO_ID', 'id.png', $3, 1, 'image/png')`,
            [randomUUID(), id, `verify/${id}/id.png`],
          );
        });
        return id;
      };
      const co1 = await makeCompany(1);
      const co2 = await makeCompany(2);
      const co3 = await makeCompany(3);

      let roomSeq = 0;
      const put = async (companyId, status) => {
        roomSeq += 1;
        const r = await op.inject({
          method: 'POST',
          url: '/contracts',
          payload: {
            companyId,
            buildId,
            /* ★ 계약호실(세무서 번호)은 겹치면 따로 막힌다 — 이 검증의 주제가 아니라 다르게 둔다. */
            contractRoom: `VFM${STAMP}-${roomSeq}`,
            paymentMethod: 'M',
            periodMonths: 12,
            freeMonths: 0,
            contractDate: '2026-02-25',
            startDate: '2026-03-15',
            status,
            memo: TAG,
            spaces: [
              { roomType: 'R1', spaceId: room, standardFee: 100000, deposit: 0, monthlyFee: 100000, vatYn: true, seq: 1 },
            ],
          },
        });
        return { code: r.statusCode, id: json(r).contractId, message: json(r).message, error: json(r).error };
      };

      /* ⑤ 2곳까지 들어간다 — 하나는 계약중, 하나는 계약대기(둘 다 「살아 있는 계약」이다) */
      const k1 = await put(co1, 'confirmed');
      check('1곳째 계약중 생성 201', k1.code === 201, `${k1.code} ${k1.message ?? ''}`);
      const k2 = await put(co2, 'draft');
      check('★ 2곳째 계약대기도 들어간다 (2곳까지)', k2.code === 201, `${k2.code} ${k2.message ?? ''}`);

      /* ⑥ 3곳째는 막힌다 — 이유에 **몇 곳까지인지**가 들어 있다 */
      const k3 = await put(co3, 'draft');
      check('★★★ 3곳째는 막힌다 (409)', k3.code === 409, `${k3.code} ${k3.message ?? ''}`);
      check('★ 409 는 space_taken 이다', k3.error === 'space_taken', String(k3.error));
      check('★★ 이유에 「2곳까지」가 있다', (k3.message ?? '').includes('2곳까지'), k3.message);
      check('★ 누가 쓰고 있는지도 말한다', (k3.message ?? '').includes('검증회사M1'), k3.message);

      /* ⑦ ★ 같은 회사의 둘째 계약은 1곳으로 센다 — 꽉 찬 호실에도 들어간다 */
      const again = await put(co1, 'draft');
      check(
        '★★★ 한 회사의 계약 둘은 1곳이다 — 꽉 찬 호실에도 같은 회사는 들어간다',
        again.code === 201,
        `${again.code} ${again.message ?? ''}`,
      );
      if (again.code === 201) {
        const cancelAgain = await op.inject({
          method: 'POST',
          url: `/contracts/${again.id}/status`,
          payload: { to: 'cancelled', memo: TAG },
        });
        check('그 계약을 취소해 둔다', cancelAgain.statusCode === 200, String(cancelAgain.statusCode));
      }

      /* ⑧ 호실상태는 그대로 — 살아 있는 계약이 하나라도 있으면 유지된다 */
      const statusNow = await asOperator(async (c) => {
        const { rows } = await c.query(`SELECT status FROM public.tb_s080_spaces WHERE space_id = $1`, [room]);
        return rows[0]?.status ?? null;
      });
      check('★ 호실상태는 그대로다 — 확정이 하나라도 있으면 「입주중」(O)', statusNow === 'O', String(statusNow));

      /* ⑨ 지금 들어 있는 곳보다 적게 낮출 수 없다 — 낮추면 그 계약을 다시 저장할 수 없다 */
      const down = await op.inject({
        method: 'PATCH',
        url: `/facility/spaces/${room}`,
        payload: { floorId, roomName: `VF-MX-A-${STAMP}`, roomType: 'R1', maxCompanies: 1, memo: TAG },
      });
      check('★★ 2곳이 든 호실을 1곳으로 줄일 수 없다 (409)', down.statusCode === 409, `${down.statusCode} ${down.body.slice(0, 160)}`);
      check('★ 이유에 지금 몇 곳인지가 있다', json(down).message?.includes('2곳'), json(down).message);
      check('★ 거절된 값은 저장되지 않았다', (await maxOf(room)) === 2, String(await maxOf(room)));

      /* ⑩ 1곳을 비우면 다시 들어간다 — 계약대기는 취소로, 계약중은 종료로 비운다 */
      const cancel = await op.inject({
        method: 'POST',
        url: `/contracts/${k2.id}/status`,
        payload: { to: 'cancelled', memo: TAG },
      });
      check('계약대기 취소 200', cancel.statusCode === 200, `${cancel.statusCode} ${cancel.body.slice(0, 140)}`);
      const k3b = await put(co3, 'draft');
      check('★★★ 한 곳이 비면 다시 들어간다', k3b.code === 201, `${k3b.code} ${k3b.message ?? ''}`);

      /* ⑪ 1곳으로 조이면 그 다음부터 2곳째가 막힌다 */
      const freeAll = async (ids) => {
        for (const [id, to] of ids) {
          await op.inject({
            method: 'POST',
            url: `/contracts/${id}/status`,
            payload: to === 'terminated'
              ? { to, terminatedDate: '2026-04-30', terminationReason: TAG }
              : { to, memo: TAG },
          });
        }
      };
      await freeAll([[k1.id, 'terminated'], [k3b.id, 'cancelled']]);
      const emptied = await asOperator((c) => countSpaceCompanies(c, room));
      check('★ 계약을 다 닫으면 0곳이다 — 종료·취소는 세지 않는다', emptied === 0, String(emptied));

      const toOne = await op.inject({
        method: 'PATCH',
        url: `/facility/spaces/${room}`,
        payload: { floorId, roomName: `VF-MX-A-${STAMP}`, roomType: 'R1', maxCompanies: 1, memo: TAG },
      });
      check('빈 호실은 1곳으로 줄일 수 있다', toOne.statusCode === 200, `${toOne.statusCode} ${toOne.body.slice(0, 140)}`);
      check('★ 1곳으로 저장됐다', (await maxOf(room)) === 1, String(await maxOf(room)));

      const one1 = await put(co1, 'draft');
      check('1곳짜리에 첫 계약은 들어간다', one1.code === 201, `${one1.code} ${one1.message ?? ''}`);
      const one2 = await put(co2, 'draft');
      check('★★★ 1곳이면 2곳째가 막힌다 (409)', one2.code === 409, `${one2.code} ${one2.message ?? ''}`);
      check('★ 이유에 「1곳까지」가 있다', (one2.message ?? '').includes('1곳까지'), one2.message);

      /* ⑫ 종료하면 다시 넣을 수 있다 — 종료·취소는 세지 않는다 */
      const cancelOne = await op.inject({
        method: 'POST',
        url: `/contracts/${one1.id}/status`,
        payload: { to: 'cancelled', memo: TAG },
      });
      check('첫 계약 취소 200', cancelOne.statusCode === 200, String(cancelOne.statusCode));
      const one2b = await put(co2, 'draft');
      check('★★★ 비우면 다시 들어간다 (1곳짜리)', one2b.code === 201, `${one2b.code} ${one2b.message ?? ''}`);

      /*
       * ⑬ ★★ **목록과 저장이 같은 답을 낸다.** 「목록에 나오는데 저장이 막힌다」가
       *    이 기능에서 가장 나쁜 고장이다. 꽉 찬 호실이 다른 회사의 계약 폼 목록
       *    (`GET /spaces` + 입주 현황)에서 **고를 수 없는 것**으로 걸러지는지 본다.
       */
      const holders = await op.inject({ method: 'GET', url: '/contracts/space-holders' });
      const holderRows = json(holders).holders ?? null;
      if (holderRows === null) {
        check('★ 입주 현황 조회가 있다', false, Object.keys(json(holders)).join(','));
      } else {
        const mine = holderRows.filter((h) => h.spaceId === room);
        check('★★ 꽉 찬 호실이 입주 현황에 나온다 — 화면이 이것으로 거른다', mine.length > 0, String(mine.length));
      }
    }
  } finally {
    await op.close();
    await tenant.close();

    console.log('\n정리');
    const cleanup = await asOperator(async (c) => {
      const { rows } = await c.query(`SELECT contract_id FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]);
      const ids = rows.map((r) => r.contract_id);
      let invoices = 0;
      if (ids.length > 0) {
        await c.query(
          `DELETE FROM public.tb_s080_payments p USING public.tb_s080_invoices i
            WHERE i.invoice_id = p.invoice_id AND i.contract_id = ANY($1::text[])`,
          [ids],
        );
        invoices = (await c.query(`DELETE FROM public.tb_s080_invoices WHERE contract_id = ANY($1::text[])`, [ids])).rowCount;
        await c.query(`DELETE FROM public.tb_s080_settlements WHERE contract_id = ANY($1::text[])`, [ids]);
        await c.query(`DELETE FROM public.tb_s080_deposit_ledger WHERE contract_id = ANY($1::text[])`, [ids]);
      }
      const contracts = (await c.query(`DELETE FROM public.tb_s080_contracts WHERE memo = $1`, [TAG])).rowCount;
      /*
       * ★ 첨부는 **실물을 먼저 모아 둔다.** 행을 지우면 경로를 알 수 없다 —
       *   회사(계약 서류)·건물(임대차계약서)·층(도면) 셋을 한 번에 본다.
       */
      const targets = [...made.companies, ...made.buildings, ...made.floors];
      const { rows: leftFiles } = await c.query(
        `SELECT storage_path FROM public.tb_cm_file WHERE target_id = ANY($1::text[])`,
        [targets],
      );
      orphanPaths.push(...leftFiles.map((r) => r.storage_path));
      const files = (await c.query(`DELETE FROM public.tb_cm_file WHERE target_id = ANY($1::text[])`, [targets])).rowCount;
      const companies = (await c.query(`DELETE FROM public.tb_s080_companies WHERE company_id = ANY($1::text[])`, [made.companies])).rowCount;
      // ★ 순서가 있다 — 회의실·호실 → 층 → 건물. FK 가 없어도 읽는 사람에게 관계를 보인다.
      const facilities = (await c.query(`DELETE FROM public.tb_s080_facilities WHERE facility_id = ANY($1::text[])`, [made.facilities])).rowCount;
      const spaces = (await c.query(`DELETE FROM public.tb_s080_spaces WHERE space_id = ANY($1::text[])`, [made.spaces])).rowCount;
      const floors = (await c.query(`DELETE FROM public.tb_s080_floors WHERE floor_id = ANY($1::text[])`, [made.floors])).rowCount;
      const buildings = (await c.query(`DELETE FROM public.tb_s080_buildings WHERE build_id = ANY($1::text[])`, [made.buildings])).rowCount;
      return { invoices, contracts, files, companies, facilities, spaces, floors, buildings };
    });
    await pool.query(`DELETE FROM public.tb_s080_auth_session WHERE bbiyong_member_id = ANY($1::int[])`, [[9941, 9942]]);
    console.log(
      `  청구서 ${cleanup.invoices} · 계약 ${cleanup.contracts} · 서류 ${cleanup.files} · 회사 ${cleanup.companies} · ` +
        `회의실 ${cleanup.facilities} · 호실 ${cleanup.spaces} · 층 ${cleanup.floors} · 건물 ${cleanup.buildings} 삭제`,
    );

    /* ★ 스토리지에도 남기지 않는다 — DB 행만 지우면 아무도 못 보는 실물이 남는다. */
    let dropped = 0;
    let real = 0;
    for (const path of orphanPaths) {
      /* ★ 애초에 올리지 않은 것은 센다. 이 스크립트가 계약확정용으로 **행만** 심는
         계약 서류(`verify/…`)가 그렇다 — 없는 실물을 「못 지웠다」고 적으면 안 된다. */
      if (!(await objectExists(path))) continue;
      real++;
      const res = await fetch(objectUrl(path), { method: 'DELETE', headers: STORAGE_HEADERS });
      if (res.ok) dropped++;
    }
    if (real > 0) console.log(`  스토리지 실물 ${dropped}/${real} 삭제`);

    /* ★ 정말 남지 않았는지 확인한다 — 「지웠다」고 출력하는 것과 다른 일이다. */
    const left = await asOperator(async (c) => {
      const b = await c.query(`SELECT count(*)::int n FROM public.tb_s080_buildings WHERE build_id = ANY($1::text[])`, [made.buildings]);
      const s = await c.query(`SELECT count(*)::int n FROM public.tb_s080_spaces WHERE space_id = ANY($1::text[])`, [made.spaces]);
      const k = await c.query(`SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1`, [TAG]);
      return { buildings: b.rows[0].n, spaces: s.rows[0].n, contracts: k.rows[0].n };
    });
    check('★ 흔적이 남지 않았다', left.buildings === 0 && left.spaces === 0 && left.contracts === 0,
      `건물 ${left.buildings} · 호실 ${left.spaces} · 계약 ${left.contracts}`);

    /* ★ 기존 72실을 건드리지 않았는지도 본다. */
    const kept = await asOperator(async (c) => {
      const { rows } = await c.query(`SELECT count(*)::int n FROM public.tb_s080_spaces WHERE memo IS DISTINCT FROM $1`, [TAG]);
      return rows[0].n;
    });
    check('★★ 기존 호실 72실이 그대로다', kept === 72, `${kept}실`);

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
  const short = pass + fail !== EXPECTED_ITEMS;
  if (short) {
    console.log(`※ 항목 수 — ${EXPECTED_ITEMS}개를 기대했는데 ${pass + fail}개가 돌았다 (실패는 아니다)`);
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('✘ 검증 중 오류:', e);
  await closePool().catch(() => {});
  process.exit(1);
});
