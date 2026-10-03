# 코드 테이블 분석 — `tb_s080_code_masters` · `tb_s080_codes_line`

**조사 시점:** 2026-09-19
**대상 DB:** `192.168.0.14:54322` / `postgres` / 스키마 `public` — PostgreSQL 17.6 (개발계)
**대조 대상:** 레거시 `S-WonERP/S-WonERP/src` (Next.js 16 · Prisma) — 현재 **미사용**
**성격:** ★ **읽기 전용.** `SELECT` 외의 문장은 실행하지 않았다. 저장소 변경은 이 문서 하나뿐이다.

> **이 문서가 닫는 물음** — `LEGACY_DATA_SURVEY.md` 「이 조사로는 알 수 없는 것」에
> *"`use_tp` 3자리 구분자의 의미"* 가 미결로 남아 있었다. **이 문서가 답한다**(§B).
> 같은 문서 §D-4 의 *"의미가 문서에 없다"* 도 여기서 해소된다.

---

## 요약 — 한 눈에

| 물음 | 답 |
|---|---|
| 코드 테이블을 지금 무엇이 쓰는가 | `GET /codes` **하나**. 화면 2개(계약 폼 · 계약 목록). 22종 중 **3종만** 노출 |
| 쓰기가 있는가 | ~~**없다.**~~ → **있다 (2026-10-03).** 코드 관리 화면 `s030100030 /codes` 를 만들었다 — `/codes-admin/**`, 운영사 전용. `listCodes()` 는 그대로 조회 전용이다(소비 경로). **§H** |
| `use_tp` 의 의미 | **카테고리 안의 독립 파티션.** `000` 이 공통(22종 전부 보유), `001`·`002` 는 용도별 **별도 완결 목록**. 상속·합집합이 **아니다** |
| `parent_line_id` 의 의미 | 같은 카테고리 안의 **2단 계층**. 112행 중 **8행**, 전부 `MEMBER_TYPE`(법인형태 → 상호 표기위치) |
| 코드 테이블을 참조하는 외부 FK | **0개.** 뷰 0 · 함수 0. 내부 FK 2개뿐(master↔line, line 자기참조) |
| 코드값을 담은 컬럼 | 8테이블 9컬럼 · 실데이터 **77행** (대부분 `spaces` 72행) |
| 레거시에 코드관리 화면이 있는가 | **있다.** `admin/codes` — 화면 5 + API 4 + 헬퍼 2, 약 **1,100줄** |
| 구조 변경의 결합 비용 | 앱 코드 **약 25줄** · 외부 FK **0** · 업무 데이터 **3건**(계약 2 · 회사 1) |

---

## A. 사용 실태 — 계약 관련 2화면뿐

### A-1. 경로 전체

```
packages/api/src/db/lookups.ts:85      listCodes()        조회 전용 (약 12줄)
packages/api/src/routes/lookups.ts:87  GET /codes         운영사 전용 (약 12줄)
  └ packages/web/.../contracts/[id]/page.tsx:51        s030200040 계약 폼 — 셀렉트
  └ packages/web/.../tenants/contracts/page.tsx:35     s030200030 계약 목록 — 표시명 변환
```

노출 카테고리는 서버 상수 `CONTRACT_FORM_CODES` 로 고정되어 있다 — `ROOM_TP` ·
`PAYMENT_METHOD` · `ACCESS_ROUTE` **3종**. 화면이 카테고리를 고를 수 없다.

### A-2. 데이터 의존은 더 넓다 — 단 DB 결합은 0

코드값을 문자열로 담고 있는 컬럼:

| 테이블 | 컬럼 | 카테고리 | 실데이터 |
|---|---|---|---|
| `tb_s080_spaces` | `room_type` | `ROOM_TP` | **72행** |
| `tb_s080_contract_spaces` | `room_type` | `ROOM_TP` | 2행 |
| `tb_s080_contracts` | `payment_method` · `access_route` | — | 2행 · 1행 |
| `tb_s080_companies` | `member_type` | `MEMBER_TYPE` | 1행 — 값이 **`개인사업자`** |
| `invoice_lines` · `payments` · `settlements` | `pay_item` · `pay_method` · `payment_method` | — | **0행** |

> ★ `companies.member_type` 의 값 「개인사업자」는 **코드가 아니라 표시명**이다.
> 조사 시점의 `MEMBER_TYPE` 코드는 `R/A/C/S/P/F/B` 였고 「개인사업자」는 DB 어디에도
> 없었다. 이 컬럼은 코드체계와 **이미 끊어져 있다.** 구조 변경과 무관한 별건이다.
>
> **2026-09-19 이후 코드 목록이 바뀌었다** — `F`·`B`(표기위치)는 `NAME_POSITION` 으로
> 떠났고(014), `P` 의 이름이 「개인사업자」가 되었으며 `Z` 개인이 생겼다(017).
> 그래도 이 컬럼의 값은 여전히 **표시명**이라 어느 코드와도 맞지 않는다 — 화면은
> 목록에 없는 값을 미선택으로 연다.

**그러나 DB 제약 결합은 0이다:**

```sql
-- 코드 두 테이블을 참조하는 FK
SELECT con.conname, src.relname, tgt.relname
FROM pg_constraint con
JOIN pg_class src ON src.oid=con.conrelid
JOIN pg_class tgt ON tgt.oid=con.confrelid
WHERE con.contype='f' AND tgt.relname IN ('tb_s080_code_masters','tb_s080_codes_line');
-- → 2행. 둘 다 codes_line 자신이 거는 것(master 참조 · 자기참조)
```

- 코드 테이블을 참조하는 **뷰 0 · 함수 0**
- 권한은 `erp_app` · `postgres` · `service_role` 뿐. 삐용 스키마(`tb_s020_t001` ·
  `tb_s090_t001`)에서 거는 뷰·함수 **없음**

**→ 코드 테이블을 바꿔도 DB 가 막을 것이 없다. 영향은 전부 애플리케이션 코드에 있다.**

---

## B. `use_tp` — 의미 확정

### B-1. 파티션이다. 상속이 아니다

레거시 `src/app/api/codes/route.ts` 가 **정확히 일치하는 값만** 거른다:

```ts
// null(파라미터 없음)일 때만 미필터. ""(빈 문자열)은 유효한 useType 파티션.
...(useType !== null ? { useType } : {}),
```

호출처는 원하는 파티션을 **명시적으로** 넘긴다. `EmployeeGrid.tsx:27` 주석:
`// RES_TP 공통 코드 (useType='000')`.

**결정적 반증 — `PAY_ST`:**

| use_tp | 코드 |
|---|---|
| `000` | 납부대기 · 납부완료 · 미납 · **취소** |
| `001` | 납부대기 · 납부완료 · 미납 |

`001` 이 `000` 에 있는 「취소」를 **뺀다.** 상속·합집합이면 뺄 수 없다. 그래서 `001` 은
공통 코드 3개를 **다시 적어 두었다.** `ROOM_TP` 도 같다 — `001` 이 R1~VR 6개를 복제하고
`ET 기타` 하나를 더 가진다.

**→ 「공통 + 델타」가 아니라 「파티션별 완결 목록(중복 포함)」이다.**

### B-2. 분포

| use_tp | 행수 | 카테고리수 |
|---|---|---|
| `000` | 87 | **22 (전부)** |
| `001` | 21 | 4 (`EXEC_TP`·`MEMBER_TYPE`·`PAY_ST`·`ROOM_TP`) |
| `002` | 4 | 1 (`MEMBER_TYPE`) |

`(category, use_tp)` 조합 **27개**. 18개 카테고리는 `000` 단독이다.

### B-3. ★ 호출처 역산표 — `use_tp` 값별 용도

레거시 `useCodes()` 호출 27곳에서 역산했다. **이 표는 레거시 소스 없이는 다시 알아내기
어렵다.** 파티션에 이름을 붙일 때의 근거다.

| category | use_tp | 쓰는 곳 |
|---|---|---|
| `ROOM_TP` | **000** | 호실 관리 · 계약 상세 · 계약 모달 전부 · 계약서 출력 |
| `ROOM_TP` | 001 | ❓ **호출처 없음** (`ET 기타` 만 여기 있음) |
| `ROOM_ST` | 000 | 호실 관리 |
| `RES_TP` | 000 | 계약 입주자 그리드 (대표자/직원) |
| `RES_TP` | 001 | 운영사 직원 폼 — ⚠️ **이 DB 에 행이 없다**(2026-09-19 013 적용 중 확인). 레거시가 부르지만 데이터가 없는 자리다 |
| `MEMBER_TYPE` | 000 | ❓ **호출처 없음** |
| `MEMBER_TYPE` | 001 | 법인설립 |
| `MEMBER_TYPE` | 002 | 문서양식 설정 · 법인변경 문서 |
| `MEMBER_TYPE` | (미지정) | 계약 회사정보 섹션 — 파티션 안 걸고 **18행 전부** 가져옴 ⚠️ |
| `PAY_ST` | 001 | 납부 관리 |
| `PAY_ST` | 000 | ❓ **호출처 없음** (`취소` 만 여기 있음) |
| `LAW_PROG_ST` | 000 | 법인설립 · 법인변경 |
| `EXEC_TP` | 000 / 001 | ❓ **양쪽 다 호출처 없음** |
| `PAYMENT_METHOD` · `ACCESS_ROUTE` · `LAW_CNG_TP` · `LICENSE_TP` · `LAW_DOC_TP` | 미지정 | `000` 뿐이라 파티션 무관 |

> 레거시가 부르지만 이 DB 에 **마스터가 없는** 카테고리: `EMP_RANK` · `EMP_DUTY` ·
> `EMP_STATUS`. 해당 화면은 빈 셀렉트가 된다. (`FORM_TEMPLATE_KIND_CATEGORY` 는
> `LAW_DOC_TP` 로 매핑되어 있어 존재한다.)

---

## C. `parent_line_id` — 의미 확정

### C-1. 같은 카테고리 안의 2단 계층

레거시 `src/lib/code-hierarchy.ts` 가 규칙을 강제한다:

- 부모는 같은 `(build_id, category)` 여야 함 — **상위 카테고리를 찾는 것이 아니다**
- 부모는 반드시 루트(`parent_line_id IS NULL`) — **2단까지만**
- 자기 자신 부모 지정 금지 · 자식 가진 행은 자식이 될 수 없음

### C-2. 실데이터 — 8행, 전부 `MEMBER_TYPE`

```
R 주식회사(001) ─┬─ F 주식회사 앞(001)     A 유한회사(001) ─┬─ F 유한회사 앞(001)
                 ├─ F 주식회사 앞(002)                       └─ B 유한회사 뒤(001)
                 ├─ B 주식회사 뒤(001)     C 농/어업회사법인(001) ─┬─ F …앞(001)
                 └─ B 주식회사 뒤(002)                              └─ B …뒤(001)
```

**법인형태 → 상호 표기위치** 2단이다. 나머지 21개 카테고리는 전부 평면이다.

### C-3. ★ 담고 있는 정보량이 0 이다

| 부모 | 자식 |
|---|---|
| R 주식회사 | 앞 · 뒤 |
| A 유한회사 | 앞 · 뒤 |
| C 농/어업회사법인 | 앞 · 뒤 |

**셋이 완전히 같다.** "어느 법인형태가 어떤 표기위치를 쓸 수 있나"에 차이가 없다.
자식 6행은 부모 이름을 앞에 붙인 **라벨**일 뿐이고, 그 조합은 레거시가 이미 런타임에 한다:

```ts
// src/lib/incorp-company-name.ts
return position === "F" ? `${type} ${nm}` : `${nm} ${type}`;
```

### C-4. 저장되는 값은 `line_id` 가 아니라 스칼라다

```
tb_s080_incorporations.entity_type            text   ← R / A / C
tb_s080_incorporations.company_type_position  text   ← F / B
```

**독립된 두 컬럼**이고 `parent_line_id` 를 참조하지 않는다. 현재 **0행**이다.
`parent_line_id` 는 **셀렉트 선택지를 만드는 데만** 쓰이고, 답은 따로 저장된다.

**→ 삭제해도 버려지는 업무 데이터가 없다.**

### C-5. 소비처 — 공통코드 화면 전용이 아니다

업무 화면·API **9곳**이 읽는다. 전부 법무(040) 업무다.

| 위치 | 하는 일 |
|---|---|
| `incorporations/page.tsx:121` | `.filter(c => c.parentLineId === null)` |
| `CreateIncorporationAction.tsx:16` | 〃 — 주석: *"`001`에는 **위치용 자식(F/B)도 섞여 있어** 제외"* |
| `CompanyNameCard.tsx:30·34·37` | root 찾고 → `parentLineId === root.lineId` 로 앞/뒤 선택지 구성 |
| `DocFormSettingsClient.tsx:35` | 법인종류 목록에서 자식 제외 |
| `CorpChangeDocumentsModal.tsx:43` | 〃 |
| `api/incorporations/nontenant/route.ts:16` | `where parentLineId: null` |
| `api/incorporations/[id]/route.ts:119·222` | 법인종류 **유효성 검증** |
| `api/doc-form-settings/catalog/route.ts:18` | `where parentLineId: null` |
| `api/codes/route.ts:18·28` | 쿼리 파라미터로 노출 |

**★ 9곳이 전부 같은 한 가지를 막는다** — *"이 행은 법인형태지 표기위치가 아니다"*.
성격이 다른 두 종류를 한 목록에 담아 놓고, 읽는 쪽마다 걸러내고 있다. 한 곳이라도
빠뜨리면 법인종류 셀렉트에 「주식회사 앞」이 뜬다.

---

## D. 레거시 코드관리 화면 — 참조 구현이 있다

`S-WonERP/src/app/(dashboard)/admin/codes/` — 약 1,100줄. `use_tp` 와 `parent_line_id`
둘 다 다룬다.

```
admin/codes/page.tsx                146줄   카테고리 아코디언
  _components/CategoryAccordion.tsx  76줄
  _components/CodeTable.tsx         291줄   행 인라인 편집 (코드·명칭·사용용도·순서·상태·부모)
  _components/AddCodeDialog.tsx     137줄
  _components/AddCategoryDialog.tsx  87줄
api/admin/codes/route.ts             37줄   마스터+라인 전체 (isAdmin)
api/admin/codes/[category]/route.ts  94줄   라인 생성
api/admin/codes/[category]/[id]/…   122줄   라인 수정·삭제
api/codes/route.ts                   49줄   소비용 조회
lib/code-hierarchy.ts                40줄   부모 지정 규칙 (+ 테스트 있음)
lib/code-tree.ts                     50줄   트리 평탄화
```

---

## E. 발견한 결함

### E-1. 계약 폼 계약구분에 「기타」가 떠 있었다 — ✅ **닫힘 (2026-09-19)**

> `listCodes()` 가 파티션 `ROOM_TP/000` 을 지정하도록 바꿔 닫았다. 실측 확인:
> 계약 폼이 받는 `ROOM_TP` 가 **7종 → 6종**(`R1·R2·R3·FI·FR·VR`).
> 라인을 끄거나 지우지 않았다 — `ROOM_TP 001` 은 그대로 남아 있다.
> (`ACCESS_ROUTE` 의 「기타」(`E`)는 `000` 에 정상적으로 있는 **별개 코드**다.)

`listCodes()` 의 `DISTINCT ON (category, code)` 을 실제로 돌린 결과:

| 현행 `/codes` 가 내려보내는 `ROOM_TP` | 레거시 기준 (`use_tp='000'`) |
|---|---|
| 1인실·2인실·3인실·고정석·자유석·비상주·**기타** (7) | 1인실·2인실·3인실·고정석·자유석·비상주 (6) |

`ET 기타` 는 `use_tp='001'` 에만 있어 `DISTINCT ON` 에서 경쟁자가 없어 **항상 살아남는다.**
레거시 어느 화면에서도 쓰지 않는 코드가 계약 폼에 노출 중이다.
(`PAYMENT_METHOD`·`ACCESS_ROUTE` 는 `000` 뿐이라 영향 없음)

### E-2. `DISTINCT ON` 의 정렬 타이 — ✅ **닫힘 (2026-09-19)**

> `DISTINCT ON` 자체를 걷어냈다. 파티션을 지정하므로 같은 `(category, code)` 가 여러 행
> 올 일이 없고, 정렬도 `ORDER BY category, sort_order, code` 한 번으로 끝난다.

`ORDER BY category, code, sort_order` 는 `sort_order` 가 같으면 **어느 행이 이길지
정해지지 않는다.** `MEMBER_TYPE` 의 `F` 는 `sort_order` 가 전부 1인데 이름이
「주식회사 앞 / 유한회사 앞 / 농·어업회사법인 앞」 셋이다 — 이 카테고리를
`CONTRACT_FORM_CODES` 에 넣는 순간 **무작위 이름**이 뜬다.

### E-3. 레거시 — PATCH 중복검사가 느슨하다

`api/admin/codes/[category]/[id]/route.ts:36` 의 code 변경 중복검사가
`{buildId, category, code}` 만 본다 — **`useType`·`parentLineId` 누락**.
POST(`[category]/route.ts:44`)는 3개를 다 본다. 두 곳이 어긋나 있어, 정당한 변경
(다른 파티션의 같은 code)이 409 로 거부된다.

### E-4. 레거시 — 사용용도 입력이 규약을 모른다

`CodeTable.tsx` 의 사용용도 칸이 자유 텍스트 3자 + `.toUpperCase()`,
`placeholder="예: WEB"`. 실데이터 규약은 **숫자 `000`/`001`/`002`** 다.
스키마가 막지 않으니 UI 도 막을 근거가 없었던 것으로 읽힌다.

### E-5. 레거시 — `buildCodeTree` 가 `use_tp` 를 무시한다

`MEMBER_TYPE` 18행을 한 표에 그리면 「주식회사」루트가 **3번**(000/001/002) 반복되고
자식은 001 밑에만 붙는다.

### E-6. 데이터 — `002` 파티션이 깨져 있다

- `F 주식회사 앞(002)` 의 부모가 **`R 주식회사(001)`** — `R(002)` 가 존재하는데도
  다른 파티션을 가리킨다
- `A 유한회사(002)` 는 **자식이 없다** → `002` 로 트리를 그리면 유한회사에 앞/뒤가 없다

`checkAssignParent` 가 category 만 보고 `useType` 을 검사하지 않아 막히지 않는다.
`code-tree.ts` 에 고아를 depth 0 으로 붙이는 방어 코드가 있는 것이, 레거시에서도
이 일이 일어났음을 시사한다.

### E-7. 데이터 — `extra` · `description` 이 비어 있다

112행 전부 `extra` 비어 있음 · `description` **0행** 채워짐 · `is_active=false` **0행** ·
`is_system` 37행 참 · `created_by` 75행 채워짐.

---

## F. 결정 (2026-09-19) — ★ 시행 완료

> **A안 — `use_tp` 카테고리 승격 + `NAME_POSITION` 분리 + `parent_line_id` 삭제.**
> 사용자 승인 완료. **2026-09-19 시행됐다.**

| 산출물 | 결과 |
|---|---|
| `supabase/migrations/013_code_categories.sql` | 카테고리 테이블 신설 · 27행 이관 · FK 강화 |
| `supabase/migrations/014_name_position.sql` | `NAME_POSITION` 2행 · 자식 8행 삭제 · `parent_line_id` 드롭 |
| `supabase/migrations/015_code_category_common_name.sql` | `use_tp='000'` 이름을 전부 「공통」으로 · `EXEC_TP 001` 을 「(미상)」으로 |
| `supabase/migrations/016_email_domain.sql` | `EMAIL_DOMAIN` 카테고리 신설 5행 — 화면 상수였던 것을 코드로 옮김 |
| `supabase/migrations/017_member_type_individual.sql` | 회원구분 `P` 를 개인사업자로 · `Z` 개인 신설(`000` 에만) |
| `supabase/migrations/018_company_member_type_code.sql` | `companies.member_type` 의 표시명을 코드값으로(`개인사업자`→`P`) |
| `packages/api/src/db/lookups.ts` · `routes/lookups.ts` | `listCodes(client, CodeSpec[])` · `DISTINCT ON` 제거 |
| `scripts/verify-013.js` · `verify-014.js` | 검증 9항목 · 12항목 — **전부 통과** |

계획서: `.planning/tasks/지시_코드테이블_구조변경.md`

**시행 중 드러난 것** — 역산표의 `RES_TP 001` 이 **이 DB 에 없다.** 레거시 운영사 직원
폼이 부르지만 행이 하나도 없다(`EMP_RANK`·`EMP_DUTY`·`EMP_STATUS` 와 같은 부류).
카테고리를 만들지 않았고, §B-3 표에 표시해 두었다.

### F-1. 무엇을 바꾸는가

**① 코드 카테고리 테이블 신설** — `use_tp` 에 이름과 설명을 준다

```
(가칭) 코드 카테고리
  build_id + category   → tb_s080_code_masters 참조
  use_tp  varchar(3)
  name · description · is_system · 감사 4컬럼
  UNIQUE(build_id, category, use_tp)          ← 27행
```

**② `codes_line` FK 강화** — 이것이 핵심이다

```
지금:   codes_line (build_id, category)          → code_masters
바꾸면: codes_line (build_id, category, use_tp)  → 코드 카테고리
```

지금은 **존재하지 않는 `use_tp` 를 아무 값이나 넣을 수 있다**(E-4 의 원인).
FK 를 걸면 DB 가 막는다. 「뜻을 DB 에 새긴다」의 실질이 여기 있다.

**③ `NAME_POSITION` 카테고리 신설** — 표기위치를 분리한다

```
MEMBER_TYPE (법인형태)              NAME_POSITION (상호 표기위치)  ← 신설 2행
├─ R 주식회사                        ├─ F 앞
├─ A 유한회사                        └─ B 뒤
├─ C 농/어업회사법인
├─ S 사회적기업
└─ P 개인
```

- 자식 8행 삭제 — 「주식회사 앞」은 저장할 값이 아니라 **조합해서 만드는 표시명**
- 필터 9곳(C-5) 삭제 — 섞여 있지 않으니 거를 것이 없다
- `002` 의 깨진 링크(E-6) **소멸**

**④ `parent_line_id` 삭제**

**⑤ `listCodes()` 의 `DISTINCT ON` 제거** — 호출자가 파티션을 지정한다.
E-1 · E-2 가 함께 닫힌다.

### F-2. 왜 지금인가

| 근거 | 수치 |
|---|---|
| 앱 코드 결합 | 함수 1 · 라우트 1 · 화면 2 (**약 25줄**) |
| 노출 카테고리 | 22종 중 **3종** |
| DB 제약 결합 | **0** |
| 이관할 업무 데이터 | 계약 **2건** · 회사 **1건** · 법인설립 **0건** |
| 레거시 S-WonERP | **미사용** |
| 코드관리 화면 | **아직 없음** — 되돌릴 UI 가 없다 |

코드관리 화면을 먼저 만들고 바꾸면 화면·API·마이그레이션을 두 번 쓴다.
지금 바꾸면 화면을 **한 번만** 만든다.

### F-3. `NAME_POSITION` 분리를 택한 근거

1. **계층이 담은 정보량이 0** (C-3) — 세 법인형태가 모두 앞/뒤를 갖는다
2. **저장 구조가 이미 평면** (C-4) — `entity_type` · `company_type_position` 독립 스칼라
3. **9곳의 방어 필터가 한 가지 설계 실수를 매번 막고 있다** (C-5)
4. `MEMBER_TYPE` 은 SwonBiz 에서 **아직 미사용**, 법무는 **040 / 4차** — 영향받을 화면이
   아직 없다

### F-4. ★ 기록해 두는 반대 논거

나중에 "왜 이렇게 했나"를 묻게 될 자리다. 채택하면서 **알고 넘어간** 것들이다.

- **「어느 법인형태에 어떤 표기위치가 허용되나」를 표현할 수단이 없어진다.** 그런 규칙이
  생기면 애플리케이션 코드로 옮겨간다. → 현재 데이터에 그런 차이가 없고, 상법상 앞/뒤가
  법인형태에 따라 갈리지 않는다고 판단했다
- **`NAME_POSITION` 이 `MEMBER_TYPE` 에 종속이라는 사실이 스키마에서 사라진다.**
  → 신설 카테고리 테이블의 `description` 에 적어 덜기로 했다
- **레거시 화면 4개를 다시 써야 한다**(`CompanyNameCard`·`CreateIncorporationAction`·
  `DocFormSettingsClient`·`CorpChangeDocumentsModal`). → 필터를 지우는 방향이라 대부분
  줄어들고, SwonBiz 는 아직 이관 전이라 **이관 시 한 번만** 반영하면 된다

### F-5. 설계 지침

| 쟁점 | 정한 것 |
|---|---|
| `use_tp` 값 형식 | **`varchar(3)` 유지.** 112행·레거시 상수(`000`,`001`,`002`)를 건드리지 않는다 |
| **이름(`name`) 의 역할** | **파티션이 무엇인지**를 말한다. `use_tp='000'` 은 **언제나 「공통」**이고(23행 전부), `000` 이 아닌 파티션은 용도 이름 또는 「(미상)」이다. **쓰임새(어느 화면이 쓰는지)는 `name` 이 아니라 `description` 이 담는다** — 015 에서 정리했다 |
| `000` 의 위치 | **기본 파티션으로 고정**, 카테고리 생성 시 자동 생성 |
| ~~`000` 단독 18종~~ | ~~화면에서 파티션 선택 단계를 **숨긴다** — 안 그러면 의미 없는 클릭이 한 번씩 는다~~ → ❌ **뒤집혔다 (2026-10-03, 사용자 결정).** 코드 관리 화면은 `000` 단독 분류(지금 24개)도 파티션 단계를 **언제나 보여 준다.** 이유 둘: ① 모양이 둘이면 운영자가 규칙을 못 읽는다 — 어떤 분류는 한 번, 어떤 분류는 두 번 눌러야 한다 ② 나중에 그 분류에 파티션이 하나 더 생기면 **그 분류만** 모양이 바뀐다. 클릭 한 번이 느는 비용을 받아들였다. 구현: `packages/web/src/features/codes/CodesView.tsx` |
| 파티션 간 관계 | **형제(독립)** 로 둔다. 상속·합집합이 아니다(B-1) |

---

## G. 아직 정하지 않은 것

1. **이름 못 붙이는 파티션 4개** — `ROOM_TP 001` · `MEMBER_TYPE 000` · `PAY_ST 000` ·
   `EXEC_TP 000/001`. 호출처가 없어 이름을 지을 수 없다(B-3).
   → **시행 시 `(미상)` 으로 이름을 넣고 비활성화하지 않았다.** 계약 폼 오노출(E-1)은
   파티션 지정으로 닫혔으므로 행을 끌 이유가 없어졌다. 용도가 밝혀지면 이름을 고친다
2. ~~삐용이 이 테이블을 직접 읽는지~~ — ✅ **해소 (2026-09-19 사용자 확인).**
   삐용은 `tb_s080_codes_line` · `tb_s080_code_masters` 를 보지 않는다
3. ~~`companies.member_type` 의 「개인사업자」~~ — ✅ **해소 (2026-09-19, 018).**
   표시명을 코드값 `P` 로 바꿨다. 017 이 `P` 의 이름을 「개인사업자」로 확정해 대응
   코드가 정확히 있었다 — 추측이 아니다. 마이그레이션은 값을 직접 쓰지 않고 **코드
   이름과 맞는 행만** 바꾸므로 근거가 SQL 안에 남고 두 번 돌려도 같다
4. **시안의 회원구분 3종** — 「프리랜서 / 개인사업자 / 법인」은 파티션을 골라도 대응
   코드가 없다. `CONTRACT_DATA_MODEL.md §C-3 ⑤` 의 판단은 **그대로 유효하다**
5. ~~시행 시점~~ — ✅ **2026-09-19 시행 완료.** 페이즈 4-5(계약서 출력)보다 먼저 했다

---

## H. 코드 관리 화면 — 시행 완료 (2026-10-03)

> §A-1 의 「코드관리 화면은 아직 없다」· §F-2 의 「되돌릴 UI 가 없다」는 **닫혔다.**
> `s030100030 /codes` 를 만들었다. 레거시 `admin/codes`(1,124줄 실측) 기능을 전수
> 옮기고, 모양은 센터 관리(s030100010)와 같게 맞췄다.

### H-1. 산출물

| 산출물 | 내용 |
|---|---|
| `packages/shared/src/domain/code-usage.ts` | ★★★ **선언표.** `CODE_USAGE` 9건 · `PINNED_CODES` 4건 |
| `packages/api/src/db/codes.ts` | 3층 저장소 + 쓰임 집계(`countCodeUsage`·`countUsageByCode`·`checkUsageTableRefs`) |
| `packages/api/src/routes/codes.ts` | `/codes-admin/**` — 운영사 전용, 막는 자리를 여기 하나로 모았다 |
| `packages/web/src/features/codes/` | `CodesView` + 팝업 4 + CSS |
| `packages/web/src/app/(erp)/codes/page.tsx` · `app/api/codes-admin/**` | 화면 · 프록시 7 |
| `scripts/verify-codes.js` | 검증 **100항목 — 전부 통과** |
| 마이그레이션 | **없다.** 쓰기 권한(`erp_app` CRUD 3표)·유니크 인덱스 3개가 이미 있었다(실측) |

### H-2. ★★★ 「쓰고 있는 코드」의 판정 근거 — 손으로 적은 선언표

§A-2 가 「DB 제약 결합은 0」이라고 적은 것이 여기서 **비용으로 돌아온다.** 외부 FK 가
0건이라 구조를 바꾸기는 쉬웠지만, **지우는 것을 DB 가 막아 주지도 않는다.**

그래서 코드값이 저장되는 업무 컬럼을 **손으로 선언한다.** 자동 탐지를 두 가지 다 시도해
보고 버렸다(2026-10-03 실측):

| 방법 | 왜 버렸는가 |
|---|---|
| 값 일치로 찾기 | **거짓 양성이 쏟아진다.** `C`·`R`·`A` 같은 한 글자 코드가 카테고리를 넘나든다 — `auth_session.org_tp`(삐용 기관구분)가 EXEC_TP·PAY_ST·RES_TP·MEMBER_TYPE 에 **동시에** 일치했다. 코드 컬럼이 아닌데도 |
| 컬럼명 패턴으로 찾기 | **놓친다.** `tb_s080_spaces.status`(ROOM_ST 72행)가 `_st`·`_status` 로 끝나지 않아 스캔에서 빠졌다 |

틀리는 방향이 다르고, **틀린 경고는 정당한 삭제를 막는다.** 그래서 손으로 적었다.

**★★ 이 표를 빠뜨리면 쓰고 있는 코드가 지워진다.** 자동으로는 잡을 수 없다 — 없는 줄을
없다고 알 방법이 없다. 두 곳이 거든다:

- `scripts/verify-codes.js` 가 표의 표·컬럼이 **실제로 존재하는지** 대조한다(오타·이름 변경)
- 코드 관리 화면이 파티션마다 **쓰임 자리를 적어** 보여 주고, 등록된 자리도 `PINNED_CODES`
  도 없으면 **경고색 띠**로 「등록하지 않으면 쓰고 있는 코드도 지워집니다」를 띄운다

#### 선언표 — `CODE_USAGE` 9건

| 표.컬럼 | 카테고리/파티션 | 조사 시점 행수 |
|---|---|---|
| `tb_s080_spaces.room_type` | ROOM_TP/000 | 72 |
| `tb_s080_spaces.status` | ROOM_ST/000 | 72 (E 71 · O 1) |
| `tb_s080_contract_spaces.room_type` | ROOM_TP/000 | 0 |
| `tb_s080_contracts.status` | CONTRACT_ST/000 | 0 |
| `tb_s080_contracts.payment_method` | PAYMENT_METHOD/000 | 0 |
| `tb_s080_contracts.access_route` | ACCESS_ROUTE/000 | 0 |
| `tb_s080_companies.member_type` | MEMBER_TYPE/000 | 5 (P 1 · R 4) |
| `tb_s080_companies.status` | COMPANY_ST/000 | 5 — ★ 화면은 계약에서 유도해 쓰지만(`tenant-status.ts`) 컬럼에 코드값이 있어 세는 대상이다 |
| `tb_s080_inquiries.type` | QU_TP/000 | 4 |

#### ★★ 앱이 상수로 박아 둔 코드값 — `PINNED_CODES` 4건

**자료가 0행이어도** 코드값을 바꾸면 조용히 틀리는 자리다. 테스트도 DB 도 막지 않는다.

| 카테고리/파티션 | code | 들고 있는 자리 |
|---|---|---|
| ROOM_ST/000 | `E`·`O`·`R` | `api/src/db/spaceStatus.ts` (`SPACE_STATUS`) |
| CONTRACT_ST/000 | `draft`·`confirmed`·`terminated`·`cancelled` | `shared/domain/contract-status.ts` |
| PAYMENT_METHOD/000 | `M`·`C` | `shared/domain/contract-amounts.ts` |
| QU_ST/000 | `R`·`A` | `shared/domain/inquiry.ts` (`InquiryStatus`) |

> ★ `QU_ST` 는 `CODE_USAGE` 에 줄이 **없다** — 문의 상태는 답변 유무로 유도하고 어디에도
> 저장되지 않는다(`tb_s080_inquiries` 에 상태 컬럼이 없다). 쓰임이 **구조적으로 0건**인데
> `PINNED_CODES` 만으로 보호되는 자리라, 검증이 이 둘로 pinned 경로를 시험한다.

### H-3. 무엇을 막고 무엇을 허용하는가

|  | 판정 |
|---|---|
| 쓰이는 코드 **삭제** | **409** — 몇 건인지와 대안을 문구에 담는다 |
| 쓰이는 코드의 **`code` 값 변경** | **409** — 삭제와 같다. 자료는 코드값으로만 연결된다 |
| 쓰이는 코드 **비활성화** | **409** — `listCodes()` 가 `is_active=true` 로 읽어서, 끄면 **지우지 않았는데** 기존 자료가 이름을 잃는다 |
| **이름(`name`) 변경** | **허용.** 자료는 코드값만 담으므로 안전하고, 고치면 그 코드를 쓰는 화면에 **바로** 반영된다 |
| 순서·설명 변경 | 허용 |
| 코드 남은 파티션 · 파티션 남은 분류 삭제 | 409 — FK `ON DELETE RESTRICT` 와 같은 판정이지만, **문구를 만들려고 먼저 센다** |
| 공통(000) 파티션 · 시스템 분류 · 시스템 코드 | 403 |

> ★ 시스템이면서 pinned 인 코드는 **시스템 잠금이 먼저** 걸려 403 이 나온다(pinned 문구가
> 아니라). 둘 다 막으므로 안전하고, 검증에 그 사실을 적어 두었다 — 나중에 「왜 pinned
> 문구가 안 나오나」를 묻게 될 자리다.

### H-4. 레거시에서 **옮기지 않은 것**

| 빠진 기능 | 이유 |
|---|---|
| **2단 계층** (부모 코드 지정 · `└` 들여쓰기 · `lib/code-tree`) | 근거 컬럼 `parent_line_id` 가 **014 에서 드롭됐다.** 담고 있던 정보(법인형태→표기위치)는 `NAME_POSITION` 분리로 대체됐고, §C-3 이 「담은 정보량이 0」으로 판정한 자리다. **사용자 결정 2026-10-03** |
| **사용용도 자유 텍스트 칸** | 013 의 FK 가 존재하는 파티션만 받으므로, 자유 텍스트는 **넣는 순간 저장이 실패한다.** 파티션 선택 + 파티션 CRUD 로 대체했다(§E-4 가 지적한 결함) |

### H-5. 함께 고친 레거시 결함

- **§E-3** PATCH 중복검사가 `useType`·`parentLineId` 를 안 봤다 → 지금은 코드값 변경 시
  `(build_id, category, use_tp, code)` 로 본다. 같은 code 라도 **다른 파티션이면 별개**이고,
  검증이 그것을 시험한다
- **§E-4** 사용용도가 자유 텍스트 3자(`placeholder="예: WEB"`)였다 → 파티션 번호는 **숫자
  3자**만 받고(`WEB`·`7`·`0007` 은 400), 파티션 자체는 선택한다
- **§E-5** `buildCodeTree` 가 `use_tp` 를 무시해 `MEMBER_TYPE` 의 루트가 3번 반복됐다 →
  표가 **파티션 하나만** 그린다(트리에서 파티션을 골라 들어온다). 반복이 생길 구조가 아니다
- 레거시는 「쓰고 있는 코드」를 **전혀 막지 않았다**(DELETE 가 `is_system` 과 자식 수만 봤다)
  → §H-2·H-3

---

## 부록 — 조사에 쓴 질의

```sql
-- use_tp 분포와 카테고리별 조합
SELECT use_tp, count(*), count(DISTINCT category) FROM tb_s080_codes_line GROUP BY use_tp;
SELECT category, count(*), count(DISTINCT code), string_agg(DISTINCT use_tp,'/' ORDER BY use_tp)
FROM tb_s080_codes_line GROUP BY category ORDER BY category;

-- parent_line_id 채움 여부와 부모 해석
SELECT count(*), count(parent_line_id), count(DISTINCT parent_line_id) FROM tb_s080_codes_line;
SELECT l.code, l.name, l.use_tp, p.code || ' ' || p.name AS 부모
FROM tb_s080_codes_line l LEFT JOIN tb_s080_codes_line p ON p.line_id = l.parent_line_id
WHERE l.category = 'MEMBER_TYPE' ORDER BY l.sort_order, l.code, l.use_tp;

-- 현행 listCodes 가 실제로 내려보내는 것
SELECT DISTINCT ON (category, code) code, name, sort_order FROM tb_s080_codes_line
WHERE category = ANY(ARRAY['ROOM_TP']) AND is_active = true ORDER BY category, code, sort_order;

-- 외부 결합 확인 (FK · 함수)
SELECT con.conname, src.relname, tgt.relname FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid JOIN pg_class tgt ON tgt.oid = con.confrelid
 WHERE con.contype = 'f' AND tgt.relname IN ('tb_s080_code_masters','tb_s080_codes_line');
SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosrc ~ 'tb_s080_code' AND n.nspname NOT IN ('pg_catalog','information_schema');
```

레거시 대조는 `S-WonERP/S-WonERP/src` 에서 `useType` · `parentLineId` 식별자를
전수 검색해 호출처를 역산했다.
