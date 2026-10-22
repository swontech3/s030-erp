# SwonBiz ERP — 기존 스키마 분석

**작성일:** 2026-09-05
**대상 DB:** `192.168.0.14:54322/postgres` (PostgreSQL 17.6, Supabase 로컬 dev)
**추출물:** `doc/existing_schema.sql` (public 스키마 DDL, 1105줄 · 구조만, 데이터 없음)
**대조 기준:** `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md` (v1 요구사항 83건)
**DB 변경:** 없음 — 전 과정 읽기 전용

---

## 0. 먼저 알아야 할 세 가지

이 분석의 결론은 "설계를 조금 손보면 된다"가 아니다. **1차 설계가 전제로 삼은 사실 세 가지가 실제 DB와 다르다.**

### ① ERP는 이미 존재한다 — `public.tb_s080_*` 32개 테이블

건물·층·호실·시설·입주사·계약·예약·청구·수납·정산이 **이미 구현되어 있고 데이터도 들어 있다.** Prisma 마이그레이션 35건이 2026-06-05부터 2026-07-02까지 적용된, 활발히 개발 중인 스키마다.

REQUIREMENTS.md의 v1 요구사항 83건 중 스키마가 필요한 항목 대부분이 이미 테이블을 갖고 있다. 심지어 **3차로 미룬 청구(BILL-01~05)까지 구현되어 있다** — `tb_s080_invoices`, `tb_s080_invoice_lines`, `tb_s080_payments`, `tb_s080_settlements`, 그리고 국세청 승인번호 필드 `nts_confirm_num`까지.

> PROJECT.md는 "이 프로젝트는 백지에서 시작하지 않는다"고 쓰면서 **디자인 산출물만** 기존 자산으로 셈했다. 실제로는 **DB 스키마도 기존 자산**이고, 그 규모가 디자인보다 크다.

### ② 테이블 접두어 전제가 사실과 다르다

| PROJECT.md의 전제 | 실제 DB |
|---|---|
| ERP 테이블은 `s030_*` 접두어 필수 | 기존 ERP는 `public.tb_s080_*` |
| 삐용은 `s020_*` 접두어로 같은 네임스페이스 공유 | 삐용은 **별도 스키마** `tb_s020_t001` |
| 법무·세무는 `s040_*` | 법무(법인설립·법인변경)는 이미 `public.tb_s080_*` 안에 있음 |

DB의 네임스페이스 분리 방식은 **접두어가 아니라 스키마**다:

```
postgres
├── public          ← ERP (tb_s080_*, 32테이블) + tb_cm_file + User
├── tb_s020_t001    ← 삐용 (tb_s020_*, 18테이블) — 인증·조직·권한
└── tb_s090_t001    ← 메일 Agent (tb_s090_*, 17테이블, pgvector)
```

`s030_*` 접두어로 새 테이블을 만들면 **네 번째 계보**가 생긴다. 통합이 아니라 분열이다.

> ★ **DB 접두어 정의(2026-10-22 결정)** — `tb_s080_` = 공통 접두어. ERP 저장소의 표는 서비스(S03 ERP · S04 법무 · S05 세무 · 공용 자료)와 상관없이 모두 `tb_s080_` 으로 만들고, 어느 서비스 표인지는 표 설명(COMMENT)에 적는다. 삐용 `tb_s020_`(스키마 `tb_s020_t001`) · 메일 Agent `tb_s090_`(스키마 `tb_s090_t001`)은 그대로.

### ③ "범위 밖"으로 밀어둔 권한 시스템이 이미 ERP를 등록해 놓았다

PROJECT.md는 *"별도 권한 시스템(13테이블·모듈 구독·역할 템플릿) — 경계 미확정. 1차는 운영사/입주사 2역할 분기만"* 이라며 범위에서 제외했다. 실제 `tb_s020_t001`에는 그 시스템이 있고, **ERP가 이미 그 안에 등록되어 있다:**

```
tb_s020_system010                     tb_s020_module010 (system_code=S03)
  S02  삐용        base_path /          OFFICE   입주계약관리
  S03  ERP         base_path /erp       BOOKING  회의실 예약
  S09  메일 Agent  base_path /MailAgent BILLING  청구.수납
                                        LEGAL    법무 서비스
  (3행 모두 2026-09-01 생성)             TAX      세무서비스
```

**2026-09-01** — 이 프로젝트가 초기화된 바로 그날 등록되었다. 그리고 역할 코드 `RES_TP`에는 **5개 역할**이 정의되어 있다:

| 코드 | 역할 | 설계상 매핑 |
|---|---|---|
| `A` | 에스원비즈 관리자 | 운영사 |
| `S` | 에스원비즈 운영자 | 운영사 |
| `E` | 일반직원 | 운영사 |
| `C` | 입주사 대표 | 입주사 |
| `M` | 입주사 직원 | 입주사 |

설계의 "운영사/입주사 2역할"은 이 5역할을 2개로 뭉갠 것이다. 1차에 2역할만 쓰는 건 선택으로 정당하지만, **역할 값을 2개로 저장하면 나중에 5역할로 되돌릴 수 없다.** 저장은 5역할, 분기는 2역할이 옳다.

---

## 1. 접속 정보 정정

지시받은 `DB_PORT=5432`로는 접속되지 않는다. 해당 호스트에서 5432는 닫혀 있다 (ping은 응답, TCP는 거부).

`s02-back.zip`의 `application-dev.yml`에서 실제 접속 정보를 확인했다:

| 환경 | JDBC URL | 상태 |
|---|---|---|
| dev | `jdbc:postgresql://192.168.0.14:54322/postgres` | **접속됨** ← 이번 분석 대상 |
| prod | `jdbc:postgresql://192.168.0.14:55322/postgres` | 포트 닫힘 (미기동) |

54321(Supabase API)도 열려 있다. 전형적인 Supabase 로컬 스택 포트 배치다.

`.env`는 **54322**로 작성했고, 5432가 왜 아닌지 주석으로 남겼다. `.gitignore`에 `.env` 추가 완료.

---

## 2. STEP 2 — 스키마 전수 조사

### 2.1 `public` 전체 테이블 (32개)

행 수는 dev 데이터 기준.

| # | 테이블 | 역할 | 행 | ERP 관련 |
|---|---|---|---|---|
| 1 | `tb_s080_tenant010` | **운영사**(에스원비즈 자신) | 1 | ◎ 핵심 |
| 2 | `tb_s080_buildings` | 건물 | 1 | ◎ 핵심 |
| 3 | `tb_s080_floors` | 층 | 1 | ◎ 핵심 |
| 4 | `tb_s080_spaces` | 호실 | 72 | ◎ 핵심 |
| 5 | `tb_s080_space_room` | 호실↔계약호실 (1:N) | 0 | ◎ 핵심 |
| 6 | `tb_s080_facilities` | 회의실·공용시설 | 1 | ◎ 핵심 |
| 7 | `tb_s080_companies` | **입주사** | 9 | ◎ 핵심 |
| 8 | `tb_s080_members` | 입주사 구성원 | 5 | ◎ 핵심 |
| 9 | `tb_s080_contracts` | 계약 | 5 | ◎ 핵심 |
| 10 | `tb_s080_reservations` | 시설 예약 | 2 | ◎ 핵심 |
| 11 | `tb_s080_invoices` | 청구서 | 31 | ○ 3차 |
| 12 | `tb_s080_invoice_lines` | 청구서 라인 | 31 | ○ 3차 |
| 13 | `tb_s080_payments` | 수납 | 5 | ○ 3차 |
| 14 | `tb_s080_settlements` | 해지 정산 | 0 | ○ 3차 |
| 15 | `tb_s080_code_masters` | 코드 마스터 | 22 | ◎ 기반 |
| 16 | `tb_s080_codes_line` | 코드 상세 (계층형) | 112 | ◎ 기반 |
| 17 | `tb_cm_file` | 공통 첨부파일 (polymorphic) | 48 | ◎ 핵심 |
| 18 | `User` | 앱 사용자 (Prisma) | 1 | ◎ 인증 |
| 19 | `tb_s080_departments` | 운영사 부서 | 2 | △ 2차+ |
| 20 | `tb_s080_employees` | 운영사 직원 | 5 | △ 2차+ |
| 21 | `tb_s080_services` | 서비스 등록부 | 0 | △ 권한 |
| 22 | `tb_s080_menus` | 메뉴 | 0 | △ 권한 |
| 23 | `tb_s080_menu_permissions` | 메뉴 권한 (역할별 CRUD) | 0 | △ 권한 |
| 24 | `tb_s080_incorporations` | 법인설립 | 7 | ✕ 법무(4차) |
| 25 | `tb_s080_incorp_persons` | 법인설립 인적사항 | 12 | ✕ 법무 |
| 26 | `tb_s080_incorp_purposes` | 법인설립 사업목적 | 11 | ✕ 법무 |
| 27 | `tb_s080_corp_changes` | 법인변경 | 10 | ✕ 법무 |
| 28 | `tb_s080_corp_change_officers` | 법인변경 임원 | 0 | ✕ 법무 |
| 29 | `tb_s080_biz_purpose_catalog` | 표준산업분류 카탈로그 | 4 | ✕ 법무 |
| 30 | `tb_s080_form_templates` | 문서 양식 템플릿 (jsonb) | 2 | ✕ 법무 |
| 31 | `tb_s080_doc_form_settings` | 문서 양식 설정 | 10 | ✕ 법무 |
| 32 | `_prisma_migrations` | 마이그레이션 이력 | 35 | — 도구 |

**ERP 1차 직결: 18개 (◎)** · 3차 청구: 4개 (○) · 2차 이후: 5개 (△) · 법무 4차: 8개 (✕)

### 2.2 인접 스키마

**`tb_s020_t001` — 삐용 (18테이블).** 인증 통합의 상대편.

| 테이블 | 행 | 역할 |
|---|---|---|
| `tb_s020_member010` | 18 | 회원 — `member_id`, `org_id`, `member_tp`, `email`, `pwd` |
| `tb_s020_org010` | 6 | 조직 — `org_id`, `org_name`, `org_tp`, `org_code`, `timezone` |
| `tb_s020_token010` | 36 | **세션** — `refresh_token_hash`, `jti`, `device_tp`, `expire_timestamp`, `last_use_timestamp` |
| `tb_s020_system010` | 3 | 시스템 등록부 (S02 삐용 / **S03 ERP** / S09 메일) |
| `tb_s020_module010` | 8 | 모듈 등록부 (S03 = OFFICE·BOOKING·BILLING·LEGAL·TAX) |
| `tb_s020_org_module010` | 0 | 조직별 모듈 구독 |
| `tb_s020_role010` / `role_menu010` / `member_role010` | 0 | 역할·역할별 메뉴·회원 역할 |
| `tb_s020_menu010` / `menu_func010` | 0 | 메뉴·메뉴 기능 |
| `tb_s020_code010` | 41 | 공통 코드 |
| `tb_s020_file010` | 4 | 첨부파일 |
| `tb_s020_event0*` (4개), `enter010` | 0~15 | 경비결재 도메인 |

**`tb_s090_t001` — 메일 Agent (17테이블, pgvector).** ERP와 무관하지만 **참고 가치가 하나 있다:** `tb_s090_member010.link_s020_member_id`, `tb_s090_org010.link_s020_org_id` — 삐용 정체성을 자기 도메인에 연결하는 패턴이 이미 이 DB 안에서 검증되어 있다. ERP의 ACL-01(`s030_org_member`)이 발명해야 할 것이 아니라 **복사하면 되는 패턴**이다.

### 2.3 ERP 핵심 테이블 컬럼 구조

전체 DDL은 `doc/existing_schema.sql`. 여기서는 설계 대조에 필요한 부분만.

**계층: 운영사 → 건물 → 층 → 호실**

```
tb_s080_tenant010   tenant_id(int, PK) name slug ceo_name reg_no law_no
                    home_address business_tp business_kd found_date
        ↓ FK
tb_s080_buildings   build_id(text,PK) tenant_id(int,FK) name address total_floors
                    is_active owner_name owner_phone contract_from/to center_manager
                    biz_reg_no bank_name bank_account account_holder contract_doc_url
        ↓ FK
tb_s080_floors      floor_id(text,PK) building_id(FK) floor_no name area_sqm
                    floor_plan_url monthly_rent deposit
                    has_lounge has_meeting_room has_oa_zone
                    UNIQUE(building_id, floor_no)
        ↓ FK
tb_s080_spaces      space_id(text,PK) build_id(FK) floor_id(FK) room_no room_name
                    room_type(R1/R2/R3/FI/FR/VR/ET) area_sqm capacity
                    standard_fee deposit status(E공실/O점유/R예약)
                    amenities(jsonb) biz_addr_available is_active
                    UNIQUE(floor_id, room_no)
```

`tb_s080_space_room` — 1 Space : N Room. `contract_room`(예: "1-A호")으로 한 호실을 계약 단위로 쪼갠다. **행이 0개** — 설계는 있고 미사용.

**입주사·계약**

```
tb_s080_companies   company_id(text,PK) build_id(FK) company_name company_name_en
                    biz_number(UNIQUE) corp_number ceo_name business_type business_item
                    address/zip_code/address_detail  head_address/head_zip_code/head_address_detail
                    member_type tel fax email website employee_count
                    status(R등록/O이용중/E만료) is_non_tenant memo
        ↓ FK
tb_s080_contracts   contract_id(text,PK) build_id(FK) company_id(FK) space_id(FK,단일!)
                    contract_no start_date end_date
                    monthly_rent tax_fee deposit discount_amount
                    billing_day tax_issue_flag payment_due_days
                    auto_renewal renewal_period_months
                    status(P대기/A계약중/E만료/S해지/C취소)
                    signed_date terminated_date termination_reason
                    contract_room(text) access_route payment_method memo
```

**시설·예약**

```
tb_s080_facilities    facility_id(PK) building_id(FK) floor_id(FK) name facility_type
                      floor_no capacity half_hour_fee min_duration max_duration
                      open_time close_time amenities(jsonb) image_url
                      status is_reservable
        ↓ FK
tb_s080_reservations  reservation_id(PK) build_id(FK) facility_id(FK)
                      company_id(FK) member_id(FK) user_id
                      title start_at end_at attendees purpose usage_fee
                      status(기본 'confirmed') cancelled_at cancel_reason memo
                      INDEX(facility_id, start_at, end_at)   ← 제약 아님, 인덱스일 뿐
```

**청구 (설계상 3차, 실제 구현 완료)**

```
tb_s080_invoices      invoice_id(PK) build_id company_id contract_id invoice_no
                      year_month(char7) issue_date due_date
                      subtotal tax_amount total_amount paid_amount
                      status sent_at nts_confirm_num   ← 국세청 승인번호
                      UNIQUE(contract_id, year_month)
tb_s080_invoice_lines invoice_line_id(PK) invoice_id(FK) pay_item quantity
                      unit_price supply_amount tax_rate tax_amount total_amount sort_order
tb_s080_payments      payment_id(PK) invoice_id(FK) company_id(FK) paid_at amount
                      pay_method bank_name account_last4 receipt_url
                      is_confirmed confirmed_by confirmed_at
tb_s080_settlements   settlement_id(PK) contract_id(FK) terminate_date payment_method
                      total_rent_paid deposit_return discount_clawback
                      usage_charge net_amount settle_type
```

**공통 기반**

```
tb_s080_code_masters  code_id(PK) build_id category name is_system
                      UNIQUE(build_id, category)
tb_s080_codes_line    line_id(PK) build_id+category(FK) code name use_tp sort_order
                      parent_line_id(자기참조 FK) extra(jsonb) is_active is_system
tb_cm_file            id(PK) tenant_id(text) target_type target_id file_purpose
                      original_name storage_path storage_url file_size mime_type
                      INDEX(target_id, target_type)     ← polymorphic 첨부
```

코드 카테고리 22종 / 112행: `ACCESS_ROUTE` `COMPANY_ST` `CONTRACT_ST` `MEMBER_TYPE`(18) `PAY_ST`(7) `PAYMENT_METHOD` `RES_TP` `ROOM_ST` `ROOM_TP`(13) `SHARE_TP` 등.

---

## 3. STEP 3 — 1차 설계와의 차이

### 3.1 개념이 충돌하는 지점 — `tenant_id`

**가장 위험한 차이다. 같은 이름이 반대를 가리킨다.**

| | 설계(REQUIREMENTS.md) | 기존 스키마 |
|---|---|---|
| `tenant_id`의 의미 | **입주사** (격리 단위) | **운영사** (에스원비즈 자신) |
| 격리 축 | `tenant_id` | `build_id` + `company_id` |
| 행 수 | 입주사 수만큼 | **1** (`개발 운영사`) |

ACL-02~06은 전부 "테넌트 스코프"로 서술되어 있다. 그 스코프 헬퍼를 기존 스키마의 `tenant_id`에 걸면 **모든 입주사가 서로를 본다** — 전부 `tenant_id = 1`이기 때문이다. 격리가 통째로 무력화되고, 테스트는 통과한다(값이 다 같으니 오류가 안 난다).

설계의 `tenant_id` ≈ 기존의 `company_id`. 스코프 헬퍼는 `company_id`(입주사) + `build_id`(건물)에 걸어야 한다.

**추가 문제 — 타입이 섞여 있다.** `tenant_id`가 테이블마다 다르다:

- `integer`: `tb_s080_tenant010`, `tb_s080_buildings`, `User`
- `text`: `tb_s080_departments`, `tb_s080_employees`, `tb_s080_corp_changes`, `tb_s080_incorporations`, `tb_s080_doc_form_settings`, `tb_s080_form_templates`, `tb_cm_file`

`text` 쪽은 **FK도 없다**. 조인이 캐스팅을 요구하고, 오타가 조용히 통과한다.

### 3.2 그대로 재사용 가능

| 요구사항 | 기존 자산 | 비고 |
|---|---|---|
| MAST-01~04 | `buildings` `floors` `spaces` `facilities` | 컬럼이 설계보다 풍부 |
| MAST-06 | FK `ON DELETE RESTRICT` | 참조 중 삭제를 **DB가** 막는다 |
| TNNT-01~03 | `companies` | 본점 주소·영문명까지 있음 |
| TNNT-04 | `companies.biz_number` UNIQUE | 중복 차단 완료 |
| CONT-17 | `tb_cm_file` (polymorphic) | 계약 첨부 그대로 사용 |
| BOOK-03/04 | `reservations` | |
| CSCH-05 | `invoices` `invoice_lines` `payments` `settlements` | **설계 요구 초과.** `nts_confirm_num`이 "외부 세금계산서 참조번호" 요구를 이미 충족 |
| ACL-01 패턴 | `tb_s090_*.link_s020_*` | 검증된 연결 패턴 복사 |
| AUTH-07 | `tb_s020_token010` | `refresh_token_hash`+`jti`+`expire_timestamp` — 회전형 리프레시 구조 확인. Blocking Unknown #4의 **구조**는 해소 (TTL 값은 여전히 확인 필요) |
| 코드 체계 | `code_masters` + `codes_line` | 계층형·jsonb extra 지원 |

### 3.3 변경이 필요한 부분

| # | 항목 | 현재 | 필요 | 막는 요구사항 |
|---|---|---|---|---|
| C1 | **타임존** | 전 컬럼 `timestamp(3) without time zone`. DB 세션 TZ만 `Asia/Seoul` | `timestamptz` | **BOOK-07** — "서버 기본 타임존에 의존하지 않는다"를 정면으로 위반. 현재 구조는 서버 TZ에 전적으로 의존 |
| C2 | **예약 중복** | `INDEX(facility_id,start_at,end_at)` — 인덱스일 뿐 | `EXCLUDE USING gist` + `btree_gist` 확장 (취소 제외 `WHERE` 절 포함) | **BOOK-05/06** — "DB 제약으로 차단, 동시 요청에서도 안전". 현재는 동시 요청에 무방비 |
| C3 | **계약↔호실 카디널리티** | `contracts.space_id` 단일 FK (NOT NULL) | 계약 항목 자식 테이블 | **CONT-04/05** — 최대 10행, 주차·사물함 등 호실 없는 항목 |
| C4 | **상태 제약** | `public`에 CHECK 제약 **0개**. 상태는 전부 자유 텍스트 | CHECK 또는 enum + 전이 검증 | **CONT-08** — "API 직접 호출로도 우회되지 않는다" |
| C5 | **계약 상태 어휘** | `P/A/E/S/C` (대기/계약중/만료/해지/취소) | 설계는 `draft/confirmed/terminated/cancelled` | CONT-07. 기존이 **더 정밀**하다(만료 vs 중도해지 구분). 설계 어휘를 기존에 맞추는 쪽을 권함 |
| C6 | **예약 상태** | 기본 `'confirmed'`, 주석상 confirmed/cancelled | `requested` `rejected` 추가 | BOOK-10 |
| C7 | **역할 저장** | `RES_TP` 5역할 정의됨 | 5역할로 저장, 2역할로 분기 | ACL-01. 2역할로 저장하면 되돌릴 수 없음 |
| C8 | **`tenant_id` 타입·FK** | int/text 혼재, text 쪽 FK 없음 | 타입 통일 + FK 부여 | 데이터 정합성 전반 |
| C9 | **누락 인덱스** | `contracts`에 `build_id` 인덱스만 — `company_id`·`space_id` FK와 `end_date`가 미색인. `members.company_id`, `payments.company_id`, `invoices.company_id`도 동일 | FK 컬럼·`end_date` 색인 | **CONT-16**(만료 임박 필터·정렬), TNNT-03, DASH-03 |
| C10 | **코드 중복 데이터** | `ROOM_TP`에 R1·R2·R3·FI·FR·VR이 각 2행씩(13행 중 12행이 중복쌍) | 정리 | 셀렉트 박스에 중복 노출 |

### 3.4 새로 만들어야 하는 부분

| # | 테이블/컬럼 | 요구사항 | 비고 |
|---|---|---|---|
| N1 | `contract_items` (계약 항목, 최대 10) | **CONT-04/05/10** | 유형 구분자 필수 — 호실/주차/사물함/가상오피스/전용데스크. 총액 서버 재계산의 근거 |
| N2 | `contract_users` (계약 사용자, 최대 20) | **CONT-06** | `members`는 입주사 스코프라 계약 스코프를 대체 못 함 |
| N3 | `contract_status_history` | **CONT-11** | 누가·언제·무엇을 |
| N4 | `contracts.contract_type` | **CONT-12** | 이용계약 / 전대차계약 |
| N5 | `contracts.billing_start_date` | **CSCH-01** | 무상기간. 소급 입력 불가 |
| N6 | `contracts.deposit_return_status` | **CSCH-02** | 보유/반환/차감/일부차감. 금액은 있으나 상태가 없음 |
| N7 | 계약 시점 사업자정보 스냅샷 컬럼군 | **CSCH-03** | 현재는 `company_id` 참조만 — 세금계산서 법적 요건 미충족 |
| N8 | `contracts.renewed_from_contract_id` | **CSCH-04** | 자기참조 FK. 재계약 이력 |
| N9 | 삐용↔ERP 정체성 매핑 | **ACL-01** | `link_s020_member_id`/`link_s020_org_id` 패턴 복제 |
| N10 | 예약 정책 기본값 | **MAST-05, BOOK-08/09** | 전사 기본값 테이블 + 1일 무료시간 한도 + 예약가능기간(N일) + 최대 연속 슬롯. `facilities`는 시설별 override만 보유 |

### 3.5 요구사항 커버리지 요약

스키마가 필요한 v1 요구사항 기준:

| 상태 | 건수 | 항목 |
|---|---|---|
| **충족** | 12 | MAST-01~04·06, TNNT-01~04, CONT-17, BOOK-03/04, CSCH-05 |
| **부분 충족** | 8 | MAST-05, CONT-01/02/07/10, BOOK-06/10, ACL-01 |
| **미충족** | 14 | CONT-04/05/06/08/11/12, CSCH-01/02/03/04, BOOK-05/07/08/09 |

**미충족 14건 중 12건이 계약과 예약에 몰려 있다** — 정확히 Core Value("계약을 끝까지 처리")와 1차 최대 화면(계약 폼)이다. 기준관리·입주사는 사실상 완성이고, 청구는 요구 이상이다.

---

## 4. STEP 4 — 적용 및 마이그레이션 전략

### 4.1 세 가지 선택지

**옵션 A — 설계대로 `s030_*` 신규 구축**

`tb_s080_*`를 무시하고 새 테이블을 만든다.

- 장점: 설계 문서와 1:1. 기존 코드 이해 불필요
- 단점: 같은 DB에 **건물·호실·계약이 두 벌** 생긴다. 어느 쪽이 진짜인지 모호해지고, `s02-back`이 계속 `tb_s080_*`에 쓰는 동안 ERP는 `s030_*`에 쓴다. 데이터가 갈라진다. 완성된 청구 4테이블을 버린다
- **판정: 채택 불가.** 실익 없이 분열만 만든다

**옵션 B — `tb_s080_*` 확장 (권장)**

기존 테이블을 그대로 쓰고, 3.3의 변경과 3.4의 신규만 더한다.

- 장점: 데이터 한 벌. 기준관리·입주사·청구를 즉시 획득. 작업량이 미충족 14건으로 국한
- 단점: PROJECT.md의 `s030_*` 제약을 폐기해야 함. `s02-back`(Java/MyBatis)과 스키마를 공유하므로 파괴적 변경 시 양쪽 조율 필요
- **판정: 권장**

**옵션 C — `tb_s080_*` 유지 + ERP 전용 확장만 `s030_*`**

기존은 건드리지 않고 신규 테이블만 새 접두어로.

- 장점: `s02-back` 무영향. PROJECT.md 제약 형식상 유지
- 단점: `contract_items`가 `tb_s080_contracts`를 FK 참조하는데 이름 계보가 다르다. C1(타임존)·C2(예약 배타 제약)는 **기존 테이블 변경 없이는 불가능** — 요구사항을 못 지킨다
- **판정: 절충으로 보이지만 핵심 요구 2건을 포기하게 된다**

### 4.2 권고 — 옵션 B, 4단계

전제: `s02-back`(Java)과 ERP(Next.js+Fastify)가 **같은 테이블을 동시에** 쓴다. 그래서 **덧붙이는 변경(additive)을 먼저, 파괴적 변경(breaking)을 나중에** 배치한다.

**1단계 — 무해한 추가 (양쪽 앱 무영향)**

C9(인덱스), N1~N8(계약 확장), N9(정체성 매핑), N10(예약 정책). 전부 새 테이블 또는 nullable 새 컬럼이라 `s02-back`은 존재조차 모른다. **이 단계만으로 미충족 14건 중 10건이 해소된다.**

**2단계 — 동시성·정확성 (조율 필요)**

- C2 예약 배타 제약: `CREATE EXTENSION btree_gist` → `EXCLUDE` 추가. 기존 2행이 겹치지 않는지 먼저 검증
- C4 상태 CHECK: 기존 데이터가 제약을 통과하는지 확인 후 부여
- C1 타임존: **가장 파괴적.** `timestamp` → `timestamptz` 변환은 `s02-back`의 JDBC 매핑까지 바뀐다. 예약(BOOK-07)만 우선 전환하고 나머지는 3단계로 미루는 분할이 현실적

**3단계 — 정합성 정리**

C8(`tenant_id` 타입 통일 + FK), C10(코드 중복 정리), 나머지 컬럼 타임존 전환.

**4단계 — 어휘 정렬 (코드 레벨, 스키마 무변경)**

C5/C6/C7. 설계 문서의 `draft/confirmed/terminated`를 기존 `P/A/E/S/C`에 맞추고, 역할은 5종 저장·2종 분기로 확정.

### 4.3 도구 문제 — Prisma vs Drizzle

기존 스키마는 **Prisma**가 소유한다(`_prisma_migrations` 35건). PLAT-01은 **Drizzle + drizzle-kit generate**를 규정한다.

두 마이그레이션 도구가 한 스키마를 소유하면 서로의 변경을 드리프트로 인식한다. 셋 중 하나를 골라야 한다:

1. **Prisma 유지** — PLAT-01을 폐기. `s02-back`과 도구가 일치. 가장 마찰 적음
2. **Drizzle 도입, 마이그레이션은 Prisma가 계속 소유** — Drizzle은 읽기 전용 타입 레이어로만. `drizzle-kit generate` 미사용
3. **Prisma → Drizzle 이관** — 35건 이력 재작성. 비용 큼

**권장: 2번.** PLAT-01의 정신("`push` 금지, 마이그레이션 파일 경유")은 지키면서 소유권 충돌을 피한다. 어느 쪽이든 **`drizzle-kit push` 금지는 유효하다** — 그건 세 도메인을 한 DB에서 공유하는 이 환경에서 특히 옳다.

### 4.4 리스크

| 리스크 | 영향 | 완화 |
|---|---|---|
| `s02-back`이 같은 테이블에 계속 쓴다 | 파괴적 변경 시 운영 중단 | 1단계(additive)를 먼저 끝내고, 2단계 이후는 s02-back 팀과 창구 확보 |
| `tenant_id` 의미 혼동 | **격리 실패 — 오류 없이 조용히 새어나감** | 스코프 헬퍼를 `company_id`+`build_id`로 못박고, 다른 입주사 데이터로 실패 테스트 작성 |
| prod DB(55322) 미확인 | dev/prod 스키마 드리프트 가능 | prod 기동 후 동일 추출·비교 필요 |
| 법무 8테이블이 이미 존재 | 4차 계획과 실제 상태 불일치 | 로드맵 재검토 |
| 청구가 이미 구현됨 | "3차 분리" 결정의 전제 붕괴 | 3차 결정 재검토 — 스키마는 이미 있고 화면만 없다 |

---

## 5. 결정이 필요한 항목

분석으로는 못 정한다. 사업·조직 결정이 필요하다.

| # | 질문 | 막는 것 |
|---|---|---|
| 1 | **`tb_s080_*` 확장(옵션 B)으로 갈 것인가?** PROJECT.md의 `s030_*` 제약 폐기 여부 | 이 문서의 모든 후속 작업 |
| 2 | `s02-back`(Java)은 계속 개발되는가, 아니면 ERP가 대체하는가? | 파괴적 변경 가능 시점 |
| 3 | 마이그레이션 도구 — Prisma 유지 vs Drizzle 이관 | PLAT-01 |
| 4 | 청구가 이미 구현된 상태에서 "3차 분리"를 유지하는가? | 로드맵 |
| 5 | 역할을 2종으로 갈 것인가 5종(`RES_TP`)으로 갈 것인가? | ACL-01, 되돌릴 수 없는 저장 형식 |
| 6 | prod(55322)를 기동해 스키마를 대조할 수 있는가? | 드리프트 확인 |

### 기존 Blocking Unknowns 갱신

REQUIREMENTS.md의 7건 중 이번 분석으로 **3건이 진전**됐다.

| # | 원래 항목 | 갱신 |
|---|---|---|
| 3 | `memberId`·org·role 클레임 이름·타입 | **부분 해소** — `tb_s020_member010`이 `member_id`(int), `org_id`(int), `member_tp` 보유. 역할 어휘는 `RES_TP` 5종. 단, **토큰에 실제로 담기는 클레임 이름**은 여전히 미확인 |
| 4 | 삐용 TTL·리프레시 회전 정책 | **구조 해소** — `token010`에 `refresh_token_hash`·`jti`·`expire_timestamp`·`last_use_timestamp`. 해시 저장 + jti 회전형. TTL **값**은 미확인 |
| 5 | 삐용 `org_id` 자동 매칭 가능 여부 | **경로 확인** — `tb_s090_*.link_s020_org_id` 선례 존재. 단 삐용 `org010` 6행과 ERP `companies` 9행의 실제 대응 여부는 데이터 대조 필요 |
| 1, 2 | JWT 알고리즘·시크릿 공유 | 미해소 — 토큰 실물 필요 |
| 6 | 입주사 복수 계약 가능 여부 | **사실상 해소** — `contracts`에 `company_id` 유니크 제약이 없으므로 스키마상 복수 계약 허용. 운영 정책 확인만 남음 |
| 7 | 사업자/개인 구분 3건 | 미해소 |

### 부수 확인 사항

PROJECT.md는 *"도메인이 다르다 — ERP는 `swonbiz.com`, 삐용은 `bbiyong.s-wontech.co.kr`"* 라고 적었다. 그런데 `tb_s020_system010`은 삐용 `base_path=/`, ERP `base_path=/erp`로 **경로 분기**를 등록해 두었다. 앱 내부 라우팅용일 수도 있으나, 별도 도메인 전제와 어긋날 여지가 있어 확인이 필요하다. 쿠키 도메인·CORS·AUTH-03(서버-서버 호출) 설계가 여기에 달려 있다.

---

## 부록 — 재현 방법

```bash
npm install pg                                        # 최초 1회
node scripts/dump-schema.js .env doc/existing_schema.sql
```

접속은 `.env`의 `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`을 읽는다. 추출 스크립트는 `pg_catalog`·`information_schema` 조회만 수행하며 쓰기 구문을 포함하지 않는다.

**이번 세션에서 실행한 쓰기 작업: 없음.**

---

## 6. 추가 조사 (2026-09-06) — 테이블 이동·리네임의 실제 파괴 범위

앞 절의 D1(ERP 테이블을 `tb_s030_t001.tb_s030_*`로 이동·리네임할 것인가)에 대해 사용자가 되물은 것은 **"기존 프로그램 소스는 문제 없나"** 였다. Prisma 앱 소스는 이 PC에 없어 직접 grep하지 못했으므로, **DB에 남아 있는 의존성부터 전수 조사**했다 (`node scripts/inspect-deps.js .env`).

### 6.1 DB 안의 이름 의존성 — 사실상 없다

| 조사 대상 | 결과 |
|---|---|
| `tb_s080`을 참조하는 뷰·머티리얼라이즈드뷰 | **0** |
| `tb_s080`을 참조하는 함수·프로시저 | **0** |
| `tb_s080_*`에 걸린 트리거 | **0** |
| `tb_s080_*`의 RLS 정책 | **0** |
| realtime publication 등록 | **0** |
| `tb_s080_*` → 외부 FK (outbound) | **0** |
| 외부 → `tb_s080_*` FK (inbound) | **1건뿐** — `public."User".tenant_id → tb_s080_tenant010` |

즉 **이름을 붙들고 있는 DB 객체는 FK 하나**다. 스키마 이동(`ALTER TABLE ... SET SCHEMA`)과 리네임은 FK를 자동으로 따라가므로, 이 1건조차 수동 조치가 필요 없다. `public."User"`는 Prisma 앱 자신의 사용자 테이블(1행)이다.

### 6.2 데이터 규모 — 이동 비용이 무의미한 수준

`pg_stat_user_tables.n_live_tup`은 29개 테이블 전부 0으로 나오지만 **이는 통계 미수집이며 사실이 아니다.** 실제 `count(*)` 결과:

| 테이블 | 행 | | 테이블 | 행 |
|---|---:|---|---|---:|
| `codes_line` | 112 | | `incorp_persons` | 12 |
| `spaces` | 72 | | `incorp_purposes` | 11 |
| `invoices` / `invoice_lines` | 31 / 31 | | `corp_changes` | 10 |
| `code_masters` | 22 | | `doc_form_settings` | 10 |
| `companies` | 9 | | `incorporations` | 7 |
| `contracts` | 5 | | `members` / `employees` / `payments` | 5 / 5 / 5 |
| `reservations` | **2** | | `tenant010` / `buildings` / `facilities` / `floors` | 각 1 |
| `menus` · `menu_permissions` · `services` · `settlements` · `space_room` · `corp_change_officers` | 0 | | | |

합계 약 370행. **개발용 시드 데이터이고 운영 데이터가 아니다.** `tenant010`은 `'개발 운영사'` 1행뿐이고 `User`도 관리자 1명뿐이다. 4.1에서 옵션 A의 단점으로 적었던 *"데이터가 두 벌로 갈라진다"* 는 **이 규모에서는 성립하지 않는다.**

### 6.3 4.1의 전제 하나를 정정한다 — s02-back은 `tb_s080_*`를 쓰지 않는다

4.1~4.4는 *"`s02-back`(Java/MyBatis)과 스키마를 공유하므로 파괴적 변경 시 양쪽 조율 필요"* 를 전제로 옵션 B를 권장했다. **이 전제는 틀렸다.** s02-back 소스의 `tb_s080` 참조는 **0건**이며, `tb_s080_*`의 소유자는 Prisma 앱 단독이다 (`_prisma_migrations` 35건, 2026-06-05 ~ 2026-07-02).

따라서:
- 4.2의 "additive 먼저, breaking 나중" 단계 분할은 **s02-back 때문에 필요한 것이 아니다.**
- 4.4 리스크 표의 첫 행("s02-back이 같은 테이블에 계속 쓴다")과 5절 결정항목 2번은 **소멸한다.**
- 조율 상대는 s02-back 팀이 아니라 **Prisma 앱 하나**뿐이다.

### 6.4 남은 미확인 — Prisma 앱 소스 3종 grep

DB 쪽은 깨끗하므로, 옵션 A의 비용은 전적으로 **앱 소스가 테이블 이름을 어떻게 부르는가**에 달렸다.

- Prisma Client만 쓴다면 → `schema.prisma`의 `@@map("tb_s080_...")` 값 교체 + `@@schema` 지정(`multiSchema` preview 필요) + 마이그레이션 1건. **파일 하나로 끝난다.**
- Prisma를 우회하는 호출이 있다면 → 그 지점마다 수정이 필요하다.

우회 지점을 찾는 grep 3종 (앱 소스 루트에서):

```bash
grep -rn "from('tb_s080\|from(\"tb_s080" .   # supabase-js 직접 호출
grep -rn "queryRaw\|executeRaw" .            # Prisma raw SQL
grep -rn "tb_s080" prisma/ supabase/         # 스키마·config 내 하드코딩
```

**셋 다 0이면 옵션 A는 `schema.prisma` 한 파일 작업이다.**

### 6.5 부수 발견 — 보안: RLS 전면 비활성 + anon 전권

`public` 32개 테이블 **전부 `relrowsecurity = off`** 인데, `anon`·`authenticated`·`service_role` 세 역할 모두에 `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` 전권이 부여되어 있다 (87건, Supabase 기본 grant).

이것은 **anon 키만 있으면 브라우저에서 PostgREST로 계약·청구·회원 전체를 읽고 쓸 수 있다**는 뜻이다. 현재 데이터가 시드뿐이라 피해는 없지만, 운영 데이터가 들어가기 전에 반드시 닫아야 한다. 이동/리네임과 무관하게 별도 항목으로 다룬다 — `BBIYONG_SECURITY_REPORT.md` 참조.

### 6.6 부수 발견 — 삐용 모듈 등록부가 갱신되었다

2026-09-01 분석 시점에는 *"등록된 모듈은 CORE·OFFICE·TAX·LEGAL뿐이고 BOOKING은 없다"* 고 기록했으나, **현재 `tb_s020_module010`은 8행이며 S03(ERP) 모듈 5종이 모두 등록되어 있다.**

| module_code | system | 이름 | mandatory | provider_only | use_yn |
|---|---|---|---|---|---|
| CORE | S02 | 단체·부서·회원·권한 | Y | N | Y |
| EXPENSE | S02 | 경비결재 | N | N | Y |
| **OFFICE** | **S03** | 입주계약관리 | N | **Y** | N |
| **BOOKING** | **S03** | 회의실 예약 | N | N | N |
| **LEGAL** | **S03** | 법무 서비스 | N | N | N |
| **TAX** | **S03** | 세무서비스 | N | N | N |
| **BILLING** | **S03** | 청구·수납 | N | N | N |
| MAIL | S09 | 메일 Agent | N | N | Y |

`tb_s020_system010`에도 `S03 / ERP / base_path=/erp`가 등록되어 있다. **삐용이 ERP를 자기 모듈로 품는 구조가 설계에 그치지 않고 등록까지 진행됐다**는 뜻이다 (S03 5종은 아직 `use_yn='N'`, `org_module010` 구독은 0행 — 미개통 상태).

`OFFICE`만 `provider_only_yn='Y'`인 점도 의미가 있다. **입주계약관리는 운영사 전용, 예약·법무·세무·청구는 입주사에도 열리는 모듈**로 이미 구분되어 있다.

### 6.7 부수 발견 — ERP 테이블에 `tenant_id`가 없다

3.1에서 지적한 `tenant_id` 개념 충돌과 관련해, 실제 컬럼을 재확인했다:

- `tb_s080_companies` — `company_id`, **`build_id`**, `company_name`, … (`tenant_id` **없음**)
- `tb_s080_contracts` — `contract_id`, **`build_id`**, `company_id`, `space_id`, …
- `tb_s080_reservations` — `reservation_id`, **`build_id`**, `facility_id`, `company_id`, `member_id`, `user_id`, …
- `tb_s080_members` — `member_id`, **`build_id`**, `company_id`, `user_id`, …

`tenant_id`를 가진 것은 `public."User"` 하나뿐이다. **격리축은 `build_id` + `company_id`이며**, ACL-02의 스코프 헬퍼는 이 두 컬럼 위에 서야 한다. 3.1의 경고가 실측으로 확인됐다.

### 6.8 갱신된 결정 항목

| # | 5절 원안 | 갱신 |
|---|---|---|
| 1 | 옵션 B로 갈 것인가 | **재검토 필요.** 옵션 B를 권장한 근거(데이터 분열·s02-back 공유) 두 가지가 6.2·6.3에서 무너졌다 |
| 2 | s02-back은 계속 개발되는가 | **소멸.** s02-back은 `tb_s080_*`를 쓰지 않는다 |
| 3 | Prisma vs Drizzle | **유효.** 단 조율 상대가 Prisma 앱 하나로 좁혀졌다 |
| 4 | 청구 "3차 분리" 유지 여부 | 유효 |
| 5 | 역할 2종 vs 5종 | 유효. 6.6의 `provider_only_yn` 구분이 입력이 된다 |
| 6 | prod(55322) 대조 | 유효. 여전히 미기동 |
| **7** | *(신규)* | **RLS 전면 비활성 + anon 전권을 언제 닫는가** (6.5) |

### 부록 갱신 — 재현 방법

```bash
npm install pg                                        # 최초 1회
node scripts/dump-schema.js .env doc/existing_schema.sql   # 스키마 덤프
node scripts/inspect-deps.js .env                     # 이름 의존성 조사 (6.1)
node scripts/rowcounts.js .env                        # 실제 행 수 (6.2)
```

셋 다 읽기 전용이며 쓰기 구문을 포함하지 않는다.
