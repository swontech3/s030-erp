'use client';

/** @screen s0300200030p1 계약 상세 · 020 입주사관리 · 1차 */

/**
 * 계약 상세 모달.
 *
 * =============================================================================
 * ★★★ 2026-09-19 — **지금은 아무 데서도 열지 않는다. 죽은 코드다.**
 * =============================================================================
 * `s0300200030` 의 계약 행을 누르면 이 모달 대신 **계약 폼(`/contracts/{id}`)으로
 * 바로 간다.** 이유는 둘이다:
 *
 *   · 모달이 보여주던 값이 **목록 행에 이미 다 있다** — 기간·계약일자·플랜·호실·
 *     월 이용료·상태. 한 단계만 늘었다
 *   · 모달이 보여주던 것은 **계약 조건(섹션 2)** 이고, `confirmed` 이후 폼에서 잠기는
 *     것이 정확히 그 섹션이다(`editableSections`). 모달이 하던 「확정 계약을 읽기
 *     전용으로 보여주기」를 폼이 그대로 한다.
 *     (`confirmed` 는 섹션 2 만 잠긴다 — 섹션 1·3 은 열려 있다.
 *      `terminated`·`cancelled` 라야 전 섹션 읽기 전용이다.)
 *
 * **그래도 지우지 않는다.** 첨부·상태 이력·청구가 붙으면 목록에서 가볍게 열어 보는
 * 자리가 다시 필요해질 수 있고, 그때 이 마크업이 출발점이다.
 *
 * ★ 되살릴 때 확인할 것 — 아래 푸터의 `onRenew` 는 **아직 안내 토스트만 띄운다**
 *   (재계약 값 복사 CONT-02 미구현). 목록 쪽 [재계약] 버튼과 같은 상태다.
 *
 * 경위: `doc/DESIGN_HANDOFF_DIFF.md` §H-7
 * -----------------------------------------------------------------------------
 *
 * 원본: design/handoff/prototypes/s0300200030.html 402~430행(마크업) · 705~745행(채우기)
 * 명세: design/handoff/tenant-contract/02-master-detail.md 「계약 상세 모달」
 *
 * ★ 푸터 3버튼이 계약 폼으로 가는 길이었다.
 *     [계약 상세] → `/contracts/{id}`  — 이제는 행 클릭이 같은 곳으로 간다
 *     [재계약]    → 값 복사(CONT-02)가 아직 없다. 아래 주석 참조
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ds';
import styles from '@/app/(erp)/tenants/contracts/tenant-contracts.module.css';
import { formatDate, formatWon, remainingLabel, type TenantContract } from './tenant-model';

interface Props {
  contract: TenantContract;
  companyName: string;
  today: Date;
  onClose: () => void;
  onRenew: () => void;
}

export function ContractDetailModal({ contract, companyName, today, onClose, onRenew }: Props) {
  // 원본: 열릴 때 부모 스크롤을 잠근다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const live = contract.status === 'confirmed';
  const rows: [string, string][] = [
    ['입주사', companyName],
    // 항목이 하나면 그 값, 여럿이면 「1인실 외 2건」(명세 「계약구분」).
    ['계약구분', contract.planLabel],
    ['이용호실', contract.roomNames || '—'],
    ['계약호실', contract.contractRoom ?? '—'],
    ['계약일자', formatDate(contract.contractDate) || '—'],
    ['계약기간', contract.periodMonths ? `${contract.periodMonths}개월` : '—'],
    ['계약일자 범위', `${formatDate(contract.startDate)} ~ ${formatDate(contract.endDate)}`],
    ['잔여일', remainingLabel(contract, today)],
    ['예치금 합계', formatWon(contract.depositTotal)],
    ['월납부액 합계', formatWon(contract.monthlyPayment)],
    ['납부방법', contract.paymentMethodLabel],
    ['첫달납부액', formatWon(contract.firstPayment)],
  ];

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="contract-detail-no">
        <div className={styles.modalHead}>
          <div>
            <h3 id="contract-detail-no" className={styles.modalNo}>
              {/* 계약번호가 아직 없는 계약이 있다 — 임시저장만 한 건이다. */}
              {contract.contractNo ?? '계약번호 미발급'}
            </h3>
            <div className={styles.modalBadge}>
              <span className={`${styles.badge} ${live ? styles.badgeIndigo : styles.badgeNeutral}`}>
                {contract.statusLabel}
              </span>
            </div>
          </div>
          <button type="button" className={styles.iconBtn} aria-label="닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.detailGrid}>
            {rows.map(([k, v]) => (
              <div key={k}>
                <div className={styles.detailKey}>{k}</div>
                <div className={styles.detailValue}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            닫기
          </button>
          <Link className={`${styles.btn} ${styles.btnGhost}`} href={`/contracts/${contract.contractId}`}>
            계약 상세
            <span className={styles.tip}>계약 폼으로 이동합니다</span>
          </Link>
          {/*
            ★ [재계약]은 «이전 계약 값을 복사해 새 계약을 연다»인데, 그 복사 규칙(CONT-02 —
              항목·조건·사용자 복사, 첨부 제외, 시작일은 이전 종료일 다음 날)이 아직 없다.
              빈 계약 폼으로 보내면 「재계약」이라고 적힌 버튼이 신규 계약을 여는 셈이라
              **누르면 안내만 한다.** 없는 기능을 있는 것처럼 보이게 하지 않는다.
          */}
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onRenew}>
            <Icon name="copy-plus" size={16} />
            재계약
            <span className={styles.tip}>이 계약 조건으로 재계약합니다</span>
          </button>
        </div>
      </div>
    </div>
  );
}
