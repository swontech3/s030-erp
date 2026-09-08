# 삐용(s02) 인증 모듈 보안 점검 결과

**작성일:** 2026-09-01 (7번 항목 2026-09-08 추가)
**작성 배경:** SwonBiz ERP(s030)가 삐용 JWT 인증을 재사용하기 위해 `s02-back` 소스를 분석하는 과정에서 확인된 사항입니다. ERP 연동과 무관하게 삐용 자체에 해당하는 내용만 추렸습니다.
**분석 방법:** 소스 코드 정독. 실제 공격 시도나 운영 환경 접근은 하지 않았습니다.
**대상 리비전:** 전달받은 `s02-back.zip` 기준

> 이 문서에는 시크릿 값 원문을 싣지 않았습니다. 아래 `***` 는 의도적으로 가린 값입니다.

---

## 요약

| # | 사항 | 심각도 | 조치 난이도 |
|---|---|---|---|
| 1 | 개발계 시크릿·비밀번호가 저장소에 평문 커밋 | **높음** | 중 (키 교체 필요) |
| 2 | 토큰 재발급이 GET 쿼리스트링으로 토큰을 받음 | **높음** | 낮음 |
| 3 | CORS가 모든 출처에 자격증명 포함 요청 허용 | **중간** | 낮음 |
| 4 | access 토큰에 `iss`·`aud`가 없음 | 중간 | 낮음 |
| 5 | 권한 클레임을 글자 단위로 분해 | 중간 (잠재) | 낮음 |
| 6 | access 토큰을 만료 전에 무효화할 수단이 없음 | 낮음~중간 | 높음 |
| 7 | `init-pwd` 가 인증·본인확인 없이 비밀번호를 바꿈 | **높음** | 중 |

1·2번은 빠르게 처리할 가치가 있습니다. 특히 **2번은 코드 몇 줄 수정으로 끝나는 데 비해 노출 범위가 넓습니다.**

**7번은 2026-09-08 추가분입니다**(로그인 API 규격 회신을 받아 연동을 구현하는 과정에서 확인). 이 문서에서 유일하게 **비밀번호를 모르는 외부인이 계정을 가져갈 수 있는** 경로라, 1·2번보다 먼저 보셔야 할 수 있습니다.

---

## 1. 개발계 시크릿·비밀번호가 저장소에 평문 커밋 — 심각도 높음

**위치**

```
app/src/main/resources/application-dev.yml:22   primarypassword: ***      (DB 비밀번호)
app/src/main/resources/application-dev.yml:25   secretkey: ***            (JWT 서명 키, Base64 48자)
app/src/main/resources/application-dev.yml:30   service-role-key: ***     (Supabase service_role JWT)
```

**무엇이 문제인가**

JWT 시크릿은 HS256 대칭키입니다. 이 값을 아는 사람은 **임의의 내용을 담은 유효한 토큰을 직접 만들 수 있습니다.** `sub`에 아무 memberId나, `auth`에 `'C'`(대표)를 넣어 서명하면 개발계에서 그 사람으로 인증됩니다. 비밀번호를 몰라도 됩니다.

Supabase `service_role` 키는 **RLS를 전부 우회**합니다. 스토리지와 DB에 무제한 접근이 가능합니다.

**가동계는 올바르게 되어 있습니다** (`application-prod.yml` — `${PROD_JWT_SECRET}`, `${PROD_DB_USERNAME}`, `${PROD_SUPABASE_SERVICE_ROLE_KEY}`). 문제는 개발계뿐입니다.

**다만 개발계라고 넘길 수 없는 이유 3가지**

1. 개발계에도 실제와 유사한 데이터가 들어 있는 경우가 많습니다
2. 저장소 접근 권한과 개발계 접근 권한은 보통 다르게 관리됩니다. 저장소를 볼 수 있는 모든 사람이 개발계 관리자 권한을 갖게 됩니다
3. **git 이력에 남습니다.** 지금 파일에서 지워도 과거 커밋에는 그대로 있습니다

**권장 조치**

1. 개발계 JWT 시크릿·DB 비밀번호·service_role 키를 **새 값으로 교체**합니다 (파일에서 지우는 것만으로는 이미 노출된 값이 무효화되지 않습니다)
2. `application-dev.yml`도 가동계와 같이 환경변수 참조로 바꿉니다
3. 저장소가 외부에 공개된 적이 있다면 git 이력 정리(`git filter-repo` 등)를 검토합니다. 내부 전용이었다면 키 교체만으로 충분합니다

---

## 2. 토큰 재발급이 GET 쿼리스트링으로 토큰을 받음 — 심각도 높음

**위치**

```java
// client/.../controller/comm/AuthController.java:18-19
@GetMapping("/re-issue")
public ResponseEntity<?> reIssueToken(@RequestParam("access-token") String accessToken,
                                      @RequestParam("refresh-token") String refreshToken) {
```

실제 호출 형태:

```
GET /rest/v1/auth/re-issue?access-token=eyJhbGci...&refresh-token=eyJhbGci...
```

**무엇이 문제인가**

URL은 본문과 달리 여기저기에 기록으로 남습니다. **refresh 토큰은 7일짜리 자격증명**이라 한 번 새면 그 기간 내내 그 사람으로 로그인할 수 있습니다.

| 남는 곳 | 설명 |
|---|---|
| 웹서버·WAS 액세스 로그 | 기본 로그 포맷이 전체 URL을 기록합니다 |
| 리버스 프록시·로드밸런서 로그 | 같은 이유 |
| 브라우저 히스토리 | 프런트가 브라우저에서 직접 호출하면 남습니다 |
| `Referer` 헤더 | 그 페이지에서 외부 리소스를 부르면 URL이 함께 전송됩니다 |
| APM·모니터링 도구 | URL을 트랜잭션 이름으로 수집합니다 |
| 브라우저 캐시 / 중간 캐시 | GET은 캐시 가능한 메서드입니다 |

게다가 이 엔드포인트는 `permitAll`이라 인증 없이 접근 가능하며, **GET이므로 CSRF로 유발시키기도 쉽습니다.**

**권장 조치**

```java
@PostMapping("/re-issue")
public ResponseEntity<?> reIssueToken(
        @RequestHeader("Authorization")  String bearer,        // access
        @RequestHeader("refresh-token")  String refreshToken)  // refresh
```

- **POST로 변경**하고 토큰은 **헤더 또는 본문**으로 받습니다
- 로그아웃(`/sign-out`)이 이미 `@RequestHeader("refresh-token")` 방식을 쓰고 있으므로 **같은 관례로 맞추면 됩니다**
- 전환 기간이 필요하면 기존 GET을 한동안 유지하되 `@Deprecated` 표시 후 제거합니다

동일한 문제가 `AuthController:24`의 `GET /rest/v1/auth/logout?email=` 에도 있습니다. 이 엔드포인트는 Redis만 지우는 레거시로 보이며(실제 로그아웃은 `S021200010.signOut`), **이메일을 URL에 노출**하고 **인증 없이 남의 이메일로 호출 가능**합니다. 사용처가 없다면 삭제를 권합니다.

---

## 3. CORS가 모든 출처에 자격증명 포함 요청 허용 — 심각도 중간

**위치**

```java
// app/.../config/WebSecurityConfiguration.java:127-130
configuration.addAllowedHeader("*");
configuration.addAllowedOriginPattern("*");
configuration.addAllowedMethod("*");
configuration.setAllowCredentials(true);
```

**무엇이 문제인가**

`allowCredentials(true)`와 `allowedOrigin("*")`의 조합은 브라우저 표준이 금지합니다. 그래서 Spring은 `addAllowedOriginPattern`을 제공하는데, 이것은 **요청한 Origin을 그대로 되비추는(reflect)** 방식으로 우회합니다. 결과적으로 **어떤 출처의 페이지든 쿠키·인증 헤더를 포함해 삐용 API를 호출할 수 있습니다.**

현재 삐용은 세션 쿠키가 아니라 `Authorization` 헤더를 쓰므로 고전적인 CSRF 위험은 낮습니다. 그래도 안전망을 하나 빼둔 상태이고, 나중에 쿠키 인증을 도입하면 즉시 실제 취약점이 됩니다.

**권장 조치**

허용 출처를 명시합니다.

```java
configuration.setAllowedOrigins(List.of(
    "https://bbiyong.s-wontech.co.kr",
    "https://erp.swonbiz.com",          // ERP 연동 시
    "http://localhost:3000"             // 개발계에서만
));
configuration.setAllowedMethods(List.of("GET","POST","PUT","DELETE","OPTIONS"));
configuration.setAllowedHeaders(List.of("Authorization","Content-Type","refresh-token"));
configuration.setAllowCredentials(true);
```

환경별로 다른 목록이 필요하므로 `application-{env}.yml`로 빼는 것을 권합니다.

> **참고:** SwonBiz ERP는 브라우저에서 삐용을 직접 호출하지 않고 서버 간 통신만 하도록 설계했습니다. 따라서 **ERP 때문에 CORS를 열어둘 필요는 없습니다.**

---

## 4. access 토큰에 `iss`·`aud`가 없음 — 심각도 중간

**위치**: `JwtTokenProvider.java` — `buildAccessToken`(246~255행), refresh 생성(325~333행), `generateOrgSelectToken`(200~207행)

세 토큰 모두 `setIssuer`·`setAudience`·`setIssuedAt` 호출이 없습니다. 현재 클레임은 이것뿐입니다.

```
access  { sub, auth, exp }
refresh { sub, jti, exp }
임시    { sub: "orgSelect", candidates, exp }
```

**무엇이 문제인가**

같은 시크릿으로 서명된 토큰이라면 **용도가 달라도 서로 구분되지 않습니다.** 지금은 세 종류를 `sub`나 클레임 유무로 우연히 구분하고 있습니다.

- refresh 토큰이 access 자리에 오면 → `auth`가 없어 `getAuthentication`이 `RuntimeException` (막히긴 하나 500 응답)
- 임시 토큰(3분)도 마찬가지로 `auth`가 없어 막힙니다
- 하지만 **나중에 같은 시크릿으로 다른 용도의 토큰(예: 메일 인증 링크, 파일 다운로드 토큰)을 하나라도 추가하면**, 그 토큰이 access 토큰으로 통과할 여지가 생깁니다

`iat`이 없어 **토큰 발급 시각을 알 수 없다**는 문제도 있습니다. 사고 조사 시 "언제 발급된 토큰인가"를 답할 수 없습니다.

**권장 조치**

```java
.setIssuer("bbiyong")
.setAudience("bbiyong-api")     // 토큰 종류별로 다르게: bbiyong-api / bbiyong-refresh / bbiyong-org-select
.setIssuedAt(new Date(now))
```

검증 측에도 `requireIssuer`·`requireAudience`를 추가합니다.

```java
Jwts.parserBuilder()
    .setSigningKey(key)
    .requireIssuer("bbiyong")
    .requireAudience("bbiyong-api")
    .build()
```

**배포 순서 주의:** 검증을 먼저 켜면 기존에 발급된 토큰이 전부 무효가 되어 **전원이 로그아웃됩니다.** 발급에만 먼저 추가하고 access 만료(30분) + refresh 만료(7일)가 지난 뒤 검증을 켜는 2단계 배포를 권합니다.

---

## 5. 권한 클레임을 글자 단위로 분해 — 심각도 중간 (잠재)

**위치**

```java
// JwtTokenProvider.java:246-248  — 생성 시: 구분자 없이 이어붙임
String authorities = authentication.getAuthorities().stream()
        .map(GrantedAuthority::getAuthority)
        .collect(Collectors.joining());          // ← 구분자 없음

// JwtTokenProvider.java:362       — 검증 시: 글자 단위로 쪼갬
Arrays.stream(claims.get(AUTHORITIES_KEY).toString().split(""))
```

**무엇이 문제인가**

`split("")`은 문자열을 **한 글자씩** 나눕니다. 현재 `member_tp`가 `'C'`·`'R'`·`'E'`·`'N'` 한 글자라서 우연히 동작하고 있습니다.

앞으로 이런 일이 생기면 조용히 깨집니다.

| 상황 | 결과 |
|---|---|
| 권한 코드를 두 글자로 늘림 (`"CA"`) | 권한이 `"C"`, `"A"` 두 개로 분해됨 |
| 한 사람에게 권한 두 개 부여 (`"C"` + `"E"`) | 생성 시 `"CE"` → 검증 시 `"C"`,`"E"`로 분해 (우연히 맞음) |
| `ROLE_ADMIN` 같은 표준 형식 도입 | 10글자짜리 권한 10개로 분해 — 완전히 깨짐 |

**예외를 던지지 않고 조용히 잘못된 권한 집합을 만든다**는 점이 위험합니다. 배포 후 한참 뒤에 "권한이 이상하다"로 발견됩니다.

**권장 조치**

명시적 구분자를 씁니다.

```java
.collect(Collectors.joining(","))          // 생성
...
.split(",")                                // 검증
```

기존 토큰과의 호환을 위해 검증 측에서 한동안 둘 다 처리하거나, 4번과 같은 2단계 배포로 넘깁니다.

---

## 6. access 토큰을 만료 전에 무효화할 수단이 없음 — 심각도 낮음~중간

**현재 구조**

`tb_s020_token010`은 **refresh 토큰만** 관리합니다(`refresh_token_hash` 유니크). access 토큰은 어디에도 기록되지 않습니다.

따라서:

- 로그아웃해도 이미 발급된 access 토큰은 **만료(기본 30분)까지 계속 유효**합니다
- 계정을 정지시켜도 마찬가지입니다
- 권한을 낮춰도 마찬가지이고, 재발급 경로가 `auth` 클레임을 그대로 복사하므로 **재로그인 전까지는 옛 권한이 유지됩니다** (이 부분은 코드 주석에도 알려진 한계로 기록되어 있습니다)

**평가**

이것은 stateless JWT를 쓰는 시스템의 일반적인 트레이드오프이고, 30분이라는 창은 업계 기준으로 과하지 않습니다. **설계 결함이라기보다 인지하고 관리할 특성**에 가깝습니다.

**선택지 (필요할 때만)**

| 방법 | 비용 | 효과 |
|---|---|---|
| access 만료를 5~15분으로 단축 | 낮음 (`code010` 값만 변경, 재기동 필요) | 노출 창을 비례해 축소 |
| 로그아웃·정지 시 memberId를 짧은 TTL 블랙리스트(Redis)에 등록 | 중간 | 즉시 무효화. Redis 의존 추가 |
| 매 요청 DB 조회 | 높음 | JWT를 쓰는 의미가 사라짐. 권하지 않음 |

**당장 조치가 필요하다고 보지는 않습니다.** 다만 "로그아웃하면 즉시 차단된다"고 이해하고 계신 부분이 있다면 실제 동작은 다르다는 점을 공유드립니다.

---

## 7. `init-pwd` 가 인증·본인확인 없이 비밀번호를 바꿈 — 심각도 높음

*(2026-09-08 추가. 로그인 API 규격 회신을 반영해 ERP 어댑터를 구현하던 중 확인했습니다.)*

**위치**

```
POST /rest/v1/s021200010/init-pwd     (permitAll — 인증 필터를 타지 않음)
```

**무엇이 문제인가**

이 엔드포인트는 **단체명 · 대표자명 · 이메일** 세 값이 DB와 일치하면 그 계정의 비밀번호를 **즉시** 바꿉니다. 현재 비밀번호를 묻지 않고, 이메일로 링크를 보내 확인하지도 않고, 로그인 상태를 요구하지도 않습니다.

문제는 이 세 값이 **비밀이 아니라는 점**입니다. 셋 다 사업자등록증에 있고, 대부분 회사 홈페이지나 사업자정보 공개 서비스에서 확인됩니다. 즉 **아는 사람이 아니라 찾아본 사람**이면 누구나 조건을 맞출 수 있습니다.

세 값을 아는 사람이 이 요청 하나를 보내면:

1. 대상 계정의 비밀번호가 공격자가 고른 값으로 바뀝니다
2. 공격자는 그 비밀번호로 정상 로그인합니다 — 이후 모든 동작은 **정상 사용자와 구분되지 않습니다**
3. 원래 사용자는 로그인이 안 되는 것으로 이상을 알아차립니다. 그 시점에는 이미 지난 뒤입니다

이것은 "추측하기 어려운 값을 맞혀야 하는" 종류가 아니라 **공개 정보만으로 계정을 가져갈 수 있는** 경로입니다. 다른 항목들과 심각도의 성격이 다릅니다.

**ERP 입장에서**

ERP는 계정을 발급하지도 비밀번호를 저장하지도 않습니다(삐용 인증을 그대로 씁니다). 그래서 **ERP 코드로는 막을 수 있는 수단이 없습니다.** 삐용 계정이 넘어가면 그 계정으로 ERP도 그대로 들어옵니다. ERP 쪽 조치가 아니라 삐용 쪽 조치가 필요한 항목이라 이 문서에 싣습니다.

**제안**

정석은 **이메일 확인 링크 방식**입니다 — 세 값이 맞으면 비밀번호를 바꾸는 대신, 등록된 이메일로 1회용·단시간 토큰이 담긴 링크를 보내고 그 링크에서만 새 비밀번호를 받습니다. 이렇게 하면 "그 이메일함을 실제로 여는 사람"이라는 확인이 들어갑니다. 공개 정보를 아는 것과 이메일함을 여는 것은 다른 문제입니다.

당장 전면 개편이 어렵다면 다음 두 가지만으로도 노출이 크게 줄어듭니다.

- **비밀번호를 즉시 바꾸지 않기** — 세 값 검증은 그대로 두되, 결과를 화면에 돌려주지 말고 이메일로만 보냅니다
- **시도 횟수 제한** — 같은 이메일·같은 IP에 대해 시간당 시도 횟수를 제한합니다. 지금은 무제한이라 대상을 바꿔가며 훑는 것도 가능합니다

**확인 방법**

운영계에서 시험하지 마시고, 개발계에서 본인 소유 테스트 계정으로 한 번 호출해 보시면 동작이 바로 보입니다. 저희는 실제 호출을 하지 않았고 소스만 읽었습니다.

---

## 잘 되어 있는 부분

지적만 나열하면 균형이 맞지 않아 함께 적습니다. 아래는 분석 중 확인한 **잘 처리된 설계**입니다.

- **refresh 토큰을 해시로만 저장** — `token010`에 SHA-256 hex만 넣고 원문을 저장하지 않습니다. DB 유출 시에도 그대로 쓸 수 있는 자격증명이 나가지 않습니다
- **로그아웃 조건이 해시 정확 일치 하나뿐** — `member_id`를 조건에 넣지 않아 "memberId만 아는 사람이 남의 세션을 끊는" 인증 없는 DoS가 차단됩니다. 주석에 이유까지 기록되어 있습니다
- **재발급 검증 4단, 특히 주체 3자 일치** — access·refresh·DB의 memberId를 모두 대조합니다. 이게 없으면 자기 refresh에 남의 access를 붙여 권한 상승이 가능한데, 정확히 그 지점을 막고 있습니다
- **재발급 경로의 fail-closed** — `token010` 조회 실패 시 통과가 아니라 거부입니다. 로그인 경로(fail-open)와 의도적으로 반대로 두고 이유를 주석에 남겼습니다
- **2단계 로그인의 후보 검증** — 임시 토큰에 후보 memberId 목록을 담아 남의 memberId로 바꿔치기하는 우회를 막습니다
- **토큰 원문을 로그에 남기지 않음** — 이전에 5줄이나 찍던 것을 제거한 이력이 주석에 있습니다
- **만료 설정의 범위 방어** — `code010`에 0이 들어가면 전원 로그인 불가가 되는데, 60초~30일 범위 밖은 무시하고 폴백합니다
- **만료 설정을 생성자가 아닌 최초 사용 시점에 읽음** — DB 조회 실패가 애플리케이션 기동 실패로 번지지 않습니다

전반적으로 **인증 경로의 판단 근거가 주석으로 남아 있는 점**이 분석에 큰 도움이 되었습니다. 위 7건 중 4건(2·3·4·5번)은 코드 몇 줄 수정으로 끝나는 것들이고, 7번만 흐름 변경이 필요합니다.

---

## 문의

이 문서는 SwonBiz ERP 인증 통합 설계 과정에서 작성되었습니다. 각 항목의 근거가 되는 코드 위치를 모두 명시했으니 직접 확인하실 수 있습니다. 판단이 다른 부분이나 이미 알고 계신 사항이 있으면 알려주시면 반영하겠습니다.
