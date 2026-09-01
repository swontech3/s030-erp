# 삐용(s02) JWT 분석 및 ERP 인증 통합 설계

**분석일:** 2026-09-01
**대상:** `s02-back.zip` (Spring Boot, Java 11, Gradle 멀티모듈 — app / client / core / domain / store)
**신뢰도:** HIGH — 실제 소스 코드 직독. 추정이 아님
**해소된 Blocking Unknown:** REQUIREMENTS.md의 1·2·3·4·5번

> 시크릿 키 값은 이 문서에 기록하지 않는다. 아래 모든 `***` 는 의도적으로 가린 값이다.

---

## 1. 분석한 파일

| 파일 | 역할 |
|---|---|
| `domain/…/common/security/JwtTokenProvider.java` | 토큰 생성·검증·갱신의 핵심. 알고리즘·만료·클레임이 전부 여기 |
| `domain/…/common/security/JwtAuthenticationFilter.java` | 요청 헤더에서 토큰 추출, 401 응답 |
| `domain/…/common/security/JwtAuthenticationProvider.java` | 이메일·비밀번호 검증 |
| `domain/…/logic/s021/S021200010Logic.java` | 로그인 1·2단계, refresh 토큰 저장, 로그아웃 |
| `domain/…/logic/comm/AuthLogic.java` | access 토큰 재발급(검증 4단) |
| `domain/…/vo/comm/TokenVo.java` | `token010` 행 구조 |
| `domain/…/dto/s021/S021200010Dto.java` | 로그인 요청·응답 DTO |
| `app/…/config/WebSecurityConfiguration.java` | 인증 제외 경로, CORS |
| `app/src/main/resources/mybatis/mapper/comm/TokenMapper.xml` | `token010` DDL 수준 정보와 운영 정책 |
| `app/src/main/resources/application{,-dev,-prod}.yml` | jwt 섹션 |
| `client/…/controller/comm/AuthController.java` | 재발급·로그아웃 엔드포인트 |

---

## 2. 확인 항목 답변

### 2.1 서명 알고리즘 — **HS256 (대칭키)**

```java
// JwtTokenProvider 생성자
byte[] keyBytes = Decoders.BASE64.decode(secretKey);
this.key = Keys.hmacShaKeyFor(keyBytes);
...
.signWith(key, SignatureAlgorithm.HS256)
```

- **RS256이 아니다.** 공개키가 없고 JWKS 엔드포인트도 없다
- 시크릿은 **Base64로 인코딩된 문자열**을 디코드해 HMAC 키로 쓴다 — 검증 측도 반드시 Base64 디코드 후 사용해야 한다
- 발급되는 3종 토큰(access / refresh / 조직선택 임시)이 **모두 같은 키, 같은 알고리즘**을 쓴다

| 환경 | 시크릿 출처 | 상태 |
|---|---|---|
| dev | `application-dev.yml` → `jwt.secretkey: ***` | ⚠️ **평문이 저장소에 커밋되어 있다** (Base64 문자열 48자) |
| prod | `application-prod.yml` → `jwt.secretkey: ${PROD_JWT_SECRET}` | 환경변수. 올바름 |

### 2.2 토큰 만료 시간

우선순위가 3단계다 — **DB 코드테이블 → yml → 자바 기본값**.

```
tb_s020_t001.tb_s020_code010  (category='000', org_id=0)
  ├ cd_tp='JWT_EXPIRE_ACCESS'
  └ cd_tp='JWT_EXPIRE_REFRESH'
        ↓ 없거나 범위 밖이거나 조회 실패
application.yml  jwt.access-token-expire-seconds: 1800    (30분)
                 jwt.refresh-token-expire-seconds: 604800 (7일)
        ↓ 키 자체가 없으면
자바 @Value 기본값 (동일: 1800 / 604800)
```

| 토큰 | 기본 만료 | 설정 가능 |
|---|---|---|
| access | **1800초 = 30분** | code010 / yml |
| refresh | **604800초 = 7일** | code010 / yml |
| 조직선택 임시 | **180초 = 3분** | ❌ 자바 상수 하드코딩 (`SELECT_TOKEN_EXPIRE_TIME`) |

주의할 동작 2가지:

- **허용 범위 방어**: 60초 미만 또는 30일 초과 값은 오타로 보고 무시하고 폴백을 쓴다
- **기동 후 최초 1회만 DB를 읽고 메모리에 캐시한다** (`ensureExpireLoaded`) — **만료 시간을 바꾸면 삐용 재기동이 필요하다.** ERP가 삐용 TTL을 런타임에 추적할 수단은 없다

### 2.3 페이로드 클레임 구조

#### access token

```json
{ "sub": "1234", "auth": "C", "exp": 1756...  }
```

| 클레임 | 값 | 비고 |
|---|---|---|
| `sub` | **memberId** (정수를 문자열화) | ⚠️ 이메일이 아니다. 코드 주석: *"이메일은 단체별 중복 가능"* |
| `auth` | 권한 문자열 | `GrantedAuthority`들을 **구분자 없이** `joining()`으로 이어붙임. 2단계 로그인 경로에서는 `memberTp` 한 글자 |
| `exp` | 만료 (초) | |

**없는 것: `iss`, `aud`, `iat`, `nbf`, `jti`, `orgId`, `email`, `orgName`.**

#### refresh token

```json
{ "sub": "1234", "jti": "uuid-v4", "exp": 1756... }
```

- `auth` 클레임이 없다 → API 인증에 쓸 수 없다 (`getAuthentication`이 `RuntimeException`을 던짐)
- `jti`는 2026-08-17에 추가됨. 이유: 같은 회원이 같은 밀리초에 두 기기에서 로그인하면 토큰 문자열이 완전히 동일해져 유니크 제약 위반이 나기 때문

#### 조직 선택 임시 토큰 (2단계 로그인 1단계 산출물)

```json
{ "sub": "orgSelect", "candidates": "1234,5678,9012", "exp": <3분 후> }
```

- `sub`가 리터럴 `"orgSelect"` 고정
- `candidates`는 비밀번호 검증을 통과한 후보 memberId를 콤마로 이은 문자열 — 2단계에서 남의 memberId로 바꿔치기하는 것을 막는 용도
- `auth`가 없어 일반 API 인증에 쓸 수 없다

#### ⚠️ 가장 중요한 구조적 사실 — **orgId는 JWT 어디에도 없다**

`orgId`는 **로그인 응답 본문**에만 있다:

```json
// POST /rest/v1/s021200010/sign-in  (또는 /sign-in-org) 성공 응답의 data
{
  "memberId": 1234, "email": "...", "memberName": "...",
  "memberTp": "C",
  "orgId": 42, "orgName": "...", "orgTp": "S",
  "mailAgentYn": "N",
  "accessToken": "eyJ...", "refreshToken": "eyJ..."
}
```

이게 가능한 이유는 **memberId가 (회원, 조직) 쌍마다 별개이기 때문**이다. 같은 이메일이 여러 조직에 각각 다른 memberId로 존재하고, 조직 선택은 곧 memberId 선택이다. 따라서 **memberId가 orgId를 함축한다.**

ERP 입장에서의 의미: **삐용 access 토큰만으로는 조직을 알 수 없다.** 조직 정보는 로그인 시점에 응답 본문에서 받아 ERP가 직접 보관해야 한다.

### 2.4 리프레시 토큰 처리 방식

**엔드포인트**: `GET /rest/v1/auth/re-issue?access-token={at}&refresh-token={rt}` (`permitAll`)

**검증 4단** — 하나라도 어긋나면 거부:

1. refresh 토큰의 서명·형식·만료
2. `SHA-256(refreshToken)` hex 64자로 `token010` 대조 — 서버가 발급했고 아직 살아있는 세션인가
3. `token010` 행의 `expire_timestamp` 재확인 (JWT와 별개로)
4. **access · refresh · DB 세 곳의 memberId 일치** — 이게 없으면 자기 refresh에 남의 access를 붙여 권한 상승이 가능하다

**회전(rotation)을 하지 않는다.** 갱신 시 access만 새로 만들고 refresh는 들어온 것을 그대로 돌려준다. 코드 주석에 명시된 이유:

> 프론트 401 자동 재발급은 화면 하나가 API를 여러 개 동시에 쏘는 구조라, 같은 refresh 토큰으로 동시에 이 함수를 부른다. 회전하면 첫 요청만 성공하고 나머지는 거부 → 강제 로그아웃. **회전은 프론트에 single-flight를 넣은 뒤 8/22 이후에 얹는다.**

→ **ERP는 처음부터 회전을 전제로 설계해야 한다.** 지금은 회전이 없어 동시 갱신이 안전하지만, 삐용이 나중에 회전을 켜는 순간 single-flight 없는 클라이언트는 즉시 깨진다.

**응답 형식의 함정 2가지:**

- **실패해도 HTTP 200이다.** 본문의 `status`가 400이다. 코드 주석: *"삐용 관례상 401은 인증 필터 전용이고 업무 실패는 200 + 본문 코드"*. → **HTTP 상태코드로 성공을 판정하면 안 된다**
- 성공 응답의 `email` 필드에는 이메일이 아니라 **memberId**가 들어간다 (레거시 필드명). `refreshTokenDurationDays`도 이름과 달리 **밀리초**다

**알려진 한계 (코드 주석에 명시):** 새 access 토큰의 `auth` 클레임은 들어온 access 토큰의 것을 그대로 복사한다. → **권한(`member_tp`)이 바뀌어도 재로그인 전까지 반영되지 않는다.**

### 2.5 token010 테이블의 역할

**테이블**: `tb_s020_t001.tb_s020_token010`

| 컬럼 | 내용 |
|---|---|
| `token_id` | PK |
| `member_id` | 소유자 |
| `org_id` | **조직 ID — JWT에는 없지만 이 행에는 있다** |
| `refresh_token_hash` | **SHA-256 hex 64자. 원문은 저장하지 않는다.** 유니크 인덱스 `ux_token010_hash` |
| `jti` | UUID. 기기·세션 구분 |
| `expire_timestamp` | refresh 만료. JWT 파싱 없이 SQL만으로 정리하기 위해 중복 저장 |
| `issue_timestamp` | 발급 시각 |
| `last_use_timestamp` | 마지막 갱신 시각 |
| `create_program_id` | 발급 경로. 로그인은 리터럴 `'S021200010'` |
| `update_program_id` | 갱신은 `'AUTH_REISSUE'` — 발급과 갱신을 행 하나로 구분 |

**역할 4가지:**

1. **발급된 refresh 세션의 화이트리스트** — 여기 없는 refresh 토큰은 서명이 맞아도 거부된다
2. **로그아웃에 의한 즉시 무효화** — `POST /rest/v1/s021200010/sign-out`, 헤더 `refresh-token`. **해시 정확 일치 1행만 하드 DELETE**. `member_id`를 조건에 쓰지 않는 이유는 memberId만 아는 사람이 남의 세션을 끊는 인증 없는 DoS를 막기 위함
3. **기기별 동시 세션 관리** — 회원당 최대 **5개**(`MAX_TOKENS_PER_MEMBER`). 초과 시 오래된 것부터 삭제
4. **만료 행 정리** — 별도 배치 없이 로그인·갱신 때 해당 회원 행만 청소

**결정적 한계: access token은 token010에 없다.** 즉 **access 토큰은 만료 전까지 무효화할 수 없다.** 로그아웃해도 이미 발급된 access 토큰은 최대 30분간 유효하다.

> `AuthController`의 `GET /rest/v1/auth/logout?email=` 은 Redis만 지우는 레거시다. 실제 로그아웃은 `POST /rest/v1/s021200010/sign-out`이다.

---

## 3. 예상하지 못한 발견 — 삐용에 이미 조직 관계·권한 체계가 있다

`s020_*` 테이블 목록에서 확인된 것:

```
tb_s020_org010            조직
tb_s020_org_relation010   조직 간 관계  ★
tb_s020_org_module010     조직별 모듈 구독
tb_s020_module010         모듈 정의
tb_s020_member010         회원
tb_s020_member_role010    회원-역할
tb_s020_role010           역할
tb_s020_role_menu010      역할-메뉴
tb_s020_role_tmpl010      역할 템플릿
tb_s020_role_tmpl_menu010 역할 템플릿-메뉴
tb_s020_menu010           메뉴
tb_s020_menu_func010      메뉴-기능
tb_s020_token010          세션
tb_s020_code010           공통코드
```

이것이 `SWONBIZ_PROJECT_STRUCTURE.md` §8에서 *"별도 권한 시스템(13테이블·모듈 구독·역할 템플릿)과의 경계 확정 후"* 로 미뤄둔 바로 그 시스템이다. **가정이 아니라 이미 가동 중이다.**

### 3.1 `org_relation010` — 운영사↔입주사 관계가 이미 존재한다

```sql
tb_s020_org_relation010
  provider_org_id   -- 제공자 (운영사)
  consumer_org_id   -- 소비자 (입주사)
  relation_tp       -- 'OFFICE' | 'TAX' | 'LEGAL'
  start_date, end_date, use_yn
```

코드 주석: *"계약 유형은 OFFICE(입주) / TAX / LEGAL 중 하나여야 합니다"*, *"「미입주」는 표현할 자리가 없다 — 입주한 적 없는 회사는 OFFICE 행이 없는 것"*.

### 3.2 `org_tp = 'S'` = 운영사

주석에서 확인: *"Y = 운영사(org_tp='S')만 구독 가능"*, *"제공자 화면은 org_tp<>'S' 조직에게 내려보내지 않는다"*.

### 3.3 `member_tp` 코드값

| 값 | 의미 | 근거 |
|---|---|---|
| `C` | 조직 대표 / 관리자 | `"④ 대표(member_tp='C')에게 관리자 역할 부여"`, `MEMBER_TP_ORG_ADMIN` |
| `R` | (미확인, 정렬 우선순위 2번째) | `CASE MEMBER_TP WHEN 'C' THEN 0 WHEN 'R' THEN 1 WHEN 'E' THEN 2 ELSE 3 END` |
| `E` | 회계담당자 | `"E(지급대기) : 회계담당자 → MEMBER_TP='E' (단체당 1명 운영)"` |
| 그 외 | 일반 | 2단계 로그인에서 null이면 `'N'` |

### 3.4 ERP 스키마에 미치는 영향

이 발견은 **STEP 3 [B] 질문 1의 선택지를 바꾼다.** 원래 "(c) s020_* 계정 + s030_* 프로필 분리"가 유력했지만, 조직·조직관계까지 이미 있다면 `s030_org`와 `s030_tenant`가 `s020_org010`·`s020_org_relation010`과 상당 부분 중복된다.

STEP 3에서 별도로 다룰 결정 사항으로 넘긴다. 이 문서는 인증 설계까지만 다룬다.

---

## 4. ERP 인증 통합 설계

### 4.1 핵심 판단 — **ERP는 삐용 시크릿을 받지 않아도 된다**

리서치 단계에서 "삐용이 시크릿/공개키를 공유해줄 것인가"를 Blocking Unknown 2번으로 두었다. 코드를 읽고 나니 **이 질문 자체가 불필요하다.**

근거:

1. 브라우저는 삐용 토큰을 절대 보유하지 않는다 (설계 결정). 따라서 ERP가 **신뢰할 수 없는 출처로부터 삐용 토큰을 받는 경로가 없다**
2. ERP가 삐용 토큰을 얻는 유일한 경로는 **자기가 TLS로 삐용 로그인 엔드포인트를 호출해서** 받는 것이다. 그 응답은 이미 TLS로 무결성이 보장된다
3. ERP에 필요한 정보(`memberId`, `orgId`, `orgTp`, `memberTp`, `orgName`)는 **전부 응답 본문에 있다.** 토큰을 파싱할 필요조차 없다
4. ERP는 자체 시크릿으로 자기 세션 토큰을 발급하고, 매 요청에는 그것만 검증한다

즉 서명 검증은 **이미 신뢰하는 채널로 방금 받은 데이터를 한 번 더 확인하는 것**이라 보안상 얻는 게 거의 없는 반면, 대칭키를 두 시스템에 복제하는 비용은 실재한다. HS256에서 시크릿 사본이 하나 늘어난다는 것은 **토큰을 위조할 수 있는 주체가 하나 늘어난다**는 뜻이다.

| 방식 | 시크릿 필요 | 위조 가능 주체 | 권장 |
|---|---|---|---|
| **A. 응답 본문 신뢰 + ERP 자체 세션** | ❌ | 삐용만 | ✅ **권장** |
| B. 삐용 토큰 서명 검증 후 ERP 세션 | ✅ | 삐용 + ERP | 방어적 심화가 필요할 때만 |
| C. 매 요청 삐용 토큰 직접 검증 | ✅ | 삐용 + ERP | ❌ orgId가 토큰에 없어 애초에 불가 |

**C가 불가능한 이유를 다시 강조한다** — 삐용 access 토큰에는 `orgId`가 없고 `iss`/`aud`도 없다. 매 요청 그 토큰만 검증해서는 **어느 조직 소속인지 알 수 없어 테넌트 격리가 성립하지 않는다.**

만료 시각이 필요하면 서명 검증 없이 `exp`만 디코드하면 된다 — 시크릿 불필요.

### 4.2 전체 흐름

```
브라우저                    Next.js (erp.swonbiz.com)                  삐용 (bbiyong.s-wontech.co.kr)
   │                                  │                                        │
   │─ POST /api/auth/login ──────────▶│                                        │
   │   {email, pwd}                   │─ POST /rest/v1/s021200010/sign-in ────▶│
   │                                  │◀─ 200 {needOrgSelect:true,             │
   │                                  │        selectToken, candidates[]}       │
   │◀─ 200 {needOrgSelect, orgs[]} ───│  selectToken → 서버 세션(3분)에 보관    │
   │   ※ selectToken은 브라우저에      │                                        │
   │      내려보내지 않는다            │                                        │
   │                                  │                                        │
   │─ POST /api/auth/select-org ─────▶│                                        │
   │   {memberId}                     │─ POST /rest/v1/s021200010/sign-in-org ▶│
   │                                  │   {selectToken(서버 보관분), memberId}  │
   │                                  │◀─ 200 {memberId, orgId, orgTp,         │
   │                                  │        memberTp, accessToken,           │
   │                                  │        refreshToken}                    │
   │                                  │                                        │
   │                          ┌───────┴────────┐                               │
   │                          │ s030_org_member 조회 → tenantId, erp_role      │
   │                          │ s030_session INSERT (삐용 refresh 암호화 저장) │
   │                          │ ERP 세션 JWT 발급 (ERP 자체 시크릿)            │
   │                          └───────┬────────┘                               │
   │◀─ Set-Cookie: erp_session ───────│                                        │
   │   httpOnly Secure SameSite=Lax   │                                        │
   │                                  │                                        │
   │─ GET /api/contracts ────────────▶│ (또는 브라우저 → Fastify 직접)          │
   │                                  │                                        │
   │                            Fastify: ERP 세션 JWT만 검증                    │
   │                            삐용 시크릿 없음. 삐용 호출 없음                 │
```

**삐용을 호출하는 코드는 Next.js Route Handler 안에만 존재한다.** Fastify는 삐용을 모른다.

### 4.3 왜 CORS 문제가 없는가

- `swonbiz.com`과 `s-wontech.co.kr`은 **eTLD+1이 다르다** → 쿠키 공유는 어떤 설정으로도 불가능. 애초에 시도하지 않는다
- 브라우저가 삐용을 직접 호출하지 않으므로 **CORS preflight가 발생하지 않는다**
- 참고로 삐용의 현재 CORS 설정은 `addAllowedOriginPattern("*")` + `setAllowCredentials(true)` 라서 브라우저 직접 호출도 "되기는" 한다. 그래도 **하면 안 된다** — 그러면 삐용 refresh 토큰이 브라우저에 놓이고, 다른 도메인의 자격증명을 ERP 프런트가 들고 있게 된다

### 4.4 세션 TTL 정렬

| 항목 | 값 | 근거 |
|---|---|---|
| 삐용 access | 30분 (code010로 변경 가능, 재기동 필요) | 삐용 소스 |
| 삐용 refresh | 7일 | 삐용 소스 |
| **ERP 세션 JWT** | **15분** | 삐용 access(30분)보다 짧게 — 권한 변경 반영 주기를 ERP가 스스로 제어 |
| **ERP 세션 행 (`s030_session`)** | **7일** (삐용 refresh와 동일) | 삐용 refresh가 죽으면 ERP 세션도 죽어야 함 |
| 조직 선택 대기 | **3분** | 삐용 임시 토큰과 동일하게 강제 |

ERP 세션 JWT를 15분으로 짧게 두는 이유: 삐용의 재발급 경로가 `auth` 클레임을 그대로 복사해 **권한 변경이 반영되지 않는다.** ERP가 15분마다 `s030_org_member`를 다시 읽으면 ERP 역할 변경은 최대 15분 안에 반영된다.

`s030_session` 테이블:

| 컬럼 | 용도 |
|---|---|
| `session_id` (uuid, PK) | ERP 세션 JWT의 `sid` 클레임 |
| `bbiyong_member_id` | 삐용 memberId |
| `bbiyong_org_id` | 삐용 orgId |
| `tenant_id`, `erp_role` | 발급 시점 매핑 결과 |
| `bbiyong_refresh_enc` | 삐용 refresh 토큰 (**암호화 저장**) |
| `bbiyong_access_enc` | 삐용 access 토큰 (재발급 시 4단 검증에 필요) |
| `bbiyong_refresh_expires_at` | |
| `expires_at`, `revoked_at`, `last_seen_at` | |

> 삐용 access 토큰까지 보관해야 하는 이유: `/re-issue`가 access와 refresh **둘 다**를 요구하고, 주체 3자 일치를 검사하기 때문이다.

### 4.5 Fastify 검증 훅

```ts
// lib/auth/session.ts — 단일 진입점. 이 파일 밖에서 jwtVerify를 부르지 않는다 (lint로 강제)
import { jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'

const ERP_SECRET = new TextEncoder().encode(requireEnv('ERP_SESSION_SECRET'))
const ISS = 'erp.swonbiz.com'
const AUD = 'erp-api'

export const SessionClaims = z.object({
  sub:      z.string().min(1),            // 삐용 memberId (문자열)
  sid:      z.string().uuid(),            // s030_session.session_id
  tid:      z.number().int().nullable(),  // ERP tenant_id — 운영사는 null
  role:     z.enum(['operator', 'tenant']),
  oid:      z.number().int(),             // 삐용 orgId
  iss:      z.literal(ISS),
  aud:      z.literal(AUD),
  exp:      z.number(),
  iat:      z.number(),
})
export type SessionClaims = z.infer<typeof SessionClaims>

export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, ERP_SECRET, {
    algorithms: ['HS256'],   // ★ 허용 목록 고정 — alg:none·알고리즘 혼동 차단
    issuer:     ISS,
    audience:   AUD,
    clockTolerance: 5,       // Java 서버와의 시계 오차 흡수
  })
  return SessionClaims.parse(payload)   // 클레임 모양까지 검증
}
```

```ts
// Fastify 플러그인
import fp from 'fastify-plugin'

declare module 'fastify' {
  interface FastifyRequest { identity: SessionClaims }
}

export default fp(async (app) => {
  app.decorateRequest('identity', null)

  app.addHook('onRequest', async (req, reply) => {
    if (isPublicRoute(req.routeOptions.url)) return

    const token = req.cookies.erp_session
    if (!token) return reply.code(401).send({ code: 'NO_SESSION' })

    let claims: SessionClaims
    try {
      claims = await verifySession(token)
    } catch {
      return reply.code(401).send({ code: 'INVALID_SESSION' })
    }

    // 세션 행 확인 — 로그아웃·강제 만료를 즉시 반영한다.
    // 짧은 TTL 캐시(30초)를 두어 요청마다 DB를 때리지 않는다.
    const live = await sessionCache.get(claims.sid)
    if (!live || live.revokedAt) return reply.code(401).send({ code: 'SESSION_REVOKED' })

    req.identity = claims   // ★ tenantId·role은 오직 여기서만 읽는다
  })
})
```

**규칙 3가지 — 코드 리뷰가 아니라 자동 검사로 강제한다:**

1. `req.identity` 외의 출처(쿼리·바디·헤더)에서 `tenantId`·`role`을 읽지 않는다
2. 테넌트 스코프 테이블은 공용 스코프 헬퍼를 통해서만 조회한다
3. `jwtVerify` 호출은 `lib/auth/session.ts` 안에만 존재한다

### 4.6 갱신 (single-flight)

```ts
// Next.js Route Handler — Node 런타임. Edge 아님
const inflight = new Map<string, Promise<Result>>()

async function refreshSession(sid: string) {
  const existing = inflight.get(sid)
  if (existing) return existing              // ★ 동시 갱신 합치기

  const p = doRefresh(sid).finally(() => inflight.delete(sid))
  inflight.set(sid, p)
  return p
}

async function doRefresh(sid: string) {
  const s = await loadSession(sid)
  if (!s || s.revokedAt) throw new SessionGone()

  const url = new URL('/rest/v1/auth/re-issue', BBIYONG_BASE)
  url.searchParams.set('access-token',  decrypt(s.bbiyongAccessEnc))
  url.searchParams.set('refresh-token', decrypt(s.bbiyongRefreshEnc))

  const res  = await fetch(url, { method: 'GET' })
  const body = await res.json()

  // ★ 삐용은 실패해도 HTTP 200을 준다. 본문 status로 판정한다.
  if (!res.ok || body.status !== 200) throw new SessionGone(body.message)

  // ★ refreshToken은 회전되지 않아 그대로 돌아오지만, 응답값을 그대로 저장한다.
  //   삐용이 나중에 회전을 켜도 이 코드는 그대로 동작한다.
  await updateSession(sid, {
    bbiyongAccessEnc:  encrypt(body.data.accessToken),
    bbiyongRefreshEnc: encrypt(body.data.refreshToken),
  })

  // ERP 역할을 다시 읽는다 — 삐용 재발급은 권한을 갱신하지 않으므로 ERP가 스스로 한다.
  const { tenantId, role } = await resolveMembership(s.bbiyongMemberId, s.bbiyongOrgId)
  return mintErpSession({ ...s, tenantId, role })
}
```

> **인메모리 `Map`은 단일 인스턴스에서만 유효하다.** Next.js를 여러 인스턴스로 띄우면 Redis 기반 잠금으로 바꿔야 한다. 지금은 삐용이 회전을 하지 않아 중복 갱신이 무해하므로 인메모리로 시작해도 되지만, **삐용이 회전을 켜기 전에 반드시 분산 잠금으로 교체해야 한다.**

### 4.7 로그아웃

```
1. s030_session.revoked_at = now()      ← ERP 세션 즉시 무효화
2. POST 삐용 /rest/v1/s021200010/sign-out
   헤더: refresh-token: <복호화한 삐용 refresh>
3. erp_session 쿠키 삭제
```

2번이 실패해도 1·3번은 진행한다 — ERP 세션만 끊겨도 사용자는 로그아웃된 것이다. 다만 삐용 세션은 남으므로 로그를 남긴다.

### 4.8 홈 분기

```ts
// middleware.ts — 인가가 아니라 UX 게이트일 뿐이다 (CVE-2025-29927)
// 진짜 차단은 Fastify가 한다
const claims = await verifySessionEdgeSafe(cookie)   // jose는 Edge에서도 동작
if (!claims)                     return redirect('/login?redirect=' + pathname)
if (SCREENS[id]?.role === 'operator' && claims.role !== 'operator')
                                 return redirect('/booking')
```

로그인 직후 홈: `role === 'operator'` → `/dashboard`, `'tenant'` → `/booking`.

---

## 5. 역할 매핑 — 결정됨 (2026-09-01)

### 5.1 결정: ERP는 `s020_*` 를 참조하지 않는다

한때 `org_relation010(relation_tp='OFFICE')` 을 ERP 입주사 판정에 재사용하는 방향을 검토했으나 **취소한다.**

**사유 — 두 org는 다른 개념이다.**

| | 삐용 `s020_org010` | ERP `s030_tenant` |
|---|---|---|
| 정의 | **삐용 서비스를 구독하는 회사** | **공유오피스에 입주한 회사** |
| 집합 관계 | 서로 부분집합이 아니다. 겹치는 회사도 있고 아닌 회사도 있다 |
| 생성 주체 | 삐용 가입 절차 | ERP 운영사의 입주 계약 |

두 개념을 한 테이블로 묶으면 "삐용은 쓰는데 입주하지 않은 회사"와 "입주했는데 삐용은 안 쓰는 회사"가 같은 공간에 섞인다. 어느 쪽도 지울 수 없고, 조회마다 필터가 하나 더 붙으며, 그 필터를 한 번만 빠뜨려도 데이터가 샌다.

**보강 근거 — 애초에 담을 수도 없다.**

`tb_s020_org010` 의 실제 컬럼은 `ORG_ID, ORG_NAME, ORG_CODE, ORG_TP, COUNTRY_CODE, TIMEZONE, ZIP_CODE, ADDRESS, DETAIL_ADDRESS, TEL_NO, MAIL_AGENT_YN` + 감사 컬럼이다.

**삐용 전체 소스에 `사업자등록번호`·`biz_no` 류 컬럼이 하나도 없다** (전수 검색 결과 0건). ERP는 사업자등록번호가 필수다 — 계약서 출력에 들어가고(CONT-13), 중복 등록을 막아야 하며(TNNT-04), 3차 세금계산서는 **계약 시점 사업자정보 스냅샷**에 법적으로 묶인다(CSCH-03). 삐용 org를 입주사 마스터로 쓰면 이 값을 둘 곳이 없다.

**부수 효과 — 배포 결합이 사라진다.** 삐용 DB는 사설망 자체호스팅이다(`192.168.0.14:55322/postgres`, 스키마 `tb_s020_t001`). ERP가 같은 인스턴스를 쓰는지는 미확정이었는데, 참조하지 않기로 하면서 이 질문 자체가 배포 선택의 문제로 내려간다. 스키마 설계를 막지 않는다.

### 5.2 채택 구조

`s020_*` 에서 가져오는 것은 **신원뿐이고, 그것도 로그인 응답 본문을 통해서만** 가져온다. 테이블 조회는 하지 않는다.

```
삐용에서 오는 것 (로그인 응답 본문)      ERP가 소유하는 것 (s030_*)
─────────────────────────────────      ────────────────────────────
memberId   ← 인증 주체                  s030_org        운영사 (ERP 소유)
orgId      ← 삐용 조직 (식별자로만)      s030_tenant     입주사 (ERP 소유, 사업자번호 포함)
memberTp   ← 참고용                     s030_org_member 삐용 신원 → ERP 역할·소속 매핑
orgName    ← 참고용
```

**`s030_org_member` 가 유일한 접합점이다.**

```
(bbiyong_member_id, bbiyong_org_id)  →  (erp_role, org_id | tenant_id)
```

- `erp_role = 'operator'` → `org_id` 를 가리킨다 (`tenant_id` 는 null)
- `erp_role = 'tenant'` → `tenant_id` 를 가리킨다 (`org_id` 는 null)
- 행은 **운영사가 ERP 화면에서 직접 등록한다.** 삐용 데이터로부터 자동 유도하지 않는다
- `bbiyong_org_id` 는 **외래키가 아니라 단순 정수**다. 스키마 간 FK를 걸면 삐용의 DELETE 가 ERP 제약에 막혀 "읽기 전용 참조"라는 전제가 깨진다

### 5.3 남는 결과 — 입주사 로그인 경로

이 결정의 논리적 귀결을 명시해 둔다. **ERP는 계정을 발급하지 않고 삐용 계정만 재사용하므로, 삐용 계정이 없는 입주사 담당자는 ERP에 로그인할 수 없다.**

1차 범위에서 이것이 문제가 되는지는 운영 정책 결정 사항이다 (아래 §7 참조).

---

## 6. 삐용 팀에 전달할 사항

분석으로 해소된 것 (질문 불필요): 서명 알고리즘, 만료 시간, 클레임 구조, 리프레시 방식, token010 역할, **그리고 시크릿 공유 요청 자체**.

**여전히 확인이 필요한 것:**

| # | 항목 | 왜 필요한가 |
|---|---|---|
| 1 | 가동계 `code010`에 `JWT_EXPIRE_ACCESS`/`JWT_EXPIRE_REFRESH` 행이 실제로 있는가, 값은? | 없으면 30분/7일 폴백. ERP 세션 TTL 결정에 필요 |
| 2 | refresh 회전을 언제 켤 계획인가 | ERP의 분산 잠금 도입 시점 |
| 3 | ERP 로그인 대상 계정을 삐용에 어떻게 만들 것인가 | §5.3 — 삐용 계정이 없는 입주사 담당자는 ERP에 로그인할 수 없다 |

`member_tp` 값의 의미, `org_module010` 모듈 코드, `org_relation010` 활용 여부는 **§5.1 결정으로 질문이 소멸했다** — ERP는 삐용의 조직·권한 체계를 쓰지 않는다.

**보고할 보안 사항 (ERP와 무관하게 삐용 자체 이슈):**

| # | 사항 | 위험 |
|---|---|---|
| 1 | dev 시크릿이 `application-dev.yml`에 평문 커밋 | 저장소 접근자가 개발계 토큰을 임의 위조 가능 |
| 2 | `/re-issue`가 **GET 쿼리스트링**으로 access·refresh를 받음 | 토큰이 액세스 로그·프록시 로그·`Referer`·브라우저 히스토리에 남음. POST 바디 또는 헤더로 옮길 것 |
| 3 | CORS `addAllowedOriginPattern("*")` + `allowCredentials(true)` | 임의 출처에서 자격증명 포함 요청 가능 |
| 4 | access 토큰에 `iss`/`aud` 없음 | 같은 시크릿을 쓰는 다른 용도 토큰과 구분 불가 |
| 5 | `auth` 클레임을 `split("")`로 **글자 단위** 분해 | 권한 코드가 2글자 이상이 되는 순간 조용히 깨짐 |
| 6 | access 토큰은 무효화 수단이 없음 (token010에 없음) | 로그아웃 후에도 최대 30분 유효 |

---

## 7. REQUIREMENTS.md Blocking Unknowns 갱신

| # | 기존 항목 | 결과 |
|---|---|---|
| 1 | 서명 알고리즘 | ✅ **해소 — HS256** |
| 2 | 시크릿 공유 여부·경로 | ✅ **불필요해짐** — ERP는 삐용 시크릿을 받지 않는다 (§4.1) |
| 3 | 클레임 이름·타입 | ✅ **해소** — access `sub`/`auth`/`exp`, refresh `sub`/`jti`/`exp`, 임시 `sub`/`candidates`/`exp`. **orgId는 JWT에 없고 로그인 응답 본문에 있다** |
| 4 | TTL·리프레시 회전 정책 | ✅ **해소** — 30분/7일(변경 가능), **회전 없음**. 단 가동계 code010 실값은 확인 필요(§6-1) |
| 5 | `org_id` ↔ ERP 입주사 자동 매칭 | ✅ **해소 — 자동 매칭하지 않는다** (§5.1). 삐용 org와 ERP 입주사는 다른 개념이므로 `s030_org_member`에 운영사가 수동 등록한다 |
| 6 | 한 입주사의 동시 복수 계약 | ⬜ 미해소 — 운영 결정 |
| 7 | 사업자/개인 정책 3건 | ⬜ 미해소 — 사업 결정 |
| **8** | **삐용 계정 없는 입주사 담당자의 로그인 경로** (신규, §5.3) | ⬜ 미해소 — 운영 결정 |

---
*분석 완료: 2026-09-01*
