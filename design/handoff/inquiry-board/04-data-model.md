# 데이터 구조 · 보안

필드명은 예시입니다. 의미와 **어디까지 내려보내는지**만 지켜 주세요.

---

## 1. Inquiry — 원글

```ts
type InquiryType = "move_in" | "legal_setup" | "tax" | "lab_setup" | "etc";
// 입주문의 · 법무설립문의 · 세무문의 · 연구소설립문의 · 기타 (표시 라벨 = 목록 제목)

interface Inquiry {
  id: string;
  type: InquiryType;
  name: string;            // 실명 — 목록 응답에 절대 포함하지 않음
  phone: string;
  email: string;
  company?: string;
  body: string;            // ≤ 1000
  passwordHash: string;    // bcrypt/argon2. 평문·가역 암호화 금지
  agreedAt: string;        // 개인정보 동의 시각
  createdAt: string;
  lastMessageKind: "none" | "operator" | "customer";   // 상태 판정용 (조회 시 계산해도 됨)
  deletedAt?: string;      // 운영자가 보관 기간 처리로 삭제 (5번). 개인정보는 이때 실제 파기
}
```

`retentionExpired = createdAt + 6개월 < now` — 저장하지 않고 계산. 운영자 목록에만 내려 주세요.

## 2. InquiryMessage — 스레드

```ts
interface InquiryMessage {
  id: string;
  inquiryId: string;
  kind: "text" | "phone" | "customer";
  body?: string;           // text · customer 필수, phone 없음. ≤ 1000
  operatorId?: string;     // text · phone
  operatorName?: string;   // 표시용 스냅샷 — 담당자 이름이 바뀌어도 당시 이름 유지
  createdAt: string;
  editedAt?: string;       // text 만. 마지막 수정 시각
}
```

메시지 단위 삭제 컬럼은 두지 않았습니다 — 답변·추가 질문 삭제 기능이 없습니다. 글 전체를 지우면 메시지도 함께 파기합니다.

---

## 3. API (제안)

| 요청 | 인증 | 응답 |
|---|---|---|
| `GET /inquiries?page=1&from=2026-09-01&to=2026-09-26&status=received&type=tax` | 없음 | `{ total, items: [{ id, type, maskedName, date, status }] }` — 20건씩. 검색 파라미터는 모두 선택, `total` 은 검색 결과 건수 |
| `POST /inquiries` | 없음 | 201 `{ id, maskedName, type }` — 완료 화면 미리보기용 / **429** `{ reason: "daily" \| "cooldown" }` |
| `POST /inquiries/{id}/unlock` `{ password }` | 없음 | 200 `{ token, inquiry, messages }` / 401 |
| `POST /inquiries/{id}/messages` `{ body }` | **unlock 토큰** | 201 `{ message, status }` / 401 토큰 만료 / **409 이미 추가 질문 있음** |

- `status` 는 `"received" | "answered"` (화면 라벨 접수 · 답변완료)
- unlock 토큰 수명 30분 정도 권장. 글 하나에만 유효하게
- 운영자 API(답변 등록·수정, 전화 기록)는 ERP 인증 아래 — 운영자 화면에서 정의

---

## 4. 보안 체크리스트

| 항목 | 이유 |
|---|---|
| 목록 응답에 실명·연락처·본문 없음 | 화면에서 가려도 응답에 있으면 노출 |
| 비밀번호 해시 저장 | 4자 이상이라 약합니다 — 해시 + 아래 시도 제한이 전제 |
| `unlock` 시도 제한 | 글 하나에 IP 기준 **10분 5회** 정도. 넘으면 「잠시 후 다시 시도해 주세요」 |
| 추가 질문은 토큰 필수 | 4장 참조 — 토큰 없이 쓰면 남의 글에 글을 붙일 수 있음 |
| 등록 제한 | 5번 아래 「등록 제한」 |
| 본문 출력 이스케이프 | 고객 입력을 HTML 로 넣지 않음. 줄바꿈은 `white-space: pre-line` |

### 등록 제한 (스팸)

| 규칙 | 기준 | 응답 |
|---|---|---|
| 하루 3건 | 같은 **연락처**(숫자만 비교: `010-1234-5678` = `01012345678`), 당일 00:00~24:00 KST, 삭제된 글 포함 | 429 `daily` |
| 1분 간격 | 같은 연락처의 직전 등록으로부터 60초 | 429 `cooldown` |

- 원글 등록에만 적용합니다. **추가 질문은 세지 않습니다** — 하루 3건 배너가 「추가 질문으로 이어 쓰라」고 안내하기 때문입니다
- 결정된 규칙은 이 두 개뿐입니다. 캐차·IP 제한은 실제 문제가 생기면 추가
- 화면 처리는 `02-screens.md#3` 「등록 제한」

---

## 5. 보유 기간 — 6개월

동의 문구: **「보유 기간 등록일로부터 6개월 보관 후 파기」**

- **자동 삭제하지 않습니다.** 상담 중인 글이 사라질 수 있기 때문입니다
- 원글 등록일 + 6개월이 지나면 운영자 문의 관리(s0300200080)에 **「보관 기간 지남」** 표시
- 운영자가 확인 후 글 전체를 삭제 → 개인정보(이름·연락처·이메일·회사명·본문·스레드) 파기
- **고객 화면에는 이 표시가 없습니다.** 기간이 지나도 삭제 전까지는 목록·글 보기가 그대로입니다
- 추가 질문이 달려도 기준일은 **원글 등록일**입니다

> 하루 3건 집계용으로 연락처 해시를 남겨야 한다면 당일 집계가 끝난 뒤 버려도 됩니다 — 삭제된 글의 연락처를 오래 보관할 이유가 없습니다.

---

## 미정 (TBD)

| 항목 | 내용 |
|---|---|
| 답변 알림 메일 | ERP 메일 발송 기능이 생기면 추가. 그때 대기 카드 문구도 바꿉니다 |
| 기간 전 삭제 | 보관 기간이 지나지 않은 글(스팸 등)을 운영자가 지울 수 있는지 |
