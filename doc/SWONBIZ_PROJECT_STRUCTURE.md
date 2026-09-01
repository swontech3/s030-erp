# SwonBiz ERP — Next.js 프로젝트 구조 정의

erp.swonbiz.com / 에스원비즈 공유오피스 운영 시스템

---

## 1. 기본 원칙

**화면 ID와 라우트를 분리한다.**

화면 ID(`s0300200040`)는 문서·소통·이력 관리용 식별자다. URL에 노출하지 않는다.
`/s0300200040` 같은 주소는 사용자에게 의미가 없고 SEO·공유·기억 어느 쪽에도 불리하다.
라우트는 의미 있는 경로로 두고, 화면 ID는 파일 상단 메타와 중앙 매핑 테이블에서 관리한다.

```
화면 ID   s0300200040          ← 문서·이슈·소통용
라우트    /contracts/[id]       ← 사용자에게 보이는 주소
파일      app/(erp)/contracts/[id]/page.tsx
```

**팝업은 화면 ID를 갖되 라우트를 갖지 않는다.**

`p1`, `p2`는 모달·드로어·바텀시트 공통이며 부모 화면 폴더 안의 컴포넌트로 둔다.
URL로 직접 진입할 필요가 있는 경우에만 예외적으로 라우트를 부여한다
(현재 해당 없음).

---

## 2. 디렉터리 구조

```
swonbiz-erp/
├─ app/
│  ├─ (public)/                    # 050 · 인증 불필요
│  │  ├─ page.tsx                  # s0300500010 랜딩
│  │  ├─ apply/                    # s0300500020 온라인 신청 (보류)
│  │  ├─ booking/                  # s0300500040 외부 예약 (보류)
│  │  └─ kiosk/page.tsx            # s0300500060 회의실 현황판
│  │
│  ├─ (auth)/                      # 000 · 인증 화면
│  │  ├─ login/page.tsx            # s0300000010
│  │  ├─ password-reset/page.tsx   # s0300000020
│  │  ├─ password-sent/page.tsx    # s0300000030
│  │  └─ invite/[token]/page.tsx   # s0300000040
│  │
│  ├─ (erp)/                       # 인증 필요 · ERP 셸 적용
│  │  ├─ layout.tsx                # s0300000050 셸 (사이드바·헤더)
│  │  ├─ dashboard/page.tsx        # s0300000060 (운영사 전용)
│  │  ├─ settings/page.tsx         # s0300000070
│  │  ├─ facility/page.tsx         # s0300100010 센터 관리
│  │  ├─ tenants/
│  │  │  ├─ page.tsx               # s0300200010 목록
│  │  │  ├─ [id]/page.tsx          # s0300200020 상세
│  │  │  └─ contracts/page.tsx     # s0300200030 마스터-디테일
│  │  ├─ contracts/[id]/page.tsx   # s0300200040 계약 폼
│  │  ├─ applications/page.tsx     # s0300200060 신청 대기
│  │  ├─ billing/page.tsx          # s0300200070 월별 청구 (3차)
│  │  └─ booking/
│  │     ├─ page.tsx               # s0300600010 예약 현황
│  │     └─ approvals/page.tsx     # s0300600020 승인 큐
│  │
│  ├─ api/                         # BFF 라우트 (Fastify 프록시 또는 직접)
│  └─ layout.tsx                   # 루트 · 폰트 · 전역 토큰
│
├─ components/
│  ├─ ds/                          # 디자인 시스템 15종 이관
│  │  ├─ Button.tsx  IconButton.tsx  Icon.tsx  Card.tsx  Badge.tsx  Tag.tsx
│  │  ├─ Input.tsx  Select.tsx  Checkbox.tsx  Radio.tsx  Switch.tsx
│  │  ├─ Tabs.tsx  Dialog.tsx  Toast.tsx  Tooltip.tsx
│  │  └─ index.ts
│  ├─ patterns/                    # 템플릿에서 추출한 재사용 패턴
│  │  ├─ SaveBar.tsx               # T6 설정 저장 바
│  │  ├─ DangerZone.tsx            # T6 위험 구역
│  │  ├─ StatStrip.tsx             # T1 요약 지표
│  │  ├─ Chart.tsx                 # T1 SVG 차트 (3차 전 DS 승격 예정)
│  │  ├─ TimeGrid.tsx              # T5 타임그리드
│  │  ├─ DensityCalendar.tsx       # T5 월간 밀도 달력
│  │  ├─ MasterDetail.tsx          # 좌 리스트 + 우 상세 셸
│  │  ├─ DataTable.tsx             # 목록형 공통 테이블
│  │  └─ FormSection.tsx           # 폼 섹션 래퍼
│  └─ shell/
│     ├─ Sidebar.tsx  Header.tsx  Breadcrumb.tsx
│
├─ features/                       # 화면별 도메인 로직 · 팝업
│  ├─ contracts/
│  │  ├─ ContractForm.tsx          # s0300200040 본문
│  │  ├─ ContractPreviewModal.tsx  # s0300200040p1 계약서 미리보기
│  │  ├─ StateChangeModal.tsx      # s0300200040p2 상태 전이 확인
│  │  ├─ ContractItemsTable.tsx    # 계약 항목 최대 10행
│  │  ├─ useContractForm.ts
│  │  └─ types.ts
│  ├─ tenants/  facility/  booking/  settings/  dashboard/
│
├─ lib/
│  ├─ screens.ts                   # ★ 화면 ID ↔ 라우트 중앙 매핑
│  ├─ auth/                        # 삐용 JWT API 연동
│  ├─ api/                         # 서버 호출 래퍼
│  ├─ permissions.ts               # 운영사/입주사 분기
│  ├─ format.ts                    # 금액 마스크·사업자번호·전화번호
│  └─ constants.ts                 # 미확정 상수 집중 관리
│
├─ styles/
│  ├─ tokens.css                   # 템플릿 CSS 변수 이관
│  └─ globals.css
│
├─ design/                         # ★ Claude Design 산출물 (읽기 전용 참조)
│  ├─ LandingHero.dc.html
│  ├─ ErpAuth.dc.html
│  ├─ ErpTenants.dc.html
│  ├─ ErpMasterDetail.dc.html
│  ├─ ErpContractForm.dc.html
│  ├─ ErpBooking.dc.html
│  ├─ ErpBookingKiosk.dc.html
│  ├─ ErpSettings.dc.html
│  ├─ ErpDashboard.dc.html
│  └─ SWONBIZ_SCREEN_LIST.md
│
└─ docs/
   ├─ HANDOVER_T7_ErpApplyForm.md  # 보류 중인 신청 폼
   └─ decisions.md                 # 결정 사항 기록
```

---

## 3. 화면 ID 매핑 (`lib/screens.ts`)

화면 ID와 라우트의 단일 진실 공급원. 화면이 추가되면 여기만 수정한다.

```ts
export const SCREENS = {
  s0300000010: { route: '/login',              name: '로그인',        group: '000' },
  s0300000060: { route: '/dashboard',          name: '대시보드',      group: '000', role: 'operator' },
  s0300000070: { route: '/settings',           name: '설정',          group: '000' },
  s0300100010: { route: '/facility',           name: '센터 관리',      group: '010', role: 'operator' },
  s0300200010: { route: '/tenants',            name: '입주사 목록',    group: '020', role: 'operator' },
  s0300200040: { route: '/contracts/[id]',     name: '계약 폼',        group: '020', role: 'operator' },
  s0300500010: { route: '/',                   name: '랜딩',          group: '050', public: true },
  s0300500060: { route: '/kiosk',              name: '회의실 현황판',   group: '050', public: true },
  s0300600010: { route: '/booking',            name: '예약 현황',      group: '060' },
  // ... 전체 목록은 design/SWONBIZ_SCREEN_LIST.md 참조
} as const;
```

**활용**

- 미들웨어에서 `group === '050'` 또는 `public: true` 를 인증 제외로 처리
- `role: 'operator'` 화면에 입주사 접근 시 리다이렉트
- 에러 리포트·로그에 화면 ID를 함께 남겨 이슈 추적에 사용

**각 page.tsx 상단에 화면 ID를 주석으로 명시한다.**

```tsx
/** @screen s0300200040 계약 폼 · 020 입주사관리 · 1차 */
```

---

## 4. 라우트 그룹과 인증

| 그룹 | 인증 | 셸 | 대상 |
|---|---|---|---|
| `(public)` | 없음 | 없음 | 050 공개 화면 |
| `(auth)` | 없음 | 없음 | 000 인증 화면 |
| `(erp)` | 필요 | 적용 | 000·010·020·030·040·060 |

**미들웨어 처리**

- `(erp)` 진입 시 세션 검증. 실패하면 `/login?redirect=` 로 이동
- `role: 'operator'` 화면에 입주사 접근 시 `/booking` 으로 리다이렉트
- 로그인 후 홈 분기: 운영사 `/dashboard` / 입주사 `/booking`
  ※ 입주사 대시보드는 존재하지 않는다. 사이드바에도 렌더링하지 않는다

**인증은 삐용 JWT API를 호출한다.** ERP는 자체 계정 테이블을 두지 않는다.
토큰 갱신·세션 만료 정책을 삐용 설정과 일치시킬 것 (`SESSION_TTL` 확인 필요).

---

## 5. 템플릿 이관 규칙

`design/*.dc.html` 이 각 화면의 시각 기준이다. **새로 설계하지 말고 이관한다.**

**이관 순서**

1. `styles/tokens.css` 에 CSS 변수 전량 이관 (색·타이포·간격·shape)
2. `components/ds/` 15종 구현 — 템플릿 안의 마크업과 클래스를 그대로 옮김
3. `components/patterns/` 추출 — 여러 화면에 걸치는 것만
4. 화면별 `page.tsx` 조립

**지켜야 할 규칙 (템플릿에 이미 반영됨)**

- Primary `#4F46E5` / Accent `#22D3EE`
- 상태색 `--color-warning #D97706` / `--color-danger #DC2626`
- **녹색 계열 금지** — 완료·성공도 인디고로 표현
- 오렌지는 로고 전용
- 아이콘은 반드시 DS `Icon` 컴포넌트. JS 생성 행의 셀렉트 캐럿은 CSS
- 금액 필드는 커서 보존 마스크 (`lib/format.ts` 로 일원화)
- `prefers-reduced-motion` 대응

**반응형**

기본은 고정 1440px 기준. 단 아래 두 화면만 3단 대응한다.

- `s0300600010` 예약 현황 — 1280+ 주간 / 768~1279 축약 / ~767 일간
- `s0300500060` 현황판 — `100dvh` 고정, 스크롤 없음

브레이크포인트 토큰: `--bp-tablet: 768px` / `--bp-desktop: 1280px`

---

## 6. 개발 순서 (1차)

```
1. 프로젝트 스캐폴딩 + tokens.css 이관
2. components/ds 15종
3. lib/auth 삐용 JWT 연동 + 미들웨어
4. (auth) 화면 4종
5. (erp) layout.tsx 셸
6. tenants 목록 → 상세
7. tenants/contracts 마스터-디테일
8. contracts/[id] 계약 폼  ← 1차 최대 난이도
9. dashboard
```

**8번이 가장 무겁다.** 섹션 4개, 상태 5종, 계약 항목 최대 10행, 계약서 2종 출력.
`features/contracts/` 안에서 폼 상태·검증·상태 전이를 분리해 구성할 것.

**계약 상태 전이**

```
create → draft → confirmed → terminated
         draft → cancelled
```

`confirmed` 이후 섹션 2(계약정보) 잠금. 섹션 1·3은 수정 가능.

---

## 7. 상수 집중 관리 (`lib/constants.ts`)

템플릿에서 플레이스홀더로 남긴 값들. 확정되는 대로 여기서만 수정한다.

```ts
export const BOOKING = {
  OPEN_TIME: '09:00',
  CLOSE_TIME: '22:00',
  SLOT_MINUTES: 30,
  FREE_MINUTES_PER_DAY: 120,
  OVERAGE_FEE_PER_30MIN: 0,      // 미확정
  MAX_CONSECUTIVE_SLOTS: 8,       // 미확정
  BOOKABLE_DAYS_AHEAD: 30,
} as const;

export const CONTRACT = {
  MAX_ITEMS: 10,
  MAX_USERS: 20,
  EXPIRY_WARNING_DAYS: 90,
} as const;

export const URLS = {
  BOOKING_QR: '',                 // 미확정
} as const;
```

> 회의실 예약 값은 전사 기본값이며, 회의실별 재정의가 있으면 그 값이 우선한다.
> 개발 시 회의실 레코드의 해당 필드가 `null` 이면 전사 기본값을 따르는 구조로 구현할 것.

---

## 8. 미확정 · 선행 확인 사항

**스키마 확정 전 결정 필요**

1. 공통 직원 계정을 삐용 `s020_*` 에 둘지, ERP `s030_*` 에 별도로 둘지
2. 한 입주사가 동시에 복수 계약을 가질 수 있는지
3. 계약 항목 10행이 호실만인지, 주차·사물함 등 이질적 항목이 섞이는지
   → 섞이면 항목 유형 구분 컬럼이 필요

**기타**

- `BOOKING_QR_URL` 및 인증 화면 `redirect` 파라미터 처리
- 권한 관리 화면 — 별도 권한 시스템(13테이블·모듈 구독·역할 템플릿)과의 경계
- 세션 만료 기본값이 삐용 JWT TTL과 일치하는지
- T7 온라인 신청 폼 — 계약 폼 정책 3건 결정 후 재개 (`docs/HANDOVER_T7_ErpApplyForm.md`)
