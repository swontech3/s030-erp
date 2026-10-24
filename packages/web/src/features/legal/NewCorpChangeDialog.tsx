'use client';

/**
 * [새 건] — 변경 구분을 고르고 상세(s040200011)의 **임시 모드**로 간다(3단계, 2026-10-10).
 *
 * ★★★ 이 대화상자는 DB 에 아무것도 쓰지 않는다(결정 2026-10-10). 건은 상세에서 첫 [저장] 을
 *    눌러야 생긴다 — 대화상자만 열고 닫거나 상세에서 그냥 나가면 쓰레기 건이 남지 않는다.
 *    주소: `/legal/corp-changes/new?changeType=…&orgId=…&orgCode=…`(회사 사용자는 구분만).
 *
 * ★ 회사 고르기:
 *   · 운영사 — 공용 회사 조회 팝업(`components/org-lookup`)으로 고른다. 팝업이 주는 단체 ID ·
 *     단체코드만 주소에 싣는다(회사명은 싣지 않는다 — 복사 금지)
 *   · 회사 사용자 — 자기 회사로 바로 시작한다. 단체를 싣지 않는다 — 서버가 세션 단체를 쓴다.
 *   ★ 주소의 단체는 화면이 믿지 않는다 — 서버가 임시 모드 읽기와 첫 저장 때 세션과 대조한다(403).
 * ★ 변경 구분은 목록 응답의 선택지(5종, shared `CORP_CHANGE_TYPES` 로 거른 것)를 쓴다.
 *   저장한 뒤에는 바꿀 수 없다.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CodeOption } from '@swonbiz/shared/domain/corp-change-list';
import type { OrgPick } from '@swonbiz/shared/domain/org-lookup';
import { Icon } from '@/components/ds';
import { OrgLookupDialog } from '@/components/org-lookup/OrgLookupDialog';
import styles from './corp-changes.module.css';

interface Props {
  changeTypes: CodeOption[];
  /** 운영사면 true — 회사를 팝업으로 고른다. */
  pickOrg: boolean;
  onClose: () => void;
}

export function NewCorpChangeDialog({ changeTypes, pickOrg, onClose }: Props) {
  const router = useRouter();
  const [changeType, setChangeType] = useState('');
  const [org, setOrg] = useState<OrgPick | null>(null);
  const [lookup, setLookup] = useState(false);
  const [busy, setBusy] = useState(false);

  const ready = changeType !== '' && (!pickOrg || org !== null);

  /** 임시 모드로 간다 — 아무것도 쓰지 않는다. */
  const start = () => {
    if (!ready) return;
    setBusy(true);
    const qs = new URLSearchParams({ changeType });
    if (pickOrg && org) {
      qs.set('orgId', String(org.orgId));
      qs.set('orgCode', org.orgCode);
    }
    router.push(`/legal/corp-changes/new?${qs.toString()}`);
  };

  return (
    <>
      <div
        className={styles.overlay}
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy && !lookup) onClose();
        }}
      >
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label="새 법인변경">
          <h2 className={styles.modalTitle}>새 법인변경</h2>
          <p className={styles.modalDesc}>
            변경 구분을 고르면 작성 화면으로 갑니다. 건은 그 화면에서 [저장] 을 누를 때 만들어집니다. 구분은 저장한 뒤 바꿀 수 없습니다.
          </p>

          {pickOrg ? (
            <div className={styles.modalField}>
              <span className={styles.label}>회사</span>
              <div className={styles.orgRow}>
                <span className={`${styles.orgValue}${org ? '' : ` ${styles.orgEmpty}`}`}>
                  {org ? `${org.orgName} (${org.orgCode})` : '회사를 고르세요'}
                </span>
                <button type="button" className={styles.btn} disabled={busy} onClick={() => setLookup(true)}>
                  <Icon name="search" size={16} />
                  회사 조회
                </button>
              </div>
            </div>
          ) : (
            <p className={styles.modalDesc}>내 회사의 법인변경으로 작성합니다.</p>
          )}

          <label className={styles.modalField}>
            <span className={styles.label}>변경 구분</span>
            <select
              className={styles.select}
              value={changeType}
              disabled={busy}
              autoFocus={!pickOrg}
              onChange={(e) => setChangeType(e.target.value)}
            >
              <option value="">선택</option>
              {changeTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.modalFoot}>
            <button type="button" className={styles.btn} disabled={busy} onClick={onClose}>
              취소
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={busy || !ready}
              onClick={start}
            >
              다음
            </button>
          </div>
        </div>
      </div>

      {lookup ? (
        <OrgLookupDialog
          title="법인변경 회사 선택"
          onClose={() => setLookup(false)}
          onPick={(pick) => {
            setOrg(pick);
            setLookup(false);
          }}
        />
      ) : null}
    </>
  );
}
