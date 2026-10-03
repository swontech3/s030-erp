/**
 * 코드 관리(s030100030) 라우트 — 머리 · 파티션 · 값.
 *
 * =============================================================================
 * ★★ 운영사 전용이다
 * =============================================================================
 * 코드는 ERP 전체가 읽는 기준자료다. 입주사가 고칠 자료가 아니고, 보여 줄 자료도 아니다.
 * 모든 핸들러가 첫 줄에서 `session.role !== 'operator'` 를 403 으로 막는다 —
 * **화면이 아니라 여기가 막는 자리다.** 주소를 직접 쳐도 자료가 나가지 않는다.
 * (소비용 조회는 `routes/lookups.ts` 의 `GET /codes` 가 따로 한다. 그쪽은 계약 폼이 쓴다.)
 *
 * =============================================================================
 * ★★★ 쓰고 있는 코드는 못 지우고, 코드값도 못 바꾼다
 * =============================================================================
 * 업무 표에서 코드표로 오는 FK 가 **0건**이다. 업무 자료는 코드 문자열만 담는다 —
 * `spaces.room_type = 'R1'`. 그래서 지우거나 **코드값을 바꾸면** 그 자료가 길을 잃고,
 * 화면은 이름을 못 찾아 빈칸으로 열린다. DB 가 막지 않으니 여기가 막는다.
 *
 * 막는 근거는 둘이다:
 *   ① `domain/code-usage.ts` 의 `CODE_USAGE` — 코드값이 실제 저장되는 업무 컬럼 9곳.
 *      지우기 전에 센다(`countCodeUsage`).
 *   ② 같은 파일의 `PINNED_CODES` — **앱 코드가 상수로 박아 둔** 코드값 4곳.
 *      자료가 0행이어도 코드값을 바꾸면 조용히 틀린다(`SPACE_STATUS` 의 `'E'` 등).
 *
 * ★★ 세 가지를 막고 한 가지를 허용한다 (결정 2026-10-03):
 *      막는다   삭제 · **코드값(`code`) 변경** · **비활성화**
 *      허용한다 **이름(`name`) 변경** — 자료는 코드값만 담으므로 안전하고, 이름은 조회
 *               시점에 읽히므로 고치면 그 코드를 쓰는 화면에 **바로** 반영된다
 *
 * ★ 비활성화를 삭제와 같이 막는 이유: `listCodes()` 가 `is_active = true` 로 읽는다.
 *   쓰이는 코드를 끄면 **지우지 않았는데** 기존 자료가 이름을 잃는다. 센터 관리의
 *   「사용 안 함」과 성격이 다르다 — 거기는 새 계약 목록에서만 빠지고 지난 계약서는
 *   그대로지만, 코드는 지난 자료의 **이름 자체**가 그 행에서 나온다.
 *
 * ★ 409 인 이유: 요청이 틀린 것이 아니라(400) **지금 상태와 충돌**하는 것이다.
 *   화면은 이 코드를 보고 오류가 아니라 안내로 그린다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import {
  countCategoryLines,
  countCodeUsage,
  countMasterPartitions,
  countUsageByCode,
  deleteCategory,
  deleteLine,
  deleteMaster,
  findCategory,
  findLine,
  findLineByCode,
  findMaster,
  countUsageByMaster,
  insertCategory,
  insertLine,
  insertMaster,
  listCategories,
  listLines,
  listLinesOfMaster,
  listMasters,
  nextSortOrder,
  usageKey,
  updateCategory,
  updateLine,
  updateMaster,
  type CategoryRow,
  type LineRow,
  type MasterRow,
  type UsageHit,
} from '../db/codes.ts';
import { CODE_USAGE, pinnedRefFor, usageRefsFor } from '@swonbiz/shared/domain/code-usage';

const OPERATOR = 'operator';

/** 스코프는 항상 운영사. 역할 검사를 통과한 뒤에만 쓰인다(`routes/facility.ts` 와 같다). */
const OPERATOR_SCOPE: CompanyScope = { role: 'operator', companyId: null };

/** 건물은 하나다. `routes/inquiry.ts` 와 같은 값을 쓴다. */
const BUILD_ID = '1';

/** 공통 파티션. ★ 머리를 만들 때 함께 생기고, 지울 수 없다. */
const COMMON_USE_TP = '000';

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'forbidden', message: '코드 관리는 운영사만 다룰 수 있습니다' });

const notFound = (reply: FastifyReply, what: string) =>
  reply.code(404).send({ error: 'not_found', message: `${what}을 찾을 수 없습니다` });

/** 쓰고 있어서 못 바꾼다. ★ `message` 는 화면이 그대로 보여 주는 문구다. */
const inUse = (reply: FastifyReply, message: string) =>
  reply.code(409).send({ error: 'in_use', message });

const conflict = (reply: FastifyReply, message: string) =>
  reply.code(409).send({ error: 'duplicate', message });

const badRequest = (reply: FastifyReply, message: string) =>
  reply.code(400).send({ error: 'invalid_request', message });

/**
 * 규칙상 **허용되지 않는** 처리. ★ 409(지금 상태와 충돌)와 다르다 — 자료를 치워도 풀리지 않는다.
 *
 * ★★ 2026-10-03 에 **「시스템」 차단을 전부 걷어냈다**(사용자 결정). `is_system` 이라는
 *    이유로 막던 다섯 자리(분류코드·사용타입·코드값 삭제, 코드값 변경)가 사라졌다 —
 *    **지울지 말지는 운영자가 판단할 몫이다.** DB 의 `is_system` 칸은 그대로 두었다.
 *    지금 이것을 쓰는 자리는 **공통(000) 사용타입** 하나뿐이다. 그쪽은 시스템 규칙이
 *    아니라 「분류코드는 코드값을 담을 자리를 항상 하나 가진다」는 구조 규칙이다.
 */
const notAllowed = (reply: FastifyReply, message: string) =>
  reply.code(403).send({ error: 'not_allowed', message });

function actorOf(session: { s020MemberId: number }): string {
  return String(session.s020MemberId);
}

/**
 * 앞 낱말에 **받침이 있는가** — 조사를 고르는 데 쓴다.
 *
 * ★ 한글 음절은 `0xAC00` 부터 28개씩 묶여 있고, 그 안에서 받침이 0번이면 받침이 없다.
 *   한글이 아니면(영문·숫자) 받침 없음으로 본다 — 코드값은 `R1` 처럼 영문이 섞인다.
 */
function hasFinalConsonant(word: string): boolean {
  const last = word.trim().slice(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/**
 * 조사를 붙인다 — 「계약 상태 전이**가**」 · 「첫 납부액 계산**이**」.
 *
 * ★★ 선언표의 이름(`PINNED_CODES` 의 `label`)이 문장에 들어가는데, 그 이름이 받침으로
 *    끝나기도 하고 아니기도 한다. 고정 조사를 쓰면 「계약 상태 전이**이**」처럼 적힌다
 *    (2026-10-03 검증에서 실제로 나왔다). 문구는 화면이 그대로 보여 주는 것이라 고친다.
 */
const withParticle = (word: string, withJong: string, withoutJong: string): string =>
  `${word}${hasFinalConsonant(word) ? withJong : withoutJong}`;

/** 빈 문자열은 `null` 로. 화면이 칸을 비운 것과 안 보낸 것을 가르지 않는다. */
function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function int(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * 머리 키(`category`) 모양 — **영문 대문자·숫자·밑줄**.
 *
 * ★ 레거시는 `.toUpperCase()` 만 하고 모양을 보지 않았다. 공백이나 한글이 들어가면
 *   그 카테고리를 코드에서 문자열로 부르는 자리가 전부 깨진다 — `'ROOM_TP'` 처럼
 *   소스에 박히는 값이기 때문이다.
 */
const CATEGORY_RE = /^[A-Z][A-Z0-9_]{1,39}$/;

/**
 * 파티션 값(`use_tp`) 모양 — **숫자 3자**.
 *
 * ★★ 레거시는 자유 텍스트 3자였다(`placeholder="예: WEB"`). 실데이터 규약은 숫자
 *    `000`/`001`/`002` 인데도 막을 근거가 스키마에 없었기 때문이다
 *    (`doc/CODE_MASTER_ANALYSIS.md` §E-4). 013 이 FK 를 걸어 근거가 생겼고,
 *    여기서 모양까지 맞춘다 — 넣을 수 있는 값과 규약이 어긋나지 않게.
 */
const USE_TP_RE = /^[0-9]{3}$/;

/** 코드값(`code`) 모양 — 공백 없는 1~20자. `draft` 처럼 소문자 낱말도 실제로 쓰인다. */
const CODE_RE = /^\S{1,20}$/;

// =============================================================================
// 응답 모양
// =============================================================================

const toMaster = (m: MasterRow) => ({
  category: m.category,
  name: m.name,
  description: m.description,
  isSystem: m.is_system,
  partitionCount: m.partition_count,
  lineCount: m.line_count,
});

const toCategory = (c: CategoryRow) => ({
  category: c.category,
  useTp: c.use_tp,
  name: c.name,
  description: c.description,
  isSystem: c.is_system,
  lineCount: c.line_count,
});

/**
 * 값 한 줄 + **왜 못 건드리는지**.
 *
 * ★ 화면이 판정을 다시 하지 않는다 — 서버가 「쓰이는 중인가」·「앱이 박았는가」를 적어
 *   보내고, 화면은 그 두 칸을 보고 버튼을 잠근다. 두 곳이 따로 판정하면 화면은
 *   통과시키는데 저장이 막히는 어긋남이 생긴다(센터 관리의 「입주 가능 회사 수」와 같은 교훈).
 */
const toLine = (l: LineRow, usage: readonly UsageHit[], pinnedBy: string | null) => ({
  lineId: l.line_id,
  code: l.code,
  name: l.name,
  description: l.description,
  sortOrder: l.sort_order,
  isActive: l.is_active,
  isSystem: l.is_system,
  /** 이 코드값을 쓰는 업무 자료. 비어 있으면 지울 수 있다. */
  usage: usage.map((u) => ({ label: u.label, count: u.count })),
  /** 앱 코드가 이 코드값을 상수로 들고 있으면 그 자리. 있으면 코드값 변경·삭제 불가. */
  pinnedBy,
});

/** 「무엇이 몇 건」 문구. 「호실 3건 · 계약 호실 2건」 */
const usageText = (hits: readonly UsageHit[]): string =>
  hits.map((h) => `${h.label} ${h.count}건`).join(' · ');

export function registerCodeRoutes(app: FastifyInstance): void {
  // ===========================================================================
  // 조회
  // ===========================================================================

  /**
   * 화면이 처음에 받는 것 — 머리 전체 + 파티션 전체.
   *
   * ★ 값(118행)은 넣지 않는다. 파티션을 고른 뒤에 받는다 — 전부 실으면 파티션을 옮길
   *   때마다 다 다시 보내게 된다(센터 관리의 트리와 같은 이유).
   */
  app.get('/codes-admin/tree', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const data = await withCompanyScope(OPERATOR_SCOPE, async (client) => ({
      masters: await listMasters(client),
      categories: await listCategories(client),
    }));

    return reply.send({
      masters: data.masters.map(toMaster),
      categories: data.categories.map(toCategory),
    });
  });

  /**
   * 한 파티션의 값들 — **쓰임까지 함께** 센다.
   *
   * ★ 화면이 표를 그리면서 바로 「쓰는 중」을 보여 줄 수 있어야 한다. 행마다 따로 물으면
   *   값 7개짜리 파티션에서 왕복이 7번이다.
   */
  app.get<{ Params: { category: string; useTp: string } }>(
    '/codes-admin/:category/:useTp/lines',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      const { category, useTp } = req.params;
      const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
        const found = await findCategory(client, BUILD_ID, category, useTp);
        if (!found) return null;
        return {
          lines: await listLines(client, category, useTp),
          usage: await countUsageByCode(client, category, useTp),
        };
      });
      if (!result) return notFound(reply, '사용타입');

      return reply.send({
        lines: result.lines.map((l) =>
          toLine(l, result.usage.get(l.code) ?? [], pinnedRefFor(category, useTp, l.code)?.source ?? null),
        ),
        /**
         * ★ 이 파티션의 코드값이 **어느 업무 컬럼에 박히는지** 화면에 알려 준다.
         *   선언표에 한 줄도 없으면 화면이 「이 분류는 쓰임이 등록돼 있지 않다」고 적어
         *   운영자에게 경고한다 — 빠뜨린 줄을 사람이 알아차리는 유일한 자리다.
         */
        usageRefs: usageRefsFor(category, useTp).map((r) => ({ label: r.label, table: r.table })),
      });
    },
  );

  /**
   * ★★ 한 분류의 **코드값 전부** — 사용타입을 가리지 않는다.
   *
   * 화면이 왼쪽에서 분류를 고르면 이것을 받는다(2026-10-03 개편). 예전에는 사용타입을
   * 고른 뒤에야 코드값이 나왔는데, 왼쪽 목록에서 사용타입을 뺐으므로 오른쪽이 분류
   * 전체를 받고 **사용타입을 첫 칸이자 검색 조건**으로 둔다.
   *
   * ★ 사용타입 목록도 함께 보낸다 — 검색 조건의 선택지이고, 코드값 행에 붙일 **이름**
   *   (「공통」·「납부관리용」)이 거기 있다.
   */
  app.get<{ Params: { category: string } }>(
    '/codes-admin/masters/:category/lines',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      const { category } = req.params;
      const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
        const master = await findMaster(client, BUILD_ID, category);
        if (!master) return null;
        const all = await listCategories(client);
        return {
          partitions: all.filter((c) => c.category === category),
          lines: await listLinesOfMaster(client, BUILD_ID, category),
          usage: await countUsageByMaster(client, category),
        };
      });
      if (!result) return notFound(reply, '분류코드');

      const nameOf = new Map(result.partitions.map((p) => [p.use_tp, p.name]));

      return reply.send({
        partitions: result.partitions.map(toCategory),
        lines: result.lines.map((l) => ({
          ...toLine(
            l,
            result.usage.get(usageKey(l.use_tp, l.code)) ?? [],
            pinnedRefFor(l.category, l.use_tp, l.code)?.source ?? null,
          ),
          useTp: l.use_tp,
          useTpName: nameOf.get(l.use_tp) ?? l.use_tp,
        })),
        /**
         * 이 분류의 코드값이 저장되는 자리 — 사용타입마다 다를 수 있어 **합쳐서** 보낸다.
         * ★ 비어 있고 박아 둔 코드값도 없으면 화면이 경고 띠를 띄운다.
         */
        usageRefs: CODE_USAGE.filter((u) => u.category === category).map((r) => ({
          label: r.label,
          table: r.table,
          useTp: r.useTp,
        })),
      });
    },
  );

  // ===========================================================================
  // 머리 (분류)
  // ===========================================================================

  app.post<{ Body: { category?: string; name?: string; description?: string } }>(
    '/codes-admin/masters',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      const category = text(req.body?.category)?.toUpperCase() ?? null;
      const name = text(req.body?.name);
      if (!category) return badRequest(reply, '분류코드를 입력해 주세요');
      if (!CATEGORY_RE.test(category)) {
        return badRequest(
          reply,
          '분류코드는 영문 대문자로 시작하고 영문 대문자·숫자·밑줄만 쓸 수 있습니다 (예: ROOM_TP)',
        );
      }
      if (!name) return badRequest(reply, '분류코드명을 입력해 주세요');

      const made = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
        if (await findMaster(client, BUILD_ID, category)) return false;
        /* ★ 공통 파티션(000)도 함께 만든다 — 없으면 코드를 하나도 담을 수 없다. */
        await insertMaster(client, {
          buildId: BUILD_ID,
          category,
          patch: { name, description: text(req.body?.description) },
          actor: actorOf(session),
        });
        return true;
      });
      if (!made) return conflict(reply, `이미 있는 분류코드입니다: ${category}`);

      return reply.code(201).send({ category, useTp: COMMON_USE_TP });
    },
  );

  /** 머리 이름·설명 수정. ★ 분류 키(`category`)는 바꿀 수 없다 — 소스에 박히는 값이다. */
  app.patch<{ Params: { category: string }; Body: { name?: string; description?: string } }>(
    '/codes-admin/masters/:category',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      const name = text(req.body?.name);
      if (!name) return badRequest(reply, '분류코드명을 입력해 주세요');

      const changed = await withCompanyScope(OPERATOR_SCOPE, (client) =>
        updateMaster(client, {
          buildId: BUILD_ID,
          category: req.params.category,
          patch: { name, description: text(req.body?.description) },
          actor: actorOf(session),
        }),
      );
      if (changed === 0) return notFound(reply, '분류코드');
      return reply.send({ category: req.params.category });
    },
  );

  /**
   * 분류코드 삭제 — ★★ **공통(000) 사용타입을 함께 지운다.**
   *
   * =============================================================================
   * ★★★ 2026-10-03 — 여기에 **교착**이 있었다 (사용자 결정으로 풀었다)
   * =============================================================================
   * 예전에는 「사용타입이 하나라도 남아 있으면 409」였다. 그런데 분류코드를 만들면
   * 공통(000)이 **함께 생기고**, 그 000 은 「분류코드를 지우면 함께 사라집니다」라며
   * 403 으로 막혀 있었다. 그래서 **어떤 분류코드도 영원히 지워지지 않았다** —
   * 실측(2026-10-03): 생성 201 → 삭제 409 → 000 삭제 403 → 삭제 409.
   *
   * 문구가 약속한 대로 고쳤다. 지금은:
   *   · 남은 것이 **공통(000) 하나뿐이고 코드값이 0개**면 → 000 을 지우고 분류코드를 지운다
   *   · **다른 사용타입**이 있거나 **코드값이 하나라도** 있으면 → 409 그대로
   *
   * ★ 둘을 **한 트랜잭션 안에서** 지운다(`withCompanyScope` 한 번). 000 만 지워지고
   *   분류코드가 남으면 코드값을 담을 자리가 없는 분류코드가 생긴다 — 교착의 반대 모양이다.
   */
  app.delete<{ Params: { category: string } }>(
    '/codes-admin/masters/:category',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      const { category } = req.params;
      const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
        const master = await findMaster(client, BUILD_ID, category);
        if (!master) return { kind: 'missing' as const };

        const { partitions, lines } = await countMasterPartitions(client, BUILD_ID, category);
        /* 코드값이 하나라도 남아 있으면 막는다 — 자료를 말없이 버리지 않는다. */
        if (lines > 0) return { kind: 'blocked' as const, partitions, lines };
        /* 공통(000) 말고 다른 사용타입이 남아 있으면 막는다. */
        if (partitions > 1) return { kind: 'blocked' as const, partitions, lines };

        /* 남은 것은 공통(000) 하나뿐(또는 없음) — 함께 지운다. */
        await deleteCategory(client, BUILD_ID, category, COMMON_USE_TP);
        await deleteMaster(client, BUILD_ID, category);
        return { kind: 'deleted' as const };
      });

      if (result.kind === 'missing') return notFound(reply, '분류코드');
      if (result.kind === 'blocked') {
        return inUse(
          reply,
          result.lines > 0
            ? `코드값 ${result.lines}개가 남아 있어 지울 수 없습니다. 코드값을 먼저 지워 주세요`
            : `공통(000) 말고 사용타입 ${result.partitions - 1}개가 남아 있어 지울 수 없습니다. ` +
              '사용타입을 먼저 지워 주세요',
        );
      }
      return reply.send({ category });
    },
  );

  // ===========================================================================
  // 파티션
  // ===========================================================================

  app.post<{
    Params: { category: string };
    Body: { useTp?: string; name?: string; description?: string };
  }>('/codes-admin/masters/:category/partitions', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const { category } = req.params;
    const useTp = text(req.body?.useTp);
    const name = text(req.body?.name);
    if (!useTp) return badRequest(reply, '사용타입 번호를 입력해 주세요');
    if (!USE_TP_RE.test(useTp)) {
      return badRequest(reply, '사용타입 번호는 숫자 3자입니다 (000 · 001 · 002 …)');
    }
    if (!name) return badRequest(reply, '사용타입 이름을 입력해 주세요');

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      if (!(await findMaster(client, BUILD_ID, category))) return 'no-master' as const;
      if (await findCategory(client, BUILD_ID, category, useTp)) return 'duplicate' as const;
      await insertCategory(client, {
        buildId: BUILD_ID,
        category,
        useTp,
        patch: { name, description: text(req.body?.description) },
        actor: actorOf(session),
      });
      return 'created' as const;
    });

    if (result === 'no-master') return notFound(reply, '분류코드');
    if (result === 'duplicate') {
      return conflict(reply, `이미 있는 사용타입입니다: ${category}/${useTp}`);
    }
    return reply.code(201).send({ category, useTp });
  });

  app.patch<{
    Params: { category: string; useTp: string };
    Body: { name?: string; description?: string };
  }>('/codes-admin/masters/:category/partitions/:useTp', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const name = text(req.body?.name);
    if (!name) return badRequest(reply, '사용타입 이름을 입력해 주세요');

    const { category, useTp } = req.params;
    const changed = await withCompanyScope(OPERATOR_SCOPE, (client) =>
      updateCategory(client, {
        buildId: BUILD_ID,
        category,
        useTp,
        patch: { name, description: text(req.body?.description) },
        actor: actorOf(session),
      }),
    );
    if (changed === 0) return notFound(reply, '사용타입');
    return reply.send({ category, useTp });
  });

  /**
   * 파티션 삭제.
   *
   * ★ 값이 남아 있으면 막는다(FK 와 같은 판정, 문구를 만들기 위해 먼저 센다).
   * ★★ 공통(`000`)은 지울 수 없다 — 머리가 코드를 담을 자리를 잃는다.
   */
  app.delete<{ Params: { category: string; useTp: string } }>(
    '/codes-admin/masters/:category/partitions/:useTp',
    async (req, reply) => {
      const session = requireSession(req);
      if (session.role !== OPERATOR) return forbidden(reply);

      const { category, useTp } = req.params;
      if (useTp === COMMON_USE_TP) {
        /*
         * ★ 이것은 **시스템 차단이 아니다**(사용자 확인 2026-10-03). 분류코드는 코드값을
         *   담을 자리를 항상 하나 가져야 하고, 000 이 그 자리다 — 만들 때 함께 생기고
         *   분류코드를 지울 때 함께 사라진다.
         */
        return notAllowed(
          reply,
          '공통(000) 사용타입은 지울 수 없습니다. 분류코드를 지우면 함께 사라집니다',
        );
      }

      const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
        const found = await findCategory(client, BUILD_ID, category, useTp);
        if (!found) return { kind: 'missing' as const };

        const lines = await countCategoryLines(client, BUILD_ID, category, useTp);
        if (lines > 0) return { kind: 'blocked' as const, lines };

        await deleteCategory(client, BUILD_ID, category, useTp);
        return { kind: 'deleted' as const };
      });

      if (result.kind === 'missing') return notFound(reply, '사용타입');
      if (result.kind === 'blocked') {
        return inUse(
          reply,
          `코드값 ${result.lines}개가 남아 있어 지울 수 없습니다. 코드값을 먼저 지워 주세요`,
        );
      }
      return reply.send({ category, useTp });
    },
  );

  // ===========================================================================
  // 값 (코드)
  // ===========================================================================

  app.post<{
    Params: { category: string; useTp: string };
    Body: { code?: string; name?: string; description?: string; sortOrder?: string | number };
  }>('/codes-admin/:category/:useTp/lines', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const { category, useTp } = req.params;
    const code = text(req.body?.code);
    const name = text(req.body?.name);
    if (!code) return badRequest(reply, '코드값을 입력해 주세요');
    if (!CODE_RE.test(code)) return badRequest(reply, '코드값은 공백 없이 1~20자입니다');
    if (!name) return badRequest(reply, '코드값 이름을 입력해 주세요');

    const sortOrder = int(req.body?.sortOrder);
    if (sortOrder !== null && sortOrder < 0) return badRequest(reply, '순서는 0 이상입니다');

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      if (!(await findCategory(client, BUILD_ID, category, useTp))) return 'no-partition' as const;
      if (await findLineByCode(client, BUILD_ID, category, useTp, code)) return 'duplicate' as const;

      const order = sortOrder ?? (await nextSortOrder(client, BUILD_ID, category, useTp));
      const lineId = await insertLine(client, {
        buildId: BUILD_ID,
        category,
        useTp,
        patch: {
          code,
          name,
          description: text(req.body?.description),
          sortOrder: order,
          isActive: true,
        },
        actor: actorOf(session),
      });
      return { lineId };
    });

    if (result === 'no-partition') return notFound(reply, '사용타입');
    if (result === 'duplicate') {
      /* ★ 같은 code 라도 **다른 파티션**이면 별개다. 그래서 파티션까지 넣어 말한다. */
      return conflict(reply, `이 사용타입(${category}/${useTp})에 이미 있는 코드값입니다: ${code}`);
    }
    return reply.code(201).send(result);
  });

  /**
   * 값 수정 — **이름은 언제나, 코드값·사용여부는 안 쓰일 때만.**
   *
   * ★★★ 이 핸들러가 이 화면의 핵심이다. 세 갈래로 막는다:
   *      ① 코드값을 바꾸려는데 쓰이는 중 → 409
   *      ② 끄려는데 쓰이는 중           → 409 (`listCodes` 가 켜진 것만 읽는다)
   *      ③ 앱이 상수로 박아 둔 코드값   → 409 (자료가 0행이어도)
   *    이름만 바꾸는 것은 **전부 통과**한다 — 그래야 「이름을 고치면 쓰는 화면에 바로
   *    반영된다」가 성립한다.
   */
  app.patch<{
    Params: { id: string };
    Body: {
      code?: string;
      name?: string;
      description?: string;
      sortOrder?: string | number;
      isActive?: boolean;
    };
  }>('/codes-admin/lines/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const name = text(req.body?.name);
    if (!name) return badRequest(reply, '코드값 이름을 입력해 주세요');

    const nextCode = text(req.body?.code);
    if (nextCode !== null && !CODE_RE.test(nextCode)) {
      return badRequest(reply, '코드값은 공백 없이 1~20자입니다');
    }
    const sortOrder = int(req.body?.sortOrder);
    if (sortOrder !== null && sortOrder < 0) return badRequest(reply, '순서는 0 이상입니다');

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const line = await findLine(client, req.params.id);
      if (!line) return { kind: 'missing' as const };

      const code = nextCode ?? line.code;
      const isActive = req.body?.isActive ?? line.is_active;
      const codeChanging = code !== line.code;
      const turningOff = line.is_active && !isActive;

      /* ③ 앱이 박아 둔 코드값 — 자료가 없어도 막는다. */
      if (codeChanging || turningOff) {
        const pinned = pinnedRefFor(line.category, line.use_tp, line.code);
        if (pinned) {
          return {
            kind: 'pinned' as const,
            what: codeChanging ? '코드값' : '사용여부',
            label: pinned.label,
            source: pinned.source,
          };
        }
      }

      /* ①② 쓰이는 중인가 — 바꾸려는 것이 코드값이거나 끄는 것일 때만 센다. */
      if (codeChanging || turningOff) {
        const hits = await countCodeUsage(client, line.category, line.use_tp, line.code);
        if (hits.length > 0) {
          return {
            kind: 'in-use' as const,
            what: codeChanging ? '코드값' : '사용여부',
            hits,
          };
        }
      }

      /* 코드값을 바꾼다면 같은 파티션에 그 값이 이미 없는지 본다. */
      if (codeChanging) {
        const dup = await findLineByCode(client, BUILD_ID, line.category, line.use_tp, code);
        if (dup) return { kind: 'duplicate' as const, code, category: line.category, useTp: line.use_tp };
      }

      await updateLine(client, {
        lineId: line.line_id,
        patch: {
          code,
          name,
          description: text(req.body?.description),
          sortOrder: sortOrder ?? line.sort_order,
          isActive,
        },
        actor: actorOf(session),
      });
      return { kind: 'updated' as const };
    });

    switch (result.kind) {
      case 'missing':
        return notFound(reply, '코드값');
      case 'pinned':
        return inUse(
          reply,
          `${withParticle(result.label, '이', '가')} 이 코드값을 직접 쓰고 있어 ` +
            `${withParticle(result.what, '을', '를')} 바꿀 수 없습니다. ` +
            `이름은 바꿀 수 있습니다 (${result.source})`,
        );
      case 'in-use':
        return inUse(
          reply,
          `${usageText(result.hits)}에서 쓰고 있어 ${withParticle(result.what, '을', '를')} 바꿀 수 없습니다. ` +
            '이름은 바꿀 수 있습니다',
        );
      case 'duplicate':
        return conflict(
          reply,
          `이 파티션(${result.category}/${result.useTp})에 이미 있는 코드값입니다: ${result.code}`,
        );
      default:
        return reply.send({ lineId: req.params.id });
    }
  });

  /**
   * 값 삭제.
   *
   * ★★★ 쓰이는 중이면 409 로 막고, **몇 건인지와 대안(이름 수정)을 문구에 담는다.**
   */
  app.delete<{ Params: { id: string } }>('/codes-admin/lines/:id', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== OPERATOR) return forbidden(reply);

    const result = await withCompanyScope(OPERATOR_SCOPE, async (client) => {
      const line = await findLine(client, req.params.id);
      if (!line) return { kind: 'missing' as const };

      const pinned = pinnedRefFor(line.category, line.use_tp, line.code);
      if (pinned) {
        return { kind: 'pinned' as const, label: pinned.label, source: pinned.source };
      }

      const hits = await countCodeUsage(client, line.category, line.use_tp, line.code);
      if (hits.length > 0) return { kind: 'in-use' as const, hits };

      await deleteLine(client, line.line_id);
      return { kind: 'deleted' as const };
    });

    switch (result.kind) {
      case 'missing':
        return notFound(reply, '코드값');
      case 'pinned':
        return inUse(
          reply,
          `${withParticle(result.label, '이', '가')} 이 코드값을 직접 쓰고 있어 지울 수 없습니다 (${result.source})`,
        );
      case 'in-use':
        return inUse(
          reply,
          `${usageText(result.hits)}에서 쓰고 있어 지울 수 없습니다. ` +
            '이름만 고치려면 수정을 쓰세요',
        );
      default:
        return reply.send({ lineId: req.params.id });
    }
  });
}
