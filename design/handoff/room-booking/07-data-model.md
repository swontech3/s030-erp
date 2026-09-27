# 데이터 구조

필드명은 예시입니다. 서버 네이밍에 맞춰 바꾸셔도 되고, **의미와 단위**만 지켜 주세요.

---

## 1. Room — 회의실 설정

```ts
interface Room {
  id: string;              // "A" — URL·QR 에 들어가므로 바뀌지 않는 값
  branchId: string;
  name: string;            // "회의실 A"
  capacity: number;        // 5 — 참석 인원 상한
  capacityLabel: string;   // "4~5인" — 표시용
  openMinute: number;      // 540  (09:00)  ★ 30의 배수
  closeMinute: number;     // 1320 (22:00)  ★ 30의 배수, open 보다 큼, 자정 넘김 없음
  minMinutes: number;      // 30   ★ 30의 배수
  maxMinutes: number;      // 240  ★ 30의 배수, min 이상, 운영시간 이하
  feePer30: number;        // 5000 — 이번 화면에서는 표시하지 않음 (청구 연결 시 사용)
  sortOrder: number;
  active: boolean;         // false 면 Select 에서 숨김
}
```

설정 화면은 이번 범위 밖입니다. 입력 검증(★ 조건)은 설정 저장 시 서버에서 걸어 주세요 —
30분 배수가 아니면 그리드 행과 예약 블록이 어긋납니다.

### 시안 예시

| id | 이름 | 정원 | 운영 | 1회 |
|---|---|---|---|---|
| A | 회의실 A | 4~5인 | 09:00–22:00 | 30분 ~ 4시간 |
| B | 회의실 B | 6~8인 | 08:00–20:00 | 1시간 ~ 3시간 |
| C | 미팅룸 C | 2인 | 09:00–18:00 | 30분 ~ 2시간 |

---

## 2. Booking — 예약

```ts
type BookingStatus = "confirmed" | "cancelled" | "completed";

interface Booking {
  id: string;
  roomId: string;
  date: string;            // "2026-09-30"
  startMinute: number;     // 960
  endMinute: number;       // 1020
  title: string;           // ≤ 40자
  people: number;          // 1 ~ room.capacity
  memo?: string;           // ≤ 200자
  orgId: string;           // 예약 조직 (입주사 또는 운영사)
  bookerUserId: string;    // 등록한 사람 — 운영자 대행이면 운영자
  status: BookingStatus;
  createdAt: string;       // ISO
  updatedAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
}
```

- 저장은 `date + startMinute` 대신 `start_at timestamptz` 로 하셔도 됩니다. 화면에는 분 단위로 내려 주세요
- 수정 이력(누가 언제 시간을 바꿨는지)은 이번 화면에 표시하지 않습니다. 필요하면 별도 로그 테이블

---

## 3. 조회 응답

### 주간 · 하루

`GET /rooms/{roomId}/bookings?from=2026-09-28&to=2026-10-04`

```jsonc
{
  "room": { /* Room */ },
  "serverNow": "2026-09-30T13:40:00+09:00",
  "policy": {                       // 로그인 사용자 기준으로 서버가 계산
    "viewer": "tenant",
    "lastBookableDate": "2026-10-27",   // 운영자는 null
    "dailyLimitMinutes": 120,           // 운영자는 null
    "usedMinutesByDate": { "2026-09-30": 60, "2026-10-01": 120 }   // 우리 조직, 모든 회의실 합산
  },
  "bookings": [
    // 우리 조직 또는 운영자 → 전체 필드
    { "id": "b7", "date": "2026-09-30", "startMinute": 960, "endMinute": 1020, "status": "confirmed",
      "title": "제품 리뷰", "people": 4, "orgId": "bridgelab", "orgName": "브릿지랩 주식회사",
      "booker": { "name": "김도현", "phone": "010-2345-6789" }, "createdAt": "…", "editable": true },
    // 입주사가 보는 타사 → 시간만
    { "id": "b6", "date": "2026-09-30", "startMinute": 780, "endMinute": 840, "status": "confirmed", "masked": true }
  ]
}
```

- 취소 예약은 **응답에서 빼 주세요** (그리드에 그리지 않음)
- `usedMinutesByDate` — 입주사 사용량은 다른 회의실 예약도 합산하므로, 현재 회의실 응답만으로는 계산할 수 없습니다
- `editable` — 서버가 `04-rules.md#4` 로 판정. 화면 판정과 다르면 서버가 기준

### 월간 (운영자)

`GET /rooms/{roomId}/bookings/summary?month=2026-09`

```jsonc
{ "days": [ { "date": "2026-09-30", "count": 5, "minutes": 360,
              "items": [ { "startMinute": 660, "endMinute": 780, "orgName": "한결세무법인" } ] } ] }
```

`items` 는 툴팁용입니다. 입주사 토큰으로 호출하면 403.

---

## 4. 저장 요청

```
POST   /bookings                  { roomId, date, startMinute, endMinute, title, people, memo, orgId? }
PATCH  /bookings/{id}             { roomId?, date?, startMinute?, endMinute?, title?, people?, memo? }
POST   /bookings/{id}/cancel
```

`orgId` 는 운영자만 보낼 수 있습니다. 입주사 요청의 `orgId` 는 무시하고 로그인 조직으로 저장하세요.
`PATCH` 에 `orgId` 가 오면 400.

응답 코드별 화면 처리는 `05-logic.md#6`.
