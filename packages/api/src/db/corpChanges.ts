/**
 * 법인변경(s040200010 · s040200011) 저장소 — 목록(2단계) · 새 건 · 상세 · 변경 내용 · 임원 ·
 * 비입주사 법무 회사 정보(3단계, 2026-10-10).
 *
 * ★★★ 누가 무엇을 보는지는 **RLS 가 가른다**(037 `erp_org_scope`). 이 파일은 단체 조건을
 *    적지 않는다 — 운영사 세션은 전부, 회사 세션은 자기 단체 건만 돌아온다. 그래서 반드시
 *    `scopeOfSession` 으로 만든 스코프 안에서 불러야 한다. 단체 ID 를 빠뜨린 스코프(옛
 *    `scopeOf`)로 부르면 회사 세션은 **0건**이다(닫힌 쪽). 쓰기도 같다 — RLS 의 `WITH CHECK`
 *    가 남의 단체로 넣는 줄을 막는다.
 *
 * ★★ 입주사 정보는 **읽기만** 한다 — 회사명 · 대표자를 건에 복사하지 않는다.
 *    ⚠ `tb_s080_companies` 의 읽기 정책은 `USING (true)` 다 — DB 가 회사 세션의 입주사
 *    읽기를 막아 주지 않는다. 그래서 입주사 표는 **RLS 를 통과한 건의 단체로만** 읽는다
 *    (목록은 조인, 상세는 먼저 읽은 건의 org_id). 건이 없는 자리(임시 모드 · 첫 저장 · 법무 회사
 *    정보 저장)는 `parseOrgTarget` 을 거친 단체만 쓴다 — 회사 세션이면 **세션 자기 단체**뿐이라
 *    남의 단체가 들어갈 자리가 없다.
 *
 * ★ 입주 여부는 저장하지 않는다 — `link_s020_org_id` 에 있으면 입주사(퇴실해도). 그 칸은
 *   UNIQUE(001)라 한 단체에 입주사 줄은 많아야 하나다.
 *
 * ★★ 임원 수정 · 삭제는 **`corp_change_id` 를 함께 건다** — 같은 회사 안에서도 다른 건의
 *    임원 ID 로 이 건의 주소를 두드리면 0건이다(레거시 IDOR, 037 머리말).
 */
import type { CorpChangeListFilter, CorpChangeListItem } from '@swonbiz/shared/domain/corp-change-list';
import type { CorpChangeOfficerView, LegalOrgInput, OfficerInput } from '@swonbiz/shared/domain/corp-change-detail';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount?: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/**
 * `operator_id` 는 1 로 고정한다 — 개발계·가동계 모두 운영사가 하나다(`db/facility.ts` ·
 * `db/formTemplates.ts` 와 같다). 운영사가 늘면 세션에서 받아야 한다.
 */
const OPERATOR_ID = 1;

interface ListRow {
  id: string;
  org_id: number;
  org_code: string | null;
  company_name: string | null;
  is_tenant: boolean;
  change_type: string;
  status: string;
  ceo_name: string | null;
  created_on: string;
}

/**
 * 목록 — 새 건이 위.
 *
 * ★ 작업일자는 `created_at`(시간대 없는 시각, DB 시간대 Asia/Seoul)으로 거른다.
 *   끝 날짜는 「그다음 날 0시 미만」이다 — `<= 'to 23:59:59'` 는 밀리초를 놓친다.
 * ★ 회사명 · 대표자: 입주사면 ERP 입주사 정보, 아니면 법무 회사 정보(회사명 자리에는 등기상
 *   상호 — 038). 입주사인데 ERP 에 값이 비어 있어도 법무 회사 정보로 메우지 않는다 — 입주사
 *   정보의 정본은 ERP 다.
 */
export async function listCorpChanges(client: ScopedClient, f: CorpChangeListFilter): Promise<CorpChangeListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (f.from) add('c.created_at >= ?::date', f.from);
  if (f.to) add(`c.created_at < (?::date + 1)`, f.to);
  if (f.changeType) add('c.change_type = ?', f.changeType);
  if (f.status) add('c.status = ?', f.status);
  if (f.tenancy) add('(co.company_id IS NOT NULL) = ?', f.tenancy === 'tenant');
  if (!f.includeCancelled) where.push(`c.status <> 'X'`);

  const { rows } = await q<ListRow>(
    client,
    `SELECT c.id, c.org_id, c.org_code, c.change_type, c.status,
            to_char(c.created_at, 'YYYY-MM-DD') AS created_on,
            CASE WHEN co.company_id IS NOT NULL THEN co.company_name ELSE lo.legal_name END AS company_name,
            (co.company_id IS NOT NULL) AS is_tenant,
            CASE WHEN co.company_id IS NOT NULL THEN co.ceo_name ELSE lo.ceo_name END AS ceo_name
       FROM public.tb_s080_corp_changes c
       LEFT JOIN public.tb_s080_companies co ON co.link_s020_org_id = c.org_id
       LEFT JOIN public.tb_s080_legal_orgs lo ON lo.org_id = c.org_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.created_at DESC, c.id`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    orgCode: r.org_code,
    companyName: r.company_name,
    isTenant: r.is_tenant,
    changeType: r.change_type,
    status: r.status,
    ceoName: r.ceo_name,
    createdOn: r.created_on,
  }));
}

// =============================================================================
// 새 건
// =============================================================================

/**
 * 회사 세션 **자기 단체**의 단체코드 — 입주사면 ERP 의 `link_org_code`, 아니면 null.
 *
 * ★ 새 건을 만들 때 **한 번** 읽어 넣는다. 그 뒤 ERP 값이 바뀌어도 건의 `org_code` 는
 *   고치지 않는다 — 표시용이다(결정 2026-10-10).
 * ★ 다음 단계: 삐용 로그인 응답의 `orgCode` 가 세션에 들어오면(회신 2026-10-09) 비입주사도
 *   세션에서 채운다.
 */
export async function tenantOrgCode(client: ScopedClient, orgId: number): Promise<string | null> {
  const { rows } = await q<{ link_org_code: string | null }>(
    client,
    `SELECT link_org_code FROM public.tb_s080_companies WHERE link_s020_org_id = $1`,
    [orgId],
  );
  return rows[0]?.link_org_code ?? null;
}

/**
 * 새 건 — 첫 [저장] 때만 부른다(결정 2026-10-10). 변경 내용을 **같이** 넣는다 — 빈 건을 먼저
 * 만들고 채우는 길은 없다. 임원은 같은 트랜잭션에서 이어 넣는다(`legal/corpChangeOps.ts`).
 */
export async function insertCorpChange(
  client: ScopedClient,
  args: {
    id: string;
    changeType: string;
    status: string;
    orgId: number;
    orgCode: string | null;
    payload: Record<string, unknown>;
    actor: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_corp_changes
       (id, change_type, status, payload, operator_id, org_id, org_code,
        created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now(), now(), $8, $8)`,
    [args.id, args.changeType, args.status, JSON.stringify(args.payload), OPERATOR_ID, args.orgId, args.orgCode, args.actor],
  );
}

// =============================================================================
// 상세
// =============================================================================

export interface CorpChangeRow {
  id: string;
  orgId: number;
  orgCode: string | null;
  changeType: string;
  status: string;
  payload: Record<string, unknown>;
  createdOn: string;
}

/**
 * 건 하나 — 안 보이면(없거나 남의 단체) null. 둘을 가르지 않는다(둘 다 404).
 * ★ `forUpdate` — 고치기 전에 상태를 보고 같은 트랜잭션에서 쓴다. 그 사이 다른 요청이
 *   상태를 바꾸면(4단계의 전이) 이 줄을 잠가 두어야 「P 인 줄 알고 고쳤는데 이미 E」가 없다.
 */
export async function getCorpChange(
  client: ScopedClient,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<CorpChangeRow | null> {
  const { rows } = await q<{
    id: string;
    org_id: number;
    org_code: string | null;
    change_type: string;
    status: string;
    payload: Record<string, unknown> | null;
    created_on: string;
  }>(
    client,
    `SELECT id, org_id, org_code, change_type, status, payload,
            to_char(created_at, 'YYYY-MM-DD') AS created_on
       FROM public.tb_s080_corp_changes
      WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    orgId: r.org_id,
    orgCode: r.org_code,
    changeType: r.change_type,
    status: r.status,
    payload: r.payload ?? {},
    createdOn: r.created_on,
  };
}

export interface CompanySourceRow {
  isTenant: boolean;
  tenantCompanyId: string | null;
  /** 입주사 = ERP 회사명, 비입주사 = 등기상 상호. */
  legalName: string | null;
  corpNumber: string | null;
  bizNumber: string | null;
  ceoName: string | null;
  tel: string | null;
  headZipCode: string | null;
  headAddress: string | null;
  headAddressDetail: string | null;
  ceoZipCode: string | null;
  ceoAddress: string | null;
  ceoAddressDetail: string | null;
  memberType: string | null;
  hasLegalOrg: boolean;
}

/**
 * 기본정보 — 입주사면 ERP 입주사 정보, 아니면 법무 회사 정보. **읽기만** 한다.
 *
 * ★★ `orgId` 는 **RLS 를 통과한 건에서 꺼낸 값**이거나, `parseOrgTarget` 을 거친 값(회사 세션이면
 *    세션 자기 단체)만 넣는다(머리말 ⚠). 화면이 준 값을 그대로 넣지 않는다.
 * ★ 입주사면 법무 회사 정보 줄이 있어도 보지 않는다 — 입주사 정보의 정본은 ERP 다.
 */
export async function readCompanySource(client: ScopedClient, orgId: number): Promise<CompanySourceRow> {
  const tenant = await q<{
    company_id: string;
    company_name: string | null;
    corp_number: string | null;
    biz_number: string | null;
    ceo_name: string | null;
    tel: string | null;
    head_zip_code: string | null;
    head_address: string | null;
    head_address_detail: string | null;
    ceo_zip_code: string | null;
    ceo_address: string | null;
    ceo_address_detail: string | null;
    member_type: string | null;
  }>(
    client,
    `SELECT company_id, company_name, corp_number, biz_number, ceo_name, tel,
            head_zip_code, head_address, head_address_detail,
            ceo_zip_code, ceo_address, ceo_address_detail, member_type
       FROM public.tb_s080_companies
      WHERE link_s020_org_id = $1`,
    [orgId],
  );
  const t = tenant.rows[0];
  if (t) {
    return {
      isTenant: true,
      tenantCompanyId: t.company_id,
      legalName: t.company_name,
      corpNumber: t.corp_number,
      bizNumber: t.biz_number,
      ceoName: t.ceo_name,
      tel: t.tel,
      headZipCode: t.head_zip_code,
      headAddress: t.head_address,
      headAddressDetail: t.head_address_detail,
      ceoZipCode: t.ceo_zip_code,
      ceoAddress: t.ceo_address,
      ceoAddressDetail: t.ceo_address_detail,
      memberType: t.member_type,
      hasLegalOrg: false,
    };
  }

  const legal = await q<{
    legal_name: string | null;
    corp_number: string | null;
    biz_number: string | null;
    ceo_name: string | null;
    tel: string | null;
    head_zip_code: string | null;
    head_address: string | null;
    head_address_detail: string | null;
    ceo_zip_code: string | null;
    ceo_address: string | null;
    ceo_address_detail: string | null;
    member_type: string | null;
  }>(
    client,
    `SELECT legal_name, corp_number, biz_number, ceo_name, tel,
            head_zip_code, head_address, head_address_detail,
            ceo_zip_code, ceo_address, ceo_address_detail, member_type
       FROM public.tb_s080_legal_orgs
      WHERE org_id = $1`,
    [orgId],
  );
  const l = legal.rows[0];
  return {
    isTenant: false,
    tenantCompanyId: null,
    legalName: l?.legal_name ?? null,
    corpNumber: l?.corp_number ?? null,
    bizNumber: l?.biz_number ?? null,
    ceoName: l?.ceo_name ?? null,
    tel: l?.tel ?? null,
    headZipCode: l?.head_zip_code ?? null,
    headAddress: l?.head_address ?? null,
    headAddressDetail: l?.head_address_detail ?? null,
    ceoZipCode: l?.ceo_zip_code ?? null,
    ceoAddress: l?.ceo_address ?? null,
    ceoAddressDetail: l?.ceo_address_detail ?? null,
    memberType: l?.member_type ?? null,
    hasLegalOrg: l !== undefined,
  };
}

/** 변경 내용 — 통째로 바꾼다. 상태 확인은 부르는 쪽이 같은 트랜잭션에서 먼저 한다(`forUpdate`). */
export async function updatePayload(
  client: ScopedClient,
  args: { id: string; payload: Record<string, unknown>; actor: string },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_corp_changes
        SET payload = $2::jsonb, updated_at = now(), updated_by = $3
      WHERE id = $1`,
    [args.id, JSON.stringify(args.payload), args.actor],
  );
}

/** 건의 수정 시각을 당긴다 — 임원을 고친 것도 그 건을 고친 것이다. */
export async function touchCorpChange(client: ScopedClient, id: string, actor: string): Promise<void> {
  await q(client, `UPDATE public.tb_s080_corp_changes SET updated_at = now(), updated_by = $2 WHERE id = $1`, [
    id,
    actor,
  ]);
}

// =============================================================================
// 임원
// =============================================================================

interface OfficerRow {
  id: string;
  name: string;
  change_kind: string;
  position: string | null;
  effective_date: string | null;
  zip_code: string | null;
  address: string | null;
  address_detail: string | null;
  rrn_masked: string | null;
  sort_order: number;
}

/** ★ 암호문 칸(`rrn_cipher`)은 **고르지 않는다** — 응답에 실릴 길을 처음부터 막는다. */
const OFFICER_COLUMNS = `id, name, change_kind, position,
       to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
       zip_code, address, address_detail, rrn_masked, sort_order`;

const toOfficerView = (r: OfficerRow): CorpChangeOfficerView => ({
  id: r.id,
  name: r.name,
  changeKind: r.change_kind,
  position: r.position,
  effectiveDate: r.effective_date,
  zipCode: r.zip_code,
  address: r.address,
  addressDetail: r.address_detail,
  rrnMasked: r.rrn_masked,
  sortOrder: r.sort_order,
});

export async function listOfficers(client: ScopedClient, corpChangeId: string): Promise<CorpChangeOfficerView[]> {
  const { rows } = await q<OfficerRow>(
    client,
    `SELECT ${OFFICER_COLUMNS}
       FROM public.tb_s080_corp_change_officers
      WHERE corp_change_id = $1
      ORDER BY sort_order, created_at, id`,
    [corpChangeId],
  );
  return rows.map(toOfficerView);
}

/** 주민번호 저장 값 — 암호화는 부르는 쪽(`lib/crypto.ts`)이 한다. 이 파일은 평문을 모른다. */
export interface RrnStored {
  /** `encrypt()` 의 `v1.<iv>.<tag>.<암호문>` 덩어리 전체. */
  cipher: string;
  /** 앞 7자리 + `******`. */
  masked: string;
}

/**
 * 임원 추가 — 단체 ID 는 부모 건의 것을 쓴다(복합 FK 가 다르면 거절한다, 037).
 *
 * ★★ `rrn_iv` 는 **늘 NULL** 이다. 레거시는 IV 와 암호문을 두 칸에 나눠 담았지만, ERP 암호화
 *    (`lib/crypto.ts`)는 IV · 인증 태그 · 암호문을 한 덩어리(`v1.…`)로 만들어 `rrn_cipher` 에
 *    통째로 넣는다(결정 2026-10-10). 칸은 레거시 자료 · 되돌리기를 위해 남겨 둔다.
 */
export async function insertOfficer(
  client: ScopedClient,
  args: { id: string; corpChangeId: string; orgId: number; input: OfficerInput; rrn: RrnStored | null },
): Promise<CorpChangeOfficerView> {
  const o = args.input;
  const { rows } = await q<OfficerRow>(
    client,
    `INSERT INTO public.tb_s080_corp_change_officers
       (id, corp_change_id, org_id, name, change_kind, position, effective_date,
        zip_code, address, address_detail, rrn_cipher, rrn_iv, rrn_masked,
        sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, NULL, $12,
             (SELECT coalesce(max(sort_order), 0) + 1 FROM public.tb_s080_corp_change_officers WHERE corp_change_id = $2),
             now(), now())
     RETURNING ${OFFICER_COLUMNS}`,
    [
      args.id, args.corpChangeId, args.orgId, o.name, o.changeKind, o.position, o.effectiveDate,
      o.zipCode, o.address, o.addressDetail, args.rrn?.cipher ?? null, args.rrn?.masked ?? null,
    ],
  );
  return toOfficerView(rows[0]!);
}

/**
 * 임원 수정 — **`corp_change_id` 를 함께 건다**(머리말 ★★). 맞는 줄이 없으면 null.
 * ★ 주민번호는 새로 받았을 때만 바꾼다(`rrn === undefined` 면 그대로).
 */
export async function updateOfficer(
  client: ScopedClient,
  args: { id: string; corpChangeId: string; input: OfficerInput; rrn: RrnStored | undefined },
): Promise<CorpChangeOfficerView | null> {
  const o = args.input;
  const params: unknown[] = [
    args.id, args.corpChangeId, o.name, o.changeKind, o.position, o.effectiveDate,
    o.zipCode, o.address, o.addressDetail,
  ];
  let rrnSet = '';
  if (args.rrn) {
    params.push(args.rrn.cipher, args.rrn.masked);
    rrnSet = `, rrn_cipher = $10, rrn_iv = NULL, rrn_masked = $11`;
  }
  const { rows } = await q<OfficerRow>(
    client,
    `UPDATE public.tb_s080_corp_change_officers
        SET name = $3, change_kind = $4, position = $5, effective_date = $6::date,
            zip_code = $7, address = $8, address_detail = $9, updated_at = now()${rrnSet}
      WHERE id = $1 AND corp_change_id = $2
      RETURNING ${OFFICER_COLUMNS}`,
    params,
  );
  return rows[0] ? toOfficerView(rows[0]) : null;
}

/** 임원 삭제 — **`corp_change_id` 를 함께 건다**. 지운 줄이 있으면 true. */
export async function deleteOfficer(client: ScopedClient, args: { id: string; corpChangeId: string }): Promise<boolean> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_s080_corp_change_officers WHERE id = $1 AND corp_change_id = $2`,
    [args.id, args.corpChangeId],
  );
  return (rowCount ?? 0) > 0;
}

// =============================================================================
// 비입주사 법무 회사 정보
// =============================================================================

/**
 * 회사당 1행 — 없으면 만들고 있으면 통째로 바꾼다.
 * ★ **입주사 단체에는 부르지 않는다**(037 — 입주사는 ERP 를 읽는다). 판정은 부르는 쪽이 한다.
 */
export async function upsertLegalOrg(
  client: ScopedClient,
  args: { orgId: number; input: LegalOrgInput; actor: string },
): Promise<void> {
  const i = args.input;
  await q(
    client,
    `INSERT INTO public.tb_s080_legal_orgs
       (org_id, legal_name, corp_number, biz_number, ceo_name, tel,
        head_zip_code, head_address, head_address_detail,
        ceo_zip_code, ceo_address, ceo_address_detail, member_type,
        created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), $14, $14)
     ON CONFLICT (org_id) DO UPDATE SET
       legal_name = EXCLUDED.legal_name, corp_number = EXCLUDED.corp_number,
       biz_number = EXCLUDED.biz_number, ceo_name = EXCLUDED.ceo_name, tel = EXCLUDED.tel,
       head_zip_code = EXCLUDED.head_zip_code, head_address = EXCLUDED.head_address,
       head_address_detail = EXCLUDED.head_address_detail,
       ceo_zip_code = EXCLUDED.ceo_zip_code, ceo_address = EXCLUDED.ceo_address,
       ceo_address_detail = EXCLUDED.ceo_address_detail, member_type = EXCLUDED.member_type,
       updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [
      args.orgId, i.legalName, i.corpNumber, i.bizNumber, i.ceoName, i.tel,
      i.headZipCode, i.headAddress, i.headAddressDetail,
      i.ceoZipCode, i.ceoAddress, i.ceoAddressDetail, i.memberType, args.actor,
    ],
  );
}
