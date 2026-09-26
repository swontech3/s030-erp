/**
 * 청구·납부 스키마 — 청구 1단계.
 *
 * 정본은 `supabase/migrations/021_billing.sql` 이다. 이 파일과 어긋나면 그쪽을 따른다
 * (021 은 `generate` 산출물이 아니라 손으로 썼다 — 008 과 같은 사정이다).
 *
 * =============================================================================
 * ★★★ 청구서는 **계약이 없어도 된다**
 * =============================================================================
 * 지금 만드는 것은 전부 계약에서 나온 정기 청구다. 그래도 `contract_id` 를 NOT NULL
 * 로 두지 않았다 — 시안이 이미 계약 밖의 청구를 그리고 있다. 청구 이력 탭의 항목이
 * 「이용료 + 회의실 초과 2시간」이고(`design/erp-tenants/ErpTenants.dc.html`),
 * 외부인 회의실 이용에는 계약이 없다.
 *
 * NOT NULL 로 시작하면 그날 **이미 쌓인 청구서 전부**를 손대야 한다.
 * 지금 NULL 을 허용하는 값이 그것이다.
 *
 * 대신 `company_id` 는 NOT NULL 이다 — 누구에게 청구하는지 없는 청구서는 없고,
 * 격리축이라 NULL 이면 RLS 가 판단할 근거를 잃는다.
 *
 * =============================================================================
 * ★★ 저장되는 청구 상태는 셋뿐이다
 * =============================================================================
 * `P` 납부대기 / `E` 납부완료 / `C` 취소. 코드 `PAY_ST` 의 `O`(미납)는 **저장하지
 * 않는다** — 시간이 지나면 저절로 참이 되는 사실이라 저장하면 배치가 매일 돌아야
 * 하고, 배치가 하루 멈추면 청구서가 조용히 거짓말을 한다.
 * 화면이 `displayInvoiceStatus`(shared)로 계산한다.
 *
 * =============================================================================
 * ★ 레거시에서 일부러 버린 칸들
 * =============================================================================
 * `is_confirmed`·`confirmed_by`·`confirmed_at`(절차가 실제로 없었다) ·
 * `bank_name`·`account_last4`·`receipt_url`(쓰는 코드가 0건) ·
 * `issue_date`·`sent_at`·`nts_confirm_num`(세금계산서는 이번 범위가 아니다) ·
 * `invoice_no`(채우는 코드가 없었다). 사유는 021 머리말에 하나씩 적혀 있다.
 *
 * ★ `discount_clawback` 은 021 에서 「할인 칸이 없어 늘 0」이라 안 만들었다가,
 *   기준가·계약가로 계산할 수 있게 돼 **022 에서 되살렸다**(`free_clawback` 과 함께).
 */
import { boolean, date, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

/** 청구서 머리 — 월 1장. 일시불은 전 기간을 1장으로 묶는다. */
export const invoices = pgTable('tb_s080_invoices', {
  invoiceId: text('invoice_id').primaryKey(),
  buildId: text('build_id').notNull(),
  /** ★ 격리축. RLS 정책이 이 컬럼 하나만 본다. */
  companyId: text('company_id').notNull(),
  /** ★ NULL 을 받는다 — 계약 없는 외부 이용 청구 자리다. 위 머리말 참조. */
  contractId: text('contract_id'),

  /** 청구 연월 `YYYY-MM`. */
  yearMonth: varchar('year_month', { length: 7 }).notNull(),
  /** 납부일. 매달 계약 시작일과 같은 날이고, 그 날이 없는 달은 말일이다. */
  dueDate: date('due_date').notNull(),

  supplyAmount: integer('supply_amount').notNull().default(0),
  vatAmount: integer('vat_amount').notNull().default(0),
  totalAmount: integer('total_amount').notNull().default(0),
  /** 수납 합계. 수납이 들고 날 때마다 다시 센다(`recalcInvoice`). */
  paidAmount: integer('paid_amount').notNull().default(0),

  /** `PAY_ST` — 저장되는 것은 P / E / C 셋뿐이다. */
  status: varchar('status', { length: 1 }).notNull().default('P'),
  memo: text('memo'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
}, (t) => [
  index('tb_s080_invoices_company_id_idx').on(t.companyId),
  index('tb_s080_invoices_year_month_idx').on(t.buildId, t.yearMonth),
  index('tb_s080_invoices_contract_id_idx').on(t.contractId),
]);

/**
 * 청구 줄 — 청구서 1장에 N줄. 계약 항목(호실)마다 한 줄이다.
 *
 * ★ `company_id` 가 있는 이유는 `tb_s080_contract_spaces` 와 같다 — **RLS 정책을
 *   조인 없이 세울 수 있어야 한다.** 레거시의 이 표는 회사축이 없어 RLS 가 아예
 *   꺼져 있었다. 복합 FK `(invoice_id, company_id)` 가 두 값이 어긋나는 것을 막는다.
 */
export const invoiceLines = pgTable('tb_s080_invoice_lines', {
  invoiceLineId: text('invoice_line_id').primaryKey(),
  invoiceId: text('invoice_id').notNull(),
  /** ★ RLS 격리축. 청구서의 `company_id` 와 반드시 같다(복합 FK 가 강제). */
  companyId: text('company_id').notNull(),

  /** 표시 순서 — 계약 항목의 `seq` 를 그대로 쓴다. */
  seq: smallint('seq').notNull(),

  /**
   * ★ **어디서 온 금액인가** — 코드 `PAY_ITEM`. 지금은 `M`(월 이용료) 하나다.
   *   나중에 주차·사물함·외부 회의실이 같은 청구서에 줄로 얹힌다.
   *   ★ CHECK 로 목록을 박지 않는다 — 항목이 늘 때마다 마이그레이션을 해야 한다.
   *     목록의 정본은 코드 테이블이다.
   */
  payItem: varchar('pay_item', { length: 10 }).notNull().default('M'),

  /** 어느 계약 항목에서 왔는가. 계약 밖의 줄이면 NULL. */
  contractSpaceId: text('contract_space_id'),

  /**
   * 무상 달의 줄인가 — 022.
   *
   * ★ 줄을 **지우지 않고 남긴다.** 무상 달에도 어느 호실을 썼는지가 남아야 하고,
   *   `unit_price` 에는 **얼마짜리를 무상으로 줬는지**가 그대로 있다. 금액 셋만 0 이고
   *   DB CHECK 가 그것을 강제한다(`ck_s080_invoice_lines_free`).
   */
  isFree: boolean('is_free').notNull().default(false),

  /** 월납이면 1, 일시불이면 계약 개월수. */
  quantity: integer('quantity').notNull().default(1),
  /** 단가 = 계약 항목의 월 이용료(부가세 제외). */
  unitPrice: integer('unit_price').notNull().default(0),
  supplyAmount: integer('supply_amount').notNull().default(0),
  vatAmount: integer('vat_amount').notNull().default(0),
  totalAmount: integer('total_amount').notNull().default(0),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
}, (t) => [
  uniqueIndex('tb_s080_invoice_lines_invoice_id_seq_key').on(t.invoiceId, t.seq, t.payItem),
  index('tb_s080_invoice_lines_company_id_idx').on(t.companyId),
]);

/**
 * 수납 — 청구서 1장에 N건.
 *
 * ★★ **확인 절차가 없다.** 레거시에는 `is_confirmed`·`confirmed_by`·`confirmed_at`
 *    세 칸이 있었지만 손입력 경로가 건드리지 않아 늘 false 였고, 합계를 세는 쪽은
 *    확인 여부를 보지도 않았으며, 화면에 확인 버튼도 없었다. 절차 없는 칸은
 *    「확인 안 된 수납이 합계에 섞여 있다」는 오해만 만든다. 그래서 지웠다.
 */
export const payments = pgTable('tb_s080_payments', {
  paymentId: text('payment_id').primaryKey(),
  buildId: text('build_id').notNull(),
  companyId: text('company_id').notNull(),
  invoiceId: text('invoice_id').notNull(),

  /** 입금일. 시각은 쓰지 않는다 — 운영자가 통장을 보고 날짜로 넣는다. */
  paidOn: date('paid_on').notNull(),

  /**
   * ★ **음수를 받는다.** 환불이 음수 수납이다 — 청구서를 고쳐서 맞추지 않고
   *   수납 쪽에 한 줄을 더해 맞춘다. 그래야 얼마를 청구했고 얼마를 돌려줬는지가
   *   둘 다 남는다. 0 은 DB 가 막는다.
   */
  amount: integer('amount').notNull(),

  /** 코드 `PAY_METHOD` — `B` 계좌이체 / `C` 카드 결제. */
  payMethod: varchar('pay_method', { length: 1 }).notNull().default('B'),
  memo: text('memo'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
}, (t) => [
  index('tb_s080_payments_invoice_id_idx').on(t.invoiceId),
  index('tb_s080_payments_company_id_idx').on(t.companyId),
  index('tb_s080_payments_paid_on_idx').on(t.buildId, t.paidOn),
]);

/**
 * 중도해지 정산 원장 — 계약 하나에 **한 줄**.
 *
 * ★ 예치금 반환·순정산금·환수는 임대료 청구가 아니라 청구서에 넣지 않는다. 여기에만 남는다.
 *   실제로 받거나 돌려주는 것은 운영자가 **수납**으로 넣는다(환불은 음수 수납).
 *
 * ★★ 환수 칸이 **둘**인 이유 — 뜻이 다르다. 할인 환수는 깎아 준 것을, 무상 환수는
 *    공짜로 준 것을 되돌린다. 합치면 무상 달이 정확히 기준가가 된다. 한 칸에 합치면
 *    「무상은 얼마였나」를 되짚을 수 없고, 분쟁에서 필요한 것이 그 내역이다.
 */
export const settlements = pgTable('tb_s080_settlements', {
  settlementId: text('settlement_id').primaryKey(),
  buildId: text('build_id').notNull(),
  companyId: text('company_id').notNull(),
  contractId: text('contract_id').notNull(),

  /** 실제로 끝낸 날. */
  terminateDate: date('terminate_date').notNull(),
  /** 정산 시점의 납부방법 스냅샷. 계약이 나중에 바뀌어도 이 줄은 안 흔들린다. */
  paymentMethod: varchar('payment_method', { length: 10 }),

  /** 그 계약에 들어온 수납 합계(정산 직전). */
  totalPaid: integer('total_paid').notNull().default(0),
  /** 예치금 반환액 — 조건 없이 전액이다. */
  depositReturn: integer('deposit_return').notNull().default(0),
  /**
   * 할인 환수 = (기준가 − 계약가) × 실제 사용 기간. **부가세 포함**.
   *
   * ★ 021 에서는 안 만들었다(할인 칸이 없어 늘 0 이었다). 기준가·계약가로 계산할 수
   *   있게 돼서 022 에서 되살렸다.
   */
  discountClawback: integer('discount_clawback').notNull().default(0),
  /** 무상 환수 = 계약가 × (무상 기간 중 실제 사용한 부분). **부가세 포함**. */
  freeClawback: integer('free_clawback').notNull().default(0),
  /** 실이용료 = 온전히 쓴 달 × 월액 + 해지달 일할. */
  usageCharge: integer('usage_charge').notNull().default(0),
  /** 순정산금 — 양수는 환불, 음수는 추가청구. */
  netAmount: integer('net_amount').notNull().default(0),
  /** `refund` 환불 / `charge` 추가청구 / `none` 정산 없음. */
  settleType: varchar('settle_type', { length: 10 }).notNull(),

  memo: text('memo'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: text('created_by'),

  /*
   * ── 처리 기록 — 023 ─────────────────────────────────────────────────────
   * ★★ 이용료 차액만 청구서에 수납으로 들어가고(장마다 남은 금액만큼 · 023 머리말),
   *    예치금 반환·환수까지 **실제로 주고받은 금액**은 여기에만 남는다.
   *    순정산금을 통째로 청구서에 넣으면 청구서 상태와 월별 미수금이 틀어진다.
   */
  /** 처리한 날. `null` 이면 처리 대기. */
  processedOn: date('processed_on'),
  /** 실제 주고받은 금액. 부호는 `netAmount` 와 같다(양수 환불 / 음수 추가청구 받음). */
  processedAmount: integer('processed_amount'),
  /** 코드 `PAY_METHOD` — B 계좌이체 / C 카드. */
  processedMethod: varchar('processed_method', { length: 1 }),
  processedMemo: text('processed_memo'),
  /** 정산 처리가 넣은 수납 중 해지 달 장의 것(대표). 없거나 지웠으면 `null`. */
  processedPaymentId: text('processed_payment_id'),
  processedAt: timestamp('processed_at'),
  processedBy: text('processed_by'),
}, (t) => [
  uniqueIndex('tb_s080_settlements_contract_id_key').on(t.contractId),
  index('tb_s080_settlements_company_id_idx').on(t.companyId),
]);
