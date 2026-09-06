# 기존 백엔드 분석 — S-WonERP

**작성일:** 2026-09-06
**대상:** `S-WonERP.zip` (117MB, 압축 해제 후 스크래치패드에서 직독)
**대조:** `ORG_ARCHITECTURE.md` · `SCHEMA_ANALYSIS.md` · `SWONBIZ_SCREEN_LIST.md`
**신뢰도:** HIGH — 소스 코드 직독. 추정 아님
**DB 변경:** 없음. 전 과정 읽기 전용

---

## 0. 한 줄 요약

**도메인 로직은 값어치가 크고, 인증과 격리는 통째로 버려야 한다.**

기존 앱은 Next.js 단일 앱이다. 별도 백엔드 서버가 없고 API Route가 백엔드 전부다. 계약 정산·청구 생성·예약 검증은 순수 함수 + 테스트로 잘 분리돼 있어 그대로 옮길 수 있다. 반면 인증은 Supabase Auth이고, **입주사 격리는 아예 없다** — 스코프축이 운영사 하나뿐이고 회사 필터를 쿼리스트링에서 받는다.

---

## ★ 방향 변경 기록 — D1이 뒤집혔다

이번 지시로 `PROJECT.md`의 **D1(ERP 테이블을 `tb_s030_t001`로 이동·리네임)이 철회**된다. `tb_s080_*`를 제자리에 두고 확장한다. 명시적으로 기록해 둔다.

| | 기존 D1 (2026-09-06 오전) | 이번 지시 (2026-09-06 오후) |
|---|---|---|
| 테이블 위치 | `tb_s030_t001.tb_s030_*`로 이동 | **`public.tb_s080_*` 유지** |
| 근거 | 접두어 계보 통일 · PostgREST 차단 | 기존 Next.js 앱이 돌고 있다 |
| 상태 | 철회 | **확정 (변경 불가)** |

**철회의 대가 두 가지를 남긴다.** 이동이 함께 해결하던 것이 사라지므로 별도 항목이 된다.

1. `public` 32테이블은 RLS가 전부 꺼져 있는데 `anon`·`authenticated`에 전권 grant가 걸려 있다(87건). **이제 이동이 아니라 명시적 REVOKE로 닫아야 한다.** → §4-6
2. 접두어가 `tb_s080_`(ERP) / `tb_s020_`(삐용) / `tb_s090_`(메일)로 갈린다. 시스템 코드는 S03인데 테이블 접두어는 `s080`이다. 이 불일치는 **문서로만 관리한다** — 삐용도 메일 Agent가 그룹 90을 쓰면서 시스템 코드 S09인 전례가 있다(지시서 2-7).

---

# 1. 기존 백엔드 구조 요약

## 1-1. 기술 스택

| 층 | 기술 | 버전 |
|---|---|---|
| 프레임워크 | **Next.js App Router** (`src/` 사용) | 16.2.6 |
| 런타임 | React / TypeScript / Node | 19.2.4 / 5.x / 20.x |
| **백엔드** | **Next.js API Route** — 별도 서버 없음 | — |
| ORM | **Prisma** (generator `prisma-client` → `src/generated/prisma`) | 6.19.3 |
| DB | PostgreSQL (Supabase 로컬, 포트 54322) | — |
| 인증 | **Supabase Auth** (`@supabase/ssr`) + MFA(aal2) + Google·Kakao | 0.10.3 / 2.105.4 |
| 게이트웨이 | **Cloudflare Access** JWT 검증 (`jose`, JWKS) | jose 6.2.3 |
| 상태 | TanStack Query 5 · zustand 5 | |
| 폼·검증 | react-hook-form 7 + **zod 4** | |
| UI | Tailwind 4 · shadcn 4 · @base-ui/react · lucide | |
| 문서 출력 | `jspdf` + `html2canvas-pro` | |
| OCR | `@google-cloud/vision` (사업자등록증 판독) | 5.3.7 |
| 테스트 | **vitest** | 2.1.9 |

**개발 포트 3001.** ERP 신규 프런트와 동시 기동 가능하다(신규는 3000 가정).

## 1-2. 규모

| 항목 | 수 |
|---|---:|
| API Route 파일 | **75** |
| `.ts`/`.tsx` (generated 제외) | 312 |
| 테스트 파일 | **37** |
| Prisma 모델 | 31 |
| Prisma 마이그레이션 | 34 |
| `schema.prisma` 줄 수 | 1,144 |

**테스트 37개가 전부 `src/lib/` 순수 함수에 붙어 있다.** API Route에는 테스트가 없다. 이 분포가 재사용 판단의 근거가 된다 — 값어치는 `lib/`에 있고, Route는 얇은 껍데기다.

## 1-3. 디렉터리 구조

```
S-WonERP/
├─ src/
│  ├─ proxy.ts                    ★ Next 16에서 middleware → proxy로 개명. Cloudflare Access + Supabase 세션
│  ├─ app/
│  │  ├─ (auth)/                  sign-in · sign-up · forgot-password · change-password · callback
│  │  ├─ (dashboard)/             인증 필요 화면 25종
│  │  │  ├─ admin/                spaces(기준설정) · codes · employees · biz-purposes · doc-form-settings
│  │  │  ├─ contracts/            목록 · new · [id]/edit
│  │  │  ├─ tenants/  payments/  meeting-room/  consultations/  dashboard/
│  │  │  ├─ incorporations/       법인설립 (4차 영역인데 이미 구현됨)
│  │  │  ├─ corp-changes/         법인변경
│  │  │  └─ form-templates/       양식 빌더
│  │  ├─ (landing)/
│  │  └─ api/                     ★ 백엔드 전부. 75개 route.ts
│  ├─ lib/                        ★ 도메인 로직 + 순수 함수 (테스트 37개가 여기)
│  │  ├─ auth-context.ts  auth-fallback.ts  auth-metadata.ts  dev-auth.ts  route-guard.ts
│  │  ├─ contract-settlement.ts   중도해지 정산 (12KB, 최대 로직)
│  │  ├─ contract-invoices.ts     계약확정 → 월별 청구서 생성
│  │  ├─ invoice-recalc.ts  invoice-status.ts
│  │  ├─ reservation-validation.ts  예약 슬롯·겹침·요금
│  │  ├─ code-hierarchy.ts  code-tree.ts
│  │  ├─ incorp-*.ts (9)  corp-change-*.ts (7)  form-*.ts (7)  doc-form-*.ts (3)
│  │  └─ supabase/{client,server,admin,middleware}.ts
│  ├─ services/                   space-status.ts · tax/(popbill 어댑터, 미구현)
│  ├─ components/                 contract(10) · meeting(5) · payment(4) · tenant(3) · incorporation · form-builder · ui
│  ├─ hooks/ (12)  stores/ (4)  generated/prisma/
├─ prisma/
│  ├─ schema.prisma               31 모델 · 1,144줄
│  ├─ migrations/ (34)
│  └─ .archive_mysql/             ★ MySQL 시절 이력. PostgreSQL 전환 흔적
├─ scripts/                       create-admin · seed-* · e2e-meeting-room
├─ secrets/                       ⚠ Google 서비스계정 키 (gitignore 됨, zip에는 포함)
└─ docs/                          전대차계약서.docx · 등기 화면 캡처 등
```

## 1-4. 아키텍처 특징 세 가지

**① 백엔드 서버가 없다.** Fastify도 Express도 없다. `app/api/**/route.ts`가 Prisma를 직접 부른다. 새 설계의 "Next.js + Fastify" 2계층과 다르다.

**② Prisma가 스키마 단독 소유자다.** `_prisma_migrations` 34건. 다른 앱은 이 테이블들을 쓰지 않는다(`SCHEMA_ANALYSIS.md` §6.3에서 이미 확인).

**③ `getAuthContext()`가 인증 단일 진입점이다.** 75개 라우트 중 73개가 이걸 부른다. 부르지 않는 2개는 `/api/tenants/[id]`(410 Deprecated 스텁)와 `/api/user/sync`(인증 없이 upsert — §1-6 ③).

**구조 자체는 좋다.** 진입점이 하나라 갈아끼울 지점도 하나다. 삐용 전환의 실제 작업량은 이 함수 하나와 그 반환 타입이다.

## 1-5. ★ MIGRATION_A_PLAN 선행조건 ① — grep 3종 결과

`MIGRATION_A_PLAN.md` §2가 요구한 확인이다. **이번 지시로 이동은 하지 않지만, 결과 자체는 향후 판단에 계속 쓰이므로 기록한다.**

| grep | 결과 | 해석 |
|---|---:|---|
| `from('tb_s080` / `from("tb_s080` (supabase-js 직접 호출) | **0건** | Supabase는 **Storage 전용**. 테이블 접근은 100% Prisma |
| `queryRaw` / `executeRaw` (앱 소스) | **1건** | `src/app/api/reservations/route.ts:203` |
| `tb_s080` 하드코딩 (앱 소스) | **1건 + 주석 5건** | 위 raw SQL 1건 / `services/space-status.ts`는 **JSDoc 주석뿐** |

유일한 실제 하드코딩:

```ts
// src/app/api/reservations/route.ts:203
const locked = await tx.$queryRaw<{ facility_id: string }[]>(
  Prisma.sql`SELECT facility_id FROM tb_s080_facilities
             WHERE facility_id = ${facilityId} AND status = 'active'
             FOR UPDATE`
);
```

**결론: 테이블 이름에 걸린 앱 코드는 `schema.prisma`의 `@@map` 29건 + 이 SQL 1줄이다.** 향후 이동을 재검토한다면 비용은 여전히 파일 2개다.

## 1-6. ★★ 인증 실태 — 전부 폐기 대상

### ① Supabase Auth가 인증 주체다

```
브라우저 → Supabase Auth (email/pw, Google, Kakao, MFA aal2)
              ↓ app_metadata
        { role, tenant_id, build_id, floor_id, dept_cd, must_change_password }
              ↓
        getAuthContext() → AuthContext { userId, role, tenantId, organizationId, ... }
```

**삐용 JWT와 접점이 하나도 없다.** 지시서가 확정한 구조(삐용 로그인 API 호출 → 삐용이 판정)와 정면으로 다르다.

역할은 5종 `A · S · E · C · M`으로, `SCHEMA_ANALYSIS.md`가 찾은 `RES_TP` 코드와 일치한다. 다만 **ERP가 이 역할을 저장하고 판정한다** — 지시서 2-1이 금지한 바로 그것이다.

### ② `DEV_BYPASS_AUTH` — 운영에 켜지면 전면 개방

```ts
// src/lib/dev-auth.ts
export const DEV_BYPASS_AUTH = process.env.DEV_BYPASS_AUTH === "true";
```

`true`면 로그인 없이 `role: "A"`, `isAdmin: true`, `tenantId: "1"` 가짜 컨텍스트가 반환된다. 우회 지점 4곳(프록시·레이아웃·`getAuthContext`·`/api/user/role`). 코드에 경고 주석이 붙어 있고 기본값은 안전(false)하지만, **환경변수 하나로 전 화면·전 API가 열린다.** 전환 시 분기 코드 자체를 제거한다.

### ③ `/api/user/sync` — 인증 없는 upsert

```ts
export async function POST(request: NextRequest) {
  const { id, email, name, company } = await request.json();
  await db.user.upsert({ where: { id }, update: {...}, create: {...} });
}
```

`getAuthContext()`를 부르지 않는다. 임의의 `id`·`email`로 `User` 행을 만들거나 덮어쓸 수 있다. **폐기 대상이므로 고치지 말고 지운다.**

### ④ Cloudflare Access — 유지 검토 대상

`src/proxy.ts`가 `/api/*` 요청에 CF Access JWT를 검증한다. 환경변수(`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`) 미설정이면 통과한다. 이건 애플리케이션 인증이 아니라 **망 앞단 게이트**라서 삐용 전환과 충돌하지 않는다. 신규 ERP에서도 쓸 수 있다.

## 1-7. ★★★ 격리 실태 — 입주사 격리가 없다

**이번 분석의 최대 발견이다.** `ORG_ARCHITECTURE.md` §2-4의 경고가 실제 코드에서 확인됐다.

### 스코프축이 운영사 하나뿐이다

```ts
// src/app/api/contracts/route.ts:38
const contracts = await db.tbS080Contract.findMany({
  where: {
    building: { tenantId },          // ← 운영사(tb_s080_tenant010, 1행)
    ...(companyId ? { companyId } : {}),
    ...
```

`tenantId`는 `ctx.tenantId`에서 오고 그건 운영사다. 현재 DB에 운영사는 `'개발 운영사'` **1행뿐**이므로, 이 필터는 사실상 **아무것도 거르지 않는다.**

### 회사 필터를 쿼리스트링에서 받는다

```ts
const companyId = searchParams.get("companyId")?.trim();   // 좌측 선택 회원사
```

**이것이 ACL-03 위반이고, 8월 명부 유출의 직접 원인과 같은 형태다.** 지시서 3장 *"✗ 요청에서 회사번호 받기"*.

지금은 사고가 나지 않는다 — 실제 사용자가 전원 운영사(`A`/`S`/`E`)이기 때문이다. 그러나 `AppMetadata` 타입에 입주사 역할 `C`/`M`이 이미 정의돼 있고 `buildMemberMetadata()`가 그 계정을 만든다. **입주사 한 명이 로그인하는 순간 전 회사 계약이 열린다.**

| 리소스 | 현재 스코프 | 입주사 격리 |
|---|---|:---:|
| 계약 목록·상세 | `building.tenantId` + 쿼리스트링 `companyId` | **없음** |
| 청구서 | `building.tenantId` 확인 후 `buildingId`로 조회 | **없음** |
| 예약 | `building.tenantId` | **없음** |
| 입주사 목록 | `building.tenantId` | **없음** |
| 첨부파일(`tb_cm_file`) | polymorphic. `company_id` 컬럼 자체가 없다 | **없음** |

### `tenant_id` 타입이 섞여 있다

| 타입 | 테이블 | FK |
|---|---|:---:|
| `Int` | `tb_s080_tenant010`(PK) · `tb_s080_buildings` · `User` | ✔ |
| `String` | `tb_cm_file` · `tb_s080_departments` · `tb_s080_employees` · `tb_s080_incorporations` · `tb_s080_corp_changes` · `tb_s080_form_templates` · `tb_s080_doc_form_settings` | **✕ 없음** |

코드에 `parseInt(ctx.tenantId, 10)`이 라우트마다 흩어져 있다. 오타가 조용히 통과한다.

## 1-8. 계약 상태 어휘가 두 벌이다

`schema.prisma` 정본: `P` 대기 / `A` 계약중 / `E` 만료 / `S` 중도해지 / `C` 취소

전용 라우트는 정확하다.

| 라우트 | 쓰는 값 | 의미 |
|---|---|---|
| `/api/contracts/[id]/cancel` | `"C"` | 취소 ✔ |
| `/api/contracts/[id]/midterm` | `"S"` | 중도해지 ✔ |
| `/api/contracts/[id]` DELETE | `"S"` | 중도해지 ✔ |

그런데 **생성·수정 경로의 매핑 표는 다르다.**

```ts
// src/app/api/contracts/route.ts:15  및  [id]/route.ts:196 (같은 표가 2곳에 중복 정의)
const contractStatusMap = { draft: "P", active: "A", terminated: "C" };
                                                     ^^^^^^^^^^^^^^^ 취소로 저장된다
```

UI의 `terminated`가 생성·수정 경로에서는 **취소(C)**, 전용 해지 라우트에서는 **해지(S)**로 간다. `[id]/route.ts:203`의 주석은 *"취소(terminated): 퇴실(E)"* 이라 적어 UI 어휘가 취소를 뜻함을 인정한다.

**지금은 버그로 드러나지 않는다**(계약을 처음부터 terminated로 만드는 경로가 실사용에 없다). 그러나 CONT-08의 CHECK 제약과 상태 이력 테이블을 넣는 순간 두 어휘가 충돌한다. **확장 전에 어휘를 하나로 정한다.** → §4-5

---

# 2. API 재사용 / 재작성 / 불필요 분류

## 2-1. 분류 기준

| 등급 | 판단 기준 |
|---|---|
| **[A] 재사용** | 새 설계에 화면이 없거나(4·5차) 도메인이 독립적이라 손댈 이유가 없다. 기존 앱을 그대로 두고 신규 ERP가 프록시로 호출한다 |
| **[B] 재작성** | 격리축·상태어휘·스키마 확장이 걸려 있어 손을 대야 한다. 로직은 `src/lib/`에서 **그대로 옮긴다** |
| **[C] 불필요** | 삐용 인증 전환으로 존재 이유가 사라진다. 지운다 |

**[B]의 핵심:** 재작성은 "다시 설계"가 아니다. `contract-settlement.ts`·`contract-invoices.ts`·`reservation-validation.ts`는 DB를 모르는 순수 함수 + 테스트라 **파일째로 Fastify 프로젝트에 복사**된다. 다시 쓰는 것은 Route 껍데기와 스코프뿐이다.

## 2-2. 분류표 (75 라우트 전량)

### [A] 재사용 — 37개

| 그룹 | 라우트 | 수 | 근거 |
|---|---|---:|---|
| **법인설립** | `/api/incorporations/**` | 10 | 4차. 새 설계에 화면이 없다(`SCREEN_LIST` 040 미확정). 손대면 순수 손실 |
| **법인변경** | `/api/corp-changes/**` | 6 | 동일 |
| **양식 빌더** | `/api/form-templates/**` · `/api/form-data-sources/**` · `/api/admin/doc-form-settings/**` | 8 | `s0300100020` 표양식 관리(4차)에 대응. 이미 완성돼 있다 |
| **사업목적 카탈로그** | `/api/biz-purposes/catalog` · `/api/admin/biz-purposes/review` | 2 | 법무 부속 |
| **공통코드** | `/api/codes` · `/api/admin/codes/**` | 6 | `code_masters` + `codes_line` 계층형. 신규 설계에 대응 화면 없음. 그대로 쓴다 |
| **사업자등록증 OCR** | `/api/contracts/ocr-biz-reg` | 1 | Google Vision 연동. 신규 설계에 없는 기능이고 계약 폼 입력 보조로 값어치가 크다 |
| **파일 업로드** | `/api/upload/contract-file` · `/api/admin/spaces/files/**` | 3 | Supabase Storage 연동. Storage는 유지 |
| **지점 담당자** | `/api/admin/spaces/managers` | 1 | 계약서 출력의 담당자명 조회 |

> **[A]의 전제:** 이 라우트들은 여전히 `getAuthContext()`(Supabase Auth)에 의존한다. 신규 ERP가 삐용 세션으로 전환한 뒤에도 이들을 호출하려면 **인증 브리지가 필요하다.** → §2-4

### [B] 재작성 — 30개

| 그룹 | 라우트 | 수 | 재작성 이유 |
|---|---|---:|---|
| **계약** | `/api/contracts` · `/[id]` · `/[id]/cancel` · `/[id]/midterm` · `/[id]/midterm-cancel` · `/[id]/settlement-preview` · `/check-biz-number` · `/check-company` · `/check-room` · `/companies` | 10 | 격리축(§1-7) · 상태어휘(§1-8) · 계약항목/사용자 확장(N1·N2) · 스냅샷(N7)이 전부 여기 |
| **기준관리** | `/api/admin/spaces/{buildings,floors,rooms,meeting-rooms}[/**]` | 11 | 격리축 · `s0300100010` 화면 재구성 · 예약 정책 기본값(N10) |
| **조회용 기준정보** | `/api/buildings` · `/api/floors` · `/api/spaces` · `/api/spaces/buildings` · `/api/spaces/status` · `/api/facilities` | 6 | 위와 같은 테이블. 스코프 헬퍼를 태워야 한다 |
| **청구·수납** | `/api/invoices` · `/api/invoices/[id]/payments` · `/api/payments/[id]` | 3 | 격리축. BILLING은 운영사 전용 여부가 회신 ⑧에 걸림 |
| **예약** | `/api/reservations` · `/api/reservations/[id]` | 2 | 격리축 · 타임존(C1) · 배타제약(C2) · 상태 확장(C6) · 「본인 것만」 범위(O5) |
| **운영사 직원** | `/api/admin/employees` · `/[id]` | 2 | 삐용 계정 전환 후에도 **명부**는 필요. 단 `initial_password` 등 계정 성격 필드는 제거 |

> `/api/admin/employees`는 판단이 갈릴 수 있다. **명부(이름·부서·연락처)는 남기고 계정 발급 기능은 버린다.** 현재 이 라우트는 Supabase Admin API로 계정을 만들고 `app_metadata`를 심는다 — 그 부분이 [C]다.

### [C] 불필요 — 8개

| 라우트 | 처리 |
|---|---|
| `/api/auth/sign-out` | 삐용 `sign-out` 호출로 대체 |
| `/api/user/change-password` | 지시서 1-3. 삐용으로 보낸다 |
| `/api/user/role` | ERP가 역할을 판정하지 않는다(지시서 2-1) |
| `/api/user/sync` | `User` 테이블 폐기 + 인증 없는 upsert(§1-6 ③) |
| `/api/user/default-location` | `User` 기반 사용자 설정. 필요하면 삐용 memberId 키로 재작성 |
| `/api/tenants/[id]` | 이미 410 Deprecated 스텁 |
| `(auth)/sign-up`·`forgot-password` 화면 | 지시서 1-3. 이미 미들웨어에서 차단 중 |
| `settings/mfa`·`mfa/verify` 화면 | 삐용이 MFA를 담당. ERP에 두면 진실원이 둘 |

**합계 검산: A 37 + B 30 + C 8 = 75** ✔

## 2-3. `src/lib/` 도메인 로직 — 이관 대상

**Route보다 이쪽이 값어치가 크다.** 전부 DB를 모르거나(순수) `Prisma.TransactionClient`만 받으므로 이식성이 높다.

| 파일 | 크기 | 테스트 | 처리 | 비고 |
|---|---:|:---:|---|---|
| `contract-settlement.ts` | 12.3KB | ✔ | **그대로 이관** | 중도해지 정산. 일할 계산·예치금 반환·할인 환수. 순수 함수 `computeTerminationSettlement` + DB 반영 분리 |
| `contract-invoices.ts` | 6.1KB | ✔ | **그대로 이관** | 계약확정 → 월납(M)/일시불(C) 청구서·라인·수납 생성 |
| `reservation-validation.ts` | 2.7KB | ✔ | **그대로 이관** | 슬롯 정렬·운영시간·최소/최대·겹침·요금. `BOOKING` 상수와 맞물림 |
| `invoice-recalc.ts` · `invoice-status.ts` | 2.4KB | ✔ | **그대로 이관** | 납부 상태 파생(완료/부분/미납/대기/취소) |
| `services/space-status.ts` | 2.1KB | ✕ | **이관 + 테스트 추가** | 계약 건수 → 호실 점유/공실 동기화 |
| `code-hierarchy.ts` · `code-tree.ts` | 3.4KB | ✔ | 이관 | 계층형 공통코드 |
| `biz-reg-ocr.ts` | 4.2KB | ✔ | 이관 | 사업자등록증 판독 파싱 |
| `crypto.ts` | 1.5KB | ✕ | **검토** | 주민번호 암호화(AES-GCM). 삐용 세션 토큰 암호화에 재사용 가능 |
| `incorp-*.ts` (9) · `corp-change-*.ts` (7) | ~30KB | ✔ | **[A] 유지** | 법무. 건드리지 않는다 |
| `form-*.ts` (7) · `doc-form-*.ts` (3) | ~25KB | ✔ | **[A] 유지** | 양식 빌더 |
| `auth-*.ts` (4) · `route-guard.ts` · `dev-auth.ts` | 6KB | ✔ | **[C] 폐기** | Supabase Auth 전용 |

**★ 예약 동시성 처리는 지금 방식이 유효하다.** `SELECT ... FOR UPDATE`로 시설 행을 잠그고 트랜잭션 안에서 재검증한다. `SCHEMA_ANALYSIS.md` C2가 요구한 `EXCLUDE USING gist`를 넣기 전까지의 임시 방편이 아니라 **이미 동작하는 직렬화**다. 배타제약을 넣으면 이 잠금은 제거해도 되지만, 넣기 전까지 남겨 둔다.

## 2-4. ★ [A] 재사용의 전제 — 인증 브리지가 필요하다

[A] 37개 라우트는 `getAuthContext()`가 Supabase 세션을 읽는다는 전제 위에 있다. 신규 ERP가 삐용 세션으로 가면 **이 라우트들이 401을 뱉는다.**

선택지 세 가지다.

| 안 | 내용 | 평가 |
|---|---|---|
| **A-1** | `getAuthContext()`를 **삐용 세션도 읽도록 확장**한다. 반환 타입은 그대로 두고 소스만 두 갈래 | ★ **권장** |
| A-2 | 신규 ERP가 서버-서버로 호출할 때 전용 서비스 키를 붙인다 | 격리가 호출자 책임이 된다. 위험 |
| A-3 | [A] 라우트도 전부 재작성 | 법무·양식 빌더 25개를 다시 만든다. 손실이 크다 |

**A-1의 구현은 함수 하나다.**

```ts
// src/lib/auth-context.ts (기존 앱 쪽 수정)
export async function getAuthContext(): Promise<AuthContext | null> {
  // ① 신규: 삐용 세션 쿠키(erp_sid)가 있으면 세션 테이블에서 해석
  const bridged = await resolveFromErpSession();
  if (bridged) return bridged;

  // ② 기존: Supabase 세션 (전환 기간에만 유지)
  ...
}
```

`AuthContext`의 `role`은 **표시용으로 강등**한다. 판정은 신규 ERP의 Fastify가 삐용에 묻고 끝낸 뒤에 호출하므로, [A] 라우트는 이미 통과한 요청만 받는다.

> **감수하는 것:** 전환 기간에 인증 경로가 둘이다. `ORG_ARCHITECTURE.md` §2-3이 경고한 "쓰기 경로가 둘"과 같은 종류의 위험이므로, **②(Supabase 경로)를 언제 끊을지 날짜를 정해 둔다.**

---

# 3. 기능별 구현 현황 (STEP 2)

범례: ● 완성 · ◐ 부분 · ○ 없음

## 3-1. 입주사 관리 — ●

| 기능 | 상태 | 구현 위치 |
|---|:---:|---|
| 목록 | ● | `(dashboard)/tenants` · `/api/contracts/companies` |
| 상세 | ● | `components/tenant/tenant-card.tsx` |
| 등록·수정 | ● | `tenant-form-modal.tsx` · 계약 등록 시 동반 생성 |
| 삭제 | ● | `tenant-delete-modal.tsx` |
| 사업자번호 중복 차단 | ● | `biz_number` UNIQUE + `/api/contracts/check-biz-number` |
| 비입주사 구분 | ● | `is_non_tenant` (법인설립 전용 회사) |
| **입주사 격리** | **○** | §1-7 |
| **삐용 org 연결** | **○** | `link_s020_org_id` 없음 |

`tb_s080_companies`는 설계 요구를 넘어선다 — 본점 주소·영문명·업태·종목·홈페이지·직원수까지 있다.

## 3-2. 계약 — ● (가장 완성도 높음)

| 기능 | 상태 | 구현 위치 |
|---|:---:|---|
| 등록 | ● | `/api/contracts` POST (473줄) · `components/contract/ContractForm.tsx` |
| 수정 | ● | `/api/contracts/[id]` PUT (414줄) |
| 확정 → 청구서 자동 생성 | ● | `lib/contract-invoices.ts` |
| 취소 (`C`) | ● | `/api/contracts/[id]/cancel` |
| 중도해지 (`S`) + 정산 | ● | `/api/contracts/[id]/midterm` + `lib/contract-settlement.ts` |
| 해지 취소 | ● | `/api/contracts/[id]/midterm-cancel` |
| 정산 미리보기 | ● | `/api/contracts/[id]/settlement-preview` |
| 계약서 출력 | ● | `ContractPrintPreviewModal.tsx` · `ContractSubleaseModal.tsx` (이용·전대차 2종) |
| 호실 중복 체크 | ● | `/api/contracts/check-room` |
| 호실 점유 동기화 | ● | `services/space-status.ts` |
| **계약 항목 N행** | **○** | `space_id` 단일 FK. CONT-04/05 미충족 |
| **계약 사용자 최대 20** | **◐** | `tb_s080_members`가 입주사 스코프. 계약 스코프 아님 |
| **상태 이력** | **○** | CONT-11 |
| **무상기간·보증금 상태·스냅샷·재계약 FK** | **○** | §4-3 |

**정산 로직이 이 앱에서 가장 값어치 있는 자산이다.** 예치금 전액 반환, 할인 전액 환수, 일시불/월납 분기, 해지달 일할 계산까지 대표자 명세가 코드 주석에 남아 있고 테스트가 붙어 있다.

## 3-3. 회의실 예약 — ●

| 기능 | 상태 | 비고 |
|---|:---:|---|
| 현황 조회 (월·주) | ● | `(dashboard)/meeting-room` · `components/meeting/calendar.tsx` |
| 등록 | ● | `FOR UPDATE` 잠금 + 트랜잭션 내 재검증 |
| 취소 | ● | `/api/reservations/[id]` PATCH |
| 슬롯·겹침·요금 검증 | ● | `lib/reservation-validation.ts` (06:00~24:00, 30분) |
| 예약자 이름 해석 | ● | 직원 → 구성원 → User 순 |
| **상태 `requested`·`rejected`** | **○** | 외부 예약 승인 큐(`s0300600020`)에 필요 |
| **타사 예약 마스킹** | **○** | ACL-06 |
| **「본인 것만」 범위** | **○** | `created_by_s020_member_id` 없음 |
| **외부(비로그인) 예약** | **○** | `s0300500040`. 미구현 |

기본 운영시간이 코드 상수(06:00~24:00)로 박혀 있다. 신규 설계는 `lib/constants.ts` + 회의실별 override 구조이므로 재작성 시 옮긴다.

## 3-4. 청구 — ● (설계 요구 초과)

| 기능 | 상태 | 비고 |
|---|:---:|---|
| 계약확정 시 월별 청구서 생성 | ● | 월납: 월 1건, 첫 달 완납 / 일시불: 시작월 1건 통합 |
| 청구서 목록 + 합계 | ● | `/api/invoices` — 청구총액·수납총액·미수금·미납건수 |
| 수납 등록·삭제 | ● | `/api/invoices/[id]/payments` · `/api/payments/[id]` |
| 납부 상태 파생 | ● | 완료/부분납부/미납/대기/취소 |
| 청구서 재계산 | ● | `lib/invoice-recalc.ts` |
| 국세청 승인번호 | ◐ | `nts_confirm_num` 컬럼만 존재 |
| 세금계산서 발행 | ○ | `services/tax/popbill.adapter.ts` — **스텁 41줄. 미구현** |

**`PROJECT.md`의 "청구는 3차로 분리" 전제가 무너져 있다.** 스키마도 API도 화면도 다 있다. 로드맵 재검토 항목이다.

## 3-5. 기준관리 — ●

건물 → 층 → 호실 → 회의실 4계층 CRUD가 `/api/admin/spaces/**` 12개 라우트로 완성돼 있다. 호실 일괄 등록(`rooms/bulk`), 도면 첨부(`files`), 지점 담당자(`managers`)까지 있다.

**`s0300100010` 센터 관리 화면은 신규 디자인이 불필요하다**(SCREEN_LIST 주석)는 판단과 맞물려, 이 영역은 API를 [B]로 재작성하되 로직 손실이 거의 없다.

## 3-6. 인증 — ● (전부 폐기)

§1-6 참조. Supabase Auth · MFA · 소셜 로그인 · 최초 비밀번호 강제 변경 · Cloudflare Access까지 완성돼 있으나, 삐용 전환으로 **Cloudflare Access를 제외한 전부가 [C]**다.

---

# 4. `tb_s080_*` 확장 계획 (STEP 4)

## 4-1. `tenant_id` → `operator_id` 개명 대상

**10개 테이블, 12개 컬럼.** `tenant_id`가 가리키는 것은 운영사(에스원비즈 자신, 1행)이지 입주사가 아니다.

| # | 테이블 | 컬럼 | 타입 | FK | 처리 |
|---|---|---|---|:---:|---|
| 1 | `tb_s080_tenant010` | `tenant_id` (PK) | `int` | — | **테이블도 `tb_s080_operator010`으로 개명 권장** |
| 2 | `tb_s080_buildings` | `tenant_id` | `int` | ✔ | 개명 |
| 3 | `public."User"` | `tenant_id` | `int` | ✔ | **폐기 대상.** 개명하지 않는다 |
| 4 | `tb_cm_file` | `tenant_id` | `text` | ✕ | 개명 + 타입 통일 + FK |
| 5 | `tb_s080_departments` | `tenant_id` | `text` | ✕ | 개명 + 타입 통일 + FK |
| 6 | `tb_s080_employees` | `tenant_id` | `text` | ✕ | 개명 + 타입 통일 + FK. **복합 UNIQUE 3건·인덱스 2건 동반 수정** |
| 7 | `tb_s080_incorporations` | `tenant_id` | `text` | ✕ | 개명 + 타입 통일 |
| 8 | `tb_s080_corp_changes` | `tenant_id` | `text` | ✕ | 개명 + 타입 통일 |
| 9 | `tb_s080_form_templates` | `tenant_id` | `text` | ✕ | 개명 + 타입 통일 |
| 10 | `tb_s080_doc_form_settings` | `tenant_id` | `text` | ✕ | 개명 + 타입 통일. **복합 UNIQUE 1건 동반 수정** |

**개명이 앱에 미치는 영향:** `schema.prisma`에서 `@map("tenant_id")` → `@map("operator_id")`로 바꾸면 **Prisma 필드명(`tenantId`)은 유지 가능**하다. 즉 앱 코드는 한 줄도 안 바뀐다. 필드명까지 바꿀지는 별도 결정이며, 혼동 제거가 목적이므로 **필드명도 `operatorId`로 바꾸는 쪽을 권장**한다(치환 대상 164곳, 기계적).

> ★ **개명과 타입 통일을 같은 마이그레이션에 넣는다.** `text` 7건을 `int`로 바꾸려면 기존 값이 전부 숫자여야 한다. 데이터가 시드뿐이고 운영사가 1행이므로 지금은 `'1'` → `1` 변환 하나로 끝난다. 운영 데이터가 들어간 뒤에는 같은 작업이 몇 배가 된다.

## 4-2. `company_id` 격리축 적용 현황

### 컬럼이 있는 테이블 — 9개

| 테이블 | `company_id` | NULL | 격리 코드 적용 |
|---|:---:|:---:|:---:|
| `tb_s080_companies` (PK) | ✔ | — | — |
| `tb_s080_contracts` | ✔ | NOT NULL | **✕ 쿼리스트링에서 받음** |
| `tb_s080_invoices` | ✔ | NOT NULL | **✕** |
| `tb_s080_payments` | ✔ | NOT NULL | **✕** |
| `tb_s080_settlements` | ✔ | NOT NULL | **✕** |
| `tb_s080_members` | ✔ | NOT NULL | **✕** |
| `tb_s080_reservations` | ✔ | **NULL 허용** | **✕** |
| `tb_s080_incorporations` | ✔ | NOT NULL | ✕ ([A] 유지) |
| `tb_s080_corp_changes` | ✔ | NULL 허용 | ✕ ([A] 유지) |

**컬럼은 다 있고, 그 위에 선 코드가 없다.** 스키마 문제가 아니라 애플리케이션 문제다. 스코프 헬퍼 하나와 린트 규칙으로 해결된다.

### 컬럼이 없는데 격리가 필요한 테이블 — 1개

| 테이블 | 문제 | 처리 |
|---|---|---|
| **`tb_cm_file`** | polymorphic 첨부(`target_type` + `target_id`)만 있고 `company_id`가 없다. 계약 첨부·도면·수납 영수증이 전부 여기 48행 | **부모 경유 검증을 강제**하거나 `company_id` 비정규화 컬럼 추가 |

**권장: 부모 경유 검증.** `company_id`를 복제하면 부모와 어긋날 때 어느 쪽이 진짜인지 모른다. 대신 파일 조회를 **단일 헬퍼**로 좁히고, 그 안에서 `target_type`별로 부모의 `company_id`를 확인한다. 지금처럼 `target_id`만으로 조회하면 **ID만 알면 남의 계약서가 열린다.**

### 컬럼이 없어도 되는 테이블

`buildings` · `floors` · `spaces` · `facilities` · `code_masters` · `codes_line` · `departments` · `employees` · `form_templates` · `doc_form_settings` — **운영사 자산**이며 입주사별로 갈리지 않는다.
`invoice_lines` · `incorp_persons` · `incorp_purposes` · `corp_change_officers` · `space_room` — **부모 경유**로 충분하다.

### ★ `companies.build_id` NOT NULL

`ORG_ARCHITECTURE.md` O8에서 지적한 것이 코드로 확인됐다.

```prisma
model TbS080Company {
  buildingId String @map("build_id")      // NOT NULL
  bizNumber  String? @unique @map("biz_number")
```

한 회사가 두 건물에 입주하면 회사 행이 두 개 필요한데 `biz_number` UNIQUE에 걸려 **등록 자체가 막힌다.** 건물이 1개라 아직 드러나지 않았다. `build_id`를 nullable로 낮추고 실제 소속은 `contracts.build_id`가 정한다.

## 4-3. 추가해야 할 컬럼

### 지시 항목 검증 결과

| 지시 항목 | 실제 상태 | 조치 |
|---|---|---|
| `billing_start_date` (무상기간) | **없음** | ✔ 추가 |
| `deposit_amount` (보증금) | **이미 있다** — `tb_s080_contracts.deposit int NOT NULL DEFAULT 0` | **추가 불필요.** 정산 로직도 이 컬럼을 쓴다 |
| `deposit_return_status` | **없음** — `tb_s080_settlements.deposit_return`은 *금액*이고 해지 시점에만 생긴다 | ✔ 추가 |
| `biz_info_snapshot` (사업자정보 스냅샷) | **없음** | ✔ 추가. 단 **jsonb 한 덩어리보다 컬럼군을 권장** |
| `renewed_from_contract_id` (재계약 FK) | **없음** | ✔ 추가 (자기참조) |

> **`deposit_amount`를 새로 만들면 안 된다.** 같은 뜻의 컬럼이 두 개가 되고 정산 로직(`contract-settlement.ts`)이 `deposit`을 읽으므로 조용히 0으로 계산된다.

### 추가 컬럼 명세

**`tb_s080_contracts`**

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `billing_start_date` | `date NULL` | CSCH-01 무상기간. 소급 입력 불가는 애플리케이션 검증 |
| `deposit_return_status` | `varchar(1) NULL` | CSCH-02. `H`보유 / `R`반환 / `D`차감 / `P`일부차감 |
| `contract_type` | `varchar(1) NOT NULL DEFAULT 'U'` | CONT-12. `U`이용계약 / `S`전대차. **화면(`ContractSubleaseModal`)은 이미 2종을 구분하는데 DB에 구분자가 없다** |
| `renewed_from_contract_id` | `text NULL` (자기참조 FK) | CSCH-04 |
| `created_by_s020_member_id` | `int NULL` | 범위 「본인 것만」 |
| **사업자정보 스냅샷 컬럼군** | 아래 | CSCH-03 |

스냅샷은 **컬럼군을 권장한다.** 세금계산서의 법적 요건이고, jsonb에 넣으면 검색·검증·마이그레이션이 전부 애플리케이션 책임이 된다.

```
snap_biz_number      varchar(10)   snap_company_name   text
snap_ceo_name        text          snap_address        text
snap_business_type   text          snap_business_item  text
snap_taken_at        timestamptz
```

**`tb_s080_reservations`**

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `created_by_s020_member_id` | `int NULL` | 범위 「본인 것만」 |
| `status` 값 확장 | — | `requested` · `rejected` 추가 (C6). 컬럼 변경 없이 CHECK만 |

**`tb_s080_companies`**

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `link_s020_org_id` | `int NULL UNIQUE` | ACL-01′. **FK 없음** (스키마 경계) |
| `link_linked_at` | `timestamptz NULL` | 연결 감사 |
| `link_linked_by` | `text NULL` | 연결 감사 |

**`tb_s080_members`**

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `link_s020_member_id` | `int NULL` | 명부 ↔ 삐용 계정 대조 |
| `initial_password` | — | **제거.** 계정 발급은 삐용. 평문 비밀번호 컬럼을 남기지 않는다 |

**`tb_s080_operator010`** (개명 후)

| 컬럼 | 타입 | 근거 |
|---|---|---|
| `link_s020_org_id` | `int NULL UNIQUE` | 운영사 식별 |

## 4-4. 새로 만들어야 할 테이블

### ★ 지시 항목 재해석 — `tb_s030_companies`는 만들면 안 된다

지시는 `tb_s030_companies`(ERP 조직, `link_s020_org_id` 포함) 신설을 요청했다. **그러나 `tb_s080_companies`(입주사, 9행)가 이미 그 자리다.**

둘 다 만들면 입주사 마스터가 두 벌이 되고, 계약·청구·예약이 어느 쪽을 가리키는지 갈린다. 그건 `SCHEMA_ANALYSIS.md` §4.1이 옵션 A를 "채택 불가"로 판정한 바로 그 이유다.

**권장: 컬럼 하나로 대체한다.**

```sql
ALTER TABLE public.tb_s080_companies ADD COLUMN link_s020_org_id integer;
ALTER TABLE public.tb_s080_companies
  ADD CONSTRAINT ux_s080_companies_link_s020_org UNIQUE (link_s020_org_id);
```

`ORG_ARCHITECTURE.md` §1-5가 같은 결론이고, `tb_s090_org010.link_s020_org_id`가 이 DB 안에 있는 선례다.

> 만약 지시의 의도가 **"입주사와 별개인 삐용 조직 매핑 전용 테이블"** 이라면 이름을 `tb_s080_org_link`로 바꿔 만든다. `tb_s030_` 접두어는 이번 지시의 "`tb_s080_*` 확장" 방향과 어긋나 계보가 또 하나 생긴다. 어느 쪽이든 **`companies`라는 이름은 쓰지 않는다.**

### 신규 테이블 3종

**① `tb_s080_contract_status_history` — CONT-11**

```
history_id        text PK
contract_id       text NOT NULL FK → tb_s080_contracts
from_status       varchar(1) NULL        -- 최초 생성은 NULL
to_status         varchar(1) NOT NULL
changed_at        timestamptz NOT NULL DEFAULT now()
changed_by        text                   -- 삐용 memberId 또는 시스템
reason            text NULL              -- 해지·취소 사유
INDEX (contract_id, changed_at DESC)
```

기존 코드에 이미 사유가 들어온다(`termination_reason`, 30자 제한). 지금은 계약 행에 **덮어쓰기**라 이력이 남지 않는다.

**② `tb_s080_auth_session` — ERP 세션** *(지시의 `tb_s030_session`)*

접두어를 `tb_s080_`으로 맞춘다. 이번 지시의 "`tb_s080_*` 확장" 방향을 따르는 것이고, 세션은 ERP 자체 자산이므로 위치가 같아야 한다.

```
sid                        text PK          -- 불투명 세션 ID의 SHA-256 해시. 원문 저장 안 함
s020_member_id             integer NOT NULL
s020_org_id                integer NOT NULL
bb_access_enc              text NOT NULL    -- 삐용 access (암호화)
bb_refresh_enc             text NOT NULL    -- 삐용 refresh (암호화)
bb_refresh_expires_at      timestamptz
issued_at                  timestamptz NOT NULL DEFAULT now()
last_seen_at               timestamptz
expires_at                 timestamptz NOT NULL
revoked_at                 timestamptz NULL
user_agent                 text NULL
ip                         inet NULL
INDEX (s020_member_id)
INDEX (expires_at)
```

`lib/crypto.ts`의 AES-GCM 구현을 그대로 쓴다. 삐용 access까지 보관하는 이유는 `/re-issue`가 access·refresh 둘 다를 요구하고 주체 3자 일치를 검사하기 때문이다.

**③ `tb_s080_acl_shadow_log` — ACL-08**

```
log_id           bigserial PK
occurred_at      timestamptz NOT NULL DEFAULT now()
s020_member_id   integer
s020_org_id      integer
screen_code      text                -- s030 화면 ID
action           text                -- VIEW | CREATE | UPDATE | DELETE
verdict          text                -- DENY | ALLOW_STALE | NO_GRANT_LIST
route            text
http_method      text
enforced         boolean             -- 이 시점에 실제로 막았는가
INDEX (occurred_at DESC)
INDEX (screen_code, occurred_at DESC)
```

DENY와 비정상 상태만 기록한다. ALLOW를 전량 남기면 로그가 데이터보다 커진다.

### 계약 확장 2종 (`SCHEMA_ANALYSIS.md` N1·N2 계승)

**④ `tb_s080_contract_items` — CONT-04/05 (최대 10행)**

```
item_id        text PK
contract_id    text NOT NULL FK
item_type      varchar(2) NOT NULL   -- RM호실 / PK주차 / LK사물함 / VO가상오피스 / DS전용데스크
space_id       text NULL FK          -- item_type='RM'일 때만
label          text                  -- "1-A호", "지하 3번"
quantity       int NOT NULL DEFAULT 1
unit_price     int NOT NULL
amount         int NOT NULL          -- 서버 재계산 근거
sort_order     int NOT NULL DEFAULT 0
INDEX (contract_id)
```

**⑤ `tb_s080_contract_users` — CONT-06 (최대 20명)**

```
contract_user_id  text PK
contract_id       text NOT NULL FK
member_id         text NULL FK → tb_s080_members
name              text NOT NULL
phone             text NULL
email             text NULL
INDEX (contract_id)
```

> `contracts.space_id`(단일 NOT NULL FK)는 **당장 지우지 않는다.** 항목 테이블로 옮긴 뒤 앱이 전환되면 그때 nullable로 낮춘다. 지금 지우면 기존 앱의 계약 등록·호실 중복 체크·점유 동기화가 한꺼번에 깨진다.

## 4-5. 상태 어휘 정리 — 확장 전에 끝낸다

CHECK 제약(C4)을 넣기 전에 §1-8의 두 어휘를 하나로 정한다.

**정본은 `schema.prisma` 주석이다.**

| 코드 | 뜻 | UI 어휘 (수정 후) |
|---|---|---|
| `P` | 계약대기 | `draft` |
| `A` | 계약중 | `active` |
| `E` | 만료 | `expired` |
| `S` | 중도해지 | `terminated` |
| `C` | 취소 | **`cancelled`** ← UI의 `terminated`를 여기서 떼어낸다 |

**조치 2건:**
1. `contracts/route.ts:15`와 `[id]/route.ts:196`의 중복 매핑 표를 **`lib/contract-status.ts` 한 곳으로** 합친다
2. `terminated → "C"`를 `cancelled → "C"` / `terminated → "S"`로 분리한다

**이건 [B] 재작성 범위 안에서 처리한다.** 기존 앱을 먼저 고칠 필요는 없다. 다만 CHECK 제약은 두 앱이 어휘를 합의한 뒤에 건다.

## 4-6. ★ 이동이 사라지면서 남는 보안 항목

`public` 32테이블 전부 `relrowsecurity = off`인데 `anon`·`authenticated`·`service_role` 세 역할에 전권이 부여돼 있다(87건, Supabase 기본 grant).

**anon 키만 있으면 브라우저에서 PostgREST로 계약·청구·회원 전체를 읽고 쓸 수 있다.** anon 키는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`로 **클라이언트 번들에 들어간다.**

D1 철회로 이 문제가 자동 해결되지 않으므로 별도 마이그레이션으로 닫는다.

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
-- service_role만 유지. 접근 경로는 Prisma/Fastify 한 곳으로 좁힌다
```

**선행 확인:** 기존 앱이 브라우저에서 Supabase 테이블을 읽지 않는지. §1-5 GREP 1 결과가 **0건**이므로 안전하다 — Supabase는 Auth와 Storage에만 쓴다. Storage 정책은 별도이므로 이 REVOKE에 영향받지 않는다.

## 4-7. 부수 보안 발견

| # | 사항 | 위험 | 조치 |
|---|---|---|---|
| 1 | `DEV_BYPASS_AUTH=true` 시 무인증 admin | 운영 배포 시 전면 개방 | 분기 코드 제거 |
| 2 | `/api/user/sync` 인증 없는 upsert | 임의 `User` 행 생성·덮어쓰기 | 라우트 폐기 |
| 3 | `tb_s080_members.initial_password varchar(20)` | **평문 비밀번호 컬럼** | 컬럼 제거 |
| 4 | `secrets/*.json` Google 서비스계정 키 | zip에 포함돼 전달됨 (`.gitignore`에는 있음) | 키 회전 권장 |
| 5 | `.env.local`에 `SUPABASE_SERVICE_ROLE_KEY`·`ENCRYPTION_SECRET` | zip에 포함돼 전달됨 | 값 회전 |
| 6 | `anon` 전권 grant | §4-6 | REVOKE |

> 4·5번은 파일 전달 방식의 문제이지 코드 결함이 아니다. 다만 **전달된 이상 회전이 맞다.**

---

# 5. 마이그레이션 순서

**전제:** 데이터는 시드 약 370행(`SCHEMA_ANALYSIS.md` §6.2). 운영 데이터가 아니다. 쓰는 앱은 기존 Next.js **하나뿐**이다. 이 조건에서만 아래 순서가 싸다.

## 5-0. 전제 작업

```bash
pg_dump -h 192.168.0.14 -p 54322 -U postgres -n public -Fc postgres > before_extend.dump
```

기존 앱 정지. 시드뿐이라 다운타임 제약 없음.

## 5-1. 단계

| # | 마이그레이션 | 내용 | 앱 영향 | 되돌리기 |
|---|---|---|:---:|:---:|
| **1** | `001_add_org_link.sql` | `companies.link_s020_org_id` + UNIQUE + 감사 2컬럼 / `operator010.link_s020_org_id` / `members.link_s020_member_id` | **없음** (nullable 추가) | 쉬움 |
| **2** | `002_add_indexes.sql` | C9 — `contracts.company_id`·`space_id`·`end_date`, `members.company_id`, `invoices.company_id`, `payments.company_id` | **없음** | 쉬움 |
| **3** | `003_contract_extend.sql` | `billing_start_date` · `deposit_return_status` · `contract_type` · `renewed_from_contract_id` · 스냅샷 7컬럼 · `created_by_s020_member_id` | **없음** | 쉬움 |
| **4** | `004_new_tables.sql` | `contract_status_history` · `contract_items` · `contract_users` · `auth_session` · `acl_shadow_log` | **없음** (신규) | 쉬움 |
| **5** | `005_revoke_public.sql` | §4-6 anon·authenticated REVOKE | **확인 필요** — GREP 1 결과 0건이라 안전 | 쉬움 |
| **6** | `006_rename_operator.sql` | `tenant_id` → `operator_id` 10테이블 + `text` 7건 `int` 통일 + FK 부여 + 복합 UNIQUE·인덱스 재작성 | **`schema.prisma` 수정 필요** | 중간 |
| **7** | `007_company_build_nullable.sql` | `companies.build_id` NOT NULL 해제 | **없음** | 쉬움 |
| **8** | `008_booking_integrity.sql` | `btree_gist` + `reservations` `EXCLUDE` 제약 + `start_at`/`end_at` `timestamptz` | **앱 수정 필요** — `FOR UPDATE` 잠금 제거 가능 | 어려움 |
| **9** | `009_status_check.sql` | 계약·예약·청구 상태 CHECK 제약 | **어휘 합의 후** (§4-5) | 중간 |
| **10** | `010_cleanup.sql` | `members.initial_password` 제거 · `ROOM_TP` 중복 12행 정리 · `User` 폐기(전환 완료 후) | 단계별 | — |

**1~5는 하루에 다 넣을 수 있다.** 전부 덧붙이는 변경이라 기존 앱이 존재조차 모른다. **이 다섯으로 `SCHEMA_ANALYSIS.md` 미충족 14건 중 10건이 해소된다.**

**6번이 유일한 조율 지점이다.** `schema.prisma`의 `@map` 12곳과 `parseInt(ctx.tenantId)` 164곳이 걸린다. 앱을 세우고 한 번에 처리한다.

**8·9는 뒤로 미룬다.** 8은 타임존 전환이 얽혀 가장 파괴적이고, 9는 두 앱의 어휘 합의가 선행이다.

## 5-2. 검증

각 단계 후:

```bash
node scripts/rowcounts.js .env        # 행 수 보존 확인
node scripts/inspect-deps.js .env     # 제약·인덱스 정합
```

6번 이후 추가로: 기존 앱 기동 → 계약 목록·상세·등록, 청구 목록, 예약 등록이 동작하는지 확인. 이 3개가 `tenant_id`를 가장 많이 쓴다.

---

# 6. 지금 바로 시작할 수 있는 것

우선순위 순. **삐용 회신 없이 전부 가능하다.**

| # | 작업 | 산출물 | 막히는 것 |
|---|---|---|---|
| **1** | 백업 + `001`~`004` 마이그레이션 작성·실행 | 조직 연결 · 인덱스 · 계약 확장 · 신규 5테이블 | 없음 |
| **2** | `005_revoke_public.sql` — anon 전권 차단 | 보안. **가장 급한 항목** | 없음 |
| **3** | `lib/` 순수 함수 4종 이관 (`contract-settlement` · `contract-invoices` · `reservation-validation` · `invoice-*`) + 테스트 37개 중 해당분 | 신규 Fastify 프로젝트의 도메인 코어 | 없음 |
| **4** | 스코프 헬퍼 + 격리 실패 테스트 4종 | `lib/scope/resolveCompany.ts`. §1-7이 뚫려 있는 자리 | 1번 |
| **5** | `BbiyongAcl` 인터페이스 + `MockBbiyongAcl` | 권한 규격 없이 전 화면 개발 가능 | 없음 |
| **6** | `getAuthContext()` 브리지 설계 (§2-4 A-1) | [A] 37개 라우트를 살리는 접합점 | 1번 (`auth_session` 테이블) |
| **7** | `lib/contract-status.ts` 단일화 + 어휘 분리 | §4-5. `009` CHECK 제약의 선행 | 없음 |
| **8** | `tb_cm_file` 조회 단일 헬퍼 + 부모 경유 검증 | 첨부파일 격리 사각지대 (§4-2) | 없음 |
| **9** | `006_rename_operator.sql` 작성 + `schema.prisma` 치환 | 격리축 혼동 제거 | 앱 정지 창 확보 |
| **10** | 랜딩·로그인 UI 이관 (`s0300500010` · `s0300000010`) | 디자인 완료 상태 | 없음 |

**2번이 가장 급하다.** anon 키가 클라이언트 번들에 들어가 있고 테이블 전권이 열려 있다. 운영 데이터가 들어가기 전에 닫는다. 코드 변경 없이 SQL 한 건이다.

**3번이 값어치가 가장 크다.** 정산·청구·예약 검증은 대표자 명세가 코드로 굳어 있고 테스트가 붙어 있다. 다시 만들면 그 명세를 다시 캐내야 한다.

---

# 7. 결정이 필요한 항목

분석으로는 못 정한다.

| # | 질문 | 막는 것 |
|---|---|---|
| 1 | **`tb_s030_companies`를 정말 새로 만드는가**, 아니면 `tb_s080_companies.link_s020_org_id` 컬럼으로 대체하는가 (§4-4) | 조직 연결 마이그레이션 |
| 2 | 기존 앱을 **흡수·동결·폐기** 중 무엇으로 하는가. 흡수라면 전환 기간 도메인별 소유 앱 배분 | [A] 37개 라우트의 운명 |
| 3 | `getAuthContext()` **브리지(A-1)를 채택하는가**. 채택하면 Supabase 경로를 언제 끊는가 | 법무·양식 빌더 25개 라우트 |
| 4 | 청구가 이미 완성된 상태에서 **"3차 분리"를 유지하는가** | 로드맵 |
| 5 | **법인설립·법인변경(4차)을 신규 ERP로 옮길 계획이 있는가**, 아니면 기존 앱에 영구히 두는가 | [A] vs [B] 재분류 |
| 6 | `operator_id` 개명 시 **Prisma 필드명까지 바꾸는가**(치환 164곳) | `006` 마이그레이션 범위 |
| 7 | 전달된 시크릿 4종(`secrets/*.json` · `SERVICE_ROLE_KEY` · `ENCRYPTION_SECRET` · anon 키) **회전 일정** | 보안 |

---

## 부록 — 재현 방법

```bash
SP="<scratchpad>/swonerp"
mkdir -p "$SP" && cd "$SP"
unzip -q /c/workspace/SwonBiz-erp/S-WonERP.zip

cd S-WonERP
find src/app/api -name route.ts | wc -l                     # 75
grep -rn "from('tb_s080\|from(\"tb_s080" src/ | wc -l       # 0
grep -rn "queryRaw\|executeRaw" src/app src/lib | wc -l     # 1
awk '/^model /{m=$2} /tenantId/{print m}' prisma/schema.prisma | sort -u
awk '/^model /{m=$2} /^  companyId/{print m}' prisma/schema.prisma | sort -u
```

**이번 세션에서 실행한 쓰기 작업: 없음.** DB 접속도 하지 않았다 — 전부 소스 직독이다.
