/**
 * 코드 관리(s030100030) 검증 — **실제 라우트로** 도는가.
 *
 * ★ 이 검증이 지키는 것:
 *   ① 입주사 계정은 **어느 경로도** 열 수 없다 (403) — 주소를 직접 쳐도 자료가 안 나간다
 *   ② 분류 ▸ 파티션 ▸ 코드 3층을 만들고 고칠 수 있다
 *   ③ 분류를 만들면 **공통(000) 파티션이 함께** 생긴다
 *   ④ ★★★ **쓰고 있는 코드는** 코드값 변경 · 비활성화 · 삭제가 **막힌다**(409, 몇 건인지 포함)
 *   ⑤ ★★★ **이름은 언제나 바뀌고**, 그 코드를 쓰는 화면(`GET /codes`)에 **바로** 반영된다
 *   ⑥ ★★ 앱이 상수로 박아 둔 코드값은 **자료가 0건이어도** 막힌다(`CONTRACT_ST` 등)
 *   ⑦ 코드가 남은 파티션 · 파티션이 남은 분류는 지울 수 없다
 *   ⑧ 공통(000) 파티션 · 시스템 분류 · 시스템 코드는 지울 수 없다
 *   ⑨ ★★ **선언표(`CODE_USAGE`)가 가리키는 표·컬럼이 실제로 존재한다** — 오타·이름 변경을 잡는다
 *   ⑩ 분류 키 · 파티션 번호 · 코드값 모양 검사와 중복 거부
 *
 * ★★ **넣은 것은 전부 지운다.** 개발계 공용 DB 라 흔적을 남기지 않는다.
 *
 * ★★★ **실데이터(118행)를 건드리지 않는다.** ④⑤ 는 쓰이는 코드가 필요한데, 기존 코드의
 *    이름을 바꿔 보는 대신 **`ROOM_TP/000` 에 검증용 코드 한 줄을 넣고** 검증용 호실
 *    한 실이 그것을 쓰게 만든다. `ROOM_TP/000` 이라 `GET /codes` 가 그 코드를 내려보내므로
 *    ⑤(소비 화면 즉시 반영)를 실제 소비 경로로 볼 수 있다. 끝에서 호실과 코드를 지운다.
 *    (호실 표에 FK 가 없어서 이렇게 할 수 있다 — `db/facility.ts` 머리말.)
 *
 * 사용: npm run verify:codes
 */
import Fastify from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import { registerCodeRoutes } from '../packages/api/src/routes/codes.ts';
import { registerLookupRoutes } from '../packages/api/src/routes/lookups.ts';
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';
import { checkUsageTableRefs } from '../packages/api/src/db/codes.ts';
import { encrypt, hashSessionId, newSessionId } from '../packages/api/src/lib/crypto.ts';
import { CODE_USAGE, PINNED_CODES } from '../packages/shared/src/domain/code-usage.ts';

/** ★ RLS 가 걸린 표는 `pool.query` 로 못 읽는다. 코드 3표에는 RLS 가 없지만 길을 맞춘다. */
const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);

/**
 * ★ 2026-10-07 116 → 118 — 선언표에 표양식(LAW_DOC_TP) 쓰임 1줄 + 고정 코드 1줄이 늘었다.
 * ★ 2026-10-10 118 → 122 — 법인변경(LAW_CNG_TP · LAW_PROG_ST) 쓰임 2줄 + 고정 코드 2줄.
 * ★ 2026-10-10 122 → 123 — 법무 회사유형(MEMBER_TYPE 002 · tb_s080_legal_orgs, 038) 쓰임 1줄.
 * ★ 2026-10-11 123 → 124 — 법무 양식 회사유형 고정 코드(MEMBER_TYPE 002 R · A, PINNED_CODES) 1줄.
 */
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

const TAG = `verify-codes-${Date.now()}`;
const STAMP = String(Date.now()).slice(-6);

/** 검증용 분류 키 — 지울 때 이 접두사로 찾는다. */
const VCAT = `VFCODE${STAMP}`;
/** `ROOM_TP/000` 에 잠깐 넣는 검증용 코드값. ★ 기존 6종(R1·R2·R3·FI·FR·VR)과 겹치지 않게. */
const VROOM = `ZZ${STAMP}`.slice(0, 20);

/** 지울 것들. 끝에서 전부 되돌린다. */
const made = { masters: [VCAT], roomTpLines: [], spaceIds: [] };

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
    [erpSid, memberId, encrypt(`vc-access.${memberId}`), encrypt(`vc-refresh.${memberId}`)],
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
  registerCodeRoutes(app);
  /* ★ 소비 경로(`GET /codes`)도 띄운다 — ⑤ 를 **실제 소비 라우트로** 본다. */
  registerLookupRoutes(app);
  return app;
}

(async () => {
  const opSid = await makeSession(9951);
  const tnSid = await makeSession(9952);

  const op = buildApp({
    s020MemberId: 9951,
    s020OrgId: 1,
    companyId: null,
    role: 'operator',
    erpSid: opSid,
  });
  const tenant = buildApp({
    s020MemberId: 9952,
    s020OrgId: 2,
    companyId: 'VC-TENANT',
    role: 'tenant',
    erpSid: tnSid,
  });

  /** 기준선 — 끝에서 같은지 본다. */
  const before = await asOperator(async (c) => {
    const { rows } = await c.query(
      `SELECT (SELECT count(*)::int FROM public.tb_s080_code_masters) m,
              (SELECT count(*)::int FROM public.tb_s080_code_categories) c,
              (SELECT count(*)::int FROM public.tb_s080_codes_line) l,
              (SELECT count(*)::int FROM public.tb_s080_spaces) s`,
    );
    return rows[0];
  });
  console.log(
    `기준선 — 분류 ${before.m} · 파티션 ${before.c} · 코드 ${before.l} · 호실 ${before.s}\n`,
  );

  try {
    /* ── 1. 입주사는 어느 경로도 열 수 없다 ─────────────────────────────── */
    console.log('1. 입주사 계정 — 주소를 직접 쳐도 403');
    {
      const paths = [
        ['GET', '/codes-admin/tree'],
        ['GET', '/codes-admin/ROOM_TP/000/lines'],
        ['POST', '/codes-admin/masters'],
        ['PATCH', '/codes-admin/masters/ROOM_TP'],
        ['DELETE', '/codes-admin/masters/ROOM_TP'],
        ['POST', '/codes-admin/masters/ROOM_TP/partitions'],
        ['PATCH', '/codes-admin/masters/ROOM_TP/partitions/000'],
        ['DELETE', '/codes-admin/masters/ROOM_TP/partitions/000'],
        ['POST', '/codes-admin/ROOM_TP/000/lines'],
        ['PATCH', '/codes-admin/lines/x'],
        ['DELETE', '/codes-admin/lines/x'],
      ];
      for (const [method, url] of paths) {
        const res = await tenant.inject({
          method,
          url,
          payload: method === 'POST' || method === 'PATCH' ? {} : undefined,
        });
        check(
          `${method} ${url} → 403`,
          res.statusCode === 403,
          `${res.statusCode} ${res.body.slice(0, 80)}`,
        );
      }
      /* ★ 403 이면 **본문에 자료가 없어야** 한다 — 막았는데 흘리면 막은 것이 아니다. */
      const leak = await tenant.inject({ method: 'GET', url: '/codes-admin/tree' });
      check('★ 403 본문에 코드 자료가 없다', !leak.body.includes('ROOM_TP'), leak.body.slice(0, 80));
    }

    /* ── 2. ★★ 선언표 대조 ───────────────────────────────────────────── */
    console.log('\n2. ★★ 선언표(CODE_USAGE) — 가리키는 표·컬럼이 실제로 있는가');
    {
      const refs = await asOperator((c) => checkUsageTableRefs(c));
      check(`★ 선언표 ${CODE_USAGE.length}건을 대조했다`, refs.length === CODE_USAGE.length);
      for (const { ref, exists } of refs) {
        check(`  ${ref.table}.${ref.column} (${ref.category}/${ref.useTp})`, exists);
      }
      /* 앱 상수로 박힌 코드값이 실제로 그 파티션에 **있는가** — 없으면 선언이 썩은 것이다. */
      for (const p of PINNED_CODES) {
        const { rows } = await asOperator((c) =>
          c.query(
            `SELECT code FROM public.tb_s080_codes_line WHERE category=$1 AND use_tp=$2 AND code = ANY($3::text[])`,
            [p.category, p.useTp, [...p.codes]],
          ),
        );
        check(
          `  ★ PINNED ${p.category}/${p.useTp} — ${p.codes.length}개가 DB 에 다 있다`,
          rows.length === p.codes.length,
          `${rows.length}/${p.codes.length} (${rows.map((r) => r.code).join(',')})`,
        );
      }
    }

    /* ── 3. 분류 ▸ 파티션 ▸ 코드 3층 ────────────────────────────────── */
    console.log('\n3. 3층 등록 — 분류 · 파티션 · 코드');
    let lineId;
    {
      let res = await op.inject({
        method: 'POST',
        url: '/codes-admin/masters',
        payload: { category: VCAT, name: `검증분류 ${STAMP}`, description: TAG },
      });
      check('분류 등록 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      /* ③ 공통 파티션이 함께 생겼는가. */
      const tree = json(await op.inject({ method: 'GET', url: '/codes-admin/tree' }));
      const mine = tree.categories.filter((c) => c.category === VCAT);
      check('★★ 분류를 만들면 공통(000) 파티션이 함께 생긴다', mine.length === 1 && mine[0].useTp === '000');
      check('★ 그 이름이 「공통」이다', mine[0]?.name === '공통', mine[0]?.name);

      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/masters/${VCAT}/partitions`,
        payload: { useTp: '007', name: '검증용', description: TAG },
      });
      check('파티션 등록 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/${VCAT}/007/lines`,
        payload: { code: 'A1', name: '검증코드' },
      });
      lineId = json(res).lineId;
      check('코드 등록 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      const lines = json(await op.inject({ method: 'GET', url: `/codes-admin/${VCAT}/007/lines` }));
      check('★ 순서를 비우면 마지막 다음(1)이 들어간다', lines.lines[0]?.sortOrder === 1, String(lines.lines[0]?.sortOrder));
      check('★ 새 코드는 사용(활성)으로 들어간다', lines.lines[0]?.isActive === true);
      check('★ 쓰임이 등록돼 있지 않다고 알려 준다', Array.isArray(lines.usageRefs) && lines.usageRefs.length === 0);

      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${lineId}`,
        payload: { code: 'A2', name: '검증코드2', sortOrder: 5, isActive: false },
      });
      check('코드 수정 200 — 안 쓰이면 코드값도 바뀐다', res.statusCode === 200, `${res.statusCode} ${res.body.slice(0, 120)}`);
      const after = json(await op.inject({ method: 'GET', url: `/codes-admin/${VCAT}/007/lines` }));
      check('★ 코드값·이름·순서·사용여부가 다 반영됐다',
        after.lines[0]?.code === 'A2' && after.lines[0]?.name === '검증코드2' &&
        after.lines[0]?.sortOrder === 5 && after.lines[0]?.isActive === false,
        JSON.stringify(after.lines[0]));
    }

    /* ── 4. 모양 검사와 중복 ────────────────────────────────────────────── */
    console.log('\n4. 모양 검사 · 중복 거부');
    {
      const bad = [
        [{ category: '한글분류', name: 'x' }, '한글 분류 키'],
        [{ category: 'A B', name: 'x' }, '공백 있는 분류 키'],
        [{ category: '_LEAD', name: 'x' }, '밑줄로 시작하는 분류 키'],
        [{ category: 'X', name: 'x' }, '한 글자 분류 키'],
        [{ category: 'OK_CAT', name: '' }, '이름 없음'],
      ];
      for (const [payload, label] of bad) {
        const res = await op.inject({ method: 'POST', url: '/codes-admin/masters', payload });
        check(`${label} → 400`, res.statusCode === 400, `${res.statusCode} ${res.body.slice(0, 80)}`);
      }

      /*
       * ★ 소문자는 **거절하지 않고 대문자로 올린다**(레거시 `AddCategoryDialog` 와 같다).
       *   그래서 있는 분류의 소문자는 400 이 아니라 **409 중복**이다 — 올렸다는 증거다.
       */
      let res = await op.inject({
        method: 'POST',
        url: '/codes-admin/masters',
        payload: { category: 'room_tp', name: 'x' },
      });
      check('★ 소문자 분류 키는 대문자로 올라간다 — 있는 것과 겹쳐 409', res.statusCode === 409,
        `${res.statusCode} ${res.body.slice(0, 80)}`);
      check('★ 409 문구가 대문자 키를 말한다', json(res).message?.includes('ROOM_TP'), json(res).message);

      res = await op.inject({
        method: 'POST',
        url: '/codes-admin/masters',
        payload: { category: VCAT, name: '또' },
      });
      check('분류 중복 → 409', res.statusCode === 409, String(res.statusCode));

      /* ★★ 파티션 번호는 **숫자 3자**다 — 레거시의 자유 텍스트(「WEB」)를 막는다. */
      for (const [useTp, label] of [['WEB', '영문 파티션 번호'], ['7', '한 자리'], ['0007', '네 자리']]) {
        res = await op.inject({
          method: 'POST',
          url: `/codes-admin/masters/${VCAT}/partitions`,
          payload: { useTp, name: 'x' },
        });
        check(`★ ${label}(${useTp}) → 400`, res.statusCode === 400, `${res.statusCode} ${res.body.slice(0, 80)}`);
      }
      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/masters/${VCAT}/partitions`,
        payload: { useTp: '007', name: '또' },
      });
      check('파티션 중복 → 409', res.statusCode === 409, String(res.statusCode));

      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/${VCAT}/007/lines`,
        payload: { code: 'A2', name: '또' },
      });
      check('같은 파티션에 같은 코드값 → 409', res.statusCode === 409, String(res.statusCode));
      check('★ 409 문구에 파티션이 적혀 있다', json(res).message?.includes(`${VCAT}/007`), json(res).message);

      /* ★★★ 같은 코드값이라도 **다른 파티션이면 별개다** — 파티션이 독립이라는 뜻. */
      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/${VCAT}/000/lines`,
        payload: { code: 'A2', name: '공통의 A2' },
      });
      check('★★★ 같은 코드값도 다른 파티션이면 들어간다', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);
      const commonLineId = json(res).lineId;

      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/${VCAT}/007/lines`,
        payload: { code: 'A B', name: 'x' },
      });
      check('공백 있는 코드값 → 400', res.statusCode === 400, String(res.statusCode));

      /* 쓰지 않을 것은 바로 지운다. */
      await op.inject({ method: 'DELETE', url: `/codes-admin/lines/${commonLineId}` });
    }

    /* ── 5. ★★★ 쓰고 있는 코드는 못 바꾼다 ───────────────────────────── */
    console.log('\n5. ★★★ 쓰고 있는 코드 — 코드값 변경 · 끄기 · 삭제가 막힌다');
    let roomLineId;
    {
      /*
       * `ROOM_TP/000` 에 검증용 코드를 넣고, 검증용 호실이 그것을 쓰게 한다.
       * ★ 실데이터를 건드리지 않으려는 선택이다(머리말 ★★★).
       */
      let res = await op.inject({
        method: 'POST',
        url: '/codes-admin/ROOM_TP/000/lines',
        payload: { code: VROOM, name: '검증실' },
      });
      roomLineId = json(res).lineId;
      made.roomTpLines.push(roomLineId);
      check('검증용 코드를 ROOM_TP/000 에 넣었다', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      /* 아직 아무도 안 쓴다 — 이때는 코드값도 바뀌고 끌 수도 있다. */
      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${roomLineId}`,
        payload: { code: VROOM, name: '검증실', isActive: false },
      });
      check('★ 안 쓰이면 끌 수 있다', res.statusCode === 200, `${res.statusCode} ${res.body.slice(0, 120)}`);
      await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${roomLineId}`,
        payload: { code: VROOM, name: '검증실', isActive: true },
      });

      /*
       * 이제 호실 한 실이 이 코드를 쓴다.
       *
       * ★★ 호실은 **건물·층에 FK 가 걸려 있다**(실측 2026-10-03:
       *    `spaces.build_id → buildings`, `spaces.floor_id → floors`). 그래서 가짜 id 로는
       *    못 넣는다 — 있는 건물·층에 붙인다. 기존 행은 **읽기만** 하고, 내가 넣은 호실은
       *    `memo = TAG` 로 찾아 지운다.
       * ★ 코드표의 `build_id` 는 `'1'` 인데 건물표의 `build_id` 는 cuid 다 — **다른
       *   이름공간**이다(코드표에는 건물 FK 가 없다). 그래서 둘을 섞어 쓰지 않는다.
       */
      const anchor = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT f.floor_id, f.building_id FROM public.tb_s080_floors f LIMIT 1`,
        );
        return rows[0];
      });
      check('붙일 건물·층을 찾았다', anchor !== undefined, JSON.stringify(anchor));

      const spaceId = randomUUID();
      made.spaceIds.push(spaceId);
      await asOperator((c) =>
        c.query(
          `INSERT INTO public.tb_s080_spaces
             (space_id, build_id, floor_id, room_no, room_type, status, is_active,
              biz_addr_available, updated_at, max_companies, room_name, memo)
           VALUES ($1, $2, $3, $4, $5, 'E', true, false, CURRENT_TIMESTAMP, 1, $6, $7)`,
          [
            spaceId,
            anchor.building_id,
            anchor.floor_id,
            randomBytes(6).toString('hex'),
            VROOM,
            `검증실 ${STAMP}`,
            TAG,
          ],
        ),
      );

      const lines = json(await op.inject({ method: 'GET', url: '/codes-admin/ROOM_TP/000/lines' }));
      const mine = lines.lines.find((l) => l.code === VROOM);
      check('★★ 목록이 쓰임을 함께 내려준다', mine?.usage?.length === 1, JSON.stringify(mine?.usage));
      check('★ 몇 건인지 적혀 있다', mine?.usage?.[0]?.count === 1, String(mine?.usage?.[0]?.count));
      check('★ 어디서 쓰는지 적혀 있다', mine?.usage?.[0]?.label === '호실', mine?.usage?.[0]?.label);
      check('★★ 이 파티션의 쓰임 자리가 선언표에서 온다', lines.usageRefs.length >= 2, JSON.stringify(lines.usageRefs));

      /* ④-1 코드값 변경 → 409 */
      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${roomLineId}`,
        payload: { code: `${VROOM}X`, name: '검증실' },
      });
      check('★★★ 쓰는 코드의 코드값 변경 → 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유에 건수가 있다', json(res).message?.includes('1건'), json(res).message);
      check('★ 대안(이름은 바꿀 수 있다)까지 적혀 있다', json(res).message?.includes('이름'), json(res).message);

      /* ④-2 비활성화 → 409 */
      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${roomLineId}`,
        payload: { code: VROOM, name: '검증실', isActive: false },
      });
      check('★★★ 쓰는 코드를 끄려 하면 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유가 사용여부라고 말한다', json(res).message?.includes('사용여부'), json(res).message);

      /* ④-3 삭제 → 409 */
      res = await op.inject({ method: 'DELETE', url: `/codes-admin/lines/${roomLineId}` });
      check('★★★ 쓰는 코드 삭제 → 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유에 건수가 있다', json(res).message?.includes('호실 1건'), json(res).message);

      /* 실제로 아무것도 바뀌지 않았는가. */
      const still = json(await op.inject({ method: 'GET', url: '/codes-admin/ROOM_TP/000/lines' })).lines
        .find((l) => l.code === VROOM);
      check('★ 거절된 변경이 저장되지 않았다', still?.code === VROOM && still?.isActive === true,
        JSON.stringify({ code: still?.code, isActive: still?.isActive }));
    }

    /* ── 6. ★★★ 이름은 언제나 바뀌고, 쓰는 화면에 바로 반영된다 ───────── */
    console.log('\n6. ★★★ 이름 수정 — 쓰는 중에도 되고, 소비 화면에 바로 나온다');
    {
      /* 바꾸기 전에 소비 경로가 무엇을 보여 주는가. */
      let codes = json(await op.inject({ method: 'GET', url: '/codes' })).codes;
      const beforeName = codes.find((c) => c.category === 'ROOM_TP' && c.code === VROOM)?.name;
      check('★ 소비 경로(GET /codes)가 이 코드를 내려준다', beforeName === '검증실', String(beforeName));

      const res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${roomLineId}`,
        payload: { code: VROOM, name: '이름바꾼검증실' },
      });
      check('★★★ 쓰는 중에도 이름 수정 200', res.statusCode === 200, `${res.statusCode} ${res.body.slice(0, 120)}`);

      codes = json(await op.inject({ method: 'GET', url: '/codes' })).codes;
      const afterName = codes.find((c) => c.category === 'ROOM_TP' && c.code === VROOM)?.name;
      check('★★★ 소비 화면에 **바로** 반영된다', afterName === '이름바꾼검증실', String(afterName));
      check('★ 코드값은 그대로다 — 자료가 길을 잃지 않는다', afterName !== undefined);

      /* 자료 쪽이 멀쩡한가 — 이름을 바꿨다고 호실의 room_type 이 바뀌지 않았는가. */
      const { rows } = await asOperator((c) =>
        c.query(`SELECT room_type FROM public.tb_s080_spaces WHERE memo = $1`, [TAG]),
      );
      check('★★ 이름을 바꿔도 업무 자료의 코드값은 그대로다', rows.every((r) => r.room_type === VROOM),
        JSON.stringify(rows));
    }

    /* ── 7. ★★ 앱이 박아 둔 코드값 — 자료가 0건이어도 막힌다 ─────────── */
    console.log('\n7. ★★ 앱 상수로 박힌 코드값 (자료 0건이어도 막는다)');
    {
      /*
       * ★★ `QU_ST`(문의상태)를 쓴다. 이 코드값은 **어디에도 저장되지 않는다** — 문의 상태는
       *    답변 유무로 유도한다(`domain/inquiry.ts`). 그래서 `CODE_USAGE` 에 줄이 없고
       *    쓰임은 **구조적으로 0건**이다. 그런데도 앱이 `'R'|'A'` 를 상수로 비교하므로
       *    막혀야 한다 — `PINNED_CODES` 만이 막는 자리다.
       *
       * ★★★ 예전에는 `CONTRACT_ST/cancelled` 로 이 시험을 했는데 **틀린 시험이었다**:
       *    ① 계약 표의 행 수에 기댔다 — 사용자가 개발 서버에서 계약을 만들면 쓰임이 0 이
       *       아니게 되어 시험이 깨진다(실제로 `count:2` 로 깨졌다, 2026-10-03)
       *    ② `cancelled` 는 `is_system` 이라 **시스템 잠금이 먼저** 걸려 403 이 돌아왔다 —
       *       pinned 경로를 지나가지도 않았다
       *    `QU_ST` 의 둘은 `is_system=false` 이고 쓰임 자리가 아예 없어 둘 다 비껴간다.
       */
      const lines = json(await op.inject({ method: 'GET', url: '/codes-admin/QU_ST/000/lines' }));
      const answered = lines.lines.find((l) => l.code === 'A');
      check('문의상태 A(답변완료) 를 찾았다', answered !== undefined);
      check('★ 시스템 코드가 아니다 — 시스템 잠금이 먼저 걸리지 않는다', answered?.isSystem === false,
        String(answered?.isSystem));
      check('★ 쓰임은 0건이다 — 저장되는 자리가 아예 없다', answered?.usage?.length === 0,
        JSON.stringify(answered?.usage));
      check('★★ 그래도 앱이 직접 쓴다고 표시된다', typeof answered?.pinnedBy === 'string',
        String(answered?.pinnedBy));

      let res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${answered.lineId}`,
        payload: { code: 'AA', name: answered.name },
      });
      check('★★★ 앱이 박은 코드값 변경 → 409 (자료 0건인데도)', res.statusCode === 409,
        `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유에 그 자리가 적혀 있다', json(res).message?.includes('inquiry.ts'), json(res).message);

      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${answered.lineId}`,
        payload: { code: 'A', name: answered.name, isActive: false },
      });
      check('★★★ 앱이 박은 코드 끄기 → 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);

      res = await op.inject({ method: 'DELETE', url: `/codes-admin/lines/${answered.lineId}` });
      check('★★★ 앱이 박은 코드 삭제 → 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);

      /* ★ 이름은 바뀐다 — 앱은 코드값만 본다. 바꾸고 되돌린다. */
      const orig = answered.name;
      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${answered.lineId}`,
        payload: { code: 'A', name: `${orig}_검증` },
      });
      check('★★ 앱이 박은 코드도 **이름은** 바뀐다', res.statusCode === 200, `${res.statusCode} ${res.body.slice(0, 120)}`);
      await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${answered.lineId}`,
        payload: { code: 'A', name: orig },
      });
      const back = json(await op.inject({ method: 'GET', url: '/codes-admin/QU_ST/000/lines' })).lines
        .find((l) => l.code === 'A');
      check('★ 이름을 원래대로 돌려놓았다', back?.name === orig, `${back?.name} vs ${orig}`);
      check('★ 코드값도 그대로다', back?.code === 'A', String(back?.code));

      /*
       * ★★ 2026-10-03 에 **시스템 잠금이 없어지면서 이 단언의 답이 바뀌었다.**
       *
       *   예전: `CONTRACT_ST/cancelled` 는 `is_system` 이라 **403 이 먼저** 나갔다 —
       *         pinned 경로를 지나가지도 않아 「어느 파일이 쓰는지」가 문구에 없었다
       *   지금: 시스템 잠금이 없으니 **pinned 가 막고**, 문구에 그 파일이 적힌다
       *
       * 막히는 것은 그대로이고 **문구가 더 쓸모 있어졌다.** 그래서 403 을 409 로 바꿨다.
       */
      const cst = json(await op.inject({ method: 'GET', url: '/codes-admin/CONTRACT_ST/000/lines' })).lines
        .find((l) => l.code === 'cancelled');
      check('★ 그 코드값은 시스템 표시가 있다', cst?.isSystem === true, String(cst?.isSystem));
      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${cst.lineId}`,
        payload: { code: 'canceled', name: cst.name },
      });
      check('★★★ 시스템+pinned 는 이제 **pinned 가 막는다** (409, 예전 403)', res.statusCode === 409,
        `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★★ 그래서 문구에 어느 파일이 쓰는지가 적힌다', json(res).message?.includes('contract-status'),
        json(res).message);
      /* ★ 조사 — 받침 없는 이름 뒤에 「이」가 붙던 것을 고쳤다(「계약 상태 전이이」). */
      check('★ 조사가 맞다 — 「계약 상태 전이가」', json(res).message?.includes('계약 상태 전이가'),
        json(res).message);
    }

    /* ── 8. 비우지 않으면 파티션 · 분류를 지울 수 없다 ──────────────────── */
    console.log('\n8. 비우지 않으면 파티션 · 분류를 지울 수 없다');
    {
      let res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${VCAT}/partitions/007` });
      check('코드 남은 파티션 삭제 → 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유에 코드 수가 있다', json(res).message?.includes('1개'), json(res).message);

      res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${VCAT}` });
      check('사용타입 남은 분류코드 삭제 → 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      /*
       * ★ 문구는 **화면이 그대로 보여 주는 것**이라 낱말까지 본다. 두 번 깨졌고 두 번
       *   다 깨진 것이 옳았다:
       *     2026-10-03 ① 「파티션」을 화면에서 없애고 「사용타입」으로 바꿨다
       *     2026-10-03 ② 분류코드 삭제의 교착을 풀면서 사유를 **둘로 갈랐다** —
       *        코드값이 남았으면 「코드값 N개」, 사용타입이 남았으면 「사용타입 N개」.
       *        예전처럼 둘을 한 문장에 붙이면 **무엇을 먼저 지워야 하는지**가 흐려진다.
       *   여기(VCAT)는 코드값이 남아 있는 경우다.
       */
      check('★ 사유가 먼저 치울 것을 짚는다 — 코드값',
        json(res).message?.includes('코드값 1개'), json(res).message);

      /* ★★ 공통(000) 은 아예 못 지운다. */
      res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${VCAT}/partitions/000` });
      check('★★ 공통(000) 사용타입 삭제 → 403', res.statusCode === 403, `${res.statusCode} ${res.body.slice(0, 120)}`);
    }

    /* ── 9. ★★ 시스템 차단은 없다 — 운영자가 판단한다 ──────────────────── */
    console.log('\n9. ★★ 「시스템」은 더 이상 막지 않는다 (사용자 결정 2026-10-03)');
    {
      /*
       * ★★★ **이 구역은 2026-10-03 에 뜻이 뒤집혔다.**
       *
       *   예전: 「시스템 분류·시스템 코드는 **지울 수 없다**(403)」를 확인했다
       *   지금: 「`is_system` 이라는 이유로는 **막지 않는다**」를 확인한다
       *
       * 지울지 말지는 운영자가 판단할 몫이고, 서버가 막는 것은 **자료가 바로 깨지는**
       * 둘뿐이다 — 쓰고 있는 코드값(§5) · 앱이 직접 쓰는 코드값(§7).
       *
       * ★ DB 의 `is_system` 칸은 **지우지 않았다**(사용자 지시). 값은 그대로 있고
       *   아무도 그것으로 막지 않을 뿐이다 — 아래에서 그 둘을 함께 확인한다.
       */
      const sysCount = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT (SELECT count(*)::int FROM public.tb_s080_code_masters WHERE is_system) m,
                  (SELECT count(*)::int FROM public.tb_s080_codes_line WHERE is_system) l`,
        );
        return rows[0];
      });
      check('★ DB 의 is_system 칸은 그대로 있다', sysCount.m > 0 && sysCount.l > 0,
        `분류 ${sysCount.m} · 코드값 ${sysCount.l}`);

      /* 검증 분류에 코드값을 하나 만들고 **시스템으로 표시**한 뒤, 지워지는지 본다. */
      let res = await op.inject({
        method: 'POST',
        url: `/codes-admin/${VCAT}/007/lines`,
        payload: { code: 'SYS1', name: '시스템표시 검증' },
      });
      const sysLineId = json(res).lineId;
      check('검증용 코드값 생성 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      await asOperator((c) =>
        c.query(`UPDATE public.tb_s080_codes_line SET is_system = true WHERE line_id = $1`, [sysLineId]),
      );
      const marked = json(await op.inject({ method: 'GET', url: `/codes-admin/${VCAT}/007/lines` })).lines
        .find((l) => l.code === 'SYS1');
      check('★ 그 코드값이 시스템으로 표시됐다', marked?.isSystem === true, String(marked?.isSystem));

      /* ★★★ 예전에는 여기가 403 이었다. */
      res = await op.inject({
        method: 'PATCH',
        url: `/codes-admin/lines/${sysLineId}`,
        payload: { code: 'SYS2', name: '시스템표시 검증' },
      });
      check('★★★ 시스템 표시가 있어도 **코드값을 바꿀 수 있다** (예전 403)', res.statusCode === 200,
        `${res.statusCode} ${res.body.slice(0, 120)}`);

      res = await op.inject({ method: 'DELETE', url: `/codes-admin/lines/${sysLineId}` });
      check('★★★ 시스템 표시가 있어도 **지울 수 있다** (예전 403)', res.statusCode === 200,
        `${res.statusCode} ${res.body.slice(0, 120)}`);

      const gone = json(await op.inject({ method: 'GET', url: `/codes-admin/${VCAT}/007/lines` })).lines
        .some((l) => l.code === 'SYS2');
      check('★ 실제로 사라졌다', gone === false);

      /* 사용타입도 같다 — 시스템으로 표시해도 비어 있으면 지워진다. */
      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/masters/${VCAT}/partitions`,
        payload: { useTp: '009', name: '시스템표시 사용타입' },
      });
      check('검증용 사용타입 생성 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);
      await asOperator((c) =>
        c.query(
          `UPDATE public.tb_s080_code_categories SET is_system = true WHERE category = $1 AND use_tp = '009'`,
          [VCAT],
        ),
      );
      res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${VCAT}/partitions/009` });
      check('★★★ 시스템 표시된 사용타입도 비어 있으면 지워진다 (예전 403)', res.statusCode === 200,
        `${res.statusCode} ${res.body.slice(0, 120)}`);

      /* ★ 공통(000) 은 **그대로 막는다** — 시스템 규칙이 아니라 구조 규칙이다(사용자 확인). */
      res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${VCAT}/partitions/000` });
      check('★★ 공통(000)은 여전히 막힌다 — 시스템 차단과 다른 규칙이다', res.statusCode === 403,
        `${res.statusCode} ${res.body.slice(0, 120)}`);
    }

    /* ── 9-2. ★★★ 분류코드가 끝까지 지워지는가 (교착 회귀) ───────────────── */
    console.log('\n9-2. ★★★ 분류코드 삭제 — 공통(000)을 함께 지운다 (교착 회귀)');
    {
      /*
       * ★★★ **2026-10-03 에 고친 교착의 회귀 시험이다.**
       *
       * 예전에는 분류코드를 만들면 공통(000)이 함께 생기고, 그 000 은 「분류코드를
       * 지우면 함께 사라집니다」라며 403 이었다. 그런데 분류코드 삭제는 「사용타입이
       * 남아 있으면 409」였다 — 그래서 **어떤 분류코드도 영원히 지워지지 않았다.**
       * 화면의 [삭제] 가 26줄 전부 비활성인 것으로 드러났다.
       */
      const DCAT = `DLOCK${STAMP}`;
      let res = await op.inject({
        method: 'POST',
        url: '/codes-admin/masters',
        payload: { category: DCAT, name: '교착검증' },
      });
      check('분류코드 생성 201', res.statusCode === 201, `${res.statusCode} ${res.body.slice(0, 120)}`);

      /* 코드값이 있으면 막힌다. */
      res = await op.inject({
        method: 'POST',
        url: `/codes-admin/${DCAT}/000/lines`,
        payload: { code: 'X1', name: '막는 코드값' },
      });
      const dLine = json(res).lineId;
      res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${DCAT}` });
      check('★ 코드값이 남아 있으면 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유가 코드값이라고 말한다', json(res).message?.includes('코드값'), json(res).message);
      await op.inject({ method: 'DELETE', url: `/codes-admin/lines/${dLine}` });

      /* 다른 사용타입이 있으면 막힌다. */
      await op.inject({
        method: 'POST',
        url: `/codes-admin/masters/${DCAT}/partitions`,
        payload: { useTp: '001', name: '남는 사용타입' },
      });
      res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${DCAT}` });
      check('★ 다른 사용타입이 남아 있으면 409', res.statusCode === 409, `${res.statusCode} ${res.body.slice(0, 120)}`);
      check('★ 사유가 공통(000) 말고 몇 개인지 말한다', json(res).message?.includes('1개'), json(res).message);
      await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${DCAT}/partitions/001` });

      /* ★★★ 공통(000) 하나만 남았을 때 — 함께 지워진다. */
      res = await op.inject({ method: 'DELETE', url: `/codes-admin/masters/${DCAT}` });
      check('★★★ 공통(000)만 남으면 **분류코드가 지워진다** (예전엔 영원히 409)',
        res.statusCode === 200, `${res.statusCode} ${res.body.slice(0, 120)}`);

      const left = await asOperator(async (c) => {
        const { rows } = await c.query(
          `SELECT (SELECT count(*)::int FROM public.tb_s080_code_masters WHERE category=$1) m,
                  (SELECT count(*)::int FROM public.tb_s080_code_categories WHERE category=$1) c`,
          [DCAT],
        );
        return rows[0];
      });
      check('★★ 공통(000)도 함께 사라졌다 — 고아 사용타입이 남지 않는다',
        left.m === 0 && left.c === 0, `분류 ${left.m} · 사용타입 ${left.c}`);
    }

    /* ── 10. 없는 대상은 404 ────────────────────────────────────────────── */
    console.log('\n10. 없는 대상은 404');
    {
      const cases = [
        ['GET', `/codes-admin/NOPE${STAMP}/000/lines`, '없는 파티션 조회'],
        ['PATCH', `/codes-admin/masters/NOPE${STAMP}`, '없는 분류 수정'],
        ['DELETE', `/codes-admin/masters/NOPE${STAMP}`, '없는 분류 삭제'],
        ['POST', `/codes-admin/masters/NOPE${STAMP}/partitions`, '없는 분류에 파티션'],
        ['POST', `/codes-admin/NOPE${STAMP}/000/lines`, '없는 파티션에 코드'],
        ['PATCH', '/codes-admin/lines/no-such-line', '없는 코드 수정'],
        ['DELETE', '/codes-admin/lines/no-such-line', '없는 코드 삭제'],
      ];
      for (const [method, url, label] of cases) {
        const payload =
          method === 'POST' || method === 'PATCH'
            ? { useTp: '000', code: 'X', name: '이름' }
            : undefined;
        const res = await op.inject({ method, url, payload });
        check(`${label} → 404`, res.statusCode === 404, `${res.statusCode} ${res.body.slice(0, 80)}`);
      }
    }
  } finally {
    /* ── 정리 ───────────────────────────────────────────────────────────── */
    console.log('\n정리');
    const removed = { spaces: 0, lines: 0, categories: 0, masters: 0 };
    await asOperator(async (c) => {
      let r = await c.query(`DELETE FROM public.tb_s080_spaces WHERE memo = $1`, [TAG]);
      removed.spaces = r.rowCount ?? 0;
      /* 검증용 ROOM_TP 코드 — 호실을 먼저 지웠으므로 이제 아무도 안 쓴다. */
      r = await c.query(`DELETE FROM public.tb_s080_codes_line WHERE category = 'ROOM_TP' AND code = $1`, [VROOM]);
      removed.lines += r.rowCount ?? 0;
      /* 검증 분류 — 코드 → 파티션 → 분류 순서로. */
      r = await c.query(`DELETE FROM public.tb_s080_codes_line WHERE category = $1`, [VCAT]);
      removed.lines += r.rowCount ?? 0;
      r = await c.query(`DELETE FROM public.tb_s080_code_categories WHERE category = $1`, [VCAT]);
      removed.categories = r.rowCount ?? 0;
      r = await c.query(`DELETE FROM public.tb_s080_code_masters WHERE category = $1`, [VCAT]);
      removed.masters = r.rowCount ?? 0;
    });
    await pool.query(`DELETE FROM public.tb_s080_auth_session WHERE bbiyong_member_id IN (9951, 9952)`);
    console.log(
      `  호실 ${removed.spaces} · 코드 ${removed.lines} · 파티션 ${removed.categories} · 분류 ${removed.masters} 삭제`,
    );

    const after = await asOperator(async (c) => {
      const { rows } = await c.query(
        `SELECT (SELECT count(*)::int FROM public.tb_s080_code_masters) m,
                (SELECT count(*)::int FROM public.tb_s080_code_categories) c,
                (SELECT count(*)::int FROM public.tb_s080_codes_line) l,
                (SELECT count(*)::int FROM public.tb_s080_spaces) s`,
      );
      return rows[0];
    });
    check(
      '★★ 흔적이 남지 않았다 — 분류·파티션·코드·호실이 기준선과 같다',
      after.m === before.m && after.c === before.c && after.l === before.l && after.s === before.s,
      `분류 ${before.m}→${after.m} · 파티션 ${before.c}→${after.c} · 코드 ${before.l}→${after.l} · 호실 ${before.s}→${after.s}`,
    );

    await closePool();
  }

  console.log(fail === 0 ? `\n통과 ${pass}항목` : `\n실패 ${fail}건 / ${pass + fail}항목`);
  if (failures.length > 0) for (const f of failures) console.log(`  - ${f}`);
  if (pass + fail !== EXPECTED_ITEMS) {
    console.log(`※ 항목 수 — ${EXPECTED_ITEMS}개를 기대했는데 ${pass + fail}개가 돌았다 (실패는 아니다)`);
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('✘ 검증 중 오류:', e);
  await closePool().catch(() => {});
  process.exit(1);
});
