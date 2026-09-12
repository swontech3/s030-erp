'use client';

/**
 * s0300200030 의 클라이언트 부분 — 모달 열림 상태 하나 때문에 갈라져 있다.
 *
 * 원본(ErpMasterDetail.dc.html)은 `modal` prop 하나로 none/detail/new-tenant/
 * new-contract/renew 를 전환한다. 3-1 에서 채우는 것은 **new-tenant 뿐**이고
 * 나머지는 열 자리(버튼)조차 아직 없다 — 계약 데이터가 있어야 뜨는 것들이다.
 *
 * ★ 데이터 조회가 없다. 목록은 비어 있고 검색창은 아무것도 거르지 않는다.
 *   입주사 CRUD 는 3-4 다.
 */
import { useState } from 'react';
import { Icon } from '@/components/ds';
import { NewTenantModal } from '@/features/tenants/NewTenantModal';
import styles from './tenant-contracts.module.css';

export function TenantContractsView() {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>입주사 · 계약 관리</h1>
        <button type="button" className={styles.newTenant} onClick={() => setOpen(true)}>
          <Icon name="plus" size={16} />
          신규 입주사 등록
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.list}>
          <div className={styles.listHead}>
            <div className={styles.searchRow}>
              <span className={styles.searchWrap}>
                <span className={styles.searchIcon}>
                  <Icon name="search" size={16} />
                </span>
                {/* 3-4 까지는 거를 데이터가 없다. 모양만 이관한다. */}
                <input className={styles.search} placeholder="회사명, 대표자 검색" disabled />
              </span>
              <span className={styles.count}>0곳</span>
            </div>
          </div>

          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <Icon name="building-2" size={40} />
            </span>
            <p className={styles.emptyText}>등록된 입주사가 없습니다</p>
          </div>
        </div>

        <div className={styles.detail}>
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <Icon name="mouse-pointer-click" size={40} />
            </span>
            <p className={styles.emptyText}>왼쪽에서 입주사를 선택하세요</p>
          </div>
        </div>
      </div>

      {open ? <NewTenantModal onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
