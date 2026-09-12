'use client';

/** @screen s0300200030p2 계약 등록 — 신규 입주사 모드 · 020 입주사관리 · 1차 */

/**
 * 신규 입주사 등록 모달 — **골격이다**(3-1).
 * 원본: design/erp-master-detail/ErpMasterDetail.dc.html 216~275행 (modal="new-tenant").
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
  ceoName: '홍길동',
  // 원본에 없는 항목은 자리 표시를 비워 둔다 — 예시를 지어내지 않는다.
  telNo: '02-0000-0000',
  hpNo: '010-0000-0000',
  email: 'name@company.com',
  taxEmail: 'name@company.com',
};

function Field({ name, field }: { name: string; field: RegistrationField }) {
  return (
    <label className={`${styles.field} ${FULL_WIDTH.has(name) ? styles.wide : ''}`}>
      <span className={styles.label}>
        {field.label}
        {field.required ? ' *' : ''}
      </span>
      <input
        className={styles.input}
        name={name}
        placeholder={PLACEHOLDERS[name] ?? ''}
        maxLength={field.maxLength ?? undefined}
        defaultValue={name === 'countryCode' ? 'KR' : undefined}
        inputMode={field.digitsOnly ? 'numeric' : undefined}
      />
      {field.hint ? <span className={styles.hint}>{field.hint}</span> : null}
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
            ★ 대표 정보를 회사 정보와 나눈 이유 — 원본은 대표자명·연락처·이메일을
              「입주사 정보」 안에 섞어 두었지만, 이 셋은 삐용에서 **회사가 아니라
              사람**으로 만들어진다(member010). 같은 상자에 두면 회사 정보의
              「대표자명」(사업자등록증상 대표자, ERP 만 보관)과 구분이 사라진다.
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
