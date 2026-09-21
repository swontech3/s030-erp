'use client';

/**
 * s0300200030 입주사·계약 마스터-디테일 — 3-4 에서 실제 데이터로 채웠다.
 *
 * 원본: design/handoff/prototypes/s0300200030.html  ← ★ 시각 정본(2차 인계분)
 * 명세: design/handoff/tenant-contract/02-master-detail.md
 *
 * =============================================================================
 * ★ 좌우가 갈라져 있고 **화면은 전환되지 않는다**
 * =============================================================================
 * 카드를 누르면 우측 패널만 갱신된다. 그래서 선택 상태는 클라이언트가 들고,
 * 계약 목록만 그때 가져온다 — 좌측 목록은 서버가 이미 준 것을 다시 부르지 않는다.
 *
 * =============================================================================
 * ★ 칩은 다중 선택이고 **전부 해제하면 거르지 않는다**
 * =============================================================================
 * 판정은 `matchesChips()` 가 한다(shared). 전부 해제를 「아무것도 안 보임」으로 읽으면
 * [전체] 버튼이 목록을 비우는 버튼이 된다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { matchesChips, type TenantFilterKey } from '@swonbiz/shared/domain/tenant-status';
import { Icon, type IconName } from '@/components/ds';
import {
  contractStatusLabel,
  formatDate,
  formatWon,
  isExpiringSoon,
  matchesSearch,
  planLabel,
  remainingLabel,
  type ContractSummaryResponse,
  type TenantCard,
  type TenantContract,
} from '@/features/tenants/tenant-model';
import styles from './tenant-contracts.module.css';

/**
 * 신규 입주사 — 계약 폼을 **입주사 없이** 연다.
 *
 * ★ `?companyId=` 를 붙이지 않는 것이 전부다. 폼은 그 경우 섹션 1 을 빈 값으로 열고,
 *   첫 저장에서 입주사를 만든다(`ContractForm.saveTenant`).
 */
const NEW_TENANT_HREF = '/contracts/new';

/** 만기 임박 기준. shared 의 `EXPIRY_SOON_DAYS` 와 같은 값을 서버가 내려준다. */
interface Props {
  tenants: TenantCard[];
  /** ★ 서버 전체 건수다. 칩으로 걸러도 줄지 않는다(시안 「24곳」). */
  total: number;
  /** 코드 표시명. 키는 `카테고리:코드` 다 — 같은 글자가 카테고리마다 다른 뜻이다. */
  codeNames: Record<string, string>;
  soonDays: number;
}

/**
 * ★★ 「기간 만료」와 「종료」는 **다르다.**
 *   기간 만료  종료일이 지났는데 아직 계약중 — **운영자가 할 일이 남았다**
 *   종료       종료 처리가 끝났다
 *
 * 자동 종료 배치를 만들지 않기로 했으므로 둘은 사람이 처리했는지로 갈린다. 한 칩에
 * 섞으면 **처리한 곳과 안 한 곳이 뒤섞여** 어디를 봐야 하는지 알 수 없다.
 *
 * ★ 「만기 임박」 다음에 둔다 — 시간 순서(임박 → 만료 → 종료)로 읽힌다.
 */
const CHIPS: { key: TenantFilterKey; label: string }[] = [
  { key: 'active', label: '계약중' },
  { key: 'soon', label: '만기 임박' },
  { key: 'expired', label: '기간 만료' },
  { key: 'review', label: '검토중' },
  { key: 'ended', label: '종료' },
];

/** 시안: 기본은 「계약중」만 켜져 있다. */
const DEFAULT_CHIPS: TenantFilterKey[] = ['active'];

export function TenantContractsView({ tenants, total, codeNames, soonDays }: Props) {
  const searchParams = useSearchParams();
  /** [재계약] 이동용. 행이 이미 `<Link>` 라 그 안에 링크를 또 넣을 수 없다. */
  const router = useRouter();
  const [chips, setChips] = useState<TenantFilterKey[]>(DEFAULT_CHIPS);
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contracts, setContracts] = useState<TenantContract[] | null>(null);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ★ 오늘을 한 번만 정한다. 행마다 new Date() 를 부르면 목록을 그리는 도중 자정을
  //   넘길 때 행끼리 기준이 갈린다. 계약 목록이 바뀔 때만 다시 잡는다.
  const today = useMemo(() => new Date(), [contracts]);

  const selected = tenants.find((t) => t.companyId === selectedId) ?? null;

  const visible = tenants.filter((t) => matchesChips(t.filters, chips) && matchesSearch(t, keyword));
  const searching = keyword.trim().length > 0;

  const counts = useMemo(() => {
    const map = new Map<TenantFilterKey, number>();
    for (const chip of CHIPS) map.set(chip.key, 0);
    for (const t of tenants) for (const f of t.filters) map.set(f, (map.get(f) ?? 0) + 1);
    return map;
  }, [tenants]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /** 카드를 고르면 그 입주사의 계약만 가져온다. 좌측 목록은 다시 부르지 않는다. */
  const select = useCallback(
    async (companyId: string) => {
      setSelectedId(companyId);
      setContracts(null);
      setLoadingContracts(true);
      try {
        const res = await fetch(`/api/companies/${companyId}`);
        const body = (await res.json()) as { contracts?: ContractSummaryResponse[]; message?: string };
        if (!res.ok) throw new Error(body.message ?? '계약을 불러오지 못했습니다');
        const list = (body.contracts ?? []).map((c) => ({
          ...c,
          // 표시명은 코드 테이블(`CONTRACT_ST`)에서 온다 — `codeNames` 가 그것까지 담고 있다.
          statusLabel: contractStatusLabel(c, new Date(), codeNames),
          planLabel: planLabel(
            c.roomTypes.map((code) => codeNames[`ROOM_TP:${code}`] ?? code),
            c.spaceCount,
          ),
          paymentMethodLabel: c.paymentMethod
            ? (codeNames[`PAYMENT_METHOD:${c.paymentMethod}`] ?? c.paymentMethod)
            : '—',
        }));
        setContracts(list);
      } catch (err) {
        setContracts([]);
        notify((err as Error).message);
      } finally {
        setLoadingContracts(false);
      }
    },
    [codeNames, notify],
  );

  /**
   * ★ `?companyId=` 로 들어오면 그 입주사를 골라 둔다.
   *
   *   계약 폼의 [확인] 이 「이미 계약중인 입주사입니다」와 함께 이 링크를 준다 —
   *   이름만 알려 주고 찾는 일을 운영자에게 떠넘기지 않으려고 넣었다.
   *
   * ★ **한 번만** 고른다. 이후 사람이 다른 카드를 누른 것을 이 effect 가 되돌리면
   *   목록이 눌리지 않는 화면이 된다.
   */
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    const wanted = searchParams.get('companyId');
    if (!wanted || !tenants.some((t) => t.companyId === wanted)) return;
    deepLinked.current = true;
    void select(wanted);
    // 칩이 「계약중」만 켜져 있으면 종료된 입주사가 목록에서 걸러져 고른 것이 안 보인다.
    setChips([]);
  }, [searchParams, tenants, select]);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>입주사 · 계약 관리</h1>
        {/*
          ★ **계약 폼을 빈 값으로 연다**(`?companyId=` 없이). 새 원본이 계약 등록 모달
            3종을 없애고 폼 한 장으로 일원화했고(02-master-detail.md 최종 문단),
            ROADMAP 페이즈 4 작업 15 가 그 이관이다.

          ★ 회사는 **폼의 첫 저장에서 만들어진다**(`POST /companies`). 예전 모달은
            저장 경로가 없어 입력해도 아무것도 남지 않았다.

          ★ 삐용 조직 등록·단체코드 발급은 아직 붙지 않았다 — 3-2 에서 저장 경로에 얹는다.
        */}
        <Link className={`${styles.btn} ${styles.btnPrimary}`} href={NEW_TENANT_HREF}>
          <Icon name="plus" size={16} />
          신규 입주사 등록
        </Link>
      </div>

      <div className={styles.body}>
        {/* ══════════ 좌측 · 입주사 리스트 ══════════ */}
        <div className={styles.list}>
          <div className={styles.listHead}>
            <div className={styles.searchRow}>
              <span className={styles.searchWrap}>
                <span className={styles.searchIcon}>
                  <Icon name="search" size={16} />
                </span>
                <input
                  className={styles.search}
                  placeholder="회사명, 대표자 검색"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </span>
              <span className={styles.count}>{total}곳</span>
              {/* 칩 전체 해제 — 목록을 비우는 버튼이 아니라 필터를 끄는 버튼이다. */}
              <button type="button" className={styles.reset} onClick={() => setChips([])}>
                전체
              </button>
            </div>

            <div className={styles.chipRow}>
              {CHIPS.map((chip) => {
                const on = chips.includes(chip.key);
                return (
                  <button
                    key={chip.key}
                    type="button"
                    className={`${styles.chip}${on ? ` ${styles.chipOn}` : ''}`}
                    onClick={() =>
                      setChips((prev) =>
                        prev.includes(chip.key) ? prev.filter((k) => k !== chip.key) : [...prev, chip.key],
                      )
                    }
                  >
                    <span className={styles.chipCheck}>
                      <Icon name="check" size={12} />
                    </span>
                    {chip.label} {counts.get(chip.key) ?? 0}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.cards}>
            {tenants.length === 0 ? (
              <PanelEmpty
                icon="building-2"
                lead="등록된 입주사가 없습니다"
                sub="신규 입주사를 등록해 주세요"
                action={{ label: '신규 입주사 등록', kind: 'primary', href: NEW_TENANT_HREF }}
              />
            ) : searching && visible.length === 0 ? (
              // ★ 검색 0건과 목록 0건은 다른 상태다 — 문구도 액션도 다르다.
              <PanelEmpty
                icon="search-x"
                lead="검색 결과가 없습니다"
                sub="다른 검색어를 입력해 보세요"
                action={{ label: '검색 초기화', kind: 'ghost', onClick: () => setKeyword('') }}
              />
            ) : (
              visible.map((t) => (
                <button
                  key={t.companyId}
                  type="button"
                  className={`${styles.card}${t.companyId === selectedId ? ` ${styles.cardSelected}` : ''}`}
                  onClick={() => void select(t.companyId)}
                >
                  <span className={styles.cardRow1}>
                    <span className={styles.cardName}>
                      {t.provisional ? <span className={styles.cardPre}>(가등록)</span> : null}
                      <b>{t.companyName}</b>
                    </span>
                    <span className={`${styles.badge} ${badgeClass(t.statusLabel)}`}>{t.statusLabel}</span>
                  </span>
                  <span className={styles.cardMeta}>
                    {[t.ceoName, t.tel, t.provisional ? '사업자등록 신청 중' : t.bizNumber]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ══════════ 우측 · 계약 이력 ══════════ */}
        <div className={styles.detail}>
          {!selected ? (
            <PanelEmpty icon="mouse-pointer-click" lead="왼쪽에서 입주사를 선택하세요" />
          ) : (
            <>
              <div className={styles.detailHead}>
                <div className={styles.who}>
                  <h2>{selected.companyName}</h2>
                  <span className={styles.whoDivider} />
                  <span className={styles.whoSub}>계약 {selected.contractCount}건</span>
                  {selected.roomSummary ? (
                    <>
                      <span className={styles.whoMid}>·</span>
                      <span className={styles.whoSub}>{selected.roomSummary}</span>
                    </>
                  ) : null}
                  <span className={styles.whoMid}>·</span>
                  <span className={`${styles.badge} ${badgeClass(selected.statusLabel)}`}>
                    {/* 시안: 카드는 「D-9」, 헤더는 「계약중」으로 편다. */}
                    {selected.statusLabel.startsWith('D-') ? '계약중' : selected.statusLabel}
                  </span>
                </div>
                <Link
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                  href={`/contracts/new?companyId=${encodeURIComponent(selected.companyId)}`}
                >
                  <Icon name="plus" size={16} />
                  신규 계약
                  <span className={styles.tip}>선택한 입주사의 신규 계약을 등록합니다</span>
                </Link>
              </div>

              {loadingContracts ? (
                <PanelEmpty icon="file-text" lead="계약을 불러오는 중입니다" />
              ) : contracts && contracts.length === 0 ? (
                <div className={styles.detailBody}>
                  <PanelEmpty
                    icon="file-text"
                    lead="등록된 계약이 없습니다"
                    action={{
                      label: '첫 계약 등록',
                      kind: 'primary',
                      href: `/contracts/new?companyId=${encodeURIComponent(selected.companyId)}`,
                    }}
                  />
                </div>
              ) : (
                <div className={styles.detailBody}>
                  <div className={styles.tableHead}>
                    {['기간', '계약일자', '플랜·호실', '월 이용료', '상태', '액션'].map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                  {(contracts ?? []).map((c, i) => {
                    const soon = isExpiringSoon(c, today, soonDays);
                    const live = c.status === 'confirmed';
                    return (
                      /*
                       * ★ 행을 누르면 **계약 폼으로 바로 간다.** 상세 모달을 거치지 않는다
                       *   (2026-09-19 · `doc/DESIGN_HANDOFF_DIFF.md` §H-7).
                       *
                       * ★ `<button>` 이 아니라 `<Link>` 다. 버튼 안에 링크를 넣을 수 없고,
                       *   링크여야 새 탭·가운데 클릭·주소 복사가 된다 — 목록에서 계약을
                       *   여러 개 비교하는 자리라 그게 실제로 쓰인다.
                       */
                      <Link
                        key={c.contractId}
                        href={`/contracts/${c.contractId}`}
                        className={`${styles.row}${live ? ` ${styles.rowActive}` : ''}`}
                      >
                        <span className={`${styles.cell} ${styles.term}`}>
                          {c.periodMonths ? `${c.periodMonths}개월` : '—'}
                        </span>
                        <span className={styles.cell}>
                          <span className={styles.dates}>
                            {formatDate(c.startDate)} ~ {formatDate(c.endDate)}
                          </span>
                          <span className={`${styles.remain}${soon ? ` ${styles.remainSoon}` : ''}`}>
                            {remainingLabel(c, today)}
                          </span>
                        </span>
                        <span className={`${styles.cell} ${styles.plan}`}>
                          {[c.planLabel, c.roomNames].filter(Boolean).join(' · ')}
                        </span>
                        <span className={`${styles.cell} ${styles.fee}`}>{formatWon(c.monthlyPayment)}</span>
                        <span className={`${styles.cell} ${styles.status}`}>
                          <span className={`${styles.badge} ${live ? styles.badgeIndigo : styles.badgeNeutral}`}>
                            {c.statusLabel}
                          </span>
                          {soon ? <span className={styles.statusSoon}>만기 임박</span> : null}
                        </span>
                        <span className={`${styles.cell} ${styles.action}`}>
                          {/*
                            ★ 액션 버튼은 행 클릭과 **분리한다.** 행이 링크가 된 뒤로는
                              `stopPropagation` 만으로 부족하다 — 링크의 기본 이동도 막아야
                              [재계약] 을 눌렀을 때 계약 폼으로 새지 않는다.
                          */}
                          {/*
                            ★ `<Link>` 안이라 링크를 또 넣을 수 없다(중첩 링크는 무효
                              HTML 이고 브라우저마다 다르게 고친다). 그래서 이동은
                              `router.push` 로 하고, 바깥 링크의 기본 이동은 막는다.
                          */}
                          <span
                            role="presentation"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              router.push(`/contracts/new?renewFrom=${encodeURIComponent(c.contractId)}`);
                            }}
                          >
                            <span className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}>
                              <Icon name="copy-plus" size={14} />
                              재계약
                              <span className={styles.tip}>이 계약 조건으로 재계약합니다</span>
                            </span>
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/*
        ★ 계약 상세 모달(`ContractDetailModal`)은 **파일째 지웠다**(2026-09-20).
          행을 누르면 계약 폼으로 바로 간다 — 모달이 보여주던 값이 목록 행에 이미 다 있고,
          확정된 계약은 폼도 읽기 전용이라 모달이 하던 일을 폼이 대신한다
          (2026-09-19 · `doc/DESIGN_HANDOFF_DIFF.md` §H-7).

          하루 동안 「자리일 수 있다」는 이유로 남겨 뒀지만, 그 자리는 결국 폼의 섹션이
          됐다(첨부는 섹션 4, 상태는 헤더 뱃지). 열리지 않는 화면이 남아 있으면 다음
          사람이 그 파일을 고치고 반영이 안 된다고 헤맨다.
      */}

      {toast ? (
        <div className={styles.toast}>
          <span className={styles.toastDot} />
          <span className={styles.toastMsg}>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

/** 시안 `statusBadgeClass` — 만기 임박만 warning 이고 완료·정상은 인디고다. */
function badgeClass(status: string): string {
  if (status === '검토중' || status === '만료' || status === '종료') return styles.badgeNeutral ?? '';
  if (status.startsWith('D-')) return styles.badgeWarning ?? '';
  return styles.badgeIndigo ?? '';
}

function PanelEmpty({
  icon,
  lead,
  sub,
  action,
}: {
  icon: IconName;
  lead: string;
  sub?: string;
  action?: { label: string; kind: 'primary' | 'ghost'; onClick?: () => void; href?: string };
}) {
  const cls = `${styles.btn} ${action?.kind === 'primary' ? styles.btnPrimary : styles.btnGhost}`;
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={40} />
      </span>
      <p className={styles.emptyLead}>{lead}</p>
      {sub ? <p className={styles.emptySub}>{sub}</p> : null}
      {action ? (
        <div className={styles.emptyAct}>
          {action.href ? (
            <Link className={cls} href={action.href}>
              {action.label}
            </Link>
          ) : (
            <button type="button" className={cls} onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
