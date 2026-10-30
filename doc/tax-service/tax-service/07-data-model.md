# 데이터 구조

필드명은 예시입니다. 의미와 단위를 지켜 주세요. 금액은 원 단위 정수.

---

## 1. 표준양식 — 업로드 후 시스템이 저장하는 칸

기관 엑셀은 업로드 때 아래로 바꿉니다. 기관별 변환표(국민·우리·하나은행, 국민·우리카드)는 개발에서 관리.

| 자료 | 칸 |
|---|---|
| 매입·매출 계산서 | 홈택스 목록 그대로 — 구분(매입/매출) · 작성일 · 승인번호 · 거래처명 · 사업자번호 · 공급가액 · 세액 · 종류(세금계산서/계산서) |
| 카드 사용 내역 | **사용일자** · **결제일** · **적용월** · 가맹점 · 가맹점 사업자번호(있으면) · 금액 · 승인번호 · 카드 ID — ★ 2026-10-30: 홈택스 사업용 신용카드 사용내역만 받는다. 이 파일에는 **결제일 · 적용월 · 승인번호가 없다** — 저장 칸은 사용일자 · 카드 끝 4자리 · 가맹점 · 가맹점 사업자번호 · 공급가액 · 세액 · 비과세 · 합계 · 공제 여부 · 비고(불공제 사유)(208). 결제일 · 적용월로 하는 카드대금 짝 맞추기는 은행 짝 맞추기 단계에서 다시 정한다 |
| 현금 경비 | 날짜 · 내용 · 금액 · **항목**(비워도 됨) · 거래처(선택) — ★ 2026-10-30 표준 양식: 날짜 · 품명 · 거래처 · 항목 · 매출액 · 매입액(하나만) · 지급방법 · 증빙(선택), 1줄 안내 · 2줄 제목 |
| 은행 입출금 | 거래일 · 내용(적요) · 입금 · 출금 · 잔액 · 계좌 ID |
| 급여대장 | 이름 · **소득 구분(근로/사업)** · 귀속월 · 지급일 · 지급액 · 소득세 · 지방소득세 · 4대보험 본인 부담(근로) — **주민번호 칸 없음** |
| 국세 · 지방세 납부 | 납부일 · **세목** · 귀속 · 금액 |
| 대출 내역 | 날짜 · 구분(실행/상환) · **원금** · **이자** · 대출 기관 |

카드 날짜 셋의 쓰임:

| 칸 | 쓰는 곳 |
|---|---|
| 사용일자 | 비용 · 부가세를 잡는 날. 업로드 때 달 나누기 |
| 결제일 | 은행 카드대금 출금과 짝을 찾는 날 |
| 적용월 | 어느 청구에 묶이는지. 「9월 청구 합계」 = 적용월 9월인 줄의 합 |

---

## 2. 공통 코드 표

화면에 박지 않습니다.

### 분류 항목

```ts
interface TaxItem {
  code: string;
  name: string;              // "식대·회의비"
  gloss?: string;            // "직원 식사·회의 다과" — Select 에 「이름 — 풀이」
  direction: "in" | "out";   // 입금 / 출금 — 입금 줄엔 in, 출금 줄엔 out 만
  scope: "all" | "corp" | "indiv";
  vatDeductEstimate?: boolean;  // 출금 · 카드 공제 추정 (부가세 화면)
  vatSales?: boolean;        // 입금 · 부가세 매출에 잡음 (계산서 없는 매출)
  sort: number;
}
```

시안의 목록:

| 구분 | 항목 |
|---|---|
| 입금 (8) | 계산서 없는 매출(`vatSales`) · 이자 수입 · 세금 환급 · 보조금 · 지원금 · 대표가 넣은 돈 · 기타 수입 · 잘 모름 — 세무사에게 묻기 |
| 출금 공통 | 사무실 월세 · 통신비 · 소모품비 · 식대·회의비 · 교통·출장비 · 택배·운송비 · 광고비 · 수수료 · 외주 용역비 · 보험료 · 수선비 · 교육·도서비 · 잘 모름 — 세무사에게 묻기 |
| 출금 법인만 | 접대비 · 사업과 무관 — 세무사 판단 |
| 출금 개인만 | 거래처 경조사비 · 사업과 무관 — 대표 인출 |

공제 추정 `예`(시안): 월세 · 통신비 · 소모품비 · 식대·회의비 · 교통·출장비 · 택배·운송비 · 광고비 · 외주 용역비 · 수선비. 실제 값은 세무사 검토를 거쳐 정해 주세요.

### 설정값

| 키 | 기본 | 쓰는 곳 |
|---|---|---|
| `match.feeLimit` | 10000 | 짝 차이 수수료 기준 |
| `match.dateTolerance` | 3 (일) | 자동 확정 |
| `match.monthRange` | 2 (개월) | 후보 찾기 범위 |

---

## 3. 주요 엔티티

```ts
interface TaxSettings {            // 회사당 하나. 회사 기본정보는 삐용 단체 참조
  orgId: string;
  bizType: "indiv" | "corp";
  taxEmails: { name: string; email: string }[];   // ≤ 3
  accounts: { id; bank: "국민은행" | "우리은행" | "하나은행"; no; alias; active: boolean }[];
  cards: { id; issuer: "국민카드" | "우리카드"; last4; alias; active: boolean }[];
  unusedKinds: KindId[];           // 쓰지 않는 자료
  withholdingHalfYear: boolean;
}

interface MonthState {             // 회사 × 작업 달
  month: "2026-09";
  noneKinds: KindId[];             // 이번 달 없음 — 다음 달로 잇지 않음
  ppiyongImportedAt?: string;
  withholdingFile?: { createdAt; fileId };
  sends: { at; to: string[]; files: string[]; remaining: { match: number; classify: number; withholding: boolean } }[];
  changedAfterSend: boolean;       // 06-rules.md#7
}

interface UploadFile { id; month; kind: KindId; accountId?; cardId?; name; hash; rows; uploadedAt; }

interface BankRow {
  id; accountId; date; desc; in?: number; out?: number; fileId;
  match: {
    state: "auto" | "confirmed" | "candidate" | "none";
    targets?: { type: PairKind; refId?: string; month: string; amount: number }[];  // 여러 줄 묶음 가능
    diff?: number;                 // 은행 − 상대
    diffHandling?: "fee" | "split";   // 1만 원 이하 수수료 / 넘으면 「나눠서 낸 것」(일부 짝)
    remaining?: { side: "doc" | "bank"; amount: number; sentToClassify?: boolean };
                                   // 일부 짝의 남은 금액. doc 쪽은 비용·수입 아님 / bank 쪽은 다 맞춘 뒤 분류로 넘길 수 있음
  };
  classify?: { itemCode: string; confirmed: boolean };
}

type PairKind = "invoice_p" | "invoice_s" | "card_bill" | "payroll" | "national_tax" | "local_tax"
              | "social_insurance" | "loan" | "ppiyong_settle" | "own_transfer" | "owner_deposit";

interface PpiyongExpense {          // 삐용에서 가져온 사본
  ppiyongId; useDate; employee; desc; amount; payMethod: "corp_card" | "own";
  status: "ok" | "cancelled";
  link?: { cardRowId?: string; bankRowId?: string };
}

interface Vendor { id; name; bizNo?; isMain: boolean; firstSource: KindId; }
```

`autoMatched` 와 `confirmed` 를 나눠 저장해야 「자동」 배지를 유지할 수 있습니다.

---

## 4. 처리 메모

| 항목 | 메모 |
|---|---|
| 같은 파일 | 해시로 판정 권장 |
| 중복 의심 | 같은 자료 종류 · 같은 계좌/카드 · 날짜 · 내용 · 금액이 모두 같은 줄 |
| 거래처 자동 생성 | 사업자번호가 있으면 사업자번호로, 없으면 이름으로 찾음 |
| 거래처 합치기 | 합쳐진 거래처를 가리키던 모든 줄을 남긴 거래처로 옮김. 되돌리기 없음 |
| 계좌 「사용 안 함」 | `active=false`. 업로드 선택지에서만 빠짐 |
| 정리본 엑셀 | 시트 11개 (`04-results.md#4`). 분류 「잘 모름」 · 추정 값 · 다른 달 짝은 표시 칸을 둠 |
| 메일 | 삐용 기존 발송 수단. 첨부 크기 제한은 그 수단을 따름 — 원본 압축이 크면 안내 필요 |
