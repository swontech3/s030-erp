# 레거시 데이터 실태 조사 — 호실 · 코드 테이블

**조사 시점:** 2026-09-13
**대상 DB:** `192.168.0.14:54322` / `postgres` / 스키마 `public` — PostgreSQL 17.6
**환경 구분:** ★ **개발계다.** 루트 `.env` 주석이 "삐용(s02-back) **dev** Supabase Postgres"로
명시하고 있고, 같은 인스턴스를 레거시 S-WonERP 도 바라본다.

> **★ 2026-09-13 정정 — 레거시 S-WonERP 는 지금 쓰이지 않는다.**
> 조사 당시 이 문서는 "운영 중인 레거시가 함께 쓴다"를 전제로 「무거운 조회를 피한다」·
> 「컬럼을 지우면 레거시가 깨진다」를 적었다. **그 전제가 틀렸다.** 아무도 쓰지 않는다.
>
> 바뀌는 것: 부하 걱정이 없어지고, 게이트(`004`)의 앱 정지 창 부담이 크게 줄고,
> 레거시가 읽는지 모른다는 이유로 보류했던 판단(§B-5 의 `room_no` 등)의 무게가 달라진다.
> **다만 `room_no` 는 여전히 지우지 않는다** — 4-0 에서 확정한 사항이고, 안 쓰는 컬럼을
> 굳이 지워서 얻을 것이 없다.
>
> 4-1(커밋 `94f411c`)이 `tb_s080_contracts` 에서 컬럼 11개를 드롭했다. 그래서
> **레거시 계약 화면은 지금 오류가 난다.** 쓰지 않으므로 되돌리지 않는다.
**조사 계정:** `postgres` (구조·카탈로그 조회) + `erp_app` (권한 확인용)
**성격:** ★ **읽기 전용.** `SELECT` 외의 문장은 실행하지 않았다.

> **쓰기가 없었음을 보장하는 방법** — 조사 스크립트의 질의 함수가 SQL 앞머리를 검사해
> `SELECT` · `WITH` 로 시작하지 않으면 던지도록 만들었다. `INSERT`/`UPDATE`/`DELETE`/
> `ALTER`/`CREATE`/`DROP`/`GRANT` 는 실행 자체가 불가능했다.
> 저장소 쪽 변경은 이 문서 파일 하나뿐이다(`git status` 로 확인 가능).

---

## 요약 — 한 눈에

| 물음 | 답 |
|---|---|
| 호실 데이터가 있는가 | **있다. 72실** 전부 `is_active=true` |
| 호실에 금액이 있는가 | **있다.** `standard_fee` — 72건 전부 값 있음(NULL 0 · 0원 0) |
| 보증금은 | 컬럼(`deposit`)은 있으나 **72건 전부 NULL** |
| 건물 · 층 | 건물 **1** (우리빌딩) · 층 **1** (3층) · 회의실 **1** (소회의실 A) |
| 코드 5종 | 3종 찾음(계약구분·납부방법·접근경로) · 1종 개념 불일치(회원구분) · **1종 없음(이메일 도메인)** |
| 코드가 입주사별인가 | **아니다.** `(build_id, category)` 로 묶인 **건물별**. 회사 컬럼이 없다 |
| `004` 가 이 테이블들을 건드리는가 | **`spaces`·`code_masters`·`codes_line` 은 건드리지 않는다.** 단 `buildings` 는 대상이다 |
| 권한에 막힌 곳 | **없다.** `erp_app` 로 6개 테이블 전부 조회됐다 |

---

## A. `tb_s080_spaces` — 호실

### A-1. 구조

```sql
SELECT ordinal_position, column_name, data_type,
       coalesce(character_maximum_length, numeric_precision) AS len,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='tb_s080_spaces'
ORDER BY ordinal_position;
```

| # | 컬럼 | 타입 | 길이 | NULL | 기본값 |
|---|---|---|---|---|---|
| 1 | `space_id` | text | | NO | — (PK) |
| 2 | `build_id` | text | | NO | — (FK) |
| 3 | `floor_id` | text | | NO | — (FK) |
| 4 | `room_no` | text | | NO | — |
| 5 | `room_type` | text | | NO | — |
| 6 | `area_sqm` | numeric | 10 | YES | — |
| 7 | `capacity` | integer | 32 | YES | — |
| 8 | **`standard_fee`** | **integer** | 32 | YES | — |
| 9 | **`deposit`** | **integer** | 32 | YES | — |
| 10 | `status` | varchar | 1 | NO | `'E'` |
| 11 | `amenities` | jsonb | | YES | — |
| 12 | `memo` | text | | YES | — |
| 13 | `is_active` | boolean | | NO | `true` |
| 14 | `room_name` | text | | YES | — |
| 15 | `biz_addr_available` | boolean | | NO | `false` |
| 16 | `created_at` | timestamp | | NO | `CURRENT_TIMESTAMP` |
| 17 | `updated_at` | timestamp | | NO | — |
| 18 | `created_by` | text | | YES | — |
| 19 | `updated_by` | text | | YES | — |

```sql
SELECT con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='tb_s080_spaces'
ORDER BY con.contype, con.conname;
```

| 제약 | 정의 |
|---|---|
| `tb_s080_spaces_pkey` | `PRIMARY KEY (space_id)` |
| `tb_s080_spaces_build_id_fkey` | `FOREIGN KEY (build_id) → tb_s080_buildings(build_id) ON UPDATE CASCADE ON DELETE RESTRICT` |
| `tb_s080_spaces_floor_id_fkey` | `FOREIGN KEY (floor_id) → tb_s080_floors(floor_id) ON UPDATE CASCADE ON DELETE RESTRICT` |

**UNIQUE 제약도 CHECK 제약도 없다.** `room_no` 에 중복 방지가 걸려 있지 않다.

### A-2. ★ 금액 컬럼 — 있다

**`standard_fee integer` 가 호실 테이블에 직접 있다.** 계약 폼이 호실을 고르면
이 값을 기본값으로 채울 수 있다.

```sql
SELECT count(*) 전체,
       count(standard_fee) fee_notnull,
       count(*) FILTER (WHERE standard_fee IS NULL) fee_null,
       count(*) FILTER (WHERE standard_fee = 0)    fee_zero,
       count(*) FILTER (WHERE standard_fee > 0)    fee_pos,
       min(standard_fee), max(standard_fee),
       count(deposit) dep_notnull,
       count(*) FILTER (WHERE deposit IS NULL) dep_null
FROM tb_s080_spaces;
```

| 전체 | fee 값 있음 | fee NULL | fee 0원 | fee 양수 | fee 최소 | fee 최대 | deposit 값 있음 | deposit NULL |
|---|---|---|---|---|---|---|---|---|
| 72 | **72** | **0** | **0** | **72** | 50,000 | 1,500,000 | **0** | **72** |

**임대료는 72건 전부 채워져 있다.** NULL 도 0원도 없다.

**★ 보증금(`deposit`)은 72건 전부 NULL 이다.** 컬럼은 있지만 값이 하나도 없다.
새 설계는 계약 항목마다 예치금을 두고 "호실 선택 시 자동 입력"을 요구하는데,
**자동 입력할 원본 값이 지금 없다.**

```sql
SELECT room_type, count(*) n, min(standard_fee), max(standard_fee), min(deposit), max(deposit)
FROM tb_s080_spaces GROUP BY 1 ORDER BY 1;
```

| room_type | 건수 | 임대료(최소=최대) | 보증금 |
|---|---|---|---|
| `VR` 비상주 | 50 | 50,000 | NULL |
| `R1` 1인실 | 10 | 400,000 | NULL |
| `FR` 자유석 | 5 | 250,000 | NULL |
| `FI` 고정석 | 3 | 300,000 | NULL |
| `R2` 2인실 | 3 | 750,000 | NULL |
| `R3` 3인실 | 1 | 1,500,000 | NULL |

타입별로 금액이 **한 값으로 통일**돼 있다(최소=최대). 호실별 개별 단가가 아니라
타입별 기준가를 그대로 복사해 둔 모양이다.

### 다른 곳의 금액 컬럼

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name LIKE 'tb_s080_%'
  AND (column_name ~* '(fee|price|amount|amt|cost|rent|deposit|charge)'
       OR data_type IN ('numeric','money'))
ORDER BY table_name, ordinal_position;
```

호실 외에 금액을 들고 있는 곳은 셋이다.

| 테이블 | 컬럼 | 의미(관측) |
|---|---|---|
| `tb_s080_floors` | `monthly_rent` 4,400,000 · `deposit` 50,000,000 | **층 전체의 임차 조건.** SwonBiz 가 건물주에게 내는 쪽으로 읽힌다 — 입주사 요금이 아니다 |
| `tb_s080_facilities` | `half_hour_fee` 10,000 | 회의실 30분 요금 |
| `tb_s080_contracts` | `monthly_rent` · `tax_fee` · `deposit` · `discount_amount` | 계약에 확정된 금액(아래 D 참조) |
| `tb_s080_invoice_lines` | `unit_price` · `supply_amount` · `tax_amount` · `total_amount` | 청구 라인 |

**→ 계약 폼이 필요로 하는 "호실 기준 임대료"는 `tb_s080_spaces.standard_fee` 하나로 충분하다.
보증금만 원본이 비어 있다.**

### A-3. 데이터 건수와 상태

```sql
SELECT count(*) FROM tb_s080_spaces;                       -- 72
SELECT status, is_active, count(*) FROM tb_s080_spaces GROUP BY 1,2 ORDER BY 1,2;
```

| status | is_active | 건수 | 코드 의미 (`ROOM_ST`) |
|---|---|---|---|
| `E` | true | **66** | 공실 |
| `O` | true | **5** | 입주중 |
| `R` | true | **1** | 예약중 |

**삭제 표시 컬럼은 `is_active` 하나이고, 72건 전부 `true` 다.** 삭제된 행은 없다.
(별도의 `deleted_at` 류 컬럼은 없다.)

```sql
SELECT space_id, build_id, floor_id, room_no, room_name, room_type,
       area_sqm, capacity, standard_fee, deposit, status, is_active, biz_addr_available
FROM tb_s080_spaces ORDER BY room_no LIMIT 5;
```

| space_id | room_no | room_name | type | area | cap | fee | deposit | st | active | 사업자주소 |
|---|---|---|---|---|---|---|---|---|---|---|
| `y6vlufnz…` | `00b88091fce2` | VIR 13 | VR | NULL | NULL | 50000 | NULL | E | true | false |
| `ltqbmx59…` | `02979f58517c` | VIR 45 | VR | NULL | NULL | 50000 | NULL | O | true | false |
| `hglwtfwe…` | `09b00fcff0b9` | VIR 40 | VR | NULL | NULL | 50000 | NULL | O | true | false |
| `lo1kiy0b…` | `0b537243c090` | VIR 26 | VR | NULL | NULL | 50000 | NULL | E | true | false |
| `bsdwtivi…` | `0d62162b3a9c` | VIR 24 | VR | NULL | NULL | 50000 | NULL | E | true | false |

호실은 자산 데이터라 개인정보가 없다. `build_id`/`floor_id` 는 지면상 생략했다.

> ### ★ `room_no` 가 사람이 읽는 호실 번호가 아니다
>
> ```sql
> SELECT count(*) 전체,
>        count(*) FILTER (WHERE room_no ~ '^[0-9a-f]{12}$') hex12,
>        count(room_name) name_있음
> FROM tb_s080_spaces;
> -- 72 | 72 | 72
> ```
>
> **`room_no` 는 72건 전부 12자리 16진 해시**(`00b88091fce2`)다. 사람이 보는 이름은
> **`room_name`**(`VIR 13`)이고 72건 전부 채워져 있다.
> 계약 폼의 호실 Select 에 `room_no` 를 쓰면 운영자에게 해시가 보인다. **`room_name` 을 써야 한다.**
> `area_sqm`·`capacity` 는 상위 5행 전부 NULL 이다 — 전체 분포는 확인하지 않았다.

### A-4. 건물 · 층 계층

**별도 테이블 3단이다.** 호실 테이블 안의 컬럼이 아니다.

```
tb_s080_buildings (build_id PK)
  └─ tb_s080_floors (floor_id PK, building_id FK)
       └─ tb_s080_spaces (space_id PK, build_id FK + floor_id FK)
  └─ tb_s080_facilities (facility_id PK, building_id FK, floor_id FK nullable)
```

★ `tb_s080_spaces` 는 **`build_id` 와 `floor_id` 를 둘 다** 들고 있다(비정규화).
둘 다 FK 가 걸려 있어 정합성은 DB 가 지킨다.

```sql
SELECT (SELECT count(*) FROM tb_s080_buildings) 건물,
       (SELECT count(*) FROM tb_s080_floors)    층,
       (SELECT count(*) FROM tb_s080_spaces)    호실,
       (SELECT count(DISTINCT build_id) FROM tb_s080_spaces) 호실이참조하는건물,
       (SELECT count(DISTINCT floor_id) FROM tb_s080_spaces) 호실이참조하는층;
```

| 건물 | 층 | 호실 | 호실이 참조하는 건물 | 호실이 참조하는 층 |
|---|---|---|---|---|
| **1** | **1** | **72** | 1 | 1 |

```sql
SELECT build_id, tenant_id, name, total_floors, is_active FROM tb_s080_buildings;
SELECT floor_id, building_id, floor_no, name, area_sqm, monthly_rent, deposit,
       has_lounge, has_meeting_room, has_oa_zone FROM tb_s080_floors;
```

| 건물 | `tenant_id` | 이름 | total_floors | 활성 |
|---|---|---|---|---|
| `kpz4i184…` | 1 | 우리빌딩 | **NULL** | true |

| 층 | floor_no | 이름 | 면적 | monthly_rent | deposit | 라운지 | 회의실 | OA |
|---|---|---|---|---|---|---|---|---|
| `cfyhiy4x…` | 3 | 3층 | 37.00 | 4,400,000 | 50,000,000 | true | true | true |

**72실이 전부 「우리빌딩 3층」 하나에 달려 있다.** 화면 목록이 설계한 "건물 셀렉트 + 층 탭"
구조는 데이터상 **각각 1개짜리**라 지금은 선택지가 하나뿐이다.

`tb_s080_facilities`(회의실) 1건 — 소회의실 A, MEETING, 3층, 정원 4, 30분 10,000원, 예약 가능.

`tb_s080_buildings.total_floors` 는 NULL 이고, `floors` 에는 3층 하나만 있다.
**1·2층이 데이터에 없다.** 실제 건물이 1층짜리인지 입력이 덜 된 것인지는 이 조사로 알 수 없다.

### A-5. RLS 상태

```sql
SELECT c.relname, c.relrowsecurity,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) 정책수
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname LIKE 'tb_s080_%';
```

| 테이블 | RLS | 정책 수 |
|---|---|---|
| `tb_s080_spaces` | **꺼짐** | **0** |
| `tb_s080_buildings` · `floors` · `facilities` | 꺼짐 | 0 |
| `tb_s080_code_masters` · `codes_line` | 꺼짐 | 0 |

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='tb_s080_spaces'
  AND column_name ~* '(company|tenant|org)';
-- (0행)
```

**`tb_s080_spaces` 에 `company_id` 류 컬럼이 없다.** 호실은 입주사별로 나뉘지 않는다.

참고로 RLS 가 켜진 테이블은 6개이고 전부 회사 단위로 걸려 있다.

| 테이블 | 정책 | `USING` |
|---|---|---|
| `tb_s080_companies` | `erp_companies_read` (r) | `true` |
| `tb_s080_companies` | `erp_companies_write` (*) | `erp_is_operator()` |
| `tb_s080_contracts` | `erp_company_scope` (*) | `erp_is_operator() OR company_id = erp_current_company_id()` |
| `tb_s080_invoices` · `members` · `payments` · `reservations` · `settlements` | `erp_company_scope` (*) | 위와 같음 |

> **판단이 필요한 자리 — 정하지 않았다.**
> 호실은 운영사 자산이라 RLS 가 꺼져 있는 것이 자연스럽다. 그런데 입주사가 자기 계약의
> 호실명을 보는 경로는 생긴다(계약 상세). 지금 구조에서는 **호실 테이블을 직접 열면
> 입주사가 72실 전부를 본다.** 계약을 경유해 보여줄지, 호실에 읽기 정책을 걸지는
> 이 작업에서 정하지 않는다.

---

## B. `tb_s080_code_masters` · `tb_s080_codes_line` — 코드

### B-1. 구조와 연결

```sql
SELECT ordinal_position, column_name, data_type,
       coalesce(character_maximum_length, numeric_precision), is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('tb_s080_code_masters','tb_s080_codes_line')
ORDER BY table_name, ordinal_position;
```

**`tb_s080_code_masters`** — `code_id`(PK) · **`build_id`** · **`category`** · `name` ·
`description` · `is_system` · 감사 4컬럼

**`tb_s080_codes_line`** — `line_id`(PK) · **`build_id`** · **`category`** · **`code`** ·
`name` · `description` · **`use_tp` varchar(3) 기본 `''`** · **`sort_order` smallint 기본 0** ·
**`is_active` boolean 기본 true** · `is_system` · `extra` jsonb · 감사 4컬럼 · `parent_line_id`

| 제약 | 정의 |
|---|---|
| `tb_s080_codes_line_build_id_category_fkey` | **`FOREIGN KEY (build_id, category) → tb_s080_code_masters(build_id, category)`** |
| `tb_s080_codes_line_parent_line_id_fkey` | `FOREIGN KEY (parent_line_id) → tb_s080_codes_line(line_id)` — 계층 코드 지원 |
| 두 테이블 PK | `code_id` / `line_id` |

**→ 마스터와 라인은 `(build_id, category)` 복합키로 이어진다.**
정렬은 `sort_order`, 사용 여부는 `is_active`. `use_tp`(3자)는 같은 카테고리 안에서
쓰임새를 더 나누는 칸으로 보이는데, **의미가 어디에도 적혀 있지 않다**(D-4 참조).

### B-2. 마스터 전체 — 22종

```sql
SELECT m.category, m.name, m.is_system, count(l.line_id) 라인수
FROM tb_s080_code_masters m
LEFT JOIN tb_s080_codes_line l ON l.build_id=m.build_id AND l.category=m.category
GROUP BY m.category, m.name, m.is_system ORDER BY m.category;
```

| category | 이름 | is_system | 라인수 |
|---|---|---|---|
| `ACCESS_ROUTE` | 접근경로 | ✔ | 7 |
| `ASK_METHOD` | 문의방법 | | 3 |
| `ASK_TP` | 문의종류 | | 2 |
| `CHANGE_FORM_REG_CON` | 변경등기등기할사항 | | 2 |
| `CHANGE_REGI` | 변경등기유형 | | 9 |
| `COMPANY_ST` | 입주상태 | ✔ | 3 |
| `CONTRACT_ST` | 계약상태 | ✔ | 5 |
| `EXEC_TP` | 임원구분 | | 5 |
| `LAW_CNG_TP` | 법인변경등록구분 | | 6 |
| `LAW_DOC_TP` | 법인문서종류구분 | | 2 |
| `LAW_EST_TP` | 법인설립등록구분 | | 3 |
| `LAW_PROG_ST` | 법인설립진행상태 | ✔ | 6 |
| `LICENSE_TP` | 인허가 종류 | | 5 |
| `MEMBER_TYPE` | 회원구분 | ✔ | 18 |
| `PAY_ITEM` | 납부Item | | 1 |
| `PAY_METHOD` | 결제수단 | | 2 |
| `PAY_ST` | 납부상태 | | 7 |
| `PAYMENT_METHOD` | 납부방법 | ✔ | 2 |
| `RES_TP` | 사용자권한 | ✔ | 5 |
| `ROOM_ST` | 호실상태 | ✔ | 3 |
| `ROOM_TP` | 계약타입 | ✔ | 13 |
| `SHARE_TP` | 주주구분 | | 3 |

**총 22종 · 라인 112건.** 전부 `build_id` 하나(우리빌딩)에 달려 있다.

### B-3. ★ 요청한 5종

```sql
SELECT category, code, name, sort_order, use_tp, is_active, extra
FROM tb_s080_codes_line ORDER BY category, sort_order, code;
```

#### ① 회원구분 → `MEMBER_TYPE` — **찾았으나 시안과 개념이 다르다**

| code | name | 순서 | use_tp |
|---|---|---|---|
| `F` | 주식회사 앞 | 1 | 002 |
| `F` | 주식회사 앞 | 1 | 001 |
| `F` | 유한회사 앞 | 1 | 001 |
| `F` | 농/어업회사법인 앞 | 1 | 001 |
| `R` | 주식회사 | 1 | 002 |
| `R` | 주식회사 | 1 | 000 |
| `R` | 주식회사 | 1 | 001 |
| `A` | 유한회사 | 2 | 001 / 002 / 000 |
| `B` | 주식회사 뒤 | 2 | 002 |
| `B` | 유한회사 뒤 | 2 | 001 |
| `B` | 주식회사 뒤 | 2 | 001 |
| `B` | 농/어업회사법인 뒤 | 2 | 001 |
| `C` | 농/어업회사법인 | 3 | 001 / 000 |
| `S` | 사회적 기업/협동조합 | 4 | 000 |
| `P` | 개인 | 5 | 000 |

> **★ 계약 폼 시안의 「회원구분」과 같은 것이 아니다.**
> 시안은 **프리랜서 / 개인사업자 / 법인** 셋이고, 이 값은 **법인 형태**(주식회사·유한회사·
> 농어업회사법인·사회적기업·개인)와 **상호 표기 위치**(「주식회사 앞/뒤」)를 섞어 담고 있다.
> 「앞/뒤」는 회사명 앞에 붙이는지 뒤에 붙이는지를 말하는 것으로 읽힌다 — 법인 설립 서류용이다.
>
> ```sql
> SELECT category, code, name, use_tp FROM tb_s080_codes_line
> WHERE name ~ '(프리랜서|개인사업자|법인|사업자)' ORDER BY category, code;
> ```
> **「프리랜서」·「개인사업자」 문구는 DB 전체에 하나도 없다.**
> 새 설계의 회원구분 3종은 **레거시에 대응하는 코드가 없다.** 판단이 필요하다.

#### ② 이메일 도메인 → ★ **없다**

```sql
SELECT category, name FROM tb_s080_code_masters
WHERE category ~* '(mail|domain|dom)' OR name ~* '(메일|도메인)';        -- 0행

SELECT category, code, name FROM tb_s080_codes_line
WHERE name ~ '(@|\.co\.kr|\.com|naver|gmail|daum)';                      -- 0행

SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND column_name ~* 'domain';
-- tb_s080_doc_form_settings.domain 하나뿐 (문서양식 설정용 — 이메일과 무관)
```

**코드 마스터에도 라인에도 이메일 도메인이 없다.** 비슷한 것을 억지로 대지 않는다.
시안의 도메인 7종(`bridgelab.co.kr`/`naver.com`/…/직접입력)은 **시안에만 있는 하드코딩**이다.

#### ③ 계약구분 → `ROOM_TP` (계약타입) — **찾았으나 항목이 다르다**

| code | name | 순서 | use_tp |
|---|---|---|---|
| `R1` | 1인실 | 1 | 000 / 001 |
| `R2` | 2인실 | 2 | 000 / 001 |
| `R3` | 3인실 | 3 | 001 / 000 |
| `FI` | 고정석 | 4 | 001 / 000 |
| `FR` | 자유석 | 5 | 000 / 001 |
| `VR` | 비상주 | 6 | 000 / 001 |
| `ET` | 기타 | 7 | 001 |

7개 코드가 `use_tp` 000/001 로 나뉘어 13행이다. `tb_s080_spaces.room_type` 이 이 코드를 쓴다.

> **시안과 대조** — 시안: 비상주 / 고정석 / 1인실 / 2인실 / **팀오피스**
> ```sql
> SELECT category, code, name FROM tb_s080_codes_line WHERE name ~ '(팀|오피스|팀오피스)';
> -- 0행
> ```
> **「팀오피스」는 DB 에 없다.** 반대로 DB 에만 있는 것은 **3인실 · 자유석 · 기타** 셋이다.

#### ④ 납부방법 → `PAYMENT_METHOD` — **찾았고 정확히 일치**

| code | name | 순서 |
|---|---|---|
| `M` | 월납 | 1 |
| `C` | 일시불 | 2 |

시안의 「월납 / 일시불」과 **그대로 맞는다.** 5종 중 유일하게 충돌이 없다.

> 혼동 주의 — `PAY_METHOD`(결제수단: `C` 카드 결제 / `B` 계좌이체)는 **다른 카테고리**다.
> 이름이 비슷해 코드에서 바꿔 쓰기 쉽다.

#### ⑤ 접근경로 → `ACCESS_ROUTE` — **찾았으나 항목이 다르다**

| code | name | 순서 |
|---|---|---|
| `D` | 네이버 검색 | 1 |
| `O` | 네이버 블러그 | 2 |
| `R` | 구글 검색 | 3 |
| `A` | 인스타그램 | 4 |
| `X` | 페이스북 | 5 |
| `F` | 지인추천 | 6 |
| `E` | 기타 | 7 |

> **시안과 대조** — 시안: 검색 / 지인소개 / 광고 / 방문
> 레거시가 훨씬 잘다(검색을 네이버·구글로 나누고 SNS 를 셋으로 나눔).
> 시안의 **「방문」에 해당하는 코드가 없다.**
>
> ★ `O` 의 표시명이 **「네이버 블러그」** — 오타로 보인다(블로그).
> 운영 데이터라 여기서 고치지 않는다. 기록만 한다.

### B-4. ★ 이메일 도메인이 전사 공통인가 입주사별인가

**질문 자체가 성립하지 않는다 — 이메일 도메인 코드가 없다(②).**

다만 **코드 테이블 전체의 분리 축**은 확인했다.

```sql
SELECT (SELECT count(DISTINCT build_id) FROM tb_s080_code_masters) 마스터_건물수,
       (SELECT count(DISTINCT build_id) FROM tb_s080_codes_line)   라인_건물수,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='tb_s080_codes_line'
           AND column_name ~* '(company|tenant|org)') 라인에_회사컬럼수,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='tb_s080_code_masters'
           AND column_name ~* '(company|tenant|org)') 마스터에_회사컬럼수;
```

| 마스터 건물수 | 라인 건물수 | 라인에 회사컬럼 | 마스터에 회사컬럼 |
|---|---|---|---|
| 1 | 1 | **0** | **0** |

**코드는 `build_id`(건물)로 묶인다. `company_id`·`tenant_id` 컬럼이 양쪽 다 없다.**

→ **입주사별이 아니다.** 신규 입주사를 등록할 때 코드를 함께 만들 필요가 없다.
**페이즈 3 범위는 늘어나지 않는다.**

→ 다만 "전사 공통"도 아니다. 정확히는 **건물별**이고, 지금 건물이 1개라 결과적으로
공통처럼 보인다. 건물이 둘이 되면 코드도 건물마다 따로 만들어야 한다.

---

## C. `004_rename_tenant.sql` — 게이트와 겹치는지

**파일:** `supabase/migrations_hold/004_rename_tenant.sql`
**하는 일:** `tenant_id` → `operator_id` 개명 + 타입 통일(text→int) + FK 부여

### 테이블 단위 판정

| 테이블 | `004` 가 건드리는가 | 무엇을 |
|---|---|---|
| **`tb_s080_spaces`** | **아니다** | — |
| **`tb_s080_code_masters`** | **아니다** | — |
| **`tb_s080_codes_line`** | **아니다** | — |
| `tb_s080_floors` | 아니다 | — |
| `tb_s080_facilities` | 아니다 | — |
| **`tb_s080_buildings`** | **그렇다** | `tenant_id` → `operator_id` (int, rename만) · FK 제약명 · 인덱스명 |
| `tb_s080_tenant010` | 그렇다 | PK `tenant_id` → `operator_id` |
| `tb_cm_file` | 그렇다 | text→int + FK 신설 |
| `tb_s080_departments` | 그렇다 | text→int + UNIQUE 1 + 인덱스 1 재생성 |
| `tb_s080_employees` | 그렇다 | text→int + UNIQUE 2 + 인덱스 2 재생성 |
| `tb_s080_incorporations` | 그렇다 | text→int + 인덱스 1 |
| `tb_s080_corp_changes` | 그렇다 | text→int + 인덱스 1 |
| `tb_s080_form_templates` | 그렇다 | text→int + 인덱스 1 |
| `tb_s080_doc_form_settings` | 그렇다 | text→int + UNIQUE 1 + 인덱스 1 |

### 그래서

**조사 대상 세 테이블(`spaces`·`code_masters`·`codes_line`)은 `004` 의 대상이 아니다.**
컬럼도 이름도 바뀌지 않는다. 페이즈 4 에서 이 세 테이블에 조회 코드를 붙여도
게이트가 그 코드를 깨뜨리지 않는다.

> **★ 단 하나 걸리는 것 — `tb_s080_buildings.tenant_id` 는 바뀐다.**
>
> `spaces`·`floors`·`facilities`·`code_masters`·`codes_line` 이 전부 `build_id` 로
> `buildings` 를 참조하는데, **바뀌는 컬럼은 `build_id`(PK)가 아니라 `tenant_id` 다.**
> PK 는 그대로이므로 **FK 참조는 영향을 받지 않는다.**
>
> 영향이 생기는 경우는 하나뿐이다 — 호실·코드를 조회하면서 **건물을 운영사로 거르려고
> `buildings.tenant_id` 를 함께 읽는 코드**를 쓰면, 게이트 후 그 컬럼명이 사라진다.
> 건물이 1개인 지금은 거를 이유가 없으므로 **`tenant_id` 를 건드리지 않는 조회로 짜면
> 게이트와 무관하게 안전하다.**

```sql
-- 현재 tenant_id 가 남아 있는 곳 (004 적용 전)
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND column_name IN ('tenant_id','operator_id')
ORDER BY table_name;
```

| 테이블 | 컬럼 | 타입 |
|---|---|---|
| `User` | `tenant_id` | integer |
| `tb_cm_file` | `tenant_id` | text |
| `tb_s080_buildings` | `tenant_id` | integer |
| `tb_s080_corp_changes` · `departments` · `doc_form_settings` · `employees` · `form_templates` · `incorporations` | `tenant_id` | text |
| `tb_s080_tenant010` | `tenant_id` | integer |

`operator_id` 는 **아직 어디에도 없다.** `004` 는 미적용 상태다.

---

## D. 그 밖에 눈에 띈 것

### D-1. 계약 · 청구 테이블이 이미 있고 데이터도 있다

```sql
SELECT count(*) FROM tb_s080_contracts;     -- 5
SELECT count(*) FROM tb_s080_invoices;      -- 31
SELECT count(*) FROM tb_s080_invoice_lines; -- 31
SELECT count(*) FROM tb_s080_payments;      -- 5
SELECT count(*) FROM tb_s080_contract_status_history; -- 0
```

`tb_s080_contracts` 는 컬럼 32개이고, 페이즈 1 의 `001` 이 넣은 4컬럼
(`billing_start_date` · `deposit_return_status` · `biz_info_snapshot` ·
`renewed_from_contract_id`)이 실제로 붙어 있다.

### D-2. ★ 계약 1건 = 호실 1개 구조다 — 새 설계와 다르다

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='tb_s080_contracts' AND column_name='space_id';
-- space_id text NOT NULL
```

레거시 계약은 **`space_id` 를 단일 NOT NULL 컬럼**으로 들고 있다. 계약 1건에 호실 1개다.
금액도 계약 행에 직접 붙어 있다(`monthly_rent` · `tax_fee` · `deposit` · `discount_amount`).

```sql
SELECT c.relname, ... WHERE c.relname ~ '(contract|item|invoice)';
```

| 테이블 | 컬럼수 |
|---|---|
| `tb_s080_contracts` | 32 |
| `tb_s080_contract_status_history` | 6 |
| `tb_s080_invoices` | 20 |
| `tb_s080_invoice_lines` | 15 |

**계약 항목(N개)을 담을 테이블이 없다.** 새 설계는 계약 1건 = 계약 항목 **최대 10개**이고
항목마다 계약구분·호실·월회비·예치금·월이용료·계산서발행을 따로 갖는다.
`tb_s080_invoice_lines` 가 구조상 가장 비슷하지만 **청구서에 달린 것**이지 계약에 달린 것이 아니다.

> **판단이 필요하다 — 정하지 않았다.** 페이즈 4 는 계약 항목 테이블을 새로 만들거나,
> 계약을 항목 수만큼 여러 행으로 두거나 둘 중 하나를 골라야 한다.
> `ROADMAP.md` 페이즈 4 는 `009_billing_schema.sql`(미작성)만 예고하고 있고
> **계약 항목 테이블은 어디에도 예고돼 있지 않다.**

### D-3. 계약 표본 5건 — 코드값이 코드표와 맞는다

```sql
SELECT contract_id, space_id, contract_no, status, payment_method, access_route,
       monthly_rent, tax_fee, deposit, discount_amount, billing_day,
       contract_room, start_date::date, end_date::date, auto_renewal
FROM tb_s080_contracts ORDER BY created_at LIMIT 5;
```

| contract_no | status | pay | route | 월임대료 | 부가세 | 보증금 | 할인 | 청구일 | contract_room | 기간 |
|---|---|---|---|---|---|---|---|---|---|---|
| 202606-1937-01 | `A` | `C` | `O` | 50,000 | 5,000 | 50,000 | 50,000 | 19 | `6-1` | 2026-06-19 ~ 2027-06-18 |
| 202606-9696-01 | `A` | `M` | NULL | 50,000 | 5,000 | 50,000 | 30,000 | 19 | `6-9` | 2026-06-19 ~ 2026-12-18 |
| 202606-4292-01 | `A` | `M` | `O` | 50,000 | 5,000 | 50,000 | 0 | 22 | `1-4` | 2026-06-22 ~ 2027-06-21 |
| 202606-0848-01 | `A` | `M` | `O` | 400,000 | 40,000 | 400,000 | 0 | 22 | `112-3` | 2026-06-22 ~ 2027-06-21 |
| 202606-6565-01 | `P` | `M` | NULL | 50,000 | 5,000 | 50,000 | 0 | 22 | `14-4` | 2026-06-22 ~ 2027-06-21 |

회사 식별자·메모는 뺐다(개인정보 회피).

- `status` `A`(계약중) · `P`(계약대기) → `CONTRACT_ST` 와 맞는다
- `payment_method` `M`(월납) · `C`(일시불) → `PAYMENT_METHOD` 와 맞는다
- `access_route` `O`(네이버 블러그) → `ACCESS_ROUTE` 와 맞는다. **2건은 NULL**
- **계약번호 형식이 `YYYYMM-NNNN-NN`** 이다. 새 설계 문서의 예시는 `CT-2026-0142` — **다르다**
- **보증금이 월임대료와 같은 값**이다(50,000 / 400,000). 호실의 `deposit` 은 NULL 인데
  계약에는 값이 들어가 있다 — 등록 시 월임대료를 그대로 복사한 것으로 보인다
- 5건 중 2건이 **같은 `space_id`** 를 쓴다(`ltqbmx59…`). 하나는 `A`, 하나는 `P` 다

### D-4. 이름이 겹치거나 의미가 다른 것

| 이름 | 레거시 | 새 설계 | 주의 |
|---|---|---|---|
| `tenant` | **운영사**(`tb_s080_tenant010`) | 문서에서 「입주사」를 tenant 로 쓰는 곳이 있다 | `004` 가 `operator` 로 바꾸는 이유다 |
| `deposit` | 호실=NULL · 층=5천만(임차보증금) · 계약=월세와 동일값 | 계약 항목의 「예치금」 | 세 곳의 의미가 다르다 |
| `room_no` | 12자리 해시 | 화면의 「호실」 | `room_name` 을 써야 한다 |
| `contract_room` | 계약의 국세청 신고용 호실(`6-1`) | 「계약호실」 | `tb_s080_space_room.contract_room` 도 있는데 **0행** |
| `PAY_METHOD` / `PAYMENT_METHOD` | 결제수단 / 납부방법 | 「납부방법」 | 이름이 거의 같다. 바꿔 쓰기 쉽다 |
| `MEMBER_TYPE` | 법인 형태 + 상호 표기 위치 | 「회원구분」 프리랜서/개인사업자/법인 | **같은 이름, 다른 개념** |
| `use_tp` | 코드 라인의 3자리 구분자 | — | **의미가 문서에 없다.** 같은 코드가 `use_tp` 별로 중복된다 |

### D-5. `tb_s080_space_room` 이 비어 있다

국세청 신고용 호실을 담으라고 만든 것으로 보이는 테이블(`contract_room varchar(50)`)이
**0행**이다. 실제 값은 `tb_s080_contracts.contract_room` 에 들어가 있다.
**둘 중 어느 쪽이 정본인지 판단이 필요하다.**

### D-6. 비어 있는 테이블 6개

`tb_s080_contract_status_history` · `tb_s080_corp_change_officers` · `tb_s080_menus` ·
`tb_s080_menu_permissions` · `tb_s080_services` · `tb_s080_settlements` · `tb_s080_space_room`

`menus`·`menu_permissions` 가 비어 있는 것은 **ERP 에 권한 관리 화면을 만들지 않는다**는
결정(`SWONBIZ_SCREEN_LIST.md` §4)과 일관된다.

### D-7. 권한 — 막힌 곳 없음

```sql
-- erp_app 계정으로 접속해 각 테이블 count(*)
SELECT current_user;  -- erp_app
```

| 테이블 | `erp_app` 조회 결과 |
|---|---|
| `tb_s080_spaces` | 72행 |
| `tb_s080_buildings` | 1행 |
| `tb_s080_floors` | 1행 |
| `tb_s080_facilities` | 1행 |
| `tb_s080_code_masters` | 22행 |
| `tb_s080_codes_line` | 112행 |

**6개 전부 읽힌다. 권한 때문에 막힌 조회가 하나도 없었다.**
`GRANT` 는 실행하지 않았다.

`tb_s020_*`(삐용)·`tb_s090_*`(메일)은 지시대로 **조회를 시도하지 않았다.**

---

## 이 조사가 바꿀 수 있는 것

★ **결론을 내지 않는다.** 페이즈 4 를 게이트보다 먼저 할 수 있는지에 대한 재료만 적는다.

### 먼저 해도 된다는 쪽 재료

- **호실 데이터가 이미 있다** — 72실, 전부 활성. 기준관리 화면 없이도 조회만 붙이면 된다
- **임대료가 72건 전부 채워져 있다** — 계약 폼의 "호실 선택 시 월회비 자동 입력"이 지금 된다
- **`004` 가 `spaces`·`code_masters`·`codes_line` 을 건드리지 않는다** — 이 세 테이블에
  붙인 조회 코드는 게이트 후에도 그대로 산다
- **권한이 이미 열려 있다** — `erp_app` 로 6개 테이블이 전부 읽힌다
- **코드가 입주사별이 아니다** — 페이즈 3 범위가 늘어나지 않는다
- 계약구분·납부방법·접근경로·계약상태·호실상태 코드가 **DB 에 이미 있다**

### 먼저 하면 걸리는 쪽 재료

- **보증금 원본이 없다** — `spaces.deposit` 72건 전부 NULL. "호실 선택 시 예치금 자동 입력"의
  원본 값이 없다. 기준관리에서 채우거나, 다른 규칙으로 정하거나, 빈 채로 두어야 한다
- **계약 항목(N개) 테이블이 없다** — 레거시는 계약 1건 = 호실 1개다. 새 설계의 최대 10항목을
  담을 곳이 없고, 로드맵에도 그 테이블이 예고돼 있지 않다
- **코드 3종이 시안과 어긋난다** — 회원구분(개념 자체가 다름) · 계약구분(팀오피스 없음,
  3인실·자유석·기타 추가) · 접근경로(방문 없음). 어느 쪽을 따를지 정해야 계약 폼을 짤 수 있다
- **이메일 도메인 코드가 아예 없다** — 시안 하드코딩을 그대로 쓸지, 코드 마스터를 새로 만들지
- **건물·층이 각각 1개다** — "건물 셀렉트 + 층 탭"이 지금은 선택지 하나짜리다.
  화면은 만들 수 있으나 실제로 걸러지지 않는다
- **`room_no` 가 해시다** — 화면에 `room_name` 을 써야 한다. 계약의 `contract_room`(`6-1`)과
  호실의 `room_name`(`VIR 13`)이 **서로 다른 체계**라 대응 규칙이 필요하다

### 이 조사로는 알 수 없는 것

- 건물에 1·2층이 실제로 없는지, 입력이 덜 된 것인지
- `use_tp` 3자리 구분자의 의미
- `tb_s080_space_room` 과 `contracts.contract_room` 중 어느 쪽이 정본인지
- `area_sqm`·`capacity` 가 전체적으로 얼마나 채워져 있는지(상위 5행은 전부 NULL)
