'use client';

/** @screen s0300200030p2 계약 등록 — 신규 입주사 모드 · 020 입주사관리 · 1차 */

/**
 * 신규 입주사 등록 모달 — **골격이다**(3-1). 시각 규격만 3-1b 에서 새 원본에 맞췄다.
 *
 * =============================================================================
 * ★★★ 이 화면은 새 디자인 원본에 없다 — 읽고 시작할 것
 * =============================================================================
 * 새 원본 `design/handoff/tenant-contract/02-master-detail.md` 마지막 문단:
 *
 *   "계약 등록 모달(new-tenant / new-contract / renew)은 **제거되었습니다.**
 *    같은 기능을 모달과 페이지 두 곳에서 관리하면 계속 어긋나므로
 *    계약 폼 페이지로 일원화했습니다."
 *
 * 회사·대표 입력 항목은 계약 폼(s0300200040) 섹션 1 로 이사했고 그 화면은 페이즈 4 다.
 * **그래서 이 모달은 지금 대체 화면이 없다.** 지우면 입주사를 등록할 방법이 사라진다.
 *
 * ★★ 결정 (2026-09-13) — **페이즈 4 에서 걷어낸다.** 지금은 남긴다.
 *    계약 폼이 만들어지는 페이즈 4 에서 이 모달을 제거하고 `[+ 신규 입주사 등록]` 을
 *    계약 폼(mode: create)으로 연결한다. `.planning/ROADMAP.md` 페이즈 4 작업 15 번에
 *    적어 두었다 — 거기 없으면 이 임시 진입점이 그대로 남는다.
 *    그때까지 3-2~3-5(삐용 포트·Mock 어댑터·실호출)가 이 화면에 붙는다.
 *
 * 3-1b/3-1c 에서 **섹션·항목 구성은 손대지 않았다** — 맞출 원본이 없기 때문이다.
 * 고친 것은 (1) 국가 칸 제거 (2) 라벨·설명 규격 (3) 대표자 칸 단일화뿐이다.
 *
 * 옛 원본: design/erp-master-detail/ErpMasterDetail.dc.html 216~275행 (modal="new-tenant").
 * 새 원본: design/handoff/  ← 시각 기준은 이제 이쪽이다
 *
 * ERP 에 회사 등록 화면·직원 등록 화면을 따로 두지 않는다. 운영사가 신규 계약을
 * 등록하는 이 자리에서 회사와 대표를 함께 만든다 — 그래서 이 팝업이 회사·대표
 * 등록의 **유일한 진입점**이다.
 *
 * 원본의 3모드(new-tenant / new-contract / renew) 중 **신규 입주사만** 채운다.
 * 나머지 둘은 계약 데이터가 있어야 열리는 모드라 여는 버튼조차 아직 없다(페이즈 4).
 *
 * =============================================================================
 * ★★ 이 화면이 하지 않는 것
 * =============================================================================
 * - **저장하지 않는다.** 삐용 호출도 ERP DB 쓰기도 없다. 등록 버튼은 비활성이다
 * - **단체코드(orgCode)를 다루지 않는다.** 입력란도 안내 문구도 없다 — 운영자가
 *   정하는 값이 아니다. ERP 가 Z01 부터 자동 발급하며 그 규칙은 3-2 에서 만든다
 * - **비밀번호를 다루지 않는다.** ERP 는 계정을 발급하지 않는다
 * - **국가(countryCode)를 다루지 않는다.** 항상 KR 이다 — 운영자가 볼 이유가 없다.
 *   3-1 에는 입력란이 있었고 3-1b 에서 뺐다
 *
 * 입력 항목은 한 군데서 온다 — `@swonbiz/shared` 의 tenant-registration.ts.
 * 항목마다 삐용에 보내는 값인지 ERP 만 보관하는 값인지(`sink`)가 거기 적혀 있다.
 */
import { useEffect } from 'react';
import {
  COMPANY_FIELDS,
  OWNER_FIELDS,
  REGISTRATION_DONE_NOTICE,
  SELECTABLE_MODULES,
  onScreenFields,
  type RegistrationField,
} from '@swonbiz/shared';
import { Icon } from '@/components/ds';
import styles from './new-tenant-modal.module.css';

/** 한 줄을 다 쓰는 항목. 짧은 값 옆에 두면 입력란이 우스꽝스럽게 짧아진다. */
const FULL_WIDTH = new Set(['address', 'detailAddress', 'taxEmail']);

const PLACEHOLDERS: Record<string, string> = {
  // 원본 236행이 쓰던 값 그대로.
  orgName: '주식회사 오피스테크',
  bizNumber: '000-00-00000',
  memberName: '홍길동',
  // 원본에 없는 항목은 자리 표시를 비워 둔다 — 예시를 지어내지 않는다.
  telNo: '02-0000-0000',
  hpNo: '010-0000-0000',
  email: 'name@company.com',
  taxEmail: 'name@company.com',
};

function Field({ name, field }: { name: string; field: RegistrationField }) {
  return (
    <label className={`${styles.field} ${FULL_WIDTH.has(name) ? styles.wide : ''}`}>
      {/*
        라벨 규격은 새 핸드오프(common/05-patterns.md#3 · 03-components.md Input)를 따른다 —
        14px/600 --text-heading, 필수 별표는 --color-danger. 05-patterns 는 "화면별 문서보다
        이 파일이 우선한다"고 못박혀 있다. 3-1 은 옛 시안의 인라인 값(12px --text-muted)을
        그대로 옮겼었다.
        ★ 별표를 라벨 문자열에 이어붙이지 않는다 — 색을 따로 줄 수 없고 읽어 주는 기계가
          "회사명 별표"로 읽는다.
      */}
      <span className={styles.label}>
        {field.label}
        {field.required ? <span className={styles.req} aria-hidden="true">*</span> : null}
      </span>
      {/*
        ★ 3-1c — 안내 문구는 **라벨과 입력칸 사이**다. 3-1b 에서는 입력칸 아래에 뒀는데
          새 시안(s0300200040.html 551~554행)을 열어 보니 `.hint` 가 라벨 바로 밑에 있다.
          05-patterns.md#3 의 「설명 13px (라벨 하단)」과 「도움말/오류 하단 4px, 12px」은
          서로 다른 두 요소였다 — 3-1b 가 둘을 하나로 읽었다.
          여기 문구는 전부 설명(무엇을 넣는 칸인지)이지 입력 결과에 대한 도움말이 아니다.
      */}
      {field.hint ? <span className={styles.hint}>{field.hint}</span> : null}
      <input
        className={styles.input}
        name={name}
        placeholder={PLACEHOLDERS[name] ?? ''}
        maxLength={field.maxLength ?? undefined}
        required={field.required}
        inputMode={field.digitsOnly ? 'numeric' : undefined}
      />
    </label>
  );
}

export function NewTenantModal({ onClose }: { onClose: () => void }) {
  // 원본 484행: Escape 로 닫는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // 원본 480행: 바깥(오버레이) 클릭으로 닫되, 패널 안 클릭은 통과시키지 않는다.
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="new-tenant-title">
        <div className={styles.header}>
          <div>
            <h3 id="new-tenant-title" className={styles.title}>
              신규 입주사 등록
            </h3>
            <p className={styles.note}>입주사 정보와 첫 계약을 함께 등록합니다</p>
          </div>
          <button type="button" className={styles.close} aria-label="닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className={styles.scroll}>
          <div className={styles.sectionTitle}>입주사 정보</div>
          <div className={styles.divider} />
          <div className={styles.grid}>
            {onScreenFields(COMPANY_FIELDS).map(({ key, field }) => (
              <Field key={key} name={key} field={field} />
            ))}
          </div>

          {/*
            ★ 대표 정보를 회사 정보와 나눈 이유 — 이 셋(대표자명·휴대전화·이메일)은 삐용에서
              **회사가 아니라 사람**으로 만들어진다(member010). 한 덩어리로 보여야 운영자가
              "계정을 만드는 값"임을 안다.

            ★ 새 시안(계약 폼 s0300200040)은 이 셋을 섹션 1「회사 기본정보」안에 둔다 —
              별도 「대표 정보」 섹션이 없다. 그쪽이 맞는 배치일 수 있지만, 이 모달은
              페이즈 4 에서 계약 폼으로 걷어낼 임시 진입점이라 지금 재배치하지 않는다.
              doc/DESIGN_REVIEW_1.md 에 차이로 기록했다.
          */}
          <div className={styles.sectionTitle} style={{ marginTop: 24 }}>
            대표 정보
          </div>
          <div className={styles.divider} />
          <div className={styles.grid}>
            {onScreenFields(OWNER_FIELDS).map(({ key, field }) => (
              <Field key={key} name={key} field={field} />
            ))}
          </div>

          <div className={styles.sectionTitle} style={{ marginTop: 24 }}>
            구독 설정
          </div>
          <div className={styles.divider} />
          {SELECTABLE_MODULES.length === 0 ? (
            // 고를 항목이 없다. 자리를 비워 두면 "빠뜨린 것"으로 읽히므로 이유를 적는다.
            <div className={styles.notice}>
              <span className={styles.noticeBar} />
              선택 가능한 서비스가 준비되면 여기에 표시됩니다
            </div>
          ) : null}

          <div className={styles.sectionTitle} style={{ marginTop: 24 }}>
            계약 정보
          </div>
          <div className={styles.divider} />
          <div className={styles.notice}>
            <span className={styles.noticeBar} />
            호실 · 계약 항목 · 금액은 다음 단계에서 입력합니다
          </div>
        </div>

        <div className={styles.footer}>
          {/*
            ★ "메일을 확인하세요" 라고 쓰지 않는다 — 메일은 오지 않는다.
              삐용 메일 발송은 2단계이고, 그전까지 대표 계정은 만들어져도 로그인할 수 없다.
          */}
          <span className={styles.footerNote}>{REGISTRATION_DONE_NOTICE}</span>
          <button type="button" className={styles.cancel} onClick={onClose}>
            취소
          </button>
          {/* 아무것도 호출하지 않는다(3-1). 실제 등록은 3-5 에서 붙인다. */}
          <button type="button" className={styles.submit} disabled title="등록 기능은 3-5에서 연결됩니다">
            등록
          </button>
        </div>
      </div>
    </div>
  );
}
