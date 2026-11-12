/**
 * 세무 세금 · 4대보험 · 대출(s050300040) DB — 214 의 세 표를 **읽기만** 한다(1-7).
 *
 * ★★★ 모든 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★ 날짜는 SQL 에서 글자로 바꾼다(시간대 영향 없음). 금액은 bigint 라 pg 가 글자로 준다 — 원 단위 정수라 Number 로 바꿔도 잃지 않는다.
 * ★ 가입자 번호 · 대출번호는 표에 끝 4자리만 있다.
 */
import type { LoanTxnRow, PaymentTab, SocialInsRow } from '@swonbiz/shared/domain/tax-payments';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

export interface PaymentsFilter {
  /** 날짜 [첫날, 끝 다음 날) — null 이면 날짜로 거르지 않는다(파일로 들어온 때). */
  range: [string, string] | null;
  fileId: string | null;
}

/** 탭 → (표, 날짜 칸, 종류 조건). ★ 식별자라 파라미터로 묶을 수 없어 이 상수에서만 고른다. */
const SOURCE_OF: Readonly<Record<PaymentTab, { table: string; dateCol: string; kind: string | null }>> = {
  NTAX: { table: 'tb_s050_tax_payments', dateCol: 'pay_date', kind: 'NTAX' },
  LTAX: { table: 'tb_s050_tax_payments', dateCol: 'pay_date', kind: 'LTAX' },
  SOCIAL: { table: 'tb_s050_social_ins', dateCol: 'notice_month', kind: null },
  LOAN: { table: 'tb_s050_loan_txns', dateCol: 'txn_date', kind: null },
};

/** 탭의 거르기 — 매개변수 $1 단체 · $2 첫날 · $3 끝 다음 날 · $4 파일 · ($5 종류). */
function whereOf(tab: PaymentTab): string {
  const s = SOURCE_OF[tab];
  return `t.org_id = $1
        AND ($2::date IS NULL OR t.${s.dateCol} >= $2::date)
        AND ($3::date IS NULL OR t.${s.dateCol} < $3::date)
        AND ($4::text IS NULL OR t.file_id = $4)${s.kind ? `\n        AND t.kind = $5` : ''}`;
}
function paramsOf(tab: PaymentTab, orgId: number, f: PaymentsFilter): unknown[] {
  const p: unknown[] = [orgId, f.range?.[0] ?? null, f.range?.[1] ?? null, f.fileId];
  const kind = SOURCE_OF[tab].kind;
  if (kind) p.push(kind);
  return p;
}

/** 탭의 줄 수. */
export async function countPayments(client: ScopedClient, orgId: number, tab: PaymentTab, f: PaymentsFilter): Promise<number> {
  const { rows } = await q<{ n: string }>(
    client,
    `SELECT count(*)::text AS n FROM public.${SOURCE_OF[tab].table} t WHERE ${whereOf(tab)}`,
    paramsOf(tab, orgId, f),
  );
  return Number(rows[0]?.n ?? 0);
}

/** 이 화면이 받는 파일(이 단체 것) — 자료 종류를 함께. 없으면 null. */
export async function findPaymentFile(
  client: ScopedClient,
  orgId: number,
  id: string,
): Promise<{ id: string; fileName: string; kind: string } | null> {
  const { rows } = await q<{ id: string; file_name: string; kind: string }>(
    client,
    `SELECT id, file_name, kind FROM public.tb_s050_upload_files WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  );
  return rows[0] ? { id: rows[0].id, fileName: rows[0].file_name, kind: rows[0].kind } : null;
}

/** 국세 · 지방세 납부 줄 — 날짜 최신순(같은 날은 납부번호 순). 비용 여부는 부르는 쪽이 정한다. */
export interface PayDbRow {
  id: string;
  payDate: string;
  taxItem: string;
  amount: number;
  penalty: number | null;
  belongMonth: string | null;
  office: string | null;
  payMethod: string | null;
  payNo: string;
}

export async function listPayments(client: ScopedClient, orgId: number, tab: 'NTAX' | 'LTAX', f: PaymentsFilter): Promise<PayDbRow[]> {
  const { rows } = await q<{
    id: string; d: string; item: string; amount: string; penalty: string | null; belong: string | null;
    office: string | null; method: string | null; pay_no: string;
  }>(
    client,
    `SELECT t.id, to_char(t.pay_date, 'YYYY-MM-DD') AS d, t.tax_item_src AS item, t.amount::text AS amount,
            t.penalty_amount::text AS penalty, to_char(t.belong_month, 'YYYY-MM') AS belong,
            t.office_src AS office, t.pay_method_src AS method, t.pay_no
       FROM public.tb_s050_tax_payments t
      WHERE ${whereOf(tab)}
      ORDER BY t.pay_date DESC, t.pay_no`,
    paramsOf(tab, orgId, f),
  );
  return rows.map((r) => ({
    id: r.id, payDate: r.d, taxItem: r.item, amount: Number(r.amount), penalty: num(r.penalty),
    belongMonth: r.belong, office: r.office, payMethod: r.method, payNo: r.pay_no,
  }));
}

/** 4대보험 고지 줄 — 고지 연월 최신순, 같은 달은 보험 종류(코드 순) · 이름 순. */
export async function listSocialIns(client: ScopedClient, orgId: number, f: PaymentsFilter): Promise<SocialInsRow[]> {
  const { rows } = await q<{
    id: string; m: string; ins_tp: string; name: string; last4: string | null; base: string | null; amount: string;
  }>(
    client,
    `SELECT t.id, to_char(t.notice_month, 'YYYY-MM') AS m, t.ins_tp, t.member_name_src AS name, t.member_no_last4 AS last4,
            t.pay_base::text AS base, t.notice_amount::text AS amount
       FROM public.tb_s050_social_ins t
      WHERE ${whereOf('SOCIAL')}
      ORDER BY t.notice_month DESC, array_position(ARRAY['NP','HI','LTC','EI','IA']::text[], t.ins_tp::text), t.member_name_src, t.id`,
    paramsOf('SOCIAL', orgId, f),
  );
  return rows.map((r) => ({
    id: r.id, noticeMonth: r.m, insTp: r.ins_tp, name: r.name, memberLast4: r.last4, payBase: num(r.base), noticeAmount: Number(r.amount),
  }));
}

/** 대출 거래 줄 — 거래일 최신순(같은 날은 들어온 순서 거꾸로). */
export async function listLoanTxns(client: ScopedClient, orgId: number, f: PaymentsFilter): Promise<LoanTxnRow[]> {
  const { rows } = await q<{
    id: string; bank: string; last4: string; d: string; tp: string; ty: string | null; p: string; i: string; fe: string; b: string;
  }>(
    client,
    `SELECT t.id, t.bank_code AS bank, t.loan_no_last4 AS last4, to_char(t.txn_date, 'YYYY-MM-DD') AS d, t.txn_tp AS tp,
            t.txn_type_src AS ty, t.principal_amount::text AS p, t.interest_amount::text AS i, t.fee_amount::text AS fe,
            t.balance::text AS b
       FROM public.tb_s050_loan_txns t
      WHERE ${whereOf('LOAN')}
      ORDER BY t.txn_date DESC, t.created_at DESC, t.id`,
    paramsOf('LOAN', orgId, f),
  );
  return rows.map((r) => ({
    id: r.id, bankCode: r.bank, loanLast4: r.last4, txnDate: r.d, txnTp: r.tp, txnType: r.ty,
    principal: Number(r.p), interest: Number(r.i), fee: Number(r.fe), balance: Number(r.b),
  }));
}
