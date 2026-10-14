/**
 * 법인설립(s040100010 · s040100020) 저장소 — 목록 · 새 건 · 상세 · 설립 정보 · 사람 · 상태 전이 · 삭제(10-3, 2026-10-11).
 *
 * ★★★ 누가 무엇을 보는지는 **RLS 가 가른다**(042 `erp_org_scope`). 이 파일은 단체 조건을 적지 않는다 —
 *    반드시 `scopeOfSession` 스코프 안에서 부른다(법인변경 `db/corpChanges.ts` 머리말과 같다).
 * ★★ ERP 회사표(`tb_s080_companies`)는 **읽지도 쓰지도 않는다**(결정 2026-10-11 — 설립 건은 삐용 단체가 키,
 *    상호 · 본점은 설립 건에 둔다, 완료 뒤 ERP 에 쓰지 않는다). 단체코드만 법인변경과 같이 읽는다(`tenantOrgCode`).
 * ★★ 사람 수정 · 삭제는 **`incorporation_id` 를 함께 건다** — 다른 건의 사람 ID 로 두드리면 0건이다.
 *    부모 건과 다른 단체의 사람은 복합 FK 가 만들 수 없게 한다(042).
 * ★ 금액 · 주식 수 칸은 bigint 다(042) — pg 가 글자로 돌려주므로 숫자로 바꿔 읽는다(`num`). 앱은
 *   `Number.MAX_SAFE_INTEGER` 까지만 받으므로(`INCORP_INT_MAX`) 바꿔도 값이 변하지 않는다.
 * ★ 주민번호 암호문(`rrn_cipher`)은 고르지 않는다 — 응답에 실릴 길을 막는다. `rrn_iv` 는 늘 NULL(037 임원과 같다).
 */
import type {
  IncorpInfoInput,
  IncorpPersonInput,
  IncorpPersonView,
  IncorporationListFilter,
} from '@swonbiz/shared/domain/incorporation-detail';
import { INCORP_ENTITY_TYPE } from '@swonbiz/shared/domain/incorporation';
import type { IncorpPrintLogItem } from '@swonbiz/shared/domain/incorporation-print';
import type { ScopedClient } from './withCompanyScope.ts';
import type { RrnStored } from './corpChanges.ts';

interface Rows<T> {
  rows: T[];
  rowCount?: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/** 운영사 하나(법인변경 · 표양식과 같다). */
const OPERATOR_ID = 1;
/** 레거시 칸 값 — 발기설립. 설립 구분 코드(`LAW_EST_TP` R_PROMOTER)는 회사유형 R + 이 값이다. */
const ESTABLISHMENT_METHOD = 'PROMOTER';

/** bigint · numeric 이 글자로 온다 — 숫자로. */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// =============================================================================
// 목록
// =============================================================================

interface ListRow {
  id: string;
  org_id: number;
  org_code: string | null;
  name_ko: string | null;
  company_type_position: string | null;
  status: string;
  created_on: string;
  planned_date: string | null;
}

/** 목록 — 새 건이 위. 상호 합치기는 부르는 쪽(shared `composeIncorporationName`). */
export async function listIncorporations(
  client: ScopedClient,
  f: IncorporationListFilter,
): Promise<ListRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) {
    params.push(f.status);
    where.push(`status = $${params.length}`);
  }
  if (!f.includeCancelled) where.push(`status <> 'X'`);
  const { rows } = await q<ListRow>(
    client,
    `SELECT id, org_id, org_code, name_ko, company_type_position, status,
            to_char(created_at, 'YYYY-MM-DD') AS created_on,
            to_char(planned_date, 'YYYY-MM-DD') AS planned_date
       FROM public.tb_s080_incorporations
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id`,
    params,
  );
  return rows;
}

// =============================================================================
// 건
// =============================================================================

export interface IncorporationRow {
  id: string;
  orgId: number;
  orgCode: string | null;
  status: string;
  info: IncorpInfoInput;
  createdOn: string;
  statusBeforeCancel: string | null;
  cancelReason: string | null;
  writtenOn: string | null;
  completedOn: string | null;
}

const INC_COLUMNS = `id, org_id, org_code, status,
       name_ko, name_en, company_type_position,
       head_zip_code, head_address, head_address_detail,
       capital_amount, par_value, units_authorized, units_issued,
       public_notice_method, fiscal_start, fiscal_end,
       to_char(planned_date, 'YYYY-MM-DD') AS planned_date, purposes,
       meeting_time, payment_bank,
       to_char(created_at, 'YYYY-MM-DD') AS created_on,
       status_before_cancel, cancel_reason,
       to_char(written_at, 'YYYY-MM-DD') AS written_on,
       to_char(completed_at, 'YYYY-MM-DD') AS completed_on`;

interface IncRow {
  id: string;
  org_id: number;
  org_code: string | null;
  status: string;
  name_ko: string | null;
  name_en: string | null;
  company_type_position: string | null;
  head_zip_code: string | null;
  head_address: string | null;
  head_address_detail: string | null;
  capital_amount: unknown;
  par_value: unknown;
  units_authorized: unknown;
  units_issued: unknown;
  public_notice_method: string | null;
  fiscal_start: string | null;
  fiscal_end: string | null;
  planned_date: string | null;
  purposes: string | null;
  meeting_time: string | null;
  payment_bank: string | null;
  created_on: string;
  status_before_cancel: string | null;
  cancel_reason: string | null;
  written_on: string | null;
  completed_on: string | null;
}

const toRow = (r: IncRow): IncorporationRow => ({
  id: r.id,
  orgId: r.org_id,
  orgCode: r.org_code,
  status: r.status,
  info: {
    nameKo: r.name_ko,
    nameEn: r.name_en,
    hq:
      r.head_zip_code === null && r.head_address === null && r.head_address_detail === null
        ? null
        : { zipCode: r.head_zip_code, address: r.head_address, addressDetail: r.head_address_detail },
    capitalAmount: num(r.capital_amount),
    parValue: num(r.par_value),
    unitsAuthorized: num(r.units_authorized),
    unitsIssued: num(r.units_issued),
    publicNoticeMethod: r.public_notice_method,
    fiscalStart: r.fiscal_start,
    fiscalEnd: r.fiscal_end,
    plannedDate: r.planned_date,
    meetingTime: r.meeting_time,
    paymentBank: r.payment_bank,
    purposes: r.purposes,
    companyTypePosition: r.company_type_position,
  },
  createdOn: r.created_on,
  statusBeforeCancel: r.status_before_cancel,
  cancelReason: r.cancel_reason,
  writtenOn: r.written_on,
  completedOn: r.completed_on,
});

/** 건 하나 — 안 보이면(없거나 남의 단체) null. `forUpdate` 는 법인변경과 같은 뜻. */
export async function getIncorporation(
  client: ScopedClient,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<IncorporationRow | null> {
  const { rows } = await q<IncRow>(
    client,
    `SELECT ${INC_COLUMNS} FROM public.tb_s080_incorporations WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** 설립 정보 칸 → SQL 값 순서(넣기 · 고치기 공용). */
const infoParams = (i: IncorpInfoInput): unknown[] => [
  i.nameKo, i.nameEn, i.companyTypePosition,
  i.hq?.zipCode ?? null, i.hq?.address ?? null, i.hq?.addressDetail ?? null,
  i.capitalAmount, i.parValue, i.unitsAuthorized, i.unitsIssued,
  i.publicNoticeMethod, i.fiscalStart, i.fiscalEnd, i.plannedDate, i.purposes,
  i.meetingTime, i.paymentBank,
];

/** 새 건 — 첫 [저장] 때만(법인변경과 같다). 회사유형 R · 발기설립 고정. */
export async function insertIncorporation(
  client: ScopedClient,
  args: { id: string; status: string; orgId: number; orgCode: string | null; info: IncorpInfoInput; actor: string },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_incorporations
       (id, status, operator_id, org_id, org_code, entity_type, establishment_method,
        name_ko, name_en, company_type_position, head_zip_code, head_address, head_address_detail,
        capital_amount, par_value, units_authorized, units_issued,
        public_notice_method, fiscal_start, fiscal_end, planned_date, purposes,
        meeting_time, payment_bank,
        created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::date, $22,
             $23, $24,
             now(), now(), $25, $25)`,
    [args.id, args.status, OPERATOR_ID, args.orgId, args.orgCode, INCORP_ENTITY_TYPE, ESTABLISHMENT_METHOD, ...infoParams(args.info), args.actor],
  );
}

/** 설립 정보 — 통째로 바꾼다. 상태 확인은 부르는 쪽이 같은 트랜잭션에서 먼저(`forUpdate`). */
export async function updateIncorporationInfo(
  client: ScopedClient,
  args: { id: string; info: IncorpInfoInput; actor: string },
): Promise<void> {
  await q(
    client,
    `UPDATE public.tb_s080_incorporations
        SET name_ko = $2, name_en = $3, company_type_position = $4,
            head_zip_code = $5, head_address = $6, head_address_detail = $7,
            capital_amount = $8, par_value = $9, units_authorized = $10, units_issued = $11,
            public_notice_method = $12, fiscal_start = $13, fiscal_end = $14, planned_date = $15::date, purposes = $16,
            meeting_time = $17, payment_bank = $18,
            updated_at = now(), updated_by = $19
      WHERE id = $1`,
    [args.id, ...infoParams(args.info), args.actor],
  );
}

export async function touchIncorporation(client: ScopedClient, id: string, actor: string): Promise<void> {
  await q(client, `UPDATE public.tb_s080_incorporations SET updated_at = now(), updated_by = $2 WHERE id = $1`, [id, actor]);
}

/**
 * 상태 하나를 바꾼다 — 딸린 칸은 법인변경(`updateCorpChangeStatus`)과 같다:
 *   →X 취소 · X→ 복원 · P→E 작성완료(written_at · submit_snapshot) · E→C 완료 · C→E 완료 취소.
 * ★ `WHERE status = from` 을 한 번 더 건다. 바뀐 줄이 없으면 false.
 */
export async function updateIncorporationStatus(
  client: ScopedClient,
  args: { id: string; from: string; to: string; actor: string; cancelReason?: string | null; snapshot?: unknown },
): Promise<boolean> {
  const params: unknown[] = [args.id, args.from, args.to, args.actor];
  const set = ['status = $3', 'updated_at = now()', 'updated_by = $4'];
  if (args.to === 'X') {
    params.push(args.cancelReason ?? null);
    set.push('status_before_cancel = $2', 'cancelled_at = now()', `cancel_reason = $${params.length}`);
  } else if (args.from === 'X') {
    set.push('status_before_cancel = NULL', 'cancelled_at = NULL', 'cancel_reason = NULL');
  } else if (args.from === 'P' && args.to === 'E') {
    params.push(JSON.stringify(args.snapshot));
    set.push('written_at = now()', `submit_snapshot = $${params.length}::jsonb`);
  } else if (args.from === 'E' && args.to === 'C') {
    set.push('completed_at = now()');
  } else if (args.from === 'C' && args.to === 'E') {
    set.push('completed_at = NULL');
  }
  const { rowCount } = await q(
    client,
    `UPDATE public.tb_s080_incorporations SET ${set.join(', ')} WHERE id = $1 AND status = $2`,
    params,
  );
  return (rowCount ?? 0) > 0;
}

/** 건을 지운다 — 사람을 먼저 지우고 건을(눈에 보이게). 쓰지 않는 사업목적 표는 FK CASCADE 가 지운다. */
export async function deleteIncorporation(client: ScopedClient, args: { id: string; status: string }): Promise<boolean> {
  await q(client, `DELETE FROM public.tb_s080_incorp_persons WHERE incorporation_id = $1`, [args.id]);
  const { rowCount } = await q(client, `DELETE FROM public.tb_s080_incorporations WHERE id = $1 AND status = $2`, [
    args.id,
    args.status,
  ]);
  return (rowCount ?? 0) > 0;
}

/** 작성완료 스냅샷(가공 전) — 서류 출력(10-5)이 읽는다. */
export async function readIncorporationSnapshotRaw(client: ScopedClient, id: string): Promise<unknown> {
  const { rows } = await q<{ submit_snapshot: unknown }>(
    client,
    `SELECT submit_snapshot FROM public.tb_s080_incorporations WHERE id = $1`,
    [id],
  );
  return rows[0]?.submit_snapshot ?? null;
}

// =============================================================================
// 사람
// =============================================================================

interface PersonRow {
  id: string;
  name: string;
  is_founder: boolean;
  is_director: boolean;
  is_auditor: boolean;
  is_representative: boolean;
  units_subscribed: unknown;
  appointment_date: string | null;
  zip_code: string | null;
  address: string | null;
  address_detail: string | null;
  rrn_masked: string | null;
  sort_order: number;
}

const PERSON_COLUMNS = `id, name, is_founder, is_director, is_auditor, is_representative, units_subscribed,
       to_char(appointment_date, 'YYYY-MM-DD') AS appointment_date,
       zip_code, address, address_detail, rrn_masked, sort_order`;

const toPerson = (r: PersonRow): IncorpPersonView => ({
  id: r.id,
  name: r.name,
  isFounder: r.is_founder,
  isDirector: r.is_director,
  isAuditor: r.is_auditor,
  isRepresentative: r.is_representative,
  unitsSubscribed: num(r.units_subscribed) ?? 0,
  appointmentDate: r.appointment_date,
  zipCode: r.zip_code,
  address: r.address,
  addressDetail: r.address_detail,
  rrnMasked: r.rrn_masked,
  sortOrder: r.sort_order,
});

export async function listIncorpPersons(client: ScopedClient, incorporationId: string): Promise<IncorpPersonView[]> {
  const { rows } = await q<PersonRow>(
    client,
    `SELECT ${PERSON_COLUMNS} FROM public.tb_s080_incorp_persons
      WHERE incorporation_id = $1 ORDER BY sort_order, created_at, id`,
    [incorporationId],
  );
  return rows.map(toPerson);
}

/** 사람 추가 — 단체 ID 는 부모 건의 것(복합 FK, 042). 순서는 끝에. */
export async function insertIncorpPerson(
  client: ScopedClient,
  args: { id: string; incorporationId: string; orgId: number; input: IncorpPersonInput; rrn: RrnStored | null },
): Promise<IncorpPersonView> {
  const p = args.input;
  const { rows } = await q<PersonRow>(
    client,
    `INSERT INTO public.tb_s080_incorp_persons
       (id, incorporation_id, org_id, name, is_founder, is_director, is_auditor, is_representative,
        units_subscribed, appointment_date, zip_code, address, address_detail,
        rrn_cipher, rrn_iv, rrn_masked, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, $13, $14, NULL, $15,
             (SELECT coalesce(max(sort_order), 0) + 1 FROM public.tb_s080_incorp_persons WHERE incorporation_id = $2),
             now(), now())
     RETURNING ${PERSON_COLUMNS}`,
    [
      args.id, args.incorporationId, args.orgId, p.name, p.isFounder, p.isDirector, p.isAuditor, p.isRepresentative,
      p.unitsSubscribed, p.appointmentDate, p.zipCode, p.address, p.addressDetail,
      args.rrn?.cipher ?? null, args.rrn?.masked ?? null,
    ],
  );
  return toPerson(rows[0]!);
}

/** 사람 수정 — `incorporation_id` 를 함께 건다. 주민번호는 새로 받았을 때만 바꾼다. 맞는 줄이 없으면 null. */
export async function updateIncorpPerson(
  client: ScopedClient,
  args: { id: string; incorporationId: string; input: IncorpPersonInput; rrn: RrnStored | undefined },
): Promise<IncorpPersonView | null> {
  const p = args.input;
  const params: unknown[] = [
    args.id, args.incorporationId, p.name, p.isFounder, p.isDirector, p.isAuditor, p.isRepresentative,
    p.unitsSubscribed, p.appointmentDate, p.zipCode, p.address, p.addressDetail,
  ];
  let rrnSet = '';
  if (args.rrn) {
    params.push(args.rrn.cipher, args.rrn.masked);
    rrnSet = `, rrn_cipher = $13, rrn_iv = NULL, rrn_masked = $14`;
  }
  const { rows } = await q<PersonRow>(
    client,
    `UPDATE public.tb_s080_incorp_persons
        SET name = $3, is_founder = $4, is_director = $5, is_auditor = $6, is_representative = $7,
            units_subscribed = $8, appointment_date = $9::date,
            zip_code = $10, address = $11, address_detail = $12, updated_at = now()${rrnSet}
      WHERE id = $1 AND incorporation_id = $2
      RETURNING ${PERSON_COLUMNS}`,
    params,
  );
  return rows[0] ? toPerson(rows[0]) : null;
}

/** 사람 삭제 — `incorporation_id` 를 함께 건다. */
export async function deleteIncorpPerson(client: ScopedClient, args: { id: string; incorporationId: string }): Promise<boolean> {
  const { rowCount } = await q(client, `DELETE FROM public.tb_s080_incorp_persons WHERE id = $1 AND incorporation_id = $2`, [
    args.id,
    args.incorporationId,
  ]);
  return (rowCount ?? 0) > 0;
}

// =============================================================================
// 서류 출력(10-5) — 사람 암호문 · 출력 이력(043, FK 없음 · 덧붙이기만)
// =============================================================================

/** 출력용 사람 — 짝 맞추기용 이름과 **암호문**. */
export interface IncorpPersonSecretRow {
  name: string;
  /** `encrypt()` 덩어리. 없으면 null. ★ 복호화는 출력 응답을 만드는 순간에만(`legal/incorporationPrint.ts`). */
  rrnCipher: string | null;
}

/**
 * 출력용 사람 — `listIncorpPersons` 와 **같은 순서**다(스냅샷이 그 순서로 만들어졌다).
 * ★ 암호문 칸을 고르는 곳은 여기 하나다 — 출력만 부른다.
 */
export async function listIncorpPersonSecrets(client: ScopedClient, incorporationId: string): Promise<IncorpPersonSecretRow[]> {
  const { rows } = await q<{ name: string; rrn_cipher: string | null }>(
    client,
    `SELECT name, rrn_cipher FROM public.tb_s080_incorp_persons
      WHERE incorporation_id = $1 ORDER BY sort_order, created_at, id`,
    [incorporationId],
  );
  return rows.map((r) => ({ name: r.name, rrnCipher: r.rrn_cipher }));
}

/** 출력 이력 한 줄. ★ `orgId` 는 RLS 를 통과한 건의 것만(화면 값 아님). 주민번호 · 서류 값은 없다. */
export async function insertIncorpPrintLog(
  client: ScopedClient,
  args: {
    id: string;
    incorporationId: string;
    orgId: number;
    formId: string;
    formName: string;
    personName: string | null;
    applyDate: string | null;
    writeDate: string | null;
    printedBy: string;
    printedRole: string;
  },
): Promise<void> {
  await q(
    client,
    `INSERT INTO public.tb_s080_incorporation_prints
       (id, incorporation_id, org_id, form_id, form_name, person_name, apply_date, write_date, printed_by, printed_role, printed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, now())`,
    [
      args.id, args.incorporationId, args.orgId, args.formId, args.formName, args.personName,
      args.applyDate, args.writeDate, args.printedBy, args.printedRole,
    ],
  );
}

/** 그 건의 출력 이력 — 새것이 위. */
export async function listIncorpPrintLogs(client: ScopedClient, incorporationId: string): Promise<IncorpPrintLogItem[]> {
  const { rows } = await q<{
    printed_at: string;
    form_name: string;
    person_name: string | null;
    apply_date: string | null;
    write_date: string | null;
    printed_by: string;
    printed_role: 'operator' | 'tenant';
  }>(
    client,
    `SELECT to_char(printed_at, 'YYYY-MM-DD HH24:MI') AS printed_at, form_name, person_name,
            to_char(apply_date, 'YYYY-MM-DD') AS apply_date, to_char(write_date, 'YYYY-MM-DD') AS write_date,
            printed_by, printed_role
       FROM public.tb_s080_incorporation_prints
      WHERE incorporation_id = $1
      ORDER BY printed_at DESC, id`,
    [incorporationId],
  );
  return rows.map((r) => ({
    printedAt: r.printed_at,
    formName: r.form_name,
    personName: r.person_name,
    applyDate: r.apply_date,
    writeDate: r.write_date,
    printedBy: r.printed_by,
    printedRole: r.printed_role,
  }));
}
