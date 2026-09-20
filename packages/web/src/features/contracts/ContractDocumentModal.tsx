'use client';

/** @screen s0300200040p1 계약서 미리보기 · 020 입주사관리 · 1차 */

/**
 * 계약서 2종 — 이용계약서 · 전대차계약서.
 *
 * 원본: design/handoff/prototypes/s0300200040p1.html
 * 명세: design/handoff/tenant-contract/06-contracts.md
 * 경위: doc/CONTRACT_DOCUMENTS.md
 *
 * =============================================================================
 * ★★★ 인쇄해서 세무서에 내는 종이다
 * =============================================================================
 * 세 가지를 지킨다.
 *
 *   ① **금액을 여기서 계산하지 않는다.** 합계·부가세·첫달납부액·전대차 월회비는
 *      전부 `@swonbiz/shared/domain/contract-amounts` 가 만든다. 이 파일에
 *      `Math.round` 도 `setMonth` 도 없다 — 있으면 그 순간 세금계산서와 갈린다.
 *
 *   ② **없는 값을 지어내지 않는다.** 비면 비운 채로 두고 기입선(`Blank`)을 그린다.
 *      「미상」·「-」 를 찍지 않는다 — 그건 값처럼 보인다.
 *
 *   ③ **두 문서의 금액이 다를 수 있다.** 그게 버그가 아니라 규칙이다. 아래 ★★ 참조.
 *
 * =============================================================================
 * ★★ 전대차 비상주 특례 — 두 문서의 숫자가 갈리는 자리
 * =============================================================================
 *     호실 1~2건이고 **그 전부가** 비상주(`ROOM_TP = VR`) → 기준가(standardFee)
 *     그 외(3건 이상 · 비상주 아닌 줄이 섞임)              → 실계약가(monthlyFee)
 *
 * 비상주는 할인폭이 커서 실제 계약금액으로 내면 세무서가 인정하지 않는다.
 * **이 분기를 여기서 쓰지 않는다** — `calcSubleaseMonthlyPayment()` 를 부르고 끝이다.
 * 판정 조건을 화면이 다시 적으면 두 벌이 되고, 그러면 문서에 찍히는 숫자와
 * 「어느 기준인가」가 어긋날 수 있다.
 *
 * =============================================================================
 * ★★ 주소 — 자리마다 출처가 다르다
 * =============================================================================
 *     이용계약서 「주소」·서명란 을   회사가 입력한 주소(우편번호+기본+상세)
 *     전대차 서명란 을 「주소」        같은 값(시안은 우편번호를 뺀다)
 *     전대차 2조 2항 「대상」          **건물 + 계약호실** — 사업장 주소다
 *
 * 마지막 하나만 국세청 신고 주소와 같아야 해서 따로 만든다. 자세한 근거와
 * 남은 문제는 `doc/CONTRACT_DOCUMENTS.md` §B.
 *
 * =============================================================================
 * ★ 화면에 보이는 값을 찍는다
 * =============================================================================
 * 저장된 값이 아니라 **폼의 현재 상태**를 넘겨받는다. `confirmed` 이후에만 열리고
 * 그때 섹션 2(금액 전부)는 잠겨 있으므로 둘은 같다. 섹션 1·3 은 열려 있어 저장 전
 * 편집이 있을 수 있는데, 그때는 **보고 있는 것이 찍히는 편**이 덜 놀랍다.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CONTRACT_DEFAULTS,
  CONTRACT_LESSOR,
  CONTRACT_OFFICE,
  CONTRACT_PREMISES,
} from '@swonbiz/shared';
import { calcSubleaseMonthlyPayment } from '@swonbiz/shared/domain/contract-amounts';
import {
  companyAddressLabel,
  dayOfMonthLabel,
  formatWon,
  memoLabel,
  periodLabel,
  planSummaryLabel,
  roomNamesLabel,
  signDateLabel,
  subleaseDateLabel,
  subleaseTargetLabel,
  vatSuffix,
} from '@swonbiz/shared/domain/contract-document';
import { Icon } from '@/components/ds';
import styles from './contract-document.module.css';
import { firstPaymentOf, totalsOf, type CodeOption, type ItemRow, type SpaceOption } from './form-model';

export interface DocumentCompany {
  companyName: string;
  ceoName: string | null;
  bizNumber: string | null;
  corpNumber: string | null;
  memberType: string;
  tel: string | null;
  email: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  memo: string | null;
}

export interface DocumentTerms {
  contractDate: string;
  startDate: string;
  endDate: string;
  periodMonths: number | null;
  paymentMethod: string;
  contractRoom: string | null;
  memo: string | null;
}

interface Props {
  company: DocumentCompany;
  terms: DocumentTerms;
  items: ItemRow[];
  spaces: SpaceOption[];
  codes: CodeOption[];
  onClose: () => void;
}

type DocKind = 'usage' | 'sublease';

const TABS: { key: DocKind; label: string }[] = [
  { key: 'usage', label: '이용계약서' },
  { key: 'sublease', label: '전대차계약서' },
];

export function ContractDocumentModal({ company, terms, items, spaces, codes, onClose }: Props) {
  const [tab, setTab] = useState<DocKind>('usage');
  const printed = useRef(false);

  /**
   * ★★ 인쇄 규칙(`styles/print.css`)은 이 표시가 붙어 있을 때만 걸린다.
   *    안 붙이면 **다른 화면에서 Ctrl+P 를 눌렀을 때 빈 종이가 나온다.**
   *    닫힐 때 반드시 지운다 — 예외로 빠져나가도 지워지도록 cleanup 에 둔다.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.printing = 'contract-doc';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      delete document.body.dataset.printing;
    };
  }, [onClose]);

  /* ── 값 만들기 — 계산은 전부 shared 가 한다 ─────────────────────────── */

  const roomNameOf = (spaceId: string) => spaces.find((s) => s.spaceId === spaceId)?.roomName ?? '';
  const roomTypeNameOf = (code: string) =>
    codes.find((c) => c.category === 'ROOM_TP' && c.code === code)?.name ?? code;
  const memberTypeName =
    codes.find((c) => c.category === 'MEMBER_TYPE' && c.code === company.memberType)?.name ?? '';
  const paymentMethodName =
    codes.find((c) => c.category === 'PAYMENT_METHOD' && c.code === terms.paymentMethod)?.name ?? '';

  // ★ 값이 채워진 줄만 센다. 빈 줄(호실 미선택)이 「외 N건」을 부풀리면 안 된다.
  const filled = items.filter((r) => r.spaceId !== '');

  const totals = totalsOf(filled);
  const firstPayment = firstPaymentOf(totals, terms.paymentMethod, String(terms.periodMonths ?? ''));

  /**
   * ★★ 전대차 월회비. **분기를 여기서 쓰지 않는다** — 함수 하나를 부른다.
   *    이용계약서의 `totals.monthlyPayment` 와 **다를 수 있고, 그게 정상이다.**
   */
  const subleaseMonthly = calcSubleaseMonthlyPayment(
    filled.map((r, i) => ({
      seq: i + 1,
      roomType: r.roomType,
      standardFee: r.standardFee,
      deposit: r.deposit,
      monthlyFee: r.monthlyFee,
      vatYn: r.vatYn,
    })),
  );

  const planSummary = planSummaryLabel(filled.map((r) => roomTypeNameOf(r.roomType)));
  const roomNames = roomNamesLabel(filled.map((r) => roomNameOf(r.spaceId)));
  const addressWithZip = companyAddressLabel({
    zipCode: company.zipCode,
    address: company.address,
    addressDetail: company.addressDetail,
    withZip: true,
  });
  const addressNoZip = companyAddressLabel({
    zipCode: company.zipCode,
    address: company.address,
    addressDetail: company.addressDetail,
    withZip: false,
  });
  const target = subleaseTargetLabel({
    buildingAddress: CONTRACT_PREMISES.PREFIX,
    buildingSuffix: CONTRACT_PREMISES.SUFFIX,
    contractRoom: terms.contractRoom,
  });
  const memo = memoLabel([company.memo, terms.memo]);

  const doPrint = () => {
    // 두 번 눌러 인쇄창이 겹치는 것을 막는다. 창이 닫히면 다시 열 수 있게 되돌린다.
    if (printed.current) return;
    printed.current = true;
    window.print();
    window.setTimeout(() => {
      printed.current = false;
    }, 1000);
  };

  /**
   * ★★★ **body 로 포털한다** — 인쇄가 이것에 달려 있다.
   *
   * 계약 폼 안에 그대로 두면 문서가 폼 트리 깊숙이 들어간다. 그 상태로 인쇄하려면
   * 조상들(스크롤 컨테이너·모달 껍데기)을 절대위치로 들어내야 하는데, **절대위치는
   * 흐름에서 빠지므로 브라우저가 페이지를 나눌 높이를 잃는다.** 실제로 그렇게 만들었다가
   * 전대차계약서가 **3장 분량인데 2장만 인쇄돼 뒷부분이 통째로 잘렸다**(2026-09-20).
   *
   * body 바로 밑에 두면 문서가 **정상 흐름**에 있고, 인쇄할 때는 형제만 감추면 된다.
   * 그러면 브라우저가 알아서 페이지를 나눈다.
   */
  const body = typeof document === 'undefined' ? null : document.body;
  if (!body) return null;

  return createPortal(
    <div
      data-print-portal="contract-doc"
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-print-modal="1"
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="계약서 미리보기"
      >
        {/* ★ 탭·인쇄 버튼은 종이에 찍히면 안 된다 — 인쇄 규칙이 이 표시를 본다. */}
        <div data-print-hide="1" className={styles.head}>
          <div className={styles.tabs} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`${styles.tab}${tab === t.key ? ` ${styles.tabOn}` : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className={styles.headRight}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={doPrint}>
              <Icon name="file-text" size={16} />
              인쇄
              <span className={styles.tip}>인쇄 창에서 PDF로 저장할 수 있습니다</span>
            </button>
            <button type="button" className={styles.iconBtn} aria-label="닫기" onClick={onClose}>
              <Icon name="x" size={20} />
            </button>
          </div>
        </div>

        {/*
          ★ **두 문서 모두 용지 여백이 0 이라** 크롬은 머리글·바닥글(날짜·주소·쪽번호)을
            그릴 자리가 없다. 전대차의 매 장 여백은 표 틀이 만든다(`print.css` 참조).
            그래도 이 줄을 남겨 둔다 — 여백 0 을 따르지 않는 브라우저·드라이버가 있고,
            계약서에 「about:blank」나 「1/3」이 찍히면 그 종이는 못 쓴다.
          ★ `data-print-hide` — 이 안내 자체는 종이에 나오지 않는다.
        */}
        <p data-print-hide="1" className={styles.printHint}>
          <Icon name="circle-alert" size={14} />
          날짜·주소·쪽번호가 함께 인쇄되면 인쇄 대화상자에서 <b>머리글·바닥글</b>을 꺼 주세요.
        </p>

        <div data-scroll="1" className={styles.scroll}>
          {/*
            ★ 선택하지 않은 문서는 **렌더하지 않는다.** `display:none` 으로 숨기면
              인쇄 규칙이 `visibility` 로 되살릴 때 두 장이 다 나올 여지가 있다.
              마운트 자체를 하지 않으면 그 여지가 없다.
          */}
          {tab === 'usage' ? (
            <UsageDocument
              company={company}
              terms={terms}
              planSummary={planSummary}
              roomNames={roomNames}
              memberTypeName={memberTypeName}
              paymentMethodName={paymentMethodName}
              addressWithZip={addressWithZip}
              deposit={totals.deposit}
              monthlyPayment={totals.monthlyPayment}
              vatNote={vatSuffix(filled.map((r) => r.vatYn))}
              firstPayment={firstPayment}
              memo={memo}
            />
          ) : (
            <SubleaseDocument
              company={company}
              terms={terms}
              addressNoZip={addressNoZip}
              target={target}
              subleaseMonthly={subleaseMonthly}
              deposit={totals.deposit}
            />
          )}
        </div>
      </div>
    </div>,
    body,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   빈 값 — **기입선을 그린다.** 지어낸 글자를 넣지 않는다
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 값이 있으면 값을, 없으면 밑줄 한 칸을 그린다(명세 「자동 채움 값 강조」).
 *
 * ★ 「미상」·「-」·「해당없음」 을 쓰지 않는다. 그건 사람이 적은 값처럼 보이고,
 *   계약서에서는 **빈칸보다 나쁘다.**
 */
function Blank({ value, width }: { value: string | null | undefined; width?: number }) {
  const v = (value ?? '').trim();
  if (v !== '') return <>{v}</>;
  return <span className={styles.blank} style={width ? { width } : undefined} />;
}

/** 표의 라벨 칸. */
function Th({ children }: { children: React.ReactNode }) {
  return <span data-th="1" className={styles.th}>{children}</span>;
}

/* ══════════════════════════════════════════════════════════════════════════
   이용계약서
   ══════════════════════════════════════════════════════════════════════════ */

function UsageDocument(props: {
  company: DocumentCompany;
  terms: DocumentTerms;
  planSummary: string;
  roomNames: string;
  memberTypeName: string;
  paymentMethodName: string;
  addressWithZip: string;
  deposit: number;
  monthlyPayment: number;
  vatNote: string;
  firstPayment: number | null;
  memo: string;
}) {
  const { company, terms } = props;

  return (
    <div data-doc-page="usage" className={styles.page}>
      <div className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img data-brand-mark="1" src="/brand/swonbiz-logo.png" alt="" className={styles.brandMark} />
        <span className={styles.brandWord}>
          S<span className={styles.brandDot}>·</span>won<span className={styles.brandBiz}>Biz</span>
        </span>
      </div>
      {/*
        ★★ 「(비 제출용)」 — **이용계약서에만** 붙는다. 세무서에 내는 것은 전대차계약서이고
           (`SubleaseDocument`), 이용계약서는 우리와 입주사 사이의 문서다. 둘이 비슷하게
           생겨서 창구에서 잘못 내는 일을 제목에서 막는다.
        ★ 별도 `<span>` 으로 둔 이유 — 제목 본문과 **같은 크기로 이으면 한 줄을 넘는다**
          (40px · 자간 0.15em 에서 폭이 714px 를 넘긴다). 작은 글자로 이어 붙이면 줄 높이가
          그대로라 **문서 길이가 1px 도 늘지 않는다** — 이용계약서는 이미 0.94장이다.
      */}
      <h3 data-doc-title="1" className={styles.docTitle}>
        이 용 계 약 서
        <span data-doc-title-note="1" className={styles.docTitleNote}>(비 제출용)</span>
      </h3>

      <SectionTitle first>계약 정보</SectionTitle>
      <div className={styles.table} data-doc-table="1">
        <div className={styles.tr} data-no-break="1">
          <Th>계약구분</Th>
          <span data-td="1" className={styles.td}>
            <Blank value={props.planSummary} />
          </span>
          <Th>회원구분</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast}`}>
            <Blank value={props.memberTypeName} />
          </span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>회원명</Th>
          <span data-td="1" className={styles.td}>
            <Blank value={company.companyName} />
          </span>
          <Th>사업자번호</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast}`}>
            <Blank value={company.bizNumber} />
          </span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>연락처</Th>
          <span data-td="1" className={styles.td}>
            <Blank value={company.tel} />
          </span>
          <Th>E-mail</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast}`}>
            <Blank value={company.email} />
          </span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>주소</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast} ${styles.tdWide}`}>
            <Blank value={props.addressWithZip} width={320} />
          </span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>이용기간</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast} ${styles.tdWide}`}>
            <Blank value={periodLabel(terms.startDate, terms.endDate, terms.periodMonths)} width={240} />
            <span data-note="1" className={styles.note}>
              * 년단위 계약의 경우 이용기간 만료 1개월 전까지 별도의 서면 해지의사가 없으면 원계약
              단위로 자동연장됩니다.
            </span>
          </span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>이용호실</Th>
          <span data-td="1" className={styles.td}>
            <Blank value={props.roomNames} />
          </span>
          <Th>예치금</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast}`}>{formatWon(props.deposit)} 원</span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>월납부액</Th>
          <span data-td="1" className={styles.td}>
            {formatWon(props.monthlyPayment)} 원{props.vatNote}
          </span>
          <Th>첫달납부액</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast} ${styles.nowrap}`}>
            {/*
              ★ 납부방법을 못 고른 계약은 첫달납부액이 **계산되지 않는다**(null).
                0 원으로 찍지 않는다 — 0 원은 «공짜»라는 값이다.
            */}
            {props.firstPayment === null ? (
              <Blank value={null} width={120} />
            ) : (
              <>
                {formatWon(props.firstPayment)} 원
                {props.paymentMethodName ? (
                  <span className={styles.paymentNote}>({props.paymentMethodName})</span>
                ) : null}
              </>
            )}
          </span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>특기사항</Th>
          <span data-td="1" data-memo-cell="1" className={`${styles.td} ${styles.tdLast} ${styles.memoCell}`}>
            {props.memo}
          </span>
        </div>
      </div>

      <SectionTitle>오피스 정보</SectionTitle>
      <div className={styles.table} data-doc-table="1">
        <div className={styles.tr} data-no-break="1">
          <Th>센터명</Th>
          <span data-td="1" className={styles.td}>{CONTRACT_DEFAULTS.DEFAULT_CENTER}</span>
          <Th>담당자</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast}`}>{CONTRACT_DEFAULTS.DEFAULT_MANAGER}</span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>전화번호</Th>
          <span data-td="1" className={styles.td}>{CONTRACT_OFFICE.TEL}</span>
          <Th>Fax번호</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast}`}>{CONTRACT_OFFICE.FAX}</span>
        </div>
        <div className={styles.tr} data-no-break="1">
          <Th>이메일</Th>
          <span data-td="1" className={styles.td}>{CONTRACT_OFFICE.EMAIL}</span>
          <Th>은행(계좌번호)</Th>
          <span data-td="1" className={`${styles.td} ${styles.tdLast}`}>
            {CONTRACT_OFFICE.BANK}
            <span data-note="1" className={styles.note}>{CONTRACT_OFFICE.ACCOUNT_HOLDER}</span>
          </span>
        </div>
      </div>

      <SectionTitle>이용안내</SectionTitle>
      <div data-guide-box="1" className={styles.guideBox}>
        <span data-guide-line="1" className={styles.guideLine}>
          - 이용범위는 사무공간과 부대시설(회의실, 접견실, 휴게실, IT기기, 유무선 통신망)을 이용 가능
        </span>
        <span data-guide-line="1" className={styles.guideLine}>
          - 계약기간 만료 또는 종료시 사업자 주소지와 전화를 7일 이내에 이전해야 하고, 계약을 해지할
          경우 7일 이전에 서면 또는 구두 통보 해야함.
        </span>
      </div>

      <div data-rule="1" className={styles.rule} />
      <div data-pledge-box="1" className={styles.pledgeBox}>
        <p className={styles.pledge}>
          {CONTRACT_LESSOR.NAME}(이하 &lsquo;갑&rsquo;)와 상기 회원(이하 &lsquo;을&rsquo;)은
          &lsquo;갑&rsquo;이 제공하는 서비스를 &lsquo;을&rsquo;이 이용함에 있어서 수반되는 사항을 본
          이용계약서 약관대로 계약을 체결하고, 본 계약의 성립을 증명하기 위하여 본 이용계약서 2부를
          작성하여 기명, 날인하고 각 한부씩 보관한다.
        </p>
        <p className={styles.pledgeStrong}>* 본 이용계약서로는 임대차계약서를 대신할 수 없음</p>
      </div>

      <p data-sign-date="1" className={styles.signDate}>{signDateLabel(terms.contractDate)}</p>

      <div data-sign-grid="1" className={styles.signGrid}>
        <div>
          <div className={styles.signLine}>갑 : {CONTRACT_LESSOR.ADDRESS_FULL}</div>
          <div className={styles.signName}>
            <span className={styles.signStrong}>
              {CONTRACT_LESSOR.NAME}&nbsp;&nbsp;대표자 {CONTRACT_LESSOR.CEO_SPACED}
            </span>
            <span className={styles.sealWrap}>
              <span className={styles.signStrong}>(인)</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-seal="1" src="/brand/company-seal.png" alt="사용인감" className={styles.seal} />
            </span>
          </div>
        </div>
        <div>
          <div className={styles.signLineFlex}>
            <span className={styles.signLabel}>을 :</span>
            <span className={styles.signUnderline}>
              <Blank value={props.addressWithZip} width={200} />
            </span>
          </div>
          <div className={styles.signNameRight}>
            <span className={styles.signStrong}>
              <Blank value={company.companyName} width={120} />
              &nbsp;&nbsp;대표자 <Blank value={company.ceoName} width={80} />
            </span>
            {/* ★ 을의 도장 자리는 비워 둔다 — 출력 후 직접 날인한다(명세). */}
            <span className={styles.signSeal}>(인)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div data-section-title="1" className={`${styles.sectionTitle}${first ? ` ${styles.sectionTitleFirst}` : ''}`}>
      <span className={styles.sectionBar} />
      <span>{children}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   전대차계약서 — 세무서 제출용. **계약구분·이용내역을 적지 않는다**
   ══════════════════════════════════════════════════════════════════════════ */

function SubleaseDocument(props: {
  company: DocumentCompany;
  terms: DocumentTerms;
  addressNoZip: string;
  target: { prefix: string; room: string; suffix: string };
  subleaseMonthly: number;
  deposit: number;
}) {
  const { company, terms, target } = props;

  return (
    <div data-doc-page="sublease" className={styles.page}>
      {/*
        ★★★ 왜 표로 감쌌나 — **3장짜리 문서의 매 장에 여백을 주려고**
        ─────────────────────────────────────────────────────────────────────
        크롬 머리글·바닥글(날짜·주소·쪽번호)은 `@page` 여백이 0 일 때만 사라진다.
        그런데 여백을 0 으로 두면 문서 안쪽 padding 은 **흐름의 시작과 끝에만** 붙어서
        2·3장 본문이 종이 끝까지 간다.

        `thead`·`tfoot` 는 인쇄에서 **매 장에 반복**된다. 그 성질을 빌려 위아래 14mm
        짜리 빈 칸을 두면, 여백이 0 인 채로도 장마다 여백이 생긴다.
        확인: 3장 모두 위 14mm 이상 · 좌우 13mm (`pdfink` 로 PDF 좌표를 직접 쟀다).

        ★ 화면에서는 표가 아니다 — `display:block` 이고 thead·tfoot 은 숨긴다.
          인쇄에서만 표로 돌아온다(`print.css`).
      */}
      <table data-print-frame="1" className={styles.printFrame}>
        <thead>
          <tr>
            <td data-frame-spacer="1" className={styles.frameSpacer} />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td data-frame-spacer="1" className={styles.frameSpacer} />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td data-frame-cell="1" className={styles.frameCell}>
      <h3 data-doc-title="1" className={styles.docTitle}>전 대 차 계 약 서</h3>

      <div className={styles.parties}>
        <div className={styles.party}>
          갑 : {CONTRACT_LESSOR.NAME}&nbsp;&nbsp;{CONTRACT_LESSOR.CEO}
        </div>
        <div className={styles.party}>
          을 : <Blank value={company.companyName} width={140} />
          &nbsp;&nbsp;
          <Blank value={company.ceoName} width={80} />
        </div>
      </div>

      <p className={styles.intro}>
        위 갑과 을은 <span>{subleaseDateLabel(terms.contractDate)}</span> 다음과 같이 회원 가입을 체결
        한다.
      </p>

      <div className={styles.clauses}>
        <Clause title="1. 본 계약의 목적">
          <P>
            본 계약은 갑이 을에게 갑의 사무실 및 부대시설을 사용 할 수 있는 권리를 허용함과 동시에 을이
            필요로 하는 서비스를 제공함에 있어서 갑-을 간의 권리 의무에 관한 사항을 정하기 위한 목적에서
            체결 한다.
          </P>
        </Clause>

        <Clause title="2. 을의 권리의 책임">
          <P>1) 갑은 을에게 제2항 및 제3항에 규정된 바와 같이 갑의 사무실 및 기타 부대시설을 사용할 수 있는 권리를 부여한다.</P>
          <P>2) 을이 사용 할 수 있는 사무실의 내역은 다음과 같다.</P>
          <div className={styles.sub}>
            {/*
              ★★ 이 줄만 **사업장 주소**다(건물 + 계약호실). 회사가 입력한 주소가 아니다 —
                국세청에 신고한 주소와 같아야 한다.
              ★★ 월회비는 `calcSubleaseMonthlyPayment` 가 정한다. 비상주 특례가 걸리면
                이용계약서의 월납부액과 **다른 숫자**가 나오고, 그게 정상이다.
              ★ 명세: VAT 행을 두지 않는다. 「이용내역」 줄도 넣지 않는다.
            */}
            대상 : {target.prefix} <Blank value={target.room} width={60} />호 {target.suffix}
            <br />
            용도 : 업무용
            <br />
            월회비 : <span>{formatWon(props.subleaseMonthly)}</span> 원
          </div>
          <P>3) 을은 상기한 제3항의 사무실 제공과 동시에 부대시설(회의실, 접견실, 휴게실, OA기기)을 갑이 정한 원칙에 의거하여 사용 할 수 있다.</P>
          <P>4) 을은 사무실과 부대시설을 사용함에 있어서 선량한 관리자의 주의 의무를 다해야 하며, 사무실과 부대시설에 야기된 제반 손상이나 훼손에 대하여 자신의 비용으로 이를 처리해야 한다.</P>
          <P>5) 을은 건물주 및 갑의 이해관계인에게 손해 등 문제가 발생할 우려가 있는 경우, 즉시 갑에게 사전 고지를 해야 하며 그렇지 않을 경우, 이로 인해 발생하는 갑의 모든 손해(6개월간의 월회비와 법적인 문제 해결을 위한 제반 경비)에 대하여 배상을 한다.</P>
          <P>6) 상기 5)항에 대하여 을은 갑에게 관련 정보제공, 법적인 문제인 경우 이를 해결하기 위해 적극 협조한다. (또한, 채권 가압류의 경우 즉시항고, 이의신청 등을 진행하기 위한 업무협조를 포함 한다.)</P>
        </Clause>

        <Clause title="3. 계약기간">
          <P>
            1) 본 계약의 계약기간은 <Blank value={subleaseDateLabel(terms.startDate)} width={110} />
            부터 <Blank value={subleaseDateLabel(terms.endDate)} width={110} />
            까지로 한다.
          </P>
        </Clause>

        <Clause title="4. 예치금">
          <P>
            1) 을은 본 계약서에 서명함과 동시에 예치금 <span>{formatWon(props.deposit)}</span> 원을 갑에게
            지급하여야 한다.
          </P>
          <P>2) 위 제1항에 명시된 예치금은 본 계약기간 동안 갑이 보유하며, 계약기간 만료 또는 종료 시 을이 갑에게 사무실 및 부대시설을 원상 복구하여 반환하고, 갑에게 지급 할 모든 금액의 지급을 완료하고 사업자 주소지와 전화를 7일 이내에 옮긴다. 이것이 확인된 후 3일 이내에 예치금을 반환하기로 한다. 단, 예치금에는 이자가 발생하지 않는 것으로 한다.</P>
        </Clause>

        <Clause title="5. 회비 및 부가서비스 이용대금의 지급">
          <P>
            1) 을은 매월 <Blank value={dayOfMonthLabel(terms.contractDate)} width={40} /> 일에 월 회비를
            갑에게 지급하여야 하며, 그 지급일이 공휴일인 경우에는 익일까지 납부해야 한다.
          </P>
          <P>2) 월 회비나 부가서비스 이용대금이 납부기한까지 전액 납부되지 않은 경우, 갑은 본 계약에 의하여 부여된 여타 권리와는 별도로 연체료 월 2%를 을에게 청구할 수 있다.</P>
        </Clause>

        <Clause title="6. 갑의 면책사항">
          <P>1) 본 계약서의 내용은 사정에 의하여 변동될 수 있으며, 갑은 이러한 변경에 대하여 을에게 사전 고지하고 상호 합의가 있는 경우, 을은 본 계약 위반의 책임을 지지 아니한다.</P>
          <P>2) 을이나 제3자가 다음과 같은 원인에 의하여 다치거나 재산상의 손해를 입게 된 경우 갑은 이에 대하여 여하한 배상책임도 부담하지 않는다.</P>
          <div className={styles.sub}>
            - 배수관, 스프링쿨러, 연기 혹은 기타 물질이 건물에서 누출 될 경우
            <br />- 건물의 서비스와 설비에 결함이 있는 경우
            <br />- 건물의 보안이나 보호
          </div>
          <P>3) 갑이 을에게 제공하는 세무전문서비스는 을과 갑의 제휴세무사가 직접 계약을 체결하기로 한다. 세무전문서비스의 제공과 관련하여 발생하는 문제에 대하여 갑은 책임을 지지 아니한다.</P>
        </Clause>

        <Clause title="7. 계약의 양도 금지">
          <P>을은 본 계약상의 권리나 의무를 갑의 동의 없이 제3자에게 양도하거나 처분할 수 없다.</P>
        </Clause>

        <Clause title="8. 계약의 해지 및 갱신">
          <P>1) 을이 본 계약의 해지 및 갱신을 원하는 경우, 본 계약서 제3조에 명시된 계약기간의 만료 15일 전까지 그러한 의사를 갑에게 반드시 통지 해야한다.</P>
          <P>2) 계약 만료일 15일 전에 의사표시를 하지 않는 경우에는, 계약만료를 통보한 날로부터 15일 이후를 계약만료일로 하며, 해당 기간의 사용료를 손해배상금으로 갑에게 지급한다.</P>
          <P>3) 월회비 할인률이 적용된 경우, &lsquo;을&rsquo;의 사정으로 계약만료일 이전에 중도 해지할 경우는 해당기간 동안 할인 받은 총금액을 최종 정산시 일괄 반환한다.</P>
          <P>4) 갑이 부득이한 사정으로 인하여 중도에 본 계약을 해지하고자 하는 경우 갑은 1개월 전에 해지의 의사를 을에게 표시하여야 한다.</P>
          <P>5) 다음의 경우에는 갑이 일방적으로 계약을 해지 할 수 있다.</P>
          <div className={styles.sub}>
            - &lsquo;을&rsquo;이 30일 이내 2회 이상 갑으로부터 납부 권고를 받고도 월 이용회비를 납부하지 않은 경우
            <br />- &lsquo;갑&rsquo;이 규정한 &lsquo;회원이용안내&rsquo;의 규칙을 준수하지 않고 질서를 문란하여 타 회원에게 피해를 입힌 경우
            <br />- &lsquo;을&rsquo;이 &lsquo;갑&rsquo;의 사전 승인 없이 회원계약을 제3자에게 인도한 경우
            <br />- &lsquo;을&rsquo;의 업무가 반사회적이거나, 현행 법률에 저촉되어 물의가 될 것으로 판단되는 경우
            <br />- &lsquo;을&rsquo;로 인해 &lsquo;갑&rsquo;과 &lsquo;갑&rsquo;의 이해당사자에게 법적인 문제(채권 가압류 등) 및 피해가 발생한 경우
            <br />- 갑과 을은 계약만료시 의사표시 없을 경우 자동연장으로 본다.
          </div>
        </Clause>

        <Clause title="9. 위 제8조 제5항에 의거하여 갑이 일방적으로 본 계약을 해지 할 경우">
          <P>1) 해지 3일 전에 서면 또는 전자메일로 통보하며 계약해지에 따른 월회비나 서비스 이용대금을 정산하고 을의 회원자격을 박탈한다.</P>
          <P>2) 을은 계약해지를 통보 받은 날로부터 3일 이내에 갑의 유치물품을 퇴거해야 하며, 퇴거하지 않을 경우 을의 유치물품에 대한 분실이나 도난에 대해 갑은 책임을 지지 않는다.</P>
          <P>3) 본 계약서에 명시된 월회비나 서비스 이용대금을 전액 납부하지 않은 경우, 갑은 사무실 또는 건물에 있는 을의 자산에 대하여 최우선적인 담보권을 취득한다. 만일 을이 갑의 서면 통지를 받은 날로부터 10일 내에 미지급된 금액을 납부하지 않을 경우, 갑은 을의 동의 없이 갑이 자산을 이전 및 임의 처분할 권리를 가진다.</P>
        </Clause>

        <Clause title="10. 분쟁의 해결">
          <P>1) &lsquo;갑&rsquo;과 &lsquo;을&rsquo;간에 본 계약과 관련하여 분쟁이 야기되는 경우, 해당 분쟁은 대한상사중재원의 상사중재에 의하여 상호 해결하는데 동의한다.</P>
          <P>2) 본 계약의 준거법은 대한민국법으로 한다.</P>
          <P>3) &lsquo;을&rsquo;이 계약을 해지하고자 할 경우에는 해지를 희망하는 날로부터 15일 전에 &lsquo;갑&rsquo;에게 서면 통지하여야 하며, &lsquo;갑&rsquo;은 사용료를 일할 정산한다.</P>
        </Clause>
      </div>

      <p className={styles.closing}>
        이상과 같은 합의를 증명하기 위하여 본 계약을 체결하며, 양 당사자는 계약서에 각기 서명 날인하여
        1부씩 이를 보관 한다.
      </p>

      <div className={styles.ackList}>
        <div className={styles.ackRow}>
          <span className={styles.ackWho}>센터매니저</span>
          <span className={styles.ackWhat}>상기내용을 잘 주지시켰음</span>
          <span>서명</span>
          <span className={styles.ackSign} />
        </div>
        <div className={styles.ackRow}>
          <span className={styles.ackWho}>이용자</span>
          <span className={styles.ackWhat}>상기내용을 완전히 숙지하였음</span>
          <span>서명</span>
          <span className={styles.ackSign} />
        </div>
      </div>

      <div className={styles.signGrid} data-no-break="1">
        <div>
          <div className={styles.partyHead}>
            <span className={styles.signStrong}>임대인 : {CONTRACT_LESSOR.NAME}</span>
            <span className={styles.sealWrap}>
              <span>서명(인)</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-seal="1" src="/brand/company-seal.png" alt="사용인감" className={styles.seal} />
            </span>
          </div>
          <div className={styles.partyBody}>
            <div>{CONTRACT_LESSOR.CEO}</div>
            <div>법인등록번호 : {CONTRACT_LESSOR.CORP_NUMBER}</div>
            <div>사업자등록번호 : {CONTRACT_LESSOR.BIZ_NUMBER}</div>
            <div>주소 : {CONTRACT_LESSOR.ADDRESS_SHORT}</div>
            <div>연락처 : {CONTRACT_LESSOR.TEL}</div>
          </div>
        </div>
        <div>
          <div className={styles.partyHead}>
            <span className={styles.signStrong}>
              임차인 : <Blank value={company.companyName} width={120} />
            </span>
            <span className={styles.signSeal}>서명(인)</span>
          </div>
          <div className={styles.partyBody}>
            <div>
              <Blank value={company.ceoName} width={80} />
            </div>
            <div>
              법인등록번호 : <Blank value={company.corpNumber} width={110} />
            </div>
            <div>
              사업자등록번호 : <Blank value={company.bizNumber} width={110} />
            </div>
            <div>
              주소 : <Blank value={props.addressNoZip} width={200} />
            </div>
            <div>
              연락처 : <Blank value={company.tel} width={110} />
            </div>
          </div>
        </div>
      </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Clause({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.clause} data-no-break="1">
      <div className={styles.clauseTitle}>{title}</div>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className={styles.clauseLine}>{children}</p>;
}
