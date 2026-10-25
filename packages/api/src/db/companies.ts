/**
 * 입주사·구성원 저장소 — SQL 이 모여 있는 유일한 자리(3-4).
 *
 * ★ 전부 `withCompanyScope()` 가 연 트랜잭션 안에서 도는 것을 전제한다. `companies` 와
 *   `members` 둘 다 RLS 가 걸려 있어(003), 스코프 없는 커넥션은 **조용히 0행**을 본다.
 *
 * ★★ `updated_at` 을 매번 명시한다. 이 레거시 테이블들도 **NOT NULL 인데 DEFAULT 가 없다** —
 *    빼고 INSERT 하면 `23502` 로 죽는다(계약 테이블과 같은 사정, `db/contracts.ts` 머리말).
 */
import { MEMBER_ROLE } from '@swonbiz/shared/domain/member-payload';
import type { ScopedClient } from './withCompanyScope.ts';
import type { MemberSyncField } from '../bbiyong/memberSync.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

export interface CompanyRow {
  company_id: string;
  build_id: string;
  company_name: string;
  biz_number: string | null;
  corp_number: string | null;
  ceo_name: string | null;
  business_type: string | null;
  business_item: string | null;
  member_type: string | null;
  tel: string | null;
  email: string | null;
  ceo_zip_code: string | null;
  ceo_address: string | null;
  ceo_address_detail: string | null;
  memo: string | null;
  status: string;
  /* ── 삐용 연동(3-2) — 조회 전용. 목록과 상세가 「미연동」을 표시하는 근거다. ── */
  link_s020_org_id: number | null;
  link_org_code: string | null;
  link_status: string | null;
  link_failed_reason: string | null;
}

const COMPANY_COLUMNS = `
  company_id, build_id, company_name, biz_number, corp_number, ceo_name,
  business_type, business_item, member_type, tel, email,
  ceo_zip_code, ceo_address, ceo_address_detail, memo, status,
  link_s020_org_id, link_org_code, link_status, link_failed_reason`;

export async function listCompanies(client: ScopedClient): Promise<CompanyRow[]> {
  const { rows } = await q<CompanyRow>(
    client,
    `SELECT ${COMPANY_COLUMNS} FROM public.tb_s080_companies ORDER BY company_name, company_id`,
  );
  return rows;
}

export async function findCompany(client: ScopedClient, companyId: string): Promise<CompanyRow | null> {
  const { rows } = await q<CompanyRow>(
    client,
    `SELECT ${COMPANY_COLUMNS} FROM public.tb_s080_companies WHERE company_id = $1`,
    [companyId],
  );
  return rows[0] ?? null;
}

/** 상태 판정에 필요한 최소한. 규칙은 `@swonbiz/shared/domain/tenant-status` 가 갖는다. */
export interface ContractFactRow {
  company_id: string;
  status: string;
  end_date: Date;
}

export async function listContractFacts(client: ScopedClient): Promise<ContractFactRow[]> {
  const { rows } = await q<ContractFactRow>(
    client,
    `SELECT company_id, status, end_date FROM public.tb_s080_contracts ORDER BY company_id`,
  );
  return rows;
}

export interface RoomSummaryRow {
  company_id: string;
  room_name: string | null;
  contract_room: string | null;
}

/**
 * 입주사마다 **대표 호실 한 줄** — 카드 2행과 우측 헤더에 쓴다(시안 `Room-1 (1-10)`).
 *
 * 가장 늦게 끝나는 확정 계약의 1행 호실을 쓴다. 계약이 여러 건이어도 한 줄만 보여주는
 * 자리라 «가장 최근 것»이 가장 덜 틀린 선택이다.
 */
export async function listRoomSummaries(client: ScopedClient): Promise<RoomSummaryRow[]> {
  const { rows } = await q<RoomSummaryRow>(
    client,
    `SELECT DISTINCT ON (k.company_id)
            k.company_id, s.room_name, k.contract_room
       FROM public.tb_s080_contracts k
       JOIN public.tb_s080_contract_spaces cs
         ON cs.contract_id = k.contract_id AND cs.seq = 1
       LEFT JOIN public.tb_s080_spaces s ON s.space_id = cs.space_id
      WHERE k.status = 'confirmed'
      ORDER BY k.company_id, k.end_date DESC`,
  );
  return rows;
}

/** 계약 목록 — 우측 패널의 계약 테이블. 호실 요약을 붙여서 한 번에 가져온다. */
export interface CompanyContractRow {
  contract_id: string;
  contract_no: string | null;
  status: string;
  period_months: number | null;
  contract_date: string | null;
  start_date: Date;
  end_date: Date;
  payment_method: string | null;
  contract_room: string | null;
  first_payment: number;
  monthly_payment: number;
  deposit_total: number;
  room_types: string | null;
  room_names: string | null;
  space_count: number;
}

export async function listCompanyContracts(
  client: ScopedClient,
  companyId: string,
): Promise<CompanyContractRow[]> {
  const { rows } = await q<CompanyContractRow>(
    client,
    `SELECT k.contract_id, k.contract_no, k.status, k.period_months, k.contract_date,
            k.start_date, k.end_date, k.payment_method, k.contract_room, k.first_payment,
            coalesce(a.monthly_payment, 0) AS monthly_payment,
            coalesce(a.deposit_total, 0)   AS deposit_total,
            a.room_types, a.room_names, coalesce(a.space_count, 0) AS space_count
       FROM public.tb_s080_contracts k
       LEFT JOIN LATERAL (
         SELECT sum(cs.payment_amount)::int AS monthly_payment,
                sum(cs.deposit)::int        AS deposit_total,
                count(*)::int               AS space_count,
                string_agg(DISTINCT cs.room_type, ',')         AS room_types,
                string_agg(s.room_name, ' / ' ORDER BY cs.seq) AS room_names
           FROM public.tb_s080_contract_spaces cs
           LEFT JOIN public.tb_s080_spaces s ON s.space_id = cs.space_id
          WHERE cs.contract_id = k.contract_id
       ) a ON true
      WHERE k.company_id = $1
      ORDER BY k.start_date DESC, k.contract_id`,
    [companyId],
  );
  return rows;
}

/** 섹션 1 이 고치는 칸만. 계약·상태·건물은 여기서 바뀌지 않는다. */
export interface CompanyPatch {
  /**
   * ★ `null` 이면 **기존 값을 그대로 둔다**(다른 칸은 `null` 이 「지운다」는 뜻이다).
   *   `company_name` 은 `NOT NULL` 이라 비울 수 없고, 사업자등록 신청 중인 가계약은
   *   회사명 없이 임시저장으로 들어온다.
   */
  companyName: string | null;
  bizNumber: string | null;
  corpNumber: string | null;
  ceoName: string | null;
  businessType: string | null;
  businessItem: string | null;
  memberType: string | null;
  tel: string | null;
  email: string | null;
  ceoZipCode: string | null;
  ceoAddress: string | null;
  ceoAddressDetail: string | null;
  memo: string | null;
}

/**
 * 입주사를 새로 만든다 — 계약 폼을 `companyId` 없이 열었을 때의 첫 저장이다.
 *
 * =============================================================================
 * ★★ 삐용에는 여기서 만들지 않는다 — **계약을 확정할 때** 만든다
 * =============================================================================
 * 여기서 만드는 것은 **ERP 테이블 한 행**뿐이다. 삐용 조직 등록과 단체코드 발급은
 * **계약 확정 시점**이다(대표 결정 2026-09-30 · `companies/registerOrg.ts`).
 *
 * ★ 3-2 를 「이 저장 경로에 얹는다」고 적어 두었던 것을 **확정 시점으로 바꿨다.**
 *   사업자등록 신청 중인 가계약은 회사명 없이 임시저장으로 들어오고, 그 상태로
 *   삐용에 회사를 만들면 취소됐을 때 **삐용에 지울 수 없는 회사**가 남는다
 *   (삭제 규격이 확인되지 않았다). 확정된 계약이 있는 회사만 삐용에 만든다.
 *
 * 그래서 `link_s020_org_id` 는 비워 둔다 — 연결되지 않은 입주사라는 뜻이고, 스코프
 * 해석은 그 상태를 이미 알고 있다(`ORG_ARCHITECTURE.md` §1-2 「연결이 없으면 빈 스코프」).
 *
 * ★ `company_name` 이 `NOT NULL` 이라 **빈 이름은 빈 문자열로 넣는다.** 막지 않는
 *   이유는 `updateCompany` 와 같다 — 사업자등록 신청 중인 가계약은 회사명 없이
 *   임시저장으로 들어오고, 400 으로 막으면 같은 요청의 대표자·연락처까지 날아간다.
 *
 * ★ `status` 는 컬럼 기본값(`'R'`)에 맡긴다. 입주사의 표시 상태는 이 컬럼이 아니라
 *   **계약에서 파생된다**(`domain/tenant-status` 의 `deriveTenantStatus`). 여기서
 *   아무 값이나 정해 넣으면 두 벌이 된다.
 *
 * ★ `updated_at` 을 명시한다 — 이 레거시 테이블은 NOT NULL 인데 DEFAULT 가 없다
 *   (파일 머리말).
 */
export async function insertCompany(
  client: ScopedClient,
  args: { companyId: string; buildId: string; patch: CompanyPatch; actor: string },
): Promise<void> {
  const { companyId, buildId, patch, actor } = args;
  await q(
    client,
    `INSERT INTO public.tb_s080_companies
       (company_id, build_id, company_name, biz_number, corp_number, ceo_name,
        business_type, business_item, member_type, tel, email,
        ceo_zip_code, ceo_address, ceo_address_detail, memo,
        created_at, updated_at, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now(), $16, $16)`,
    [
      companyId, buildId, patch.companyName ?? '', patch.bizNumber, patch.corpNumber, patch.ceoName,
      patch.businessType, patch.businessItem, patch.memberType, patch.tel, patch.email,
      patch.ceoZipCode, patch.ceoAddress, patch.ceoAddressDetail, patch.memo, actor,
    ],
  );
}

/**
 * 같은 사업자번호의 입주사 — 계약 폼 섹션 1 의 [확인] 이 쓴다.
 *
 * ★ **숫자만 비교한다.** 저장된 값은 `000-00-00000` 인데 들어오는 값이 하이픈 없는
 *   10자리일 수 있다. 문자열 그대로 비교하면 같은 회사를 못 찾고 **중복이 없다고
 *   답한다** — `biz_number` 가 UNIQUE 라 저장 단계에서 409 로 터진다.
 *
 * ★ 상태 판정에 필요한 계약까지 같이 읽는다. 「종료」인 입주사는 중복이 아니라
 *   재입주라서, 계약을 봐야 그것을 가를 수 있다(`deriveTenantStatus`).
 */
export interface CompanyByBizNumber {
  company_id: string;
  company_name: string;
  contracts: { status: string; end_date: Date }[];
}

export async function findCompanyByBizNumber(
  client: ScopedClient,
  digits: string,
): Promise<CompanyByBizNumber | null> {
  const { rows } = await q<{ company_id: string; company_name: string }>(
    client,
    `SELECT company_id, company_name
       FROM public.tb_s080_companies
      WHERE regexp_replace(COALESCE(biz_number, ''), '\\D', '', 'g') = $1
      LIMIT 1`,
    [digits],
  );
  const company = rows[0];
  if (!company) return null;

  const { rows: contracts } = await q<{ status: string; end_date: Date }>(
    client,
    `SELECT status, end_date FROM public.tb_s080_contracts WHERE company_id = $1`,
    [company.company_id],
  );
  return { ...company, contracts };
}

/**
 * 같은 **회사명**의 입주사 — [확인] 이 귀띔용으로 쓴다.
 *
 * ★★ 이것은 **막는 판정이 아니다.** 같은 상호는 법적으로 가능하고, 사업자번호가
 *    다르면 다른 회사다. 그래서 상태(`종료` 포함)를 가리지 않고 그냥 찾는다 —
 *    사업자번호 쪽과 규칙이 다른 자리라 헷갈리기 쉽다.
 *
 * ★ 앞뒤 공백과 대소문자를 무시한다. 「에스원3DP」와 「에스원3dp 」를 다른 회사로
 *   보면 귀띔의 쓸모가 없다. 가운데 공백은 건드리지 않는다 — 「우리 은행」과
 *   「우리은행」은 실제로 다른 상호일 수 있다.
 *
 * @param excludeCompanyId 지금 편집 중인 회사. 자기 이름을 자기에게 알려 주지 않는다.
 */
export async function findCompanyByName(
  client: ScopedClient,
  name: string,
  excludeCompanyId: string | null,
): Promise<{ company_id: string; company_name: string } | null> {
  const { rows } = await q<{ company_id: string; company_name: string }>(
    client,
    `SELECT company_id, company_name
       FROM public.tb_s080_companies
      WHERE lower(btrim(company_name)) = lower(btrim($1))
        AND ($2::text IS NULL OR company_id <> $2)
      LIMIT 1`,
    [name, excludeCompanyId],
  );
  return rows[0] ?? null;
}

/** 건물이 실재하는지. `build_id` 는 NOT NULL 이고 FK 가 없어서 오타가 조용히 들어간다. */
export async function buildExists(client: ScopedClient, buildId: string): Promise<boolean> {
  const { rows } = await q<{ one: number }>(
    client,
    `SELECT 1 AS one FROM public.tb_s080_buildings WHERE build_id = $1`,
    [buildId],
  );
  return rows.length > 0;
}

export async function updateCompany(
  client: ScopedClient,
  args: { companyId: string; patch: CompanyPatch; actor: string },
): Promise<void> {
  const { companyId, patch, actor } = args;
  await q(
    client,
    // ★ `company_name` 만 **비어 있으면 기존 값을 유지**한다(`COALESCE`). 다른 칸은
    //   비우면 지워지는데(`text('')` 가 null 을 준다) 이 칸은 그럴 수 없다 —
    //   `NOT NULL` 이고, 무엇보다 사업자등록 신청 중인 가계약은 회사명 없이 임시저장으로
    //   들어온다. 400 으로 막으면 그 임시저장이 섹션 3까지 통째로 날아간다.
    //   확정 경로는 화면이 회사명을 필수로 막으므로 이름 없는 계약이 확정될 길은 없다.
    `UPDATE public.tb_s080_companies
        SET company_name = COALESCE($2, company_name), biz_number = $3, corp_number = $4, ceo_name = $5,
            business_type = $6, business_item = $7, member_type = $8, tel = $9, email = $10,
            ceo_zip_code = $11, ceo_address = $12, ceo_address_detail = $13, memo = $14,
            updated_at = now(), updated_by = $15
      WHERE company_id = $1`,
    [
      companyId, patch.companyName, patch.bizNumber, patch.corpNumber, patch.ceoName,
      patch.businessType, patch.businessItem, patch.memberType, patch.tel, patch.email,
      patch.ceoZipCode, patch.ceoAddress, patch.ceoAddressDetail, patch.memo, actor,
    ],
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   구성원
   ══════════════════════════════════════════════════════════════════════════ */

export interface MemberRow {
  member_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  is_representative: string;
  memo: string | null;
  /** 삐용 회원번호(035). ★ 조회 전용 — 화면은 이 값으로 「연동됨」을 표시한다. */
  link_s020_member_id: number | null;
  /** 마지막 연동 실패 사유 — **운영자에게 그대로 보여주는 문구**다. 성공하면 비어 있다. */
  link_failed_reason: string | null;
}

/**
 * ★ `status='active'` 만 읽는다. 저장에서 빠진 사람은 지우지 않고 `inactive` 로 둔다 —
 *   아래 `replaceMembers` 참조.
 */
export async function listMembers(client: ScopedClient, companyId: string): Promise<MemberRow[]> {
  const { rows } = await q<MemberRow>(
    client,
    `SELECT member_id, name, phone, email, is_representative, memo,
            link_s020_member_id, link_failed_reason
       FROM public.tb_s080_members
      WHERE company_id = $1 AND status = 'active'
      ORDER BY sort_order, created_at, member_id`,
    [companyId],
  );
  return rows;
}

export interface MemberWrite {
  /** 기존 행이면 그 id, 새 행이면 `null`. */
  memberId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  /** 코드 — `'C'` 대표 / `'M'` 직원. 여기 오기 전에 정규화된다. */
  isRepresentative: string;
  memo: string | null;
}

export interface ReplaceMembersResult {
  inserted: number;
  updated: number;
  deactivated: number;
  /**
   * 삐용에 **보낼 것이 있는** 구성원들(ERP member_id) → **바뀐 칸들**(결정 2026-10-23 — `U` 는 바뀐 칸만).
   *
   * ★ 새로 만든 행(세 칸 모두)과, **이름·연락처·이메일 중 하나가 실제로 바뀐** 행이다. 비고만
   *   고친 저장은 여기 없다 — 삐용에 보내지 않는 값이다.
   * ★★ 이 목록은 `syncMembers` 의 `changed` 로 그대로 들어간다. 「무엇이 바뀌었나」를
   *    아는 자리는 저장을 한 이 함수뿐이다 — 삐용 쪽에 사본을 두지 않기 때문에
   *    나중에는 알 길이 없다(`link_*` 는 상태이고 값의 사본이 아니다).
   */
  changed: Map<string, Set<MemberSyncField>>;
}

/**
 * 구성원 명부를 통째로 맞춘다.
 *
 * =============================================================================
 * ★★ 빠진 사람을 **지우지 않는다** — `status='inactive'` 로 둔다
 * =============================================================================
 * `tb_s080_reservations.member_id` 가 이 표를 참조한다(`ON DELETE SET NULL`).
 * DELETE 하면 오류는 안 나지만 **그 사람이 잡은 예약의 예약자가 조용히 비워진다.**
 * 명부에서 빼는 것과 예약 이력을 지우는 것은 다른 일이다.
 *
 * 그래서 목록 조회는 `status='active'` 만 본다. 화면에서 지운 사람은 다시 뜨지 않고,
 * 예약 이력은 그대로 남는다.
 *
 * ★ `build_id` 는 회사 행에서 가져온다 — NOT NULL 인데 화면이 아는 값이 아니다.
 */
export async function replaceMembers(
  client: ScopedClient,
  args: {
    companyId: string;
    buildId: string;
    members: readonly MemberWrite[];
    actor: string;
    newId: () => string;
  },
): Promise<ReplaceMembersResult> {
  const { companyId, buildId, members, actor, newId } = args;

  /*
   * ★★ 쓰기 **전에** 지금 값을 읽어 둔다. 삐용에 `U` 를 보낼지 가리려면 「무엇이
   *    바뀌었나」를 알아야 하는데, UPDATE 의 `RETURNING` 은 **새 값**을 준다.
   *    비활성 행까지 읽는다 — 되살아나는 행이 있다.
   */
  const before = new Map<string, { name: string; phone: string | null; email: string | null }>();
  {
    const { rows } = await q<{ member_id: string; name: string; phone: string | null; email: string | null }>(
      client,
      `SELECT member_id, name, phone, email FROM public.tb_s080_members WHERE company_id = $1`,
      [companyId],
    );
    for (const r of rows) before.set(r.member_id, { name: r.name, phone: r.phone, email: r.email });
  }

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * ★★★ 다른 활성 대표를 **먼저** 내린다 — 색인이 중간 상태도 본다
   * ═══════════════════════════════════════════════════════════════════════
   * 035 의 `ux_s080_members_one_active_rep` 는 부분 UNIQUE **색인**이라 지연시킬 수
   * 없다. 대표가 한 행에서 다른 행으로 옮겨가는 저장은 아래 루프 중간에 「활성 대표
   * 둘」을 지나가고, 그 순간 색인이 저장을 막는다.
   *
   * ★ 그래서 이번에 대표가 될 행만 남기고 나머지 활성 대표를 먼저 비킨다. 새 행이
   *   대표면 들어올 id 가 없으므로 전부 비킨다.
   * ★ `is_representative` 는 삐용에 보내는 칸이 아니다(`repYn` 은 `I` 에서만 쓴다) —
   *   그래서 이 전처리는 「바뀐 것」으로 세지 않는다.
   *
   * ★★★ **비키는 방법이 둘이다. 이유가 있다.**
   *   · 명부에 **남는** 행은 `'M'`(직원)으로 내린다 — 계속 활성이라 색인을 비켜야 한다.
   *   · 명부에서 **빠지는** 행은 그 자리에서 `inactive` 로 내린다. ★★ 이때
   *     `is_representative` 를 **`'C'` 그대로 둔다.** `'M'` 으로 내려 두면 그 행이
   *     「삐용 번호를 든 **직원**」으로 보이고, `memberSync` 가 **대표에게 `D` 를
   *     보낸다** — 삐용은 대표를 지울 수 없어 거절하고, 아무도 고칠 수 없는
   *     「연동 대기」가 그 회사에 남는다. 대표인 채로 비활성이면 `memberSync` 가
   *     건너뛴다(그쪽 `orphans` 판정).
   */
  const incomingRep = members.find((m) => m.isRepresentative === MEMBER_ROLE.REPRESENTATIVE)?.memberId ?? null;
  /** 이번 페이로드가 들고 온 기존 행들. 이 안에 없는 행은 명부에서 빠지는 것이다. */
  const payloadIds = members.map((m) => m.memberId).filter((v): v is string => v !== null);

  // ① 명부에 남는 다른 대표 → 직원으로 내린다.
  await q(
    client,
    `UPDATE public.tb_s080_members
        SET is_representative = $3, updated_at = now(), updated_by = $2
      WHERE company_id = $1 AND status = 'active'
        AND is_representative = $4
        AND member_id = ANY($5::text[])
        AND ($6::text IS NULL OR member_id <> $6)`,
    [companyId, actor, MEMBER_ROLE.STAFF, MEMBER_ROLE.REPRESENTATIVE, payloadIds, incomingRep],
  );

  // ② 명부에서 빠지는 대표 → 바로 비활성. ★ 'C' 는 그대로 둔다(위 머리말).
  const steppedDown = await q(
    client,
    `UPDATE public.tb_s080_members
        SET status = 'inactive', updated_at = now(), updated_by = $2
      WHERE company_id = $1 AND status = 'active'
        AND is_representative = $3
        AND NOT (member_id = ANY($4::text[]))`,
    [companyId, actor, MEMBER_ROLE.REPRESENTATIVE, payloadIds],
  );

  const keep: string[] = [];
  /** 삐용에 `U` 를 보내야 하는 행들 — 이름·연락처·이메일 중 하나가 **실제로** 바뀐 행. */
  const changed = new Map<string, Set<MemberSyncField>>();
  let inserted = 0;
  let updated = 0;

  for (const [index, m] of members.entries()) {
    // ★ 화면이 보낸 배열 순서를 그대로 저장한다. created_at 은 트랜잭션 시각이라
    //   한 번에 저장한 행이 전부 같은 값이 된다 — 정렬에 쓸 수 없다(012 주석).
    const seq = index + 1;
    if (m.memberId) {
      // ★ company_id 를 조건에 함께 건다. id 만으로 UPDATE 하면 남의 회사 구성원을
      //   고칠 수 있다 — RLS 가 막아 주지만 조건을 빼 두면 정책이 느슨해지는 날 뚫린다.
      const res = await q(
        client,
        `UPDATE public.tb_s080_members
            SET name = $3, phone = $4, email = $5, is_representative = $6, memo = $7,
                sort_order = $8, status = 'active', updated_at = now(), updated_by = $9
          WHERE member_id = $1 AND company_id = $2`,
        [m.memberId, companyId, m.name, m.phone, m.email, m.isRepresentative, m.memo, seq, actor],
      );
      if ((res.rowCount ?? 0) > 0) {
        keep.push(m.memberId);
        updated += 1;
        /*
         * ★ 삐용에 보내는 칸(이름 · 연락처 · 이메일)만 본다. 비고·순서가 바뀐 저장으로
         *   삐용을 부르지 않는다 — 보내지도 않는 값 때문에 호출이 나가는 모양이 된다.
         * ★★ 앞 값을 못 찾은 경우(남의 회사 id 가 올라와 UPDATE 가 0행인 경우는 위에서
         *    걸러지므로, 여기 오면 행은 있고 before 만 없다)도 바뀐 것으로 센다.
         *    모를 때는 보내는 쪽으로 틀린다 — 안 보내면 어긋남이 남는다.
         */
        const was = before.get(m.memberId);
        const fields = new Set<MemberSyncField>();
        if (!was || was.name !== m.name) fields.add('name');
        if (!was || was.phone !== m.phone) fields.add('phone');
        if (!was || was.email !== m.email) fields.add('email');
        if (fields.size > 0) changed.set(m.memberId, fields);
        continue;
      }
      // 없는 id 가 올라왔다 — 새로 만든다. 조용히 버리면 입력이 사라진다.
    }

    const id = newId();
    await q(
      client,
      `INSERT INTO public.tb_s080_members
         (member_id, build_id, company_id, name, phone, email, is_representative, memo,
          sort_order, status, created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active', now(), now(), $10, $10)`,
      [id, buildId, companyId, m.name, m.phone, m.email, m.isRepresentative, m.memo, seq, actor],
    );
    keep.push(id);
    inserted += 1;
    // ★ 새 행은 당연히 바뀐 것이다. 삐용 번호도 없으므로 `I` 로 나간다.
    changed.set(id, new Set<MemberSyncField>(['name', 'phone', 'email']));
  }

  const res = await q(
    client,
    `UPDATE public.tb_s080_members
        SET status = 'inactive', updated_at = now(), updated_by = $3
      WHERE company_id = $1 AND status = 'active' AND NOT (member_id = ANY($2::text[]))`,
    [companyId, keep, actor],
  );

  /*
   * ★ 비활성으로 내린 수는 **둘을 합친다.** 전처리 ②가 이미 내린 대표 행은 아래
   *   마지막 UPDATE 에 걸리지 않는다 — 합치지 않으면 응답의 수가 실제보다 적다.
   */
  return { inserted, updated, deactivated: (res.rowCount ?? 0) + (steppedDown.rowCount ?? 0), changed };
}

/* ══════════════════════════════════════════════════════════════════════════
   삐용 조직 연결 (3-2) — `link_*` 7칸
   ══════════════════════════════════════════════════════════════════════════
   001 이 `link_s020_org_id` · `link_linked_at` · `link_linked_by` 를 만들었고,
   031 이 `link_org_code` · `link_status` · `link_failed_reason` · `link_failed_at` 을
   더했다. 앞의 셋은 「연결됐다」만, 뒤의 넷은 「왜 아직 아닌가」를 말한다.

   ★★ 판정의 진실원은 `link_s020_org_id` 다. `link_status` 는 사람에게 설명하기 위한
      값이다 — 둘이 어긋나면 `link_s020_org_id` 를 믿는다(031 주석).
   ══════════════════════════════════════════════════════════════════════════ */

export interface OrgLinkRow {
  company_id: string;
  company_name: string | null;
  ceo_name: string | null;
  tel: string | null;
  email: string | null;
  link_s020_org_id: number | null;
  /** 퇴실·재입주·수정이 이 코드로 회사를 지목한다. */
  link_org_code: string | null;
  /** NULL·pending·linked. ★ [다시 시도]가 **고칠 것이 있는지**를 이 값으로 본다. */
  link_status: string | null;
  /**
   * 살아 있는 계약 **개수** — 퇴실·재입주를 이것으로 가른다.
   *
   * ★ 어휘는 `isPreviousLive` 와 같다: 계약중(`confirmed`) · 계약대기(`draft`).
   *   종료·취소는 살아 있지 않다. 둘이 어긋나면 재입주한 회사가 꺼진 채로 남는다.
   * ★★ 개수까지 보는 이유는 **재입주와 재계약을 가려야** 하기 때문이다. 확정 직후 개수가
   *    1 이면 그 전에는 0 이었다는 뜻이고(= 삐용이 꺼져 있었다) 재입주다. 2 이상이면
   *    이미 입주 중인 회사가 계약을 하나 더 한 것이라 삐용에 보낼 것이 없다.
   */
  live_contract_count: number;
}

/** 삐용에 보낼 칸만 읽는다. ★ 주소는 읽지 않는다 — 보내지 않는 값이다. */
export async function readOrgLinkTarget(
  client: ScopedClient,
  companyId: string,
): Promise<OrgLinkRow | null> {
  const { rows } = await q<OrgLinkRow>(
    client,
    /*
     * ★ 살아 있는 계약을 센다 — 개수로 **재입주와 재계약을 가른다**(위 컬럼 주석).
     *   계약 표에 (status, end_date) 인덱스가 있고 company_id 로 좁히므로 비싸지 않다.
     * ★★ 상태 어휘를 여기 박는다: 계약중·계약대기가 살아 있는 것이다(`isPreviousLive`).
     *    이 둘이 어긋나면 **재입주한 회사가 꺼진 채로 남거나, 입주 중인 회사가 꺼진다.**
     */
    `SELECT c.company_id, c.company_name, c.ceo_name, c.tel, c.email,
            c.link_s020_org_id, c.link_org_code, c.link_status,
            (
              SELECT count(*)::int FROM public.tb_s080_contracts t
               WHERE t.company_id = c.company_id
                 AND t.status IN ('confirmed', 'draft')
            ) AS live_contract_count
       FROM public.tb_s080_companies c
      WHERE c.company_id = $1`,
    [companyId],
  );
  return rows[0] ?? null;
}

/**
 * 이미 발급된 단체코드 전부. 채번이 이 목록의 빈 자리를 고른다.
 *
 * ★ `operator` 스코프에서 부른다 — 전 입주사의 코드를 봐야 중복을 피할 수 있다.
 *   입주사 스코프로 부르면 자기 것만 보이고 **모두가 Z01 을 발급받는다.**
 */
export async function listTakenOrgCodes(client: ScopedClient): Promise<string[]> {
  const { rows } = await q<{ link_org_code: string }>(
    client,
    `SELECT link_org_code FROM public.tb_s080_companies WHERE link_org_code IS NOT NULL`,
  );
  return rows.map((r) => r.link_org_code);
}

/**
 * 연결 성공을 남긴다. ★ 실패 사유를 **지운다** — 지난 실패가 화면에 계속 뜨면 안 된다.
 *
 * ★★ `link_s020_org_id` 와 `link_org_code` 는 둘 다 UNIQUE 다. 위반은 던진다 —
 *    같은 삐용 조직이 두 입주사에 붙는 것이 격리가 무너지는 모양이고, 조용히
 *    덮어쓰는 것보다 실패하는 쪽이 낫다(호출자가 「대기」로 돌린다).
 */
export async function saveOrgLinked(
  client: ScopedClient,
  args: { companyId: string; orgId: number; orgCode: string; actor: string },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_companies
        SET link_s020_org_id   = $2,
            link_org_code      = $3,
            link_status        = 'linked',
            link_linked_at     = now(),
            link_linked_by     = $4,
            link_failed_reason = NULL,
            link_failed_at     = NULL,
            -- ★ 성공하면 재시도 상태를 **0 으로 되돌린다**(036). 지우지 않으면 다음에
            --   한 번 실패했을 때 옷 횟수가 엹혔 곧바로 상한에 닿는다.
            link_attempt_count = 0,
            link_retryable     = NULL,
            updated_at         = now(),
            updated_by         = $4
      WHERE company_id = $1`,
    [args.companyId, args.orgId, args.orgCode, args.actor],
  );
}

/**
 * 「계약은 확정됐고 삐용 연결만 아직」을 남긴다.
 *
 * ★ `reason` 은 운영자에게 **그대로 보여주는 문구**다. 삐용 내부 메시지를 넣지 않는다.
 * ★ `link_org_code` 는 건드리지 않는다 — 발급 성공 전이라 값이 없고, 있다면 그건
 *   이전에 성공한 코드이므로 지우면 안 된다.
 */
export async function saveOrgLinkPending(
  client: ScopedClient,
  /**
   * @param retryable 다시 보내면 푸릴 종류인가(어댑터의 `outcome.retryable`).
   *   ★ `undefined` 는 「모른다」로 NULL 이 들어가고 재시도를 **못 리지 않는다**
   *     (`retryPolicy.judgeLinkRetry`). 막는 것은 `false` 뿐이다.
   */
  args: { companyId: string; reason: string; actor: string; retryable?: boolean },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_companies
        SET link_status        = 'pending',
            link_failed_reason = $2,
            link_failed_at     = now(),
            -- ★★ **세는 것이 여기 하나다**(036). 실패를 적는 자리가 곲 횟수를 올리는
            --    자리다 — 둘로 갈라 두면 어느 날 하나만 부른다.
            link_attempt_count = link_attempt_count + 1,
            link_retryable     = $4,
            updated_at         = now(),
            updated_by         = $3
      WHERE company_id = $1`,
    [args.companyId, args.reason, args.actor, args.retryable ?? null],
  );
}

/** 화면이 읽는 연동 상태. 조회 전용이다. */
export interface OrgLinkStatusRow {
  link_s020_org_id: number | null;
  link_org_code: string | null;
  link_status: string | null;
  link_failed_reason: string | null;
  link_failed_at: Date | null;
}

export async function readOrgLinkStatus(
  client: ScopedClient,
  companyId: string,
): Promise<OrgLinkStatusRow | null> {
  const { rows } = await q<OrgLinkStatusRow>(
    client,
    `SELECT link_s020_org_id, link_org_code, link_status, link_failed_reason, link_failed_at
       FROM public.tb_s080_companies
      WHERE company_id = $1`,
    [companyId],
  );
  return rows[0] ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   삐용 직원정보 연동 (035) — 구성원 행의 `link_*` 3칸
   ══════════════════════════════════════════════════════════════════════════
   ★ 판정은 `bbiyong/memberSync.ts` 가 한다. 여기는 그 함수가 쓰는 SQL 뿐이다.
   ★★ 「무엇을 보낼까」의 근거는 `link_s020_member_id` 다 — 번호가 있으면 `U`, 없으면
      `I` 다. 「ERP 에서 새 행인가」로 가르지 않는 이유는 그쪽 머리말에 있다.
   ══════════════════════════════════════════════════════════════════════════ */

export interface MemberLinkDbRow {
  member_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_representative: string;
  link_s020_member_id: number | null;
}

/**
 * 삐용에 보낼 거리 — 단체코드 · 활성 구성원 · **지울 것**.
 *
 * ★ `orphans` 는 명부에서 빠졌는데(`status <> 'active'`) 삐용 번호를 아직 들고 있는
 *   행이다. `replaceMembers` 가 지우지 않고 `inactive` 로 두므로(예약 이력) 이 모양으로
 *   남고, 그것이 곧 「삐용에서 지울 것」이다.
 * ★★ 삭제 대상을 **저장 때의 변경 내역이 아니라 지금 DB 상태**에서 읽는다. 그래서 이
 *    함수를 몇 번 불러도 같은 삭제가 두 번 나가지 않는다 — 성공하면 번호가 비워지고
 *    다음 조회에는 안 보인다.
 */
export async function readMemberSyncTargets(
  client: ScopedClient,
  companyId: string,
): Promise<{ orgCode: string | null; active: MemberLinkDbRow[]; orphans: MemberLinkDbRow[] } | null> {
  const { rows: company } = await q<{ link_org_code: string | null }>(
    client,
    `SELECT link_org_code FROM public.tb_s080_companies WHERE company_id = $1`,
    [companyId],
  );
  if (company.length === 0) return null;

  const { rows } = await q<MemberLinkDbRow & { status: string }>(
    client,
    `SELECT member_id, name, email, phone, is_representative, link_s020_member_id, status
       FROM public.tb_s080_members
      WHERE company_id = $1
        AND (status = 'active' OR link_s020_member_id IS NOT NULL)
      ORDER BY sort_order, created_at, member_id`,
    [companyId],
  );

  return {
    orgCode: company[0]?.link_org_code ?? null,
    active: rows.filter((r) => r.status === 'active'),
    orphans: rows.filter((r) => r.status !== 'active' && r.link_s020_member_id !== null),
  };
}

/**
 * 삐용 회원번호를 적고 **대기 사유를 지운다**.
 *
 * ★ `U` 성공에도 쓴다 — 같은 번호를 다시 적으면서 사유가 지워진다. 전용
 *   `clearPending` 을 만들지 않는다(`saveOrgLinked` 와 같은 구조다).
 * ★★ `link_s020_member_id` 는 UNIQUE 다. 위반은 **던진다** — 한 삐용 회원이 ERP 두 행에
 *    붙으면 그 회원의 수정·삭제가 어느 행 기준인지 갈린다. 부르는 쪽이 「대기」로 돌린다.
 */
export async function saveMemberLinked(
  client: ScopedClient,
  args: { companyId: string; memberId: string; linkMemberId: number; actor: string },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_members
        SET link_s020_member_id = $3,
            link_failed_reason  = NULL,
            link_failed_at      = NULL,
            -- ★ 성공하면 재시도 상태를 되돌린다(036 · 회사 졽과 같은 이유).
            link_attempt_count  = 0,
            link_retryable      = NULL,
            updated_at          = now(),
            updated_by          = $4
      WHERE member_id = $2 AND company_id = $1`,
    [args.companyId, args.memberId, args.linkMemberId, args.actor],
  );
}

/**
 * 삐용에서 지웠다 — 번호와 사유를 **둘 다 비운다**.
 *
 * ★ 번호를 남겨 두면, 그 행이 다시 살아날 때 **지워진 번호로 `U`** 가 나가고 삐용이
 *   「없는 회원」으로 거절한다. 비워 두면 새 사람으로 `I` 가 나간다.
 */
export async function saveMemberUnlinked(
  client: ScopedClient,
  args: { companyId: string; memberId: string; actor: string },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_members
        SET link_s020_member_id = NULL,
            link_failed_reason  = NULL,
            link_failed_at      = NULL,
            link_attempt_count  = 0,
            link_retryable      = NULL,
            updated_at          = now(),
            updated_by          = $3
      WHERE member_id = $2 AND company_id = $1`,
    [args.companyId, args.memberId, args.actor],
  );
}

/** 「저장은 됐고 삐용 반영만 아직」을 그 구성원 행에 남긴다. ★ 번호는 건드리지 않는다. */
export async function saveMemberPending(
  client: ScopedClient,
  /** @param retryable `saveOrgLinkPending` 과 같은 뜼 — `false` 만 재시도를 만다. */
  args: { companyId: string; memberId: string; reason: string; actor: string; retryable?: boolean },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_members
        SET link_failed_reason = $3,
            link_failed_at     = now(),
            link_attempt_count = link_attempt_count + 1,
            link_retryable     = $5,
            updated_at         = now(),
            updated_by         = $4
      WHERE member_id = $2 AND company_id = $1`,
    [args.companyId, args.memberId, args.reason, args.actor, args.retryable ?? null],
  );
}

/**
 * 회사 등록 응답이 준 **대표 회원번호**를 활성 대표 행에 적는다.
 *
 * ★★ 대표는 삐용에서 지울 수도 새로 만들 수도 없다. 이 번호가 없으면 그 회사의 대표는
 *    **영원히 ERP 에서 고칠 수 없다** — 그래서 회사 등록이 성공하는 순간 같이 적는다.
 * ★ `link_s020_member_id IS NULL` 인 행만 쓴다. 이미 번호가 있으면 그것이 맞는 값이고,
 *   덮어쓰면 남의 회원을 가리키게 될 수 있다.
 * ★ 활성 대표 행이 없으면 **0행 갱신으로 조용히 지나간다**(돌려주는 값이 0이다). 대표
 *   구성원 행이 없는 입주사(API 를 직접 불러 만든 경우)가 있을 수 있고, 그건 회사
 *   등록을 실패로 돌릴 일이 아니다.
 */
export async function saveRepMemberLink(
  client: ScopedClient,
  args: { companyId: string; linkMemberId: number; actor: string },
): Promise<number> {
  const res = await q(
    client,
    `UPDATE public.tb_s080_members
        SET link_s020_member_id = $2,
            link_failed_reason  = NULL,
            link_failed_at      = NULL,
            updated_at          = now(),
            updated_by          = $3
      WHERE company_id = $1
        AND status = 'active'
        AND is_representative = $4
        AND link_s020_member_id IS NULL`,
    [args.companyId, args.linkMemberId, args.actor, MEMBER_ROLE.REPRESENTATIVE],
  );
  return res.rowCount ?? 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   저절로 다시 보낼 거리 (036) — 회사와 구성원을 한 번에 읽는다
   ══════════════════════════════════════════════════════════════════════════
   ★★ 「무엇을 다시 보낼까」의 판정은 여기 없다. 이 함수는 **상태를 그대로 읽어 오고**
      거르는 것은 `bbiyong/retryPolicy.judgeLinkRetry` 가 한다 — 간격·횟수·종류가
      SQL 과 TS 두 곳에 적히면 어느 날 하나만 고쳐진다.

   ★ 같은 질의를 머리말 배지(건수)와 재시도 스윕이 **함께 쓴다.** 둘이 다른 질의를
     보면 「배지에는 2건인데 스윕은 1건만 보낸다」가 된다.
   ══════════════════════════════════════════════════════════════════════════ */

export interface PendingLinkRow {
  kind: 'org' | 'member';
  company_id: string;
  company_name: string;
  /** 구성원 행일 때만. 회사 행은 `null`. */
  member_id: string | null;
  member_name: string | null;
  link_attempt_count: number;
  link_retryable: boolean | null;
  link_failed_at: Date | null;
  link_failed_reason: string | null;
  /** 머리말의 [보기] 가 열 계약. 가장 최근 계약이고, 없으면 `null`. */
  contract_id: string | null;
}

/**
 * 삐용 반영이 아직 안 된 것 전부 — 회사 연동과 직원 연동 둘 다.
 *
 * ★ 회사: `link_s020_org_id` 가 비었고 `link_status='pending'` — 즉 **연결 자체가 아직**.
 *   연결된 뒤의 퇴실·재입주·수정 실패도 `pending` 이 되지만 그쪽은 `link_s020_org_id` 가
 *   있어 여기 안 들어온다. ★ 그것까지 저절로 다시 보내려면 「무엇을 보낼지」를 알아야
 *   하는데 ERP 는 그걸 적지 않는다(결정 2026-10-03 — 사본을 두지 않는다). 그래서
 *   **등록만** 저절로 다시 보낸다. 퇴실·재입주는 계약 폼의 [다시 시도] 가 그대로 담당한다.
 *
 * ★ 구성원: 사유가 적힌 **활성** 행. 비활성 행은 명부에서 빠진 사람이라 보낼 것이 없다.
 */
export async function listPendingLinks(client: ScopedClient): Promise<PendingLinkRow[]> {
  const { rows } = await q<PendingLinkRow>(
    client,
    `WITH last_contract AS (
       SELECT company_id, max(contract_id) FILTER (WHERE rn = 1) AS contract_id
         FROM (
           SELECT company_id, contract_id,
                  row_number() OVER (PARTITION BY company_id ORDER BY created_at DESC) AS rn
             FROM public.tb_s080_contracts
         ) t
        GROUP BY company_id
     )
     SELECT 'org'::text AS kind, c.company_id, c.company_name,
            NULL::text AS member_id, NULL::text AS member_name,
            c.link_attempt_count, c.link_retryable, c.link_failed_at, c.link_failed_reason,
            lc.contract_id
       FROM public.tb_s080_companies c
       LEFT JOIN last_contract lc ON lc.company_id = c.company_id
      WHERE c.link_s020_org_id IS NULL AND c.link_status = 'pending'
     UNION ALL
     SELECT 'member'::text AS kind, c.company_id, c.company_name,
            m.member_id, m.name AS member_name,
            m.link_attempt_count, m.link_retryable, m.link_failed_at, m.link_failed_reason,
            lc.contract_id
       FROM public.tb_s080_members m
       JOIN public.tb_s080_companies c ON c.company_id = m.company_id
       LEFT JOIN last_contract lc ON lc.company_id = c.company_id
      WHERE m.status = 'active' AND m.link_failed_reason IS NOT NULL
        /*
         * ★★★ **회사가 연결된 뒤에만 구성원 대기가 의미가 있다.**
         * 단체코드가 없으면 syncMembers 는 **보내지 않고 그냥 지나간다**(보낼 곳이
         * 없다). 그러면 횟수도 오르지 않아 **이 행이 영원히 다시 골라진다** — 60초마다
         * 로그 한 줄이 영구히 쌓이는 모양이다(2026-10-05 질의를 돌려 보고 찾았다).
         * ★ 빠뜨려도 잃는 것이 없다: 회사가 연결되는 순간 registerOrgForCompany 가
         *   그 자리에서 밀린 구성원을 전부 보낸다.
         * ★ 백틱을 쓰지 않는다 — 이 주석은 템플릿 리터럴 **안**이라 백틱이 SQL 을 끊는다.
         */
        AND c.link_org_code IS NOT NULL
      ORDER BY link_failed_at NULLS FIRST`,
  );
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
   삐용 → ERP 「받기」(2026-10-23) — 회사 · 직원
   ══════════════════════════════════════════════════════════════════════════
   ★ 받은 칸만 바꾼다. 줄이 없으면 만들지 않는다. 판정(누가 불렀는가 · 칸 모양)은
     `companies/companyReceive.ts` · `companies/memberReceive.ts` 가 한다.
   ★★ 여기서 삐용에 다시 보내지 않는다 — 부르는 쪽도 보내지 않는다(되돌아가기 방지).
   ══════════════════════════════════════════════════════════════════════════ */

/** 삐용 단체 ID 로 입주사 — 연결된 회사만 있다(`link_s020_org_id` UNIQUE). 없으면 null. */
export async function findCompanyIdByOrgId(client: ScopedClient, orgId: number): Promise<string | null> {
  const { rows } = await q<{ company_id: string }>(
    client,
    `SELECT company_id FROM public.tb_s080_companies WHERE link_s020_org_id = $1`,
    [orgId],
  );
  return rows[0]?.company_id ?? null;
}

/** 삐용에서 받는 회사 칸 — 회사명 · 사업자번호 · 법인번호 · 업태 · 종목(주소는 받지 않는다). */
export interface CompanyFromBbiyong {
  companyName?: string;
  bizNumber?: string;
  corpNumber?: string;
  businessType?: string;
  businessItem?: string;
}

const COMPANY_FROM_BBIYONG_COLUMNS: Readonly<Record<keyof CompanyFromBbiyong, string>> = {
  companyName: 'company_name',
  bizNumber: 'biz_number',
  corpNumber: 'corp_number',
  businessType: 'business_type',
  businessItem: 'business_item',
};

/**
 * 받은 칸만 바꾼다. 칸이 하나도 없으면 부르지 않는다.
 * ★ `biz_number` 는 UNIQUE 다 — 남의 번호면 23505 를 던진다(부르는 쪽이 409 로 바꾼다).
 * @returns 바뀐 줄 수(0 또는 1)
 */
export async function patchCompanyFromBbiyong(
  client: ScopedClient,
  args: { companyId: string; fields: CompanyFromBbiyong; actor: string },
): Promise<number> {
  const keys = (Object.keys(COMPANY_FROM_BBIYONG_COLUMNS) as (keyof CompanyFromBbiyong)[]).filter(
    (k) => args.fields[k] !== undefined,
  );
  if (keys.length === 0) throw new Error('patchCompanyFromBbiyong — 바꿀 칸이 없다');
  const sets = keys.map((k, i) => `${COMPANY_FROM_BBIYONG_COLUMNS[k]} = $${i + 3}`);
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_companies
        SET ${sets.join(', ')}, updated_at = now(), updated_by = $2
      WHERE company_id = $1`,
    [args.companyId, args.actor, ...keys.map((k) => args.fields[k])],
  );
  return rowCount ?? 0;
}

/** 삐용 회원번호로 구성원 한 줄 — `link_s020_member_id` 는 UNIQUE 다(035). 없으면 null. */
export interface MemberByLink {
  member_id: string;
  company_id: string;
  is_representative: string | null;
  status: string;
}

export async function findMemberByLinkId(client: ScopedClient, linkMemberId: number): Promise<MemberByLink | null> {
  const { rows } = await q<MemberByLink>(
    client,
    `SELECT member_id, company_id, is_representative, status
       FROM public.tb_s080_members
      WHERE link_s020_member_id = $1`,
    [linkMemberId],
  );
  return rows[0] ?? null;
}

/** 삐용 회원번호의 직원이 속한 입주사의 삐용 단체 ID — 받기의 「대상 회사」(2026-10-25). 회사에 단체 ID 가 없으면 null,
 * 그 회원번호의 직원이 없으면 `'not_found'`(직원 받기가 본문 `orgId` 를 보는 경우 — 삐용 통합 시험 C1). */
export async function findOrgIdByMemberLinkId(
  client: ScopedClient,
  linkMemberId: number,
): Promise<number | null | 'not_found'> {
  const { rows } = await q<{ link_s020_org_id: number | null }>(
    client,
    `SELECT c.link_s020_org_id
       FROM public.tb_s080_members m
       JOIN public.tb_s080_companies c ON c.company_id = m.company_id
      WHERE m.link_s020_member_id = $1`,
    [linkMemberId],
  );
  if (rows.length === 0) return 'not_found';
  return rows[0]!.link_s020_org_id ?? null;
}

/** 같은 회사의 **다른 활성** 구성원이 이 이메일을 쓰는가 — 대소문자 · 앞뒤 공백은 같게 본다. */
export async function isMemberEmailTaken(
  client: ScopedClient,
  args: { companyId: string; memberId: string; email: string },
): Promise<boolean> {
  const { rows } = await q<{ one: number }>(
    client,
    `SELECT 1 AS one FROM public.tb_s080_members
      WHERE company_id = $1 AND member_id <> $2 AND status = 'active'
        AND lower(btrim(COALESCE(email, ''))) = lower(btrim($3))
      LIMIT 1`,
    [args.companyId, args.memberId, args.email],
  );
  return rows.length > 0;
}

/** 삐용에서 받는 직원 칸 — 이름 · 이메일 · 연락처(하이픈 모양). */
export interface MemberFromBbiyong {
  name?: string;
  email?: string;
  phone?: string;
}

const MEMBER_FROM_BBIYONG_COLUMNS: Readonly<Record<keyof MemberFromBbiyong, string>> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
};

/**
 * 받은 칸만 바꾼다. 칸이 하나도 없으면 부르지 않는다.
 * ★ 연동 칸(`link_*`)은 건드리지 않는다 — 대기 사유는 ERP 가 보낸 일의 결과다.
 */
export async function patchMemberFromBbiyong(
  client: ScopedClient,
  args: { memberId: string; fields: MemberFromBbiyong; actor: string },
): Promise<number> {
  const keys = (Object.keys(MEMBER_FROM_BBIYONG_COLUMNS) as (keyof MemberFromBbiyong)[]).filter(
    (k) => args.fields[k] !== undefined,
  );
  if (keys.length === 0) throw new Error('patchMemberFromBbiyong — 바꿀 칸이 없다');
  const sets = keys.map((k, i) => `${MEMBER_FROM_BBIYONG_COLUMNS[k]} = $${i + 3}`);
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_members
        SET ${sets.join(', ')}, updated_at = now(), updated_by = $2
      WHERE member_id = $1`,
    [args.memberId, args.actor, ...keys.map((k) => args.fields[k])],
  );
  return rowCount ?? 0;
}

/** 회사 표의 대표자명(사본) — 활성 대표 직원의 이름을 삐용에서 받았을 때 맞춘다. */
export async function updateCompanyCeoName(
  client: ScopedClient,
  args: { companyId: string; ceoName: string; actor: string },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_companies SET ceo_name = $2, updated_at = now(), updated_by = $3 WHERE company_id = $1`,
    [args.companyId, args.ceoName, args.actor],
  );
}
