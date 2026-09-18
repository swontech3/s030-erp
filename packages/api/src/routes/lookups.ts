/**
 * 조회 전용 라우트 — 계약 폼이 셀렉트를 채우는 데 필요한 두 가지(4-4).
 *
 * =============================================================================
 * ★★ 범위 — 조회 둘뿐이다. 「호실 관리」가 아니다
 * =============================================================================
 *   만든다    GET /spaces  호실 목록 (72실 전부)
 *             GET /codes   계약구분 · 납부방법 · 접근경로
 *   안 만든다 등록 · 수정 · 삭제        → 페이즈 2(기준관리)
 *             필터 · 페이징 · 정렬      → 72실이다. 전부 내려주고 화면이 거른다
 *             건물 · 층 관리 화면       → 페이즈 2
 *
 * 페이즈 2 가 CRUD 를 만들 때 이 조회는 **그대로 살아 있으면 된다.** 여기에 쓰기를
 * 덧붙이지 말고 그쪽에서 새로 만든다 — 읽기 전용이라는 것이 이 파일의 유일한 성질이다.
 *
 * =============================================================================
 * ★★ 운영사 전용이다
 * =============================================================================
 * 호실 테이블에는 RLS 가 없다(`doc/LEGACY_DATA_SURVEY.md` §A-5). 정책이 거르지
 * 않으므로 **입주사 세션이 이 라우트를 부르면 72실 전부를 본다.** 계약 화면과 같은
 * 잠금을 여기서 건다 — 화면에서 감추는 것으로는 부족하다.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import { listCodes, listSpaces } from '../db/lookups.ts';

/** 계약 화면과 같은 값이다(`routes/contracts.ts`). */
const READ_ROLE = 'operator';

/**
 * 계약 폼이 쓰는 코드 카테고리. **여기 없는 카테고리는 내려가지 않는다.**
 *
 * 화면이 카테고리를 골라 보내게 하지 않는다 — 코드 마스터에는 법인 설립·문서 종류처럼
 * 계약과 무관한 것이 22종 있고, 그걸 아무나 받아 갈 이유가 없다.
 *
 * ★ 회원구분(`MEMBER_TYPE`)은 **일부러 뺐다.** DB 의 그것은 법인 형태 + 상호 표기
 *   위치(「주식회사 앞/뒤」)라 계약 폼의 「프리랜서 / 개인사업자 / 법인」과 **같은
 *   이름의 다른 개념**이다(`doc/CONTRACT_DATA_MODEL.md` §C-3 ⑤). 연결하면 운영자가
 *   엉뚱한 목록을 보게 된다. 판단이 끝나기 전까지 화면 상수로 둔다.
 * ★ 이메일 도메인은 코드 자체가 DB 에 없다(같은 문서 §C-3 ④).
 */
const CONTRACT_FORM_CODES = ['ROOM_TP', 'PAYMENT_METHOD', 'ACCESS_ROUTE'] as const;

const scopeOf = (session: { role: string; companyId: string | null }): CompanyScope => ({
  role: session.role as CompanyScope['role'],
  companyId: session.companyId,
});

export function registerLookupRoutes(app: FastifyInstance): void {
  // ── 호실 목록 ───────────────────────────────────────────────────────────
  app.get('/spaces', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== READ_ROLE) {
      return reply.code(403).send({ error: 'forbidden', message: '호실 목록은 운영사만 조회할 수 있습니다' });
    }

    const rows = await withCompanyScope(scopeOf(session), (client) => listSpaces(client));
    return reply.send({
      spaces: rows.map((s) => ({
        spaceId: s.space_id,
        buildId: s.build_id,
        // 이름이 없으면 식별자를 보여주는 대신 빈 값을 준다 — 화면이 「(이름 없음)」을
        // 고르게 둔다. cuid 가 셀렉트에 뜨는 것이 이 두 칸을 가져온 이유다.
        buildName: s.build_name ?? '',
        floorId: s.floor_id,
        floorName: s.floor_name ?? '',
        // 화면에 뜨는 이름. 비어 있으면 셀렉트가 빈 줄이 되므로 식별자로 대신한다 —
        // 72건 전부 값이 있지만(§A-3) NULL 허용 컬럼이라 방어한다.
        roomName: s.room_name ?? s.space_id,
        /** 코드 `ROOM_TP`. 화면이 계약구분으로 거를 때 쓰는 값이다. */
        roomType: s.room_type,
        // ★ 72건 전부 값이 있다. NULL 이면 0 이 아니라 그대로 두고 화면이 비워 둔다 —
        //   0원짜리 호실과 값이 없는 호실은 다르다.
        standardFee: s.standard_fee,
        // ★ 72건 전부 NULL 이다(§A-2). 화면은 예치금 기본값을 월회비에서 가져온다.
        deposit: s.deposit,
      })),
    });
  });

  // ── 코드 ────────────────────────────────────────────────────────────────
  app.get('/codes', async (req, reply) => {
    const session = requireSession(req);
    if (session.role !== READ_ROLE) {
      return reply.code(403).send({ error: 'forbidden', message: '코드 목록은 운영사만 조회할 수 있습니다' });
    }

    const rows = await withCompanyScope(scopeOf(session), (client) =>
      listCodes(client, CONTRACT_FORM_CODES),
    );
    return reply.send({
      codes: rows.map((c) => ({ category: c.category, code: c.code, name: c.name })),
    });
  });
}
