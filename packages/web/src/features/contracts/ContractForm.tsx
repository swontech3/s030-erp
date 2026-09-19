'use client';

/** @screen s0300200040 계약 폼 · 020 입주사관리 · 1차 */

/**
 * 계약 폼 — 상태 5종(create / draft / confirmed / terminated / cancelled)을 한 페이지가 맡는다.
 *
 * 원본: design/handoff/prototypes/s0300200040.html
 * 명세: design/handoff/tenant-contract/03-contract-form.md · 04-status.md · 05-logic.md
 *
 * =============================================================================
 * ★★★ 판정을 여기에 다시 쓰지 않는다
 * =============================================================================
 *   무엇을 수정할 수 있나   `editableSections(status)`   — @swonbiz/shared
 *   어느 전이가 되나        서버가 `assertTransition()`   — 4-3 라우트
 *   금액·종료일·첫달납부액  `contract-amounts.ts`         — form-model.ts 경유
 *
 * 화면이 버튼을 감추고 입력을 비활성화하는 것은 **편의**다. 방어는 전부 서버에 있다.
 * 같은 규칙을 화면에 한 줄이라도 옮겨 적으면 두 벌이 되고, 조용히 갈린다.
 *
 * =============================================================================
 * ★★ 저장 경로가 없는 섹션은 **잠근다** — 4-4 에서 실제로 물린 자리다
 * =============================================================================
 * 4-4 는 섹션 2 만 저장했는데 나머지 셋을 열어 뒀다. 운영자가 회사 정보와 사용자를
 * 다 채우고 저장을 눌렀고, **오류 없이 조용히 사라졌다.** 화면이 거짓말을 한 것이다.
 *
 * 그래서 저장 경로가 없는 섹션은 읽기 전용으로 잠그고 이유를 띄운다. 어느 섹션이
 * 열려 있는지는 `SECTION_SAVEABLE` 한 곳에 있다 — 경로가 붙으면 거기만 바꾼다.
 *
 * ★ 잠금을 풀기 전에 **저장하고 새로고침해서 값이 남는지** 먼저 확인한다.
 *   "화면이 정상으로 보이는 것"과 "값이 남는 것"은 다른 문제다.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { editableSections } from '@swonbiz/shared/domain/contract-status';
import { Icon, type IconName } from '@/components/ds';
import styles from './contract-form.module.css';
import { ConfirmDialog, localToday, type ConfirmKind, type ConfirmResult } from './ConfirmDialog';
import { contractStatusName, contractStatusNamesOf } from './contract-status-name';
import { ContractDocumentModal } from './ContractDocumentModal';
import { SectionCompany, isBiznoFormatOk, type BizCheck } from './SectionCompany';
import { SectionContract } from './SectionContract';
import { SectionDocs } from './SectionDocs';
import { SectionUsers } from './SectionUsers';
import {
  DOMAIN_CUSTOM,
  emailDomainsOf,
  isCorpMemberType,
  memberTypesOf,
  ROW_TEMPLATE,
  SECTION_SAVEABLE,
  USER_TEMPLATE,
  currentDomain,
  discountLabel,
  endDateIsoOf,
  joinEmail,
  missingForDraft,
  missingRequired,
  userDomain,
  splitEmail,
  toNumber,
  totalsOf,
  withDiscountLine,
  type CodeOption,
  type CompanyState,
  type ItemRow,
  type RequiredKey,
  type SpaceOption,
  type TermsState,
  type UserRow,
} from './form-model';

/** 4-3 의 `toResponse()` 가 내려주는 모양. */
export interface ContractResponse {
  contractId: string;
  companyId: string;
  buildId: string;
  status: string;
  contractRoom: string | null;
  paymentMethod: string | null;
  accessRoute: string | null;
  firstPayment: number;
  contractDate: string | null;
  periodMonths: number | null;
  startDate: string;
  endDate: string;
  terminatedDate: string | null;
  terminationReason: string | null;
  memo: string | null;
  spaces: {
    seq: number;
    roomType: string;
    spaceId: string;
    standardFee: number;
    deposit: number;
    monthlyFee: number;
    vatYn: boolean;
    vatAmount: number;
    paymentAmount: number;
    lockerNo: string | null;
  }[];
}

/** 3-4 의 `GET /companies/:id` 가 내려주는 모양(계약 목록은 이 화면이 쓰지 않는다). */
export interface CompanyResponse {
  companyId: string;
  companyName: string;
  bizNumber: string | null;
  corpNumber: string | null;
  ceoName: string | null;
  /** ★ DB 의 `business_type` 은 「업태」다. */
  businessType: string | null;
  /** ★ DB 의 `business_item` 은 「종목」이고 화면의 「업종」이 이 값이다. */
  businessItem: string | null;
  memberType: string | null;
  tel: string | null;
  email: string | null;
  /** ★ 대표자 **자택** 주소. 사업장 주소가 아니다. */
  ceoZipCode: string | null;
  ceoAddress: string | null;
  ceoAddressDetail: string | null;
  memo: string | null;
}

/** 3-4 의 `GET /companies/:id/members`. */
export interface MemberResponse {
  memberId: string;
  name: string;
  phone: string | null;
  email: string | null;
  isRepresentative: boolean;
  memo: string | null;
}

type Mode = 'create' | 'draft' | 'confirmed' | 'terminated' | 'cancelled';

interface Props {
  /** `null` 이면 신규 작성(mode: create)이다. */
  contract: ContractResponse | null;
  /** 어느 입주사의 계약인지. 없으면 저장할 수 없다. */
  companyId: string | null;
  /** 섹션 1 의 저장값. 신규 작성이고 입주사가 정해지지 않았으면 `null`. */
  company: CompanyResponse | null;
  /** 섹션 3 의 저장값. */
  members: MemberResponse[];
  spaces: SpaceOption[];
  codes: CodeOption[];
}

const TITLES: Record<Mode, string> = {
  create: '계약 등록',
  draft: '계약 수정',
  confirmed: '계약 상세',
  terminated: '계약 상세',
  cancelled: '계약 상세',
};

/**
 * 상태별 헤더 버튼 — 04-status.md 「상태별 헤더 버튼」 그대로다.
 * DOM 순서는 `이전 · 계약취소 · 계약서 출력 · 임시저장 · 종료 · 계약확정 · 저장`.
 */
const ACTIONS: Record<Mode, readonly ActionKey[]> = {
  create: ['back', 'draftSave', 'confirm'],
  draft: ['back', 'cancel', 'draftSave', 'confirm'],
  confirmed: ['back', 'docs', 'terminate', 'save'],
  terminated: ['back', 'docs'],
  cancelled: ['back', 'docs'],
};

type ActionKey = 'back' | 'cancel' | 'draftSave' | 'confirm' | 'docs' | 'terminate' | 'save';

/**
 * ★ `status` 가 있는 버튼은 **문구를 코드 테이블에서 가져온다**(`CONTRACT_ST`).
 *   그 버튼이 만드는 결과 상태의 이름이 곧 버튼 문구이기 때문이다 — 코드에서
 *   `cancelled` 를 「계약해지」로 고치면 뱃지와 버튼이 함께 따라간다.
 *
 * ★ **[계약확정]에는 `status` 를 달지 않았다.** `confirmed` 의 코드명은 「계약중」인데
 *   그것은 **상태를 가리키는 이름이지 동작이 아니다** — 버튼에 「계약중」이라고 적으면
 *   무엇을 하는 버튼인지 읽히지 않는다. 넷 중 이 하나만 이름과 동작이 어긋난다.
 */
const ACTION_DEFS: Record<ActionKey, { label: string; cls: string; icon?: IconName; status?: string }> = {
  back: { label: '이전', cls: styles.btnGhost ?? '' },
  cancel: { label: '계약취소', cls: styles.btnDanger ?? '', status: 'cancelled' },
  draftSave: { label: '임시저장', cls: styles.btnGhost ?? '', icon: 'save' },
  confirm: { label: '계약확정', cls: styles.btnPrimary ?? '', icon: 'circle-check' },
  docs: { label: '계약서 출력', cls: styles.btnGhost ?? '', icon: 'file-text' },
  terminate: { label: '종료', cls: styles.btnDanger ?? '', status: 'terminated' },
  save: { label: '저장', cls: styles.btnPrimary ?? '' },
};

export function ContractForm({ contract, companyId, company, members, spaces, codes }: Props) {
  const router = useRouter();
  const status = contract?.status ?? null;
  const mode: Mode = (contract?.status as Mode | undefined) ?? 'create';

  const editable = editableSections(status);
  const sec2Editable = editable.includes(2);
  /** `terminated`·`cancelled` — 전 섹션 읽기 전용. */
  const frozen = editable.length === 0;

  /** 도메인 Select 의 목록. 코드 테이블에서 온다(016) — 예전엔 화면 상수였다. */
  const emailDomains = emailDomainsOf(codes);
  /** 회원구분 Select 의 목록. 코드 `MEMBER_TYPE` / `000` — 예전엔 화면 상수였다. */
  const memberTypes = memberTypesOf(codes);
  /**
   * 상태 표시명. 코드 `CONTRACT_ST` / `000` — 예전엔 헤더·모달·목록이 각자 들고 있었다.
   * `/codes` 가 실패해도 기본값이 받으므로 **비어 있는 상태 문구는 나오지 않는다.**
   */
  const statusNames = contractStatusNamesOf(codes);

  const [companyState, setCompany] = useState<CompanyState>(() =>
    seedCompany(company, emailDomains, memberTypes),
  );
  const [terms, setTerms] = useState<TermsState>(() => seedTerms(contract, spaces));
  const [items, setItems] = useState<ItemRow[]>(() => seedItems(contract));
  const [users, setUsers] = useState<UserRow[]>(() => seedUsers(members, emailDomains));
  const [invalid, setInvalid] = useState<RequiredKey[]>([]);
  const [bizCheck, setBizCheck] = useState<BizCheck>('none');
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  /** 계약서 2종 미리보기(s0300200040p1). 확정 이후에만 열린다. */
  const [docsOpen, setDocsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * ★ 할인 문구는 특기사항 **첫 줄에만** 자동으로 들어간다. 사용자가 쓴 줄은 보존한다.
   *   금액이 바뀔 때만 손대고, 할인이 사라지면 첫 줄을 지운다(05-logic §4).
   */
  const totals = totalsOf(items);
  const discount = discountLabel(totals.standardFee, totals.monthlyFee);
  useEffect(() => {
    if (!sec2Editable) return; // 잠긴 계약의 저장값을 화면이 고쳐 쓰지 않는다
    setTerms((prev) => {
      const next = withDiscountLine(prev.memo, discount);
      return next === prev.memo ? prev : { ...prev, memo: next };
    });
  }, [discount, sec2Editable]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  const missing = missingRequired(companyState, terms);

  /* ── 저장 ────────────────────────────────────────────────────────────── */

  /** 화면 값 → 4-3 이 받는 본문. 파생값도 함께 보낸다 — **서버가 대조해서 다시 계산한다.** */
  const payload = () => ({
    buildId: terms.buildId,
    contractRoom: terms.contractRoom || null,
    paymentMethod: terms.paymentMethod,
    accessRoute: terms.accessRoute || null,
    contractDate: terms.contractDate || null,
    periodMonths: toNumber(terms.months),
    startDate: terms.startDate,
    memo: terms.memo || null,
    spaces: items.map((row) => ({
      roomType: row.roomType,
      spaceId: row.spaceId,
      standardFee: row.standardFee,
      deposit: row.deposit,
      monthlyFee: row.monthlyFee,
      vatYn: row.vatYn,
    })),
  });

  async function send(path: string, method: 'POST' | 'PATCH' | 'PUT', body: unknown) {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      contractId?: string;
      members?: { memberId: string }[];
    };
    if (!res.ok) throw new Error(data.message ?? '저장에 실패했습니다');
    return data;
  }

  /**
   * 섹션 1·3 저장 — 입주사(`tb_s080_companies`)와 구성원(`tb_s080_members`)이다.
   *
   * ★ 계약이 아니라 **회사**에 붙는 값이다. 그래서 계약 ID 가 아직 없어도 저장되고,
   *   재계약을 해도 같은 명부를 계속 쓴다(3-4 작업 A-3).
   *
   * ★ 저장 뒤 새로 생긴 `memberId` 를 화면 상태에 되돌려 넣는다. 이걸 빼면 **저장할
   *   때마다 같은 사람이 새로 만들어지고** 옛 행은 비활성으로 밀린다.
   */
  async function saveTenant(): Promise<void> {
    if (!companyId) {
      throw new Error('입주사를 먼저 선택해야 합니다 — 입주사·계약 관리에서 들어와 주세요');
    }
    const ownerEmail = joinEmail(companyState.emailId, currentDomain(companyState));

    await send(`/api/companies/${companyId}`, 'PATCH', {
      companyName: companyState.company,
      bizNumber: companyState.bizno,
      // 법인이 아니면 법인등록번호를 비운다 — 화면에서 꺼진 칸의 옛 값을 남기지 않는다.
      corpNumber: isCorpMemberType(companyState.memberType) ? companyState.corpno : null,
      ceoName: companyState.ceo,
      // ★ 화면 「업태」 → business_type, 화면 「업종」 → business_item(=종목).
      //   DB 주석 기준이다. 사업자등록증의 「업태/종목」과 맞춘 것이고 판단이 필요했던 자리다.
      businessType: companyState.bizKind,
      businessItem: companyState.industry,
      memberType: companyState.memberType,
      tel: companyState.phone,
      email: ownerEmail,
      // ★ 대표자 **자택** 주소다(011). 사업장 주소(`address`)에 넣지 않는다.
      ceoZipCode: companyState.zip,
      ceoAddress: companyState.addr1,
      ceoAddressDetail: companyState.addr2,
      memo: companyState.note1,
    });

    // 미체크 행은 저장에서 뺀다 — **입력값은 화면에 그대로 둔다**(명세 섹션 3).
    // 이름이 빈 줄도 뺀다. 임시저장 중에는 대표자조차 비어 있을 수 있는데, 그걸
    // 오류로 막으면 회사 정보까지 저장하지 못한다.
    const kept = users
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => (index === 0 || row.selected) && effectiveName(row, index, companyState))
      .map(({ row, index }) => ({
        index,
        payload: {
          memberId: row.memberId,
          // 1행은 섹션 1 대표자를 미러링한다 — 화면에 보이는 값 그대로 저장한다.
          name: effectiveName(row, index, companyState),
          phone: index === 0 ? companyState.phone : row.phone,
          email: index === 0 ? ownerEmail : joinEmail(row.mailId, userDomain(row)),
          /**
           * ★ **대표자는 1행 고정이다.** 1행이 섹션 1 「대표자」를 미러링하는 자리라
           *   회사의 대표자가 곧 이 행이고, 명세도 「1행 … 대표자 체크 고정」이다
           *   (`03-contract-form.md` 섹션 3).
           *
           *   예전에는 저장된 `isRepresentative` 로 `repIndex` 를 잡아 화면에서 고를 수
           *   있었는데, 그러면 **1행에 대표자 이름이 보이는데 체크는 3행에 있는** 상태가
           *   만들어졌다. 화면과 저장이 갈리는 자리였다.
           */
          isRepresentative: index === 0,
          memo: row.memo,
        },
      }));

    const saved = await send(`/api/companies/${companyId}/members`, 'PUT', {
      members: kept.map((k) => k.payload),
    });

    // 서버가 돌려준 순서는 우리가 보낸 순서(sort_order)와 같다.
    const assigned = saved.members ?? [];
    if (assigned.length === kept.length) {
      setUsers((prev) =>
        prev.map((row, index) => {
          const at = kept.findIndex((k) => k.index === index);
          return at >= 0 ? { ...row, memberId: assigned[at]?.memberId ?? row.memberId } : row;
        }),
      );
    }
  }

  /** 계약을 만들거나(create) 고친다(draft). 돌려주는 값은 계약 ID 다. */
  async function saveContract(nextStatus: 'draft' | 'confirmed'): Promise<string> {
    if (contract) {
      await send(`/api/contracts/${contract.contractId}`, 'PATCH', payload());
      return contract.contractId;
    }
    if (!companyId) {
      throw new Error('입주사를 먼저 선택해야 합니다 — 입주사·계약 관리에서 들어와 주세요');
    }
    const data = await send('/api/contracts', 'POST', { ...payload(), companyId, status: nextStatus });
    if (!data.contractId) throw new Error('저장은 됐는데 계약 ID 가 오지 않았습니다');
    return data.contractId;
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setSaveError(null);
    try {
      await fn();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 못 채운 칸을 빨갛게 표시하고 첫 칸으로 옮긴다. 막았으면 `true`.
   *
   * ★ 임시저장과 확정이 **같은 함수를 쓴다.** 목록만 다르다 — 표시 방식이 갈리면
   *   운영자가 두 버튼에서 다른 화면을 본다.
   */
  const blockOnMissing = (keys: RequiredKey[]): boolean => {
    setInvalid(keys);
    if (keys.length === 0) return false;
    setSaveError(null);
    // 화면 밖 오류를 놓치지 않도록 첫 오류 칸으로 옮긴다.
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>(`.${styles.isInvalid}`);
      first?.scrollIntoView({ block: 'center' });
      first?.focus();
    });
    return true;
  };

  /**
   * 임시저장 — **대표자 · 연락처 · 이메일** 셋만 본다(`missingForDraft`).
   *
   * ★ 회사명·사업자등록번호를 보지 않는 것이 핵심이다. 사업자등록 신청 중인 가계약은
   *   상호도 번호도 아직 없다. 그 상태로 자리를 잡아 두는 것이 임시저장의 쓸모다.
   */
  const onDraftSave = () => {
    if (blockOnMissing(missingForDraft(companyState))) return;
    return run(async () => {
      // 회사·사용자를 먼저 저장한다. 계약 쪽이 필수값 때문에 막히더라도 여기까지는
      // 남는다 — 임시저장의 뜻이 그거다.
      await saveTenant();
      const id = await saveContract('draft');
      notify('임시저장했습니다');
      if (!contract) router.replace(`/contracts/${id}`);
      else router.refresh();
    });
  };

  /** 확정은 필수 항목 8개가 채워진 뒤에만 연다(시안 2차의 `runValidation`). */
  const openConfirm = () => {
    if (blockOnMissing(missing)) return;
    setConfirmKind('confirm');
  };

  const onConfirmOk = (result: ConfirmResult) =>
    run(async () => {
      const kind = confirmKind;
      if (!kind) return;

      if (kind === 'confirm') {
        await saveTenant();
        // create 는 한 번에 confirmed 로 만들고, draft 는 섹션 2 를 먼저 저장한 뒤 전이한다 —
        // 저장하지 않고 전이하면 화면에 보이는 값과 확정된 값이 갈린다.
        const id = await saveContract('confirmed');
        if (contract) await send(`/api/contracts/${id}/status`, 'POST', { to: 'confirmed' });
        setConfirmKind(null);
        notify('확정 처리했습니다');
        if (!contract) router.replace(`/contracts/${id}`);
        else router.refresh();
        return;
      }

      if (!contract) {
        setConfirmKind(null);
        return;
      }
      const to = kind === 'cancel' ? 'cancelled' : 'terminated';
      await send(`/api/contracts/${contract.contractId}/status`, 'POST', { to, ...result });
      setConfirmKind(null);
      // 토스트도 같은 이름을 쓴다 — 뱃지는 「계약종료」인데 토스트만 「종료」면 다른 일이 난 것처럼 읽힌다.
      notify(`${contractStatusName(statusNames, to)} 처리했습니다`);
      router.refresh();
    });

  const onAction = (key: ActionKey) => {
    switch (key) {
      case 'back':
        router.push('/tenants/contracts');
        return;
      case 'draftSave':
        void onDraftSave();
        return;
      case 'confirm':
        openConfirm();
        return;
      case 'cancel':
        setConfirmKind('cancel');
        return;
      case 'terminate':
        setConfirmKind('terminate');
        return;
      case 'docs':
        // 계약서 2종(s0300200040p1). 확정 이후에만 이 버튼이 뜬다(`ACTIONS`).
        setDocsOpen(true);
        return;
      case 'save':
        // 확정 이후의 [저장]은 **섹션 1·3 만** 저장한다. 섹션 2 는 잠겨 있어
        // PATCH 를 보내면 서버가 409 로 거절한다 — 아예 보내지 않는다.
        void run(async () => {
          await saveTenant();
          notify('저장했습니다');
          router.refresh();
        });
        return;
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadInner}>
          <div>
            <h1 className={styles.pageTitle}>{TITLES[mode]}</h1>
            <HeadNote
              mode={mode}
              missing={missing.length}
              terminatedDate={contract?.terminatedDate ?? null}
              statusNames={statusNames}
            />
          </div>
          <div className={styles.headActions}>
            {ACTIONS[mode].map((key) => {
              const def = ACTION_DEFS[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`${styles.btn} ${def.cls}`}
                  disabled={busy}
                  onClick={() => onAction(key)}
                >
                  {def.icon ? <Icon name={def.icon} size={16} /> : null}
                  {def.status ? contractStatusName(statusNames, def.status) : def.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.formScroll}>
        <div className={styles.formWrap}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <Icon name="circle-alert" size={16} />
              <span>{saveError}</span>
            </div>
          ) : null}

          <SectionCompany
            value={companyState}
            onChange={(patch) => setCompany((prev) => ({ ...prev, ...patch }))}
            disabled={frozen}
            notSaveable={!SECTION_SAVEABLE[1]}
            emailDomains={emailDomains}
            memberTypes={memberTypes}
            invalid={invalid}
            bizCheck={bizCheck}
            onBizCheck={() => setBizCheck(isBiznoFormatOk(companyState.bizno) ? 'none' : 'format')}
            onStub={notify}
          />

          <SectionContract
            items={items}
            terms={terms}
            spaces={spaces}
            codes={codes}
            editable={sec2Editable}
            invalid={invalid}
            onItems={setItems}
            onTerms={(patch) => setTerms((prev) => ({ ...prev, ...patch }))}
            onStub={notify}
          />

          <SectionUsers
            users={users}
            company={companyState}
            frozen={frozen}
            notSaveable={!SECTION_SAVEABLE[3]}
            emailDomains={emailDomains}
            onUsers={setUsers}
          />

          {/*
            ★ 첨부는 **회사에 붙는다**(계약이 아니다). 그래서 `companyId` 를 준다 —
              없으면(아직 저장 안 된 신규) 섹션이 「먼저 저장해 주세요」라고 말한다.
            ★ 이 섹션은 제 저장 경로가 있다(CONT-17). 폼의 [저장] 과 무관하게 즉시
              올라가므로 `SECTION_SAVEABLE[4]` 의 잠금 안내를 더 이상 쓰지 않는다.
          */}
          <SectionDocs
            companyId={companyId}
            memberType={companyState.memberType}
            disabled={frozen}
            onNotify={notify}
          />
        </div>
      </div>

      {confirmKind ? (
        <ConfirmDialog
          kind={confirmKind}
          busy={busy}
          statusNames={statusNames}
          onClose={() => setConfirmKind(null)}
          onOk={(result) => void onConfirmOk(result)}
        />
      ) : null}

      {/*
        ★ 계약서 2종. **폼의 현재 상태**를 넘긴다 — 저장된 값이 아니다.
          이 버튼은 `confirmed` 이후에만 뜨고 그때 섹션 2(금액 전부)는 잠겨 있어
          둘이 같다. 섹션 1·3 은 열려 있어 저장 전 편집이 있을 수 있는데,
          그때는 보고 있는 것이 찍히는 편이 덜 놀랍다.
      */}
      {docsOpen ? (
        <ContractDocumentModal
          company={{
            companyName: companyState.company,
            ceoName: companyState.ceo,
            bizNumber: companyState.bizno,
            corpNumber: companyState.corpno,
            memberType: companyState.memberType,
            tel: companyState.phone,
            // ★ 아이디만 있고 도메인을 못 고른 상태면 이메일이 아니다 — 빈칸으로 둔다.
            email: emailOf(companyState),
            /**
             * ★★ 계약서의 「주소」는 섹션 1 의 **대표자 주소**다. 그 칸의 힌트가
             *    «계약서에 인쇄되는 대표자 주소입니다» 이고, ERP 가 가진 주소는
             *    이것 하나뿐이다(`doc/CONTRACT_DOCUMENTS.md` §B).
             */
            zipCode: companyState.zip,
            address: companyState.addr1,
            addressDetail: companyState.addr2,
            memo: companyState.note1,
          }}
          terms={{
            contractDate: terms.contractDate,
            startDate: terms.startDate,
            // ★ ISO 로 넘긴다. 화면 표기(`endDateOf`, 점)를 넘기면 날짜로 인식되지 않아
            //   계약서의 이용기간이 「2026.01.15 ~ (6개월)」처럼 **종료일 없이** 인쇄된다.
            endDate: endDateIsoOf(terms.startDate, terms.months),
            periodMonths: Number(terms.months) || null,
            paymentMethod: terms.paymentMethod,
            contractRoom: terms.contractRoom || null,
            memo: terms.memo,
          }}
          items={items}
          spaces={spaces}
          codes={codes}
          onClose={() => setDocsOpen(false)}
        />
      ) : null}

      {toast ? (
        <div className={styles.toast}>
          <span className={styles.toastDot} />
          <span className={styles.toastMsg}>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 헤더 보조 안내 — 04-status.md 「헤더 보조 안내」.
 *
 * ★ 확정·취소 **일자는 표시하지 않는다.** 그 값은 `tb_s080_contract_status_history` 에
 *   들어 있는데 읽는 API 가 아직 없다(4-3 은 기록만 한다). 없는 날짜를 지어내는 대신
 *   자리를 비운다. 종료는 계약 행에 `terminated_date` 가 있어 표시된다.
 */
function HeadNote({
  mode,
  missing,
  terminatedDate,
  statusNames,
}: {
  mode: Mode;
  missing: number;
  terminatedDate: string | null;
  /** 상태 표시명 — 코드 `CONTRACT_ST`. 예전에는 「종료 / 취소 / 계약 확정」이 박혀 있었다. */
  statusNames: Readonly<Record<string, string>>;
}) {
  // ★ 저장된 상태를 가리키는 세 줄은 코드 테이블의 이름을 그대로 쓴다.
  //   `create`·`draft` 의 두 줄은 상태가 아니라 **입력 상태**라(필수 미입력 / 입력 완료)
  //   코드에 대응하는 값이 없다 — 그대로 둔다.
  if (mode === 'terminated') {
    const name = contractStatusName(statusNames, 'terminated');
    const day = terminatedDate ? formatDot(terminatedDate) : '';
    return (
      <div className={`${styles.pageNote} ${styles.pageNoteMuted}`}>{day ? `${day} ${name}` : name}</div>
    );
  }
  if (mode === 'cancelled') {
    return (
      <div className={`${styles.pageNote} ${styles.pageNoteMuted}`}>
        {contractStatusName(statusNames, 'cancelled')}
      </div>
    );
  }
  if (mode === 'confirmed') {
    return (
      <div className={`${styles.pageNote} ${styles.pageNoteMuted}`}>
        {contractStatusName(statusNames, 'confirmed')}
      </div>
    );
  }
  if (missing > 0) {
    return <div className={`${styles.pageNote} ${styles.pageNoteWarning}`}>필수 항목 {missing}개 미입력</div>;
  }
  return (
    <div className={`${styles.pageNote} ${styles.pageNoteOk}`}>
      <Icon name="circle-check" size={12} />
      입력 완료
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   초기값
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 섹션 1 초기값. 저장된 입주사가 있으면 그 값으로 채운다.
 *
 * ★ 회원구분은 **저장값이 목록에 있을 때만** 쓴다. `MEMBER_TYPE` 코드 마스터와 화면의
 *   3종은 같은 이름의 다른 개념이라(§C-3 ⑤) 옛 값이 들어 있을 수 있는데, Select 에
 *   없는 값을 넣으면 브라우저가 첫 옵션으로 되돌리고 그대로 저장돼 값이 바뀐다.
 */
function seedCompany(
  company: CompanyResponse | null,
  emailDomains: readonly string[],
  memberTypes: readonly CodeOption[],
): CompanyState {
  /**
   * ★ 저장된 값이 목록에 없으면 **비워 둔다.** 예전에는 첫 값(「프리랜서」)으로
   *   되돌렸는데, 코드 체계로 바뀐 지금 그러면 아무 회사나 조용히 「주식회사」가 된다.
   *   회원구분은 필수 항목이 아니라(`REQUIRED_FIELDS`) 비워 두어도 저장이 막히지 않는다 —
   *   운영자가 직접 고르게 두는 편이 낫다.
   *
   *   지금 `tb_s080_companies.member_type` 에는 「개인사업자」가 들어 있다. 코드가 아니라
   *   표시명이라 어느 코드와도 맞지 않는다(`doc/CODE_MASTER_ANALYSIS.md` §A-2 · §G-3).
   */
  const known = memberTypes.some((t) => t.code === (company?.memberType ?? ''));
  return {
    company: company?.companyName ?? '',
    bizno: company?.bizNumber ?? '',
    memberType: known ? (company?.memberType as string) : '',
    corpno: company?.corpNumber ?? '',
    // ★ 화면 「업종」 ↔ DB `business_item`(종목), 화면 「업태」 ↔ `business_type`.
    industry: company?.businessItem ?? '',
    bizKind: company?.businessType ?? '',
    ceo: company?.ceoName ?? '',
    phone: company?.tel ?? '',
    ...splitEmail(company?.email ?? null, emailDomains),
    // ★ 대표자 자택 주소다. 사업장 주소(`address`)를 읽지 않는다.
    zip: company?.ceoZipCode ?? '',
    addr1: company?.ceoAddress ?? '',
    addr2: company?.ceoAddressDetail ?? '',
    note1: company?.memo ?? '',
  };
}

/**
 * 섹션 3 초기값. 저장된 구성원이 없으면 빈 줄 하나로 시작한다 —
 * 1행은 섹션 1 대표자를 미러링하는 자리라 **항상 있어야 한다.**
 */
function seedUsers(members: readonly MemberResponse[], emailDomains: readonly string[]): UserRow[] {
  if (members.length === 0) return [{ ...USER_TEMPLATE }];
  return members.map((m) => {
    const { emailId, emailDomain, emailDomainCustom } = splitEmail(m.email, emailDomains);
    return {
      memberId: m.memberId,
      name: m.name,
      phone: m.phone ?? '',
      mailId: emailId,
      // 섹션 1 과 같은 모양으로 담는다 — 목록에 없는 도메인은 「직접입력」으로 열린다.
      domain: emailDomain,
      domainCustom: emailDomainCustom,
      memo: m.memo ?? '',
      selected: true,
    };
  });
}

/** 1행은 섹션 1 대표자를 미러링하므로 이름이 그쪽에서 온다. */
function effectiveName(row: UserRow, index: number, company: CompanyState): string {
  return (index === 0 ? company.ceo : row.name).trim();
}

/**
 * 그 건물의 **첫 번째 층**. 호실 목록에 나오는 순서를 그대로 따른다.
 *
 * ★ 층 Select 에는 「전체 층」이 없다 — 층은 항상 하나가 골라져 있다. 비워 두면
 *   호실 목록이 건물 전체로 열려, 층을 고르지 않은 채 다른 층 호실을 계약에 넣을 수 있다.
 */
function firstFloorOf(spaces: readonly SpaceOption[], buildId: string): string {
  return spaces.find((s) => s.buildId === buildId)?.floorId ?? '';
}

function seedTerms(contract: ContractResponse | null, spaces: readonly SpaceOption[]): TermsState {
  if (!contract) {
    const buildId = spaces[0]?.buildId ?? '';
    return {
      // 건물이 하나뿐이라 첫 값을 기본으로 둔다. 비워 두면 저장이 「건물 는 필수다」로 막힌다.
      buildId,
      floorId: firstFloorOf(spaces, buildId),
      contractRoom: '',
      paymentMethod: '',
      accessRoute: '',
      contractDate: localToday(),
      months: '',
      startDate: localToday(),
      memo: '',
    };
  }
  return {
    buildId: contract.buildId,
    floorId: firstFloorOf(spaces, contract.buildId),
    contractRoom: contract.contractRoom ?? '',
    paymentMethod: contract.paymentMethod ?? '',
    accessRoute: contract.accessRoute ?? '',
    contractDate: toDateInput(contract.contractDate),
    months: contract.periodMonths ? String(contract.periodMonths) : '',
    startDate: toDateInput(contract.startDate),
    memo: contract.memo ?? '',
  };
}

function seedItems(contract: ContractResponse | null): ItemRow[] {
  if (!contract || contract.spaces.length === 0) return [{ ...ROW_TEMPLATE }];
  return contract.spaces.map((s) => ({
    roomType: s.roomType,
    spaceId: s.spaceId,
    standardFee: s.standardFee,
    deposit: s.deposit,
    monthlyFee: s.monthlyFee,
    vatYn: s.vatYn,
  }));
}

/**
 * API 가 준 날짜 → `<input type="date">` 가 받는 `YYYY-MM-DD`.
 *
 * ★★ **`slice(0, 10)` 을 쓰지 않는다.** 계약의 날짜 칸은 `timestamp`/`date` 이고 pg 는
 *    그것을 **로컬 자정의 Date** 로 준다. JSON 을 거치면 `2026-01-14T15:00:00.000Z`
 *    (KST 기준 1월 15일)가 되므로, 앞 10자를 자르면 **하루 앞선 날짜**가 나온다.
 *    로컬 구성요소로 다시 조립해야 원래 날짜가 된다.
 */
function toDateInput(value: string | null): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY.MM.DD` — 헤더 보조 안내의 표기다. */
function formatDot(value: string): string {
  const iso = toDateInput(value);
  return iso ? iso.replace(/-/g, '.') : '';
}

/**
 * 계약서에 찍히는 대표자 이메일 — 「아이디@도메인」.
 *
 * ★ 둘 중 하나라도 비면 **빈 문자열**이다. 「kim@」 같은 반쪽을 계약서에 찍지 않는다.
 *   빈 값이면 문서가 기입선을 그린다.
 */
function emailOf(c: CompanyState): string {
  const id = c.emailId.trim();
  const domain = currentDomain(c).trim();
  return id && domain ? `${id}@${domain}` : '';
}
