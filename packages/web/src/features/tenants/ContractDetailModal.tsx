'use client';

/** @screen s0300200030p1 계약 상세 · 020 입주사관리 · 1차 */

/**
 * 계약 상세 모달 — **단독 화면이 아니라 `s0300200030` 안에서 열린다.**
 *
 * 원본: design/handoff/prototypes/s0300200030.html 402~430행(마크업) · 705~745행(채우기)
 * 명세: design/handoff/tenant-contract/02-master-detail.md 「계약 상세 모달」
 *
 * ★ 푸터 3버튼이 계약 폼으로 가는 길이다.
 *     [계약 상세] → `/contracts/{id}`  — 만든 계약을 다시 여는 유일한 경로다
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
