/**
 * 재계약 — **판정과 복사만** 한다. DB 도 화면도 여기서 만지지 않는다.
 *
 * =============================================================================
 * ★★★ 이전 계약은 **확정하는 순간**에만 닫힌다
 * =============================================================================
 * 재계약을 **확정**하면 이전 계약이 **같은 트랜잭션에서** 종료된다(CONT-02).
 * 하나만 바뀌고 멈추면 두 계약이 동시에 계약중이거나(호실이 이중으로 잡힌다)
 * 둘 다 끝난 상태(입주사에 유효 계약이 없다)가 된다 — 배선은 `routes/contracts.ts` 다.
 *
 * ★ 그 전까지는 **이전 계약이 살아 있다.** 재계약 폼을 열어 두고 저장하지 않은 동안
 *   이전 계약은 그대로 계약중이고, 호실도 계약호실도 계속 잡고 있다. 즉 저장 검증이
 *   도는 시점에는 **두 계약이 같은 호실을 동시에 들고 있는 것이 정상**이다.
 *   그래서 아래 `selfContractIds` 가 필요하다.
 *
 * ★ 종료·취소된 계약을 이어받을 때는 닫을 것이 없다(`closesPrevious`).
 *
 * ★ **기간 만료로 저절로 닫히는 일은 없다.** 자동 종료 배치를 만들지 않았다 —
 *   운영자가 확인하고 손으로 닫는다(`contract-status` 의 `isContractExpired`).
 *
 * =============================================================================
 * ★★ 「자기」가 하나가 아니다
 * =============================================================================
 * 지금까지 중복 판정은 «자기 계약 하나»만 제외했다(`selfContractId`). 재계약에서는
 * 그것이 **둘**이다 — 지금 편집 중인 계약과, 이어받은 이전 계약.
 *
 *   저장 전 재계약   자기 ID 가 아직 없다. 제외할 것은 **이전 계약뿐**이다
 *   저장 후 재계약   **둘 다** 제외한다. 안 그러면 열어서 그대로 저장조차 막힌다
 *
 * 빠뜨리면 증상은 하나다 — **재계약이 자기 이전 계약과 부딪혀 저장이 막힌다.**
 * 「이미 사용 중인 계약호실입니다 (자기 회사 이름)」이 그 모습이다.
 *
 * 그래서 목록을 만드는 자리를 여기 하나로 두고 **화면과 서버가 같이 부른다.**
 *   화면  `ContractForm` → `SectionContract` · `RoomPickerModal`
 *   서버  `routes/contracts.ts` 의 `roomConflict` · `spaceConflict`
 */
import { dayAfter, parseDay } from './day.ts';

/**
 * 이 편집이 «자기»로 보는 계약 ID 들.
 *
 * ★ 순서는 자기 → 이전이다. 중복 판정은 집합으로만 쓰지만, 로그에 찍혔을 때
 *   어느 쪽이 무엇인지 읽히는 편이 낫다.
 *
 * ★ 빈 문자열은 **넣지 않는다.** 저장 안 된 호실 줄의 `contractId` 가 `''` 로 오는
 *   경로가 있고, 그게 목록에 들어가면 남의 빈 계약까지 자기로 본다.
 */
export function selfContractIds(args: {
  contractId?: string | null;
  renewedFromContractId?: string | null;
}): string[] {
  const out: string[] = [];
  for (const raw of [args.contractId, args.renewedFromContractId]) {
    const id = (raw ?? '').trim();
    if (id === '' || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** 이어받는 호실 줄. 금액은 **이전 계약 그대로**다 — 호실의 지금 기준가가 아니다. */
export interface RenewalSpace {
  roomType: string;
  spaceId: string;
  standardFee: number;
  deposit: number;
  monthlyFee: number;
  vatYn: boolean;
}

/** 이어받을 이전 계약. 계약 조회 응답에서 필요한 칸만 추린 모양이다. */
export interface RenewalSource {
  contractId: string;
  companyId: string;
  buildId: string;
  contractRoom: string | null;
  paymentMethod: string | null;
  accessRoute: string | null;
  periodMonths: number | null;
  /**
   * 이전 계약의 상태 — **시작일 규칙이 여기서 갈린다**(`isPreviousLive`).
   *
   *   계약중·계약대기   아직 호실을 잡고 있다 → 시작일은 **그 종료일 다음 날**
   *   종료·취소         이어붙일 것이 없다   → 시작일은 **오늘**
   */
  status: string;
  /** 이전 계약의 시작일 `YYYY-MM-DD`. **특기사항 문구의 기간**에만 쓴다. */
  startDate: string | null;
  /**
   * 이전 계약의 종료일 — 살아 있는 계약이면 새 계약의 **시작일을 여기서 뽑는다**(다음 날).
   *
   * ★★ **`YYYY-MM-DD` 로 정규화해서 넘긴다.** API 응답의 날짜는
   *    `2026-12-31T15:00:00.000Z` 같은 모양으로 오고(pg 가 로컬 자정의 Date 를 주고
   *    JSON 이 UTC 로 바꾼다), 그걸 앞 10자로 자르면 **하루 앞선 날짜**가 나온다.
   *    그래서 이 함수는 그런 값을 **받아 주지 않고** 오늘로 떨어뜨린다 — 조용히
   *    하루 밀린 시작일을 만드는 것보다 낫다. 화면은 `toDateInput` 을 거쳐 넘긴다.
   */
  endDate: string | null;
  spaces: readonly RenewalSpace[];
}

/**
 * 재계약 폼의 첫 값.
 *
 * ★ **종료일이 없다.** 새 시작일과 기간으로 다시 계산되는 값이라 이어받으면 그 순간
 *   이전 계약의 종료일이 새 계약에 박힌다. 계산은 `calcEndDate` 한 곳뿐이다.
 *
 * ★ **상태도 계약번호도 없다.** 새 계약은 처음부터 시작한다.
 */
export interface RenewalSeed {
  companyId: string;
  /** ★ `tb_s080_contracts.renewed_from_contract_id` 에 그대로 들어간다(CSCH-04). */
  renewedFromContractId: string;
  buildId: string;
  contractRoom: string;
  paymentMethod: string;
  accessRoute: string;
  /** 오늘. 오늘 맺는 계약이다. */
  contractDate: string;
  /**
   * ★★ **이전 계약 상태로 갈린다.**
   *
   *   계약중·계약대기   **그 종료일의 다음 날.** 이어지는 계약이라 하루도 비지 않고
   *                     겹치지도 않는다 — 오늘을 넣으면 만기 전 재계약이 **아직 살아
   *                     있는 계약의 기간 위에 겹쳐 시작한다.**
   *                     ★ 기간 만료도 여기다. 상태가 `confirmed` 그대로이고 호실도 계속
   *                       잡고 있다. **과거 날짜로 채워지지만 공백 없이 이어진다.**
   *   종료·취소         **오늘.** 이어붙일 것이 없다 — 지나간 종료일에 맞추면 다시
   *                     들어오는 입주사가 과거부터 계약하게 된다.
   *
   * ★ **기본값일 뿐이다.** 운영자가 화면에서 바꾼다. 이전 종료일을 읽을 수 없으면
   *   오늘로 떨어진다 — 시작일은 필수값이라 빈 칸으로 두면 저장이 막힌다.
   */
  startDate: string;
  /** 이전과 같은 기간. 화면 상태가 문자열이라 문자열로 준다. */
  months: string;
  /**
   * 무상 개월수 — **언제나 `0`** 이다.
   *
   * ★★ 무상은 처음 들어올 때 주는 혜택이라 **이어받지 않는다.** 자동으로 또 주면
   *    운영자가 의도하지 않은 무상이 조용히 따라붙고, 그건 중도 해지 환수 금액까지
   *    바꾼다. 필요하면 운영자가 화면에서 다시 넣는다.
   *
   * ★ `RenewalSource` 에 무상 칸을 **두지 않는 것**이 그 규칙의 표현이다 —
   *   이어받을 값이 애초에 없으니 실수로 이어받을 수도 없다.
   */
  freeMonths: string;
  /**
   * 특기사항 — 「재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)」.
   *
   * ★★ `renewed_from_contract_id` 는 **DB 안에만 있다.** 이용계약서를 받는 입주사는
   *    그것을 볼 수 없으므로, 사람이 읽을 문장으로 특기사항에 남긴다 — 그대로 인쇄된다.
   *
   * ★ **기본값일 뿐이다.** 운영자가 지우거나 고칠 수 있다.
   * ★ 첫 줄에 자동으로 얹히는 할인 문구와 부딪히지 않는다 — `withDiscountLine` 은
   *   「기준가 대비 」로 시작하는 줄만 갈아 끼우고 나머지는 **밀어낸다**.
   */
  memo: string;
  spaces: RenewalSpace[];
}

/** `null` 을 화면 입력값으로 흘리지 않는다 — Select 가 값 없는 상태로 열린다. */
const text = (value: string | null | undefined): string => (value ?? '').trim();

/** `YYYY-MM-DD` → `YYYY.MM.DD`. 읽을 수 없으면 `null` — 지어내지 않는다. */
const dotted = (iso: string): string | null =>
  parseDay(iso) === null ? null : iso.replace(/-/g, '.');

/**
 * 특기사항 첫 값 — 「재계약 (이전 계약 기간 2026.01.02 ~ 2027.01.01)」.
 *
 * ★ 기간을 읽을 수 없으면 **「재계약」만** 남긴다. 모르는 날짜를 계약서에 찍지 않는다.
 */
export function renewalMemo(prev: Pick<RenewalSource, 'startDate' | 'endDate'>): string {
  const from = dotted(text(prev.startDate));
  const to = dotted(text(prev.endDate));
  return from && to ? `재계약 (이전 계약 기간 ${from} ~ ${to})` : '재계약';
}

/**
 * 이전 계약 → 재계약 폼의 첫 값.
 *
 * ★ **이전 계약의 특기사항은 이어받지 않는다.** 그 계약 당시의 사정을 적은 자리다.
 *   대신 **어느 계약을 이어받았는지**를 새 문장으로 남긴다(`renewalMemo`) — 계약서에
 *   그대로 인쇄되고, 운영자가 지우거나 고칠 수 있다.
 *
 * ★ 회사 정보·구성원·첨부는 여기 없다. 그것들은 **계약이 아니라 회사에 붙어 있어서**
 *   같은 회사를 열면 그대로 따라온다(3-4). 복사할 것이 아니라 이미 거기 있는 것이다.
 *
 * @param today `YYYY-MM-DD`. 「오늘」을 이 함수가 정하지 않는다 — 부르는 쪽의 시간대를
 *   여기서 추측하면 하루가 밀린다. 계약일자가 이 값이고, 이전 계약이 이미 닫혔거나
 *   종료일을 읽을 수 없을 때 시작일이 떨어지는 자리이기도 하다.
 */
export function buildRenewalSeed(prev: RenewalSource, today: string): RenewalSeed {
  /*
   * ★★ 시작일만 오늘이 아닐 수 있다 — **이전 계약이 아직 살아 있을 때만**.
   *    닫힌 계약의 종료일은 지나간 날짜라, 거기에 이어붙이면 다시 들어오는 입주사가
   *    **과거부터 계약하게 된다.**
   */
  const startDate = isPreviousLive(prev.status)
    ? (dayAfter(text(prev.endDate)) ?? today)
    : today;

  return {
    companyId: prev.companyId,
    renewedFromContractId: prev.contractId,
    buildId: prev.buildId,
    contractRoom: text(prev.contractRoom),
    paymentMethod: text(prev.paymentMethod),
    accessRoute: text(prev.accessRoute),
    contractDate: today,
    startDate,
    months: prev.periodMonths ? String(prev.periodMonths) : '',
    // ★ 이어받지 않는다. 위 `RenewalSeed.freeMonths` 주석 참조.
    freeMonths: '0',
    memo: renewalMemo(prev),
    spaces: prev.spaces.map((s) => ({ ...s })),
  };
}

/**
 * 이 계약을 이어받아도 되는가 — 통과면 `null`, 아니면 **사용자에게 보여줄 문구**.
 *
 * ★★ **서버가 부르는 자리다.** `?renewFrom=` 은 주소창에 있는 값이라 화면이 고른 계약
 *    이라고 믿을 수 없다. 남의 계약을 이어받으면 **그 회사의 조건과 금액이 이 회사
 *    계약에 그대로 복사된다** — 남의 임대료가 우리 계약서에 찍히는 자리다.
 *
 * ★ **상태는 보지 않는다.** 종료된 계약을 이어받는 것이 재계약의 원래 모습이고,
 *   계약중인 계약을 이어받는 것도 만기 전 갱신이라 정상이다.
 *
 * ★ **닫을지 말지는 여기서 정하지 않는다** — 확정 시점에 `closesPrevious` 가 본다.
 */
export function rejectRenewal(
  previous: { companyId: string; status: string } | null,
  companyId: string,
): string | null {
  if (!previous) return '이어받을 계약을 찾을 수 없습니다';
  if (previous.companyId !== companyId) return '다른 입주사의 계약은 이어받을 수 없습니다';
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   이전 계약이 아직 살아 있는가 — **두 규칙이 이 판정 하나를 본다**
   ══════════════════════════════════════════════════════════════════════════
   ① 확정할 때 이전 계약을 **닫을지**
   ② 새 계약 시작일을 이전 종료일에 **이어붙일지**

   둘 다 「아직 호실을 잡고 있는가」 하나로 갈린다. 두 벌로 두면 한쪽만 고쳐져
   갈리고, 그때 생기는 상태가 **닫지도 않았는데 시작일은 오늘**(기간이 겹친다)이거나
   **닫았는데 시작일은 과거**(다시 들어오는 입주사가 과거부터 계약한다)다.

   ★ 기간 만료도 **살아 있는 계약**이다. 종료일이 지나도 상태는 `confirmed` 그대로이고
     호실을 계속 잡는다 — 자동 종료 배치를 만들지 않았기 때문이다.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 이전 계약이 아직 살아 있는가.
 *
 * ★ **이미 종료·취소된 계약은 건드리지 않는다.** 다시 닫으면 종료일자와 사유가
 *   덮여서 원래 왜 끝났는지가 사라진다. 종료된 계약을 이어받는 것은 정상 경로다
 *   (`rejectRenewal` 이 상태를 보지 않는 이유).
 *
 * ★ 모르는 상태도 살아 있지 않은 것으로 본다 — 모르면 손대지 않는다.
 */
export function isPreviousLive(previousStatus: string): boolean {
  return previousStatus === 'confirmed' || previousStatus === 'draft';
}

/* ══════════════════════════════════════════════════════════════════════════
   시작일 검사 — 살아 있는 계약과는 하루도 겹치지 않는다
   ══════════════════════════════════════════════════════════════════════════
   `buildRenewalSeed` 가 기본값을 넣지만 운영자가 바꿀 수 있다. 그래서 검사가 따로
   필요하고, **화면과 서버가 같은 함수를 본다** — 화면만 막으면 API 로 통과한다.

   ★★ 겹치면 두 계약이 같은 날 같은 호실·같은 계약호실을 동시에 들고, 그 상태는
      재계약 예외(`selfContractIds`)가 **일부러 허용하는 모양**이라 중복 판정에
      걸리지 않는다. 즉 **아무도 못 알아챈다.** 여기서 막아야 하는 이유다.

   ★★★ **이전 계약이 닫혔으면 검사하지 않는다.** 겹칠 상대가 없고, 지나간 종료일에
        맞추라고 하면 다시 들어오는 입주사가 **과거부터 계약해야 한다.**
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 시작일이 이전 계약 종료일 **다음 날 이후**인가 — 통과면 `null`, 아니면 보여줄 문구.
 *
 * ★ **종료일 당일도 막는다.** 종료일 당일까지는 이전 계약이 살아 있다
 *   (`isContractExpired` 의 경계와 같다). 하루 겹침이 생기면 그날 같은 호실에 두
 *   계약이 있다.
 *
 * ★ 비는 기간은 막지 않는다. 한참 뒤부터 다시 시작하는 재계약이 있다.
 *
 * ★ 읽을 수 없는 날짜는 **여기서 막지 않는다.** 시작일 형식은 저장 경로가 따로 보고
 *   (`parseDate` → 400), 이전 종료일을 모르면 검사할 근거가 없다 — 지어내지 않는다.
 */
export function rejectRenewalStart(args: {
  startDate: string;
  /** 이어받는 이전 계약. 없으면 검사할 것이 없다. */
  previous: { status: string; endDate: string | null } | null;
}): string | null {
  // ★★ 닫힌 계약과는 겹칠 수 없다 — 검사 자체를 하지 않는다.
  if (!args.previous || !isPreviousLive(args.previous.status)) return null;

  const start = text(args.startDate);
  const end = text(args.previous.endDate);
  // 읽을 수 없는 날짜는 여기서 판정하지 않는다 — 위 ★ 참조.
  if (parseDay(start) === null || parseDay(end) === null) return null;

  // `YYYY-MM-DD` 는 **사전순 비교가 곧 날짜순**이다. 둘 다 읽히는 것을 확인한 뒤이므로
  // 자릿수가 어긋날 일이 없다.
  if (start > end) return null;

  return `시작일은 이전 계약 종료일(${end})의 다음 날부터입니다`;
}

/* ══════════════════════════════════════════════════════════════════════════
   확정 한 번에 두 계약 — 이전 계약을 닫는다
   ══════════════════════════════════════════════════════════════════════════
   ★★★ 재계약을 **확정**하면 이전 계약이 같은 트랜잭션에서 종료된다. 하나만 바뀌고
        멈추면 두 계약이 동시에 계약중이거나(호실이 이중으로 잡힌다) 둘 다 끝난
        상태(입주사에 유효 계약이 없다)가 된다.

   ★ 임시저장에서는 닫지 않는다 — 애초에 재계약 화면에 [임시저장] 이 없다.
     닫는 시점은 **계약이 성립하는 순간** 하나뿐이다.

   ★ 종료일자는 **이전 계약의 원래 종료일**이다. 오늘을 넣으면 만기 전 재계약에서
     이전 계약이 실제보다 짧았던 것으로 남는다.

   ★ 닫을지 말지는 `isPreviousLive` 가 본다 — 시작일 규칙과 **같은 판정**이다.
   ══════════════════════════════════════════════════════════════════════════ */

/** 재계약 확정으로 이전 계약을 닫을 때의 사유. */
export const PREVIOUS_TERMINATION_REASON = '재계약으로 계약 종료';
