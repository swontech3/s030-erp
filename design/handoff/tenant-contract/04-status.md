# 상태 관리 — 계약

## 상태 5종

| 상태 | 의미 | 페이지 제목 | 상태 뱃지 |
|---|---|---|---|
| `create` | 신규 작성 | 계약 등록 | 없음 |
| `draft` | 임시저장 (사업자 미등록 포함) | 계약 수정 | 계약 대기 — `--color-warning-bg` / `--color-warning-text` |
| `confirmed` | 최종 계약 완료 | 계약 상세 | 계약 확정 — `--color-accent-bg` / `--color-primary-hover` |
| `terminated` | 강제 종료 | 계약 상세 | 종료 — `--surface-alt` / `--text-muted` |
| `cancelled` | 대기 상태에서 취소 | 계약 상세 | 취소 — `--surface-alt` / `--text-caption` |

> 현재 페이지 헤더에는 상태 뱃지를 표시하지 않습니다(제목으로 구분).
> 목록·상세 모달에서는 위 매핑대로 표시합니다.

---

## 상태 전이

```
create ──임시저장──→ draft
create ──계약확정──→ confirmed
draft  ──계약확정──→ confirmed
draft  ──계약취소──→ cancelled
confirmed ──종료──→ terminated
```

되돌리는 전이는 없습니다. 계약 조건을 바꾸려면 **종료 후 재계약**입니다.

---

## 상태별 헤더 버튼

DOM 순서는 아래를 모두 만족하도록 한 번만 정렬합니다.
`이전 · 계약취소 · 이용계약서 · 전대차계약서 · 임시저장 · 종료 · 계약확정 · 저장`

| 상태 | 표시되는 버튼 |
|---|---|
| create | 이전 / 임시저장 / **계약확정** |
| draft | 이전 / 계약취소 / 임시저장 / **계약확정** |
| confirmed | 이전 / 계약서 출력 / 종료 / **저장** |
| terminated | 이전 / 계약서 출력 |
| cancelled | 이전 / 계약서 출력 |

- `계약취소` · `종료` — ghost + 텍스트 `--color-danger`, hover 배경 `--color-danger-bg`
- `계약서 출력` — ghost + `file-text` 16px, **confirmed 이후에만 표시**
- 높이 40px, 좌우 패딩 16px, gap 8px

### 헤더 보조 안내 (제목 하단 12px)

```
미충족  "필수 항목 3개 미입력"   --color-warning
충족    circle-check 12px + "입력 완료"   --color-primary
확정 후  "2026.01.10 계약 확정"   --text-muted
종료 후  "2026.07.14 종료" / "2026.01.12 취소"   --text-muted
```

---

## 섹션별 수정 가능 여부

| 섹션 | create | draft | confirmed | terminated | cancelled |
|---|---|---|---|---|---|
| 1 회사 기본정보 | ○ | ○ | ○ | × | × |
| 2 계약정보 | ○ | ○ | **잠금** | 잠금 | 잠금 |
| 3 입주자 사용자 | ○ | ○ | ○ | × | × |
| 4 첨부 서류 | ○ | ○ | ○ | × | × |
| 5 계약서 미리보기 | 숨김 | 숨김 | 표시 | 표시 | 표시 |

**핵심 원칙** — confirmed 이후 계약 조건만 잠깁니다. 회사 정보와 사용자 정보는 계속 수정 가능합니다.
terminated / cancelled 는 전 섹션이 읽기 전용입니다.

잠금 표시 방식은 `common/05-patterns.md#5` 참조.

---

## 확인 모달 3종

폭 480px, 상단 원형 아이콘 56px, 제목 H3 22px/600, 설명 14px, 버튼 2개(각 50%, 높이 44px)

### 계약확정
```
아이콘  circle-check 24px --color-primary, 배경 --color-accent-bg
제목    "계약을 확정하시겠습니까?"
설명    "확정 후에는 계약 조건을 변경할 수 없습니다.
         회사 정보와 사용자 정보는 계속 수정할 수 있습니다."
버튼    [취소] ghost / [확정] primary
```

### 계약취소
```
아이콘  circle-x 24px --color-danger, 배경 --color-danger-bg
제목    "계약을 취소하시겠습니까?"
설명    "임시저장된 계약 정보가 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
버튼    [돌아가기] ghost / [계약취소] primary(danger — 배경 --color-danger)
```

### 종료
```
아이콘  triangle-alert 24px --color-warning, 배경 --color-warning-bg
제목    "계약을 종료하시겠습니까?"
설명    "종료 후 해당 호실은 예약 가능 상태가 됩니다."
추가    종료일 DatePicker (기본값 오늘) + 종료 사유 Textarea 2행
버튼    [취소] ghost / [종료 처리] primary(danger)
```

---

## 구현 주의

### 상태 변경 시에만 값을 다시 채우세요

`applyMode()` 류의 함수가 매 렌더마다 호출되면 사용자가 입력한 값이 지워집니다.
**직전 mode 를 기억해 실제로 바뀐 경우에만 seeding** 하세요.

```js
if (this.seededMode !== mode) {
  this.seededMode = mode;
  // 여기서만 필드에 값을 채움
}
```

React 에서는 `useEffect(..., [mode])` 로 자연스럽게 해결됩니다.

### 잠긴 뷰는 편집 뷰와 같은 소스를 봐야 합니다

읽기 전용 표시를 정적 마크업으로 두면 편집값과 어긋납니다.
잠긴 셀도 **폼 상태에서 파생**시키세요.
