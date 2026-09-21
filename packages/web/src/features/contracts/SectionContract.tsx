'use client';

/** @screen s0300200040 계약 폼 · 섹션 2 계약정보 · 020 입주사관리 · 1차 */

/**
 * 섹션 2 — 계약정보. **계약 1건 = 계약 항목 N개 + 계약 조건 1세트**.
 *
 * 원본: design/handoff/prototypes/s0300200040.html 542~640행 · 렌더는 807~955행
 * 명세: design/handoff/tenant-contract/03-contract-form.md 「섹션 2」 · 05-logic.md
 *
 * =============================================================================
 * ★★ 잠금이 실제로 걸리는 곳은 서버다
 * =============================================================================
 * 여기서 입력을 비활성화하는 것은 **편의**다. `confirmed` 이후 섹션 2 를 바꾸려 하면
 * `PATCH /contracts/:id` 가 409 로 거절한다(CONT-09). 화면이 뚫려도 값은 안 바뀐다.
 * 같은 판정을 두 번 쓰지 않으려고 `editableSections()` 의 결과를 prop 으로 받는다.
 *
 * =============================================================================
 * ★★ 금액은 한 줄도 여기서 계산하지 않는다
 * =============================================================================
 * 부가세액·납부액·합계·첫달납부액·종료일은 전부 `form-model.ts` 를 거쳐
 * `@swonbiz/shared/domain/contract-amounts` 가 낸다. 시안의 계산 코드를 베끼면
 * 부가세 끝수(반올림 vs 버림)와 종료일 말일 처리가 서버와 갈린다.
 */
import { useMemo } from 'react';
import { MAX_CONTRACT_SPACES } from '@swonbiz/shared/domain/contract-payload';
import {
  canPickSpace,
  occupancyBySpace,
  spaceOptionLabel,
  type SpaceHolder,
} from '@swonbiz/shared/domain/space-occupancy';
import { Icon } from '@/components/ds';
import styles from './contract-form.module.css';
import {
  comma,
  discountLabel,
  endDateOf,
  firstPaymentOf,
  formatMoneyInput,
  rowAmounts,
  totalsOf,
  toNumber,
  ROW_TEMPLATE,
  type CodeOption,
  type ItemRow,
  type RequiredKey,
  type SpaceOption,
  type TermsState,
} from './form-model';

/** 일시불 — 첫달납부액 산식을 이 값일 때만 보여준다. */
const LUMP_SUM = 'C';

interface Props {
  items: ItemRow[];
  terms: TermsState;
  spaces: readonly SpaceOption[];
  /**
   * 살아 있는 계약(계약중·계약대기)이 붙들고 있는 호실들. 호실 셀렉트가 이것으로 거른다.
   * **자기 계약도 들어 있고**, 빼는 것은 `occupancyBySpace` 가 한다.
   */
  spaceHolders: readonly SpaceHolder[];
  /**
   * 이 편집이 «자기»로 보는 계약들 — 입주 계산에서 뺀다(`selfContractIds`).
   *
   * ★ 신규면 빈 배열이다. ★★ **재계약이면 이전 계약이 들어 있다** — 이전 계약이
   *   살아 있는 채로 같은 호실을 들고 있어서, 빼지 않으면 비상주 호실이 「이미
   *   사용 중」이 되어 자기 이전 계약 때문에 재계약이 막힌다.
   */
  selfContractIds: readonly string[];
  codes: readonly CodeOption[];
  /** 섹션 2 를 수정할 수 있는가. `editableSections()` 이 판정한 값이다. */
  editable: boolean;
  invalid: readonly RequiredKey[];
  onItems: (next: ItemRow[]) => void;
  onTerms: (patch: Partial<TermsState>) => void;
  onStub: (message: string) => void;
  /** 계약호실 확인 팝업(`s0300200040p3`)을 연다. 계약호실은 팝업으로만 넣는다. */
  onOpenRoomPicker: () => void;
}

const codesOf = (codes: readonly CodeOption[], category: string) =>
  codes.filter((c) => c.category === category);

/**
 * 그 건물의 층 목록. 호실 목록에서 뽑고 순서를 그대로 쓴다.
 *
 * ★ 건물 Select 의 onChange 와 화면 렌더가 **같은 순서**를 봐야 한다. 둘이 어긋나면
 *   건물을 바꿨을 때 고른 층과 보이는 층이 달라진다 — 그래서 한 함수로 둔다.
 */
const floorsOf = (spaces: readonly SpaceOption[], buildId: string) =>
  dedupe(spaces.filter((s) => s.buildId === buildId).map((s) => ({ id: s.floorId, name: s.floorName })));

export function SectionContract({
  items,
  terms,
  spaces,
  spaceHolders,
  selfContractIds,
  codes,
  editable,
  invalid,
  onItems,
  onTerms,
  onStub,
  onOpenRoomPicker,
}: Props) {
  const locked = !editable;
  const totals = totalsOf(items);
  const firstPayment = firstPaymentOf(totals, terms.paymentMethod, terms.months);
  const endDate = endDateOf(terms.startDate, terms.months);
  const discount = discountLabel(totals.standardFee, totals.monthlyFee);

  const roomTypes = codesOf(codes, 'ROOM_TP');
  const payMethods = codesOf(codes, 'PAYMENT_METHOD');
  const accessRoutes = codesOf(codes, 'ACCESS_ROUTE');

  // 건물·층은 호실 목록에서 뽑는다 — 따로 조회하지 않는다. 지금은 각각 1개다.
  const buildings = dedupe(spaces.map((s) => ({ id: s.buildId, name: s.buildName })));
  const floors = floorsOf(spaces, terms.buildId);

  /*
   * ★★ 호실별 입주 현황. **자기 계약은 빼고** 센다 — 세면 자기 계약을 열어 그대로
   *    저장할 때 자기 호실이 목록에서 사라지고, 빈 줄로 저장된다.
   *
   * ★ 판정도 문구도 `@swonbiz/shared/domain/space-occupancy` 한 곳이다. 서버가
   *   저장할 때 **같은 함수**로 다시 본다 — 셀렉트에서 사라진 호실이 API 로는
   *   들어가면 막은 의미가 없다.
   */
  const occupancy = useMemo(
    () => occupancyBySpace(spaceHolders, selfContractIds),
    [spaceHolders, selfContractIds],
  );

  const patchRow = (index: number, patch: Partial<ItemRow>) =>
    onItems(items.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /**
   * 호실을 고르면 그 줄의 월회비·예치금·월이용료가 **셋 다** 호실 기준가로 채워진다.
   * 다시 바꾸면 사용자가 고친 값도 덮어쓴다 — 호실이 새 기준선이기 때문이다(05-logic §1).
   *
   * ★ 호실의 `deposit` 은 72건 전부 NULL 이다. 예치금 기본값은 기준가에서 온다.
   */
  const pickSpace = (index: number, spaceId: string) => {
    const space = spaces.find((s) => s.spaceId === spaceId);
    const base = space?.standardFee ?? 0;
    patchRow(index, {
      spaceId,
      standardFee: base,
      deposit: space?.deposit ?? base,
      monthlyFee: base,
    });
  };

  const full = items.length >= MAX_CONTRACT_SPACES;
  const invalidCls = (key: RequiredKey) => (invalid.includes(key) ? ` ${styles.isInvalid}` : '');

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.titleWithBadge}>
          <h2>계약정보</h2>
          {locked ? (
            <span className={styles.lockBadge}>
              <Icon name="lock" size={12} />
              확정됨
            </span>
          ) : null}
        </div>

        {/* 건물·층 Select — confirmed 이후 숨긴다(명세 「섹션 헤더 우측」) */}
        {locked ? null : (
          <div className={styles.inlineRow}>
            <span className={styles.selectWrap} style={{ width: 160 }}>
              <select
                className={styles.select}
                style={{ height: 36 }}
                value={terms.buildId}
                onChange={(e) => {
                  // 건물을 바꾸면 층도 **그 건물의 첫 층**으로 옮긴다. 비워 두면
                  // 층 Select 가 값 없는 상태가 되는데, 「전체 층」을 없앴으므로
                  // 고를 수 없는 빈 칸이 된다.
                  const buildId = e.target.value;
                  onTerms({ buildId, floorId: floorsOf(spaces, buildId)[0]?.id ?? '' });
                }}
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || '(이름 없음)'}
                  </option>
                ))}
              </select>
            </span>
            <span className={styles.selectWrap} style={{ width: 120 }}>
              <select
                className={styles.select}
                style={{ height: 36 }}
                value={terms.floorId}
                onChange={(e) => onTerms({ floorId: e.target.value })}
              >
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name || '(이름 없음)'}
                  </option>
                ))}
              </select>
            </span>
          </div>
        )}
      </div>
      <div className={styles.sectionRule} />

      {locked ? (
        <p className={styles.sectionNote}>
          계약 조건은 확정 후 변경할 수 없습니다. 변경이 필요하면 종료 후 재계약해 주세요.
        </p>
      ) : null}

      {/* ─ 1블록 · 계약 항목 테이블 ─ */}
      <div className={styles.sectionHeader} style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-heading)' }}>계약 항목</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{items.length}건</span>
        </div>
        {locked ? null : (
          <span className={styles.tipWrap}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
              disabled={full}
              onClick={() => onItems([...items, { ...ROW_TEMPLATE }])}
            >
              <Icon name="plus" size={14} />
              항목 추가
            </button>
            <span className={`${styles.tip}${full ? '' : ` ${styles.tipHidden}`}`}>
              최대 {MAX_CONTRACT_SPACES}개까지 등록 가능합니다
            </span>
          </span>
        )}
      </div>

      <div className={`${styles.itemTable}${locked ? ` ${styles.itemTableLocked}` : ''}`}>
        <div className={styles.itemHead}>
          <span>No</span>
          <span>계약구분</span>
          <span>호실</span>
          <span>월회비</span>
          <span>예치금</span>
          <span>월이용료</span>
          <span>계산서</span>
          <span>부가세액</span>
          <span>납부액</span>
          {locked ? null : <span>삭제</span>}
        </div>

        {items.length === 0 ? (
          // 0건이어도 헤더는 남기고 본문 자리만 안내로 채운다 — 열 구성이 보여야 한다.
          <div className={styles.tableEmpty}>
            <span className={styles.tableEmptyIcon}>
              <Icon name="package-open" size={32} />
            </span>
            <p>등록된 계약 항목이 없습니다</p>
          </div>
        ) : (
          items.map((row, i) => {
            const { vatAmount, paymentAmount } = rowAmounts(row);
            const diff = row.standardFee && row.monthlyFee ? row.monthlyFee - row.standardFee : 0;

            if (locked) {
              // 확정 이후에는 같은 테이블을 읽기 전용으로 그린다 — 열 정렬을 유지한다.
              const roomName = spaces.find((s) => s.spaceId === row.spaceId)?.roomName ?? row.spaceId;
              const typeName = roomTypes.find((c) => c.code === row.roomType)?.name ?? row.roomType;
              return (
                <div className={styles.itemRow} key={`${row.spaceId}-${i}`}>
                  <span className={styles.no}>{i + 1}</span>
                  <ReadCell value={typeName} />
                  <ReadCell value={roomName} />
                  <ReadCell value={row.standardFee ? comma(row.standardFee) : ''} right />
                  <ReadCell value={row.deposit ? comma(row.deposit) : ''} right />
                  <ReadCell value={row.monthlyFee ? comma(row.monthlyFee) : ''} right />
                  <span className={`${styles.cell} ${styles.center}`}>
                    <span style={{ color: row.vatYn ? 'var(--color-primary)' : 'var(--text-caption)', display: 'flex' }}>
                      <Icon name={row.vatYn ? 'circle-check' : 'circle'} size={16} />
                    </span>
                  </span>
                  <ReadCell value={comma(vatAmount)} right />
                  <ReadCell value={comma(paymentAmount)} right bold />
                </div>
              );
            }

            /**
             * ★ 다른 줄이 이미 잡은 호실 — 같은 계약 안에서 같은 호실을 두 줄에 넣으면
             *   금액이 두 번 잡히고 어느 줄이 진짜인지 아무도 모른다. 서버도 같은
             *   규칙으로 거절한다(`rejectSpacePick`).
             */
            const pickedElsewhere = new Set(
              items.filter((_, j) => j !== i).map((r) => r.spaceId).filter((id) => id !== ''),
            );

            return (
              <div className={styles.itemRow} key={i}>
                <span className={styles.no}>{i + 1}</span>

                {/* 계약구분 — 코드 ROOM_TP. 같은 구분을 여러 줄에 골라도 된다. */}
                <span className={styles.cell}>
                  <span className={styles.selectWrap}>
                    <select
                      className={styles.select}
                      value={row.roomType}
                      onChange={(e) => {
                        // 계약구분을 바꾸면 호실 목록이 바뀐다 — 지금 고른 호실이 그 구분이
                        // 아니면 비운다. 남겨 두면 목록에 없는 값이 선택된 채로 저장된다.
                        const keep = spaces.find((s) => s.spaceId === row.spaceId)?.roomType === e.target.value;
                        patchRow(i, keep ? { roomType: e.target.value } : { ...BLANK_ROW, roomType: e.target.value });
                      }}
                    >
                      <option value="">선택</option>
                      {roomTypes.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </span>

                {/*
                  호실 — ★ 표시는 room_name, 값은 space_id. 계약구분·건물·층으로 거르고,
                  그 위에 **입주 현황**으로 한 번 더 거른다:
                    비상주(VR)  아무도 없는 호실만
                    그 외        1곳까지. 그때는 「Room 1 (에스원3DP)」로 누가 쓰는지 보여준다
                */}
                <span className={styles.cell}>
                  <span className={styles.selectWrap}>
                    <select
                      className={styles.select}
                      value={row.spaceId}
                      onChange={(e) => pickSpace(i, e.target.value)}
                    >
                      <option value="">선택</option>
                      {spaces
                        .filter((s) => (row.roomType ? s.roomType === row.roomType : true))
                        .filter((s) => (terms.buildId ? s.buildId === terms.buildId : true))
                        .filter((s) => (terms.floorId ? s.floorId === terms.floorId : true))
                        .filter(
                          (s) =>
                            // ★ **지금 이 줄이 고른 호실은 언제나 남긴다.** 목록에서 빠지면
                            //   셀렉트가 빈 줄이 되고 값이 조용히 사라진다 — 규칙이 생기기
                            //   전에 저장된 계약에서 실제로 걸리는 자리다. 그대로 저장하면
                            //   서버가 이유를 말하며 거절한다.
                            s.spaceId === row.spaceId ||
                            canPickSpace({
                              roomType: row.roomType,
                              occupancy: occupancy.get(s.spaceId),
                              pickedElsewhere: pickedElsewhere.has(s.spaceId),
                            }),
                        )
                        .map((s) => (
                          <option key={s.spaceId} value={s.spaceId}>
                            {spaceOptionLabel(s.roomName, occupancy.get(s.spaceId))}
                          </option>
                        ))}
                    </select>
                  </span>
                </span>

                {/* 월회비 — 호실 기준가. 읽기 전용이다. */}
                <span className={styles.cell}>
                  <input
                    className={`${styles.input} ${styles.inputMoney}`}
                    readOnly
                    value={row.standardFee ? comma(row.standardFee) : ''}
                  />
                </span>

                <MoneyCell value={row.deposit} onChange={(n) => patchRow(i, { deposit: n })} />

                <span className={styles.cell}>
                  <input
                    className={`${styles.input} ${styles.inputMoney}`}
                    inputMode="numeric"
                    value={row.monthlyFee ? comma(row.monthlyFee) : ''}
                    onChange={(e) => patchRow(i, { monthlyFee: toNumber(formatMoneyInput(e.currentTarget)) })}
                  />
                  {diff ? (
                    <span className={styles.diff}>
                      {diff > 0 ? '+' : '-'}
                      {comma(Math.abs(diff))}
                    </span>
                  ) : null}
                </span>

                {/* 계산서 — 부가세 대상 여부다. 기본 체크. */}
                <span className={`${styles.cell} ${styles.center}`}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={row.vatYn}
                    onChange={(e) => patchRow(i, { vatYn: e.target.checked })}
                  />
                </span>

                <span className={styles.cell}>
                  <input className={`${styles.input} ${styles.inputMoney}`} readOnly value={comma(vatAmount)} />
                </span>
                <span className={styles.cell}>
                  <input
                    className={`${styles.input} ${styles.inputMoney}`}
                    readOnly
                    style={{ fontWeight: 700 }}
                    value={comma(paymentAmount)}
                  />
                </span>

                <span className={`${styles.cell} ${styles.center}`}>
                  <button
                    type="button"
                    className={styles.trash}
                    aria-label="삭제"
                    disabled={items.length < 2}
                    onClick={() => onItems(items.filter((_, k) => k !== i))}
                  >
                    <Icon name="trash-2" size={16} />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* ─ 2블록 · 금액 합계 ─ 각 줄의 합이다. 합계에 0.1 을 곱하지 않는다 ─ */}
      <div className={styles.summaryBar}>
        <div>
          <div className={styles.summaryKey}>예치금 합계</div>
          <div className={styles.summaryValue}>{comma(totals.deposit)}</div>
        </div>
        <div>
          <div className={styles.summaryKey}>월회비 합계</div>
          <div className={styles.summaryValue}>{comma(totals.standardFee)}</div>
        </div>
        <div>
          <div className={styles.summaryKey}>월이용료 합계</div>
          <div className={styles.summaryValue}>{comma(totals.monthlyFee)}</div>
          {discount ? <div className={styles.discount}>{discount}</div> : null}
        </div>
        <div>
          <div className={styles.summaryKey}>부가세액 합계</div>
          <div className={styles.summaryValue}>{comma(totals.vatAmount)}</div>
        </div>
        <div>
          <div className={styles.summaryKey}>월납부액 합계</div>
          <div className={`${styles.summaryValue} ${styles.summaryAccent}`}>{comma(totals.monthlyPayment)}</div>
        </div>
      </div>

      {/* ─ 3블록 · 계약 조건 ─ 전부 계약당 1개 값 ─ */}
      <div className={styles.grid4} style={{ marginTop: 18 }}>
        <div className={styles.field}>
          <span className={styles.label}>계약호실</span>
          <div className={styles.inlineRow}>
            {/*
              국세청 신고용 대표 호실. 계약당 1개다.

              ★★ **읽기 전용이다. 팝업으로만 넣는다**(`s0300200040p3`).
                 직접 타이핑을 열어 두면 중복 판정을 거치지 않은 번호가 들어온다 —
                 이 번호는 세무서에 내는 번호라 겹치면 밖에서 사고가 난다.
                 명세도 「ReadOnly + 조회 아이콘」이다(`03-contract-form.md` 섹션 2).
            */}
            <input
              className={`${styles.input} ${styles.flex1}`}
              value={terms.contractRoom}
              readOnly
              placeholder="조회 버튼으로 선택"
              onClick={locked ? undefined : onOpenRoomPicker}
              style={locked ? undefined : { cursor: 'pointer' }}
            />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              aria-label="계약호실 확인"
              style={{ width: 44, height: 44, padding: 0 }}
              disabled={locked}
              onClick={onOpenRoomPicker}
            >
              <Icon name="search" size={16} />
            </button>
          </div>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>
            납부방법 <span className={styles.req}>*</span>
          </span>
          <span className={styles.selectWrap}>
            <select
              className={styles.select}
              value={terms.paymentMethod}
              disabled={locked}
              onChange={(e) => onTerms({ paymentMethod: e.target.value })}
            >
              <option value="">선택</option>
              {payMethods.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </label>

        <div className={`${styles.field} ${styles.firstPay}`}>
          <span className={styles.label}>첫달납부액</span>
          <input
            className={`${styles.input} ${styles.inputMoney}`}
            readOnly
            value={firstPayment === null ? '' : comma(firstPayment)}
          />
          {terms.paymentMethod === LUMP_SUM && toNumber(terms.months) > 0 && totals.monthlyPayment > 0 ? (
            <span className={styles.formula}>
              예치금 + {toNumber(terms.months)}개월 × {comma(totals.monthlyPayment)}원
            </span>
          ) : null}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>접근경로</span>
          <span className={styles.selectWrap}>
            <select
              className={styles.select}
              value={terms.accessRoute}
              disabled={locked}
              onChange={(e) => onTerms({ accessRoute: e.target.value })}
            >
              <option value="">선택</option>
              {accessRoutes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            계약일자 <span className={styles.req}>*</span>
          </span>
          <input
            type="date"
            className={`${styles.input}${invalidCls('contractDate')}`}
            value={terms.contractDate}
            disabled={locked}
            onChange={(e) => onTerms({ contractDate: e.target.value })}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>
            기간(월) <span className={styles.req}>*</span>
          </span>
          <span className={styles.suffixWrap}>
            <input
              className={`${styles.input} ${styles.inputMoney}${invalidCls('months')}`}
              inputMode="numeric"
              style={{ paddingRight: 44 }}
              value={terms.months}
              disabled={locked}
              // 숫자 3자리까지만 받는다(명세 05-logic §5).
              onChange={(e) => onTerms({ months: e.target.value.replace(/\D/g, '').slice(0, 3) })}
            />
            <span className={styles.suffix}>개월</span>
          </span>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>
            시작일 <span className={styles.req}>*</span>
          </span>
          <input
            type="date"
            className={`${styles.input}${invalidCls('startDate')}`}
            value={terms.startDate}
            disabled={locked}
            onChange={(e) => onTerms({ startDate: e.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>종료일</span>
          {/* ★ 시작일 + 기간 − 1일. 말일 처리는 shared 안에 있다. */}
          <input className={`${styles.input} ${styles.tabular}`} readOnly value={endDate} />
        </label>

        <label className={`${styles.field} ${styles.span4}`}>
          <span className={styles.label}>특기사항</span>
          <span className={styles.hint}>할인이 있으면 첫 줄에 자동 기재됩니다</span>
          <textarea
            className={styles.textarea}
            rows={2}
            value={terms.memo}
            disabled={locked}
            onChange={(e) => onTerms({ memo: e.target.value })}
          />
        </label>
      </div>
    </section>
  );
}

/** 새 줄·호실을 비울 때 쓰는 빈 값. 계약구분은 호출하는 쪽이 정한다. */
const BLANK_ROW = { spaceId: '', standardFee: 0, deposit: 0, monthlyFee: 0 } as const;

function ReadCell({ value, right, bold }: { value: string; right?: boolean; bold?: boolean }) {
  return (
    <span className={styles.cell}>
      <span
        className={`${styles.roText}${right ? ` ${styles.roTextRight}` : ''}${bold ? ` ${styles.pay}` : ''}`}
      >
        {value || '—'}
      </span>
    </span>
  );
}

/**
 * 금액 입력 한 칸.
 *
 * ★ 값이 0 이면 빈 칸을 그린다. `comma(0)` = "0" 을 그리면 지우자마자 0 이 다시 들어와
 *   지울 수 없는 칸이 된다.
 */
function MoneyCell({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className={styles.cell}>
      <input
        className={`${styles.input} ${styles.inputMoney}`}
        inputMode="numeric"
        value={value ? comma(value) : ''}
        onChange={(e) => onChange(toNumber(formatMoneyInput(e.currentTarget)))}
      />
    </span>
  );
}

function dedupe(list: readonly { id: string; name: string }[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}
