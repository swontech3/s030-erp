/**
 * 계약 스키마 — 페이즈 4.
 *
 * 정본은 `doc/CONTRACT_DATA_MODEL.md` 다. 이 파일과 어긋나면 그 문서를 따른다.
 *
 * =============================================================================
 * ★ 구조의 핵심 — 계약 1건에 호실 N행
 * =============================================================================
 * 레거시는 `tb_s080_contracts.space_id` 단일 NOT NULL 이었다. 계약 1건 = 호실 1개다.
 * 새 설계는 계약 1건에 **계약 항목 최대 10개**가 붙고 항목마다 계약구분·호실·금액이
 * 따로 있다. 그래서 `space_id` 를 없애고 `tb_s080_contract_spaces` 로 뺐다.
 *
 * **`space_id` 를 계약에 남겨 두지 않는다.** 남기면 호실이 두 경로로 붙어
 * 어느 쪽이 맞는지 다투게 된다.
 *
 * =============================================================================
 * ★ 금액은 계약에 복사해 박는다 — 호실을 참조하지 않는다
 * =============================================================================
 * 호실의 `standard_fee` 를 나중에 올려도 과거 계약 금액이 바뀌면 안 된다.
 * 이미 발행한 세금계산서와 어긋난다. 호실 값은 **입력을 편하게 해주는 기본값**일
 * 뿐이고, 계약 저장 시점의 값이 계약에 남는다.
 *
 * 실제로 위험하다 — 지금 72실의 `standard_fee` 는 타입별로 한 값으로 통일돼 있어
 * 기준가를 한 번 고치면 그 타입의 과거 계약이 전부 따라 움직인다.
 *
 * =============================================================================
 * ★ 부가세는 서버가 다시 계산한다
 * =============================================================================
 * `vat_amount` · `payment_amount` 는 화면 값을 그대로 저장하지 않는다.
 * 서버가 `monthly_fee` 로부터 `floor(monthly_fee × 0.1)` 로 다시 계산한 값이다.
 * 세금계산서가 걸려 있다.
 *
 * ★ 지금 시안(s0300200040.html 708행)은 `Math.round` 를 쓴다. 서버 규칙은 `floor` 다.
 *   금액이 만원 단위면 결과가 같아 지금은 안 드러나지만, 할인이 들어가면 갈린다.
 *   프런트에 `floor` 로 맞춰 달라고 요청해 둔 상태다(doc/DESIGN_REVIEW_1.md).
 *   그때까지는 값이 어긋나면 **서버 값을 쓰고 경고를 남긴다.**
 */
import {
  boolean, date, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';

/**
 * 계약 상태 — 되돌리는 전이는 없다. 조건을 바꾸려면 종료 후 재계약이다.
 *
 * ★ 정의는 `@swonbiz/shared/domain/contract-status` 에 있다. 여기서는 다시 내보내기만
 *   한다 — 상태 어휘가 두 벌이 되면 전이 규칙과 스키마가 조용히 어긋난다.
 *   화면도 같은 상수를 본다.
 */
export { CONTRACT_STATUS, type ContractStatus } from '@swonbiz/shared/domain/contract-status';

/**
 * 계약 1건 = 계약 조건 1세트.
 *
 * ★ 기존 테이블을 재정의한 것이다. 새 계보(`_v2`)를 만들지 않았다 —
 *   007 에서 데이터를 비우고 008 에서 구조를 바꿨다.
 */
export const contracts = pgTable('tb_s080_contracts', {
  contractId: text('contract_id').primaryKey(),

  /** 건물. 코드 테이블도 이 축으로 묶인다. */
  buildId: text('build_id').notNull(),
  /** ★ 격리축. RLS 정책이 이 컬럼 하나만 본다 — 조인 없이 판단할 수 있어야 한다. */
  companyId: text('company_id').notNull(),

  contractNo: text('contract_no'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),

  /** 세무서 제출 호실번호. 계약당 1개다(시안 516행 「전부 계약당 1개 값」). */
  contractRoom: text('contract_room'),
  /** 코드 `PAYMENT_METHOD` — M 월납 / C 일시불. */
  paymentMethod: varchar('payment_method', { length: 10 }),
  /** 코드 `ACCESS_ROUTE`. */
  accessRoute: varchar('access_route', { length: 10 }),

  /** 첫달납부액 — 서버 계산. 월납: 예치금합 + 월납부액합 / 일시불: 예치금합 + 월납부액합 × 기간 */
  firstPayment: integer('first_payment').notNull().default(0),

  contractDate: date('contract_date'),
  periodMonths: smallint('period_months'),
  startDate: timestamp('start_date', { mode: 'date' }).notNull(),
  /** 시작일 + 기간(월) − 1일. */
  endDate: timestamp('end_date', { mode: 'date' }).notNull(),

  /** 청구 생성 기준일. `contract-invoices.ts` 가 읽는다. */
  billingDay: integer('billing_day').notNull().default(1),

  terminatedDate: timestamp('terminated_date', { mode: 'date' }),
  terminationReason: text('termination_reason'),
  /** 특기사항 — 할인이 있으면 첫 줄에 자동 기재된다(시안 551행). */
  memo: text('memo'),

  // ── 001 이 넣은 CSCH-01~04. 요구사항이라 유지한다 ──────────────────────────
  /** CSCH-01 무상기간 — 청구 시작일. NULL 이면 `start_date` 부터 청구. */
  billingStartDate: date('billing_start_date'),
  /** CSCH-02 보증금 반환 상태. H 보유 / R 반환 / D 차감 / P 일부차감.
   *  ★ 금액은 이제 `contract_spaces.deposit` 의 합이다 — 계약의 `deposit` 은 드롭했다. */
  depositReturnStatus: varchar('deposit_return_status', { length: 1 }),
  /** CSCH-03 계약 시점 사업자정보 스냅샷(세금계산서 법적 요건). */
  bizInfoSnapshot: jsonb('biz_info_snapshot'),
  /** CSCH-04 재계약 이력 — 이 계약이 어느 계약을 갱신한 것인지. */
  renewedFromContractId: text('renewed_from_contract_id'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  /**
   * ★★ **DB 에는 기본값이 없다.** 이 선언과 실제 테이블이 어긋나 있다.
   *
   * `tb_s080_contracts` 는 레거시가 만든 테이블이고, Prisma 의 `@updatedAt` 이 늘 값을
   * 넣어 줘서 DB 기본값이 붙은 적이 없다. `created_at` 에는 `CURRENT_TIMESTAMP` 가
   * 있는데 `updated_at` 에만 없다(2026-09-17 실측). 같은 상태인 레거시 테이블이
   * **28개**다 — 우리가 만든 `tb_s080_contract_spaces` 만 예외다.
   *
   * 그래서 이 컬럼을 빼고 INSERT 하면 `23502 not-null violation` 이 난다.
   * **쓰는 쪽이 항상 값을 넣어야 한다.** 이 줄의 `.defaultNow()` 는 drizzle 이
   * DDL 을 만들 때만 쓰는 선언이지, 이미 있는 테이블을 바꾸지 않는다.
   */
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
}, (t) => [
  index('tb_s080_contracts_company_id_idx').on(t.companyId),
  index('tb_s080_contracts_status_end_date_idx').on(t.status, t.endDate),
]);

/**
 * 계약 항목 — 계약 1건에 N행(최대 10). 호실이 여기 붙는다.
 *
 * ★ `company_id` 를 둔 이유 — 계약을 통해 입주사가 정해지므로 논리적으로는 없어도
 *   된다. 그래도 둔다. **RLS 정책을 조인 없이 세울 수 있어야 하기 때문**이다.
 *   조인이 필요한 정책은 느리고, 무엇보다 읽고 맞는지 판단하기 어렵다.
 *   방어 장치는 읽어서 바로 이해되는 편이 낫다.
 *
 *   대신 두 `company_id` 가 어긋나면 한 계약 안에 다른 회사의 호실 줄이 섞인다.
 *   복합 FK `(contract_id, company_id) → contracts(contract_id, company_id)` 로 막는다
 *   — 008 마이그레이션 참조.
 */
export const contractSpaces = pgTable('tb_s080_contract_spaces', {
  contractSpaceId: text('contract_space_id').primaryKey(),
  contractId: text('contract_id').notNull(),
  /** ★ RLS 격리축. 계약의 `company_id` 와 반드시 같다(복합 FK 가 강제). */
  companyId: text('company_id').notNull(),

  /** No — 표시 순서. */
  seq: smallint('seq').notNull(),

  /** 코드 `ROOM_TP` — R1 1인실 / R2 2인실 / R3 팀오피스 / FI 고정석 / FR 자유석 / VR 비상주 / ET 기타.
   *  ★ 같은 구분을 여러 행에 중복해 쓸 수 있다. */
  roomType: varchar('room_type', { length: 10 }).notNull(),
  /** 호실. ★ 화면 표시는 `room_name`, 저장은 `space_id` 다. `room_no`(해시)를 쓰지 않는다. */
  spaceId: text('space_id').notNull(),

  /** 월회비 — 호실 `standard_fee` 를 복사해 박는다. 화면에서는 표시 전용.
   *  ★ 저장하는 이유: 남기지 않으면 "그때 기준가가 얼마였는데 얼마에 해줬다"를
   *    나중에 알 수 없다. 할인율이 사후에 계산 불가능해진다. */
  standardFee: integer('standard_fee').notNull().default(0),
  /** 예치금 — 호실 값을 기본값으로 채우고 수정 가능.
   *  ★ 지금 `tb_s080_spaces.deposit` 은 72건 전부 NULL 이라 자동 입력할 원본이 없다. */
  deposit: integer('deposit').notNull().default(0),
  /** 월이용료 — 할인 반영 실제 금액. **부가세 제외**. */
  monthlyFee: integer('monthly_fee').notNull().default(0),

  /**
   * ★ 부가세 대상 여부. **`invoice_yn` 이 아니다.**
   *
   * 세금계산서는 **계약 1건에 한 장** 나간다. 호실별로 쪼개지지 않는다.
   * 이 칸은 그 호실에 부가세를 매길지를 정하는 스위치다.
   * `invoice_yn` 으로 두면 나중에 누가 "이 호실만 계산서 따로"로 읽는다.
   * (시안의 내부 키가 `item.invoice` 이고 열 제목이 「계산서」라 오해를 부른다.)
   */
  vatYn: boolean('vat_yn').notNull().default(true),
  /** 부가세액 — 서버 계산 `floor(monthly_fee × 0.1)`. `vat_yn` 이 false 면 0. */
  vatAmount: integer('vat_amount').notNull().default(0),
  /** 납부액 — 서버 계산 `monthly_fee + vat_amount`. */
  paymentAmount: integer('payment_amount').notNull().default(0),

  /** 사물함번호 — 고정석·자유석만. ★ 시안에 없어 미확정이라 NULL 허용이다. */
  lockerNo: varchar('locker_no', { length: 30 }),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
}, (t) => [
  uniqueIndex('tb_s080_contract_spaces_contract_id_seq_key').on(t.contractId, t.seq),
  index('tb_s080_contract_spaces_company_id_idx').on(t.companyId),
  index('tb_s080_contract_spaces_space_id_idx').on(t.spaceId),
]);
