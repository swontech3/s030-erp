# 연동 규격 — ERP ↔ 삐용 : 로그인 · 회사 등록

**작성:** 2026-09-27 · **기준:** 삐용 개발계(백엔드 `s02-back` 5b8c9e0 빌드 · DB `.14:54322`)
**선행 문서:** `docs/회신_ERP_요청3_회사대표등록API_20260912.md` — ★ **거기서 약속한 주소·값·동작은 그대로다.** 이 문서는 그 뒤에 바뀐 것(입구 막기 · 권한관리 서비스 · 내 메뉴)을 더한다
**표기** — `[코드]` 소스 확인 · `[실측]` 개발계에서 호출·조회 · **`[삐용 작업 필요]`** 아직 없음 · **`[결정]`** 대표 결정(2026-09-28)

---

## 0. 먼저 다섯 줄

```
① 주소 앞부분 : http://192.168.0.22:8082/rest/v1        (개발계 백엔드. 가동계 주소는 이 문서 범위 밖)
② 인증 : 로그인해서 받은 accessToken 을  Authorization: Bearer <토큰>  로 싣는다. 서버끼리 쓰는 별도 키는 없다
③ 업무 실패도 HTTP 200 이다. 본문의 result("success"/"fail") 와 status 로 가른다. 메시지 칸 이름은 massage(오타 그대로)
④ 회사 등록(POST /s021100020/org)은 운영사(에스원테크) 계정 중에서도 「단체관리」 화면 권한이 있는 계정만 된다 — 2026-09-26 부터  → 회신 2026-10-14: POST /rest/v1/s021100010/erp-register-org
⑤ 로그인한 사람이 쓸 수 있는 삐용 화면 목록 : GET /s021000000/my-menus (같은 토큰으로 부른다)
```

---

## 1. 로그인

### 1-1. 로그인 — `POST /rest/v1/s021200010/sign-in` (토큰 없이 부른다)

> **ERP 로그인 = 삐용 로그인** `[결정 Q6]` — **ERP 화면(브라우저)이 이 주소를 직접 부른다.** ERP 서버는 비밀번호를 받지도 넘기지도 않는다.
> 받은 토큰은 ERP 화면이 들고, 삐용 주소를 부를 때 `Authorization` 에 싣는다(CORS 는 §3 — 지금 모든 출처 허용).

```json
요청  { "email": "ceo@hanseong.co.kr", "pwd": "평문 비밀번호" }
```

| 결과 | 응답 |
|---|---|
| **성공 (회사 하나)** | HTTP 200 · 아래 ⓐ |
| **같은 이메일·비밀번호가 여러 회사에 있음** | HTTP 200 · 아래 ⓑ → 1-2 로 이어서 부른다 |
| 계정 없음 · 비밀번호 틀림 · 비밀번호 미설정 | HTTP 200 · `{"status":403,"result":"fail","massage":"로그인 실패","data":{"status":403,"code":"A005","message":"가입된 이메일 정보가 없습니다."},"error":[]}` `[실측]` — ★ 셋을 구분하지 않는다(계정 존재를 알려 주지 않기 위해서) |
| `email`·`pwd` 누락, 이메일 형식 아님 | **HTTP 400 · Spring 기본 본문**(삐용 형식이 아니다) `[실측]` |

ⓐ 성공 `[코드 — S021200010Dto.MemberInfoDto]`
```json
{ "status": 200, "result": "success", "massage": "로그인 완료.",
  "data": { "memberId": 243, "email": "ceo@hanseong.co.kr", "pwd": null,
            "memberName": "김대표", "memberTp": "C",
            "orgId": 15, "orgName": "한성무역", "orgTp": "N", "mailAgentYn": "Y",
            "accessToken": "eyJ…", "refreshToken": "eyJ…" },
  "error": [] }
```
- `memberTp` : `C` 회사 대표 · `A` 일반 회원(개발계에는 그 밖에 `E`·`R` 이 1명씩 있다 `[실측]`). `orgTp` : `S` 운영사(에스원테크) · `N` 일반 회사
- **★ 역할(role)은 돌려주지 않는다.** 무엇을 쓸 수 있는지는 1-5 「내 메뉴」로 묻는다 — 그것으로 충분하다 `[결정 Q4]`
- `pwd` 는 늘 `null` 이다(칸만 남아 있다)

ⓑ 회사 선택 필요 `[코드]`
```json
{ "status": 200, "result": "success", "massage": "단체를 선택해주세요.",
  "data": { "needOrgSelect": true, "selectToken": "eyJ…",
            "candidates": [ { "memberId": 11, "orgId": 1,  "orgName": "(주)에스원테크", "memberName": "홍길동", "memberTp": "A" },
                            { "memberId": 57, "orgId": 15, "orgName": "한성무역",       "memberName": "홍길동", "memberTp": "C" } ] },
  "error": [] }
```
- ★ **같은 이메일이라도 비밀번호가 맞는 회사만** 후보에 든다. 하나만 맞으면 ⓐ 로 바로 간다
- `data` 에 `accessToken` 이 없는 것으로 ⓐ·ⓑ 를 가른다(`needOrgSelect === true`)

### 1-2. 회사 고르기 — `POST /rest/v1/s021200010/sign-in-org` (토큰 없이)

```json
요청  { "selectToken": "ⓑ 의 selectToken", "memberId": 57 }
```
- 성공하면 1-1 ⓐ 와 **같은 모양**이 온다
- `selectToken` 은 **3분** 유효하고, 그 안의 후보 `memberId` 만 받는다. 넘으면 `{"status":403,"massage":"선택 시간이 만료되었습니다. 다시 로그인해주세요."}` → 1-1 부터 다시

### 1-3. 토큰 수명과 재발급

| 토큰 | 개발계 수명 `[실측 — code010]` | 가동계 |
|---|---|---|
| accessToken | **2시간** (`JWT_EXPIRE_ACCESS=7200`) | 코드가 없으면 30분(설정 폴백) |
| refreshToken | **24시간** (`JWT_EXPIRE_REFRESH=86400`) | 코드가 없으면 7일 |

**재발급 — `GET /rest/v1/auth/re-issue?access-token=<access>&refresh-token=<refresh>`** (토큰 헤더 없이. ★ 값이 **쿼리 문자열**이다)
```json
성공  { "status": 200, "result": "success", "massage": "AccessToken 이 갱신되었습니다.",
        "data": { "grantType": "Bearer", "accessToken": "eyJ…(새것)", "refreshToken": "eyJ…(같은 것)",
                  "refreshTokenExpiresIn": "…", "jti": "…", "refreshTokenDurationDays": 86400000, "email": "243" } }
실패  { "status": 400, "result": "fail", "massage": "RefreshToken 이 유효하지 않습니다. 다시 로그인해주세요.", "data": [] }   [실측]
```
- `email` 칸에는 이메일이 아니라 **memberId 문자열**이 들어간다(이름이 틀렸다). `refreshTokenDurationDays` 는 이름과 달리 **밀리초**다 `[코드]`
- 만료된 accessToken 을 그대로 넣어도 된다(서버가 만료를 무시하고 주인만 읽는다 `[코드 — parseClaims]`). refreshToken 은 **바뀌지 않는다** — 24시간이 지나면 다시 로그인
- 한 사람당 refreshToken 은 **최근 5개**까지만 살아 있다. 여러 곳에서 로그인하면 오래된 것부터 재발급이 거부된다

**토큰이 만료·위조일 때 (재발급 말고 다른 주소)** — **HTTP 401** `[실측]`
```json
{ "exceptionEnum": { "status": 401, "code": "A002", "message": "Expired Jwt... 기간이 만료된 JWT입니다." } }
```
- `A001` 형식 오류 · `A002` 만료 · `A003` 지원 안 함 · `A004` 서명 확인 불가. **`exceptionEnum.code` 로 가른다**
- 본문 칸은 `exceptionEnum` 하나뿐이다 — 2026-09-28 W1 로 stackTrace·cause·message 칸을 뺐다(s02-back 재빌드 뒤 적용). 그 전 빌드에서는 그 칸들이 더 붙어 온다. **어느 쪽이든 `exceptionEnum.code` 만 읽을 것**
- 토큰을 **아예 안 실으면** HTTP 403 · Spring 기본 본문이다(401 이 아니다) `[실측]`

### 1-4. 로그아웃 — `POST /rest/v1/s021200010/sign-out` · 헤더 `refresh-token: <refreshToken>`

- 서버에 저장된 그 refreshToken 을 지운다 → 이후 재발급이 거부된다. 이미 없어도 성공으로 답한다
- 헤더가 없으면 `{"status":400,"massage":"refresh-token 헤더가 필요합니다."}`
- ★ **accessToken 은 만료 때까지 살아 있다**(서버가 기억하지 않는 토큰이다). ERP 는 로그아웃 때 자기 쪽 토큰을 버려야 한다
- 참고 : 삐용 웹은 아직 `GET /rest/v1/auth/logout?email=` 을 부른다. 이것은 refreshToken 을 지우지 않는다 — **ERP 는 쓰지 말 것**

### 1-5. 내 메뉴 — `GET /rest/v1/s021000000/my-menus` · `Authorization: Bearer <accessToken>`

- **ERP 가 받은 토큰으로 부를 수 있다.** 같은 토큰이다 `[실측 2026-09-27 — 대표·사원·운영사 DB 대조]`
- 응답 : 그 사람이 **서버 입구를 지날 수 있는 삐용 화면코드** 목록. 입구 판정과 같은 코드가 만든다
```json
{ "status": 200, "result": "success", "massage": null,
  "data": [ "S021000000", "S021000040", "S021000050", "S021000060", "S021100030", "S021100080", "S022300030", … ],
  "error": [] }
```
- 기준 : 그 회사가 구독한 서비스 ∧ 그 사람의 역할에 있는 화면. 운영사도 예외 없이 받은 화면만 나온다
- 화면코드의 이름·주소는 `menu010` 에 있다(ERP 에 주는 조회는 없다). **ERP(S03) 화면은 아직 삐용에 한 줄도 없다** — S03 기능 5개가 전부 `use_yn='N'` · 화면 0

---

## 2. 회사 연동 (회사 + 대표 등록)

### 2-1. 9월 회신과 지금 코드 대조 `[코드]`

| 회신에서 약속한 것 | 지금 | |
|---|---|---|
| `POST /rest/v1/s021100020/org` 한 번에 회사+대표+구독+역할 (→ 회신 2026-10-14: POST /rest/v1/s021100010/erp-register-org) | 같다(한 SQL 문장) | ✅ |
| 필수 `orgName`·`orgCode`·`memberName`·`hpNo`·`email` / 선택 `countryCode`·`pwd`·`zipCode`·`address`·`detailAddress`·`telNo`·`moduleCodes` | 같다 | ✅ |
| 성공 `data:{orgId, orgCode}` | 같다 | ✅ |
| 코드 중복 → 본문 400 + `data:{orgId, orgCode, orgName, deletedYn}` | 같다(삭제 표시면 문구가 달라진다) | ✅ |
| `org_tp` 는 서버가 `N` 으로 정한다 · `member_tp='C'` 도 서버가 | 같다 | ✅ |
| `pwd` 선택 — 안 보내면 로그인 불가 상태로 만들어진다 | 같다 | ✅ |
| `mailAgentYn` 은 보내도 무시 · 모르는 필드도 무시 | 같다 | ✅ |
| `GET /s021100020/dup-check-org-code?orgCode=` | 같다 — `data: true`(사용 가능) / `false` + 사유 `massage` | ✅ |
| `GET /s021100010/org-list?orgName=&memberName=&limit=&curPage=` · 운영사 잠금 | 같다 | ✅ |
| **「운영사(org_tp='S') 소속 토큰이면 된다」** | **달라졌다 — 아래 2-2** | ⚠ |
| `org-list` 의 `orgCode` 검색(회신 §5-2) | 아직 없다 | `[삐용 작업 필요]` (회신에서도 미반영으로 적었다) |

### 2-2. ⚠ 누구 자격으로 부르는가 — **운영사 소속만으로는 모자라다** (2026-09-26 입구 막기 이후)

```
회신(09-12) : 에스원테크(org_tp='S') 소속 회원의 토큰이면 된다
지금        : 그에 더해, 그 회원의 역할에 「단체관리」(S021100010) 화면이 있어야 한다
              입구(서버 인가)가 이 네 주소를 S021100010 으로 판정한다  [코드 — authz_routes.tsv]
                POST /s021100020/org · GET /s021100020/dup-check-org-code   → 회신 2026-10-14: POST /rest/v1/s021100010/erp-register-org
                GET  /s021100010/org-list · POST /s021100010/org-list(삭제)
```
- 개발계 에스원테크 회원 7명 중 **그 화면이 있는 사람은 관리자 역할 1명뿐**이다 `[실측]`. 나머지 6명(사원 역할)의 토큰으로 부르면 거부된다
- 거부 응답(입구) — 회신에 없던 모양이다 :
```json
HTTP 200  { "status": 403, "result": "fail", "massage": "권한이 없습니다. 관리자에게 권한을 요청하세요",
            "data": [], "error": [ "AUTHZ_DENY" ] }
```
  → `error` 에 `AUTHZ_DENY` 가 있으면 **권한 문제**다. 다시 시도해도 풀리지 않는다. 계정을 바꾸거나 역할을 받아야 한다
- 서버끼리 부르는 인증(API 키 · 클라이언트 자격)은 **없고 만들지 않는다.** `[결정 Q1]`
  **ERP 를 쓰는 운영사 직원이 자기 삐용 토큰으로 부른다.** ERP 서버는 삐용 계정·비밀번호를 갖지 않는다
- 그 직원은 운영사에 새로 만든 **「ERP 담당」 역할**(단체관리 화면 포함)을 받는다. 대표가 권한관리 화면(역할 목록 · 역할별 화면·동작 · 역할별 사용자)에서 만들고 붙인다 `[결정 Q2]`
  → 역할이 붙기 전에는 위 거부 응답(`AUTHZ_DENY`)이 온다. ERP 화면은 「삐용 권한관리에서 ERP 담당 역할을 받으세요」로 안내하면 된다

### 2-3. 요청 예 — 회신과 같다

```json
POST /rest/v1/s021100020/org   → 회신 2026-10-14: POST /rest/v1/s021100010/erp-register-org
Authorization: Bearer <단체관리 권한이 있는 운영사 회원의 accessToken>

{ "orgName": "한성무역", "orgCode": "HAN", "memberName": "김대표",
  "hpNo": "010-1234-5678", "email": "ceo@hanseong.co.kr", "countryCode": "KR",
  "zipCode": "06234", "address": "서울시 강남구 …", "detailAddress": "3층",
  "telNo": "02-555-1234", "moduleCodes": [] }
```
- **`moduleCodes` 에 넣을 수 있는 값이 하나 늘었다** — `AUTHZ`(권한관리, 2026-09-27). 지금 고를 수 있는 것 : `MAIL` · `EXPENSE` · `AUTHZ`. `CORE` 는 안 보내도 붙는다
- **ERP 는 그 회사가 계약한 서비스를 `moduleCodes` 로 함께 보낸다. 권한관리(`AUTHZ`)도 그중 하나다** `[결정 Q3]` — 예 `["AUTHZ","MAIL"]`
- 계약에 AUTHZ 가 없으면 보내지 않는다. 그 회사 대표는 역할 화면을 쓰지 못한다(AUTHZ 는 필수가 아니다)

### 2-4. 오류 (회신 §⑥ 표 + 입구 거부 1줄)

| HTTP | 본문 `status` | `massage` / 표지 | 뜻 |
|---|---|---|---|
| 200 | 403 | `error:["AUTHZ_DENY"]` 권한이 없습니다… | **(새로)** 토큰 주인에게 단체관리 화면이 없다 |
| 200 | 403 | 제공자 전용 화면입니다. 접근 권한이 없습니다. | 토큰 주인이 에스원테크 소속이 아니다 |
| 200 | 400 | 단체코드는 영문/숫자 3자리로 입력해주세요. | `orgCode` 형식 |
| 200 | 400 | 이미 사용중인 단체코드입니다. (+ 삭제 표시 문구) | 중복 — `data.orgId` 가 그 회사 |
| 200 | 400 | ○○(CODE) 은(는) 지금 선택할 수 없는 서비스입니다… | `moduleCodes` 에 쓸 수 없는 서비스 |
| 200 | 409 | 권한 견본이 … | 삐용 시드 문제 — 담당자에게 그대로 전달 |
| 200 | 500 | 단체는 등록되었으나 권한 설정이 끝나지 않았습니다… | 있어서는 안 되는 상태 — 즉시 전달 |
| **400** | — | Spring 기본 본문 | 필수 칸 누락 · `orgCode` 가 3글자가 아님 |
| **401** | — | `exceptionEnum.code` A001~A004 | 토큰 만료·위조 → 1-3 재발급 |
| **403** | — | Spring 기본 본문 | 토큰을 안 실었다 |

---

## 3. 다른 PC 에서 부를 때

| 물음 | 답 |
|---|---|
| 개발 서버 주소 | **`http://192.168.0.22:8082`** — 백엔드는 DB 가 있는 .14 가 아니라 개발 PC(.22)에서 돈다 `[실측 — 8082 는 모든 주소(::)에서 대기]` |
| 방화벽 | 이 PC 방화벽은 켜져 있고(네트워크 종류 Public), `jdk-11\bin\java.exe` 의 **들어오는 연결 허용 규칙이 있다** `[실측]`. **다른 PC 연결 확인됨** — 2026-09-27 ERP PC 브라우저 → `192.168.0.22:8082` 응답 403(토큰 없이 부른 것) = 서버 도달 `[실측 — 대표]` |
| 프론트 개발 서버 | `3000` 도 모든 주소에서 대기. `/rest` 를 8082 로 넘긴다(ERP 와는 무관) |
| **CORS** | **어느 출처든 허용된다** — `addAllowedOriginPattern("*")` + 자격 증명 허용 + 모든 헤더·메서드 `[코드 — WebSecurityConfiguration]`. `Origin: http://192.168.0.99:5173` 으로 사전 요청을 보내 허용 응답을 받았다 `[실측]` → **ERP 주소를 따로 넣을 필요가 없다.** ★ 대신 **아무 사이트나** 허용된다. **지금대로 둔다. 가동계 전환 때 좁힌다(별건)** `[결정 Q5]` |
| ERP 서버가 부르면 | 서버 대 서버 호출에는 CORS 가 상관없다 |
| HTTPS | 개발계는 `http` 다 |

---

## 4. 주의점 (ERP 쪽)

1. 분기는 **본문 `result` / `status`** 로. HTTP 코드로는 400·401·403 만 따로 온다(위 표)
2. 메시지 칸은 `massage` 다
3. 토큰을 로그·주소창에 남기지 말 것. 재발급만은 삐용이 쿼리 문자열로 받는다 — ERP 서버 로그에서 가릴 것
4. 로그아웃은 `sign-out`(헤더 `refresh-token`). `auth/logout` 은 쓰지 말 것
5. 회사 등록 재시도 규칙은 회신 그대로 — 성공이든 중복이든 `data.orgId` 가 그 회사다
6. 삐용이 받지 않는 값(사업자등록번호·업태·종목·세금계산서 이메일)은 ERP 가 보관한다(회신 §5)

---

## 5. 삐용 작업 필요

| # | 무엇 | 상태 |
|---|---|---|
| W1 | 401 응답에서 stackTrace 빼기 — `exceptionEnum` 만 | **코드 반영(2026-09-28) · s02-back 재빌드 대기.** 확인 : `scripts/verify_jwt_401_body.py` (반영 전 3/4 — 본문 칸 6개) |
| W2 | `org-list` 에 `orgCode` 검색 | ERP 가 요청하면 한다 |
| W3 | 운영사에 「ERP 담당」 역할(단체관리 화면 포함)을 만들고 ERP 쓰는 직원에게 붙이기 | **대표가 권한관리 화면에서 한다**(Q2). 삐용 코드·DB 작업 없음 |
| W4 | 다른 PC 에서 8082 첫 연결 확인 | **확인됨** — 2026-09-27 ERP PC 브라우저 → 403(서버 도달) |
| W5 | CORS 허용 출처를 좁히기 | 가동계 전환 때(별건). ERP 가 요청하면 앞당긴다 |
| W6 | 로그인 응답에 역할 싣기 / 화면 이름까지 주는 내 메뉴 | ERP 가 요청하면 한다(Q4 — 지금은 화면코드 목록으로 충분) |
| **W7** | **삐용 로그인 화면 주소를 알려 주세요.** ERP 로그인 화면의 「비밀번호 재설정」 링크가 그리로 가야 합니다. **개발계·가동계 각각** 부탁드립니다 | **개발계 회신됨(2026-10-05) · 가동계 대기.** ★ 이것은 백엔드(`:8082`)가 아니라 사람이 보는 **화면** 주소다. 개발계 `http://192.168.0.22:3000` 을 받아 `NEXT_PUBLIC_BBIYONG_WEB_URL` 로 뺐고(하드코딩은 없어졌다), 비어 있으면 **링크를 걸지 않는다**. ★★ 같은 날 삐용이 진입 파라미터 **`?reset=1`** 도 만들어 줘서, 이제 그 링크가 초기화 모달까지 바로 연다 — 회신 ⑦ 의 「딥링크 없음」 제약은 끝났다(`BBIYONG.PASSWORD_RESET_PATH = "/SignIn?reset=1"`). 가동계 주소는 `doc/배포_계통전환.md` M3 에 미결로 있다 |

### W7 — 하드코딩은 없어졌다 (2026-10-05)

★ 삐용 **백엔드** 주소는 환경 파일로 나갔고(`BBIYONG_SYSTEM`·`BBIYONG_BASE_URL`, 2026-09-30),
**화면** 주소도 `NEXT_PUBLIC_BBIYONG_WEB_URL` 로 나갔다(2026-10-05). 코드에 박힌 주소는 없다.
★ 남은 것은 **가동계 화면 주소를 받는 일**뿐이다. 비어 있으면 로그인 화면이 링크 대신
「운영사에 문의해 주세요」를 보여 준다 — 짐작한 주소로 보내지 않는다.
★★ `NEXT_PUBLIC_*` 은 **빌드 때 값이 박힌다.** 가동계 주소를 받으면 환경변수만 고치는 것이
아니라 **web 을 다시 빌드**해야 한다(`doc/배포_계통전환.md` §2 · M3).

---

## 6. 대표 결정 (2026-09-28)

| # | 물음 | 결정 |
|---|---|---|
| **Q6** | ERP 로그인을 삐용 로그인으로 합칠 것인가 | **합친다. ERP 화면(브라우저)이 삐용 로그인 주소(§1-1 · 1-2)를 직접 부른다. ERP 서버는 비밀번호를 받지 않는다** |
| **Q1** | 회사 등록은 누구의 토큰으로 | **ERP 를 쓰는 운영사 직원이 자기 삐용 토큰으로.** 서버끼리 쓰는 키는 만들지 않는다 |
| **Q2** | 그 직원에게 단체관리 화면을 어떻게 | **운영사에 새로 만든 「ERP 담당」 역할(단체관리 화면 포함)을 받는다. 대표가 권한관리 화면에서 만든다** |
| **Q3** | 새 회사의 권한관리(AUTHZ) | **ERP 가 계약한 서비스를 `moduleCodes` 로 함께 보낸다. AUTHZ 도 그중 하나** |
| **Q4** | 로그인 뒤 알아야 할 것 | **「내 메뉴」 화면코드 목록이면 충분하다** |
| **Q5** | CORS | **지금대로(모든 출처). 가동계 전환 때 좁힌다(별건)** |

## 7. 근거

| 확인한 것 | 출처 |
|---|---|
| 로그인·회사 선택·발급 | `S021200010Controller` · `S021200010Logic` · `S021200010Dto` `[코드]` |
| 선택 토큰 3분 · 만료 우선순위 | `JwtTokenProvider` (`SELECT_TOKEN_EXPIRE_TIME` · `JWT_EXPIRE_*`) `[코드]` · code010 2행 `[실측]` |
| 재발급·로그아웃 | `AuthController` · `AuthLogic` · `S021200010Logic.signOut` `[코드]` |
| 401·403·400 본문 | 2026-09-27 개발계 호출(없는 계정 로그인 · 누락 · 토큰 없음 · 잘못된 토큰 · 잘못된 재발급) `[실측]` |
| 공개 주소 | `PublicPaths` · `WebSecurityConfiguration` `[코드]` |
| CORS | `WebSecurityConfiguration.corsConfigurationSource` `[코드]` · 사전 요청 `[실측]` |
| 입구 판정 화면 | `authz_routes.tsv` 108행 `[코드]` · 입구 거부 본문 `AuthzShadowInterceptor.DENY_BODY` |
| 회사 등록 | `S021100020Controller` · `S021100020Logic.registerOrg` · `S021100020Dto` `[코드]` — 09-12 이후 이 경로의 동작 변경 커밋 없음(3727f01 은 단체명 검사, e0f887c 는 조회·수정 네 곳) |
| 포트·방화벽 | `Get-NetTCPConnection` · `Get-NetFirewallApplicationFilter` `[실측 — 읽기만]` |

※ 이 문서를 쓰며 코드·DB·설정을 바꾸지 않았다. 호출은 전부 실패 경로(없는 계정·잘못된 토큰)라 DB 에 남은 것이 없다.
