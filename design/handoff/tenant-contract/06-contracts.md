# 계약서 2종

이용계약서 · 전대차계약서. 갑 = **㈜에스원테크**, 을 = **회원(입주사)** 로 두 문서를 통일합니다.

---

## 미리보기 모달

confirmed 이후에만 열립니다 (헤더 [계약서 출력] 버튼).

```
모달   폭 1000px, 높이 92vh, 스크림 rgba(11,17,32,.55)
헤더   패딩 20px 24px, 하단 1px --border
       좌: 문서 탭 segmented — [이용계약서] [전대차계약서]
       우: [인쇄] ghost 36px + printer 16px (툴팁 "인쇄 창에서 PDF로 저장할 수 있습니다")
           + 닫기 x 20px
본문   배경 --surface-alt, 패딩 16px, 세로 스크롤
       내부 문서 영역 폭 794px (A4), 배경 #FFFFFF, --shadow-float, 패딩 40px
```

**PDF 저장 버튼을 만들지 않습니다.** 브라우저 인쇄 대화상자의 "PDF로 저장"을 씁니다.

---

## 이용계약서

### 상단
```
좌측  S·wonBiz 로고 (심볼 28px + 워드마크)
중앙  "이 용 계 약 서"  40px/700, letter-spacing .15em  (상단 20px)
```

### 섹션 제목 공통
```
좌측 3px --color-primary 세로 바 (높이 16px, 우측 여백 8px)
텍스트 16px/700 --text-heading
상단 여백 24px (첫 섹션 20px), 하단 10px
번호를 붙이지 않습니다.
```

### 섹션 1 · 계약 정보 — 표 8행

보더 `1px #000`, 라벨 열 120px (배경 `--surface-alt`, 중앙, 14px/700), 값 열 패딩 8px 12px, 14px

| 행 | 좌 | 우 | 데이터 출처 |
|---|---|---|---|
| 1 | 계약구분 | 회원구분 | 항목 요약 / `Company.memberType` |
| 2 | 회원명 | 사업자번호 | `Company.name` / `Company.bizNo` |
| 3 | 연락처 | E-mail | `Company.phone` / 아이디@도메인 |
| 4 | 주소 (전체 병합) | | 우편번호 + 기본 + 상세 |
| 5 | 이용기간 (전체 병합) | | 시작일 ~ 종료일 (N개월) |
| 6 | 이용호실 | 예치금 | 호실명 " / " 연결 / 예치금 합계 |
| 7 | 월납부액 | 첫달납부액 | 월납부액 합계 / 첫달납부액 |
| 8 | 특기사항 (전체 병합, 최소 높이 80px) | | 섹션1 + 섹션2 특기사항을 줄바꿈 병합 |

**5행 하단 주석** 12px `--text-muted`
"* 년단위 계약의 경우 이용기간 만료 1개월 전까지 별도의 서면 해지의사가 없으면 원계약 단위로 자동연장됩니다."

**7행 첫달납부액** — "1,240,000 원 (월납)" 한 줄. 금액 `--text-heading`, 납부방법 `--text-muted` 좌측 4px, `nowrap`

#### 계약구분 요약 규칙
```
항목 1개  "1인실"
항목 N개  "{첫 항목 계약구분} 외 {N-1}건"   예) "1인실 외 2건"
```

#### 이용호실 규칙
```
호실명만 " / " 로 연결   예) "Room-1 / Room-2 / Room-15"
계약구분은 표기하지 않습니다.
계약호실(국세청 신고용)도 표기하지 않습니다 — 전대차계약서 전용입니다.
칸을 넘치면 자동 줄바꿈.
```

#### 월납부액 부가세 표기
```
전 항목 계산서발행 체크  "968,000 원 (부가세 포함)"
일부만 체크             "968,000 원 (일부 부가세 포함)"
전부 해제               "880,000 원"
```

### 섹션 2 · 오피스 정보 — 표 3행

| 행 | 좌 | 우 |
|---|---|---|
| 1 | 센터명 · 강남 삼성점 | 담당자 · 이정희 |
| 2 | 전화번호 · 070-4355-2312 | Fax번호 · 070-4015-3344 |
| 3 | 이메일 · swonbiz@s-onetech.com | 은행(계좌번호) · 우리은행 1005-002-433395 |

3행 은행 값 아래 12px `--text-muted` "예금주 ㈜에스원테크"

> 센터명·담당자는 **설정 → 지점 설정**의 값에서 옵니다.
> 지점에 담당자가 지정돼 있으면 그 값이 조직 정보의 기본값보다 우선합니다.

### 섹션 3 · 이용안내

박스 (배경 `--surface-alt`, radius `--radius-md`, 패딩 14px 18px), 항목 앞에 "- ", 14px/1.8

- 이용범위는 사무공간과 부대시설(회의실, 접견실, 휴게실, IT기기, 유무선 통신망)을 이용 가능
- 계약기간 만료 또는 종료시 사업자 주소지와 전화를 7일 이내에 이전해야 하고, 계약을 해지할 경우 7일 이전에 서면 또는 구두 통보 해야함.

### 섹션 4 · 서명란 (제목 없음)

구분선 `1px --border` (상단 24px) → 약정 문구 박스 → 날짜 → 서명란

**약정 문구** (배경 `--surface-alt`, 패딩 14px 18px, 14px/1.8)
전문은 원본 템플릿 참조. 마지막 줄은 weight 700 — "* 본 이용계약서로는 임대차계약서를 대신할 수 없음"

**날짜** (상단 36px, 우측 정렬, 16px)
`Contract.signDate` 를 "2026 년 1 월 10 일" 형식으로. 비어 있으면 "____ 년 __ 월 __ 일" `--text-caption`

**서명란** (상단 32px, 2열 grid, `align-items:flex-start`)

```
[갑]
 1행  "갑 : 서울특별시 강남구 봉은사로 55길 19, 3층(삼성동, 우리빌딩)"  16px
 2행  "㈜에스원테크  대표자 최 현 수" 16px/700  +  "(인)"
      ★ 인감 이미지 56px 을 "(인)" 위에 겹칩니다
        position:absolute; left:50%; top:50%;
        transform:translate(-50%,-50%); opacity:.9; z-index:1; pointer-events:none

[을]
 1행  "을 : " + 주소 (하단 실선 1px --text-heading)
 2행  회사명 + 대표자 16px/700  +  "(인)"   우측 정렬
      도장 자리는 비워둡니다 (출력 후 직접 날인)
```

---

## 전대차계약서

세무서 제출용입니다. **계약구분·이용내역을 표기하지 않습니다.**

### 구성
```
제목      "전 대 차 계 약 서"  40px/700, letter-spacing .15em
당사자    "갑 : ㈜에스원테크  최현수"  /  "을 : {회사명}  {대표자}"   각 16px, 행 간격 8px
도입 문구  "위 갑과 을은 {계약일자} 다음과 같이 회원 가입을 체결 한다."
          형식 "2026년 1월 10일", 비어 있으면 "20__ 년 __ 월 __ 일"
조항      1~10조
맺음 문구  상단 24px
확인란    2행 — 센터매니저 / 이용자, 서명 자리 하단 실선 120px
서명란    2열
```

### 조항 제목 / 본문
```
조 제목  16px/700, 상단 여백 20px, page-break-inside:avoid
항 내용  14px/1.8, 들여쓰기 16px, 행 간격 6px
```

### 자동 채움 위치

| 위치 | 데이터 |
|---|---|
| 도입 문구 | `Contract.signDate` |
| 2조 2항 대상 | `Contract.roomNo` (계약호실 1개만) |
| 2조 2항 월회비 | **월납부액 합계** (= 월이용료 합계 + 부가세액 합계) |
| 3조 1항 | 시작일 / 종료일 |
| 4조 1항 | 예치금 합계 |
| 5조 1항 | 계약일자에서 **일(day)만** 추출 |
| 서명란 을 | 회사명 / 대표자 / 법인등록번호 / 사업자번호 / 주소 / 연락처 |

### ★ 2조 2항 금액 표기

```
대상 : 서울시 강남구 봉은사로55길 19, 3층 {계약호실}호 (삼성동, 우리빌딩)
용도 : 업무용
월회비 : {월납부액 합계} 원
```

**VAT 행을 두지 않습니다.** 항목별로 계산서발행 여부가 다를 수 있어
월회비와 VAT 를 나눠 적으면 실제 납부액과 어긋나 보입니다. 합계 하나로 표기합니다.
"이용내역" 줄도 넣지 않습니다.

### 자동 채움 값 강조 — 하지 않습니다

인쇄용 문서이므로 화면 강조 효과를 넣지 않습니다. 본문과 동일한 14px/400 `--text-body`.
**값이 비어 있을 때만** 기입선을 표시합니다.
```css
display: inline-block;
width: 100px;
border-bottom: 1px solid var(--border);
```

### 서명란 정렬

```
2열 grid, align-items: flex-start
각 블록 1행: 높이 40px 고정, 세로 중앙 정렬 → 두 블록의 첫 줄이 같은 y 에서 시작
  좌: "임대인 : ㈜에스원테크" / "임차인 : {회사명}"  16px/700
  우: "서명(인)" 16px — 임대인만 인감 56px 을 중앙에 겹침 (opacity .9, z-index 1)
2행 이후: 상단 10px, 행 간격 4px, 14px
```

임대인 고정값 — 최현수 / 법인등록번호 110111-4806381 / 사업자등록번호 105-87-68698 /
주소 서울시 강남구 봉은사로55길 19, 3층(우리빌딩) / 연락처 070-4355-2312

---

## 인쇄 스타일

```css
@media print {
  @page { size: A4 portrait; margin: 15mm; }
  body { margin: 0; }

  /* 숨길 요소 */
  [data-sidebar], [data-sidebar-toggle], [data-toast],
  header, section, [data-print-hide] { display: none !important; }

  /* 모달 껍데기를 걷어내고 문서만 남긴다 */
  [data-overlay]   { position: static !important; padding: 0 !important; background: transparent !important; }
  [data-print-root]{ width: auto !important; height: auto !important;
                     border-radius: 0 !important; box-shadow: none !important; overflow: visible !important; }
  [data-print-root] [data-scroll] { overflow: visible !important; padding: 0 !important; background: transparent !important; }

  /* 문서 영역: A4 폭에 맞춰 펼침 */
  [data-doc-view] { width: 100% !important; box-shadow: none !important;
                    padding: 0 !important; margin: 0 !important; }

  /* 인감은 배경색 강제 출력 */
  [data-seal] { display: block !important;
                -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* 조항 중간에서 끊기지 않게 */
  [data-doc-view] div { page-break-inside: avoid; }
}
```

현재 선택된 탭의 문서만 출력됩니다 (비활성 탭은 `display:none`).
표 보더는 `#000` 실선을 유지합니다.
