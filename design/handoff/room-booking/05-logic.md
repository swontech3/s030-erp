# 계산 · 검증 로직

모든 시각은 **자정부터의 분(minute)** 정수로 다룹니다. 표시할 때만 `HH:MM` 으로 바꿉니다.
날짜는 `YYYY-MM-DD` 문자열 — 문자열 비교가 곧 날짜 비교입니다.

---

## 1. 상수

```js
const SLOT = 30;                  // 전 회의실 공통 단위
const TENANT_ADVANCE_DAYS = 28;   // 오늘 포함 → 마지막 날 = 오늘 + 27
const TENANT_DAILY_MIN = 120;     // 조직당 하루
```

회의실별 값(운영시간·최소·최대·정원·30분 요금)은 **상수가 아니라 설정값**입니다 (`07-data-model.md#1`).
템플릿 상단의 `CLOSE_HOUR` · `MAX_SLOTS_PER_BOOKING` · `OVER_RATE_PER_SLOT` · `FREE_SLOTS` 는 전부 없앱니다.

---

## 2. 시간 유틸

```js
const fmt = (min) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");

const dur = (min) => {                       // 90 → "1시간 30분", 30 → "30분", 120 → "2시간"
  const h = Math.floor(min / 60), m = min % 60;
  return (h ? h + "시간" : "") + (h && m ? " " : "") + (m ? m + "분" : "");
};

// 날짜+분 → 비교용 절대값. 타임존 흔들림을 피하려고 UTC 일수로 셉니다.
const dayNo = (k) => { const [y, m, d] = k.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
const abs = (date, min) => dayNo(date) * 1440 + min;

const lastBookableDate = addDays(today, TENANT_ADVANCE_DAYS - 1);
```

> 현재 시각은 **서버 기준**으로 받으세요. 사용자 PC 시계가 틀리면 지난 시각 판정이 어긋납니다.
> 화면은 진입 시 받은 서버 시각 + 경과 시간으로 계산하면 충분합니다.

---

## 3. 그리드 좌표

```js
const rows   = (room.closeMinute - room.openMinute) / SLOT;
const slotOf = (min) => (min - room.openMinute) / SLOT;     // 0부터
const top    = slotOf(b.start) * 28 + 1;
const height = (b.end - b.start) / SLOT * 28 - 2;
const nowTop = (now - room.openMinute) / SLOT * 28;          // open ≤ now < close 일 때만
```

진입 스크롤 `scrollTop = max(0, slotOf(now − 60) × 28)`.

---

## 4. 시간 검증 — ★ 순서가 우선순위

**첫 번째 위반 하나만** 보여줍니다. 여러 줄을 한꺼번에 띄우면 무엇부터 고칠지 알 수 없습니다.

```js
function checkTime(d, exceptId) {            // d = { room, date, start, end }
  const r = roomOf(d.room);
  const len = d.end - d.start;

  if (len <= 0)
    return "종료 시각은 시작 시각보다 늦어야 합니다";
  if (bookings.some((b) => b.status !== "cancelled" && b.id !== exceptId &&
        b.room === d.room && b.date === d.date && d.start < b.end && d.end > b.start))
    return "이미 예약된 시간과 겹칩니다";
  if (len < r.minMinutes)
    return r.name + "은 최소 " + dur(r.minMinutes) + " 이상 예약할 수 있습니다";
  if (len > r.maxMinutes)
    return r.name + "은 한 번에 최대 " + dur(r.maxMinutes) + "까지 예약할 수 있습니다";

  if (viewer === "tenant") {
    if (abs(d.date, d.start) < abs(today, now))
      return "지난 시각은 예약할 수 없습니다";
    if (d.date > lastBookableDate)
      return md(lastBookableDate) + "까지 예약할 수 있습니다 (오늘부터 4주)";
    const used = usedMinutes(myOrgId, d.date, exceptId);
    if (used + len > TENANT_DAILY_MIN)
      return "하루 2시간까지 예약할 수 있습니다 · 이 날 " + dur(used) + " 예약되어 있습니다";
  }
  return null;
}

function usedMinutes(orgId, date, exceptId) {
  return bookings
    .filter((b) => b.status !== "cancelled" && b.orgId === orgId && b.date === date && b.id !== exceptId)
    .reduce((n, b) => n + (b.end - b.start), 0);           // 모든 회의실 합산
}
```

- 시간·회의실·날짜가 바뀔 때마다 실행하고, 오류가 있으면 **제출 버튼 disabled**
- 제목 필수는 여기가 아니라 **제출 시** 검사합니다 (열자마자 빨간 글씨가 뜨지 않게)
- `md()` = 「10월 27일」
- 한국어 조사: 회의실 이름이 받침 없이 끝나면 「은」이 어색합니다. 실제 회의실명에 맞춰 `은/는` 을 고르거나 「회의실 A: 최소 …」 형태로 바꾸세요

### 사용량 안내 (입주사)

```js
const used = usedMinutes(myOrgId, d.date, exceptId);
const left = Math.max(0, TENANT_DAILY_MIN - used);
text = md(d.date) + " 우리 조직 예약 " + (used ? dur(used) : "0분") + " · " +
       (left ? dur(left) + " 더 예약할 수 있습니다" : "더 예약할 수 없습니다");
```

「무료 잔여」라는 말을 쓰지 않습니다 — 요금 개념은 청구 연결 단계에서 들어옵니다.

---

## 5. 드래그 범위 계산

```js
// d = { date, from, lo, hi }  — from 은 누른 칸, lo·hi 는 현재 선택 범위 (칸 번호)
function extend(d, s) {
  const occ = occupiedSlots(d.date);                     // 취소 제외 예약이 차지한 칸 번호 Set
  const maxS = room.maxMinutes / SLOT;
  let lo = d.from, hi = d.from;
  while (lo - 1 >= Math.min(s, d.from) && free(d.date, lo - 1, occ)) lo--;   // 위로
  while (hi + 1 <= Math.max(s, d.from) && free(d.date, hi + 1, occ)) hi++;   // 아래로
  d.capped = hi - lo + 1 > maxS;
  if (d.capped) { if (s < d.from) lo = hi - maxS + 1; else hi = lo + maxS - 1; }
  d.lo = lo; d.hi = hi;
}
const free = (date, s, occ) => s >= 0 && s < rows && !occ.has(s) && !blockedReason(date, open + s * SLOT);
```

누른 칸에서 **바깥쪽으로 걸어가며** 막히는 첫 칸에서 멈춥니다. 예약을 건너뛰어 선택되는 일이 없습니다.

놓을 때 `openCreate(date, lo, hi)`:
```js
const minS = room.minMinutes / SLOT;
if (hi - lo + 1 < minS) hi = Math.min(lo + minS - 1, rows - 1);
start = open + lo * SLOT;  end = open + (hi + 1) * SLOT;
```

---

## 6. 저장 — 서버 재검증과 동시 예약

화면 검증은 안내용입니다. **서버가 같은 규칙을 트랜잭션 안에서 다시 검사**해야 합니다 — 두 사람이 같은 칸을 동시에 잡을 수 있습니다.

| 서버 응답 | 화면 |
|---|---|
| 200 | 모달 닫기 → 그리드 새로고침 → 토스트 |
| 409 충돌 | 모달 유지, 시간 오류 자리에 「방금 다른 예약이 들어왔습니다. 시간을 다시 선택해 주세요」, 그리드 새로고침 |
| 422 규칙 위반 | 모달 유지, 서버 메시지를 시간 오류 자리에 (4번 문구와 같게 맞춰 주세요) |
| 403 수정 권한 없음 (그 사이 시작됨 등) | 모달 닫기 + 토스트 「이미 시작된 예약은 수정할 수 없습니다」 |

중복 방지는 DB 제약으로 거는 것을 권장합니다 — 예: PostgreSQL `EXCLUDE USING gist (room_id WITH =, tsrange(start_at, end_at) WITH &&) WHERE (status <> 'cancelled')`.

---

## 7. 재계산 트리거

| 변경 | 갱신 |
|---|---|
| 툴바 회의실 | 그리드 전체(행 수·예약·차단), 범례 규칙 문구, 스크롤 |
| 이전·다음·오늘 | 기간 라벨, 그리드 또는 월간, (입주사) › 비활성 |
| 모달 회의실 | 시작·종료 옵션, 운영시간 안으로 보정, 정원 → 인원 상한, 규칙 문구, 검증 |
| 모달 날짜 | 검증, 사용량 안내 |
| 모달 시작 | 종료 = 시작 + 기존 길이 (최소 이상, close 이하) → 검증 |
| 모달 종료 | 검증 |
| 모달 제목 입력 | 제목 오류 해제만 — **모달을 다시 그리지 마세요** (포커스 유실) |
| 1분 경과 | 현재 시각 선 위치, 입주사 차단 칸 (지난 시각) |

모달 필드는 **열릴 때 한 번만 채웁니다** (`tenant-contract/04-status.md` 구현 주의와 같은 이유).
