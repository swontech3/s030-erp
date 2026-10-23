'use client';

/** @screen s030200040 계약 폼 · 020 입주사관리 · 1차 */

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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { editableSections } from '@swonbiz/shared/domain/contract-status';
import { Icon, type IconName } from '@/components/ds';
import styles from './contract-form.module.css';
import { ConfirmDialog, localToday, type ConfirmKind, type ConfirmResult } from './ConfirmDialog';
import { contractStatusName, contractStatusNamesOf } from './contract-status-name';
import { ContractDocumentModal } from './ContractDocumentModal';
import { SectionCompany, type BizCheck } from './SectionCompany';
import { SectionContract } from './SectionContract';
import { RoomPickerModal } from './RoomPickerModal';
import { bizRegPatch, type BizRegFields } from '@swonbiz/shared/domain/biz-reg-ocr';
import { isBizNumberFormatOk, type BizCheckResult } from '@swonbiz/shared/domain/biz-number-check';
import { missingDocsMessage, type FilePurpose } from '@swonbiz/shared/domain/contract-files';
import {
  buildRenewalSeed,
  selfContractIds,
  type RenewalSource,
} from '@swonbiz/shared/domain/contract-renewal';
import type { SpaceHolder } from '@swonbiz/shared/domain/space-occupancy';
import { billingHref } from '@/features/billing/billing-model';
import { SectionDocs, SECTION_DOCS_ID } from './SectionDocs';
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
  freeLabel,
  freeMonthsError,
  missingForDraft,
  missingRequired,
  userDomain,
  splitEmail,
  toNumber,
  totalsOf,
  withAutoLines,
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
  /** 무상 개월수. 서버가 늘 보낸다(기본 0). */
  freeMonths: number;
  startDate: string;
  endDate: string;
  terminatedDate: string | null;
  terminationReason: string | null;
  memo: string | null;
  /** CSCH-04 — 이어받은 이전 계약. 재계약이 아니면 `null`. */
  renewedFromContractId: string | null;
  /**
   * 종료된 계약의 정산 상태 — 처리 대기 / 처리 완료 / 정산할 것 없음(`null`).
   * 판정은 정산 탭과 같은 `pendingKind`(서버). 계약 폼 머리의 「정산 결과 보기」가 쓴다.
   */
  settlementState?: 'pending' | 'done' | null;
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
  /**
   * 삐용 연동 상태(3-2). 계약을 확정하면 삐용에도 회사가 만들어지고, 그 결과가 여기다.
   *
   * ★ `status: 'pending'` 이면 **계약은 확정됐고 삐용 연결만 아직**이다. 그 상태를
   *   화면에 띄우지 않으면 아무도 모르고 지나가고, 그 회사 대표는 영원히 로그인할 수
   *   없다 — 그 사실은 대표가 전화할 때나 드러난다.
   */
  bbiyong?: BbiyongLinkState;
}

/** `GET /companies/:id` 의 `bbiyong` 칸. */
export interface BbiyongLinkState {
  orgId: number | null;
  orgCode: string | null;
  /** `'linked'` · `'pending'` · `null`(계약 확정 전 = 연동 대상 아님). */
  status: string | null;
  /** ★ 운영자에게 **그대로 보여주는** 문구. 연결된 뒤에는 비어 있다. */
  reason: string | null;
}

/** 3-4 의 `GET /companies/:id/members`. */
export interface MemberResponse {
  memberId: string;
  name: string;
  phone: string | null;
  email: string | null;
  isRepresentative: boolean;
  memo: string | null;
  /** 삐용 직원정보 연동 상태(035) — **조회 전용**. 사유가 있으면 화면이 그대로 보인다. */
  bbiyong?: { memberId: number | null; reason: string | null };
}

type Mode = 'create' | 'draft' | 'confirmed' | 'terminated' | 'cancelled';

/**
 * Navigation API 중 [이전] 이 쓰는 부분만. `lib.dom` 에 아직 없어서 여기서 좁게 적는다.
 *
 * ★ 전부 물음표다 — 이 API 가 없는 브라우저면 [이전] 은 목록으로 간다. 그게 지금까지의
 *   동작이라 나빠지지 않는다.
 */
interface NavigationLike {
  currentEntry?: { index: number };
  entries?: () => { url?: string }[];
}

interface Props {
  /** `null` 이면 신규 작성(mode: create)이다. */
  contract: ContractResponse | null;
  /**
   * 지금 상태가 된 시각 — 확정·취소의 날짜다(상태 이력에서 읽는다, CONT-11).
   *
   * ★ **종료는 여기 오지 않는다.** 종료는 사람이 고른 `terminatedDate` 를 쓴다 —
   *   「언제까지 쓰는가」와 「언제 눌렀는가」는 다르고, 계약서·정산이 보는 것은 앞쪽이다.
   * ★ 이력을 못 읽었으면 `null` 이고, 그때는 날짜 없이 상태 이름만 나온다.
   */
  statusChangedAt: string | null;
  /**
   * 재계약(`/contracts/new?renewFrom=`)에서 **이어받을 이전 계약**. 그 밖에는 `null`.
   *
   * ★ `contract` 와 동시에 오지 않는다. 이어받기는 **첫 값을 채우는 일**이라 저장된
   *   계약을 다시 열 때는 할 일이 없다 — 그때는 저장된 `renewedFromContractId` 가
   *   「자기」 목록을 만든다.
   */
  renewFrom: ContractResponse | null;
  /** 어느 입주사의 계약인지. 없으면 저장할 수 없다. */
  companyId: string | null;
  /** 섹션 1 의 저장값. 신규 작성이고 입주사가 정해지지 않았으면 `null`. */
  company: CompanyResponse | null;
  /** 섹션 3 의 저장값. */
  members: MemberResponse[];
  spaces: SpaceOption[];
  codes: CodeOption[];
  /**
   * 살아 있는 계약(계약중·계약대기)이 붙들고 있는 호실들 — 섹션 2 의 호실 셀렉트가
   * 이것으로 거른다.
   *
   * ★ **자기 계약도 들어 있다.** 뺄지 말지는 `occupancyBySpace` 가 가른다 —
   *   자기 것으로 세면 열어서 그대로 저장할 때 자기 호실이 목록에서 사라진다.
   */
  spaceHolders: SpaceHolder[];
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
  // ★ 재계약은 아래 `RENEWAL_ACTIONS` 로 갈아 끼운다 — 모드는 그대로 `create` 다.
  draft: ['back', 'cancel', 'draftSave', 'confirm'],
  confirmed: ['back', 'docs', 'terminate', 'save'],
  terminated: ['back', 'docs'],
  cancelled: ['back', 'docs'],
};

/**
 * 재계약의 헤더 버튼 — **[임시저장] 이 없다.**
 *
 * ★★ 재계약은 입주사가 **계약 의사를 밝힌 것**이라 작성 중 상태가 필요 없다.
 *    임시저장을 두면 「아직 계약이 아닌 재계약」이 생기고, 그동안 이전 계약은 닫히지
 *    않은 채 두 계약이 같은 호실을 들고 있게 된다 — 아무도 그걸 정리하지 않는다.
 *
 * ★ 그래서 **이전 계약을 닫는 시점도 하나**로 정해진다: 확정하는 순간.
 *
 * ★ 재계약하기로 했다가 안 하게 되면 **[계약종료]** 로 처리한다. 확정된 계약이라
 *   계약취소는 없다(`assertTransition` 에 `confirmed → cancelled` 가 없다).
 */
const RENEWAL_ACTIONS: readonly ActionKey[] = ['back', 'confirm'];

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

export function ContractForm({
  contract,
  statusChangedAt,
  renewFrom,
  companyId,
  company,
  members,
  spaces,
  codes,
  spaceHolders,
}: Props) {
  const router = useRouter();
  const status = contract?.status ?? null;
  const mode: Mode = (contract?.status as Mode | undefined) ?? 'create';

  /**
   * ★ 이어받을 계약은 **아직 저장 전일 때만** 본다. 저장된 계약을 다시 열면
   *   `?renewFrom=` 이 주소에 남아 있어도 값을 다시 덮으면 안 된다 — 사람이 고쳐 둔
   *   조건이 되돌아간다.
   */
  const renewal = contract ? null : renewFrom;

  /**
   * ★★★ 이 편집이 «자기»로 보는 계약들. **여기가 재계약의 핵심 한 줄이다.**
   *
   * 재계약은 이전 계약이 살아 있는 동안 만들어진다(자동 종료가 없다). 이전 계약을
   * 자기로 보지 않으면 **재계약이 자기 이전 계약과 부딪혀 저장이 막힌다** —
   * 계약호실 중복에서 한 번, 호실 입주 계산에서 또 한 번.
   *
   * 서버도 같은 함수를 부른다(`routes/contracts.ts`). 두 벌이면 화면은 통과시키는데
   * 서버가 거절한다.
   */
  /** 저장된 계약은 저장된 값이 정본이다. 저장 전에는 지금 이어받는 계약이다. */
  const renewedFromId = contract?.renewedFromContractId ?? renewal?.contractId ?? null;

  const self = selfContractIds({
    contractId: contract?.contractId ?? null,
    renewedFromContractId: renewedFromId,
  });

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
  const [terms, setTerms] = useState<TermsState>(() => seedTerms(contract, renewal, spaces));
  const [items, setItems] = useState<ItemRow[]>(() => seedItems(contract, renewal));
  const [users, setUsers] = useState<UserRow[]>(() => seedUsers(members, emailDomains));
  const [invalid, setInvalid] = useState<RequiredKey[]>([]);
  const [bizCheck, setBizCheck] = useState<BizCheck>({ kind: 'idle' });
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  /** 계약서 2종 미리보기(s030200040p1). 확정 이후에만 열린다. */
  const [docsOpen, setDocsOpen] = useState(false);
  /** 계약호실 확인 팝업(s030200040p3). 계약호실은 이 팝업으로만 넣는다. */
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 삐용 연동 상태(3-2). 서버가 준 값으로 시작하고, 확정·재시도가 그 자리에서 갱신한다.
   *
   * ★ 서버 값으로 **시작하는** 것이 중요하다. 확정 응답만 보고 배너를 띄우면 새로
   *   고치는 순간 사라지고, 「계약은 됐는데 연결은 아직」인 회사가 조용히 남는다.
   */
  const [link, setLink] = useState<BbiyongLinkState | null>(company?.bbiyong ?? null);
  /**
   * 연동 대상 회사. 저장된 계약이면 그 계약의 회사이고, 없으면 폼이 받은 회사다.
   *
   * ★ 새로 만드는 계약(둘 다 `null`)에서는 배너가 뜨지 않는다 — 확정하면 `router.replace`
   *   로 저장된 계약 화면으로 넘어가고, 그때 서버 값으로 다시 판정된다.
   */
  const linkCompanyId = contract?.companyId ?? companyId;

  /**
   * 삐용 직원정보 연동 대기(035) — 구성원 행에 남은 사유들.
   *
   * ★ 회사 연동(`link`)과 **다른 일이다.** 회사는 연결됐는데 직원 한 명의 이메일이
   *   겹쳐 반영되지 않는 상태가 있고, 그걸 회사 배너로 말하면 운영자가 엉뚱한 곳을 본다.
   * ★★ [다시 시도] 버튼이 **없다.** 고칠 자리가 바로 아래 섹션 3 이고, 고쳐서 저장하면
   *    그게 재시도다(한 업무는 한 화면에서 — 처리 버튼을 늘리지 않는다).
   */
  /**
   * 입주사 정보는 저장됐으나 삐용 회사 수정이 실패한 사유(결정 2026-10-23). **DB 에 남기지 않으므로**
   * 화면 배너로만 알린다 — 다시 [저장] 하면 값 있는 다섯 칸을 다시 보낸다. [다시 시도] 대상이 아니다.
   */
  const [companySyncWarning, setCompanySyncWarning] = useState<string | null>(null);

  const memberPending = users
    .map((row, index) => ({ name: effectiveName(row, index, companyState), reason: row.linkReason }))
    .filter((u): u is { name: string; reason: string } => Boolean(u.reason));

  /**
   * ★ 자동 줄(할인 · 무상)은 특기사항 **맨 위에만** 들어간다. 사용자가 쓴 줄은
   *   보존한다. 금액·무상 개월수가 바뀔 때만 손대고, 그 혜택이 사라지면 그 줄만
   *   빠진다(05-logic §4).
   *
   * ★★ **순서는 할인이 먼저다.** 할인은 계약서 제8조 3항이 이미 말하는 것이고,
   *    무상 줄은 그 조항이 없어 특기사항이 유일한 근거다(`freeLabel` 머리말).
   */
  const totals = totalsOf(items);
  const discount = discountLabel(totals.standardFee, totals.monthlyFee);
  const free = freeLabel(toNumber(terms.freeMonths));
  useEffect(() => {
    if (!sec2Editable) return; // 잠긴 계약의 저장값을 화면이 고쳐 쓰지 않는다
    setTerms((prev) => {
      const next = withAutoLines(prev.memo, [discount, free]);
      return next === prev.memo ? prev : { ...prev, memo: next };
    });
  }, [discount, free, sec2Editable]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /**
   * ★ `useCallback` 이 필요하다. 이 함수가 섹션 4 의 `load` 의존성이라, 매 렌더 새로
   *   만들어지면 **첨부 목록을 무한히 다시 불러온다**(불러오기 → 상태 갱신 → 재렌더 →
   *   새 `notify` → 다시 불러오기). 섹션 4 에 첨부 목록을 물어보게 되면서 드러난 자리다.
   */
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const missing = missingRequired(companyState, terms);

  /* ── 사업자등록증 판독 결과를 섹션 1 에 얹는다 ───────────────────────────
     섹션 4 에서 사업자등록증을 올리면 그 업로드가 첨부와 판독을 같이 하고,
     읽어 낸 값이 여기로 온다(`SectionDocs.onBizReg`).

     ★ 이 함수가 섹션 1 에 있지 않고 폼에 있는 이유 — 섹션 1 의 상태(`companyState`)와
       사업자번호 확인 상태(`bizCheck`)를 둘 다 아는 곳이 여기뿐이다.

     ★ **non-null 만 덮는다**(`bizRegPatch`). 못 읽은 칸을 빈 값으로 덮으면 사람이
       이미 적어 둔 값이 지워진다. 판독은 도우미지 정본이 아니다.

     ★★ **사업자번호를 덮었으면 확인 상태를 되돌린다.** 되돌리지 않으면 앞 번호로
        받은 판정이 새 번호에 그대로 남아, 아무도 확인한 적 없는 번호가 확인된
        것으로 보인다. `'none'` 이 이 화면의 「아직 확인 안 함」이다.

     돌려주는 값은 **덮은 칸 수**다 — 섹션 4 가 「n개 항목을 불러왔습니다」를 말한다. */
  /* ── 아직 입주사가 없을 때 고른 첨부 파일 ────────────────────────────────
     첨부는 **회사에 붙는다**. 그래서 신규 폼에서는 지금 올릴 수 없다. 그렇다고
     파일 고르기까지 막으면 사업자등록증으로 섹션 1 을 채울 수가 없다 —
     판독이 가장 쓸모 있는 순간이 그 빈 화면이다.

     ★ **이 상태가 섹션 4 가 아니라 여기 있는 이유** — 첫 저장 뒤 폼은
       `/contracts/{id}` 로 이동하고 그때 섹션이 통째로 다시 마운트된다. 섹션이
       들고 있으면 붙들어 둔 파일이 그 순간 사라진다. 그래서 이동 **전에** 올려야
       하고, 그 시점을 아는 것은 저장 흐름을 가진 이 컴포넌트뿐이다. */
  const [pendingDocs, setPendingDocs] = useState<Partial<Record<FilePurpose, File>>>({});

  const setPendingDoc = (purpose: FilePurpose, file: File | null) =>
    setPendingDocs((prev) => {
      const next = { ...prev };
      if (file) next[purpose] = file;
      else delete next[purpose];
      return next;
    });

  /* ── 계약확정 게이트 — 필수 서류가 없으면 확정하지 못한다 ────────────────
     ★★ 판정은 `missingDocsMessage` 한 곳이다. **서버가 같은 함수로 다시 본다**
        (`routes/contracts.ts`) — 화면만 막으면 API 를 직접 부르는 길이 열려 있고,
        서류 없이 확정된 계약은 나중에 아무도 알아채지 못한다.

     ★ 임시저장은 이 값을 보지 않는다. 사업자등록 신청 중인 회사는 등록증이 아직
       없고, 그 상태로 자리를 잡아 두는 것이 계약대기의 쓸모다.

     ★ **붙들고 있는 파일도 「있는 것」으로 센다.** 확정 흐름이 `flushPendingDocs()`
       로 먼저 올리고 나서 확정하므로, 서버가 볼 때는 이미 붙어 있다. 안 세면
       방금 고른 파일을 두고 「없습니다」라고 말하게 된다. */
  const [attachedDocs, setAttachedDocs] = useState<FilePurpose[]>([]);
  /** [계약확정] 을 눌러 막힌 적이 있는가. 누르기 전에는 빨간 안내를 띄우지 않는다. */
  const [docsChecked, setDocsChecked] = useState(false);

  const docsMissingText = missingDocsMessage(companyState.memberType, [
    ...attachedDocs,
    ...Object.keys(pendingDocs),
  ]);

  /**
   * 회원구분의 표시명. 섹션 4 가 「규칙 밖」 서류의 이유 한 줄에 쓴다.
   *
   * ★ 안 고른 상태(`''`)면 빈 문자열이고, 그때 문장을 어떻게 맺을지는 섹션이 아니라
   *   `offRuleNote` 가 정한다 — 문구는 한 곳이다.
   */
  const memberTypeName =
    memberTypes.find((t) => t.code === companyState.memberType)?.name ?? '';

  /**
   * 붙들고 있던 파일을 올린다. **회사가 막 생긴 직후, 이동하기 전에** 부른다.
   *
   * ★ 한 장이 실패해도 나머지를 계속 올린다. 그리고 **저장 자체를 실패시키지 않는다** —
   *   회사와 계약은 이미 저장됐고, 여기서 던지면 화면이 「저장 실패」로 보인다.
   *   실패한 것은 붙들고 있던 자리에 그대로 남겨 다시 시도할 수 있게 둔다.
   */
  async function flushPendingDocs(forCompany: string): Promise<void> {
    const entries = Object.entries(pendingDocs) as [FilePurpose, File][];
    if (entries.length === 0) return;

    const failed: FilePurpose[] = [];
    for (const [purpose, file] of entries) {
      try {
        const res = await fetch(`/api/companies/${forCompany}/files?purpose=${purpose}`, {
          method: 'POST',
          headers: {
            'content-type': file.type,
            // ★ 한글 파일명이 헤더에 그대로 들어가면 규격 위반이라 프록시가 끊는다.
            'x-file-name': encodeURIComponent(file.name),
          },
          body: file,
        });
        if (!res.ok) failed.push(purpose);
      } catch {
        failed.push(purpose);
      }
    }
    // 올라간 것만 손에서 놓는다.
    setPendingDocs((prev) => {
      const next: Partial<Record<FilePurpose, File>> = {};
      for (const p of failed) if (prev[p]) next[p] = prev[p];
      return next;
    });
    if (failed.length > 0) notify(`첨부 ${failed.length}건을 올리지 못했습니다. 다시 시도해 주세요`);
  }

  const applyBizReg = (fields: BizRegFields): number => {
    const { patch, applied, resetBizCheck } = bizRegPatch(
      fields,
      memberTypes.map((t) => t.code),
    );
    if (applied === 0) return 0;
    setCompany((prev) => ({ ...prev, ...patch }));
    if (resetBizCheck) setBizCheck({ kind: 'idle' });
    return applied;
  };

  /* ── 사업자번호 확인 ─────────────────────────────────────────────────────
     국세청 상태와 ERP 중복을 **한 번에** 본다. 버튼이 하나라 호출도 하나다.

     ★ 형식이 틀리면 **부르지 않는다.** 남의 API 를 쓰레기로 두드리지 않는다.
     ★ 여기가 실패해도 계약 등록은 그대로 된다 — 확인은 저장 경로가 아니다.
       그래서 실패를 `saveError` 가 아니라 토스트로 알린다. */
  const runBizCheck = async () => {
    const digits = companyState.bizno.replace(/\D/g, '');
    if (!isBizNumberFormatOk(digits)) {
      setBizCheck({ kind: 'format' });
      return;
    }
    setBizCheck({ kind: 'checking' });
    try {
      const query = new URLSearchParams({ bizNumber: digits });
      // ★ 회사명도 같이 보낸다 — 같은 상호가 있는지 **알려만 주려고**. 막지 않는다.
      //   비어 있으면 보내지 않는다: 빈 이름끼리 걸리면 전부 중복이 된다.
      if (companyState.company.trim()) query.set('companyName', companyState.company.trim());
      // ★ 자기 자신을 중복으로 보고하지 않게 지금 편집 중인 회사를 알려 준다.
      if (companyId) query.set('selfCompanyId', companyId);
      const res = await fetch(`/api/companies/biz-check?${query.toString()}`, { cache: 'no-store' });
      const body = (await res.json()) as BizCheckResult & { message?: string };
      if (!res.ok) throw new Error(body.message ?? '확인하지 못했습니다');
      setBizCheck({ kind: 'done', result: body });
    } catch (err) {
      setBizCheck({ kind: 'idle' });
      notify(`${(err as Error).message} · 등록은 그대로 진행할 수 있습니다`);
    }
  };

  /* ── 저장 ────────────────────────────────────────────────────────────── */

  /** 화면 값 → 4-3 이 받는 본문. 파생값도 함께 보낸다 — **서버가 대조해서 다시 계산한다.** */
  const payload = () => ({
    buildId: terms.buildId,
    contractRoom: terms.contractRoom || null,
    paymentMethod: terms.paymentMethod,
    accessRoute: terms.accessRoute || null,
    contractDate: terms.contractDate || null,
    periodMonths: toNumber(terms.months),
    freeMonths: toNumber(terms.freeMonths),
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
      /** 입주사를 새로 만든 경우에만 온다(`POST /api/companies`). */
      companyId?: string;
      members?: { memberId: string }[];
      /**
       * 삐용에 아직 반영되지 않은 구성원들(`PUT /companies/:id/members`, 035).
       * 비어 있으면 전부 반영됐거나 보낼 것이 없었다(= 계약 확정 전).
       */
      bbiyongPending?: { memberId: string; name: string; reason: string }[];
      /**
       * 삐용 연동 결과(3-2) — 확정하는 두 경로(`POST /contracts` · `POST .../status`)가
       * 함께 내려준다. `'pending'` 이면 **계약은 확정됐고 연결만 아직**이다.
       */
      bbiyong?: string | null;
      bbiyongReason?: string | null;
      /**
       * 삐용 회사 수정 결과(`PATCH /companies/:id`, 결정 2026-10-23). null = 보내지 않았다(미연결 등).
       * ★ DB 에 남지 않는다 — 실패는 화면 배너로만 알린다(`companySyncWarning`).
       */
      companySync?: { kind: 'ok' } | { kind: 'failed'; reason: string } | null;
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
  async function saveTenant(): Promise<string> {
    const ownerEmail = joinEmail(companyState.emailId, currentDomain(companyState));

    const body = {
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
    };

    /**
     * ★★ `companyId` 가 없으면 **여기서 입주사를 만든다.** `[신규 입주사 등록]` 이
     *    `/contracts/new` 를 그냥 열기 때문이다 — 예전에는 별도 모달이 회사를 먼저
     *    만들었고, 그 모달은 저장 경로가 없어 아무것도 남지 않았다.
     *
     * ★ 건물은 섹션 2 의 값을 그대로 보낸다. `NOT NULL` 인데 화면이 아는 값이
     *   거기뿐이고, 새 폼은 건물이 하나라 기본값이 이미 채워져 있다(`seedTerms`).
     *
     * ★ 삐용 회사·대표 등록은 **아직 붙지 않는다**(3-2, ROADMAP 작업 15).
     *   지금 만드는 것은 ERP 의 입주사 행 하나다.
     */
    let id: string;
    if (!companyId) {
      const created = await send('/api/companies', 'POST', { ...body, buildId: terms.buildId });
      if (!created.companyId) throw new Error('저장은 됐는데 입주사 ID 가 오지 않았습니다');
      id = created.companyId;
    } else {
      id = companyId;
      const patched = await send(`/api/companies/${id}`, 'PATCH', body);
      // ★ 저장할 때마다 다시 보낸다 — 성공 · 안 보냄이면 앞의 실패 배너를 지운다.
      setCompanySyncWarning(patched.companySync?.kind === 'failed' ? patched.companySync.reason : null);
    }

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

    const saved = await send(`/api/companies/${id}/members`, 'PUT', {
      members: kept.map((k) => k.payload),
    });

    // 서버가 돌려준 순서는 우리가 보낸 순서(sort_order)와 같다.
    const assigned = saved.members ?? [];
    /**
     * 삐용에 아직 반영되지 않은 사람들 — ERP member_id → 사유 (035).
     *
     * ★ 사유는 **매번 다시 쓴다.** 남겨 두면 이메일을 고쳐 반영된 뒤에도 옛 사유가
     *   화면에 남고, 운영자는 고치지 않은 줄 안다.
     */
    const pendingBy = new Map((saved.bbiyongPending ?? []).map((p) => [p.memberId, p.reason]));
    setUsers((prev) =>
      prev.map((row, index) => {
        // ★ 길이가 어긋나면 id 를 건드리지 않는다 — 엉뚱한 사람에게 남의 id 를 붙이지 않는다.
        const at = assigned.length === kept.length ? kept.findIndex((k) => k.index === index) : -1;
        const memberId = at >= 0 ? (assigned[at]?.memberId ?? row.memberId) : row.memberId;
        return { ...row, memberId, linkReason: memberId ? (pendingBy.get(memberId) ?? null) : null };
      }),
    );

    // ★ 만들었든 고쳤든 **확정된 입주사 ID** 를 돌려준다. 계약 저장이 이 값을 쓴다 —
    //   새로 만든 경우 `companyId` prop 은 아직 `null` 이라 그걸 보면 안 된다.
    return id;
  }

  /** 계약을 만들거나(create) 고친다(draft). 돌려주는 값은 계약 ID 다. */
  async function saveContract(nextStatus: 'draft' | 'confirmed', forCompany: string): Promise<string> {
    if (contract) {
      await send(`/api/contracts/${contract.contractId}`, 'PATCH', payload());
      return contract.contractId;
    }
    const data = await send('/api/contracts', 'POST', {
      ...payload(),
      companyId: forCompany,
      status: nextStatus,
      /*
       * ★ 재계약 이력(CSCH-04). 서버가 이 값이 **정말 이 회사 계약인지** 다시 본다
       *   (`rejectRenewal`) — 주소창에서 온 값이라 화면을 믿지 않는다.
       *
       * ★ 이전 계약은 그대로 둔다. 자동 종료가 없다.
       */
      renewedFromContractId: renewal?.contractId ?? null,
    });
    applyLink(data);
    if (!data.contractId) throw new Error('저장은 됐는데 계약 ID 가 오지 않았습니다');
    return data.contractId;
  }

  /**
   * 확정 응답의 삐용 연동 결과를 배너에 반영한다.
   *
   * ★ 확정이 아닌 응답에는 `bbiyong` 이 없다(`null`). 그때는 **건드리지 않는다** —
   *   덮어쓰면 임시저장 한 번으로 「연동 대기」 배너가 사라진다.
   */
  function applyLink(data: { bbiyong?: string | null; bbiyongReason?: string | null }): void {
    if (!data.bbiyong) return;
    setLink((prev) => ({
      orgId: prev?.orgId ?? null,
      orgCode: prev?.orgCode ?? null,
      status: data.bbiyong === 'pending' ? 'pending' : 'linked',
      reason: data.bbiyongReason ?? null,
    }));
  }

  /**
   * [다시 시도] — 삐용 회사 등록을 한 번 더.
   *
   * ★★ 이 버튼은 **이 화면에만 있다.** 삐용 회사 생성은 계약 확정의 뒷부분이고,
   *    확정을 누르는 자리가 여기다. 입주사 목록은 「미연동」을 보여 주기만 한다
   *    (`CLAUDE.md` 한 업무 한 화면).
   *
   * ★ 서버가 멱등이다 — 이미 연결된 회사는 `already` 로 답하고 삐용을 부르지 않는다.
   *   두 번 눌러 회사가 둘 만들어지는 일이 없다.
   */
  const retryLink = (forCompany: string) =>
    run(async () => {
      const res = await fetch(`/api/companies/${encodeURIComponent(forCompany)}/bbiyong-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        bbiyong?: string;
        orgCode?: string | null;
        orgId?: number | null;
        reason?: string | null;
      };
      if (!res.ok) throw new Error(data.message ?? '다시 시도하지 못했습니다');

      /*
       * ★ [다시 시도] 는 등록만이 아니다 — 회사 상태에 따라 퇴실·재입주도 한다
       *   (`retryBbiyongForCompany`). `pending` 만이 아직이고 나머지는 다 끝난 것이다:
       *     linked  새로 등록했다        already  이미 등록돼 있었다
       *     synced  퇴실·재입주를 보냈다  skipped  보낼 것이 없었다
       * ★★ 목록에 없는 값이 와도 **대기로 떨어지지 않게** `pending` 만 본다. 서버가
       *    결과 종류를 더 늘렸을 때 화면이 멀쩡한 회사에 배너를 띄우지 않는다.
       */
      const done = data.bbiyong !== 'pending';
      setLink({
        orgId: data.orgId ?? null,
        orgCode: data.orgCode ?? link?.orgCode ?? null,
        status: done ? 'linked' : 'pending',
        reason: done ? null : (data.reason ?? null),
      });
      notify(done ? '삐용에 반영했습니다' : (data.reason ?? '아직 연결하지 못했습니다'));
    });

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
   * 무상 개월수가 틀렸으면 저장을 막고 **사람에게 할 말**을 띄운다. 막았으면 `true`.
   *
   * ★★ 서버도 같은 규칙으로 막는다(`requireFreeMonths` → 400). 화면에서 먼저 말해
   *    주지 않으면 운영자가 개발자 말투의 예외 문구를 보게 된다.
   * ★ 임시저장에도 건다 — 저장해 두면 확정할 때 이유 없이 막힌다.
   */
  const blockOnFreeMonths = (): boolean => {
    const message = freeMonthsError(terms.months, terms.freeMonths);
    if (!message) return false;
    setInvalid([]);
    setSaveError(message);
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
    if (blockOnFreeMonths()) return;
    return run(async () => {
      // 회사·사용자를 먼저 저장한다. 계약 쪽이 필수값 때문에 막히더라도 여기까지는
      // 남는다 — 임시저장의 뜻이 그거다.
      const savedCompanyId = await saveTenant();
      // ★ 회사가 생긴 직후, **이동하기 전에** 붙들고 있던 첨부를 올린다.
      await flushPendingDocs(savedCompanyId);
      const id = await saveContract('draft', savedCompanyId);
      notify('임시저장했습니다');
      if (!contract) router.replace(`/contracts/${id}`);
      else router.refresh();
    });
  };

  /**
   * 확정은 필수 항목 8개가 채워진 뒤에만 연다(시안 2차의 `runValidation`).
   *
   * ★ 그 다음이 **서류**다. 여기서 막는 것은 편의이고, 막는 힘은 서버에 있다
   *   (`POST /contracts` · `POST /contracts/:id/status` 가 409 를 낸다).
   *
   * ★ 빠진 서류 이름을 그대로 말하고 **섹션 4 로 화면을 옮긴다.** 머리말의 빨간 줄만
   *   띄우면 어디를 고쳐야 하는지가 보이지 않는다 — 폼이 길어서 섹션 4 는 화면 밖이다.
   */
  const openConfirm = () => {
    if (blockOnMissing(missing)) return;
    if (blockOnFreeMonths()) return;
    if (docsMissingText) {
      setDocsChecked(true);
      setSaveError(docsMissingText);
      setInvalid([]);
      requestAnimationFrame(() => {
        document.getElementById(SECTION_DOCS_ID)?.scrollIntoView({ block: 'start' });
      });
      return;
    }
    setConfirmKind('confirm');
  };

  const onConfirmOk = (result: ConfirmResult) =>
    run(async () => {
      const kind = confirmKind;
      if (!kind) return;

      if (kind === 'confirm') {
        const savedCompanyId = await saveTenant();
        await flushPendingDocs(savedCompanyId);
        // create 는 한 번에 confirmed 로 만들고, draft 는 섹션 2 를 먼저 저장한 뒤 전이한다 —
        // 저장하지 않고 전이하면 화면에 보이는 값과 확정된 값이 갈린다.
        const id = await saveContract('confirmed', savedCompanyId);
        // ★ draft → confirmed 는 이쪽 응답이 삐용 연동 결과를 들고 온다.
        if (contract) applyLink(await send(`/api/contracts/${id}/status`, 'POST', { to: 'confirmed' }));
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

  /**
   * [이전] — **온 곳으로 되돌아간다.**
   *
   * 늘 `/tenants/contracts` 로 밀어 넣으면 호실 현황이나 대시보드에서 계약을 연
   * 운영자가 엉뚱한 화면에 떨어진다. 그래서 히스토리를 한 칸 뒤로 간다.
   *
   * ★★ 다만 **되돌아갈 곳이 있을 때만**이다. 주소를 직접 치거나 새 탭으로 연 계약에서
   *    `back()` 을 부르면 이 앱 바깥(빈 탭·다른 사이트)으로 나가 버린다. 그때는
   *    입주사 목록으로 보내되 **그 입주사가 골라진 채로**(`?companyId=`) 연다 —
   *    목록 맨 위로 떨어뜨리면 방금 보던 회사를 다시 찾아야 한다.
   *
   * ★ 판정은 Navigation API 다. `history.length` 로는 알 수 없다 — 새 탭에서도 1 이
   *   아닐 수 있고, 앱 안에서 몇 번 움직였는지와 무관하다(실제로 확인했다).
   *   `entries()[i-1].url` 은 **같은 출처일 때만** 문자열이라, 앞 화면이 남의 사이트면
   *   저절로 거짓이 된다.
   */
  const goBack = () => {
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    const here = nav?.currentEntry?.index ?? -1;
    const prev = here > 0 ? nav?.entries?.()[here - 1] : undefined;
    if (typeof prev?.url === 'string' && prev.url.startsWith(window.location.origin)) {
      router.back();
      return;
    }
    const target = contract?.companyId ?? renewal?.companyId ?? companyId ?? null;
    router.push(target ? `/tenants/contracts?companyId=${encodeURIComponent(target)}` : '/tenants/contracts');
  };

  const onAction = (key: ActionKey) => {
    switch (key) {
      case 'back':
        goBack();
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
        // 계약서 2종(s030200040p1). 확정 이후에만 이 버튼이 뜬다(`ACTIONS`).
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
            {/*
              ★ 재계약은 제목이 다르다. 「계약 등록」으로 보이면 값이 미리 채워져 있는
                이유가 화면 어디에도 없고, 운영자가 남의 값이 섞였다고 의심한다.
            */}
            <h1 className={styles.pageTitle}>{renewal ? '재계약' : TITLES[mode]}</h1>
            <HeadNote
              mode={mode}
              missing={missing.length}
              terminatedDate={contract?.terminatedDate ?? null}
              statusChangedAt={statusChangedAt}
              statusNames={statusNames}
            />
            {/*
              ★ 이어받은 계약을 **화면에 남긴다.** DB 의 `renewed_from_contract_id` 만
                있으면 운영자는 이 계약이 어디서 왔는지 알 방법이 없다. 저장 전에는
                「이 계약을 이어받습니다」이고, 저장된 뒤에는 그 계약으로 가는 링크다.
            */}
            {renewedFromId ? (
              <div className={`${styles.pageNote} ${styles.pageNoteMuted}`}>
                <Icon name="copy-plus" size={12} />
                {renewal ? (
                  // ★ 시작일이 오늘이 아닌 이유를 여기서 말한다. 안 말하면 운영자가
                  //   날짜가 잘못 채워졌다고 읽는다.
                  '이전 계약의 조건을 이어받았습니다 — 시작일은 이전 종료일 다음 날이고, 이전 계약은 그대로 유지됩니다'
                ) : (
                  <Link href={`/contracts/${renewedFromId}`}>이어받은 이전 계약 보기</Link>
                )}
              </div>
            ) : null}
            {/*
              ★ 종료된 계약 — 정산 결과로 가는 길. 정산 상세는 사이드바 「청구」 정산 탭에만
                있다(한 업무는 한 화면에서 — CLAUDE.md). 그 계약의 상세를 연 채로 보낸다.
                처리 대기면 눈에 띄게 적는다 — 종료만 누르고 정산을 잊으면 예치금이 그대로 묶여 있다.
            */}
            {mode === 'terminated' && contract?.settlementState ? (
              <div
                className={`${styles.pageNote}${contract.settlementState === 'pending' ? '' : ` ${styles.pageNoteMuted}`}`}
                data-settlement-link={contract.settlementState}
              >
                <Icon name={contract.settlementState === 'pending' ? 'circle-alert' : 'receipt'} size={12} />
                {contract.settlementState === 'pending' ? <b>정산 처리 대기</b> : null}
                <Link href={billingHref({ tab: 'settle', company: contract.companyId, contract: contract.contractId })}>
                  정산 결과 보기
                </Link>
              </div>
            ) : null}
          </div>
          <div className={styles.headActions}>
            {(renewal ? RENEWAL_ACTIONS : ACTIONS[mode]).map((key) => {
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

          {/*
            ══════════════════════════════════════════════════════════════════
            ★★ 삐용 연동 대기 (3-2)
            ══════════════════════════════════════════════════════════════════
            계약 확정은 삐용을 기다리지 않는다 — 삐용이 죽어도 계약은 확정되고 청구서도
            만들어진다(대표 결정 2026-09-30). 그 대가로 **「계약은 됐는데 삐용 연결은
            아직」인 상태가 존재한다.** 이 배너가 그 상태의 유일한 출구다. 없으면 아무도
            모르고 지나가고, 그 회사 대표는 영원히 로그인할 수 없다.

            ★ 사유는 서버가 준 문구를 **그대로** 쓴다 — 무엇을 고쳐야 하는지가 거기 있다
              (값이 비었는지, 권한이 없는지, 삐용이 안 떠 있는지).
            ★ 연결된 뒤에는 배너가 사라진다. 단체코드를 읽기 전용으로 보여주는 것은
              입주사 상세(3-4)의 일이다 — 여기는 계약 화면이다.
          */}
          {link?.status === 'pending' && linkCompanyId ? (
            <div className={styles.linkPending} role="status" data-bbiyong-link="pending">
              <Icon name="circle-alert" size={16} />
              <span>
                <b>삐용 연동 대기</b> — 계약은 확정됐습니다. {link.reason ?? '삐용에 회사를 만들지 못했습니다.'}
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                disabled={busy}
                onClick={() => retryLink(linkCompanyId)}
              >
                다시 시도
              </button>
            </div>
          ) : null}

          {companySyncWarning ? (
            <div className={styles.linkPending} role="status" data-bbiyong-company-sync="failed">
              <Icon name="circle-alert" size={16} />
              <span>
                <b>삐용 회사 정보 반영 실패</b> — 입주사 정보는 저장했습니다. {companySyncWarning.replace(/\.\s*$/, '')}. 다시
                저장하면 다시 보냅니다.
              </span>
            </div>
          ) : null}

          {memberPending.length > 0 ? (
            <div className={styles.linkPending} role="status" data-bbiyong-member="pending">
              <Icon name="circle-alert" size={16} />
              <span>
                <b>직원 연동 대기</b> — 구성원은 저장됐고 삐용 반영만 아직입니다(
                {memberPending.length}명). 아래 「입주자 사용자 정보」에서 고친 뒤 다시 저장해 주세요.
              </span>
            </div>
          ) : null}

          <SectionCompany
            value={companyState}
            onChange={(patch) => {
              setCompany((prev) => ({ ...prev, ...patch }));
              /*
               * ★★ 사업자번호가 바뀌면 확인 결과를 버린다. 되돌리지 않으면 앞 번호로 받은
               *    「계속사업자입니다」가 새 번호 옆에 그대로 남아, **아무도 확인한 적 없는
               *    번호가 확인된 것으로 보인다.** OCR 이 덮을 때도 같은 일을 한다
               *    (`applyBizReg`) — 값이 밖에서 바뀌는 경로가 둘이라 양쪽 다 막는다.
               */
              if (patch.bizno !== undefined) setBizCheck({ kind: 'idle' });
            }}
            disabled={frozen}
            notSaveable={!SECTION_SAVEABLE[1]}
            emailDomains={emailDomains}
            memberTypes={memberTypes}
            invalid={invalid}
            bizCheck={bizCheck}
            onBizCheck={() => void runBizCheck()}
            onStub={notify}
          />

          {/*
            ══════════════════════════════════════════════════════════════════
            ★★ 첨부 서류가 **여기** 있다 — 시안은 맨 아래였다(§J-1)
            ══════════════════════════════════════════════════════════════════
            사업자등록증을 올리면 그 업로드가 판독까지 해서 **바로 위 섹션 1 을 채운다**
            (`applyBizReg`). 맨 아래에 두면 올린 뒤 화면 끝에서 맨 위로 되돌아가
            무엇이 채워졌는지 확인해야 한다. 첨부는 회사 서류이지 계약 서류도 아니다.

            ★ **번호는 그대로 4 다.** 바뀐 것은 보이는 자리뿐이고,
              `SECTION_SAVEABLE`·`editableSections`·계약서 출력은 손대지 않았다.
            ★ 첨부는 제 저장 경로가 있다(CONT-17). 폼의 [저장] 과 무관하게 즉시 올라가므로
              `SECTION_SAVEABLE[4]` 의 잠금 안내를 쓰지 않는다.
            ★ `companyId` 가 없으면(아직 저장 안 된 신규) 섹션이 스스로 그 사정을 말한다.
          */}
          <SectionDocs
            companyId={companyId}
            memberType={companyState.memberType}
            // ★ 「규칙 밖」 서류의 이유 한 줄에 쓴다. 코드가 아니라 표시명이 필요하다.
            memberTypeName={memberTypeName}
            disabled={frozen}
            // ★ 재계약에는 [임시저장] 이 없다 — 안내 문구가 그걸 따라간다.
            draftable={!renewal}
            onNotify={notify}
            onBizReg={applyBizReg}
            pending={pendingDocs}
            onPending={setPendingDoc}
            onAttached={setAttachedDocs}
            // ★ 누르기 전에는 띄우지 않는다. 폼을 열자마자 빨간 줄이 있으면 읽히지 않는다.
            alert={docsChecked ? docsMissingText : null}
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
            onOpenRoomPicker={() => setRoomPickerOpen(true)}
            /*
             * ★ 호실 셀렉트가 입주 현황을 본다. **자기 계약은 빼고** 세야 하므로
             *   「자기」 목록을 함께 준다 — 재계약이면 이전 계약도 거기 들어 있다.
             */
            spaceHolders={spaceHolders}
            selfContractIds={self}
            /*
             * ★★★ 이 계약을 쓰는 입주사도 뺀다 — 한 회사의 계약 둘은 1곳이다.
             *    저장된 계약이면 그 계약의 회사, 재계약이면 이전 계약의 회사, 신규면
             *    고른 입주사다. 아직 안 골랐으면 `null` — 뺄 것이 없다.
             */
            selfCompanyId={contract?.companyId ?? renewal?.companyId ?? companyId ?? null}
          />

          <SectionUsers
            users={users}
            company={companyState}
            frozen={frozen}
            notSaveable={!SECTION_SAVEABLE[3]}
            emailDomains={emailDomains}
            onUsers={setUsers}
          />
        </div>
      </div>

      {confirmKind ? (
        <ConfirmDialog
          kind={confirmKind}
          busy={busy}
          /*
           * ★ 저장된 종료일을 넘긴다 — **`terms` 의 계산값이 아니다.** 종료를 누르는
           *   시점의 계약은 `confirmed` 라 섹션 2 가 잠겨 있고, 화면 값과 저장값이 같다.
           *   그래도 닫는 근거는 **저장된 쪽**이어야 한다.
           * ★ `toDateInput` 을 거친다 — 응답의 ISO 를 그대로 넘기면 하루가 밀린다.
           */
          endDate={toDateInput(contract?.endDate ?? null)}
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
      {/*
        계약호실 확인 팝업(s030200040p3).

        ★ `sec2Editable` 일 때만 연다 — `terminated`·`cancelled` 에서는 버튼 자체가
          비활성이지만, 상태가 밖에서 바뀌는 경우까지 생각하면 여는 조건도 같이 본다.
      */}
      {roomPickerOpen && sec2Editable ? (
        <RoomPickerModal
          current={terms.contractRoom}
          selfContractIds={self}
          onClose={() => setRoomPickerOpen(false)}
          onPick={(room) => {
            setTerms((prev) => ({ ...prev, contractRoom: room }));
            setRoomPickerOpen(false);
          }}
        />
      ) : null}

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
            // ★ 이용기간 줄에 「(12개월, 무상 1개월)」로 찍힌다. 전대차는 개월수를 안 쓴다.
            freeMonths: Number(terms.freeMonths) || null,
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
  statusChangedAt,
  statusNames,
}: {
  mode: Mode;
  missing: number;
  terminatedDate: string | null;
  /** 확정·취소가 있었던 시각. 종료는 `terminatedDate` 를 쓴다. */
  statusChangedAt: string | null;
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
  /*
   * ★ 확정·취소는 **상태 이력의 시각**을 붙인다(`statusChangedAt`). 종료(위)와 달리
   *   계약 행에 날짜가 없어서다 — 고를 날짜가 없는 전이라 「언제 눌렀는가」가 곧 그 날짜다.
   * ★ 못 읽었으면 날짜 없이 이름만 낸다. 「 계약중」처럼 앞이 빈 줄이 나오지 않게
   *   종료 쪽과 같은 모양으로 가른다.
   */
  if (mode === 'cancelled' || mode === 'confirmed') {
    const name = contractStatusName(statusNames, mode);
    const day = statusChangedAt ? formatDot(statusChangedAt) : '';
    return (
      <div className={`${styles.pageNote} ${styles.pageNoteMuted}`}>{day ? `${day} ${name}` : name}</div>
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
      // ★ 삐용 연동 대기 사유. 서버 값이 유일한 원천이다 — 화면이 추측하지 않는다.
      linkReason: m.bbiyong?.reason ?? null,
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

/**
 * 계약 조회 응답 → 이어받기가 받는 모양.
 *
 * ★★ **`endDate` 를 `toDateInput` 에 통과시키는 것이 이 함수의 존재 이유다.**
 *    응답의 종료일은 `2026-12-31T15:00:00.000Z` 로 오고, 새 계약의 **시작일이 거기서
 *    나온다**(다음 날). 그대로 넘기면 `buildRenewalSeed` 가 읽지 못해 시작일이 조용히
 *    오늘로 떨어진다 — 예전처럼 객체를 통째로 펼쳐 넘기면 그 일이 벌어진다.
 */
function renewalSourceOf(prev: ContractResponse): RenewalSource {
  return {
    contractId: prev.contractId,
    companyId: prev.companyId,
    buildId: prev.buildId,
    contractRoom: prev.contractRoom,
    paymentMethod: prev.paymentMethod,
    accessRoute: prev.accessRoute,
    periodMonths: prev.periodMonths,
    // ★ 시작일 규칙이 이 값으로 갈린다(`isPreviousLive`) — 닫힌 계약이면 오늘부터다.
    status: prev.status,
    // ★ 특기사항 문구의 「이전 계약 기간」에 쓴다.
    startDate: toDateInput(prev.startDate),
    endDate: toDateInput(prev.endDate),
    spaces: prev.spaces,
  };
}

function seedTerms(
  contract: ContractResponse | null,
  renewal: ContractResponse | null,
  spaces: readonly SpaceOption[],
): TermsState {
  if (!contract) {
    /*
     * ★ 재계약 — 조건을 이어받는다. 무엇을 이어받고 무엇을 새로 받는지는
     *   `buildRenewalSeed` 한 곳에만 있다. 여기서 다시 고르면 두 벌이 된다.
     *
     * ★ 「오늘」은 **화면이 정한다**(`localToday`). 서버 시간대로 계산하면 자정 근처에
     *   하루가 밀린다 — 운영자가 보고 있는 날짜가 계약일자여야 한다.
     */
    if (renewal) {
      const seed = buildRenewalSeed(renewalSourceOf(renewal), localToday());
      return {
        buildId: seed.buildId,
        floorId: firstFloorOf(spaces, seed.buildId),
        contractRoom: seed.contractRoom,
        paymentMethod: seed.paymentMethod,
        accessRoute: seed.accessRoute,
        contractDate: seed.contractDate,
        months: seed.months,
        // ★ 이어받지 않는다 — 언제나 '0' 이다(`buildRenewalSeed` 머리말).
        freeMonths: seed.freeMonths,
        startDate: seed.startDate,
        /*
         * ★★ 「재계약 (이전 계약 기간 …)」. **이전 계약의 특기사항이 아니다** —
         *    어느 계약을 이어받았는지를 계약서에 남기는 새 문장이고, 운영자가 지우거나
         *    고칠 수 있다.
         * ★ 할인·무상 문구는 이 줄 **위에** 얹힌다(`withAutoLines`) — 덮지 않는다.
         */
        memo: seed.memo,
      };
    }

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
      freeMonths: '0',
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
    freeMonths: String(contract.freeMonths ?? 0),
    startDate: toDateInput(contract.startDate),
    memo: contract.memo ?? '',
  };
}

/**
 * 호실 줄의 첫 값.
 *
 * ★ 재계약은 **금액째** 이어받는다(`buildRenewalSeed`). 호실의 지금 기준가로 다시
 *   채우지 않는다 — 이어지는 계약의 조건은 이전 계약의 조건이고, 바꿀 거라면 운영자가
 *   화면에서 고친다.
 */
function seedItems(contract: ContractResponse | null, renewal: ContractResponse | null): ItemRow[] {
  if (!contract && renewal) {
    const seed = buildRenewalSeed(renewalSourceOf(renewal), '');
    return seed.spaces.length > 0 ? seed.spaces.map((s) => ({ ...s })) : [{ ...ROW_TEMPLATE }];
  }
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
