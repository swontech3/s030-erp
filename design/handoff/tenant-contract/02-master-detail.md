# 화면 1 · 입주사·계약 관리

파일: `erp-master-detail/ErpMasterDetail.dc.html`
시안 데이터(브릿지랩·노틸러스 등)는 전부 예시입니다.

---

## 레이아웃

```
ERP 셸 콘텐츠 영역
┌─ 페이지 헤더 ────────────────────────────────┐
│ "입주사 · 계약 관리"        [+ 신규 입주사 등록] │
├─────────────┬────────────────────────────────┤
│ 좌 420px    │ 우 나머지                       │
│ 고정        │                                │
│ 독립 스크롤  │ 독립 스크롤                     │
└─────────────┴────────────────────────────────┘
간격 20px, 패딩 28px 32px
```

두 패널 모두 `--surface` + `1px --border` + `--radius-lg` + `overflow:hidden`
부모 flex 자식에 `min-height:0` / `min-width:0` 필수.

---

## 좌측 패널 — 입주사 리스트

### 상단 고정 영역 (`flex:0 0 auto`, 하단 `1px --border`, 패딩 16px)

**검색 행**
```
검색 인풋   flex:1, 높이 40px, 좌측 search 아이콘 16px (좌 14px)
            placeholder "회사명, 대표자 검색"
"24곳"      14px/700 --text-heading, 좌측 여백 12px
"전체"      12px --text-muted, 좌측 여백 10px — 칩 전체 해제
```

**상태 필터 칩** (상단 10px, gap 6px)
```
높이 28px, 좌우 패딩 12px, radius --radius-pill, 12px
미선택  배경 --surface, 보더 1px --border, 색 --text-muted, weight 400
선택    배경 --color-accent-bg, 보더 1px --color-primary,
        색 --color-primary-hover, weight 700, 좌측 check 아이콘 12px
```

항목: 계약중 21 / 만기 임박 2 / 검토중 1 / 종료 0
**멀티 선택**, 기본 "계약중"만 선택, 전체 해제 시 모두 표시.

> 칩은 배경·보더가 숏핸드로 선언되어 있습니다. JS 에서 상태를 칠할 때
> `style.background` / `style.border` **숏핸드에 해석된 리터럴**을 넣으세요.
> 롱핸드(`backgroundColor`)로 쓰면 재렌더 때 템플릿 값이 덮어씁니다.

### 목록 영역 (`flex:1; min-height:0; overflow-y:auto`)

**카드 — 2행 구조**, 패딩 14px 16px, 하단 `1px --border`

```
1행  회사명 16px/700 --text-heading  ····  상태 뱃지 (pill, 12px/700)
2행  대표자 · 연락처 · 사업자번호   14px --text-muted   (상단 6px, nowrap)
     예) "김도현 · 010-2345-6789 · 211-88-05567"
```

| 상태 | 표시 |
|---|---|
| 기본 | 배경 `--surface` |
| hover | 배경 `--surface-alt` |
| 선택 | 배경 `--color-accent-bg` + 좌측 3px `--color-primary` 세로 바 + 회사명 `--color-primary` |

**가등록 입주사**
```
회사명 앞  "(가등록)" 12px --text-caption
2행 끝     사업자번호 자리에 "사업자등록 신청 중"
상태 뱃지  "검토중" (--surface-alt + 1px --border + --text-muted)
```

**무한 스크롤** — 목록 하단에 스피너 자리를 두고 바닥 도달 시 추가 로드.
시안에서는 구조만 있고 동작하지 않습니다.

---

## 우측 패널 — 계약 이력

### 헤더 1줄 (패딩 16px 24px, 하단 `1px --border`)

```
좌측  회사명 H3 22px/600
      │ (세로 구분선 1px --border, 좌우 12px)
      "계약 2건 · Room-1 (1-10)"  14px --text-body
      · 상태 뱃지 "계약중"
우측  [+ 신규 계약]  primary, 높이 36px
```

### 계약 테이블

```css
grid-template-columns:
  88px                    /* 기간 — 중앙 정렬, nowrap, 자체 패딩 없음 */
  minmax(168px, 1.2fr)    /* 계약일자 — 좌측 */
  minmax(164px, 1fr)      /* 플랜·호실 — 좌측 */
  minmax(96px,  .8fr)     /* 월 이용료 — 우측, tabular-nums */
  minmax(70px,  .7fr)     /* 상태 — 중앙 */
  minmax(86px,  .75fr);   /* 액션 — 중앙 */
align-items: center;
```
하한 합계 672px (사용 가능 674px). 셀 좌우 패딩 12px, 행 좌측 여백 24px.

| 열 | 내용 |
|---|---|
| 기간 | "6개월" 14px/700 |
| 계약일자 | 1줄 "2026.01.15 ~ 2027.01.14" 14px / 2줄 "잔여 9일" 12px (만기 30일 이내 `--color-warning`, 그 외 `--text-muted`) |
| 플랜·호실 | "1인실 · Room-1 (1-10)" 14px, 말줄임 |
| 월 이용료 | "₩400,000" 14px/700, `tabular-nums` |
| 상태 | pill — 진행중(인디고) / 만료(무채색), 만기 임박 시 하단에 "만기 임박" 12px `--color-warning` |
| 액션 | [재계약] ghost 32px, `copy-plus` 14px, hover 툴팁 "이 계약 조건으로 재계약합니다" |

- 헤더 라벨은 **전 항목 중앙 정렬**, 데이터 셀은 값 성격대로 정렬
- 진행중 계약 행: 좌측 3px `--color-primary` 세로 바
- 행 클릭 → 계약 상세 모달. **액션 버튼 클릭은 `stopPropagation`** 으로 모달을 열지 않습니다

### 빈 상태 / 미선택 상태

```
계약 없음    file-text 40px --text-caption
             "등록된 계약이 없습니다" + [첫 계약 등록]
입주사 미선택 mouse-pointer-click 40px --text-caption
             "왼쪽에서 입주사를 선택하세요"
```

---

## 계약 상세 모달

폭 720px, 최대 높이 `calc(100vh - 48px)`, 스크림 `rgba(11,17,32,.45)`

**헤더** — 계약번호 H3 (`--font-mono`) + 하단 상태 뱃지, 우측 닫기 32px

**본문** — 2열 그리드, row-gap 20px, column-gap 32px
라벨 12px `--text-muted` / 값 16px `--text-heading`

| 항목 | 출처 |
|---|---|
| 입주사 | Company.name |
| 계약구분 | 항목 1개면 그 값, 여러 개면 "1인실 외 2건" |
| 이용호실 | 항목의 호실명을 " / " 로 연결 |
| 계약호실 | Contract.roomNo (국세청 신고용 대표 호실) |
| 계약일자 | Contract.signDate |
| 계약기간 | Contract.months + "개월" |
| 계약일자 범위 | 시작일 ~ 종료일 |
| 잔여일 | 종료일 − 오늘 |
| 예치금 합계 | Σ ContractItem.deposit |
| 월납부액 합계 | Σ (월이용료 + 부가세액) |
| 납부방법 | Contract.payMethod |
| 첫달납부액 | 계산값 — `05-logic.md` 참조 |

**하단** — 구분선 + "첨부 서류" 소제목 + 파일 목록(file-text 16px + 파일명 + download 28px)

**푸터** (상단 보더, 우측 정렬, gap 8px)
```
[닫기]       ghost 40px
[계약 상세]   ghost 40px  → 계약 폼 (mode: confirmed)
[재계약]     primary 40px + copy-plus 16px → 계약 폼 (mode: create, 값 복사)
```

> 계약 등록 모달(new-tenant / new-contract / renew)은 **제거되었습니다.**
> 같은 기능을 모달과 페이지 두 곳에서 관리하면 계속 어긋나므로 계약 폼 페이지로 일원화했습니다.
