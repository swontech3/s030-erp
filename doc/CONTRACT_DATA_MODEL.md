# 계약 폼 데이터 구조 — 확정 사항

**작성:** 2026-09-13 (작업 4-0)
**성격:** ★ **설계 문서다.** 마이그레이션 파일도 화면도 API 도 만들지 않았다.
**근거 시안:** `design/handoff/prototypes/s0300200040.html` (1,438행)
**근거 조사:** `doc/LEGACY_DATA_SURVEY.md` (3-2a) + 이 문서의 §D(`room_no` 참조 조사)
**대상 DB:** `192.168.0.14:54322` 개발계 — **읽기만 했다.** `SELECT` 외 미실행

페이즈 4(계약 폼)가 이 문서를 보고 짠다.

---

## 0. 먼저 — 시안과 확정 사항이 어긋난 곳 셋

| # | 항목 | 확정 사항 | 시안 | 판정 |
|---|---|---|---|---|
| 1 | **부가세 끝수 처리** | `floor(월이용료 × 0.1)` | **`Math.round`** (708행) | ✗ **다르다** |
| 2 | **호실이 계약구분으로 걸러짐** | 타입별로 호실이 나온다 | **거르지 않는다.** 항상 4실 전부 | ✗ **다르다** |
| 3 | **사물함번호** | 고정석·자유석만 | **시안에 없다** | ✗ 확인 불가 |

나머지(호실별 부가세 · 납부액 · 첫달납부액 · 종료일)는 시안과 확정 사항이 **일치**한다.
자세한 근거는 §B-4.

---

## A. 시안 확인 결과

### A-1. 계약호실(`contract_room`)은 **계약 머리에 한 칸**이다

시안 516~525행. 「계약 조건」 블록 안에 있고, 주석이 `<!-- ─ 3블록 · 계약 조건 ─ 전부 계약당 1개 값 ─ -->`
라고 명시한다.

```html
<div class="field">
  <span class="label">계약호실</span>
  <div class="inline-row">
    <input class="input" data-f="roomNo" readonly style="flex:1;min-width:0">
    <button class="btn btn--ghost" type="button" aria-label="호실 조회" style="width:44px;height:44px;padding:0">
      <i data-lucide="search"></i>
    </button>
  </div>
</div>
```

- **호실 줄마다가 아니다.** 계약 1건에 하나다
- **`readonly` 다.** 직접 입력이 아니라 **조회 버튼(돋보기 44px)으로만** 채우게 설계돼 있다.
  조회 팝업은 미구현(`README.md` TBD 「호실 조회 팝업」)
- **호실이 여러 개일 때 어느 번호를 쓰는지 시안에 단서가 없다.** 자동 선택 로직도,
  안내 문구도 없다. 조회 팝업이 그 판단을 사람에게 맡기는 구조로 보이지만 확인할 수 없다

> ★ **이름 충돌 주의** — 시안은 이 칸의 키를 **`data-f="roomNo"`** 로 쓴다.
> `tb_s080_spaces.room_no`(12자리 해시)와 **이름이 같지만 전혀 다른 값**이다.
> 우리 컬럼명은 `contract_room` 으로 간다(§C-1). 시안 키를 그대로 옮기면 안 된다.

### A-2. 호실 줄의 칸 — 확정 9개와 **정확히 일치**, 삭제 열 하나 더

시안 808~906행(`renderItems`). 열 순서대로.

| # | 칸 | 확정 목록에 | 입력 가능 | 시안 구현 |
|---|---|---|---|---|
| 1 | No | ✔ | — | `el("span","no", i+1)` 자동 번호 |
| 2 | 계약구분 | ✔ | **입력**(Select) | `CONTRACT_TYPES` 5종 |
| 3 | 호실 | ✔ | **입력**(Select) | `ROOMS` — §A-7 |
| 4 | 월회비 | ✔ | 표시 전용 | `inputCell(..., {readonly:true})` |
| 5 | 예치금 | ✔ | **입력**(금액) | `moneyCell` |
| 6 | 월이용료 | ✔ | **입력**(금액) | `moneyCell` + 기준가 차액 표시 |
| 7 | 계산서 | ✔ | **입력**(체크박스) | 기본 체크 |
| 8 | 부가세액 | ✔ | 표시 전용 | `readonly` |
| 9 | 납부액 | ✔ | 표시 전용 | `readonly` + `bold` |
| — | **삭제** | ✗ | (액션) | `trash-2` 버튼. 행이 1개면 비활성. **확정 이후 열 자체를 제거** |

- **시안에 더 있는 칸:** 삭제 열 하나. 값이 아니라 액션이고, 확정(`confirmed`) 이후에는
  grid 트랙에서 통째로 빠진다(10열 → 9열)
- **시안에 없는 칸:** 없다. 확정 9개가 전부 있다
- **★ 사물함 번호 — 시안에 없다.** 호실 줄에도, 계약 머리에도, 어디에도 없다.
  `locker` 로 검색해도 0건이다. 확정 사항(고정석·자유석만)을 시안으로 확인할 수 없다

> 호실을 고르면 **예치금과 월이용료가 함께 채워진다**(864~870행).
> ```js
> state.items[i].room    = v;
> state.items[i].deposit = baseFeeOf(v);   // ← 예치금도 월회비 값으로
> state.items[i].fee     = baseFeeOf(v);
> ```
> 시안은 **예치금 기본값을 월회비와 같은 값**으로 둔다. DB 의 `spaces.deposit` 이
> 72건 전부 NULL 인 것(3-2a)과 이어지는 지점이다 — §C-4.

### A-3. 계약 머리의 칸 — 확정 8개 + **특기사항 1개 더**

시안 515~555행.

| 칸 | 확정 목록에 | 필수 | 시안 |
|---|---|---|---|
| 계약호실 | ✔ | | `readonly` + 조회 버튼 |
| 납부방법 | ✔ | ✱ | Select 「월납 / 일시불」 |
| 첫달납부액 | ✔ | | `readonly`, 강조 배경, 일시불일 때만 산식 문구 |
| 접근경로 | ✔ | | Select 「검색 / 지인소개 / 광고 / 방문」 |
| 계약일자 | ✔ | ✱ | `type="date"` |
| 기간(월) | ✔ | ✱ | 숫자 입력 + 「개월」 접미 |
| 시작일 | ✔ | ✱ | `type="date"` |
| 종료일 | ✔ | | `readonly` — 계산값 |
| **특기사항** | ✗ | | **`span-4` Textarea 2행.** 위에 「할인이 있으면 첫 줄에 자동 기재됩니다」 |

**시안에 더 있는 칸: 특기사항 하나.** 없는 칸: 없다.

그 밖에 「금액 합계」 블록이 계약 조건 바로 위에 5등분으로 있다 —
예치금 합계 · 월회비 합계 · 월이용료 합계(+할인 문구) · 부가세액 합계 · **월납부액 합계**.

섹션 2 헤더 우측에 **건물 Select(「삼성센터」) + 층 Select(「3층/2층」)** 가 있으나
**하드코딩이고 아무것도 거르지 않는다.**

### A-4. ★ 금액 계산 로직 — 시안 코드 그대로

```js
// 676행
const VAT_RATE = 0.1;

// 706~712행
/** 행 단위 부가세 — 계산서발행을 끈 행은 0입니다. */
function rowVat(item) {
  return item.invoice === false ? 0 : Math.round((item.fee || 0) * VAT_RATE);
}
function rowPayment(item) {
  return (item.fee || 0) + rowVat(item);
}

// 715~723행
/** 합계는 전부 행별 값의 합입니다. */
function calcTotals(items) {
  return items.reduce((acc, it) => ({
    deposit: acc.deposit + (it.deposit || 0),
    base:    acc.base    + baseFeeOf(it.room),
    fee:     acc.fee     + (it.fee || 0),
    vat:     acc.vat     + rowVat(it),
    monthly: acc.monthly + rowPayment(it),
  }), { deposit: 0, base: 0, fee: 0, vat: 0, monthly: 0 });
}

// 726~730행
/** 첫달납부액 — 월납은 1개월치, 일시불은 기간 전체입니다. */
function calcFirstPayment(totals, payMethod, months) {
  return payMethod === "일시불"
    ? totals.deposit + months * totals.monthly
    : totals.deposit + totals.monthly;
}

// 733~740행
/** 종료일 = 시작일 + 기간(월) - 1일 */
function calcEndDate(startISO, months) {
  if (!startISO || !months) return "";
  const d = new Date(startISO);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, ".");
}
```

#### 항목별 판정

| 물음 | 시안 | 확정 사항 | 판정 |
|---|---|---|---|
| **끝수 처리** | **`Math.round`** | `floor` | ✗ **다르다** |
| **부가세를 어디서 매기나** | **호실 줄마다**(`rowVat(item)`). 합계는 행별 값의 단순 합(`acc.vat + rowVat(it)`) | 행별 | ○ 일치 |
| 납부액 = 월이용료 + 부가세액 | `rowPayment = fee + rowVat` | 그렇다 | ○ 일치 |
| 「계산서」가 꺼지면 | `item.invoice === false ? 0` — **부가세액이 0**. 다른 처리 없음 | 0 | ○ 일치 |
| 첫달납부액 · 월납 | `deposit + monthly` | 월납부액 합계 + 예치금 합계 | ○ 일치 |
| 첫달납부액 · 일시불 | `deposit + months × monthly` | (월납부액 합계 × 기간) + 예치금 합계 | ○ 일치 |
| 종료일 | 시작일 + 개월 **− 1일** | 하루 뺀다 | ○ 일치 |
| 종료일 · **말일 처리** | 처리 없음 — JS `setMonth` 오버플로 (아래) | 그 달의 말일로 맞춤 | ✗ **다르다** (4-2 에서 확인) |
| **기간 0** | `if (!months) return ""` — 값을 내지 않는다 | **오류** (아래) | ✗ **다르다** (4-2 에서 결정) |

#### ★ 말일 처리 — 시안에 처리가 없다 (4-2 에서 확인해 추가)

위 표의 「종료일 ○ 일치」는 **식만 대조한 것**이다. 4-2 에서 시안 함수를 실제로
돌려 보니 **달의 길이가 다른 경우의 처리가 없다.**

```js
const d = new Date("2026-01-31");
d.setMonth(d.getMonth() + 1);   // 2월 31일 → 없으므로 3월 3일로 넘어간다
d.setDate(d.getDate() - 1);     // 3월 2일
```

| 입력 | 시안 결과 | 서버 규칙 |
|---|---|---|
| 1월 31일 + 1개월 | `2026.03.02` | **`2026-02-27`** |
| 1월 30일 + 1개월 | `2026.03.01` | **`2026-02-27`** |
| 8월 31일 + 6개월 | `2027.03.02` | **`2027-02-27`** |

**서버는 그 달의 말일로 맞춘 뒤 하루를 뺀다.** 1월 31일 + 1개월이면 2월 28일로
맞추고 −1일 해서 2월 27일이다. 시안처럼 달을 넘기지 않는다 — 계약 기간을 1개월로
잡았는데 종료일이 3월로 나가면 계약서와 청구가 어긋난다.

**프런트에 함께 요청할 항목이다** — 끝수(§A-4)와 같은 성격이고, 그쪽은 만원 단위라
지금 안 드러나지만 이쪽은 **말일에 시작하는 계약이면 바로 드러난다.**

#### ★ 기간 0 — 오류로 정했다 (4-2)

시안은 `if (!startISO || !months) return ""` 로 아무 값도 내지 않는다. 「미입력」
표시이지 계산 규칙이 아니다. 서버는 `tb_s080_contracts.end_date` 가 **NOT NULL** 이라
저장할 값이 없다. 기간이 없는 계약은 계약이 아니므로 **조용히 넘기지 않고 던진다.**

#### ★ 「월납부액」은 **부가세를 포함한다**

첫달납부액이 쓰는 `totals.monthly` 의 정의를 따라가면 이렇다.

```
totals.monthly = Σ rowPayment(it)
               = Σ ( it.fee + rowVat(it) )
               = Σ ( 월이용료 + 부가세액 )
```

**부가세 포함이다.** 화면의 「월납부액 합계」(`sum-monthly`, 인디고 강조)도 같은 값을 쓴다.
첫달납부액 산식 문구도 이 값을 그대로 노출한다.

```js
// 1189행 — 일시불일 때만 표시
formula.textContent = "예치금 + " + months + "개월 × " + comma(totals.monthly) + "원";
```

→ **서버 재계산에서 「월납부액」을 부가세 제외로 읽으면 첫달납부액이 틀린다.**

#### ★ 끝수 처리 — `round` vs `floor`

시안은 `Math.round`, 확정 규칙은 `floor` 다. 지금 시안 데이터로는 **차이가 드러나지 않는다** —
월이용료가 전부 만원 단위(400,000 / 80,000)라 `× 0.1` 이 정수로 떨어진다.

차이가 나는 구간은 **월이용료의 1의 자리가 5 이상일 때**다.

| 월이용료 | `× 0.1` | `floor` | `round` | 차 |
|---|---|---|---|---|
| 400,000 | 40,000 | 40,000 | 40,000 | 0 |
| 333,335 | 33,333.5 | 33,333 | **33,334** | 1 |
| 99,999 | 9,999.9 | 9,999 | **10,000** | 1 |

할인을 넣으면 월이용료가 임의 금액이 되므로 실제로 발생한다.
**서버는 `floor` 로 간다(§C-2 ③). 프런트에 `floor` 로 맞춰 달라고 요청해야 한다.**

### A-5. ★ 호실이 계약구분으로 걸러지지 **않는다**

시안 862~872행. 호실 Select 를 만드는 코드가 `item.type` 을 **전혀 참조하지 않는다.**

```js
row.appendChild(selectCell(
  [{ v: "", t: "선택" }].concat(ROOMS.map((r) => ({ v: r.name, t: r.name }))),
  item.room,
  (v) => { ... }
));
```

`ROOMS` 는 하드코딩 4건이고 **타입 정보를 갖고 있지 않다.**

```js
// 629~634행
const ROOMS = [
  { name: "Room-1",  base: 450000 },
  { name: "Room-2",  base: 450000 },
  { name: "Room-5",  base: 880000 },
  { name: "Room-15", base: 90000  },
];
```

계약구분을 바꿔도 호실 목록은 그대로다. **확정 사항(「계약구분에서 선택한 타입별로 호실이
나온다」)과 어긋난다.** 시안만으로는 걸러지는 설계인지 아닌지 알 수 없다.

**호실 목록을 어디서 받는 전제도 시안에 없다.** DB 조회도, API 호출도, 건물·층 Select 와의
연동도 없다. 섹션 2 헤더의 건물·층 Select 는 하드코딩이고 `ROOMS` 와 이어져 있지 않다.

> 실제 DB 는 `tb_s080_spaces.room_type` 에 `R1`/`R2`/`R3`/`FI`/`FR`/`VR` 을 갖고 있으므로
> **거르는 데 필요한 데이터는 있다.** 시안이 그걸 쓰지 않을 뿐이다.

### A-6. 시안 코드값 ↔ DB 코드 대조

| 구분 | 시안 값 (하드코딩) | DB (`tb_s080_codes_line`) | 판정 |
|---|---|---|---|
| **납부방법** | 월납 / 일시불 | `PAYMENT_METHOD`: `M` 월납 · `C` 일시불 | ○ **일치** |
| **계약구분** | `CONTRACT_TYPES` = 비상주 · 고정석 · 1인실 · 2인실 · **팀오피스** | `ROOM_TP`: `VR` 비상주 · `FI` 고정석 · `R1` 1인실 · `R2` 2인실 · **`R3` 3인실** · `FR` 자유석 · `ET` 기타 | ✗ 표시명 1건 + DB 에만 2건 |
| **접근경로** | 검색 · 지인소개 · 광고 · 방문 | `ACCESS_ROUTE`: `D` 네이버 검색 · `O` 네이버 블러그 · `R` 구글 검색 · `A` 인스타그램 · `X` 페이스북 · `F` 지인추천 · `E` 기타 | ✗ 대응 안 됨 |
| **회원구분** | `MEMBER_TYPES` = 프리랜서 · 개인사업자 · 법인 | `MEMBER_TYPE`: 주식회사(앞/뒤) · 유한회사 · 농/어업회사법인 · 사회적 기업/협동조합 · 개인 | ✗ **개념이 다르다** |
| **이메일 도메인** | `EMAIL_DOMAINS` 6종 + 「직접입력」 | **없음** | ✗ **DB 에 코드 자체가 없다** |

- **계약구분** — 시안 「팀오피스」 ↔ DB 「3인실」(`R3`)이 같은 자리다(§C-3 ①).
  시안에 없는 DB 값: **자유석(`FR`) · 기타(`ET`)**. 시안 5종 vs DB 7종
- **접근경로** — 시안 「방문」에 대응하는 DB 코드가 없다. 반대로 DB 는 검색을 네이버·구글로,
  SNS 를 셋으로 나눈다. **1:1 대응이 성립하지 않는다**
- **회원구분** — DB 는 **법인 형태 + 상호 표기 위치**(「주식회사 앞/뒤」)를 담는다.
  「프리랜서」·「개인사업자」 문구는 DB 전체에 0건. **같은 이름의 다른 개념이다**
- **이메일 도메인** — 시안 기본값이 `bridgelab.co.kr`(예시 입주사 도메인)이다.
  디자인팀에 수정 요청해 둔 상태(`doc/DESIGN_REVIEW_1.md`)

### A-7. 시안이 호실 셀렉트에 쓰는 값 — **`room_name` 도 `space_id` 도 아닌 이름 문자열**

```js
ROOMS.map((r) => ({ v: r.name, t: r.name }))
//                     ↑값        ↑표시
const baseFeeOf = (roomName) => (ROOMS.find((r) => r.name === roomName) || {}).base || 0;
```

| | 시안 |
|---|---|
| 화면 표시 | `"Room-1"` |
| 내부 값 | **`"Room-1"` — 같은 문자열** |
| 금액 조회 키 | **이름 문자열로 `find`** |

**`space_id` 를 쓰지 않는다. `room_no` 도 쓰지 않는다.** 시안은 이름 문자열 하나로
표시·값·조회를 전부 처리한다. 저장 키 개념이 없다.

> 이름이 바뀌면 금액 조회가 깨지고, 같은 이름이 둘이면 구분이 안 된다.
> **우리는 저장 키를 `space_id` 로 간다**(§C-1). 시안 구조를 그대로 옮기면 안 된다.
>
> 참고로 실제 DB 의 `room_name` 은 `"VIR 13"` · `"Room 10"` 형태(공백)이고
> 시안은 `"Room-1"`(하이픈)이다. 예시값이라 형식이 다르다.

---

## B. `room_no` 참조 조사 (읽기 전용)

`tb_s080_spaces.room_no` 는 72건 전부 12자리 해시(`00b88091fce2`)다.
**지울 수 있는지 판단할 재료만 모았다. 지우지 않았다.**

### B-1. 같은 값을 담는 컬럼이 다른 곳에 있는가 — **0건**

```sql
-- 이름이 room_no 인 컬럼 전수
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND column_name='room_no';
-- → tb_s080_spaces.room_no 하나뿐
```

이름이 다르더라도 **같은 해시값이 실제로 들어 있는지**를 값 단위로 확인했다.

```sql
-- public 의 모든 text/varchar 컬럼(354개)에 대해 반복
SELECT count(*) FROM public."<테이블>" x
WHERE x."<컬럼>" IN (SELECT room_no FROM public.tb_s080_spaces);
```

| 검사 대상 | 결과 |
|---|---|
| `public` 의 text/varchar 컬럼 | **354개** |
| `room_no` 의 72개 값과 일치한 컬럼 | **★ 0개** |
| 12자리 hex 형태 값을 가진 다른 컬럼 | **0개** |

이름에 `room` 이 들어간 컬럼은 7개인데 전부 다른 값을 담는다.

| 테이블 | 컬럼 | 실제 내용 |
|---|---|---|
| `tb_s080_spaces` | `room_no` | 12자리 해시 ← **조사 대상** |
| `tb_s080_spaces` | `room_name` | `VIR 13` — 사람이 읽는 이름 |
| `tb_s080_spaces` | `room_type` | `VR`/`R1`/… 계약구분 코드 |
| `tb_s080_contracts` | `contract_room` | `6-1`, `112-3` — 세무 제출 번호 |
| `tb_s080_space_room` | `contract_room` | (0행) |
| `tb_s080_space_room` | `room_space_id` | PK |
| `tb_s080_floors` | `has_meeting_room` | boolean |

뷰·함수 정의에 `room_no` 가 나오는 곳도 **0건**이다.

```sql
SELECT 'view', table_name FROM information_schema.views
WHERE table_schema='public' AND view_definition ~ 'room_no'
UNION ALL
SELECT 'routine', routine_name FROM information_schema.routines
WHERE routine_schema='public' AND routine_definition ~ 'room_no';
-- 0행
```

### B-2. ★ UNIQUE 인덱스에 들어 있다

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND indexdef ~ 'room_no';
```

| 인덱스 | 정의 |
|---|---|
| `tb_s080_spaces_floor_id_room_no_key` | **`CREATE UNIQUE INDEX … ON tb_s080_spaces USING btree (floor_id, room_no)`** |

**`room_no` 는 `(floor_id, room_no)` 복합 UNIQUE 인덱스의 구성 컬럼이다.**
컬럼을 지우면 이 유일성 보장도 함께 사라진다 — 층 안에서 호실을 유일하게 만드는
장치가 이것 하나뿐이다(`room_name` 에는 UNIQUE 가 없다).

```sql
-- 제약(pg_constraint)으로는 잡히지 않는다 — CONSTRAINT 가 아니라 INDEX 로 만들어졌다
SELECT con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con
JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname='public' AND cl.relname='tb_s080_spaces'
  AND pg_get_constraintdef(con.oid) ~ 'room_no';
-- 0행
```

> ★ **`doc/LEGACY_DATA_SURVEY.md` 정정** — 그 문서 A-1 에 "UNIQUE 제약도 CHECK 제약도 없다"
> 고 적었다. `pg_constraint` 만 봤기 때문이다. **UNIQUE 인덱스는 있다.**
> 유일성은 제약이든 인덱스든 똑같이 강제되므로, 그 문장은 고쳐 읽어야 한다.

`room_no` 를 **참조하는 FK 는 없다.** `tb_s080_spaces` 를 참조하는 FK 2건은 전부
`space_id` 를 가리킨다.

```sql
SELECT cl.relname, con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con
JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
WHERE n.nspname='public' AND con.contype='f' AND pg_get_constraintdef(con.oid) ~ 'tb_s080_spaces';
```

| 참조하는 쪽 | 정의 |
|---|---|
| `tb_s080_space_room` | `FOREIGN KEY (space_id) → tb_s080_spaces(space_id) ON DELETE CASCADE` |
| `tb_s080_contracts` | `FOREIGN KEY (space_id) → tb_s080_spaces(space_id) ON DELETE RESTRICT` |

### B-3. `tb_s080_space_room` 과 이어지는가 — **아니다**

0행이라 데이터로는 확인할 수 없으므로 구조와 제약으로만 판단했다.

| # | 컬럼 | 타입 | NULL |
|---|---|---|---|
| 1 | `room_space_id` | text | NO (PK) |
| 2 | `space_id` | text | NO (**FK → spaces.space_id**) |
| 3 | `build_id` | text | NO |
| 4 | `floor_id` | text | NO |
| 5 | `contract_room` | varchar(50) | NO |
| 6~9 | 감사 4컬럼 | | |

**`room_no` 를 담는 컬럼도, 참조하는 FK 도 없다.** 연결은 `space_id` 로만 이뤄진다.

이 테이블의 성격은 **호실 ↔ 세무 제출 번호 매핑**으로 읽힌다(`space_id` + `contract_room`).
지금 실제 값은 `tb_s080_contracts.contract_room` 에 들어가 있고 이쪽은 비어 있다 — §C-4.

### B-4. `019_rename_tenant.sql` 이 건드리는가 — **아니다**

`019` 는 `tenant_id` → `operator_id` 개명 작업이고, 대상은 9개 테이블이다
(`tenant010` · `buildings` · `tb_cm_file` · `departments` · `employees` ·
`incorporations` · `corp_changes` · `form_templates` · `doc_form_settings`).

**`tb_s080_spaces` 는 대상에 없다.** `room_no` 는 게이트와 무관하다.
게이트가 알아서 정리해 주지 않는다는 뜻이기도 하다.

### B-5. ★ 이 조사의 한계 — 레거시 애플리케이션 코드는 알 수 없다

**DB 조사로는 레거시 S-WonERP 애플리케이션이 이 컬럼을 읽는지 알 수 없다.**
그 저장소가 이 작업 공간에 없다.

> **★ 2026-09-13 정정 — 레거시 S-WonERP 는 지금 쓰이지 않는다.** 조사 당시에는
> "운영 중"으로 적었다. 그래서 「레거시가 깨질 수 있다」가 보류 사유의 하나였는데,
> 그 사유는 없어졌다. **결론은 그대로다 — `room_no` 를 지우지 않는다.** 남은 이유가
> 「지워서 얻을 것이 없다」 하나로 줄었을 뿐이다.

위에서 확인한 것은 **DB 안쪽뿐**이다 — 다른 컬럼, FK, 인덱스, 뷰, 함수.
애플리케이션이 `SELECT room_no FROM tb_s080_spaces` 를 한다면 이 조사에 잡히지 않는다.

> **「참조 0건」은 「지워도 안전」을 뜻하지 않는다.**
> `room_no` 를 지우려면 레거시 저장소에서 `room_no` 문자열을 직접 찾아봐야 한다.
> 그 전까지는 지우지 않는다.

### B 요약

| 물음 | 답 |
|---|---|
| 같은 값을 담는 다른 컬럼 | **0건** (354개 text 컬럼 전수 확인) |
| 참조하는 FK | **0건** |
| 걸린 제약·인덱스 | **UNIQUE 인덱스 1건** — `(floor_id, room_no)` |
| 뷰·함수 참조 | **0건** |
| `space_room` 과 연결 | **없음** (`space_id` 로만 이어짐) |
| `019` 가 건드리는가 | **아니다** |
| 레거시 앱이 쓰는가 | **알 수 없다 — 저장소가 없다** |

---

## C. 확정 사항

### C-1. 테이블 구조

★ **마이그레이션 파일을 만들지 않았다.** 아래는 문서상의 구조다.

#### `tb_s080_contracts` — 계약 1건

| 컬럼 | 의미 | 비고 |
|---|---|---|
| `contract_room` | 세무서 제출 호실번호 | 지금은 텍스트 입력. 추후 미사용 번호 조회 팝업. **계약당 1개**(§A-1) |
| `payment_method` | 납부방법 | 코드 `PAYMENT_METHOD` — `M` 월납 / `C` 일시불 |
| `access_route` | 접근경로 | 코드 `ACCESS_ROUTE` — §C-3 ② |
| `first_payment` | 첫달납부액 | 계산값. 서버가 다시 계산 |
| `contract_date` | 계약일자 | 기본값 오늘, 수정 가능 |
| `period_months` | 기간(월) | 숫자 입력 |
| `start_date` | 시작일 | 기본값 오늘, 수정 가능 |
| `end_date` | 종료일 | **시작일 + 기간(월) − 1일** |

> 기존 `tb_s080_contracts` 는 이미 32컬럼이고 `payment_method`·`access_route`·
> `contract_room` 이 **이미 있다**(3-2a). 새로 만드는 것이 아니라 **기존 테이블을 쓸지
> 새로 만들지**가 페이즈 4 의 첫 판단이다 — §C-4.

#### `tb_s080_contract_spaces` — 호실 N건 (**새 테이블**)

| 컬럼 | 의미 | 입력/계산 | 비고 |
|---|---|---|---|
| `seq` | No | 자동 | 표시 순서 |
| `room_type` | 계약구분 | 입력 | 코드 `ROOM_TP` |
| `space_id` | 호실 | 입력 | **화면은 `room_name`, 저장은 `space_id`** |
| `standard_fee` | 월회비 | 표시 전용 | 호실 `standard_fee` **복사**(§C-2 ①②) |
| `deposit` | 예치금 | 입력 | 호실 `deposit` 기본값, 수정 가능 |
| `monthly_fee` | 월이용료 | 입력 | 할인 반영 실제 금액(**부가세 제외**) |
| `vat_yn` | 부가세 대상 여부 | 입력 | ★ `invoice_yn` 으로 두지 않는다(§C-2 ④) |
| `vat_amount` | 부가세액 | **서버 계산** | `floor(monthly_fee × 0.1)`. `vat_yn='N'` 이면 0 |
| `payment_amount` | 납부액 | **서버 계산** | `monthly_fee + vat_amount` |
| `locker_no` | 사물함번호 | 입력 | 고정석·자유석만. **★ 시안에 없어 확인하지 못했다**(§A-2) |

★ **레거시에는 이 테이블이 없다.** 기존 계약은 `space_id` 단일 NOT NULL 로
계약 1건 = 호실 1개다(3-2a D-2). 최대 10항목을 담을 곳을 새로 만들어야 한다.

#### 계산 규칙 (서버 기준)

```
vat_amount     = vat_yn = 'N' ? 0 : floor(monthly_fee × 0.1)
payment_amount = monthly_fee + vat_amount

월납부액 합계   = Σ payment_amount        ← ★ 부가세 포함
예치금 합계     = Σ deposit

first_payment  = 월납   : 예치금 합계 + 월납부액 합계
                 일시불 : 예치금 합계 + (월납부액 합계 × period_months)

end_date       = start_date + period_months − 1일
```

**부가세는 호실 줄마다 매긴다.** 합계에 한 번 매기지 않는다(§A-4).
행별로 `floor` 하고 더하므로 「합계에 `floor`」와 결과가 다를 수 있다 — 행별이 맞다.

#### ★ 전대차계약서 월회비 — 비상주 특례 (2026-09-17 확정, 4-3)

**계약서 2종은 계약 유형을 고르는 것이 아니다.** 계약 1건에서 이용계약서와
전대차계약서를 **둘 다** 찍는다(`design/handoff/tenant-contract/06-contracts.md`).
그래서 `contract_type` 컬럼을 만들지 않는다 — CONT-12 는 이 결정으로 닫는다.

두 문서의 금액 기준이 다르다.

| 문서 | 금액 기준 |
|---|---|
| 이용계약서 「월납부액」 | 실계약가 — `Σ(monthly_fee + 부가세)` (설계 그대로) |
| 전대차계약서 2조 2항 「월회비」 | **아래 분기** |

```
호실이 1~2건이고 그 전부가 계약구분 「비상주」(ROOM_TP = VR)
    → Σ(standard_fee + floor(standard_fee × 10%))      기준가

그 외 (3건 이상 · 비상주 아닌 줄이 하나라도 섞임 · 0건)
    → Σ(monthly_fee  + floor(monthly_fee  × 10%))      실계약가
```

**사유** — 비상주는 할인폭이 커서 실제 계약금액으로 내면 **세무서가 인정하지 않는
경우가 많다.** 전대차계약서는 세무서 제출용이라 호실 지정금액으로 찍는다.

**★ 계약 단위 판정이다. 줄마다 나누지 않는다.** 비상주 줄만 기준가로 바꾸고 나머지는
실계약가로 두는 식으로 섞지 않는다 — 섞으면 문서에 찍히는 합계가 어느 쪽 기준인지
설명할 수 없는 숫자가 된다. 줄이 하나라도 비상주가 아니면 **계약 전체가** 빠진다.

**★ 부가세는 고른 기준액에서 다시 계산한다.** 기준가로 갈 때 실계약가에서 나온
부가세를 그대로 얹지 않는다. `vat_yn` 이 꺼진 줄은 0인 것도 같다.

**★ 판정은 코드값(`VR`)으로 한다. 표시명("비상주")으로 비교하지 않는다.**
표시명은 바뀔 수 있고 실제로 바뀔 예정이다(`R3` 「3인실」→「팀오피스」, §C-3 ①).

구현은 `calcSubleaseMonthlyPayment()` — `packages/shared/src/domain/contract-amounts.ts`.
규칙의 기록은 같은 폴더의 테스트 12건이다.

### C-2. ★ 판단 여섯

#### ① 금액은 계약에 복사해 박는다. 호실을 참조하지 않는다

호실의 `standard_fee` 를 나중에 올려도 **과거 계약 금액이 바뀌면 안 된다.**
이미 발행한 세금계산서와 어긋난다.

호실 값은 **입력을 편하게 해주는 기본값**일 뿐이다. 계약 저장 시점의 값이 계약에 남는다.
`tb_s080_contract_spaces` 가 `tb_s080_spaces` 를 조인해 금액을 읽으면 안 된다.

> 실제로 그럴 위험이 있다 — 지금 72실의 `standard_fee` 는 타입별로 **한 값으로 통일**돼
> 있다(3-2a). 기준가를 한 번 고치면 그 타입의 과거 계약이 전부 따라 움직인다.

#### ② 월회비도 저장한다

`standard_fee` 는 화면에서 표시 전용이지만 **계약에 복사해 남긴다.**

남기지 않으면 나중에 **"그때 기준가가 얼마였는데 얼마에 해줬다"를 알 수 없게 된다.**
할인 여부와 할인율이 사후에 계산 불가능해진다. 시안도 이 값을 화면에 띄우고
차액(`기준가 대비 -110,000원 (11.1% 할인)`)을 계산하는데, 그 계산의 근거가 사라진다.

#### ③ 부가세는 서버에서 다시 계산한다

**화면 값을 그대로 저장하지 않는다.** 화면은 보여주기용이고, 저장되는 `vat_amount` ·
`payment_amount` 는 서버가 `monthly_fee` 로부터 다시 계산한 값이다.
**세금계산서가 걸려 있다.**

프런트가 같은 규칙이면 값이 일치한다.
**일치하지 않으면 서버 값을 쓰고 경고를 남긴다.**

> ★ **지금 당장 일치하지 않는다.** 시안은 `Math.round`, 서버 규칙은 `floor` 다(§A-4).
> 프런트에 `floor` 로 맞춰 달라고 요청해야 한다. 그 전까지는 **경고가 계속 뜬다** —
> 경고를 끄지 말고 프런트를 고친다.

#### ④ 「계산서」는 발행 여부가 아니라 **부가세 대상 여부**다

세금계산서는 **계약 1건으로 한 장** 나간다. 호실별로 쪼개지지 않는다.
이 칸은 그 호실에 부가세를 매길지를 정하는 스위치다.

★ **컬럼명을 `invoice_yn` 으로 두지 않는다. `vat_yn` 으로 한다.**
`invoice_yn` 이면 나중에 누가 **"이 호실만 계산서 따로"** 로 읽는다.

> 시안의 내부 키가 `item.invoice` 다(`invoice: true`). **그 이름을 그대로 옮기면 안 된다.**
> 시안의 열 제목도 「계산서」라 같은 오해를 부른다 — 화면 문구는 디자인 소관이지만
> **DB 컬럼명은 우리가 정한다.**

#### ⑤ 호실 상태는 계약에서 계산한다. 호실 테이블에 저장하지 않는다

```
계약 없음         공실
draft 계약        예약중
confirmed 계약    입주중
```

지금은 호실 테이블(`tb_s080_spaces.status`)에 상태가 직접 들어 있다. 계약이 생기면
**같은 사실이 두 곳에 있게 되고 반드시 어긋난다** — 계약은 확정됐는데 호실은 공실로
남는 식이다. 호실이 72개뿐이라 계산 부담이 없다.

> ★ **이미 어긋나 있다.** 가정이 아니다. 조회 결과다.
>
> ```sql
> SELECT s.status 호실상태, s.room_name, s.room_type,
>        count(k.contract_id) 계약수, string_agg(k.status, ',') 계약상태
> FROM tb_s080_spaces s
> LEFT JOIN tb_s080_contracts k ON k.space_id = s.space_id
> WHERE s.status <> 'E' OR k.contract_id IS NOT NULL
> GROUP BY s.space_id, s.status, s.room_name, s.room_type
> ORDER BY s.status, s.room_name;
> ```
>
> | 호실상태 | room_name | 타입 | 계약수 | 계약상태 |
> |---|---|---|---|---|
> | `O` 입주중 | Room 10 | R1 | 1 | A |
> | `O` 입주중 | VIR 28 | VR | 1 | A |
> | **`O` 입주중** | **VIR 40** | VR | **0** | — |
> | **`O` 입주중** | **VIR 45** | VR | **2** | **A, P** |
> | `O` 입주중 | VIR 46 | VR | 1 | A |
> | **`R` 예약중** | **Room 12** | R2 | **0** | — |
>
> - **`VIR 40`** — 입주중인데 **계약이 없다**
> - **`Room 12`** — 예약중인데 **계약이 없다**
> - **`VIR 45`** — 계약이 **2건**(확정 1 + 대기 1). 호실 상태 한 칸으로는 표현 불가
>
> 반대 방향(계약이 있는데 공실)은 0건이다.

★ 지금 호실에 있는 상태값(입주중 5 · 예약중 1)은 **이전 개발의 시험 데이터**다.
**정리는 이 작업이 아니라 페이즈 4 착수 시점에 한다.** 정리 대상으로 §C-4 에 올린다.

#### ⑥ ★ `room_no` 는 새 시스템에서 쓰지 않는다. 다만 지우지 않는다

| 용도 | 쓰는 값 | 예 |
|---|---|---|
| 화면 표시 | **`room_name`** | `VIR 13` |
| 저장 키 | **`space_id`** | `y6vlufnzgcgf293pwu5tnq1i` |
| 세무 제출 | **`contract_room`** | `6-1` |
| **쓰지 않음** | **`room_no`** | `00b88091fce2` |

컬럼을 남기는 비용은 사실상 0이고(72행), 지우는 것은 되돌릴 수 없다.
진짜 위험은 컬럼이 있는 것이 아니라 **누군가 화면에 해시를 쓰는 것**이고,
그건 위 표를 문서에 박아 두면 막힌다.

**B 의 조사 결과 요약**

- 같은 값을 담는 다른 컬럼 **0건**(354개 text 컬럼 전수)
- 참조 FK **0건** · 뷰·함수 참조 **0건**
- **다만 `(floor_id, room_no)` UNIQUE 인덱스의 구성 컬럼**이다. 지우면 층 안 호실
  유일성 보장이 함께 사라진다 — `room_name` 에는 UNIQUE 가 없다
- `tb_s080_space_room` 과는 이어지지 않는다(`space_id` 로만)
- `019` 가 건드리지 않는다

**참조가 0건으로 나와도 결론은 같다 — 레거시 애플리케이션 코드가 읽는지는
DB 조사로 알 수 없다**(§B-5). 저장소가 여기 없다.

정리한다면 **게이트(`019`) 때가 맞다.** 어차피 운영 앱을 세우는 작업이라
정지 창을 한 번만 쓰면 된다. 그때 레거시 저장소에서 `room_no` 를 검색해 확인한 뒤,
UNIQUE 인덱스를 `(floor_id, room_name)` 으로 옮길지 함께 정한다.

#### ⑦ ★ 주소는 **세 종류**다 — 계약 폼이 받는 것은 대표자 자택 주소다

**확정: 2026-09-18 (4-4).** `DESIGN_HANDOFF_DIFF.md` §F-6 ① 의 「주소 라벨 충돌」은
여기서 닫힌다 — **디자인팀 라벨이 맞았고 우리 가정이 틀렸다.**

| 주소 | 어디서 받는가 | 어디에 쓰는가 | 어디에 저장하는가 |
|---|---|---|---|
| **대표자 자택 주소** | 계약 폼 섹션 1 「대표자 주소」(우편번호·기본·상세 3칸) | 계약서 「주소」 행에 인쇄 | **ERP 만 보관한다** |
| **사업장 주소** | ★ **화면 입력란이 없다.** 건물 주소 + 계약호실로 만든다 | 세금계산서 · 삐용 `org010.ADDRESS` | ERP(건물·계약) + 삐용 |
| **법인 등기 주소** | 등기부등본 | 법무 업무 | **ERP 는 다루지 않는다** |

**저장 위치 (2026-09-18, 3-4 · 마이그레이션 `011`)**

| 화면 | 컬럼 | 비고 |
|---|---|---|
| 대표자 주소 3칸 | `tb_s080_companies.ceo_zip_code` · `ceo_address` · `ceo_address_detail` | **신설.** 계약서에 인쇄된다 |
| (화면 없음) 사업장 주소 | `address` · `zip_code` · `address_detail` | 세금계산서·삐용 `org010.ADDRESS` 가 읽는 칸. 주석을 달아 못박았다 |
| (ERP 무관) 본점 주소 | `head_address` 계열 | 레거시 칸. 손대지 않았다 |

기존 `address` 에 자택을 넣지 않은 이유가 위 표의 2행이다 — 그 칸은 이미 사업장 주소
자리이고, 거기 넣으면 아래 sink 교정으로 막은 사고가 **컬럼 단위로 되돌아온다.**

`packages/shared/src/tenant-registration.ts` 의 `zipCode`·`address`·`detailAddress`
세 항목은 `sink: 'bbiyong'` → **`'erp'`** 로 바꿨다. 3-1 에서 이 값을 회사 주소로
보고 삐용에 보내도록 정의해 뒀는데, 그대로 두면 **대표자 집 주소가 회사 주소로
등록되고 세금계산서·계약서에 그 주소가 인쇄된다.**

★ **사업장 주소를 삐용에 올리는 경로는 아직 없다.** 조직 정보 수정 API 규격을
삐용에 요청해 회신을 기다리는 중이다. 그때까지 삐용 `org010.ADDRESS` 는 회사 등록
시점 값으로 남는다 — 계약이 바뀌어도 따라가지 않는다. 이 지연은 **알고 남긴 것**이다.

### C-3. 코드 정비 항목

★ **실행하지 않았다.** 무엇을 해야 하는지만 적는다. DB 에 쓴 것이 없다.

| # | 항목 | 내용 |
|---|---|---|
| ① | **`ROOM_TP` 「3인실」 → 「팀오피스」** | 표시명만 바꾼다. **코드값 `R3` 는 그대로 둔다** — 값을 바꾸면 기존 데이터가 깨진다. 라인 2건(`use_tp` 000/001)이 같은 이름이라 둘 다 대상 |
| ② | **`ACCESS_ROUTE` 에 「방문」이 없다** | 필요하면 라인을 추가한다. 시안은 「검색/지인소개/광고/방문」 4종이고 DB 는 7종인데 **1:1 대응이 안 된다.** 어느 쪽을 정본으로 삼을지 먼저 정해야 한다 |
| ③ | **`ACCESS_ROUTE` 「네이버 블러그」 오타** | 「네이버 블로그」로 보인다. **운영 데이터라 확인 후 판단.** 표시명만 고치면 되고 코드값 `O` 는 유지 |
| ④ | **이메일 도메인 코드가 없다** | 시안이 도메인 Select 를 쓴다면 코드 마스터를 새로 만들어야 한다. ★ 시안 기본값이 `bridgelab.co.kr`(예시 입주사 도메인)이라 **디자인팀에 수정 요청해 둔 상태**(`doc/DESIGN_REVIEW_1.md`) |
| ⑤ | **`MEMBER_TYPE` 은 시안과 개념이 다르다** | DB 의 것은 **법인 형태 + 상호 표기 위치**(「주식회사 앞/뒤」)다. 시안의 「프리랜서」·「개인사업자」는 DB 에 **0건**. **같은 이름의 다른 개념이므로 그대로 연결하면 안 된다.** 새 코드 카테고리를 만들지, `MEMBER_TYPE` 을 재정의할지 판단이 필요하다 |

> ①③ 은 표시명만 바꾸는 것이라 `UPDATE tb_s080_codes_line SET name=...` 한 줄이다.
> ②④⑤ 는 **판단이 먼저** 필요하다.

### C-4. 열린 채로 남길 것

| # | 항목 | 상태 |
|---|---|---|
| 1 | `contract_room` 미사용 번호 조회 팝업 | 추후. 시안에 버튼만 있고 동작 없음 |
| 2 | **호실에 `contract_room` 대응값이 있는가** | 3-2a 에서 안 나왔고 이번에도 확인했다 — `tb_s080_spaces` 에 `contract`·`report`·`tax`·`nts` 계열 컬럼이 **0개**. `tb_s080_space_room`(0행)이 그 자리로 보인다(`space_id` + `contract_room varchar(50)`). **비어 있어 확정 불가** |
| 3 | **`space_room` 과 `contracts.contract_room` 중 정본** | 전자는 0행, 후자에 실제 값(`6-1`·`112-3`). **호실별 고정 번호인지 계약별 값인지**가 갈린다 |
| 4 | 시험 데이터 정리 시점과 방법 | 호실 상태 6건(입주중 5·예약중 1) + 계약 5건 + 청구 31건. **페이즈 4 착수 시점**에 한다 |
| 5 | `room_no` 컬럼 정리 시점 | **게이트(`019`)와 함께.** 레거시 저장소 검색이 선행 조건(§B-5). UNIQUE 인덱스 이전도 함께 |
| 6 | **`tb_s080_contracts` 를 재사용할지 새로 만들지** | 기존 32컬럼에 `payment_method`·`access_route`·`contract_room` 이 이미 있다. 다만 `space_id` 가 **단일 NOT NULL** 이라 호실 N개 구조와 충돌한다. 컬럼을 NULL 허용으로 바꾸거나 테이블을 새로 만들어야 한다 |
| 7 | **사물함번호가 시안에 없다** | 확정 사항(고정석·자유석만)을 시안으로 확인하지 못했다. 디자인팀 확인 필요 |
| 8 | **호실이 계약구분으로 걸러지는지** | 확정 사항과 시안이 어긋난다(§A-5). DB 에 `room_type` 이 있어 거르는 것은 가능하다 |
| 9 | 부가세 끝수 `floor` vs `round` | 서버는 `floor`. **프런트 수정 요청 필요**(§A-4) |
| 10 | 종료일 **말일 처리** — 시안에 없다 | 서버는 그 달 말일로 맞춤. **프런트 수정 요청 필요**(§A-4 말일 절, 4-2 에서 발견) |
| 11 | **기간 0** | 서버는 오류. `end_date` 가 NOT NULL 이다(4-2 결정) |
| 10 | 접근경로 정본 | 시안 4종 vs DB 7종, 1:1 대응 불가(§C-3 ②) |

---

## 확인하지 못한 것 — 시안에 없어서

| 항목 | 왜 |
|---|---|
| **사물함번호** | 시안 어디에도 없다. `locker` 검색 0건 |
| **호실 목록의 출처** | DB 조회도 API 도 없다. `ROOMS` 하드코딩 4건 |
| **호실이 계약구분으로 걸러지는 규칙** | 거르는 코드 자체가 없다 |
| **계약호실을 여러 호실 중 어떻게 고르는지** | 조회 팝업 미구현. 자동 선택 로직 없음 |
| **건물·층 Select 가 호실을 어떻게 거르는지** | 하드코딩이고 `ROOMS` 와 연결 없음 |
| **오류 표시** | 필수 미입력 시 어느 칸이 어떻게 표시되는지 없다(`.err` 는 사업자번호에만) |

---

## 이 문서가 정하지 않은 것

- 마이그레이션 SQL — **만들지 않았다**
- 코드 표시명 수정 — **실행하지 않았다**
- 시험 데이터 정리 — **하지 않았다**
- `room_no` 삭제 — **하지 않았다**
- 화면·API — **구현하지 않았다**
