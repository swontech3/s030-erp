/**
 * 세무 세무사 전달 서류(s050500010) DB — 은행 줄 읽기 · 최종 발송 읽기 · 덮어쓰기(1-9 2026-11-07 · 11-08 ⑧ 224).
 *
 * ★★★ 모든 질의가 `org_id = $1`(세션 단체 ID)을 직접 건다 — 운영사 세션도 RLS 가 모든 단체를 보여 주기 때문이다(203 머리말).
 * ★ 은행 줄의 계좌는 별칭 또는 끝 4자리만 내보낸다 — 전체 번호는 화면 · 엑셀로 나가지 않는다(계좌 글자는 라우트가 만든다).
 *   별칭은 세무 설정 계좌(은행 · 같은 번호)에서 찾는다 — 「사용 안 함」 계좌도 이름은 그대로 보인다(세무 설정 안내).
 * ★ 최종 발송은 단체 · 종류 · 신고 기간마다 한 줄 — 성공할 때만 덮어쓴다(224 — erp_app 은 덮어쓰는 칸만 UPDATE · 지우기 없음).
 */
import type { HandoffLastView } from '@swonbiz/shared/domain/tax-handoff';
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

/* ── 은행 줄 ─────────────────────────────────────────────────────────────── */

export interface HandoffBankRow {
  /** `YYYY-MM-DD HH:MM:SS` — 은행 시각 그대로. */
  txnAt: string;
  /** 우리 계좌번호(숫자만) — 라우트가 별칭 또는 끝 4자리로 바꿔 내보낸다. */
  accountNo: string;
  alias: string | null;
  description: string | null;
  counterparty: string | null;
  memo: string | null;
  inAmount: number;
  outAmount: number;
  balance: number;
  /** 덧붙인 이체 내역 — 없으면 null. 받는 계좌는 끝 4자리만(212). */
  xfer: { bank: string; last4: string; holder: string; toMemo: string | null; fromMemo: string | null } | null;
}

/** 세는 범위 [첫날, 끝 다음 날)의 은행 거래 줄 — 거래일시 순. */
export async function listHandoffBankRows(client: ScopedClient, orgId: number, range: readonly [string, string]): Promise<HandoffBankRow[]> {
  const { rows } = await q<{
    txn_at: string; account_no: string; alias: string | null; description_src: string | null; counterparty_src: string | null;
    memo_src: string | null; in_amount: string; out_amount: string; balance: string; xfer_file_id: string | null;
    xfer_bank_src: string | null; xfer_account_last4: string | null; xfer_holder_src: string | null;
    xfer_to_memo_src: string | null; xfer_from_memo_src: string | null;
  }>(
    client,
    `SELECT to_char(b.txn_at, 'YYYY-MM-DD HH24:MI:SS') AS txn_at, b.account_no, a.alias, b.description_src, b.counterparty_src,
            b.memo_src, b.in_amount, b.out_amount, b.balance, b.xfer_file_id, b.xfer_bank_src, b.xfer_account_last4,
            b.xfer_holder_src, b.xfer_to_memo_src, b.xfer_from_memo_src
       FROM public.tb_s050_bank_txns b
       LEFT JOIN LATERAL (
         SELECT f.alias FROM public.tb_s050_fin_accounts f
          WHERE f.org_id = b.org_id AND f.kind = 'B' AND f.number = b.account_no
          ORDER BY f.is_active DESC, f.sort_order, f.id
          LIMIT 1
       ) a ON true
      WHERE b.org_id = $1 AND b.txn_at >= $2::date AND b.txn_at < $3::date
      ORDER BY b.txn_at, b.created_at, b.id`,
    [orgId, range[0], range[1]],
  );
  return rows.map((r) => ({
    txnAt: r.txn_at,
    accountNo: r.account_no,
    alias: r.alias,
    description: r.description_src,
    counterparty: r.counterparty_src,
    memo: r.memo_src,
    inAmount: Number(r.in_amount),
    outAmount: Number(r.out_amount),
    balance: Number(r.balance),
    xfer: r.xfer_file_id
      ? { bank: r.xfer_bank_src!, last4: r.xfer_account_last4!, holder: r.xfer_holder_src!, toMemo: r.xfer_to_memo_src, fromMemo: r.xfer_from_memo_src }
      : null,
  }));
}

/* ── 최종 발송(224) ─────────────────────────────────────────────────────── */

export interface HandoffLastKey {
  tp: string;
  periodId: string;
}
export type NewHandoffLast = Omit<HandoffLastView, 'sentAt'>;

const LAST_COLS = `to_char(sent_at, 'YYYY-MM-DD HH24:MI') AS sent_at, recipients, cc, file_name, sent_by, sent_by_name`;

interface LastRow {
  sent_at: string; recipients: string[]; cc: string | null; file_name: string; sent_by: string; sent_by_name: string | null;
}
const lastView = (r: LastRow): HandoffLastView => ({
  sentAt: r.sent_at, recipients: r.recipients, cc: r.cc, fileName: r.file_name, sentBy: r.sent_by, sentByName: r.sent_by_name,
});

/** 그 단체 · 종류 · 신고 기간의 최종 발송 — 없으면 null(미발송). */
export async function getHandoffLast(client: ScopedClient, orgId: number, k: HandoffLastKey): Promise<HandoffLastView | null> {
  const { rows } = await q<LastRow>(
    client,
    `SELECT ${LAST_COLS} FROM public.tb_s050_handoff_last WHERE org_id = $1 AND handoff_tp = $2 AND period_id = $3`,
    [orgId, k.tp, k.periodId],
  );
  return rows[0] ? lastView(rows[0]) : null;
}

/** 성공한 발송으로 덮어쓴다 — 없으면 넣고, 있으면 그 줄을 바꾼다(224 — erp_app 은 덮어쓰는 칸만 UPDATE). */
export async function upsertHandoffLast(client: ScopedClient, orgId: number, k: HandoffLastKey, l: NewHandoffLast): Promise<HandoffLastView> {
  const { rows } = await q<LastRow>(
    client,
    `INSERT INTO public.tb_s050_handoff_last (org_id, handoff_tp, period_id, sent_at, recipients, cc, file_name, sent_by, sent_by_name)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7, $8)
     ON CONFLICT (org_id, handoff_tp, period_id) DO UPDATE SET
       sent_at = EXCLUDED.sent_at, recipients = EXCLUDED.recipients, cc = EXCLUDED.cc, file_name = EXCLUDED.file_name,
       sent_by = EXCLUDED.sent_by, sent_by_name = EXCLUDED.sent_by_name
     RETURNING ${LAST_COLS}`,
    [orgId, k.tp, k.periodId, l.recipients, l.cc, l.fileName, l.sentBy, l.sentByName],
  );
  return lastView(rows[0]!);
}
