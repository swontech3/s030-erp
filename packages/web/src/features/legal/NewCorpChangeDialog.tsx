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
 * ★ 변경 구분은 목록 응답의 선택지(shared `CORP_CHANGE_TYPES` 로 거른 것)를 쓴다.
 *   저장한 뒤에는 바꿀 수 없다.
 * ★ 회사 형태로 한 번 더 거른다(결정 2026-11-01 → 2026-11-07 공통 코드) — 회사를 고르면(회사 사용자는 바로) 회사유형과
 *   구분별 회사유형 규칙(공통 코드 `LAW_CNG_MT`, 응답의 `changeTypeRules`)을 읽어 `changeTypeAllowedFor` 로 거른다.
 *   줄이 없는 구분은 주식회사만 · 비었으면 주식회사로 봄. 서버도 첫 저장 · 저장 · 작성완료 때 같은 코드 · 함수로 거절한다.
 * ★ 비입주사이고 회사유형이 비었으면 그 자리에서 고른다(결정 2026-11-07) — 고른 유형으로 구분을 거르고,
 *   주소에 `memberType` 으로 실어 새 건 화면의 회사 정보에 넣는다(`presetMemberTypeFor`). 법무 회사 정보에는
 *   첫 [저장] 때 회사 정보와 함께 저장된다(`upsertLegalOrg`). 이 대화상자는 여전히 아무것도 쓰지 않는다.
 *   회사 정보를 고칠 수 없는 사람(수정 권한 없는 회사 사용자)에게는 고르는 칸 대신 지금의 안내 한 줄.
 *   입주사 · 회사유형이 이미 있는 비입주사는 고르는 칸이 없다.
 */
import { useEffect, useState } from 'react';
import { changeTypeAllowedFor } from '@swonbiz/shared/domain/corp-change';
import type { CorpChangeCompanyTypeResponse } from '@swonbiz/shared/domain/corp-change-detail';
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
  /** 회사유형 — 읽는 중 · 읽음(null = 비었음) · 실패. 회사를 고르기 전(운영사)은 'idle'. */
  const [typeLoad, setTypeLoad] = useState<
    { state: 'idle' } | { state: 'loading' } | ({ state: 'ok' } & CorpChangeCompanyTypeResponse) | { state: 'error'; message: string }
  >({ state: 'idle' });
  /** 그 자리에서 고른 회사유형(비입주사 · 비었을 때만, 결정 2026-11-07). '' = 안 고름. */
  const [pickedType, setPickedType] = useState('');

  // 회사가 정해지면 회사유형을 읽는다 — 운영사는 고른 회사, 회사 사용자는 자기 회사(단체를 싣지 않는다)
  useEffect(() => {
    if (pickOrg && !org) {
      setTypeLoad({ state: 'idle' });
      return;
    }
    let live = true;
    setTypeLoad({ state: 'loading' });
    setPickedType('');
    const qs = new URLSearchParams();
    if (pickOrg && org) {
      qs.set('orgId', String(org.orgId));
      qs.set('orgCode', org.orgCode);
    }
    fetch(`/api/legal/corp-changes/company-type?${qs.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as Partial<CorpChangeCompanyTypeResponse> & { message?: string };
        if (!live) return;
        if (!res.ok) setTypeLoad({ state: 'error', message: body.message ?? '회사유형을 읽지 못했습니다' });
        else
          setTypeLoad({
            state: 'ok',
            memberType: body.memberType ?? null,
            isTenant: body.isTenant ?? false,
            canEditCompany: body.canEditCompany ?? false,
            memberTypes: body.memberTypes ?? [],
            changeTypeRules: body.changeTypeRules ?? {},
          });
      })
      .catch(() => {
        if (live) setTypeLoad({ state: 'error', message: '서버에 연결할 수 없습니다' });
      });
    return () => {
      live = false;
    };
  }, [pickOrg, org]);

  /** 그 자리에서 고르는 칸을 보이나 — 비입주사 · 저장된 회사유형 비었음 · 회사 정보를 고칠 수 있음. */
  const canPickType =
    typeLoad.state === 'ok' && !typeLoad.isTenant && typeLoad.memberType === null && typeLoad.canEditCompany;
  /** 구분을 거를 회사유형 — 저장된 값, 비었으면 고른 값. */
  const memberType =
    typeLoad.state === 'ok' ? (typeLoad.memberType ?? (canPickType && pickedType !== '' ? pickedType : null)) : null;
  const options = typeLoad.state === 'ok' ? changeTypes.filter((t) => changeTypeAllowedFor(t.code, memberType, typeLoad.changeTypeRules)) : [];

  // 회사를 바꿔 고른 구분이 선택지에서 빠지면 비운다
  useEffect(() => {
    if (changeType !== '' && typeLoad.state === 'ok' && !changeTypeAllowedFor(changeType, memberType, typeLoad.changeTypeRules)) setChangeType('');
  }, [changeType, typeLoad, memberType]);

  const ready = changeType !== '' && (!pickOrg || org !== null) && typeLoad.state === 'ok';

  /** 임시 모드로 간다 — 아무것도 쓰지 않는다. */
  const start = () => {
    if (!ready) return;
    setBusy(true);
    const qs = new URLSearchParams({ changeType });
    if (pickOrg && org) {
      qs.set('orgId', String(org.orgId));
      qs.set('orgCode', org.orgCode);
    }
    if (canPickType && pickedType !== '') qs.set('memberType', pickedType);
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

          {canPickType && typeLoad.state === 'ok' ? (
            <label className={styles.modalField}>
              <span className={styles.label}>회사유형</span>
              <select
                className={styles.select}
                value={pickedType}
                disabled={busy}
                onChange={(e) => setPickedType(e.target.value)}
              >
                <option value="">선택</option>
                {typeLoad.memberTypes.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className={styles.modalField}>
            <span className={styles.label}>변경 구분</span>
            <select
              className={styles.select}
              value={changeType}
              disabled={busy || typeLoad.state !== 'ok'}
              autoFocus={!pickOrg}
              onChange={(e) => setChangeType(e.target.value)}
            >
              <option value="">선택</option>
              {options.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {pickOrg && typeLoad.state === 'idle' ? <p className={styles.modalDesc}>회사를 먼저 고르세요.</p> : null}
          {typeLoad.state === 'loading' ? <p className={styles.modalDesc}>회사유형을 읽는 중입니다…</p> : null}
          {typeLoad.state === 'error' ? <p className={styles.modalDesc}>{typeLoad.message}</p> : null}
          {/* 고칠 수 없는 사람만 지금의 안내 — 고칠 수 있으면 위의 회사유형 칸으로 바뀌었다(결정 2026-11-07) */}
          {typeLoad.state === 'ok' && !typeLoad.isTenant && typeLoad.memberType === null && !typeLoad.canEditCompany ? (
            <p className={styles.modalDesc}>유한회사면 회사 정보에서 회사유형을 먼저 넣어 주세요.</p>
          ) : null}

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
