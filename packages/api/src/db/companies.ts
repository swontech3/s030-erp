/**
 * 입주사·구성원 저장소 — SQL 이 모여 있는 유일한 자리(3-4).
 *
 * ★ 전부 `withCompanyScope()` 가 연 트랜잭션 안에서 도는 것을 전제한다. `companies` 와
 *   `members` 둘 다 RLS 가 걸려 있어(003), 스코프 없는 커넥션은 **조용히 0행**을 본다.
 *
 * ★★ `updated_at` 을 매번 명시한다. 이 레거시 테이블들도 **NOT NULL 인데 DEFAULT 가 없다** —
 *    빼고 INSERT 하면 `23502` 로 죽는다(계약 테이블과 같은 사정, `db/contracts.ts` 머리말).
 */
import type { ScopedClient } from './withCompanyScope.ts';

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
}

const COMPANY_COLUMNS = `
  company_id, build_id, company_name, biz_number, corp_number, ceo_name,
  business_type, business_item, member_type, tel, email,
  ceo_zip_code, ceo_address, ceo_address_detail, memo, status`;

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
 * ★★ 삐용에는 아직 만들지 않는다
 * =============================================================================
 * 여기서 만드는 것은 **ERP 테이블 한 행**뿐이다. 삐용 조직 등록과 단체코드 발급은
 * 3-2 에서 이 저장 경로에 얹는다(ROADMAP 페이즈 4 작업 15). 그래서
 * `link_s020_org_id` 는 비워 둔다 — 연결되지 않은 입주사라는 뜻이고, 스코프 해석은
 * 그 상태를 이미 알고 있다(`ORG_ARCHITECTURE.md` §1-2 「연결이 없으면 빈 스코프」).
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
}

/**
 * ★ `status='active'` 만 읽는다. 저장에서 빠진 사람은 지우지 않고 `inactive` 로 둔다 —
 *   아래 `replaceMembers` 참조.
 */
export async function listMembers(client: ScopedClient, companyId: string): Promise<MemberRow[]> {
  const { rows } = await q<MemberRow>(
    client,
    `SELECT member_id, name, phone, email, is_representative, memo
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
): Promise<{ inserted: number; updated: number; deactivated: number }> {
  const { companyId, buildId, members, actor, newId } = args;

  const keep: string[] = [];
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
  }

  const res = await q(
    client,
    `UPDATE public.tb_s080_members
        SET status = 'inactive', updated_at = now(), updated_by = $3
      WHERE company_id = $1 AND status = 'active' AND NOT (member_id = ANY($2::text[]))`,
    [companyId, keep, actor],
  );

  return { inserted, updated, deactivated: res.rowCount ?? 0 };
}
