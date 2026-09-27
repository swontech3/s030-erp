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
SwonBiz-erp/                             ← 모노레포 루트 · npm workspaces
├─ packages/
│  ├─ web/                               Next.js 16 · App Router
│  │  ├─ src/
│  │  │  ├─ app/
│  │  │  │  ├─ (public)/                 # 050 · 인증 불필요
│  │  │  │  │  ├─ page.tsx                  # s0300500010 랜딩
│  │  │  │  │  ├─ apply/                    # s0300500020 온라인 신청 (보류)
│  │  │  │  │  ├─ booking/                  # s0300500040 외부 예약 (보류)
│  │  │  │  │  └─ kiosk/page.tsx            # s0300500060 회의실 현황판
│  │  │  │  ├─ (auth)/                   # 000 · 인증 화면
│  │  │  │  │  ├─ login/page.tsx            # s0300000010
│  │  │  │  │  └─ no-access/page.tsx        # s0300000080 접근 권한 없음
│  │  │  │  ├─ (erp)/                    # 인증 필요 · ERP 셸 적용
│  │  │  │  │  ├─ layout.tsx                # s0300000050 셸 (사이드바·헤더)
│  │  │  │  │  ├─ dashboard/page.tsx        # s0300000060
│  │  │  │  │  ├─ settings/page.tsx         # s0300000070
│  │  │  │  │  ├─ facility/page.tsx         # s0300100010 센터 관리
│  │  │  │  │  ├─ tenants/
│  │  │  │  │  │  ├─ page.tsx               # s0300200010 목록
│  │  │  │  │  │  ├─ [id]/page.tsx          # s0300200020 상세
│  │  │  │  │  │  └─ contracts/page.tsx     # s0300200030 마스터-디테일
│  │  │  │  │  ├─ contracts/[id]/page.tsx   # s0300200040 계약 폼
│  │  │  │  │  ├─ applications/page.tsx     # s0300200060 신청 대기
│  │  │  │  │  ├─ billing/page.tsx          # s0300200070 월별 청구 (3차)
│  │  │  │  │  └─ booking/
│  │  │  │  │     ├─ page.tsx               # s0300600010 회의실 예약
│  │  │  │  │     └─ approvals/page.tsx     # s0300600020 승인 큐
│  │  │  │  └─ layout.tsx                # 루트 · 폰트(next/font/local) · 전역 토큰
│  │  │  ├─ components/
│  │  │  │  ├─ ds/                       # 디자인 시스템 15종 이관
│  │  │  │  ├─ icons/                    # ★ lucide 로컬 SVG 11종 (CDN 안 씀)
│  │  │  │  ├─ patterns/                 # 템플릿에서 추출한 재사용 패턴
│  │  │  │  └─ shell/                    # Sidebar · Header · Breadcrumb
│  │  │  ├─ features/                    # 화면별 도메인 로직 · 팝업
│  │  │  ├─ lib/                         # api 호출 래퍼 · format.ts
│  │  │  └─ styles/                      # tokens.css · globals.css
│  │  └─ proxy.ts                        # 미들웨어 = UX 게이트 (Next 16: middleware.ts 대체)
│  │
│  ├─ api/                               Fastify — ★ DB에 붙는 유일한 클라이언트
│  │  ├─ src/
│  │  │  ├─ db/
│  │  │  │  ├─ schema/*.ts               ★ Drizzle 스키마 (스키마 소유는 여기)
│  │  │  │  └─ withCompanyScope.ts       ★ SET LOCAL 트랜잭션 래퍼 (RLS 짝 코드)
│  │  │  ├─ auth/                        삐용 로그인 호출 · erp_sid 발급 · crypto
│  │  │  ├─ acl/BbiyongAcl.ts            권한 판정 위임 어댑터 (Mock / Http)
│  │  │  ├─ hooks/session.ts             onRequest 세션 미들웨어
│  │  │  └─ routes/
│  │  └─ drizzle.config.ts               out → ../../supabase/migrations
│  │
│  └─ shared/                            web·api 공용 — ★ 복사하지 않는다
│     └─ src/
│        ├─ screens.ts                   ★ 화면 ID ↔ 라우트 중앙 매핑 (role 필드 없음)
│        ├─ constants.ts                 미확정 상수 집중 관리
│        ├─ session.ts                   세션 타입 (memberId·orgId·orgTp·companyId)
│        └─ domain/                      S-WonERP 순수함수 이관분 (테스트 동반)
│           ├─ contract-settlement.ts
│           ├─ contract-invoices.ts
│           └─ reservation-validation.ts
│
├─ supabase/
│  ├─ migrations/                        001~003 + Drizzle generate 산출물(005~019)
│  └─ migrations_hold/                   비어 있음 (README 만) — 019 가 2026-09-19 적용됨
│
├─ design/                               ★ Claude Design 산출물 (읽기 전용 · 개발이 고치지 않음)
│  ├─ _ds/swonbiz/                       디자인 시스템 — tokens 6파일(119변수) · 컴포넌트 15종
│  │  └─ tokens/ components/ assets/ styles.css
│  ├─ erp-auth/ErpAuth.dc.html           # s0300000010 · s0300000080(sent 블록 재사용)
│  ├─ erp-tenants/                       # ★ 셸 기준(접기·툴팁·상태저장) + s0300200010·020
│  ├─ erp-master-detail/ erp-contract-form/ erp-dashboard/ erp-settings/
│  ├─ erp-booking/ erp-booking-compare/ erp-booking-kiosk/
│  └─ landing-hero/ erp-apply-form/
│
├─ doc/                                  설계·분석 문서 (이 파일 포함)
├─ .planning/                            SPEC · ROADMAP · REQUIREMENTS · 페이즈 지시서
├─ scripts/                              DB 점검 스크립트 (pg)
└─ package.json                          npm workspaces 루트
```

---

## 3. 화면 ID 매핑 (`packages/shared/src/screens.ts`)

화면 ID와 라우트의 단일 진실 공급원. 화면이 추가되면 여기만 수정한다.

```ts
export const SCREENS = {
  s0300000010: { route: '/login',              name: '로그인',         group: '000' },
  s0300000050: { route: null,                  name: 'ERP 셸',        group: '000' },  // layout · 라우트 없음
  s0300000060: { route: '/dashboard',          name: '대시보드',       group: '000' },
  s0300000070: { route: '/settings',           name: '설정',           group: '000' },
  s0300000080: { route: '/no-access',          name: '접근 권한 없음',  group: '000' },
  s0300100010: { route: '/facility',           name: '센터 관리',       group: '010' },
  s0300200010: { route: '/tenants',            name: '입주사 목록',     group: '020' },
  s0300200040: { route: '/contracts/[id]',     name: '계약 폼',         group: '020' },
  s0300500010: { route: '/',                   name: '랜딩',           group: '050', public: true },
  s0300500060: { route: '/kiosk',              name: '회의실 현황판',    group: '050', public: true },
  s0300600010: { route: '/booking',            name: '회의실 예약',     group: '060' },
  // ... 전체 목록은 doc/SWONBIZ_SCREEN_LIST.md 참조
} as const;
```

**활용**

- 미들웨어에서 `group === '050'` 또는 `public: true` 를 인증 제외로 처리
- **`role` 필드를 두지 않는다.** 사이드바 렌더와 접근 판정은 삐용이 준 화면 목록만 쓴다(ACL-07′). 이 필드가 있으면 ERP가 역할로 판정하게 되어 `지시_ERP_로그인_권한관리.md` 1-6 위반이다
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
- **미들웨어는 UX 게이트일 뿐이다**(CVE-2025-29927). 실제 차단은 Fastify가 한다
- 접근 판정은 역할이 아니라 **삐용이 준 화면 목록**으로 한다
- 로그인 후 홈 분기도 같은 기준이다 — `org_tp`로 분기하지 않는다

```ts
const screens = await bbiyongAcl.listScreens(session.s020MemberId)

if (screens.length === 0)        return '/no-access'   // s0300000080 · AUTH-13
if (has(screens, 's0300000060')) return '/dashboard'   // 대시보드 권한 = 운영사
if (has(screens, 's0300600010')) return '/booking'     // 예약 권한 = 입주사
return routeOf(screens[0])
```

  ※ 입주사 대시보드는 존재하지 않는다. 사이드바에도 렌더링하지 않는다
  ※ **화면 접근 판정의 근거는 화면 목록 하나뿐이다.** ERP는 `org_tp`로도 `member_tp`로도
    판정하지 않는다(회신 2026-09-12 §1·§5). 운영사 안에서 대표만 볼 화면은 삐용이
    '사원' 역할의 목록에서 빼는 것으로 처리한다 — ERP가 회원유형을 보기 시작하면
    판정 자리가 둘이 되고, 어느 날 하나만 고쳐진다
  ※ `org_tp`는 화면 쪽에서는 헤더 이름 표시("홍길동 (에스원테크)")에만 쓴다.
    다만 **데이터 스코프 역할(`BbiyongAcl.getScope`) 판정의 입력으로는 아직 쓰고 있다** —
    회신 §1이 "데이터 스코프는 `company_id`로만"이라 했으므로 이 자리는 **미결**이다
  ※ 조직 **이름 문자열로 운영사를 판별하지 않는다.** '에스원3DP'·'에스원BD'는
    `org_tp='N'`인 고객사다. 운영사는 `org_id=1` 한 곳뿐이다
  ※ 조직명 컬럼은 `org_name`이다 (`org_nm` 아님)

**인증은 삐용 JWT API를 호출한다.** ERP는 자체 계정 테이블을 두지 않는다.
토큰 갱신·세션 만료 정책을 삐용 설정과 일치시킬 것 (`SESSION_TTL` 확인 필요).

---

## 5. 템플릿 이관 규칙

`design/<템플릿폴더>/*.dc.html` 이 각 화면의 시각 기준이다. **새로 설계하지 말고 이관한다.**

`style-hover`·`style-focus`는 디자인 도구 전용 속성이라 브라우저가 무시한다 — React에서는 실제 CSS(`:hover`·`:focus-visible`)로 다시 쓴다.

**이관 순서**

1. `packages/web/src/styles/tokens.css` 에 CSS 변수 전량 이관 — `design/_ds/swonbiz/tokens/` 6파일을 **파일째 이어붙인다**(손으로 옮겨 적지 않는다)
2. `packages/web/src/components/ds/` 15종 구현 — 이관 전 같은 폴더의 `.prompt.md`를 먼저 읽고, `.d.ts`의 props 시그니처와 컴포넌트 이름을 그대로 유지한다(템플릿 11개가 그 이름으로 호출한다)
3. `components/patterns/` 추출 — 여러 화면에 걸치는 것만
4. 화면별 `page.tsx` 조립

**지켜야 할 규칙 (템플릿에 이미 반영됨)**

- Primary `#4F46E5` / Accent `#22D3EE`
- 상태색 `--color-warning #D97706` / `--color-danger #DC2626`
- **녹색 계열 금지** — 완료·성공도 인디고로 표현
- 오렌지는 로고 전용
- 아이콘은 반드시 DS `Icon` 컴포넌트. JS 생성 행의 셀렉트 캐럿은 CSS
- 금액 필드는 커서 보존 마스크 (`packages/web/src/lib/format.ts` 로 일원화)
- `prefers-reduced-motion` 대응

**반응형**

기본은 고정 1440px 기준. 단 아래 두 화면만 3단 대응한다.

- `s0300600010` 회의실 예약 — 1280+ 주간 / 768~1279 축약 / ~767 일간
- `s0300500060` 현황판 — `100dvh` 고정, 스크롤 없음

브레이크포인트 토큰: `--bp-tablet: 768px` / `--bp-desktop: 1280px`

---

## 6. 개발 순서 (1차)

```
1. 프로젝트 스캐폴딩 + tokens.css 이관
2. components/ds 15종
3. lib/auth 삐용 JWT 연동 + 미들웨어
4. (auth) 로그인 + 접근권한없음 2종
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

## 7. 상수 집중 관리 (`packages/shared/src/constants.ts`)

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

1. 한 입주사가 동시에 복수 계약을 가질 수 있는지
2. 계약 항목 10행이 호실만인지, 주차·사물함 등 이질적 항목이 섞이는지
   → 섞이면 항목 유형 구분 컬럼이 필요

**기타**

- `BOOKING_QR_URL` 및 인증 화면 `redirect` 파라미터 처리
- ~~권한 관리 화면~~ — **해소.** ERP에 권한 관리 화면을 만들지 않는다(권한 판정은 삐용)
- 세션 만료 기본값이 삐용 JWT TTL과 일치하는지
- T7 온라인 신청 폼 — 계약 폼 정책 3건 결정 후 재개 (`docs/HANDOVER_T7_ErpApplyForm.md`)

---

## 9. 모노레포 규약 *(2026-09-06 결정 · 페이즈 1 D-3)*

Fastify를 별도 저장소로 빼지 않고 **현 저장소 안 `packages/api`** 로 둔다.

**근거**
- `screens.ts`를 web·api 양쪽이 쓴다. 저장소가 갈리면 복사본이 생기고, 화면 ID가 두 곳에서 어긋나면 추적이 어렵다
- 페이즈 1의 완료 기준이 web·api·마이그레이션을 한 번에 넘나든다(홈 분기·401·`companyId` 해석). 한 커밋으로 묶이지 않으면 리뷰와 롤백이 갈라진다
- 설계 문서·디자인·마이그레이션이 이미 이 저장소에 있다
- 나중에 떼어내는 것(`git subtree split`)이 나중에 합치는 것보다 싸다

**규약**

| 항목 | 결정 |
|---|---|
| 패키지 매니저 | **npm workspaces** (pnpm 미설치 · 추가 설치 없이 시작) |
| 워크스페이스 | `packages/web` · `packages/api` · `packages/shared` |
| TypeScript | **5.9.3 고정.** `latest`는 Go 네이티브 TS 7.x로 해석된다 (PLAT-08) |
| ORM | **Drizzle.** 스키마는 `packages/api/src/db/schema/`. `drizzle-kit generate`로 SQL을 뽑아 `supabase/migrations/`에 넣고 적용한다. **`drizzle-kit push` 금지** |
| 기존 앱 | S-WonERP는 Prisma 유지. 같은 DB를 두 ORM이 각자 봐도 무방하다 — 스키마 소유가 갈려 있다 |
| DB 접속 | 신규 Fastify는 `erp_app`(BYPASSRLS 없음). 기존 S-WonERP는 `postgres` 그대로 |
| 마이그레이션 적용 | **항상 `postgres` 역할로 적용한다.** `ALTER DEFAULT PRIVILEGES`는 그 구문을 실행한 역할이 만든 테이블에만 적용되므로, 적용 역할이 섞이면 `erp_app` 권한이 새 테이블에 안 붙는다 |
| 자동 적용 금지 | `supabase/migrations_hold/` — 앱 정지 창이 필요한 파일만 둔다 |

**공용 코드가 아닌 것을 `shared`에 넣지 않는다.** 판단 기준은 "web과 api 둘 다 import 하는가" 하나다. 한쪽만 쓰면 그 패키지 안에 둔다.

### 9-1. DB 쪽 확정 사항 — 건드리지 않는다

**`btree_gist` · `vector` 확장은 `public` 스키마에 있다.** Supabase 관례(`extensions` 스키마)와
다르지만 **옮기지 않는다** — `tb_s080_reservations`의 겹침 방지 제약(`EXCLUDE USING gist`)이
`btree_gist`에 의존한다. 옮기거나 지우면 그 제약이 깨진다.

**RLS 세션 변수는 `set_config()`로 설정한다. `SET LOCAL`을 쓰지 않는다.**

```ts
// packages/api — 트랜잭션마다
await client.query(`SELECT set_config('app.current_role', $1, true)`, [session.role])
if (session.role !== 'operator') {
  await client.query(`SELECT set_config('app.current_company_id', $1, true)`, [session.companyId])
}
```

이유 둘. (1) `SET LOCAL app.current_role = '...'` 은 **파서가 거부한다** — `current_role`이
SQL 예약어다. (2) `SET`은 `$1` 바인딩을 못 받아 값을 문자열로 이어 붙여야 하고, 그러면
그 자리가 곧 SQL 인젝션 지점이 된다. `set_config(name, value, is_local := true)`가 둘 다 해결한다.
세 번째 인자 `true`가 `SET LOCAL`과 같은 트랜잭션 범위를 뜻한다 — **`false`를 쓰면 커넥션에
값이 남아 다음 요청(다른 회사)으로 새어나간다.**

**권한 점검은 `node scripts/check-grants.js`로 페이즈마다 돌린다.** `public`에
`anon`·`authenticated` 권한이 하나라도 생기면 실패한다. Supabase 대시보드·Studio로 테이블을
만들면 생성자가 `supabase_admin`이 되고 그 테이블은 즉시 `anon` 키로 밖에서 읽히기 때문이다.
위의 "항상 `postgres` 역할로 적용한다"가 그걸 막는 규약이고, 이 스크립트가 그 규약을 검사한다.

**★ `GRANT <role> TO <role> WITH SET TRUE` 를 이 DB 에서 실행하지 않는다.**
실행하면 **전체 세션이 끊기고 크래시 복구가 일어난다** (2026-09-06 확인, 원인 미상).
그 순간 삐용·메일 Agent 세션도 함께 끊긴다. RLS 검증이 필요하면 `SET ROLE` 로
우회하지 말고 **`erp_app` 으로 직접 접속한다**(`packages/api/.env` 의 `ERP_DATABASE_URL`).

**★ 이 개발 PC 의 Git Bash 에서는 `npm run` 이 실패한 스크립트의 종료코드를 삼킨다.**
(npm 9.6.6 / node 24.19.0, 2026-09-06 확인. PowerShell 과 CI 에서는 정상.)
검증할 때는 `node scripts/...` 를 직접 부르거나 PowerShell 을 쓴다.
**bash 에서 `npm run` 의 성공/실패를 믿지 않는다** — lint 하나가 아니라 앞으로의
모든 검증이 거짓 통과할 수 있다. npm 11.x 로 올리면 해결될 수 있으나 전역 도구를
바꾸는 일이라 지금은 문서에 남기는 것까지만 한다.

**Pretendard 자체 호스팅 파일이 2MB 다** (Inter 48KB 의 43배). 한글 글리프 전체가
들어 있어서인데, 로그인 화면이 쓰는 한글은 100자 미만이라 subset 으로 줄일 여지가 크다.
**페이즈 1 종료 전에 검토한다** — Pretendard 는 자소 단위 subset 배포본이 있다.
