/**
 * 재계약 — **판정과 복사만** 한다. DB 도 화면도 여기서 만지지 않는다.
 *
 * =============================================================================
 * ★★★ 이전 계약은 **살아 있는 채로** 남는다
 * =============================================================================
 * 재계약을 만들어도 이전 계약을 자동으로 종료하지 않는다(CONT-02). 운영자가
 * 이전 계약을 언제 닫을지는 따로 정한다 — 새 계약을 만드는 것과 옛 계약을 닫는 것은
 * 다른 결정이고, 하나의 저장이 둘 다 하면 되돌릴 수 없다.
 *
 * 그 결과 **두 계약이 같은 호실·같은 계약호실을 동시에 들고 있는 순간**이 정상이 된다.
 * 그래서 아래 `selfContractIds` 가 필요하다.
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
  /** 오늘. */
  contractDate: string;
  /** 오늘. */
  startDate: string;
  /** 이전과 같은 기간. 화면 상태가 문자열이라 문자열로 준다. */
  months: string;
  spaces: RenewalSpace[];
}

/** `null` 을 화면 입력값으로 흘리지 않는다 — Select 가 값 없는 상태로 열린다. */
const text = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * 이전 계약 → 재계약 폼의 첫 값.
 *
 * ★ **특기사항(`memo`)은 이어받지 않는다.** 복사 대상은 조건과 금액이고, 특기사항은
 *   그 계약 당시의 사정을 적은 자리다. 첫 줄의 할인 문구는 어차피 금액에서 다시
 *   만들어진다(`withDiscountLine`).
 *
 * ★ 회사 정보·구성원·첨부는 여기 없다. 그것들은 **계약이 아니라 회사에 붙어 있어서**
 *   같은 회사를 열면 그대로 따라온다(3-4). 복사할 것이 아니라 이미 거기 있는 것이다.
 *
 * @param today `YYYY-MM-DD`. 「오늘」을 이 함수가 정하지 않는다 — 부르는 쪽의 시간대를
 *   여기서 추측하면 하루가 밀린다.
 */
export function buildRenewalSeed(prev: RenewalSource, today: string): RenewalSeed {
  return {
    companyId: prev.companyId,
    renewedFromContractId: prev.contractId,
    buildId: prev.buildId,
    contractRoom: text(prev.contractRoom),
    paymentMethod: text(prev.paymentMethod),
    accessRoute: text(prev.accessRoute),
    contractDate: today,
    startDate: today,
    months: prev.periodMonths ? String(prev.periodMonths) : '',
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
 *   계약중인 계약을 이어받는 것도 만기 전 갱신이라 정상이다. 이전 계약을 자동으로
 *   닫지 않으므로 두 계약이 겹치는 기간이 생기는데, 그것은 `selfContractIds` 가
 *   다룬다.
 */
export function rejectRenewal(
  previous: { companyId: string; status: string } | null,
  companyId: string,
): string | null {
  if (!previous) return '이어받을 계약을 찾을 수 없습니다';
  if (previous.companyId !== companyId) return '다른 입주사의 계약은 이어받을 수 없습니다';
  return null;
}
