# SwonBiz ERP — 인수인계

**작성:** 2026-09-12
**목적:** 새 채팅방에서 이어서 작업하기 위한 현재 상태 정리
**저장 위치 권장:** `.planning/HANDOVER.md`

---

## 0. 한 줄 요약

페이즈 1(플랫폼 기반 + 로그인)이 닫혔고 삐용 인증 실연동까지 확인됐다.
다음은 페이즈 3(입주사 관리)이고, 그 전에 삐용 회신 몇 건이 필요하다.

---

## 1. 이 프로젝트가 무엇인가

에스원비즈 공유오피스 운영 시스템(erp.swonbiz.com). 세 시스템이 하나의 삐용
플랫폼 위에 올라간다.

```
삐용(s02)      경비결재. 계정·인증·권한의 원천. Spring Boot + PostgreSQL
메일 Agent(s09) 이메일 AI
ERP(s030)      ← 지금 만드는 것. 공유오피스 계약·회의실·세금계산서
```

**세 시스템이 같은 PostgreSQL 인스턴스(192.168.0.14)를 스키마로 나눠 쓴다.**

```
tb_s020_t001   삐용 (19테이블)
tb_s090_t001   메일 (17테이블)
public         ERP (34테이블, tb_s080_* 접두)
```

---

## 2. 변경 불가 — 확정된 방향

이건 다시 논의하지 않는다. 흔들리면 지난 작업이 무너진다.

**기술 스택**
- 모노레포: `packages/web`(Next.js) · `packages/api`(Fastify) · `packages/shared`
- npm workspaces (pnpm 아님)
- ORM: Drizzle (`generate` → SQL → psql. `push` 금지)
- TypeScript 5.9.3 고정 (latest 는 Go 네이티브 7.x 로 해석됨)
- DB 테이블: `tb_s080_*` 확장 (신규 `s030_*` 계보 만들지 않음). DB 접두어 정의(2026-10-22 결정) — `tb_s080_` = 공통 접두어. ERP 저장소의 표는 서비스(S03 ERP · S04 법무 · S05 세무 · 공용 자료)와 상관없이 모두 `tb_s080_` 으로 만들고, 어느 서비스 표인지는 표 설명(COMMENT)에 적는다. 삐용 `tb_s020_`(스키마 `tb_s020_t001`) · 메일 Agent `tb_s090_`(스키마 `tb_s090_t001`)은 그대로

**인증·권한**
- ERP 는 계정·비밀번호·토큰을 갖지 않는다. 삐용에 위임한다
- 로그인 화면만 ERP 자체 제작, 비밀번호 확인·토큰 발급은 삐용
- ERP 는 `erp_sid` 세션을 자체 발급 (HttpOnly 쿠키). 삐용 토큰은 서버에만 암호화 보관
- 브라우저에 삐용 토큰이 하나도 안 내려간다
- 삐용 DB 직접 조회·조인·외래키 금지 (API 로만). erp_app 은 tb_s020 에 권한 없음(실측)
- 입주사 격리축: `company_id` 단일

**★ 판정 원칙 (이번에 크게 다룬 것)**
- ERP 는 org_tp 로도 member_tp 로도 판정하지 않는다
- 화면 목록이 유일한 근거. 삐용이 org_tp·audience_tp·구독·역할 넷을 보고 목록을 만든다
- 데이터 스코프(operator/tenant)도 삐용이 준다 — ERP 가 유도하지 않는다
- 홈 분기는 화면 목록으로 (org_tp 직접 비교 아님)
- RLS 유지 (애플리케이션 + DB 이중 방어)

**디자인**
- `design/*.dc.html` 이 시각 기준. 새로 설계하지 않고 이관한다
- Primary #4F46E5 인디고 / Accent #22D3EE 시안 / **녹색 절대 금지** (완료·성공도 인디고)
- 디자인 시스템 원본(`design/_ds/swonbiz/`)을 개발이 고치지 않는다. 토큰도 새로 만들지 않는다

---

## 3. 페이즈 1 — 완료 상태

전부 커밋됨. 점검 스크립트가 전부 초록.

```
D-1~D-3   문서 정정 · RLS 유지 · 모노레포 결정
2-1       마이그레이션 001~003 · 검증 22항목
2-2       스캐폴딩
2-3       토큰 119개 이관 · 녹색 lint
2-4       DS 4종(Icon·Input·Button·Checkbox) · 아이콘 로컬화
2-5       로그인 화면 s030000010
2-6       접근권한없음 s030000080 · 동작하는 로그아웃
2-7       ERP 셸 s030000050 (사이드바 접힘 쿠키, 깜빡임 0)
2-8       세션·스코프·ACL
2-10      getAuthContext 브리지 (레거시 S-WonERP)
리뷰      CSRF · 오류노출 · shadow append-only 3건 수정
삐용 인증  ★ 개발계 8082 실연동 확인 완료
org_tp    판정에서 물리적 제거 (getScope · AclSubject · ErpSession)
```

**최근 커밋:** 88ed05a (org_tp 제거)

**동작 확인됨:** 삐용 실계정 로그인 → ERP 세션 발급 → /no-access(권한 Mock이라
정상) → 로그아웃 → /login. 한 바퀴 실제로 돈다.

### 점검 스크립트 (PowerShell 에서 실행)

```
npm run tokens:check     토큰 119개 원본 대조
npm run icons:check      아이콘 11종
npm run lint:green       녹색 금지
npm run design:links     디자인 자원 참조
npm run ds:compare       DS 컴포넌트 마크업 대조
npm run typecheck        3패키지
node scripts/verify-001-003.js .env     DB 22항목 (mock 상태에서)
node scripts/verify-2-8.js .env         세션 21항목 (mock 상태에서)
```

---

## 4. ★ 개발 환경 함정 (반드시 지킬 것)

**bash 가 종료코드를 삼킨다.** 이 PC 의 Git Bash 에서 `npm run` 은 실패해도
exit 0 을 낸다(npm 9.6.6 / node 24). **검증은 PowerShell 또는 `node scripts/...`
직접 실행.** bash 에서 npm run 의 성공/실패를 믿지 말 것.

**포트 8080 vs 8082.** 삐용 가동계 8080, 개발계 8082. 숫자 하나 차이로 운영에
붙는다. 기동 배너가 어느 쪽인지 크게 찍는다. 8080 이면 경고가 뜬다.

**환경변수는 기동 때 한 번만 읽는다.** `.env` 를 고치면 API 재기동 필요
(tsx watch 도 .env 변경으로는 안 뜬다).

**Mock ↔ 실연동 전환:**
```
packages/api/.env 에서
  BBIYONG_MOCK=true     Mock (개발 기본값)
  BBIYONG_MOCK=false    삐용 개발계 실연동
바꾼 뒤 API 재기동
```

**개발할 때는 Mock 으로.** 실연동이면 mock 계정 4종이 삐용에 없어 로그인이 안 되고,
verify:2-8 도 실패한다(그게 정상 — mock 뒷문이 실환경에서 닫힌 증거).

**Mock 계정 4종:**
```
admin@s-wontech.co.kr     erp1234!   운영사 → /dashboard
operator@s-wontech.co.kr  erp1234!   운영사 → /dashboard
tenant@test.com           erp1234!   입주사 → /booking
noaccess@test.com         erp1234!   미구독 → /no-access
```

---

## 5. 서버 실행 (PowerShell 창 2개)

```powershell
# 창 1 — 화면
cd C:\workspace\SwonBiz-erp
npm run dev --workspace @swonbiz/web      # → localhost:3100

# 창 2 — API
cd C:\workspace\SwonBiz-erp
npm run dev --workspace @swonbiz/api      # → localhost:3001
```

`http://localhost:3001/health` 로 mock 여부 확인.

---

## 6. 지금 대기 중인 것

### 삐용에서 받아야 할 것

| # | 항목 | 막는 것 |
|---|---|---|
| ⑫ | 권한 조회 API 규격 | HttpBbiyongAcl. 없으면 실계정이 /no-access 로 감 |
| — | 회사 등록 API 규격 | ★ 페이즈 3 시작 조건 |
| — | 직원 등록 API 규격 | 페이즈 3 (단, 메일 발송이 삐용 2단계라 입주사 직원 계정은 나중) |
| — | S03 공통 모듈 mandatory 여부 | 셸·대시보드가 붙을 모듈 |
| ⑩ | /sign-in-org 규격 | 겸직 계정 2단계 로그인 (지금 계정 없어 급하지 않음) |

### 삐용에 보내야 할 것 (아직 안 보냈으면)

- `doc/BBIYONG_REPLY_2.md` — 모듈 코드명·회사 등록 항목·User-Agent 답
- `doc/BBIYONG_SECURITY_REPORT.md` §7 — init-pwd 취약점 (삐용도 인지, 2단계 이관)

### 확인만 하면 되는 것 (급하지 않음)

- 어제 로그인한 계정의 org_tp. 응답이 'N' 이었는데 에스원테크는 'S' 여야 한다.
  개발계 데이터 문제일 수 있음. 삐용에 계정 알려주면 확인해줌.
  지금은 scope 를 계정 데이터에서 받으므로 당장 안 깨진다.

---

## 7. 페이즈 3 — 다음 작업

**입주사 관리.** 핵심 설계 결정이 이미 있다.

- ERP 에 회사 등록·회원 등록 화면을 **따로 두지 않는다**
- 입주사가 **신규 계약을 등록할 때** 그 안에서 회사·직원을 함께 등록한다
- 대표의 `member_tp='C'` 는 **삐용이 정한다. ERP 는 보내지 않는다**
  (2026-09-12 정정 — 회신 4 §6. 이전 문구는 "ERP 가 'C' 로 넘긴다"였다)
- 단체코드(`orgCode`)는 **ERP 가 `Z01` 부터 순번으로 자동 생성해 보낸다.**
  운영자는 관여하지 않고 화면에도 두지 않는다 (회신 6)
- 삐용 DB 직접 쓰기 금지 — 회사·직원 등록 API 호출
- ERP 화면에 비밀번호 입력란 없음. 최초 비밀번호는 삐용 이메일 링크 (2단계)

**회사 등록 API 규격은 도착했다** (2026-09-12, `.planning/tasks/BBIYONG_REPLY_4~6.md`).
회사·대표·구독·역할이 한 번의 호출로 만들어지고 부분 실패가 없다. 남은 대기는
삐용 쪽 화면 시드·모듈 활성화뿐이고, 그 전까지 `moduleCodes` 는 비워서 보낸다.

**참고 문서 (저장소 안):**
```
.planning/ROADMAP.md              페이즈 6개 계획
.planning/SPEC.md · REQUIREMENTS.md
doc/SWONBIZ_SCREEN_LIST.md        화면 목록 + 대상 구분(P/공통/무인증)
doc/SWONBIZ_PROJECT_STRUCTURE.md  모노레포 구조 + §9 규약(함정 모음)
doc/ORG_ARCHITECTURE.md
doc/BACKEND_ANALYSIS.md           레거시 S-WonERP 분석
design/erp-contract-form/         계약 폼 템플릿 (페이즈 4 최대 난이도)
```

---

## 8. 게이트와 페이즈 2 를 왜 뒤로 미루나

> **★ 번호 체계의 정본은 `.planning/ROADMAP.md` 다.** 이 절은 그 번호를 그대로 쓴다.
> (2026-09-12 정정 — 이 문서가 `019` 적용을 "페이즈 2"라고 불러서, ROADMAP 의
>  페이즈 2(기준관리)가 이 문서에서만 사라져 있었다. **기준관리는 없어지지 않았다.**)

### 게이트 — `019_rename_tenant.sql` 적용 (번호 없음)

페이즈가 아니라 **일정 조율이 필요한 단발성 작업**이라 번호를 주지 않는다.
레거시 S-WonERP 의 컬럼 이름을 바꾸는 일이라 성격이 완전히 다르다.

- ~~앱 정지 창 필요~~ → **부담이 크게 줄었다.** 아래 정정 참조
- 되돌리려면 진짜 복원 필요 (논리 백업으로 안 됨)
- ~~**pg_dump 를 그 전에 확보해야 함**~~ → **확보 완료.** 4-1 에서 PostgreSQL 17
  클라이언트를 설치했다(`pg_dump 17.11`). 백업 실적: `C:\Users\Swontech\swonbiz-db-backup\`
- 레거시 게이트 53곳(org_tp 판정)도 이때 정리

> **★ 2026-09-13 정정 — 레거시 S-WonERP 는 지금 쓰이지 않는다.**
> 이 절은 「운영 중인 앱을 세운다」를 전제로 적혀 있었다. 아무도 쓰지 않는 앱이므로
> **정지 창을 잡을 상대가 없다.** `schema.prisma` 동시 수정은 여전히 필요하지만,
> 사용자에게 통보하고 시간을 맞추는 일이 빠진다.
>
> 4-1(커밋 `94f411c`)이 `tb_s080_contracts` 에서 컬럼 11개를 드롭해 **레거시 계약
> 화면은 지금 오류가 난다.** 쓰지 않으므로 되돌리지 않는다. 게이트를 실행할 때
> `schema.prisma` 를 함께 손보면 같이 정리되는 항목이다.

### 페이즈 2 — 기준관리 (살아 있다)

건물·층·호실·회의실 등록. **페이즈 3 뒤로 미뤘을 뿐 범위에서 빠지지 않았다.**

★ **페이즈 4(계약) 착수 전에는 끝나 있어야 한다** — 계약이 호실을 참조하기 때문이다.
  입주사 자체는 호실과 무관하므로 페이즈 3 은 기준관리 없이 진행한다.

### 지금 순서

```
페이즈 1 ✅  →  페이즈 3 (입주사 관리)  →  게이트 + 페이즈 2 (기준관리)  →  페이즈 4 →  5 →  6
```

게이트는 준비되면 착수한다. 지금 급하지 않다.

---

## 9. 작업 방식 (이 프로젝트의 리듬)

- **전략·설계는 채팅방, 구현은 Claude Code(별도 터미널).** 결과를 붙여넣어 검토·승인
- Claude Code 지시문에 **작업에 맞는 스킬을 반드시 포함**한다 (안 넣으면 안 고름)
  - 되돌리기 어려운 작업·검증 → `verification-before-completion`
  - 파싱·로직 새로 짜기 → `test-driven-development`
  - 페이즈 마감 리뷰 → gstack `/review`
  - 기계적 이관·설정 → 스킬 없이
- 시스템 내부 용어(테이블명·컬럼명)는 일상어로 풀어서. 코드 쓸 때 무엇인지 함께
- **"만들었다"가 아니라 "실제로 그렇게 동작한다"까지 확인.** 이번 페이즈에서
  이걸로 잡은 것: set_config(실행 불가 코드), 녹색 lint(검사 0개 통과),
  로그인 CSRF, org_tp RLS 스위치, massage 오타 필드
