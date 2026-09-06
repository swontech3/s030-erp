# SwonBiz ERP — 페이즈 1 실행 지시서

**작성:** 2026-09-06
**성격:** Claude Code 에 그대로 전달하는 작업 지시서
**우선순위:** 문서 간 충돌 시 `지시_ERP_로그인_권한관리.md`(2026-09-06) → `SPEC.md` → `ROADMAP.md` → 나머지 순

---

# 0장. 착수 전 확인

아래 세 가지를 먼저 처리하고 **결과를 보고한 뒤 결정을 받고** 코드를 시작합니다.

## D-1. 문서 정정 4건

### D-1-a. 테이블명 일괄 정정

`tb_s030_*` / `s030_*` 로 된 **테이블명**을 `tb_s080_*` 로 정정합니다.
화면ID(`s0300000010`)와 시스템코드(`S03`)는 건드리지 않습니다.

- `.planning/REQUIREMENTS.md` — ACL-01′ / CONT-11 / CSCH-05
- `doc/ORG_ARCHITECTURE.md` — §3-5 로그아웃 절

### D-1-b. `doc/SWONBIZ_SCREEN_LIST.md`

- `s0300000080` **접근 권한 없음** 추가 (000 공통 · 1차 · 신규)
- `s0300000020` · `s0300000030` · `s0300000040` 상태를 **폐기**로 변경 (지시문 1-3)
- `s0300000070` 설정 화면 비고의 "권한 관리 준비 중" 문구 삭제 — ERP 에 권한 관리 화면은 생기지 않습니다

### D-1-c. `doc/SWONBIZ_PROJECT_STRUCTURE.md` — 7건

이 문서는 2026-09-06 지시문보다 먼저 작성돼 **뒤집힌 결정이 남아 있습니다.** 구조 지침으로 쓰이는 문서라 먼저 고칩니다.

| # | 현재 | 고칠 것 |
|---|---|---|
| 1 | `(auth)/password-reset` · `password-sent` · `invite/[token]` | **삭제.** 폐기 화면 3종 |
| 2 | `(auth)/` 에 no-access 없음 | `(auth)/no-access/page.tsx # s0300000080` 추가 |
| 3 | §6 개발순서 4번 "(auth) 화면 4종" | "(auth) 로그인 + 접근권한없음 2종" |
| 4 | `lib/permissions.ts # 운영사/입주사 분기` | **삭제.** ERP 자체 권한 판정 모듈은 지시문 2-1·3장이 금지. 대신 `lib/acl/BbiyongAcl.ts`(어댑터) + `lib/scope/resolveCompany.ts`(스코프 헬퍼) |
| 5 | `screens.ts` 의 `role: 'operator'` 필드 | **삭제.** 사이드바는 삐용이 준 화면 목록만 그립니다(ACL-07′). 이 필드가 남으면 §4 미들웨어가 역할로 판정하게 되고 지시문 1-6 위반 |
| 6 | §4 "홈 분기: 운영사 /dashboard / 입주사 /booking" | 화면 권한 기준으로 재작성 (2-9 코드) |
| 7 | Fastify · Drizzle · supabase 자리 없음 | D-3 결정 후 반영 |

§8 미확정 1번("공통 직원 계정을 삐용 s020 에 둘지 ERP s030 에 둘지")도 삭제합니다 — 삐용으로 이미 확정됐습니다.

### D-1-d. `lib/screens.ts` 에 화면 3종 추가

```ts
s0300000050: { route: null,         name: 'ERP 셸',        group: '000' },  // layout, 라우트 없음
s0300000080: { route: '/no-access', name: '접근 권한 없음', group: '000' },
s0300000060: { route: '/dashboard', name: '대시보드',      group: '000' },  // role 필드 제거
```

## D-2. `003_revoke_public.sql` 확인 — 3가지

`supabase/migrations/003_revoke_public.sql` 을 열어 아래를 보고합니다.

1. **`erp_app` 역할 생성 구문이 있는가.**
   있으면 비밀번호 설정 방법(SQL 밖 수동 작업)과, 설정 후 `.env` 의 `DATABASE_URL` 을 어떻게 바꿔야 하는지까지 함께 보고.
2. **`company_id` 기준 RLS 정책이 들어 있는가.**
   `SPEC.md` 요구사항 8은 RLS 를 지시하고, `REQUIREMENTS.md` Out of Scope 표는 "Postgres RLS — v1 미구현"을 사유까지 붙여 명시합니다. **정면 충돌입니다.**
   003 의 실제 내용을 보고한 뒤 어느 쪽을 따를지 결정을 받고, 진 쪽 문서를 그 자리에서 고칩니다.
3. **현재 `.env` 의 `DATABASE_URL` 이 어느 역할로 붙는가.**
   `anon` / `authenticated` 권한 회수가 기존 S-WonERP 앱을 깨뜨리지 않는지 판단하는 근거입니다.
   (`BACKEND_ANALYSIS.md` §1-5 의 grep 결과가 `from('tb_s080` **0건**이라 위험은 낮지만 확인은 합니다)

**그리고** `004_rename_tenant.sql` 을 `supabase/migrations/` 밖으로 옮깁니다 → `supabase/migrations_hold/`.

별도 앱 정지 창(페이즈 G)에서 적용할 파일이고, `supabase db push` 나 `migration up` 을 무심코 실행하면 **운영 중인 S-WonERP 가 즉시 깨집니다.** 파일 상단 경고 주석에만 의존하지 말고 물리적으로 뺍니다.

## D-3. Fastify 프로젝트 위치 결정

`SWONBIZ_PROJECT_STRUCTURE.md` 에 Fastify 자리가 없습니다. `app/api/` 에 "Fastify 프록시 또는 직접"이라고만 적혀 있는데, 로드맵과 SPEC 은 Fastify 별도 프로젝트를 전제합니다.

**모노레포인지 별도 저장소인지 정해야 스캐폴딩이 시작됩니다.** 현재 저장소 상태를 확인하고 두 안의 장단점과 함께 권고안을 제시합니다. 결정 후 구조도에 반영합니다.

같이 정할 것: `drizzle/` 스키마 위치, `supabase/migrations/` 를 구조도에 명시.

---

# 1장. 확정된 방향 (변경 불가)

**기술 스택**

- Frontend: Next.js (App Router)
- Backend: Fastify (위치는 D-3)
- DB: PostgreSQL (Supabase), `tb_s080_*` 확장
- ORM: **Drizzle** (`drizzle-kit generate` → SQL → Supabase CLI. `drizzle-kit push` 금지)
  기존 앱은 Prisma — 두 ORM 이 같은 DB 를 각자 봐도 무방합니다. 스키마 소유가 갈려 있습니다
- TypeScript **5.9.3 고정** (`latest` 는 Go 네이티브 TS 7.x 로 해석됨 — PLAT-08)
- 화면 ID: `s030` 체계 유지 / 시스템 코드: `S03`

**DB**

- `tb_s080_*` 확장 (기존 유지 + 필요한 것 추가)
- 삐용 DB 직접 조회·조인·외래키 금지
- 입주사 격리축: `company_id` 단일

**인증**

- ERP 자체 직원 테이블·토큰 발급 없음
- 삐용 로그인 API 호출 → `erp_sid` → HttpOnly 쿠키
- 삐용 access·refresh 토큰은 **서버에만** 암호화 보관
- Mock 먼저 개발. `BBIYONG_MOCK=true` 로 on/off

**권한**

- `BbiyongAcl` 어댑터 하나로 격리
- 1단계 shadow 모드 (차단 대신 로그만)
- **데이터 스코프(`company_id`)는 1단계부터 예외 없이 강제** — shadow 는 화면 접근에만 적용
- 홈 분기는 `org_tp` 직접 비교가 아니라 "대시보드 화면 권한이 있는가"로 판단 (지시문 1-6)

**화면 이관**

- `design/*.dc.html` 이 시각 기준. 새로 설계하지 않습니다
- `style-hover` · `style-focus` 는 **디자인 도구 전용 속성**입니다. 그대로 옮기면 브라우저가 무시합니다 — React 에서는 실제 CSS(`:hover` · `:focus-visible`)로 다시 씁니다

---

# 2장. 페이즈 1 범위

## 2-0. 디자인 시스템 — 검증 완료 상태

```
design/_ds/swonbiz/
├─ tokens/        6개 · 변수 119개
├─ styles.css
├─ assets/
└─ components/
   ├─ core/        Badge · Button · Card · Icon · IconButton · Tag
   ├─ feedback/    Dialog · Toast · Tooltip
   ├─ forms/       Checkbox · Input · Radio · Select · Switch
   └─ navigation/  Tabs
```

**확인된 사항 (재검증 불필요)**

- 토큰 6파일 · 변수 119개. 로그인 화면이 쓰는 31개 전부 정의됨
- `--bp-tablet:768px` · `--bp-desktop:1280px` 포함
- `--color-warning-bg` 존재 (접근권한없음 화면이 사용)
- **녹색 없음.** `colors.css` 에 걸린 2건은 주석이며, 오히려 "어떤 경우에도 녹색 금지, 완료도 인디고" 규칙을 명문화한 것입니다
- DS **15종 전량 존재**
- 각 컴포넌트는 `.jsx` + `.d.ts` + `.prompt.md` 3종 세트. 카테고리별 `*.card.html` 프리뷰 있음

**★ 컴포넌트를 이관하기 전에 같은 폴더의 `.prompt.md` 를 먼저 읽습니다.**
`.d.ts` 의 props 시그니처와 컴포넌트 이름을 그대로 유지합니다 — **템플릿 11개가 그 이름으로 호출하고 있습니다.**
`*.card.html` 은 이관 결과가 원본과 같아 보이는지 눈으로 대조하는 기준으로 씁니다.

### 템플릿 경로 정정

11개 폴더의 `ds-base.js` 에서 이 한 줄을 바꿉니다.

```js
const base = '../..';            // 기존 — 저장소 루트를 가리켜 아무것도 못 찾음
const base = '../_ds/swonbiz';   // 정정
```

```
design/erp-apply-form/       design/erp-booking-kiosk/    design/erp-settings/
design/erp-auth/             design/erp-contract-form/    design/erp-tenants/
design/erp-booking/          design/erp-dashboard/        design/landing-hero/
design/erp-booking-compare/  design/erp-master-detail/
```

로고 경로도 같은 앵커입니다. `ErpAuth.dc.html` 의 `../../assets/swonbiz-logo.png` 가 `design/_ds/swonbiz/assets/` 를 가리키도록 맞추고, React 로 옮길 때는 `/public/` 기준으로 다시 바꿉니다.

**정정 후 `design/erp-auth/ErpAuth.dc.html` 을 브라우저로 열어 색·글꼴·간격이 정상인지 확인하고 보고합니다.**

## 2-1. 마이그레이션 001~003 적용

```
1. pg_dump 전체 백업
2. 004 가 migrations/ 밖에 있는지 재확인
3. 001 → 002 → 003 순차 적용
4. D-2 결과에 따라 erp_app 비밀번호 설정 + .env DATABASE_URL 갱신
   (003 에 역할 생성이 있으면 이걸 빠뜨린 순간 신규 백엔드가 DB 에 못 붙습니다)
5. 검증
```

**검증 항목**

- [ ] `tb_s080_companies` 에 `link_s020_org_id` · `link_linked_at` · `link_linked_by`
- [ ] 같은 `link_s020_org_id` 로 두 번째 행 UPDATE → UNIQUE 위반
- [ ] `tb_s080_contracts` 확장 4컬럼. `deposit_return_status` 에 `'X'` → CHECK 위반
- [ ] `tb_s080_contract_status_history` 존재 + FK 연결
- [ ] `tb_s080_auth_session` 존재
- [ ] `tb_s080_reservations` 에 겹치는 `confirmed` 예약 INSERT → `23P01`
- [ ] `status='cancelled'` 행과는 시간이 겹쳐도 INSERT 성공
- [ ] anon 역할로 `tb_s080_contracts` SELECT → `permission denied`
- [ ] **기존 S-WonERP 앱 스모크** — 계약 목록·상세가 003 적용 후에도 동작

## 2-2. 스캐폴딩

D-1-c 로 정정된 `SWONBIZ_PROJECT_STRUCTURE.md` 구조대로. D-3 결정 반영.

- `lib/constants.ts` 를 `src/lib/` 로 이동 (작성 완료 상태)
- `lib/screens.ts` — 화면ID ↔ 라우트 중앙 매핑. 각 `page.tsx` 상단에 화면ID 주석
- 순수 함수 3종을 S-WonERP 에서 **파일째 복사** + 테스트 동반 이관.
  이번 페이즈에서는 옮겨만 두고 호출하지 않습니다
  `contract-settlement.ts` · `contract-invoices.ts` · `reservation-validation.ts`
- 암호화 코드는 S-WonERP `crypto.ts` 를 **참고만 하고 새로 씁니다** —
  고정 솔트·시크릿 32자 절단 문제가 있습니다 (`BACKEND_ANALYSIS.md` 부록)

## 2-3. `styles/tokens.css` 이관

`tokens/` 6개를 **파일째 이어붙여** `styles/tokens.css` 로 만듭니다.
손으로 옮겨 적지 마세요. 값이 하나라도 달라지면 대조가 불가능해집니다.

```
tokens/fonts.css       → 폰트 (아래 2-3-2 주의)
tokens/colors.css
tokens/typography.css
tokens/spacing.css
tokens/shape.css
tokens/base.css
```

`styles.css` 는 컴포넌트 클래스 정의라 `tokens.css` 가 아니라 `styles/globals.css` 쪽입니다. DS 컴포넌트를 React 로 옮기면서 필요한 클래스만 가져갑니다.

이관 후 **원본 119개와 `tokens.css` 를 변수 단위로 대조해 누락이 0인지** 확인합니다.

### 2-3-1. 녹색 lint 규칙 (PLAT-05)

- 색상 리터럴(hex · rgb · hsl · 색이름) 중 녹색 계열이 들어오면 빌드 실패
- `design/_ds/` 트리는 검사에서 **제외** — 디자인 소유 자산이라 개발이 고치지 않습니다
- 규칙을 건 뒤 **일부러 녹색 하나를 넣어 실패하는지 확인하고 되돌립니다.**
  안 잡히는 검사는 없는 것과 같습니다

### 2-3-2. 폰트 — 자체 호스팅으로 전환

`fonts.css` 가 Pretendard · Inter 를 CDN 에서 불러옵니다. 이대로 두면:

- CDN 이 느리거나 막히면 로그인 화면에서 글꼴이 늦게 바뀌며 글자가 튑니다(CLS)
- CSP(SEC-01) 에 외부 도메인을 열어야 합니다

**둘 다 SIL Open Font License 로 알려져 있어 자체 호스팅이 허용됩니다.**
각 저장소의 `LICENSE` 파일로 확인한 뒤 `next/font/local` 로 전환하고, 배포물에 라이선스 원문을 동봉합니다.

라이선스가 예상과 다르면 **CDN 유지 + CSP 도메인 허용**으로 가고 보고합니다.

### 2-3-3. 토큰화 보류 항목 — 건드리지 않습니다

| 값 | 위치 | 이번 처리 |
|---|---|---|
| `#131C33` · `rgba(79,70,229,.18)` 등 알파 조합 | 브랜드 패널 · 배지 | **리터럴 유지** (의도된 것. CSS 변수로 알파 조합 불가) |
| `rgba(255,255,255,.06 / .10 / .14)` | 다크 패널 | **리터럴 유지.** 디자인에 토큰 추가 요청 → 다음 전달분에 반영 |
| 키오스크 `--k-*` 4개 | `ErpBookingKiosk` | 페이즈 5 문제. 이번엔 무시 |

**★ 개발이 토큰을 새로 만들지 않습니다.** 토큰 추가는 디자인 시스템 원본을 고치는 일이고, 개발이 임의로 이름을 지으면 다음 내보내기와 충돌합니다.

## 2-4. DS 컴포넌트 이관

**페이즈 1 에서 실제로 필요한 것은 `Icon` · `Input` · `Button` · `Checkbox` 4종입니다.**
15종을 다 옮겨도 되지만, 4종을 먼저 끝내 로그인 화면을 세우고 나머지를 채우는 편이 낫습니다.

### 2-4-1. ★ Icon — CDN 의존을 이번에 끊습니다

`Icon` 이 `lucide-static@0.414.0` 을 CDN 에서 가져옵니다. `BASE` 상수 한 줄이면 로컬 전환이 되므로 **미루지 말고 지금 바꿉니다.**

- CDN 장애 시 로그인 화면의 아이콘이 통째로 사라집니다
- 외부 요청이라 CSP 에 도메인을 열어야 합니다
- 로컬 SVG 면 번들에 들어가 첫 페인트가 빠릅니다

1차에 필요한 11종만 뽑아 `components/icons/` 에 둡니다.

```
eye · eye-off · circle-check · circle-alert · arrow-up-right
building-2 · calendar-check · file-pen-line · mail-check · receipt · sparkles
```

### 2-4-2. ★★ 아이콘 이름을 타입으로 좁힙니다

**`circle-check` 가 맞고 `check-circle` 은 404 입니다.** `circle-alert` / `alert-circle` 도 같습니다.

위험한 이유는 **오타가 에러를 안 내기 때문**입니다. 아이콘이 그냥 안 보일 뿐이고 콘솔도 조용하며 리뷰에서도 안 걸립니다.

```ts
export type IconName =
  | 'eye' | 'eye-off' | 'circle-check' | 'circle-alert' | 'arrow-up-right'
  | 'building-2' | 'calendar-check' | 'file-pen-line' | 'mail-check'
  | 'receipt' | 'sparkles';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) { … }
```

화면이 늘어나면 이 union 에 이름을 추가합니다. **`string` 으로 넓히지 마세요.**

## 2-5. 로그인 화면 `s0300000010`

출처: `design/erp-auth/ErpAuth.dc.html`

**★ 이 파일 하나에 4개 화면이 다 들어 있습니다.** `screen` prop 이 `login/reset/sent/invite` 열거형이고 `sc-if` 블록으로 갈립니다.

```
이관한다   isLogin 블록 (23~67행) + 우측 브랜드 패널 (140~164행)
버린다     isReset (70~81) · isSent (83~92) · isInvite (94~137)
버린다     하단 스크립트의 bindStrength() 전체 — 초대 화면 전용 비밀번호 강도 막대
```

레이아웃: 좌 44% 폼 + 우 56% 브랜드 패널, `min-width:1440px` 고정

**바꿀 것 4가지**

1. **"비밀번호 찾기"** — 현재 `data-goto="reset"`. **삐용 비밀번호 재설정 화면으로 나가는 외부 링크**로 교체. URL 은 `lib/constants.ts` 의 `BBIYONG.*`
2. **"로그인 상태 유지" 체크박스** — 세션 유효기간에 영향을 주지 않게 하거나 아예 뺍니다.
   지시문 1-5 가 "갱신 방식을 ERP 가 임의로 정하지 마라"고 못박았고, 현재 만료는 **7일 폴백 가정**입니다(회신 ⑤ 대기). 여기서 "30일 세션"을 만들면 나중에 삐용 실값과 어긋납니다
3. **"무료 상담 신청"** — 랜딩(`s0300500010`)의 상담 문의 모달로 연결
4. **로고 경로** — `/public/` 기준으로

**에러 처리** — 삐용 응답은 **HTTP 200 이어도 `body.status !== 200` 이면 실패**입니다
(`BBIYONG-AUTH.md` §2.4 함정 1). 템플릿의 `showError` 블록이 이 경우에도 떠야 합니다.

## 2-6. 접근권한없음 `s0300000080`

- 라우트 `/no-access` — **화면 ID 를 URL 에 노출하지 않습니다**(구조도 §1 첫 원칙)
- 문구: "이 계정은 ERP 이용 권한이 없습니다. 담당자에게 문의하세요."
- 로그인은 성공했으나 접근 가능 화면이 0건일 때 표시 (AUTH-13, 지시문 1-7)

**디자인 지정: `ErpAuth.dc.html` 의 `sent` 블록(83~92행) 구조를 그대로 씁니다.**

| 요소 | `sent` 원본 | `s0300000080` |
|---|---|---|
| 원형 아이콘 배경 | `--color-accent-bg` | **`--color-warning-bg`** |
| 아이콘 | `mail-check` | **`circle-alert`** |
| 아이콘 색 | `--color-primary` | **`--color-warning`** |
| 제목 | "메일을 확인해 주세요" | "이 계정은 ERP 이용 권한이 없습니다" |
| 본문 | 재설정 안내 | "담당자에게 문의하세요." |
| 액션 | "다시 보내기" 버튼 + "로그인으로 돌아가기" 링크 | **"로그아웃" ghost 버튼 하나** |

우측 브랜드 패널은 로그인 화면과 동일하게 둡니다.

**"로그아웃" 은 실제로 동작해야 합니다** — 세션 `revoked_at` 설정 → 쿠키 삭제 → `/login`.
이 화면에서 나갈 길이 이것뿐이라 장식이면 사용자가 갇힙니다.

## 2-7. ERP 셸 `s0300000050`

**출처: `design/erp-tenants/` 의 셸.** 접기 · 툴팁 · 상태 저장이 온전한 유일한 셸입니다.

```
가져올 것   <aside> 마크업 + 토글 버튼 + 로직의 bindSidebar() / applySidebar()
참고 금지   erp-dashboard · erp-settings 의 셸 — 정적이라 기능이 빠져 있음
```

### 2-7-1. ★★ `localStorage` 를 그대로 옮기면 깨집니다

`applySidebar()` 가 접힘 상태를 `localStorage` 에 저장합니다. 정적 HTML 에서는 문제없지만 Next.js App Router 에서는 다릅니다.

서버는 `localStorage` 를 읽지 못해 첫 렌더를 "펼침"으로 그리고, 브라우저가 붙으면서 "접힘"으로 바뀝니다. React 가 이 불일치를 hydration 오류로 잡거나, 조용히 넘어가더라도 **매번 사이드바가 한 번 깜빡입니다.**

**→ 쿠키로 옮깁니다.** 서버가 첫 렌더부터 정확히 그리므로 깜빡임이 없고, `erp_sid` 세션 쿠키 때문에 쿠키를 읽는 코드가 어차피 생깁니다.

```
sidebar_collapsed=1   HttpOnly 아님 (클라이언트가 토글해야 함), SameSite=Lax
```

쿠키가 어려우면 `useEffect` 로 마운트 후 적용하고 **깜빡임을 감수한다고 보고**합니다.
인라인 스크립트 선반영은 사이드바에는 과합니다.

### 2-7-2. 사이드바 항목은 삐용이 준 목록만 그립니다

**ERP 가 역할을 보고 거르지 않습니다** (ACL-07′, 지시문 2-9).

```ts
// MockBbiyongAcl.listScreens() 응답 → lib/screens.ts 로 라우트·이름 해석 → 렌더
```

`screens.ts` 에 `role` 필드를 두지 않습니다 (D-1-c 5번).
헤더의 이름 표시("홍길동 (에스원테크)")에만 `org_tp` 를 씁니다 — **표시 전용**입니다.

## 2-8. Mock 인증 + 세션 미들웨어

**로그인 흐름** (SPEC 요구사항 10)

```
로그인 화면 → 삐용 로그인 API (Mock 이면 MockBbiyongAuth)
  → 응답에서 memberId · orgId · orgTp 추출
  → erp_sid 랜덤 32바이트 생성
  → SHA-256 해시만 tb_s080_auth_session 에 저장
  → 해시 안 한 원문 erp_sid 를 HttpOnly Secure SameSite=Lax 쿠키로 전달
  → 삐용 access·refresh 는 서버에만 암호화 보관
```

**세션 미들웨어** (Fastify `onRequest` 훅, SPEC 요구사항 14)

```
쿠키 erp_sid 해시 → tb_s080_auth_session 조회
                    (30초 인메모리 캐시, revoked_at 은 캐시 우회)
  → 없음 / 만료 / 폐기 → 401
  → req.session = { memberId, orgId, orgTp, companyId, role }
```

`companyId` 는 `tb_s080_companies.link_s020_org_id = orgId` 역조회로 해석합니다.
**연결이 없으면 `companyId = null`(빈 스코프)이고 목록 API 가 0건을 반환합니다 — 예외가 아닙니다.**

**MockBbiyongAcl** (SPEC 요구사항 15·16)

- 인터페이스: `canAccess(screenCode, action, session)` · `getScope(session)`
- 1단계 shadow — `canAccess` 는 항상 `true`, 시도만 `tb_s080_acl_shadow_log` 에 기록
- **데이터 스코프는 shadow 대상이 아닙니다.** 1단계부터 강제
- `BBIYONG_ACL_MODE=http` 인데 삐용 URL 미설정이면 **기동 실패**. 조용히 mock 으로 폴백하지 않습니다

**Mock 계정 4종**

| 이메일 | 구분 | 반환 화면 목록 | 홈 |
|---|---|---|---|
| `admin@s-wontech.co.kr` | 운영사 대표 | `s0300000050`·`s0300000060`·`s0300600010` | `/dashboard` |
| `operator@s-wontech.co.kr` | 운영사 직원 | 동일 | `/dashboard` |
| `tenant@test.com` | 입주사 (org 연결됨) | `s0300000050`·`s0300600010` | `/booking` |
| `noaccess@test.com` | 미구독 (org 연결 안 됨) | `[]` | `/no-access` |

## 2-9. 홈 분기

`org_tp` 로 분기하지 않습니다 (지시문 1-6 "✗ 회원유형을 보고 메뉴를 열고 닫기").

```ts
// ORG_ARCHITECTURE.md §3-4
const screens = await bbiyongAcl.listScreens(session.s020MemberId)

if (screens.length === 0)        return '/no-access'   // AUTH-13
if (has(screens, 's0300000060')) return '/dashboard'   // 대시보드 권한 = 운영사
if (has(screens, 's0300600010')) return '/booking'     // 예약 권한 = 입주사
return routeOf(screens[0])
```

이 방식이면 삐용 회신 ⑮ 가 와도 이 코드를 고칠 필요가 없습니다.

미들웨어는 **UX 게이트일 뿐입니다**(CVE-2025-29927). 진짜 차단은 Fastify 가 합니다.
`/dashboard` 와 `/booking` 은 이 페이즈에서 빈 화면이어도 됩니다.

## 2-10. `getAuthContext()` 브리지 — S-WonERP 쪽 수정

`erp_sid` 쿠키가 있으면 `tb_s080_auth_session` 으로 해석, 없으면 기존 Supabase 경로로 폴백(전환 기간 한정). 반환 타입은 그대로 두되 `role` 은 표시용으로 강등 — 판정에 쓰지 않습니다.

**회귀 확인**: Supabase 세션만 있는 기존 요청도 그대로 통과해야 합니다.

---

# 3장. 완료 기준

**인증 · 세션**

- [ ] Mock 4계정이 각각 정확한 홈으로 분기 (admin·operator → `/dashboard`, tenant → `/booking`, noaccess → `/no-access`)
- [ ] 로그아웃 후 재접속 시 `/login` 리다이렉트
- [ ] 세션 쿠키 없이 보호 라우트 호출 → **401** (리다이렉트가 아니라 401)
- [ ] `req.session.companyId` 가 `link_s020_org_id` 역조회로 정확히 해석됨
- [ ] org 연결이 없는 세션 → `companyId = null`, 목록 API 0건 (예외 아님)
- [ ] **브라우저 쿠키에 삐용 토큰이 하나도 없음** — 개발자도구 Application 탭 육안 확인
- [ ] `revoked_at` 설정 직후 그 세션이 **즉시** 무효 (30초 캐시를 우회하는지)
- [ ] `tb_s080_acl_shadow_log` 에 최소 1건 기록

**화면 · 디자인**

- [ ] `design/erp-auth/ErpAuth.dc.html` 이 브라우저에서 색·글꼴·간격 정상으로 렌더됨
- [ ] `styles/tokens.css` 가 `tokens/` 6개와 변수 단위로 일치 (누락 0)
- [ ] 녹색 lint 가 일부러 넣은 녹색을 **실제로 잡음** (확인 후 되돌리기)
- [ ] `Icon` 이 외부 요청 없이 동작 (네트워크 탭에 lucide CDN 요청 0건)
- [ ] 아이콘 이름 오타가 **컴파일 에러**로 잡힘 (`'check-circle'` 로 시험)
- [ ] 폰트가 자체 호스팅으로 로드 (또는 CDN 유지 사유 보고)
- [ ] 사이드바 접힘 상태가 **새로고침 후 깜빡임 없이** 유지됨
- [ ] `/no-access` 의 "로그아웃" 이 실제로 세션을 끊고 `/login` 으로 보냄

**기반**

- [ ] 2-1 마이그레이션 검증 체크리스트 전 항목 통과
- [ ] `tsc --noEmit` 통과

**가장 꼼꼼히 볼 곳**: 세션 미들웨어 + 스코프 헬퍼. 이후 5개 페이즈 전부가 이 위에서 `req.session.companyId` 를 읽습니다. 여기서 버그가 나면 격리가 전 페이즈에서 동시에 샙니다.

---

# 4장. 하지 말 것

```
✗ 004_rename_tenant.sql 적용 (페이즈 G, 별도 앱 정지 창)
✗ s0300000020 · 030 · 040 화면 제작 (템플릿에 있어도 이관하지 않음)
✗ s0300000010p1 조직 선택 (회신 ⑩ 전까지 보류)
✗ ERP 자체 직원 테이블 · 비밀번호 저장 · 토큰 발급
✗ lib/permissions.ts 같은 ERP 자체 권한 판정 모듈
✗ screens.ts 에 role 필드
✗ org_tp 로 메뉴를 열고 닫기
✗ 요청 본문·쿼리스트링에서 회사번호 받기     ← 8월 명부 유출의 직접 원인
✗ 삐용 DB 직접 조회 · 스키마 넘어 조인 · 외래키
✗ tb_s030_* 접두어 테이블 신설 (네 번째 계보)
✗ URL 에 화면 ID 노출 (/s0300000080 아님, /no-access)
✗ style-hover · style-focus 속성을 그대로 복사
✗ design/_ds/ 트리 수정 · 토큰 새로 만들기 (디자인 소유)
✗ _ds_bundle.js 에서 컴포넌트 역이관 (컴파일 산출물)
✗ 아이콘 이름을 string 으로 받기
✗ 새 디자인 · 녹색 계열 색상
```

---

# 5장. 읽어야 할 문서

```
.planning/ROADMAP.md
.planning/SPEC.md
.planning/REQUIREMENTS.md
.planning/research/BBIYONG-AUTH.md
doc/SWONBIZ_SCREEN_LIST.md
doc/ORG_ARCHITECTURE.md
doc/BACKEND_ANALYSIS.md
doc/지시_ERP_로그인_권한관리.md      ← 충돌 시 이 문서가 이깁니다 (2026-09-06)
doc/SWONBIZ_PROJECT_STRUCTURE.md    ← D-1-c 정정 후
design/erp-auth/ErpAuth.dc.html
design/erp-tenants/                 ← 셸 기준
design/_ds/swonbiz/components/*/*.prompt.md   ← 컴포넌트 이관 전 필독
```

**문서 간 충돌을 발견하면 임의로 판단하지 말고 보고합니다.**

---

# 6장. 페이즈 1 종료 시 회신할 것

## 삐용 팀에

```
① 확정된 ERP 접속 주소   → erp.swonbiz.com 제안. CORS 허용 목록 등록용
② 화면 목록             → 이번 페이즈분(s0300000010 · 050 · 080). 팝업·모달 포함
③ 화면코드 체계          → s030 현행 체계 유지로 회신 (ORG §5-1 기결정)
```

받아야 할 것: ④ 토큰 저장 위치 · ⑤ TTL·갱신 방식 · ⑥ 토큰 내용 · ⑦ 로그인 API 규격.
넷 다 삐용 로그인 성공 처리 코드 한 곳에서 나옵니다.

이게 없어도 1차 6개 페이즈 전부 Mock 으로 완주 가능합니다. 회신이 오면 어댑터 구현체 하나(`HttpBbiyongAuth` / `HttpBbiyongAcl`)만 교체합니다.

## 디자인에

```
① 다크 패널 rgba(255,255,255,.06 / .10 / .14) 토큰 추가 요청
   → 이번 페이즈는 리터럴로 진행. 다음 전달분에 포함해 주면 교체
② 폰트 라이선스 확인 결과 공유
   → Pretendard · Inter 모두 OFL 이면 자체 호스팅으로 진행한다고 통보
```

키오스크 `--k-*` 4개는 페이즈 5 착수 시 다시 이야기합니다.
