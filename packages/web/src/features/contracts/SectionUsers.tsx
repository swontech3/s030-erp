'use client';

/** @screen s0300200040 계약 폼 · 섹션 3 입주자 사용자 정보 · 020 입주사관리 · 1차 */

/**
 * 섹션 3 — 입주자 사용자 정보. **계약 항목과 연동하지 않는다.**
 *
 * 원본: design/handoff/prototypes/s0300200040.html 642~666행 · 렌더는 1041~1135행
 * 명세: design/handoff/tenant-contract/03-contract-form.md 「섹션 3」
 *
 * ★ 1행은 섹션 1 의 대표자·연락처·이메일을 **실시간 미러링**한다(비고만 입력 가능).
 *   그래서 1행은 값을 갖지 않고 `company` 에서 파생시킨다 — 복사해 두면 섹션 1 을
 *   고칠 때 둘이 갈린다.
 *
 * ★ 명세의 「행을 다시 그릴 때 2행 이후 입력값을 캐시했다가 복원하세요」는 DOM 을 직접
 *   다시 그리는 시안의 사정이다. 여기서는 값이 React 상태에 있어 다시 그려도 사라지지 않는다.
 *
 * ★ 미체크 행은 **입력값을 유지**하고 저장 때만 뺀다. 지우지 않는다.
 */
import { Icon } from '@/components/ds';
import styles from './contract-form.module.css';
import {
  DOMAIN_CUSTOM,
  DOMAIN_PLACEHOLDER,
  MAX_USERS,
  NOT_SAVEABLE_BADGE,
  NOT_SAVEABLE_NOTICE,
  USER_TEMPLATE,
  currentDomain,
  maskInput,
  type CompanyState,
  type UserRow,
} from './form-model';

interface Props {
  users: UserRow[];
  company: CompanyState;
  /** `terminated`·`cancelled` — 전 섹션 읽기 전용. */
  frozen: boolean;
  /** ★ 저장 경로가 없어 잠근 상태인가. */
  notSaveable: boolean;
  /** 도메인 Select 목록. 코드 테이블에서 온다(016). */
  emailDomains: readonly string[];
  onUsers: (next: UserRow[]) => void;
}

export function SectionUsers({
  users,
  company,
  frozen: ended,
  notSaveable,
  emailDomains,
  onUsers,
}: Props) {
  // ★ 저장할 곳이 없으면 입력도 받지 않는다 — 받으면 «저장된다»로 읽힌다.
  const frozen = ended || notSaveable;
  const full = users.length >= MAX_USERS;
  const patch = (index: number, p: Partial<UserRow>) =>
    onUsers(users.map((u, i) => (i === index ? { ...u, ...p } : u)));

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.titleWithBadge}>
          <h2>입주자 사용자 정보</h2>
          {notSaveable ? (
            <span className={styles.lockBadge}>
              <Icon name="lock" size={12} />
              {NOT_SAVEABLE_BADGE}
            </span>
          ) : null}
        </div>
        <span className={styles.sectionCount}>{users.length}명 등록</span>
      </div>
      <div className={styles.sectionRule} />
      {notSaveable ? <p className={styles.sectionNote}>{NOT_SAVEABLE_NOTICE}</p> : null}

      <div className={styles.userHead}>
        <span>
          {/* 전체 선택 — 1행은 제외한다(해제할 수 없는 행이다) */}
          <input
            type="checkbox"
            className={styles.checkbox}
            disabled={frozen || users.length < 2}
            checked={users.length > 1 && users.slice(1).every((u) => u.selected)}
            onChange={(e) => onUsers(users.map((u, i) => (i === 0 ? u : { ...u, selected: e.target.checked })))}
          />
        </span>
        <span>No</span>
        <span className={styles.pad}>성명</span>
        <span className={styles.pad}>연락처</span>
        <span className={styles.pad}>이메일</span>
        <span>대표자</span>
        <span className={styles.pad}>비고</span>
        <span>삭제</span>
      </div>

      {users.length === 0 ? (
        <div className={styles.tableEmpty}>
          <span className={styles.tableEmptyIcon}>
            <Icon name="users" size={32} />
          </span>
          <p>등록된 사용자가 없습니다</p>
        </div>
      ) : (
        users.map((user, i) => {
          const first = i === 0;
          const on = first ? true : user.selected;
          const readOnly = first || frozen;

          return (
            <div className={`${styles.userRow}${on ? '' : ` ${styles.userRowOff}`}`} key={i}>
              <span className={`${styles.cell} ${styles.center}`}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={on}
                  disabled={first || frozen}
                  onChange={(e) => patch(i, { selected: e.target.checked })}
                />
              </span>
              <span className={styles.no}>{i + 1}</span>

              <span className={styles.cell}>
                <input
                  className={styles.input}
                  readOnly={readOnly}
                  style={readOnly ? { background: 'var(--surface-alt)' } : undefined}
                  value={first ? company.ceo : user.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
              </span>

              <span className={styles.cell}>
                <input
                  className={`${styles.input} ${styles.tabular}`}
                  placeholder="010-0000-0000"
                  readOnly={readOnly}
                  style={readOnly ? { background: 'var(--surface-alt)' } : undefined}
                  value={first ? company.phone : user.phone}
                  onChange={(e) => patch(i, { phone: maskInput(e.currentTarget, 'phone') })}
                />
              </span>

              <span className={styles.mail}>
                <input
                  className={`${styles.input} ${styles.flex1}`}
                  readOnly={readOnly}
                  style={readOnly ? { background: 'var(--surface-alt)' } : undefined}
                  value={first ? company.emailId : user.mailId}
                  // 섹션 1 과 같은 마스크다 — 같은 종류의 칸이 서로 다르게 굴면 안 된다.
                  onChange={(e) => patch(i, { mailId: maskInput(e.currentTarget, 'emailId') })}
                />
                <span className={styles.mailAt}>@</span>
                {first ? (
                  // 1행의 도메인도 섹션 1 을 따라간다 — Select 가 아니라 읽기 전용 표시다.
                  // ★ 폭은 `.mailFixed` 가 정한다. 2행 이후의 Select 와 **같은 값**이어야
                  //   1행과 나머지 행이 나란히 보인다.
                  <input
                    className={`${styles.input} ${styles.mailFixed}`}
                    readOnly
                    style={{ background: 'var(--surface-alt)' }}
                    value={currentDomain(company)}
                  />
                ) : (
                  <>
                    {/* ★ Select 를 숨기지 않는다. 직접입력 칸의 표시 여부를 매 렌더마다
                        Select 값에서 파생시킨다 — 숨기면 직접입력에서 되돌아올 수 없다.
                        섹션 1 과 같은 구조다. */}
                    <span className={`${styles.selectWrap} ${styles.mailDomain}`}>
                      <select
                        className={styles.select}
                        value={user.domain}
                        disabled={frozen}
                        onChange={(e) => patch(i, { domain: e.target.value })}
                      >
                        {/* placeholder·직접입력은 코드가 아니라 Select 의 조작 장치다 */}
                        <option value="">{DOMAIN_PLACEHOLDER}</option>
                        {emailDomains.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                        {/* 「직접입력」은 목록 맨 뒤 — 옵트인이다 */}
                        <option value={DOMAIN_CUSTOM}>직접입력</option>
                      </select>
                    </span>
                    {user.domain === DOMAIN_CUSTOM ? (
                      <input
                        className={`${styles.input} ${styles.mailFixed}`}
                        placeholder="직접입력"
                        value={user.domainCustom}
                        disabled={frozen}
                        onChange={(e) => patch(i, { domainCustom: e.target.value })}
                      />
                    ) : null}
                  </>
                )}
              </span>

              <span className={`${styles.cell} ${styles.center}`}>
                {/*
                  ★★ **대표자는 1행 고정이다. 고를 수 없다.**
                  1행은 섹션 1 「대표자」를 미러링하는 자리라, 회사의 대표자가 곧 이 행이다.
                  명세도 「1행 … 대표자 체크 고정」이라고 적고 있다
                  (`03-contract-form.md` 섹션 3 「1행 — 자동 채움 + ReadOnly」).

                  그래서 **모든 행이 비활성**이다. 1행만 잠그고 2행 이후를 열어 두면
                  2행을 체크하는 순간 1행이 풀려 「고정」이 깨진다 — 라디오처럼 동작하기
                  때문이다. 대표자를 바꾸려면 섹션 1 의 대표자를 바꾼다.
                */}
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={first}
                  disabled
                  readOnly
                  aria-label={first ? '대표자 (섹션 1 에서 정해진다)' : '대표자 아님'}
                />
              </span>

              <span className={styles.cell}>
                <input
                  className={styles.input}
                  readOnly={frozen}
                  value={user.memo}
                  onChange={(e) => patch(i, { memo: e.target.value })}
                />
              </span>

              <span className={`${styles.cell} ${styles.center}`}>
                <button
                  type="button"
                  className={styles.trash}
                  aria-label="삭제"
                  disabled={first || frozen}
                  // 대표자는 1행 고정이고 1행은 지울 수 없으므로(`disabled={first}`),
                  // 지운 뒤 대표자를 되돌리는 처리가 필요 없다.
                  onClick={() => onUsers(users.filter((_, k) => k !== i))}
                >
                  <Icon name="trash-2" size={16} />
                </button>
              </span>
            </div>
          );
        })
      )}

      <span className={`${styles.tipWrap} ${styles.tipWrapBlock}`}>
        <button
          type="button"
          className={styles.addRow}
          disabled={frozen || full}
          onClick={() => onUsers([...users, { ...USER_TEMPLATE }])}
        >
          <Icon name="plus" size={16} />
          사용자 추가
        </button>
        <span className={`${styles.tip}${full ? '' : ` ${styles.tipHidden}`}`}>
          최대 {MAX_USERS}명까지 등록 가능합니다
        </span>
      </span>
    </section>
  );
}
