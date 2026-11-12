# ERP 인증·권한·스키마·API 통합 — Specification

**Created:** 2026-09-06
**Ambiguity score:** 0.11 (gate: ≤ 0.20)
**Requirements:** 19 locked
**Upstream:** `doc/ORG_ARCHITECTURE.md` · `doc/BACKEND_ANALYSIS.md` · `doc/SCHEMA_ANALYSIS.md` · `doc/지시_ERP_로그인_권한관리.md` · `.planning/research/BBIYONG-AUTH.md` · `doc/SWONBIZ_SCREEN_LIST.md`

---

## Goal

ERP는 자체 계정·자체 토큰·자체 권한 판정을 갖지 않고, 삐용(s02) JWT를 그대로 쓰며 화면 접근 판정을 매번 삐용에 위임한다. 기존 `tb_s080_*`(29테이블, S-WonERP 앱 소유)는 제자리에서 확장하고, 입주사 격리는 `company_id` 단일 축으로 애플리케이션과 DB(RLS) 양쪽에서 강제한다. 이 SPEC이 끝나면: (1) 실행 가능한 마이그레이션 SQL 4종이 `supabase/migrations/`에 존재하고, (2) 로그인·세션·권한판정 어댑터의 인터페이스와 3단계 롤아웃이 코드로 옮길 수 있는 수준까지 구체화돼 있고, (3) 기존 75개 API 라우트 전량이 재사용/재작성/폐기로 분류돼 있다.

## Background

**현재 저장소 상태**: `SwonBiz-erp`는 아직 애플리케이션 스캐폴드가 없다 — `src/app`도 `supabase/`도 없었다(이번 SPEC이 두 디렉터리를 처음 만든다). 있는 것은 설계 산출물(`design/*.dc.html` 11종), 화면 ID 체계 문서, 그리고 4건의 분석 문서(`ORG_ARCHITECTURE.md`·`BACKEND_ANALYSIS.md`·`SCHEMA_ANALYSIS.md`·`AUTH_ACL_RECONCILIATION.md`)다.

**실제 백엔드는 별도 저장소(`S-WonERP.zip`, Next.js 16 단일 앱)에 이미 존재하며 운영 중이다.** API 75개, Prisma 모델 31개, 테스트 37개. 계약·청구·예약·기준관리가 이미 동작하고, 인증은 Supabase Auth다. 이 앱의 DB(`public.tb_s080_*`)가 이번 SPEC이 확장하는 대상이다.

**트리거**: 삐용 팀 지시서(`지시_ERP_로그인_권한관리.md`, 2026-09-06)가 인증·권한 방식을 확정했다 — ERP는 화면만 만들고 판정은 전부 삐용에 묻는다. 이 확정으로 기존 Supabase Auth 기반 인증 코드 전량과, 격리 없이 쿼리스트링으로 `companyId`를 받던 기존 API 다수가 재작성 대상이 됐다.

**두 회귀 결정**: (1) `PROJECT.md`의 D1(테이블을 `tb_s030_t001`로 이동)이 이번 지시로 철회되고 `public.tb_s080_*` 제자리 확장으로 확정됐다. (2) 이 SPEC 자체가 요청받은 두 개체명 중 2건이 그 확정 방향과 충돌해 정정한다 — 아래 「정정 사항」 참조.

## ★ 확정된 방향 (변경 불가 — 이 세션 지시)

- DB: `tb_s080_*` 확장(기존 유지 + 필요한 것 추가). 신규 스키마·접두어 계보를 만들지 않는다. DB 접두어 정의(2026-10-22 결정) — `tb_s080_` = 공통 접두어. ERP 저장소의 표는 서비스(S03 ERP · S04 법무 · 공용 자료)와 상관없이 모두 `tb_s080_` 으로 만들고(세무 S05 는 `tb_s050_`), 어느 서비스 표인지는 표 설명(COMMENT)에 적는다. 삐용 `tb_s020_`(스키마 `tb_s020_t001`) · 메일 Agent `tb_s090_`(스키마 `tb_s090_t001`)은 그대로
- 화면 ID: `s030` 체계 유지 (`ORG_ARCHITECTURE.md` §5-1 기결정)
- 시스템 코드: `S03`
- 인증: 삐용 JWT 사용, ERP 자체 토큰 발급 없음
- 권한 판정: 삐용 API에 위임, ERP 자체 판정 없음
- 삐용 DB 직접 조회·조인·외래키 금지
- 입주사 격리축: `company_id` 단일 (`build_id`는 격리축이 아니다)
- `tenant_id` → `operator_id` 개명
- `tb_s080_companies`에 `link_s020_org_id` 컬럼만 추가 (별도 조직 테이블 신설 금지)
- `deposit_amount`는 이미 있음 — 새로 만들지 않음
- 재사용 순수 함수 3종(사용자 목록의 4번째는 3번째와 중복 표기, 파일은 3개다): `contract-settlement.ts` · `contract-invoices.ts` · `reservation-validation.ts` — 파일째 복사

## ★ 정정 사항 (요청 대비 3건 — 이유는 각 섹션에서 재설명)

| # | 요청 | 정정 | 근거 |
|---|---|---|---|
| 1 | `tb_s080_booking`에 EXCLUDE 제약 | **`tb_s080_reservations`** | 스키마에 `booking`이라는 이름의 테이블이 없다(`doc/existing_schema.sql` 확인). 회의실 예약 테이블은 처음부터 `tb_s080_reservations`다 |
| 2 | `tb_s030_session` 신규 생성 | **`tb_s080_auth_session`** | 이번 지시 자신이 "DB: tb_s080_* 확장"을 변경 불가로 못박았다. `tb_s030_*`를 쓰면 `BACKEND_ANALYSIS.md`가 경고한 "네 번째 계보"가 다시 생긴다 |
| 3 | 세션 컬럼에 `bbiyong_refresh_encrypted`만 | **`bbiyong_access_encrypted` 추가** | `BBIYONG-AUTH.md` §2.4 — 삐용 `/re-issue`는 access·refresh 토큰 **둘 다**를 요구하고 access·refresh·DB 세 곳의 memberId 일치를 검사한다. refresh만 저장하면 토큰 갱신 자체가 구현 불가능하다 |

이 3건은 요청의 정신(이 세션에서 확정된 방향)을 지키기 위한 정정이며, 스키마·기능 범위를 넓히지 않는다.

---

## Requirements

### SPEC 1 — 스키마

**1. `tb_s080_companies` 삐용 조직 연결**
- Current: `tb_s080_companies`에 삐용 조직을 가리키는 컬럼이 없다
- Target: `link_s020_org_id integer UNIQUE NULL` + 감사 컬럼 2개(`link_linked_at`, `link_linked_by`) 추가. FK 없음(스키마 경계)
- Acceptance: `supabase/migrations/001_add_columns.sql` 적용 후 `\d tb_s080_companies`에 3컬럼 확인. 같은 `link_s020_org_id` 값으로 두 번째 행 UPDATE 시 UNIQUE 위반으로 실패

**2. `tb_s080_contracts` 확장 컬럼 4종**
- Current: 무상기간·보증금 반환상태·사업자 스냅샷·재계약 이력을 표현할 컬럼이 없다(`deposit` 금액 컬럼만 기존에 있음)
- Target: `billing_start_date date` · `deposit_return_status varchar(1)`(CHECK `H/R/D/P`) · `biz_info_snapshot jsonb` · `renewed_from_contract_id text`(자기참조 FK, `ON DELETE SET NULL`) 추가
- Acceptance: 4컬럼 존재 확인. `deposit_return_status`에 `'X'` INSERT 시도 시 CHECK 위반으로 거부. `renewed_from_contract_id`에 존재하지 않는 `contract_id` INSERT 시 FK 위반으로 거부

**3. 계약 상태 이력 테이블**
- Current: 계약 상태 변경이 행을 덮어쓰기만 해서 이력이 남지 않는다(`BACKEND_ANALYSIS.md` §1-8)
- Target: `tb_s080_contract_status_history`(`history_id` PK, `contract_id` FK CASCADE, `from_status` nullable, `to_status` NOT NULL, `changed_by`, `changed_at`) 신규 생성
- Acceptance: 계약 1건 INSERT 후 이력 행을 수동 INSERT — FK로 연결되고 `contract_id, changed_at DESC` 인덱스로 조회 가능

**4. 만료 임박 조회 인덱스**
- Current: `tb_s080_contracts`에 `build_id` 인덱스만 있고 `end_date`는 미색인(SCHEMA_ANALYSIS.md C9)
- Target: `end_date` 단일 컬럼 인덱스 추가
- Acceptance: `EXPLAIN`으로 `WHERE end_date BETWEEN ... `쿼리가 인덱스 스캔을 쓰는지 확인

**5. ERP 세션 테이블**
- Current: ERP 세션을 저장할 테이블이 없다(정정 사항 #2·#3 반영)
- Target: `tb_s080_auth_session`(erp_sid 해시 PK, bbiyong_member_id, org_tp, org_id, bbiyong_access_encrypted, bbiyong_refresh_encrypted, expires_at, created_at, last_active_at, revoked_at) 신규 생성
- Acceptance: 세션 1건 INSERT/조회/`revoked_at` UPDATE가 전부 성공. `bbiyong_member_id` 인덱스로 조회 가능

**6. 회의실 예약 배타 제약**
- Current: `tb_s080_reservations`는 `INDEX(facility_id, start_at, end_at)`뿐이라 인덱스일 뿐 제약이 아니다 — 동시 요청에서 겹치는 예약이 통과할 수 있다(SCHEMA_ANALYSIS.md C2)
- Target: `btree_gist` 확장 + `EXCLUDE USING gist (facility_id WITH =, tsrange(start_at,end_at) WITH &&) WHERE (status='confirmed')` 추가
- Acceptance: 같은 `facility_id`·겹치는 시간·`status='confirmed'`인 두 번째 행 INSERT 시 `23P01 exclusion_violation`으로 실패. `status='cancelled'` 행과는 겹쳐도 성공

**7. anon/authenticated 전권 차단**
- Current: `public` 32테이블 전부 RLS off + `anon`·`authenticated`에 전권 grant(87건). `NEXT_PUBLIC_SUPABASE_ANON_KEY`가 클라이언트 번들에 있어 브라우저에서 직접 접근 가능
- Target: `anon`·`authenticated`에서 테이블·시퀀스·함수 권한 전량 REVOKE + `ALTER DEFAULT PRIVILEGES`로 향후 테이블도 자동 차단
- Acceptance: `anon` 역할로 접속해 임의 테이블 SELECT 시도 → `permission denied`

**8. company_id 기반 RLS**
- Current: DB 레벨 격리가 전혀 없다 — 애플리케이션 스코프 헬퍼가 유일한 방어선(단일 실패점)
- Target: BYPASSRLS 없는 `erp_app` 역할 신설. `contracts`·`invoices`·`payments`·`settlements`·`members`·`reservations` 6테이블에 RLS 활성화 + `company_id = current_setting('app.current_company_id')` 정책(operator는 전체 허용)
- Acceptance: `erp_app`으로 접속해 GUC 미설정 상태로 SELECT → 0건(fail-closed). `app.current_role='tenant'` + `app.current_company_id='X'` 세팅 후 SELECT → X사 행만. `app.current_role='operator'` 세팅 후 SELECT → 전체

**9. `tenant_id` → `operator_id` 개명 (조율 필요)**
- Current: 10개 테이블에서 `tenant_id`가 운영사(1행)를 가리키는데 이름은 "테넌트"라 입주사로 오인되기 쉽다. 7개 테이블은 `text` 타입에 FK도 없다
- Target: 컬럼명 `operator_id`로 통일 + `text`→`integer` 타입 통일 + `tb_s080_tenant010` 참조 FK 부여(9테이블, `public."User"` 제외)
- Acceptance: `information_schema.columns`에서 `tenant_id`가 `User` 1건만 남는다. 9테이블 전부 `operator_id integer` + FK 존재. **기존 S-WonERP 앱의 `schema.prisma` 수정 및 재기동 스모크 테스트 통과가 이 요구사항의 완료 조건에 포함된다** — DB 마이그레이션만으로는 미완료

### SPEC 2 — 인증

**10. 로그인 흐름**
- Current: 로그인 화면·API가 없다
- Target: ERP 로그인 화면 → 삐용 로그인 API 호출 → 응답에서 `memberId`·`orgId`·`orgTp` 추출 → `erp_sid`(랜덤 32바이트) 생성 → SHA-256 해시로 `tb_s080_auth_session`에 저장 → `HttpOnly Secure SameSite=Lax` 쿠키로 **해시하지 않은 원문 `erp_sid`만** 브라우저에 전달. 삐용 access/refresh 토큰은 서버에만 암호화 보관
- Acceptance: 로그인 성공 후 브라우저 쿠키에 삐용 토큰이 전혀 없음(개발자도구 Application 탭으로 확인). `tb_s080_auth_session`에 해당 세션 행 존재

**11. 홈 분기**
- Current: 없음
- Target: `org_tp='S'` → `/dashboard`. 그 외 → `/booking`. 접근 가능 화면이 0건이면 안내 화면(`AUTH-13`)
- Acceptance: Mock 계정 3종(운영사/입주사/미구독, 요구사항 12 참조)으로 각각 로그인 시 위 3개 목적지로 정확히 분기

**12. 토큰 갱신 — single-flight**
- Current: 없음
- Target: access 만료(30분) 감지 시 삐용 `/re-issue` 호출. 동시 요청은 인메모리 `Map` 기반 single-flight로 합친다. 실패(HTTP 200이어도 `body.status !== 200`인 경우 포함, BBIYONG-AUTH.md §2.4 함정 1) 시 세션 `revoked_at` 설정 + `/login` 리다이렉트
- Acceptance: 동일 `sid`로 동시 5회 갱신 요청 시 삐용 API가 정확히 1회만 호출됨(모킹으로 카운트 검증). 삐용 응답 `body.status=400`(HTTP 200)을 인위로 주입 시 갱신 실패로 처리됨

**13. Mock 로그인**
- Current: 없음
- Target: `BBIYONG_MOCK=true`일 때 실제 삐용 API를 호출하지 않고 고정 응답을 반환하는 `MockBbiyongAuth` 사용. 최소 3계정: `admin@s-wontech.co.kr`(운영사, `orgTp='S'`) · `tenant@test.com`(입주사, `orgTp≠'S'`, `link_s020_org_id` 연결됨) · **`noaccess@test.com`(입주사, 연결 안 됨 — AUTH-13 분기 테스트용, 요청에 없던 추가 계정)**
- Acceptance: `BBIYONG_MOCK=true` + 삐용 API 미기동 상태에서 3계정 전부 로그인 성공하고 각각 다른 홈으로 분기

**14. Fastify 세션 미들웨어**
- Current: 없음
- Target: 매 보호된 요청에서 쿠키의 `erp_sid`를 해시해 `tb_s080_auth_session` 조회(30초 인메모리 캐시, `revoked_at`은 캐시 우회) → 없거나 만료·폐기됐으면 401 → `req.session`에 `{ memberId, orgId, orgTp, companyId, role }` 주입. `companyId`는 `tb_s080_companies.link_s020_org_id = orgId` 역조회로 해석하며, 연결 없으면 `companyId=null`(빈 스코프)
- Acceptance: 세션 없이 보호된 라우트 호출 → 401. 유효 세션으로 호출 → `req.session.companyId`가 정확히 해석됨. 삐용 org에 연결된 입주사가 없는 세션 → `companyId=null`이고 목록 API가 0건 반환(예외 아님)

### SPEC 3 — 권한 판정

**15. BbiyongAcl 어댑터**
- Current: 없음
- Target: 인터페이스 `canAccess(screenCode, action, session): Promise<boolean>` + `getScope(session): Promise<{companyId, scopeType}>`. `BBIYONG_ACL_MODE` 환경변수로 `MockBbiyongAcl`/`HttpBbiyongAcl` 전환
- Acceptance: 두 구현이 동일 인터페이스를 만족(TypeScript 컴파일로 검증). `BBIYONG_ACL_MODE=http`인데 삐용 URL 미설정 시 기동 실패(fail-fast, 조용히 mock으로 폴백하지 않음)

**16. 3단계 롤아웃 + shadow 로그**
- Current: 없음
- Target: 1단계(Mock, 지금) — `canAccess`는 항상 `true` 반환 + `tb_s080_acl_shadow_log`에 시도 기록. 2단계(삐용 연동, 회신 후) — 실제 API 호출로 교체하되 여전히 shadow(기록만, 차단 안 함). 3단계(실제 차단, 안정화 후) — `false`면 403. **★ 데이터 스코프(`getScope`→`company_id` 필터)는 1단계부터 예외 없이 강제한다 — shadow는 화면 접근(`canAccess`)에만 적용되고 스코프에는 적용되지 않는다**
- Acceptance: 1단계에서 권한 없는 화면 접근 시 통과하되 `acl_shadow_log`에 1행 기록됨. 같은 1단계에서 다른 회사 `contract_id`로 직접 접근 시 404(스코프가 막음 — shadow 여부와 무관)

### SPEC 4 — API 구조

**17. [A] 재사용 라우트 — 인증 브리지**
- Current: 기존 S-WonERP의 `getAuthContext()`가 Supabase 세션만 읽는다
- Target: `getAuthContext()`에 분기 추가 — ERP 세션 쿠키(`erp_sid`)가 있으면 `tb_s080_auth_session` 기반으로 해석하고, 없으면 기존 Supabase 경로로 폴백(전환 기간 한정). 반환 타입(`AuthContext`)은 변경하지 않되 `role`은 표시용으로 강등(판정에 미사용)
- Acceptance: ERP 세션 쿠키만 있는 요청이 법인설립(`/api/incorporations`) 같은 [A] 라우트를 401 없이 통과. Supabase 세션만 있는 요청도 기존대로 통과(회귀 없음)

**18. [B] 재작성 대상 — Fastify 신규 모듈**
- Current: 계약·예약·기준관리·입주사 관리가 Next.js API Route(Supabase Auth 의존, 격리 없음)로만 존재
- Target: 아래 4개 도메인을 Fastify 신규 프로젝트에 재작성. 순수 함수 3종은 로직 변경 없이 파일째 복사, Route 껍데기만 새로 쓴다

| 도메인 | 대응 구 라우트 | 이관 방식 |
|---|---|---|
| 계약 | `/api/contracts`·`[id]`·`cancel`·`midterm`·`midterm-cancel`·`settlement-preview`·`check-room` | `lib/contract-settlement.ts`+`contract-invoices.ts` 파일째 복사, Route는 신규 |
| 회의실 예약 | `/api/reservations`·`[id]` | `lib/reservation-validation.ts` 파일째 복사, Route는 신규. `FOR UPDATE` 잠금은 요구사항 6의 EXCLUDE 제약이 검증되기 전까지 유지 |
| 기준관리 | `/api/admin/spaces/**`(11)·`/api/buildings`·`/floors`·`/spaces`·`/spaces/buildings`·`/spaces/status`·`/facilities` | 로직은 단순 CRUD라 이관 손실 적음. `company_id` 무관(운영사 자산) |
| 입주사 관리 | `/api/contracts/companies`·`/check-company`·`/check-biz-number`, 폐기된 `/api/tenants/[id]` 대체 | 신규 CRUD 표면 + `link_s020_org_id` 연결 UI(요구사항 1) 추가 |

- Acceptance: 4개 도메인의 모든 신규 엔드포인트가 `req.session.companyId` 스코프를 거치지 않고는 다른 회사 데이터를 반환하지 않음(요구사항 8의 RLS와 별개로 애플리케이션 레벨에서도 검증)

**19. [C] 폐기 대상**
- Current: `/api/auth/sign-out`·`/api/user/change-password`·`/api/user/role`·`/api/user/sync`·`/api/user/default-location`·`/api/tenants/[id]`(이미 410)와 `(auth)` 회원가입·재설정 화면, `settings/mfa*` 화면
- Target: 삭제. 로그아웃은 삐용 `sign-out` 호출로, 비밀번호 변경은 삐용 화면 링크로 대체
- Acceptance: 위 8개 경로 호출 시 404(라우트 자체가 존재하지 않음) 또는 명시적 안내 링크로 리다이렉트

---

## Boundaries

**In scope:**
- `supabase/migrations/001~004.sql` 4종 (001~003 즉시 적용 가능, 004 조율 후)
- 로그인·세션·토큰갱신·Mock 로그인의 인터페이스 설계 및 인증 흐름 시퀀스
- `BbiyongAcl` 어댑터 인터페이스 + Mock 구현 설계 + 3단계 롤아웃 정의
- 기존 75개 API 라우트 전량의 재사용/재작성/폐기 최종 분류
- `lib/constants.ts` 상수 12개 정의
- `company_id` 기반 DB 격리(RLS)와 애플리케이션 스코프 헬퍼의 역할 분담

**Out of scope:** (다음 항목들은 이 SPEC이 다루지 않는다 — 이유 포함)
- `HttpBbiyongAcl`·삐용 로그인 API의 **실제 구현 코드** — 삐용 팀 회신(⑦⑫⑮) 전까지 규격이 없어 구현 불가. Mock까지가 이번 범위
- Fastify 프로젝트의 실제 스캐폴딩(package.json·tsconfig 등) — 이 SPEC은 설계 문서이며 실행 가능한 산출물은 SQL 4종과 `lib/constants.ts`뿐. 스캐폴딩은 후속 execute 단계
- `contract_type`·`created_by_s020_member_id` 컬럼 추가 — `ORG_ARCHITECTURE.md`가 이전에 제안했으나 이번 지시의 SPEC 1 항목 목록에 없어 범위에서 제외. 필요하면 별도 마이그레이션(005 이후)으로
- 기존 S-WonERP 앱을 흡수·동결·폐기 중 무엇으로 할지의 **최종 결정** — SPEC 4는 "흡수"(A-1 브리지)를 전제로 설계했으나, 이는 `BACKEND_ANALYSIS.md` §7에 여전히 "결정이 필요한 항목"으로 남아 있다. 이 SPEC은 그 결정을 전제로 깔되 재확정하지 않는다
- `C1`(timestamp→timestamptz 전환)·`C4`(상태 CHECK 제약 전면) — 별도 후속 마이그레이션. 002가 만드는 EXCLUDE 제약은 현재 컬럼 타입(`timestamp without time zone`) 기준이며 C1 적용 시 재생성 필요함을 주석으로 남김
- 청구·수납(`invoices`/`payments`)·직원관리(`employees`)를 [B]로 재작성하는 것 — 사용자 SPEC 4가 명시한 4개 도메인에 포함되지 않아 [A] 유지. **다만 이 경우 기존 앱의 DB 연결이 계속 BYPASSRLS 권한(예: `service_role`)을 쓴다면 요구사항 8의 RLS가 이 두 도메인에는 적용되지 않는 구멍이 남는다 — Constraints에 기록**

## Constraints

- **RLS 우회 구멍**: 요구사항 8이 만드는 `erp_app`(비-BYPASSRLS)로 접속하는 것은 **신규 Fastify만**이다. 기존 S-WonERP 앱이 `service_role`이나 슈퍼유저로 계속 접속하면 그 경로로 조회되는 청구·수납·직원 데이터는 RLS의 보호를 받지 못한다. [A] 유지 대상 중 `company_id`를 가진 것(청구·수납)은 이 구멍의 실제 크기이며, 흡수 결정이 확정되면 기존 앱의 `DATABASE_URL`도 `erp_app`으로 바꾸는 후속 작업이 필요하다
- **004는 001~003과 다른 리듬으로 적용된다**: `supabase db push`/`migration up`을 무심코 실행하면 004까지 함께 적용되어 기존 앱이 즉시 깨진다. 004 파일 자체에 이 경고를 주석으로 박아 뒀다
- **삐용 회신 3건(⑦⑫⑮) 전까지 SPEC 2·3의 실제 URL·엔드포인트는 placeholder다** — `lib/constants.ts`의 `BBIYONG.*` 값 참조. 코드 구현은 Mock으로 시작해야 하며 이 SPEC이 그 경계를 명시한다
- 데이터 규모: 시드 약 370행(SCHEMA_ANALYSIS.md §6.2). 001~003의 비용 산정은 이 규모를 전제로 한다 — 운영 데이터 투입 후에는 004의 백필(`UPDATE ... SET operator_id = tenant_id::integer`)이 훨씬 무거워진다

## Acceptance Criteria

- [ ] `supabase/migrations/001_add_columns.sql` — psql로 빈 스키마 사본에 적용 시 에러 없이 COMMIT
- [ ] `supabase/migrations/002_new_tables.sql` — 001 적용 후 이어서 적용 시 에러 없이 COMMIT (사전검증 DO 블록이 겹치는 예약 0건 확인하고 통과)
- [ ] `supabase/migrations/003_revoke_public.sql` — 002까지 적용 후 이어서 적용 시 에러 없이 COMMIT
- [ ] anon 역할로 `tb_s080_contracts` SELECT 시도 → `permission denied`
- [ ] `erp_app`으로 GUC 미설정 상태 SELECT `tb_s080_contracts` → 0행
- [ ] `erp_app` + `app.current_role='operator'` SELECT → 전체 행
- [ ] `tb_s080_reservations`에 겹치는 `confirmed` 예약 INSERT 시도 → `23P01` 에러
- [ ] `lib/constants.ts`가 TypeScript 컴파일 통과 (`tsc --noEmit`)
- [ ] BbiyongAcl 인터페이스에 대해 `MockBbiyongAcl`이 타입 에러 없이 구현됨
- [ ] 75개 기존 라우트 전량이 [A]/[B]/[C] 표(요구사항 17~19)에서 정확히 1회씩 등장 (합계 75)
- [ ] `004_rename_tenant.sql`이 `supabase/migrations_hold/`에 있고(자동 적용 경로 밖), 파일 최상단에 "단독 적용 금지" 경고 주석 존재

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                              |
|--------------------|-------|------|--------|-------------------------------------|
| Goal Clarity       | 0.93  | 0.75 | ✓      | 3개 산출물(SQL·인터페이스·분류표)이 구체적이고 검증 가능 |
| Boundary Clarity   | 0.88  | 0.70 | ✓      | in/out 명시. 단 "흡수 vs 동결" 최종결정은 전제로만 깔림(Out of scope에 명기) |
| Constraint Clarity | 0.85  | 0.65 | ✓      | RLS 우회 구멍·004 리듬·회신 대기 3건을 명시적으로 기록 |
| Acceptance Criteria| 0.90  | 0.70 | ✓      | 11개 pass/fail 체크박스, 전부 SQL 실행 또는 컴파일로 검증 가능 |
| **Ambiguity**      | **0.11** | ≤0.20 | ✓  | |

## Interview Log

이 SPEC은 신규 Socratic 인터뷰를 진행하지 않았다 — 사용자의 이번 요청 자체가 이미 5개 하위 SPEC(스키마·인증·권한·API·상수)의 정확한 필드명·값·파일 위치까지 지정한 완결된 요구사항이며, 그 근거가 되는 조사(BBIYONG-AUTH.md, SCHEMA_ANALYSIS.md, BACKEND_ANALYSIS.md)가 선행 세션에서 이미 끝나 있었다. 대신 실제 DB DDL(`doc/existing_schema.sql`)과 대조해 사실 오류 3건을 찾아 정정했다(위 「정정 사항」 표).

| Round | Perspective | Question summary | Decision locked |
|-------|-------------|-------------------|------------------|
| — | Researcher (사전 조사, 선행 세션) | 삐용 JWT 구조·`tb_s080_*` 실제 컬럼·기존 앱 인증 방식 | `ORG_ARCHITECTURE.md`·`BACKEND_ANALYSIS.md`에 전부 기록됨 |
| — | 사실 대조 (이번 세션) | 요청한 `tb_s080_booking`·`tb_s030_session`이 실제 스키마·확정방향과 일치하는가 | 불일치 3건 발견 → 정정(위 표) |
| — | Boundary Keeper (암묵) | 청구·직원을 [B]에 넣을지 | 사용자가 SPEC 4에서 4개 도메인만 명시 → [A] 유지하되 RLS 우회 구멍을 Constraints에 기록 |

---

*Spec created: 2026-09-06*
*Next step: 이 저장소는 GSD ROADMAP.md phase 구조를 쓰지 않으므로 `/gsd:discuss-phase`로 자동 연결되지 않는다. 대신 아래 §6 우선순위대로 직접 실행하거나, `/gsd:new-project`로 ROADMAP.md를 먼저 만든 뒤 이 SPEC을 phase 0 입력으로 재사용할 수 있다.*

---

# 부록 A. 지금 바로 시작할 수 있는 것 (우선순위 순)

전부 삐용 팀 회신 없이 진행 가능하다.

| # | 작업 | 위치 | 의존성 |
|---|---|---|---|
| 1 | `001_add_columns.sql`·`002_new_tables.sql` 개발 DB에 적용 + 검증 | `supabase/migrations/` | 없음 (백업 선행) |
| 2 | `003_revoke_public.sql` 적용 — anon 전권 차단 | 동일 | 1번 |
| 3 | `erp_app` 역할 비밀번호 설정 (파일 밖, 수동) | 운영 절차 | 2번 |
| 4 | `contract-settlement.ts`·`contract-invoices.ts`·`reservation-validation.ts` 3종을 `S-WonERP/src/lib/`에서 신규 Fastify 프로젝트로 파일째 복사 + 테스트 동반 이관 | 신규 저장소 | 없음 |
| 5 | `MockBbiyongAuth`·`MockBbiyongAcl` 구현 (요구사항 13·15) | 신규 저장소 | 없음 |
| 6 | `getAuthContext()` 브리지 구현 (요구사항 17) | S-WonERP 앱 | 1번(`tb_s080_auth_session` 필요) |
| 7 | Fastify [B] 4개 도메인 스캐폴딩 착수 (요구사항 18) | 신규 저장소 | 4·5번 |
| 8 | `lib/constants.ts`·`lib/screens.ts` → `packages/shared/src/`로 이동 | 현 저장소(모노레포, 2026-09-06 D-3) | 워크스페이스 스캐폴딩 |
| 9 | `004_rename_tenant.sql` 초안을 두고 앱 정지 창 일정 조율 | 운영 절차 | 6번 완료 후가 안전(브리지가 먼저 붙어 있어야 전환 중 회귀를 즉시 감지) |

**1~3번이 가장 급하다.** anon 키가 이미 클라이언트 번들에 있고 테이블 전권이 열려 있다 — 운영 데이터 투입 전에 반드시 닫는다.

# 부록 B. 삐용 팀 회신 대기 항목

`ORG_ARCHITECTURE.md` §6-4에서 이어지는 것 중 이 SPEC 실행에 직접 걸리는 것만 추린다.

| # | 항목 | 이 SPEC의 어디가 막히는가 |
|---|---|---|
| **⑦** | 로그인 API 정확한 요청/응답 규격(필드명·타입) | 요구사항 10 — `lib/constants.ts`의 `BBIYONG.LOGIN_PATH`는 추정 경로(BBIYONG-AUTH.md 근거)이며 실제 앱 계약(app-level contract) 확정 아님 |
| **⑫** | 접근 가능 화면 **목록** 조회 엔드포인트 규격 | 요구사항 15 — `HttpBbiyongAcl` 구현 자체가 불가능. Mock까지만 가능 |
| **⑮** | 대시보드·설정 등 공통 화면을 어느 S03 모듈에 붙이는가 | 요구사항 11 — 홈 분기의 "운영사→/dashboard" 판정이 화면 권한 기반(ORG_ARCHITECTURE §3-4 원안)이 아니라 `org_tp` 기반으로 단순화된 이유가 바로 이 미확정 때문. 회신 오면 화면 권한 기반으로 정교화 가능 |
| ⑤ | 가동계 `code010`의 access/refresh TTL 실값 | 요구사항 5 — `tb_s080_auth_session.expires_at` 계산 기준(현재는 7일 폴백 가정) |
| ⑩ | 겸직 지원 여부 (`member010.org_id` 단일 컬럼) | 요구사항 10 — 2단계 로그인(조직 선택) 필요 여부. 현재 SPEC은 겸직 미지원(1단계 로그인만)을 가정 |
| ⑭ | refresh 회전 도입 시점 | 요구사항 12 — 지금은 인메모리 single-flight로 충분하나, 회전 켜지기 전 분산 잠금(Redis) 전환 필요 |

이 6건 중 **⑦·⑫가 최우선**이다 — 나머지는 이미 결정된 기본값(가정)으로 개발을 진행할 수 있지만, 이 둘이 없으면 Mock을 실제 삐용 API로 교체하는 2단계 자체가 시작되지 않는다.
