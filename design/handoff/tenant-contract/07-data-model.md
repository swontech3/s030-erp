# 데이터 모델

화면에서 다루는 구조입니다. DB 스키마가 아니라 **화면이 필요로 하는 형태**입니다.
시안 데이터(브릿지랩 등)는 전부 예시입니다.

---

## Company — 회사 기본정보

| 필드 | 타입 | 필수 | 기본값 | 표시 위치 |
|---|---|---|---|---|
| id | string | ● | — | — |
| name | string | ● | — | 섹션1, 좌측 카드 1행, 계약서 |
| nameEn | string | ○ | "" | 설정(조직 정보)에만 |
| bizNo | string | 조건부 | "" | 섹션1 · 좌측 카드 2행 · 계약서 |
| memberType | enum | ● | 프리랜서 | 섹션1 — 프리랜서/개인사업자/법인 |
| corpNo | string | ○ | "" | 섹션1 (법인일 때만) · 전대차계약서 |
| industry | string | ○ | "" | 섹션1 (업종) |
| bizKind | string | ○ | "" | 섹션1 (업태) |
| ceo | string | ● | — | 섹션1 · 섹션3 1행 · 계약서 |
| phone | string | ● | — | 섹션1 · 섹션3 1행 · 계약서 |
| emailId | string | ● | — | 섹션1 (아이디부) |
| emailDomain | string | ● | — | 섹션1 (Select 또는 직접입력) |
| zip / addr1 / addr2 | string | ● | "" | 섹션1 · 계약서 주소 |
| note | string | ○ | "" | 섹션1 특기사항 |
| provisional | boolean | — | false | **계산 필드** — bizNo 가 비었으면 true (가등록) |

`bizNo` 는 memberType 이 개인사업자·법인일 때 필수입니다. 프리랜서는 선택.

---

## Contract — 계약 (조건 1세트)

| 필드 | 타입 | 필수 | 기본값 | 표시 위치 |
|---|---|---|---|---|
| id | string | ● | — | — |
| no | string | — | 서버 채번 | 계약 상세 모달 헤더 (예 CT-2026-0142) |
| companyId | string | ● | — | — |
| status | enum | ● | create | 헤더 · 뱃지 — create/draft/confirmed/terminated/cancelled |
| building | string | ● | 삼성센터 | 섹션2 헤더 |
| floor | string | ● | 3층 | 섹션2 헤더 |
| roomNo | string | ○ | "" | 계약 조건 — 국세청 신고용 대표 호실 |
| signDate | date | ● | — | 계약 조건 · 계약서 날짜 · 전대차 5조 납부일 |
| months | int | ● | — | 계약 조건 · 계약서 이용기간 |
| startDate | date | ● | — | 계약 조건 · 계약서 |
| endDate | date | — | 계산 | **계산 필드** = startDate + months − 1일 |
| payMethod | enum | ● | 월납 | 계약 조건 — 월납/일시불 |
| channel | enum | ○ | 검색 | 계약 조건 — 검색/지인소개/광고/방문 |
| note | string | ○ | "" | 계약 조건 특기사항 (할인 줄 자동 기재) |
| confirmedAt | datetime | — | null | 헤더 보조 안내 |
| terminatedAt | date | — | null | 종료 모달 입력값 |
| terminateReason | string | — | "" | 종료 모달 입력값 |

### 계산 필드 (저장하지 않고 파생)

```
depositTotal = Σ items.deposit
baseTotal    = Σ Room.baseFee
feeTotal     = Σ items.fee
vatTotal     = Σ (items.invoice ? round(items.fee × 0.1) : 0)
monthlyTotal = feeTotal + vatTotal
firstPayment = payMethod === "월납" ? depositTotal + monthlyTotal
                                    : depositTotal + months × monthlyTotal
```

---

## ContractItem — 계약 항목 (N개, 최대 10)

| 필드 | 타입 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|
| id | string | ● | — | |
| contractId | string | ● | — | |
| seq | int | ● | — | 표시 순서 |
| type | enum | ● | — | 비상주/고정석/1인실/2인실/팀오피스 — **중복 허용** |
| roomId | string | ● | — | **중복 허용** (제약은 서버에서 판단) |
| deposit | int | ○ | Room.baseFee | 호실 선택 시 자동, 수정 가능 |
| fee | int | ● | Room.baseFee | 월이용료 — 할인 반영 실제 금액 |
| invoice | boolean | ● | true | 계산서발행 |
| vat | int | — | 계산 | **계산 필드** = invoice ? round(fee × 0.1) : 0 |
| payment | int | — | 계산 | **계산 필드** = fee + vat |

`baseFee` 는 Room 에서 가져오며 항목에 저장하지 않습니다 — 호실 요금이 바뀌어도 계약 금액은 유지되어야 하므로,
**확정 시점에는 스냅샷이 필요합니다.** (TBD — 서버 설계에서 결정)

---

## ContractUser — 입주자 사용자 (N개, 최대 20)

| 필드 | 타입 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|
| id | string | ● | — | |
| contractId | string | ● | — | |
| seq | int | ● | — | |
| name | string | ● | — | 1행은 Company.ceo 미러 (ReadOnly) |
| phone | string | ● | — | 1행은 Company.phone 미러 |
| emailId / emailDomain | string | ● | — | 1행은 Company.email 미러 |
| isRep | boolean | ● | seq===1 | 대표자 — **1명만** |
| selected | boolean | ● | true | 미체크 행은 저장 제외 (값은 유지) |
| note | string | ○ | "" | 비고 — 1행도 입력 가능 |

---

## Attachment — 첨부 서류

| 필드 | 타입 | 필수 | 비고 |
|---|---|---|---|
| id | string | ● | |
| refTable / refId | string | ● | 공통 파일 패턴 — 계약·신청서에서 공유 |
| kind | enum | ● | id / biz / corp |
| fileName | string | ● | 최대 200px 말줄임 표시 |
| size | int | ● | 최대 10MB |
| mime | string | ● | image/jpeg · image/png · application/pdf |
| uploadedAt | datetime | ● | |

필수 여부는 저장하지 않습니다 — `Company.memberType` 에서 파생합니다.

---

## Room — 호실 마스터

| 필드 | 타입 | 필수 | 비고 |
|---|---|---|---|
| id | string | ● | |
| branchId | string | ● | 지점 |
| name | string | ● | 표시명 (예 Room-1) |
| reportNo | string | ○ | 국세청 신고용 번호 (예 1-10) |
| type | enum | ● | 기본 계약구분 |
| baseFee | int | ● | 월회비 기준가 |
| capacity | int | ○ | |
| status | enum | ● | 공실 / 사용중 / 점검 |

호실 관리 화면은 **2차 범위**입니다. 1차에서는 읽기 전용 마스터로만 씁니다.

---

## 미정 (TBD)

| 항목 | 내용 |
|---|---|
| 요금 스냅샷 | 확정 시점의 `baseFee` 를 항목에 저장할지 |
| 계약번호 채번 | `CT-YYYY-NNNN` 의 일련번호 리셋 주기 |
| 첨부 저장소 | Supabase Storage 사용 시 공개 업로드 버킷 분리 여부 |
| 국세청 API | 사업자등록상태조회 실연동 여부 |
