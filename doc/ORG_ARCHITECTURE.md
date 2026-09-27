# 조직 구조 · 스키마 · 인증 · 권한 아키텍처

**작성일:** 2026-09-06
**입력:** `지시_ERP_로그인_권한관리.md` · `SCHEMA_ANALYSIS.md` · `.planning/research/BBIYONG-AUTH.md` · `SWONBIZ_SCREEN_LIST.md` · `SWONBIZ_PROJECT_STRUCTURE.md`
**대조:** `AUTH_ACL_RECONCILIATION.md` · `MIGRATION_A_PLAN.md` · `.planning/PROJECT.md` · `.planning/REQUIREMENTS.md`
**성격:** 설계 결론 문서. 코드 변경 없음.

---

## 0. 한 줄 요약

**로그인할 수 있는 사람은 삐용이 정하고, 어느 회사 데이터인지는 ERP가 정한다.**

이 두 문장이 갈리는 지점이 이 문서의 전부다. 삐용은 **정체성과 권한**의 진실원이고, ERP는 **입주사와 계약 데이터**의 진실원이다. 둘을 잇는 것은 컬럼 하나(`link_s020_org_id`)이고, 그 컬럼은 권한이 아니라 소유자 식별용이다.

---

# 1. 조직 관리 구조

## 1-1. ★ 두 축을 나눈다

지금까지 문서들이 반복해서 걸린 지점은 "삐용 org와 ERP 입주사가 같은 것인가"였다. 답은 **아니고, 앞으로도 아니다.** 다만 더 정확한 표현이 필요하다.

```
로그인 축 (삐용 소유)                      데이터 축 (ERP 소유)
────────────────────────                  ────────────────────────
tb_s020_member010   누가 들어오는가        tb_s030_companies   누구의 데이터인가
tb_s020_org010      어느 조직 소속인가      tb_s030_contracts   어느 계약인가
tb_s020_org_module  무엇을 구독하는가       tb_s030_reservations
tb_s020_role/menu   무슨 화면을 쓰는가

        └──────── link_s020_org_id (정수 1개, FK 없음) ────────┘
```

**두 축은 크기가 다르다.** 삐용에만 있는 회사가 있고(A·B·C사), ERP에만 있는 회사가 있고(D사), 둘 다인 회사가 있다(E·F사). 한 테이블에 합치면 어느 쪽도 지울 수 없고, 조회마다 필터가 하나 더 붙고, 그 필터를 한 번 빠뜨리면 데이터가 샌다.

`AUTH_ACL_RECONCILIATION.md` §1.4의 결론(`link_s020_org_id` 컬럼 하나)을 그대로 유지한다. 이 문서는 거기에 **연결이 없는 경우의 동작**과 **운영 절차**를 채운다.

## 1-2. 회사 유형별 처리

| 회사 | 삐용 | 메일 | ERP 입주 | ERP 로그인 | ERP 데이터 | 처리 |
|---|:---:|:---:|:---:|---|---|---|
| A사 | ○ | ✕ | ✕ | 성공 | 없음 | 접근 가능 화면 0건 → **AUTH-13 안내 화면** |
| B사 | ✕ | ○ | ✕ | 성공 | 없음 | 동일 |
| C사 | ○ | ○ | ✕ | 성공 | 없음 | 동일 |
| **D사** | ✕ | ✕ | ○ | **불가** | 있음 | **§1-3 — 유일한 구조적 공백** |
| E사 | ○ | ✕ | ○ | 성공 | 있음 | `link_s020_org_id` 연결 → §1-4 |
| F사 | ○ | ○ | ○ | 성공 | 있음 | 동일 |
| 에스원테크 | ○ | ○ | 운영사 | 성공 | 전체 | `tb_s030_tenant010.link_s020_org_id` |

**A·B·C사는 사고가 아니라 정상 동작이다.** 삐용 계정이면 누구나 ERP 로그인에 성공한다(지시서 1-7). ERP가 막지 않는 이유는 막을 자격이 없기 때문이다. 화면 목록이 비어 있는 것으로 충분하고, 그때 안내 문구를 띄운다.

**연결이 없는 org의 스코프는 빈 집합이다.** `link_s020_org_id`로 `tb_s030_companies`를 찾지 못하면 `company_id = NULL`이고, 스코프 헬퍼는 0건을 돌려준다. 예외를 던지거나 전체를 돌려주지 않는다. 이것이 A·B·C사에서 데이터가 새지 않는 물리적 이유다.

## 1-3. ★★ D사 — 삐용에 없고 ERP만 쓰는 입주사

**지금 구조로는 로그인이 불가능하다.** ERP는 계정을 발급하지 않고(지시서 1-3), 계정은 삐용 한 곳뿐이다(1-2). 삐용에 계정이 없으면 들어올 문이 없다.

이건 설계 결함이 아니라 **결정의 논리적 귀결**이며, ERP 쪽에서 코드로 해결할 수 없다. `BBIYONG-AUTH.md` §5.3과 §6-3이 이미 같은 것을 지적했고, 여기서 선택지를 정리한다.

| 안 | 내용 | 평가 |
|---|---|---|
| **D-1** | 삐용에 org + member만 만들고 삐용 자체 모듈(EXPENSE)은 구독하지 않는다. 삐용을 **계정 발급기(IdP)로만** 쓴다 | ★ **권장** |
| D-2 | ERP가 자체 계정을 발급한다 | ✗ 지시서 3장 정면 위반. 진실원이 둘이 된다 |
| D-3 | 로그인 없이 링크·QR로 예약만 열어준다 | 부분해. 계약·청구 조회는 여전히 불가. 2-11의 외부 예약과 같은 자리 |

**D-1을 권장하는 이유는 삐용 구조가 이미 그것을 허용하기 때문이다.**

- `tb_s020_org010`에 `org_tp`가 있고 `org_module010` 구독은 **별도 테이블**이다. 조직을 만들되 아무 모듈도 구독하지 않는 상태가 표현 가능하다
- `tb_s020_module010`에 S03(ERP) 모듈 5종이 이미 등록되어 있다. D사에는 S03 모듈만 켜면 된다
- 삐용 `org010`에 사업자등록번호 컬럼이 없다는 사실이 오히려 유리하다. 여기 담기는 것은 **껍데기 조직**이고, 실체(사업자번호·주소·계약)는 전부 ERP `tb_s030_companies`에 있다

**대가로 감수하는 것:** 삐용 org 테이블에 "삐용을 쓰지 않는 조직"이 쌓인다. 삐용 관리 화면에서 이들이 섞여 보인다. `org_module010` 구독이 S03뿐인 행으로 구분 가능하므로 관리상 해소 가능하다.

→ **삐용 팀 회신 항목 ⑪** (§6-3). 절차·화면·소요 시간을 물어야 한다. 이 답이 오기 전까지 D사 입주사는 **데이터는 등록되지만 담당자가 로그인할 수 없는 상태**로 존재한다. ERP 개발을 막지는 않는다.

## 1-4. E사 — 삐용도 쓰고 ERP도 쓰는 회사

### 자동 매칭하지 않는다

**대조할 키가 없다.** 삐용 `org010`의 컬럼은 `ORG_ID, ORG_NAME, ORG_CODE, ORG_TP, COUNTRY_CODE, TIMEZONE, ZIP_CODE, ADDRESS, DETAIL_ADDRESS, TEL_NO, MAIL_AGENT_YN`이고 **사업자등록번호가 없다**(삐용 전체 소스 전수 검색 0건). ERP `companies.biz_number`와 맞출 것이 없다.

회사명 대조는 하면 안 된다. "㈜에스원테크" / "주식회사 에스원테크" / "에스원테크(주)"가 전부 다른 문자열이고, 잘못 붙으면 **남의 회사 계약이 보인다.** 되돌려도 이미 본 것은 복구되지 않는다.

### 운영사가 화면에서 손으로 연결한다

```
입주사 상세 (s0300200020)
  └ [삐용 조직 연결]  ← 운영사 전용 영역
       org_id 입력 또는 목록 선택 → 저장 → 연결 시각·연결자 기록
```

절차:

1. 입주 계약이 확정되면 운영사가 담당자에게 삐용 계정 유무를 확인한다
2. 있으면 `org_id`를 받아 입력한다. 없으면 D-1로 만든 뒤 입력한다
3. 저장 시 **다른 입주사에 이미 붙은 `org_id`면 거부한다** (UNIQUE 제약)
4. 연결 후 담당자가 로그인해 자사 계약이 보이는지 1회 확인한다

**`org_id`를 목록에서 고르려면 삐용 조직 목록 조회 API가 필요하다.** 삐용 DB 직접 조회는 금지(지시서 3장). API가 없으면 정수 직접 입력으로 시작한다. → 회신 항목 ⑬.

### 연결 UNIQUE는 격리의 마지막 방어선이다

```sql
ALTER TABLE tb_s030_t001.tb_s030_companies
  ADD CONSTRAINT ux_companies_link_s020_org
  UNIQUE (link_s020_org_id);   -- NULL 다수 허용, 값은 유일
```

한 삐용 org가 두 입주사에 붙으면 스코프 해석이 두 회사를 돌려주고, 격리가 조용히 무너진다. **DB 제약으로 막는다.** 애플리케이션 검증만으로는 동시 저장에서 뚫린다.

## 1-5. ERP 전용 조직 테이블 구조 제안

기존 테이블을 계승하고 컬럼만 더한다. 새 조직 테이블을 만들지 않는다.

### 운영사 — `tb_s030_tenant010` (기존 1행)

```
tenant_id(int, PK)  name  slug  ceo_name  reg_no  law_no
home_address  business_tp  business_kd  found_date
+ link_s020_org_id   int   NULL  UNIQUE     ← 신규. 에스원테크의 삐용 org_id
```

> **이름 주의.** 이 테이블의 `tenant_id`는 **운영사**를 가리킨다. 설계 문서가 말하던 "테넌트(입주사)"가 아니다. §2-4에서 다시 다룬다.

### 입주사 — `tb_s030_companies` (기존 9행)

```
company_id(text, PK)  build_id(FK)  company_name  company_name_en
biz_number(UNIQUE)  corp_number  ceo_name  business_type  business_item
address … head_address …  member_type  tel  fax  email  website
employee_count  status(R/O/E)  is_non_tenant  memo
+ link_s020_org_id   int          NULL  UNIQUE   ← 신규. 삐용 org_id. FK 없음
+ link_linked_at     timestamptz  NULL          ← 신규. 연결 시각
+ link_linked_by     text         NULL          ← 신규. 연결한 운영사 직원
```

**FK를 걸지 않는 것이 설계다.** 스키마를 넘는 FK를 걸면 삐용의 DELETE가 ERP 제약에 막히고, "읽기 전용 참조"라는 전제가 깨진다. `tb_s090_org010.link_s020_org_id`가 이 DB 안에 있는 선례이며 **거기도 FK가 없다.**

### 구성원 — `tb_s030_members` (기존 5행)

이 테이블은 **계정이 아니라 명부**다. 비밀번호 컬럼이 없고 앞으로도 두지 않는다. 계약 사용자·연락처 관리용이며 지시서 1-3의 "직원 테이블" 금지에 걸리지 않는다.

```
member_id(PK)  build_id  company_id(FK)  user_id  …
+ link_s020_member_id  int  NULL          ← 신규. 삐용 member_id
```

용도 두 가지:

- 명부의 이 사람이 로그인할 수 있는 사람인지 표시 (운영사 화면에서 확인용)
- 범위 「본인 것만」 판정 시 요청자의 삐용 `member_id`와 대조

UNIQUE를 걸지 않는다. 같은 사람이 두 회사 명부에 있을 수 있고, 그건 삐용에서 각각 다른 `member_id`를 갖는다.

### 만들지 않는 테이블

| 테이블 | 이유 |
|---|---|
| `s030_org_member` (역할 매핑) | 지시서 2-1. ERP는 역할을 저장하지 않는다 |
| `s030_role` / `s030_permission` | 동일 |
| ERP 직원·비밀번호 테이블 | 지시서 1-3 |
| 삐용 조직 사본 테이블 | 진실원이 둘이 된다. 필요하면 그때 API로 묻는다 |

### 폐기 대상 — `public."User"` (1행)

Prisma 앱 자체 계정 테이블. AUTH-01(ERP 전용 계정 미발급)에 따라 **최종 폐기**한다. `MIGRATION_A_PLAN.md` §4대로 이동하지 않는다.

다만 **기존 Next.js 앱이 이 테이블로 로그인하고 있다면 지금 지울 수 없다.** 삐용 로그인 전환이 끝난 시점에 지운다. 그때까지 남기되 `tenant_id → tb_s030_tenant010` FK가 스키마를 가로지르는 것은 무해하다.

---

# 2. 스키마 전략

## 2-1. ★ 먼저 용어를 정리한다 — "확장 vs 신규"는 이미 끝난 질문이다

문서 사이에서 「옵션 A」가 두 가지 다른 것을 가리키고 있다. 이게 이번 검토에서 가장 헷갈릴 자리다.

| 출처 | 옵션 A의 뜻 | 판정 |
|---|---|---|
| `SCHEMA_ANALYSIS.md` §4.1 | `tb_s080_*`를 **무시하고 새 테이블을 만든다** | 채택 불가 |
| `SCHEMA_ANALYSIS.md` §6 / `PROJECT.md` D1 | `tb_s080_*`를 **그대로 `tb_s030_t001`로 옮기고 이름만 바꾼다** | ✓ 채택 |

**두 번째는 신규 구축이 아니라 확장이다.** 테이블·데이터·컬럼을 전부 계승하고 스키마와 접두어만 바꾼다. 즉 SCHEMA_ANALYSIS의 권고(확장)와 D1(이동)은 **충돌하지 않는다.** 같은 결론의 두 측면이다.

```
확장   테이블 정의와 데이터를 계승한다          ← SCHEMA_ANALYSIS 권고
이사   public.tb_s080_* → tb_s030_t001.tb_s030_*  ← D1 결정
신규   3.4의 미충족 14건에 필요한 테이블만 추가
```

## 2-2. 확정

> **기존 `tb_s080_*` 29개 테이블을 확장한다. 스키마와 접두어만 `tb_s030_t001.tb_s030_*`로 바꾼다. 새로 짓지 않는다.**

기존 Next.js 앱이 입주사관리·청구를 이미 구현했다는 사실이 이 결정을 **더 강하게** 만든다. 신규 구축은 화면과 데이터를 모두 두 벌로 만들고, 청구 4테이블(`invoices` 31행 · `invoice_lines` 31행 · `payments` 5행 · `settlements`)과 그 위에 붙은 화면을 버리는 일이다.

이동을 그래도 하는 이유 세 가지:

1. **접두어 계보 통일** — 삐용 `tb_s020_t001`, 메일 `tb_s090_t001`이 이미 `tb_sXXX_t001` 규칙을 쓴다. ERP만 `public`에 있으면 넷째 계보가 남는다
2. **PostgREST 노출 차단** — `public` 32테이블은 RLS가 전부 꺼져 있는데 `anon`·`authenticated`에 전권 grant가 걸려 있다(87건). anon 키만 있으면 브라우저에서 계약·청구·회원을 읽고 쓸 수 있다. 새 스키마는 `service_role`만 준다
3. **스키마 경계로 지시서 3장을 물리 강제** — "✗ 삐용 DB 직접 조회·스키마 넘어 조인·외래키"가 규칙이 아니라 구조가 된다

이동 비용은 실측으로 거의 0이다: 이름에 걸린 DB 객체는 FK 1건, 데이터는 시드 약 370행, 뷰·함수·트리거·RLS·publication 전부 0건 (`SCHEMA_ANALYSIS.md` §6.1~6.2).

## 2-3. ★ 기존 Next.js 앱을 어떻게 할 것인가 — 결정 필요

이동의 실제 비용은 DB가 아니라 **앱**에 있다. 기존 앱은 입주사관리·청구가 동작하는 상태다.

| 안 | 내용 | 비용 | 위험 |
|---|---|---|---|
| **A-흡수** | 기존 앱의 `schema.prisma`를 새 스키마로 고쳐 계속 운영하고, 신 ERP 화면이 준비되는 대로 라우팅을 옮긴다 | `@@map` 29건 + `@@schema` 추가 = 파일 1개 | 전환 기간에 **쓰기 경로가 둘** |
| B-동결 | 기존 앱을 읽기 전용으로 세우고 신 ERP만 쓴다 | 낮음 | 신 ERP가 청구 화면을 만들 때까지 청구 업무 공백 |
| C-폐기 | 기존 앱을 버리고 전 화면 재구현 | 높음 | 이미 되는 것을 다시 만든다 |

**권장: A-흡수.** 단 전환 기간에 **도메인별로 쓰는 앱을 하나로 고정**한다. 같은 테이블에 두 앱이 쓰면 상태 어휘와 검증 규칙이 갈리고, 한쪽만 고치는 사고가 난다. 지시서 2-1이 권한에 대해 경고한 것과 같은 종류다.

```
전환 기간 소유 앱 고정 (예시 — 실제 배분은 기존 앱 화면 확인 후 확정)
  입주사·청구        기존 앱만 쓴다
  계약 폼·예약·기준설정  신 ERP만 쓴다
  읽기               양쪽 다 허용
```

**선행 확인 3건은 `MIGRATION_A_PLAN.md` §2 그대로다.** 이제 앱 소스에 접근 가능하므로 즉시 실행할 수 있다.

```bash
grep -rn "from('tb_s080\|from(\"tb_s080" .   # supabase-js 직접 호출
grep -rn "queryRaw\|executeRaw" .            # Prisma raw SQL
grep -rn "tb_s080" prisma/ supabase/         # 스키마·config 하드코딩
```

셋 다 0이면 앱 작업은 `schema.prisma` 한 파일이다. 하나라도 걸리면 그 지점을 먼저 목록화한다.

## 2-4. ★★ `tenant_id` 격리축 재설계

### 현재 상태 — 실측

`SCHEMA_ANALYSIS.md` §6.7의 실측 결과:

| 테이블 | `tenant_id` | 격리 관련 컬럼 |
|---|:---:|---|
| `companies` | **없음** | `build_id`, `company_id`(PK) |
| `contracts` | **없음** | `build_id`, `company_id`, `space_id` |
| `reservations` | **없음** | `build_id`, `facility_id`, `company_id`, `member_id` |
| `members` | **없음** | `build_id`, `company_id` |
| `tenant010` | PK (1행) | 운영사 자신 |
| `public."User"` | int FK | 폐기 대상 |

**`tenant_id`는 격리축이 아니다.** 운영사 단일 행을 가리키는 상수이고, 그 위에 스코프 헬퍼를 걸면 모든 입주사가 서로를 본다. 오류는 나지 않고 테스트는 통과한다. 이게 가장 위험한 형태의 결함이다.

### 재설계 — 세 가지를 바꾼다

**① 이름을 바꾼다.** `tenant_id`를 `operator_id`로 개명한다.

```sql
ALTER TABLE tb_s030_t001.tb_s030_tenant010 RENAME COLUMN tenant_id TO operator_id;
ALTER TABLE tb_s030_t001.tb_s030_tenant010 RENAME TO tb_s030_operator010;
ALTER TABLE tb_s030_t001.tb_s030_buildings RENAME COLUMN tenant_id TO operator_id;
```

이름을 그대로 두면 6개월 뒤에 누군가 다시 "테넌트니까 격리축이겠지"라고 읽는다. 주석은 읽히지 않고 이름은 읽힌다. **이동 마이그레이션과 같은 트랜잭션에서 처리한다** — 어차피 29개 테이블 이름을 바꾸는 중이므로 추가 비용이 0이다.

**② 격리축은 `company_id` 단일 축이다.**

```
입주사 스코프   company_id = <요청자의 회사>
운영사 스코프   제한 없음 (전 회사)
본인 스코프     company_id = <요청자의 회사> AND created_by_s020_member_id = <요청자>
```

**`build_id`를 격리축에 넣지 않는다.** `build_id`는 운영사가 여러 건물을 운영할 때의 **필터**이지 격리 경계가 아니다. 격리축에 넣으면 한 회사가 두 건물에 입주한 순간 자기 데이터가 갈린다.

**③ 요청 시점 스코프 해석은 한 곳에서만 한다.**

```
삐용 응답의 orgId
   └→ tb_s030_companies WHERE link_s020_org_id = :orgId
        ├ 1건 → company_id 확정 (입주사 스코프)
        ├ 0건 → 빈 스코프. 데이터 0건. 예외를 던지지 않는다
        └ 운영사 org_id와 일치 → 전체 스코프
```

세 가지 규칙을 **린트로 강제**한다. 코드 리뷰로는 새는 것을 못 막는다. 8월 사고가 그 증거다.

1. `company_id`·범위는 검증된 세션 컨텍스트에서만 읽는다. 쿼리·바디·헤더에서 읽지 않는다 (ACL-03)
2. 스코프 대상 테이블은 공용 스코프 헬퍼를 통해서만 조회한다. 목록·상세·검색·자동완성·내보내기 예외 없음 (ACL-02)
3. `link_s020_org_id` 조회는 단일 함수(`lib/scope/resolveCompany.ts`) 안에만 존재한다

### 실패 테스트를 먼저 쓴다

격리는 "성공 케이스가 통과한다"로 검증되지 않는다. **다른 회사 데이터로 실패해야 검증된다.**

```
E사 세션으로 F사 계약 ID 직접 요청 → 404 (403이 아니다. 존재 여부가 새면 안 된다)
E사 세션으로 F사 예약 조회        → "예약됨"만. 제목·조직명·인원이 응답에 없다
연결 없는 org 세션으로 목록 요청   → 0건. 500이나 전체가 아니다
운영사 세션으로 전체 요청          → 전 회사
```

## 2-5. 추가해야 할 테이블·컬럼 목록

`SCHEMA_ANALYSIS.md` §3.3·§3.4를 계승하고, 이번 검토에서 나온 조직·권한 관련 항목을 더한다.

### 신규 컬럼 — 조직 연결 (이 문서에서 추가)

| # | 대상 | 컬럼 | 근거 |
|---|---|---|---|
| O1 | `tb_s030_companies` | `link_s020_org_id int NULL UNIQUE` | §1-4. ACL-01′ |
| O2 | `tb_s030_companies` | `link_linked_at timestamptz NULL` · `link_linked_by text NULL` | 연결 감사 |
| O3 | `tb_s030_operator010` | `link_s020_org_id int NULL UNIQUE` | 운영사 식별 |
| O4 | `tb_s030_members` | `link_s020_member_id int NULL` | 명부↔계정 대조 |
| O5 | `tb_s030_reservations` | `created_by_s020_member_id int NULL` | 범위 「본인 것만」 (지시서 2-4) |
| O6 | `tb_s030_contracts` | `created_by_s020_member_id int NULL` | 동일 |

> O5·O6이 없으면 범위 2종 중 「본인 것만」을 구현할 수 없다. 기존 `reservations.member_id`는 ERP 명부 FK라 삐용 정체성과 직접 대조되지 않는다.

### 신규 테이블 — 권한 단계적 적용 (이 문서에서 추가)

| # | 테이블 | 근거 |
|---|---|---|
| O7 | `tb_s030_acl_shadow_log` | ACL-08 shadow 모드 기록. §4-5에 구조 |

**권한 캐시를 DB 테이블로 두지 않는다.** 진실원이 둘이 된다. 메모리 또는 Redis에만 둔다(§4-3).

### 기존 목록 계승 — 변경 (`SCHEMA_ANALYSIS.md` §3.3)

| # | 항목 | 필요 | 막는 요구사항 |
|---|---|---|---|
| C1 | 타임존 `timestamp` → `timestamptz` | 예약 먼저, 나머지 후속 | BOOK-07 |
| C2 | 예약 중복 `EXCLUDE USING gist` + `btree_gist` | 취소 제외 `WHERE` 포함 | BOOK-05/06 |
| C3 | 계약↔호실 카디널리티 | 자식 테이블로 분리 | CONT-04/05 |
| C4 | 상태 CHECK 제약 (현재 `public`에 0개) | CHECK 또는 enum | CONT-08 |
| C5 | 계약 상태 어휘 정렬 | 기존 `P/A/E/S/C`가 더 정밀. 설계를 기존에 맞춘다 | CONT-07 |
| C6 | 예약 상태 `requested`·`rejected` 추가 | | BOOK-10 |
| C7 | 역할 5종 저장 · 2종 분기 | **재검토** — §5-6 참조 | ACL-01′ |
| C8 | `tenant_id` 타입 통일 + FK | §2-4 개명과 함께 | 정합성 |
| C9 | 누락 인덱스 (`company_id`·`space_id`·`end_date`) | | CONT-16, TNNT-03, DASH-03 |
| C10 | `ROOM_TP` 코드 중복 12행 정리 | | 셀렉트 중복 노출 |

> **C7은 이 문서에서 판정이 바뀐다.** 지시서 2-1은 ERP가 역할을 저장하는 것 자체를 금지한다. 5종이든 2종이든 **저장하지 않는다.** `RES_TP` 코드값은 명부 화면의 표시용 구분으로만 남기고, 판정에는 쓰지 않는다.

### 기존 목록 계승 — 신규 (`SCHEMA_ANALYSIS.md` §3.4)

| # | 테이블/컬럼 | 요구사항 |
|---|---|---|
| N1 | `contract_items` (최대 10, 유형 구분자 필수) | CONT-04/05/10 |
| N2 | `contract_users` (최대 20) | CONT-06 |
| N3 | `contract_status_history` | CONT-11 |
| N4 | `contracts.contract_type` (이용 / 전대차) | CONT-12 |
| N5 | `contracts.billing_start_date` | CSCH-01 |
| N6 | `contracts.deposit_return_status` | CSCH-02 |
| N7 | 계약 시점 사업자정보 스냅샷 컬럼군 | CSCH-03 (세금계산서 법적 요건) |
| N8 | `contracts.renewed_from_contract_id` | CSCH-04 |
| ~~N9~~ | ~~삐용↔ERP 정체성 매핑 테이블~~ | **O1으로 축소.** 테이블이 아니라 컬럼 하나 |
| N10 | 예약 정책 전사 기본값 테이블 | MAST-05, BOOK-08/09 |

### ★ 발견 — `companies.build_id`가 격리축을 오염시킨다

`tb_s030_companies`에 `build_id` FK가 NOT NULL로 걸려 있다. **한 입주사는 한 건물에만 속한다**는 뜻이다.

한 회사가 두 건물에 입주하면 회사 레코드를 두 개 만들어야 하고, 그러면 `biz_number` UNIQUE 제약에 걸린다. 지금 건물이 1개라 드러나지 않을 뿐이고, 센터가 늘어나는 순간 등록 자체가 막힌다.

**권장:** `companies.build_id`를 nullable로 낮추고 실제 소속은 `contracts.build_id`가 정한다. 회사는 건물에 속하지 않고 **계약이 건물에 속한다.** 지금 고치면 컬럼 제약 완화 1건이고, 데이터가 쌓인 뒤엔 회사 레코드 병합 작업이 된다.

| # | 항목 | 조치 |
|---|---|---|
| O8 | `tb_s030_companies.build_id` NOT NULL 해제 | 이동 마이그레이션과 함께 |

---

# 3. 로그인 흐름

## 3-1. ★★ 토큰 저장 위치 — 서버 세션 + 불투명 쿠키

### 지시서와 충돌하지 않는다

`AUTH_ACL_RECONCILIATION.md` §1.1은 지시서 1-2 ⑥("ERP가 자기 쪽에 토큰 저장")을 **브라우저 저장소**로 읽고 XSS 노출(SEC-01)을 감수한다고 했다. 다시 보면 지시서는 저장 **위치**를 정하지 않았고, 회신 ④에서 확인하라고 했다.

금지된 것을 정확히 읽으면 이렇다.

```
✗ 자체 토큰 발급 로직            ERP가 자기 서명키로 JWT를 만드는 것
✗ 토큰을 풀어 메뉴를 열고 닫기    ERP가 클레임으로 판정하는 것
─────────────────────────────────────────────────
○ 삐용 토큰을 서버에 보관하는 것   발급이 아니라 보관이다
○ 불투명 세션 ID를 쿠키에 담는 것  판정 근거를 담지 않는다
```

**불투명 세션 ID는 토큰이 아니다.** 서명도 클레임도 없고, 서버 테이블 조회 없이는 아무 의미가 없는 랜덤 문자열이다. 이것으로 판정할 수 있는 것이 하나도 없으므로 "진실원이 둘이 된다"는 지시서의 사고 원인에 해당하지 않는다.

### 권장 구조

```
브라우저                      Next.js Route Handler                    삐용
   │                                  │                                  │
   │─ POST /api/auth/login ──────────▶│                                  │
   │   {email, pwd}                   │─ POST /rest/v1/s021200010/sign-in ▶
   │                                  │◀─ 200 {memberId, orgId, orgTp,   │
   │                                  │        memberTp, orgName,        │
   │                                  │        accessToken, refreshToken}│
   │                                  │                                  │
   │                       ┌──────────┴────────────┐                     │
   │                       │ 서버 세션 저장          │                     │
   │                       │  sid = random(32B)     │                     │
   │                       │  bb_access  (암호화)   │                     │
   │                       │  bb_refresh (암호화)   │                     │
   │                       │  memberId, orgId       │                     │
   │                       └──────────┬────────────┘                     │
   │◀─ Set-Cookie: erp_sid=<opaque> ──│                                  │
   │   HttpOnly Secure SameSite=Lax   │                                  │
   │                                  │                                  │
   │─ GET /api/contracts ────────────▶│ (또는 Fastify 직접)               │
   │                        세션 로드 → 삐용 권한 조회(캐시) → 스코프 해석  │
```

| 항목 | 값 | 이유 |
|---|---|---|
| 쿠키 이름 | `erp_sid` | |
| 값 | 불투명 랜덤 32바이트 | 클레임 없음. 위조해도 세션 테이블에 없다 |
| `HttpOnly` | ✔ | XSS로 읽을 수 없다 |
| `Secure` | ✔ | |
| `SameSite` | `Lax` | 로그인 후 리다이렉트가 통과해야 한다 |
| `Path` | `/` | |
| `Max-Age` | 604800 (7일) | 삐용 refresh와 동일. 그보다 길면 죽은 세션이 남는다 |

**삐용 토큰은 브라우저에 절대 내려보내지 않는다.**

### 왜 삐용 토큰을 쿠키에 직접 넣지 않는가

`orgId`가 토큰에 없기 때문이다(`BBIYONG-AUTH.md` §2.3). 로그인 응답 본문에만 있다.

- `orgId`를 별도 쿠키에 담으면 → 브라우저에서 고칠 수 있다. 스코프 해석의 입력이므로 **고치는 순간 남의 회사 데이터가 열린다.** 8월 사고와 같은 종류다
- `orgId`를 매 요청 삐용에 다시 묻으면 → 그런 API가 있는지 미확인이고, 있어도 요청마다 왕복이 붙는다
- `orgId`를 서버에만 두면 → 위 두 문제가 동시에 사라진다

`memberId`도 마찬가지다. 삐용 access 토큰의 `sub`에 있지만, 그것을 신뢰하려면 서명 검증이 필요하고 그러려면 삐용 시크릿 사본이 하나 늘어난다(HS256 대칭키 = 위조 가능 주체가 하나 늘어난다).

### 세션 저장소

| 안 | 적용 시점 |
|---|---|
| 인메모리 Map | 로컬 개발만 |
| **`tb_s030_auth_session` 테이블** | ★ 단일 인스턴스 운영 |
| Redis | 다중 인스턴스로 갈 때 |

```
tb_s030_auth_session
  sid(text, PK)                    불투명 세션 ID의 해시 (원문 저장 안 함)
  s020_member_id(int)              삐용 memberId
  s020_org_id(int)                 삐용 orgId
  bb_access_enc(text)              삐용 access (암호화)
  bb_refresh_enc(text)             삐용 refresh (암호화)
  bb_refresh_expires_at(timestamptz)
  issued_at  last_seen_at  expires_at  revoked_at
  user_agent  ip                   감사용
```

**`sid`는 해시로 저장한다.** 삐용 `token010`이 `refresh_token_hash`로 하는 것과 같다. DB가 읽혀도 세션을 탈취할 수 없다.

**삐용 access 토큰까지 보관해야 하는 이유:** `/re-issue`가 access와 refresh **둘 다**를 요구하고, access·refresh·DB 세 곳의 memberId 일치를 검사한다(`BBIYONG-AUTH.md` §2.4).

### 감수하는 것

세션 조회가 요청마다 붙는다. 30초 TTL 인메모리 캐시로 완화하되, `revoked_at`은 캐시를 우회해 즉시 반영한다(로그아웃이 30초 늦으면 안 된다).

## 3-2. 삐용 로그인 API 호출 구현

**삐용을 부르는 코드는 Next.js Route Handler 안에만 존재한다.** Fastify는 삐용을 모른다. 이 경계를 지키면 삐용 규격이 바뀔 때 고칠 파일이 한 폴더로 한정된다.

```
app/api/auth/
  login/route.ts        POST  이메일·비밀번호 → 세션 발급
  select-org/route.ts   POST  겸직 지원 시에만 (회신 ⑩ 대기)
  refresh/route.ts      POST  single-flight 갱신
  logout/route.ts       POST  세션 폐기
  me/route.ts           GET   표시용 정보 (이름·회사명) + 접근 가능 화면 목록
lib/bbiyong/
  client.ts             삐용 HTTP 호출. 이 파일 밖에서 삐용 URL을 쓰지 않는다
  types.ts              응답 Zod 스키마
```

### ★ 삐용 응답의 함정 4가지 — 전부 코드에 반영한다

`BBIYONG-AUTH.md` §2.4에서 확인된 것들이다. 하나라도 놓치면 조용히 깨진다.

| # | 함정 | 대응 |
|---|---|---|
| 1 | **실패해도 HTTP 200이다.** 본문 `status`가 400 | `res.ok`로 판정하지 않는다. `body.status !== 200`이면 실패 |
| 2 | 재발급 응답의 `email` 필드에 **memberId**가 들어간다 (레거시 필드명) | 이름을 믿지 않는다. Zod 스키마에 실제 의미로 주석 |
| 3 | `refreshTokenDurationDays`가 이름과 달리 **밀리초** | 단위 변환을 한 곳에서만 |
| 4 | 새 access 토큰의 `auth` 클레임은 **들어온 것을 그대로 복사**한다 | 권한 변경이 재로그인 전까지 미반영. **ERP는 클레임으로 판정하지 않으므로 영향 없다** |

4번은 오히려 API 판정 방식의 이점을 보여준다. 클레임을 믿었다면 권한을 회수해도 최대 7일간 살아 있는다.

### 응답 검증

```ts
// lib/bbiyong/types.ts
export const SignInResponse = z.object({
  status: z.literal(200),
  data: z.object({
    memberId:     z.number().int(),
    email:        z.string(),
    memberName:   z.string(),
    memberTp:     z.string(),          // 표시용. 판정에 쓰지 않는다
    orgId:        z.number().int(),
    orgName:      z.string(),
    orgTp:        z.string(),
    accessToken:  z.string().min(1),
    refreshToken: z.string().min(1),
  }),
})
```

**Zod 실패는 로그인 실패로 처리한다.** 모양이 다른 응답을 부분적으로 받아들이면 나중에 undefined가 스코프 해석까지 흘러간다.

## 3-3. 토큰 갱신 — single-flight

**삐용은 지금 회전(rotation)을 하지 않는다.** 갱신 시 access만 새로 만들고 refresh는 들어온 것을 그대로 돌려준다. 코드 주석에 이유가 있다: 프런트 401 자동 재발급이 동시 다발이라, 회전하면 첫 요청만 성공하고 나머지가 강제 로그아웃된다.

**하지만 삐용이 "프런트에 single-flight를 넣은 뒤 회전을 얹는다"고 명시했다.** ERP는 처음부터 회전을 전제로 만든다. 나중에 넣는 건 이미 깨진 뒤다.

```ts
// app/api/auth/refresh/route.ts — Node 런타임. Edge 아님
const inflight = new Map<string, Promise<Session>>()

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

  const body = await bbiyong.reissue({
    accessToken:  decrypt(s.bbAccessEnc),
    refreshToken: decrypt(s.bbRefreshEnc),
  })
  if (body.status !== 200) throw new SessionGone(body.message)   // ★ 함정 1

  // ★ 회전이 없어 같은 refresh가 돌아오지만, 응답값을 그대로 저장한다.
  //   삐용이 회전을 켜도 이 코드는 그대로 동작한다.
  await updateSession(sid, {
    bbAccessEnc:  encrypt(body.data.accessToken),
    bbRefreshEnc: encrypt(body.data.refreshToken),
  })

  await aclCache.invalidate(s.s020MemberId)   // 권한을 다시 묻는다
  return loadSession(sid)
}
```

> **인메모리 `Map`은 단일 인스턴스에서만 유효하다.** Next.js를 여러 인스턴스로 띄우는 순간 Redis 잠금으로 바꿔야 한다. 지금은 회전이 없어 중복 갱신이 무해하므로 인메모리로 시작해도 되지만, **삐용이 회전을 켜기 전에 반드시 교체한다.** → 회신 항목 ⑤·⑫.

### TTL 정렬

| 항목 | 값 | 근거 |
|---|---|---|
| 삐용 access | 30분 (code010로 변경 가능, 삐용 재기동 필요) | 삐용 소스 |
| 삐용 refresh | 7일 | 삐용 소스 |
| ERP 세션 행 | **7일** — 삐용 refresh와 동일 | 삐용 refresh가 죽으면 ERP 세션도 죽어야 한다 |
| 권한 캐시 | **60초** | §4-3 |
| 세션 캐시 | **30초** (revoked는 우회) | §3-1 |

**삐용은 기동 후 최초 1회만 DB에서 TTL을 읽고 메모리에 캐시한다.** ERP가 런타임에 추적할 수단이 없으므로, 삐용이 TTL을 바꾸면 통보받아야 한다. → 회신 항목 ⑤.

## 3-4. 로그인 후 홈 분기

### 결과는 지시대로, 판정 주체는 삐용

사용자 요구(운영사 → `/dashboard`, 입주사 → `/booking`, 미구독 → 안내)와 지시서 2-1(ERP는 판정하지 않는다)은 충돌하지 않는다. **역할로 분기하는 대신 화면 권한 유무로 분기하면 결과가 같다.**

```ts
// app/api/auth/me/route.ts 응답에 포함
const screens = await bbiyongAcl.listScreens(session.s020MemberId)

// 로그인 직후 홈 결정 — 순서가 곧 우선순위
if (screens.length === 0)              return '/no-access'   // AUTH-13 안내
if (has(screens, 's0300000060'))       return '/dashboard'   // 대시보드 권한 = 운영사
if (has(screens, 's0300600010'))       return '/booking'     // 예약 권한 = 입주사
return routeOf(screens[0])                                    // 그 외는 목록 첫 화면
```

**`role === 'operator'`를 쓰지 않는다.** 대시보드 화면 권한이 있는가만 본다. 운영사 판정을 ERP가 하지 않으므로 지시서 2-1을 지키고, 결과는 요구대로 나온다.

### 미들웨어는 UX 게이트일 뿐이다

```ts
// middleware.ts — 인가가 아니다 (CVE-2025-29927). 진짜 차단은 서버가 한다
if (!sid)                        return redirect('/login?redirect=' + pathname)
if (!allowedScreens.has(id))     return redirect(homeOf(allowedScreens))
```

지시서 2-9: **화면 숨김은 편의이고 실제 통제는 서버다.** 미들웨어를 지나도 API가 다시 판정한다.

### 폐기 화면 3종

지시서 1-3에 따라 다음을 만들지 않는다. 디자인은 완료돼 있으나 **쓰지 않는다.** 남기면 "ERP에도 계정이 있다"는 오해를 만든다.

| 화면 | 처리 |
|---|---|
| `s0300000020` 비밀번호 재설정 요청 | 폐기 → 로그인 화면에서 **삐용 해당 화면으로 링크** |
| `s0300000030` 발송 완료 | 폐기 |
| `s0300000040` 초대 수락·비밀번호 설정 | 폐기 |

`s0300000070` 설정 화면의 "권한 관리 준비 중" 자리도 없앤다. ERP에 권한 관리 화면은 생기지 않는다.

### 신규 화면 1종

| 화면 | 내용 |
|---|---|
| **`s0300000080`** 접근 권한 없음 | AUTH-13. "이 계정은 ERP 이용 권한이 없습니다. 담당자에게 문의하세요." |

**현재 `tb_s020_org_module010`이 0행이다.** 구독이 하나도 없으므로 지금 상태로는 모든 계정이 이 화면을 본다. 개발 중에는 mock 어댑터로 우회한다(§4-1).

## 3-5. 로그아웃

```
1. tb_s080_auth_session.revoked_at = now()     ← 즉시 무효화. 캐시 우회
2. POST 삐용 /rest/v1/s021200010/sign-out
   헤더: refresh-token: <복호화한 삐용 refresh>
3. erp_sid 쿠키 삭제
```

2번이 실패해도 1·3번은 진행한다. ERP 세션만 끊겨도 사용자는 로그아웃된 것이다. 다만 삐용 세션이 남으므로 로그를 남긴다.

> **삐용 access 토큰은 무효화 수단이 없다**(`token010`에 없다). 로그아웃 후에도 최대 30분 유효하다. ERP는 삐용 토큰을 브라우저에 내려보내지 않으므로 이 창이 실제 위험이 되지 않는다. 이것도 서버 보관을 택하는 이유 중 하나다.

## 3-6. 두 번 로그인은 감수한다

`swonbiz.com`과 `s-wontech.co.kr`은 eTLD+1이 다르다. 쿠키 공유는 어떤 설정으로도 불가능하다. 삐용에 로그인해 둬도 ERP는 다시 묻는다.

둘 다 매일 쓰는 사람은 에스원테크 직원 몇 명뿐이라 지금은 감수한다(지시서 1-8). 나중에 불편해지면 같은 상위 도메인 아래로 옮기는 길이 있으므로, **접속 주소를 정할 때 그 여지를 남긴다** — §6-1.

---

# 4. 권한 판정 연동

## 4-1. ★ 어댑터 하나로 격리한다

**삐용 권한 API 규격이 아직 없다.** 지시서 2-1은 "물어본다"고 했지만 엔드포인트를 주지 않았다. 이 미지수가 ERP 개발 전체를 멈추게 두면 안 된다.

**인터페이스를 먼저 정하고 mock으로 개발한다.** 실제 규격이 오면 어댑터 한 파일만 바꾼다.

```ts
// lib/acl/types.ts
export type Action = 'VIEW' | 'CREATE' | 'UPDATE' | 'DELETE'   // 4종뿐. APPROVE·EXPORT 없음
export type Scope  = 'SELF' | 'COMPANY'                        // 2종뿐. 부서·타사 없음

export interface ScreenGrant {
  screenCode: string        // ERP 화면 ID (§5)
  actions:    Action[]
  scope:      Scope
}

export interface BbiyongAcl {
  /** 한 번에 전부 받는다. 화면마다 묻지 않는다 */
  listScreens(memberId: number): Promise<ScreenGrant[]>
}
```

```
lib/acl/
  types.ts
  HttpBbiyongAcl.ts    실제 삐용 호출. 규격 확정 후 작성
  MockBbiyongAcl.ts    개발용. 시나리오별 고정 응답 (운영사 / 입주사 / 미구독)
  index.ts             ACL_ADAPTER 환경변수로 선택
```

**`check(screen, action)` 단건 API를 쓰지 않는다.** 화면 하나에 API 여러 개가 붙으므로 요청마다 삐용을 때리게 되고, 삐용이 느려지면 ERP가 통째로 느려진다. **목록을 한 번 받아 캐시한다.**

→ 회신 항목 ⑫: 목록 조회 엔드포인트가 있는가. 없으면 만들어 줄 수 있는가. 응답에 화면코드·동작·범위 세 가지가 들어가는가.

## 4-2. Fastify 훅 구조

```ts
// 1) onRequest — 세션 확인
app.addHook('onRequest', async (req, reply) => {
  if (isPublicRoute(req.routeOptions.url)) return      // 050 공개 화면

  const sid = req.cookies.erp_sid
  if (!sid) return reply.code(401).send({ code: 'NO_SESSION' })

  const session = await sessionStore.get(sid)          // 30초 캐시. revoked는 우회
  if (!session || session.revokedAt) {
    return reply.code(401).send({ code: 'SESSION_REVOKED' })
  }
  req.session = session
})

// 2) onRequest — 권한 로드 (캐시)
app.addHook('onRequest', async (req) => {
  if (!req.session) return
  req.grants = await aclCache.get(req.session.s020MemberId)   // 60초 TTL
  req.scope  = await resolveScope(req.session)                // §2-4. 여기서만 해석
})

// 3) preHandler — 라우트별 선언
app.get('/contracts/:id', {
  preHandler: requireScreen('s0300200040', 'VIEW'),
}, handler)
```

```ts
// lib/acl/requireScreen.ts — 판정은 이 파일 안에만 존재한다
export function requireScreen(screen: string, action: Action) {
  return async (req, reply) => {
    const grant = req.grants?.find(g => g.screenCode === screen)
    const ok    = !!grant && grant.actions.includes(action)

    if (!ok) {
      await shadowLog.record(req, screen, action, 'DENY')
      if (!ACL_ENFORCE(screen)) return          // ★ 1단계: 기록만 하고 통과
      return reply.code(404).send()             // ★ 403이 아니다. 존재 여부를 숨긴다
    }
    req.grantScope = grant.scope                // SELF | COMPANY
  }
}
```

### ★★ shadow 모드는 화면 접근에만 적용한다

**데이터 스코프(ACL-02/ACL-03)는 처음부터 강제한다.** 스코프까지 shadow로 두면 전환 전까지 남의 회사 데이터가 그대로 나가고, 그건 정확히 8월 사고의 재현이다.

```
화면 접근 판정   shadow 가능   막지 않아도 자기 회사 데이터만 보인다
데이터 스코프    shadow 불가   막지 않으면 남의 회사가 보인다
```

지시서 2-12가 "처음부터 막지 않는다"고 한 것은 **등록 안 된 화면 때문에 실사용자가 막히는 것**을 피하려는 것이다. 스코프는 화면 등록과 무관하므로 그 이유가 적용되지 않는다.

## 4-3. 캐시 전략

| 항목 | 값 | 이유 |
|---|---|---|
| 키 | `s020_member_id` | `memberId`가 `orgId`를 함축한다 (한 회원 = 한 조직) |
| 값 | `ScreenGrant[]` 전체 | 목록 1회 조회. 화면마다 묻지 않는다 |
| TTL | **60초** | |
| 저장 | 인메모리 LRU → 다중 인스턴스 시 Redis | 세션 저장소와 같은 판단 |
| 예열 | 로그인 직후 1회 | 첫 화면 지연 제거 |
| 무효화 | 로그아웃 · 토큰 갱신 시 | |

**TTL 60초가 권한 변경의 유일한 반영 경로다.** 삐용에서 권한을 바꿔도 ERP에 통보할 수단이 없다. 60초는 "관리자가 바꾸고 사용자에게 새로고침을 시키는" 현실적인 상한이다. 5분은 길고, 10초는 삐용에 부하가 간다.

### 삐용이 응답하지 않을 때

| 단계 | 캐시 상태 | 동작 |
|---|---|---|
| 1단계 (shadow) | 무관 | 통과 + 기록. 어차피 막지 않는다 |
| 2단계 (enforce) | 유효한 stale 있음 | **stale-while-error, 최대 5분.** 계속 통과 |
| 2단계 (enforce) | 캐시 없음 | **fail-closed.** 503 + "권한 서버에 연결할 수 없습니다" |

**fail-open으로 두지 않는다.** 삐용이 죽었을 때 전 화면이 열리면 그게 사고다. 다만 이미 일하던 사람이 삐용 재기동 때문에 튕기는 것도 사고이므로 stale 5분을 둔다.

## 4-4. 단계적 적용

```
1단계  전역 shadow          막지 않고 "막았을 것"만 기록
        ↓  DENY 기록이 화면별로 0건이 되면
1.5단계 화면별 enforce       기록 0건인 화면부터 하나씩 켠다
        ↓  7일 연속 전 화면 DENY 0건
2단계  전역 enforce         실제 차단
```

```ts
// lib/acl/enforce.ts
const ENFORCE_MODE = process.env.ACL_ENFORCE_MODE   // 'shadow' | 'partial' | 'all'
const ENFORCED_SCREENS = new Set(['s0300200010', 's0300200040', ...])

export function ACL_ENFORCE(screen: string) {
  if (ENFORCE_MODE === 'all')    return true
  if (ENFORCE_MODE === 'shadow') return false
  return ENFORCED_SCREENS.has(screen)
}
```

**전환 게이트 3가지 — 전부 충족해야 다음 단계로 간다.**

1. 해당 화면의 DENY 기록이 7일 연속 0건
2. 그 화면이 삐용 화면 마스터에 등록되어 있음을 SQL로 확인
3. 실제 계정(운영사 1 · 입주사 1 · 미구독 1)으로 화면 진입 확인

**모바일이 생기면 전환 전에 전 화면 회귀 확인을 다시 한다**(지시서 2-12). 모바일 라우트는 화면코드가 다르거나 없을 수 있고, 그 순간 마스터에 없는 화면이 대량으로 생긴다.

## 4-5. shadow 로그 테이블

```
tb_s030_t001.tb_s030_acl_shadow_log
  log_id           bigserial PK
  occurred_at      timestamptz NOT NULL DEFAULT now()
  s020_member_id   int
  s020_org_id      int
  screen_code      text          -- ERP 화면 ID
  action           text          -- VIEW | CREATE | UPDATE | DELETE
  verdict          text          -- DENY | ALLOW_STALE | NO_GRANT_LIST
  route            text          -- 실제 라우트
  http_method      text
  enforced         boolean       -- 이 시점에 실제로 막았는가
  INDEX (occurred_at DESC)
  INDEX (screen_code, occurred_at DESC)
```

**ALLOW는 기록하지 않는다.** 전량 기록하면 로그가 데이터보다 커진다. DENY와 비정상 상태만 남긴다.

일일 확인 쿼리:

```sql
SELECT screen_code, action, count(*), max(occurred_at)
  FROM tb_s030_t001.tb_s030_acl_shadow_log
 WHERE occurred_at > now() - interval '1 day'
 GROUP BY 1, 2 ORDER BY 3 DESC;
```

**결과가 나오는 화면은 마스터에 없거나 권한이 안 부여된 화면이다.** 둘 중 어느 쪽인지는 삐용 마스터를 봐야 안다 → 그래서 §6-2의 화면 목록 제출이 선행되어야 한다.

---

# 5. 화면코드 체계

## 5-1. ★ 결론 — ERP 현행 체계를 유지한다

| | 삐용 제안 (지시서 2-7) | ERP 현행 | 채택 |
|---|---|---|---|
| 형식 | `S03` + 업무그룹 3 + 순번 4 = 10자 | `s030` + 업무구분 3 + 순번 4 = 11자 | **ERP 현행** |
| 예 | `S031000010` | `s0300200040` | |
| 팝업 | 순번 뒤 2자리 (`S031000011`) | 접미사 `p1` (`s0300200040p1`) | **ERP 현행** |
| 대소문자 | 대문자 | 소문자 | **마스터 등록 시 대문자** |

**삐용 마스터에 넣을 때만 대문자로 올린다.** `s0300200040` → `S0300200040`, `s0300200040p1` → `S0300200040P1`. 변환은 단순 `toUpperCase()`이므로 매핑 표가 필요 없다.

## 5-2. 근거 세 가지

**① 지시서가 회신을 허용했다.** 2-7의 제목이 "(제안 — 다른 체계를 쓰고 있으면 회신 바람)"이다.

**② 코드는 판단 근거가 아니다.** 지시서 2-7 자신이 못박는다.

> ★ 코드 문자열에서 시스템을 파싱하지 않는다. (…) 화면 마스터가 시스템을 별도 컬럼으로 갖고 있다. **코드는 사람이 읽는 용도지 판단 근거가 아니다.**

소속 기능도 2-6의 제출 항목에 **독립 컬럼**으로 들어간다. 그러면 자릿수가 판정에 관여하지 않는다.

**③ 지시서 체계로 옮기면 순번이 충돌한다.** 여기가 실질적인 이유다.

지시서 업무그룹은 **기능 단위**(100 입주계약 / 200 예약 / 300 세무 / 400 법무 / 500 청구 / 900 공통)이고, ERP 업무구분은 **화면 조직 단위**(000 공통 / 010 기준설정 / 020 입주사관리 / 030 세무 / 040 법무 / 050 공개 / 060 공간운영)다. 기준설정과 입주사관리가 **둘 다 OFFICE 기능**이므로 같은 그룹 100으로 들어간다.

```
s0300100010 센터 관리    → S03 100 0010
s0300200010 입주사 목록  → S03 100 0010     ★ 충돌
```

피하려면 27개 화면의 순번을 전면 재부여해야 하고, 그러면 `SWONBIZ_SCREEN_LIST.md`·`SWONBIZ_MODAL_COMPOSITION_P1.md`·`SWONBIZ_PROJECT_STRUCTURE.md`·`design/*.dc.html`·파일명 규칙이 전부 바뀐다. **얻는 것은 없고 잃는 것은 27개 화면의 이력 연속성이다.**

## 5-3. ★ 확인 필요 — 마스터 컬럼 길이

**ERP 코드는 11자, 팝업은 13자다.** 삐용 화면 마스터의 화면코드 컬럼이 `char(10)`이나 `varchar(10)`이면 들어가지 않는다. 삐용 기존 코드(`S022300010`)가 10자이므로 그렇게 잡혀 있을 가능성이 있다.

이게 이 절에서 유일한 실제 리스크다. → **회신 항목 ③에 명시적으로 포함한다.**

컬럼이 짧으면 대안 두 가지:

| 안 | 내용 |
|---|---|
| A | 삐용이 컬럼 길이를 `varchar(20)`으로 확장 |
| B | ERP가 마스터 제출용 코드만 별도 부여하고 `lib/screens.ts`에 `bbiyongCode` 필드로 병기 |

B는 코드가 두 개가 되지만, ERP는 이미 **화면 ID와 라우트를 분리**한 전례가 있고 매핑 표를 한 곳(`lib/screens.ts`)에 두는 방식도 같다. 감당 가능하다.

## 5-4. 업무구분 ↔ 소속 기능 매핑

코드는 바꾸지 않되, 제출 시 **소속 기능은 별도 컬럼**으로 정확히 붙인다.

| ERP 업무구분 | 이름 | 소속 기능 | 대상 |
|---|---|---|---|
| `000` | 공통 | **미정 — 회신 ⑮** | 화면별로 다름 |
| `010` | 기준설정 | OFFICE | 운영사 전용 |
| `020` | 입주사관리 | OFFICE (계약·입주사) / **BILLING** (`s0300200070`) | 운영사 전용 |
| `030` | 세무 | TAX | 고객사용 |
| `040` | 법무 | LEGAL | 고객사용 |
| `050` | 공개 화면 | 인증 없음 — **등록 대상 아님 (회신 ⑨)** | 공통 |
| `060` | 공간운영 | BOOKING | 공통 |

**`020`이 두 기능에 걸치는 것이 유일한 예외**이고, 화면 단위로는 깨끗이 갈린다.

### ★ 회신 ⑮ — 공통 화면의 소속 기능이 없다

`tb_s020_module010`의 S03 모듈은 OFFICE·BOOKING·TAX·LEGAL·BILLING 5종뿐이다. 대시보드(`s0300000060`)·설정(`s0300000070`)·셸(`s0300000050`)을 붙일 자리가 없다.

- 삐용 S02에는 `CORE`(단체·부서·회원·권한, mandatory=Y)가 있지만 **시스템이 다르다**
- S03에 `CORE` 성격의 모듈을 추가할 것인가, 아니면 공통 화면은 기능 없이 등록하는가

이 답이 없으면 대시보드와 설정 화면을 마스터에 넣을 수 없고, 그러면 §3-4의 홈 분기가 동작하지 않는다. **회신 우선순위 상위다.**

## 5-5. 팝업·모달에 코드를 부여하는 방법

지시서 2-6이 못박는다: **마스터에 없으면 권한 체크 대상이 없어져 그냥 뚫린다.**

ERP는 이미 `p{n}` 접미사로 팝업에 코드를 주고 있다. 모달·드로어·바텀시트를 구분하지 않고 전부 `p{n}`이다. 규칙 세 가지를 추가한다.

| 규칙 | 내용 |
|---|---|
| **부여 대상** | 독립 데이터를 보여주거나 쓰기 동작이 있는 팝업 전부 |
| **미부여 대상** | 순수 확인 대화상자(예/아니오만 있고 데이터가 없는 것). 부모 화면의 동작으로 판정된다 |
| **판정 방식** | 팝업 진입 시 부모와 **별도로** `requireScreen(p코드, action)`을 부른다 |

현행 목록 점검 결과, `s0300100010p5`(삭제 확인)와 `s0300200040p2`(상태 전이 확인)가 "미부여 대상"에 가깝다. 다만 **삭제와 상태 전이는 쓰기 동작**이므로 코드를 유지하고 `DELETE`·`UPDATE` 동작을 붙인다. 판단이 애매하면 **부여하는 쪽으로 기운다** — 없어서 뚫리는 것보다 있어서 안 쓰는 게 낫다.

## 5-6. ★ 발견 — 화면 안의 운영사 전용 영역이 권한 사각지대다

`SWONBIZ_SCREEN_LIST.md`에 이런 항목들이 있다.

> 월간 뷰는 **운영사 전용**. 입주사는 주간만, 월/주 토글 자체를 렌더링하지 않음
> 입주사는 타사 예약을 "예약됨"으로만 조회 (제목·조직명·인원 마스킹)
> 설정: 입주사는 계정 설정 카테고리만 접근

**이들은 화면코드가 하나뿐이라 권한 체크 단위가 없다.** `s0300600010`에 VIEW 권한이 있으면 월간 뷰도 같이 열린다.

처리 두 가지:

| 대상 | 처리 |
|---|---|
| **월간 뷰** | 별도 화면코드 부여 → **`s0300600011`** 회의실 예약 (월) (운영사 전용) |
| **타사 예약 마스킹** | 화면을 쪼개지 않는다. **서버가 응답에서 필드를 뺀다** (ACL-05·ACL-06) |
| **설정 카테고리** | 카테고리별로 코드를 나누지 않는다. 서버가 응답에서 섹션을 뺀다 |

기준: **다른 데이터 집합이면 화면을 나누고, 같은 데이터의 다른 필드면 서버가 뺀다.** 월간 뷰는 전 회사 예약을 보는 다른 집합이므로 나눈다. 마스킹은 같은 예약의 필드 차이이므로 서버가 뺀다.

---

# 6. 삐용에 회신할 항목

## 6-1. ① ERP 접속 주소

| 환경 | 주소 | 비고 |
|---|---|---|
| 운영 | `https://erp.swonbiz.com` | |
| 개발 | `https://dev-erp.swonbiz.com` | |
| 로컬 | `http://localhost:3000` | 개발 편의. 운영 허용 목록에는 넣지 않는다 |

**`swonbiz.com` 서브도메인으로 두는 이유는 지시서 1-8이다** — 나중에 쿠키 방식으로 옮길 여지를 남기려면 같은 상위 도메인 아래여야 한다.

### 붙이는 말 두 가지

**(가) 권장 구조에서는 CORS가 실제로 필요 없다.** 브라우저가 삐용을 직접 호출하지 않고 ERP 서버가 서버-서버로 호출하기 때문이다(§3-1). 그래도 허용 목록 등록을 요청하는 것은 폴백 때문이다.

**(나) 삐용 현재 CORS 설정이 위험하다.** `addAllowedOriginPattern("*")` + `setAllowCredentials(true)`. 임의 출처에서 자격증명 포함 요청이 가능하다. 지시서 1-4가 "★ 전체 허용으로 열지 마라"고 한 상태가 **이미 그렇게 되어 있다.** ERP 주소를 추가하는 김에 `*`를 닫아 달라고 요청한다.

`BBIYONG_SECURITY_REPORT.md`의 나머지 5건도 같이 재확인 요청한다.

## 6-2. ② 화면 목록 (마스터 시드용)

**형식은 지시서 2-6 제출 항목 그대로다.** 경로와 동작은 라우트·엔드포인트가 진실원이므로, 현재 확정된 것만 채우고 **미개발 화면은 개발 후 최종 제출한다.**

범례: 성격 `S`=사이드바 화면 / `P`=팝업·모달·드로어 · 대상 `운`=운영사 전용 / `고`=고객사용 / `공`=공통 · 동작은 예상이며 개발 후 확정

### 000 공통

| 화면코드 | 화면 이름 | 경로 | 상위 | 기능 | 성격 | 대상 | 플랫폼 | 동작 |
|---|---|---|---|---|---|---|---|---|
| `S0300000010` | 로그인 | `/login` | — | — | S | 공 | 웹 | **등록 제외** (인증 전) |
| `S0300000010P1` | 조직 선택 | — | S0300000010 | — | P | 공 | 웹 | **회신 ⑩ 대기** |
| `S0300000050` | ERP 셸 | — | — | — | S | 공 | 웹 | **등록 제외** (라우트 없음) |
| `S0300000060` | 대시보드 | `/dashboard` | — | **회신 ⑮** | S | 운 | 웹 | VIEW |
| `S0300000070` | 설정 | `/settings` | — | **회신 ⑮** | S | 공 | 웹 | VIEW · UPDATE |
| `S0300000070P1` | 지점 추가·수정 | — | S0300000070 | 회신 ⑮ | P | 운 | 웹 | CREATE · UPDATE |
| `S0300000070P2` | IP 추가 | — | S0300000070 | 회신 ⑮ | P | 운 | 웹 | CREATE |
| `S0300000070P3` | 화이트리스트 활성 경고 | — | S0300000070 | 회신 ⑮ | P | 운 | 웹 | UPDATE |
| `S0300000080` | 접근 권한 없음 | `/no-access` | — | — | S | 공 | 웹 | **등록 제외** (권한 0건일 때의 화면) |

### 010 기준설정 · OFFICE · 운영사 전용

| 화면코드 | 화면 이름 | 경로 | 상위 | 성격 | 동작 |
|---|---|---|---|---|---|
| `S0300100010` | 센터 관리 (건물·층·호실·회의실) | `/facility` | — | S | VIEW |
| `S0300100010P1` | 건물 등록·수정 | — | S0300100010 | P | CREATE · UPDATE |
| `S0300100010P2` | 층 등록·수정 | — | S0300100010 | P | CREATE · UPDATE |
| `S0300100010P3` | 호실 등록·수정 | — | S0300100010 | P | CREATE · UPDATE |
| `S0300100010P4` | 회의실 등록·수정 | — | S0300100010 | P | CREATE · UPDATE |
| `S0300100010P5` | 삭제 확인 | — | S0300100010 | P | DELETE |
| `S0300100020` | 표양식 관리 | 미정 | — | S | *(4차)* |

### 020 입주사관리 · OFFICE / BILLING · 운영사 전용

| 화면코드 | 화면 이름 | 경로 | 상위 | 기능 | 성격 | 동작 |
|---|---|---|---|---|---|---|
| `S0300200010` | 입주사 목록 | `/tenants` | — | OFFICE | S | VIEW |
| `S0300200020` | 입주사 상세 | `/tenants/[id]` | S0300200010 | OFFICE | S | VIEW · UPDATE |
| `S0300200030` | 입주사·계약 마스터-디테일 | `/tenants/contracts` | — | OFFICE | S | VIEW |
| `S0300200030P1` | 계약 상세 | — | S0300200030 | OFFICE | P | VIEW |
| `S0300200030P2` | 계약 등록 (신규·재계약) | — | S0300200030 | OFFICE | P | CREATE |
| `S0300200040` | 계약 폼 | `/contracts/[id]` | — | OFFICE | S | VIEW · CREATE · UPDATE |
| `S0300200040P1` | 계약서 미리보기 | — | S0300200040 | OFFICE | P | VIEW |
| `S0300200040P2` | 상태 전이 확인 | — | S0300200040 | OFFICE | P | UPDATE |
| `S0300200050` | 멤버 관리 | 미정 | — | OFFICE | S | *(2차)* |
| `S0300200060` | 신청 대기 목록 | `/applications` | — | OFFICE | S | *(2차)* |
| `S0300200060P1` | 신청 상세·입주사 전환 | — | S0300200060 | OFFICE | P | *(2차)* |
| `S0300200070` | 월별 청구 관리 | `/billing` | — | **BILLING** | S | VIEW · CREATE · UPDATE *(3차)* |

> `S0300200070`의 대상 구분이 **회신 ⑧**에 걸린다. 지시서 2-10은 청구·수납을 운영사 전용으로 못박았는데 `tb_s020_module010`의 BILLING은 `provider_only_yn='N'`이다.

### 030 세무 · TAX / 040 법무 · LEGAL

*(5차·4차. 화면 미확정. 확정 시 `S0300300010`·`S0300400010`부터 10단위 부여)*

### 050 공개 화면 · 인증 없음

| 화면코드 | 화면 이름 | 경로 | 등록 |
|---|---|---|---|
| `S0300500010` | 랜딩 페이지 | `/` | **제외 — 회신 ⑨** |
| `S0300500010P1` | 상담 문의 모달 | — | 제외 |
| `S0300500020` | 온라인 신청 폼 | `/apply` | 제외 *(보류)* |
| `S0300500030` | 신청 접수 완료 | — | 제외 *(보류)* |
| `S0300500040` | 외부 회의실 예약 | `/booking-request` | 제외 *(2차, 보류 해제)* |
| `S0300500050` | 외부 예약 접수 완료 | — | 제외 *(2차)* |
| `S0300500060` | 회의실 현황판 (키오스크) | `/kiosk` | 제외 |
| `S0300500070` | 문의상담 목록 | `/inquiry` | 제외 |
| `S0300500070P1` | 문의하기 | `/inquiry/new` | 제외 *(모달이 아니라 페이지)* |
| `S0300500070P2` | 글 보기 (비밀번호 확인) | `/inquiry/{id}` | 제외 |

> **`050`은 업무가 아니라 인증 여부로 묶은 그룹이다.** 라우팅 미들웨어에서 인증 제외로 걸기 위한 구분이며, 권한 마스터 등록 대상이 아니다. 다만 지시서 2-6이 "마스터에 없으면 그냥 뚫린다"고 경고했으므로 **의도된 공개임을 명시 합의해야 한다.** → 회신 ⑨.
>
> 외부 예약 API는 요청 본문의 회사·건물 식별자를 무시하고 **서버 상수**를 쓴다(지시서 2-11, BOOK-EXT-01). 인증 없이 열리는 것은 **빈 시간 조회와 신청 등록 둘뿐**이다.

### 060 공간운영 · BOOKING

| 화면코드 | 화면 이름 | 경로 | 상위 | 성격 | 대상 | 플랫폼 | 동작 |
|---|---|---|---|---|---|---|---|
| `S0300600010` | 회의실 예약 (주) | `/booking` | — | S | 공 | 웹·모바일 | VIEW · CREATE · UPDATE · DELETE |
| `S0300600011` | 회의실 예약 (월) | `/booking?view=month` | S0300600010 | S | **운** | 웹 | VIEW |
| `S0300600010P1` | 예약 등록·수정 | — | S0300600010 | P | 공 | 웹·모바일 | CREATE · UPDATE · DELETE |
| `S0300600020` | 외부 예약 승인 큐 | `/booking/approvals` | — | S | 운 | 웹 | VIEW *(2차)* |
| `S0300600020P1` | 승인·반려 | — | S0300600020 | P | 운 | 웹 | UPDATE *(2차)* |

> `S0300600011`은 이번 검토에서 **신설**한다(§5-6). 월간 뷰가 운영사 전용인데 화면코드가 없어 권한 체크 대상이 없었다.

### 제출 요약

| 구분 | 건수 |
|---|---:|
| 마스터 등록 대상 | **27** (사이드바 화면 12 · 팝업 15) |
| 등록 제외 (인증 전·공개·라우트 없음) | 11 |
| 미확정 (세무·법무) | — |

## 6-3. ③ 화면코드 체계

**다른 체계를 쓰고 있다. 현행 유지를 제안한다.** 근거는 §5-2.

```
형식     S03 + 0 + 업무구분 3자리 + 순번 4자리 [+ P{n}]
길이     11자 (팝업 13자)
예       S0300200040 / S0300200040P1
```

**확인 요청:** 화면 마스터의 화면코드 컬럼 길이가 11자(팝업 13자)를 받는가. 삐용 기존 코드가 10자(`S022300010`)라 `char(10)`으로 잡혀 있을 수 있다. 짧으면 §5-3의 대안 A(컬럼 확장) 또는 B(제출용 코드 별도 부여) 중 선택이 필요하다.

## 6-4. 추가 확인 요청

기존 4장의 ④~⑦(토큰 저장 위치 · TTL·갱신 · 토큰 내용 · 로그인 API 규격)에 더해, 이번 검토에서 나온 것들이다. **우선순위 순으로 적는다.**

| # | 항목 | 막는 것 | 우선순위 |
|---|---|---|---|
| **⑫** | **권한 조회 API 규격.** 접근 가능 화면 **목록** 조회 엔드포인트가 있는가. 없으면 만들어 줄 수 있는가. 응답에 화면코드·동작·범위 세 가지가 들어가는가. 화면 단건 조회만 있으면 요청마다 왕복이 붙어 쓸 수 없다 | 권한 연동 전체 (§4). 홈 분기(§3-4), 사이드바(ACL-07′) | **최상** |
| **⑮** | **공통 화면의 소속 기능.** 대시보드·설정·셸을 붙일 S03 모듈이 없다(OFFICE·BOOKING·TAX·LEGAL·BILLING 5종뿐). S03에 CORE 성격 모듈을 추가하는가, 기능 없이 등록하는가 | 대시보드·설정 마스터 등록 → 홈 분기 | **최상** |
| **⑪** | **삐용 미사용 입주사(D사)의 계정 생성 경로.** 삐용에 org + member만 만들고 삐용 모듈은 구독하지 않는 것이 가능한가. 절차·화면·소요 시간은 | D사 담당자 로그인 (§1-3) | 높음 |
| **⑯** | **화면 마스터 시드 리드타임.** 화면 목록을 제출한 뒤 SQL 시드까지 며칠 걸리는가. 개발 중 화면이 계속 늘어나므로 배치 주기 합의가 필요하다 | 개발 속도. 시드가 늦으면 shadow 1단계에서 나갈 수 없다 | 높음 |
| **⑬** | **삐용 조직 목록 조회 API.** 입주사↔삐용 org 연결 화면에서 목록이 필요하다. 없으면 `org_id` 수기 입력으로 시작한다 | E사 연결 화면 UX (§1-4) | 중간 |
| ⑧ | **BILLING의 `provider_only_yn`.** 지시서 2-10은 청구·수납을 운영사 전용이라 했는데 `module010`은 `'N'`이다. 어느 쪽인가 | `S0300200070` 대상 분류 (ACL-11) | 중간 |
| ⑨ | **`050` 공개 화면의 마스터 등록 여부.** 인증 없이 여는 화면을 등록하는가, 제외하는가 | 제출 범위 (ACL-09) | 중간 |
| ⑩ | **겸직 지원 여부.** `tb_s020_member010.org_id`가 단일 컬럼이다. 한 회원이 여러 조직에 속할 수 있는가 | AUTH-02, `S0300000010P1` 존폐 | 중간 |
| ⑭ | **refresh 회전 도입 시점.** 지금은 회전이 없다. 켜기 전에 알려주면 ERP가 분산 잠금으로 교체한다 | AUTH-07 (§3-3) | 낮음 (사전 통보만) |
| ⑤ | **가동계 `code010`의 TTL 실값.** `JWT_EXPIRE_ACCESS`/`JWT_EXPIRE_REFRESH` 행이 있는가. 없으면 30분/7일 폴백. **바꾸면 통보 필요** (삐용 재기동 전까지 반영 안 됨) | ERP 세션 TTL (§3-3) | 낮음 |

---

# 7. 지금 바로 진행할 수 있는 것

**삐용 회신 없이 시작 가능한 것들이다.** 우선순위 순.

| # | 작업 | 산출물 | 막히는 것 |
|---|---|---|---|
| **1** | **Prisma 앱 소스 grep 3종** — `MIGRATION_A_PLAN.md` §2 ①. 앱 소스에 접근 가능해졌으므로 즉시 | 우회 지점 목록 (0건이면 `schema.prisma` 한 파일) | 없음 |
| **2** | **스키마 이동 실행** — 백업 → 앱 정지 → `migrations/001_move_erp_to_s030.sql` → 검증 2종 | `tb_s030_t001` 29테이블 | 1번 |
| **3** | **`tenant_id` → `operator_id` 개명**을 이동 트랜잭션에 포함 (§2-4 ①) | 격리축 혼동 제거 | 2번과 동시 |
| **4** | **조직 연결 컬럼 추가** — O1~O6, O8 (§2-5) | `002_add_org_link.sql` | 2번 |
| **5** | **`lib/screens.ts` 전량 작성** + 마스터 제출표 생성 스크립트 | §6-2 표를 코드에서 뽑는 구조 | 없음 |
| **6** | **`BbiyongAcl` 인터페이스 + `MockBbiyongAcl`** (§4-1) | 권한 규격 미확정 상태로 전 화면 개발 가능 | 없음 |
| **7** | **shadow 로그 테이블 + `requireScreen` 훅 골격** (`ACL_ENFORCE_MODE=shadow`) | `003_acl_shadow_log.sql`, `lib/acl/` | 4번 |
| **8** | **스코프 헬퍼 + 격리 실패 테스트** (§2-4) | `lib/scope/`, 실패 케이스 4종 | 4번 |
| **9** | **랜딩·로그인 UI 이관** — `S0300500010`, `S0300000010`. 디자인 완료 상태 | Next.js 화면 2종 | 없음 |
| **10** | **폐기 화면 3종 제거** + 로그인 화면 "비밀번호 찾기"를 삐용 링크로 | 오해 제거 | 없음 |
| **11** | **`S0300000080` 접근 권한 없음 화면** 신설 (AUTH-13) | 화면 1종 | 없음 |
| **12** | **`public` 잔여 grant 닫기** — `User`·`tb_cm_file`·`_prisma_migrations` | 보안. 이동과 독립 | 2번 |
| **13** | **계약 확장 테이블** — N1~N8 (§2-5). 1차 최대 난이도 화면의 전제 | `004_contract_extend.sql` | 4번 |
| **14** | **예약 배타 제약 + 타임존** — C1·C2. 예약만 우선 전환 | `005_booking_integrity.sql` | 4번 |

**1~4번이 임계 경로다.** 스키마가 자리를 잡아야 나머지가 그 위에 선다. 데이터가 시드 370행뿐이라 지금이 가장 싼 시점이고, 운영 데이터가 들어간 뒤에는 같은 작업이 몇 배가 된다.

**6번이 가장 값어치가 크다.** 권한 API 규격(회신 ⑫)이 언제 올지 모르는데, 어댑터 인터페이스를 먼저 정해 두면 그 미지수가 화면 개발을 하루도 막지 않는다. 규격이 오면 `HttpBbiyongAcl.ts` 한 파일을 쓴다.

---

# 8. 남은 결정 항목

분석으로 못 정한다. 사업·운영 결정이 필요하다.

| # | 질문 | 막는 것 | 성격 |
|---|---|---|---|
| 1 | **기존 Next.js 앱을 흡수·동결·폐기 중 무엇으로 하는가** (§2-3) | 이동 후 전환 계획 | 운영 |
| 2 | 흡수라면 **전환 기간에 도메인별 소유 앱을 어떻게 나누는가** | 쓰기 충돌 방지 | 운영 |
| 3 | **D사(삐용 미사용 입주사)에 삐용 껍데기 계정을 만드는 것을 받아들이는가** (§1-3) | D사 로그인 | 사업 |
| 4 | 마이그레이션 도구 — **Prisma 유지 vs Drizzle 이관** | PLAT-01 | 기술 |
| 5 | 청구가 이미 구현된 상태에서 **"3차 분리"를 유지하는가** | 로드맵 | 사업 |
| 6 | **prod(55322)를 기동해 스키마를 대조**할 수 있는가 | 드리프트 확인 | 운영 |
| 7 | **RLS 전면 비활성 + anon 전권을 언제 닫는가** (`public` 잔여분) | 보안 | 운영 |
| 8 | 한 입주사의 **동시 복수 계약** 허용 여부 | 계약 폼 설계 | 운영 |
| 9 | **사업자/개인 정책 3건** (예비창업자·법인/개인사업자·비사업자 계약서) | `S0300500020` 보류 해제 | 사업 |

---

## 7. ★ 운영 위험 2건 (2026-09-12 등록)

코드로 막을 수 없고 **운영 절차에 기대고 있는** 위험이다. 기대고 있다는 사실 자체를
적어 둔다 — 적어 두지 않으면 "왜 아무도 안 막았나"를 사고 뒤에 묻게 된다.

### 7-1. `ERPCORE` 를 빠뜨리면 그 회사는 화면 틀이 없다

`ERPCORE` 는 **일반 모듈**이라 자동으로 붙지 않는다. `CORE` 와 다르다 — 운영자가
삐용 화면에서 ERP 모듈과 **함께 손으로 체크해야 한다.**

```
BOOKING 만 켜고 ERPCORE 를 빠뜨림
  → 그 회사는 로그인은 되는데 셸(s0300000050)·대시보드·접근권한없음 화면이 없다
  → 사이드바도 상단 바도 없는 빈 화면이 뜬다
```

증상이 "권한 문제"로 보이지 않고 "화면이 깨졌다"로 보고되기 때문에 원인을 찾는 데
시간이 걸린다. **구독을 켤 때마다 `ERPCORE` 가 함께 켜졌는지 확인한다.**

ERP 가 요청했던 "ERP 모듈 중 하나라도 켜면 `ERPCORE` 자동 부착"은 받아들여지지
않았다(회신 5 §6). ERP 구독사가 늘어 자동화가 가능해지면 다시 요청한다.

### 7-2. 단체코드 `Z` 대역은 아직 약속일 뿐이다

ERP 입주사의 단체코드는 `Z01` 부터 순번으로 ERP 가 발급한다. **첫 자리 `Z` 를 ERP
몫으로 비워 달라고 삐용에 요청한 상태이고, 회신 대기 중이다**(`BBIYONG_REPLY_6.md`).

```
요청: 삐용 단체 등록에서 첫 자리가 Z 면 서버가 거부하도록 검증
현재: 서버 검증 없음 — 운영 약속에만 기대고 있다
```

약속이 뚫리면 코드가 겹치고, **부서코드가 단체코드를 접두사로 물려받는 구조**라
부서코드까지 같이 꼬인다. 되돌리기 어렵다.

당장 개발이 막히지는 않는다 — 중복 응답이 오면 다음 번호로 재시도하는 로직은 어차피
필요하고(3-2), 대역이 나뉘면 그 로직이 거의 돌지 않게 될 뿐이다. **다만 `Z` 로 시작하는
단체가 하나라도 생긴 뒤에는 정리 비용이 생긴다.**

---

## 부록 — 이 문서가 바꾼 것

기존 문서 대비 변경·추가된 판정만 모았다.

| 항목 | 기존 | 이 문서 |
|---|---|---|
| 토큰 저장 위치 | 브라우저 저장소 + SEC-01 감수 (`AUTH_ACL_RECONCILIATION` §1.1) | **서버 세션 + 불투명 쿠키.** 지시서와 충돌하지 않음 (§3-1) |
| 홈 분기 근거 | 삐용 목록의 첫 화면 (AUTH-09′) | **대시보드 화면 권한 유무**로 분기. 결과는 요구대로, 판정 주체는 삐용 (§3-4) |
| shadow 범위 | 권한 판정 전체 (ACL-08) | **화면 접근만.** 데이터 스코프는 처음부터 강제 (§4-2) |
| C7 역할 저장 | 5종 저장 · 2종 분기 (`SCHEMA_ANALYSIS` §3.3) | **저장하지 않는다.** 지시서 2-1 (§2-5) |
| N9 정체성 매핑 | 매핑 테이블 (`SCHEMA_ANALYSIS` §3.4) | **컬럼 하나로 축소** (O1) |
| `tenant_id` | 격리축 재설계 필요 (`SCHEMA_ANALYSIS` §3.1) | **`operator_id`로 개명.** 격리축은 `company_id` 단일 (§2-4) |
| `companies.build_id` | 언급 없음 | **NOT NULL 해제.** 한 회사 두 건물 입주가 막힌다 (O8) |
| 월간 예약 뷰 | 화면코드 없음 | **`S0300600011` 신설.** 권한 사각지대였다 (§5-6) |
| 접근 권한 없음 화면 | 요구사항만 (AUTH-13) | **`S0300000080` 화면코드 부여** (§3-4) |
| 회신 항목 | ①②③ + ⑧⑨⑩ | **⑪~⑯ 6건 추가.** ⑫·⑮가 최우선 (§6-4) |
