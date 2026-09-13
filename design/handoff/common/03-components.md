# 컴포넌트 스펙

원본 소스: `handoff/components/<group>/<Name>.jsx` + `.d.ts` + `.prompt.md`
아래 표는 React 이관 시 참조할 값 목록입니다. 색은 전부 토큰명으로 씁니다.

---

## Button

| 변형 | 배경 | 텍스트 | 보더 | 그림자 |
|---|---|---|---|---|
| `primary` | `--color-primary` → hover `--color-primary-hover` | `--text-on-primary` | transparent | `--shadow-primary` → hover `--shadow-primary-hover` |
| `ghost` | `--surface` → hover `--surface-alt` | `--text-heading` | `1px --border` | 없음 |
| `subtle` | `--color-accent-bg` → hover `#E4E9FF` | `--color-primary-hover` | transparent | 없음 |
| `inverse` | `rgba(255,255,255,.10)` → hover `#FFFFFF` | `#FFFFFF` → hover `--surface-inverse` | `1px rgba(255,255,255,.22)` | 없음 |
| `danger` | `--surface` → hover `--color-danger-bg` | `--color-danger` | `1px --border` | 없음 |
| `link` | transparent | `--text-link` → hover `--text-link-hover` | 없음 | 없음 |

| 크기 | 높이 | 좌우 패딩 | 폰트 | 아이콘 |
|---|---|---|---|---|
| md | 54px | 30px | 16px/700 | 18 |
| sm | 40px | 16px | 14px/700 | 16 |
| xs | 32px | 10px | 12px/700 | 14 |

공통: radius `--radius-md`, gap 6~8px, `white-space:nowrap`
상태: press `translateY(1px)` · disabled `opacity:.45` + `cursor:not-allowed` · focus `3px --focus-ring`
전환: `background/color/box-shadow --dur --ease-out`, transform `--dur-fast`

규칙 — 한 화면에 primary 는 하나. 나머지는 ghost. danger 는 위험 구역과 상태 전이(계약취소·종료)에만.

---

## IconButton

| 크기 | 아이콘 | 용도 |
|---|---|---|
| 40 | 20 | 헤더 툴바 |
| 36 | 18 | 카드 헤더 |
| 32 | 16 | 테이블 행 액션 |
| 28 | 16 | 파일 목록 다운로드 |

변형: `ghost`(보더 있음) / `bare`(보더 없음, 카드·모달 내부) / `primary`
`aria-label` 필수. radius `--radius-sm`.

---

## Input

| 상태 | 배경 | 보더 | 비고 |
|---|---|---|---|
| 기본 | `--surface` | `1px --border` | |
| focus | `--surface` | `1px --color-primary` | `box-shadow:0 0 0 3px --focus-ring` |
| ReadOnly | `--surface-alt` | `1px --border` | `cursor:default` — 값은 있으나 편집 불가 |
| Disabled | `--surface-alt` | `1px --border` | `opacity:.5` — 조건 미충족으로 비활성 |
| Error | `--surface` | `1px --color-danger` | 하단 12px `--color-danger` 메시지 |

높이 44px(폼) / 40px(밀집) / 38px(테이블 행), 좌우 패딩 14px, radius `--radius-md`, 폰트 14px
라벨 14px/600 `--text-heading`, 설명 13px `--text-muted` (라벨 하단), 간격 6px

> ReadOnly 와 Disabled 는 의미가 다릅니다. 자동 계산 결과는 ReadOnly, 선행 조건 미충족은 Disabled.

---

## Select

`appearance:none` + 우측 12~14px 에 chevron 표기.

- 템플릿 마크업에서는 DS `Icon name="chevron-down" size={16}` 사용
- JS로 행을 생성하는 테이블에서는 CSS 캐럿 사용 (x-import 불가)
  ```css
  position:absolute; right:14px; top:50%;
  transform:translateY(-60%) rotate(45deg);
  width:6px; height:6px;
  border-right:1.5px solid var(--text-muted);
  border-bottom:1.5px solid var(--text-muted);
  pointer-events:none;
  ```
- 우측 패딩은 34px 확보 (아이콘 자리)
- 클릭 시 회전하지 않습니다 (정적 표기)

---

## Checkbox / Radio / Switch

| | 크기 | 선택 표시 |
|---|---|---|
| Checkbox | 20×20, radius `--radius-xs` | `--color-primary` 채움 + 흰 체크 |
| Radio | 20×20 원형 | `6px solid --color-primary` 테두리 |
| Switch | 44×26, 노브 20 | on `--color-primary` / off `--border` |

테이블 행 내부에서는 18×18 + `accent-color:var(--color-primary)` 로 네이티브 사용.
Switch 는 즉시 반영되는 설정에만. 폼 제출과 함께 저장되는 값은 Checkbox.

---

## Textarea

패딩 12px 14px, `line-height:1.6`, `resize:vertical`, 기본 2~3행.
나머지 상태는 Input 과 동일.

---

## Card

배경 `--surface-card`, 보더 `1px --border`, radius `--radius-lg`, **그림자 없음**.
패딩 24px(기본) / 20px(밀집) / 32px(피처).
`interactive` 카드만 hover 시 `translateY(-2px)` + 보더 `--color-secondary`.

---

## Badge (pill)

높이 22~26px, 좌우 패딩 8~10px, radius `--radius-pill`, 12px/700, `white-space:nowrap`

| 상태 | 배경 | 텍스트 |
|---|---|---|
| 계약중 / 진행중 / 발행완료 / 완료 | `--color-accent-bg` | `--color-primary-hover` |
| 만기임박 / 계약 대기 / 준비중 | `--color-warning-bg` | `--color-warning-text` |
| 연체 / 실패 | `--color-danger-bg` | `--color-danger-text` |
| 만료 / 검토중 / 취소 / 종료 | `--surface-alt` + `1px --border` | `--text-muted` |
| AI 처리 | `rgba(34,211,238,.14)` | `#0E7490` |
| 준비 중 (미구현 기능) | `--surface-alt` + `1px --border` | `--text-muted` |

★ 완료·성공에 녹색을 쓰지 않습니다.

---

## Tabs

| 변형 | 활성 표시 |
|---|---|
| `underline` | 하단 2px `--color-primary`, 텍스트 700 `--text-heading` |
| `segmented` | 트랙 `--surface-alt` + `1px --border` + padding 4px, 활성 칩 `--surface` + `0 1px 2px rgba(11,17,32,.06)` |

underline 은 페이지 단위 전환, segmented 는 카드 안 필터.

---

## Dialog

| 폭 | 용도 |
|---|---|
| 480 | 확인 모달 (계약확정·취소·종료, 위험 구역) |
| 720 | 상세 보기 (계약 상세) |
| 1000 | 문서 미리보기 (계약서, 높이 92vh) |

스크림 `rgba(11,17,32,.45)` (문서 모달은 `.55`), 패널 `--surface` + `--shadow-overlay` + radius `--radius-lg`
구조: 헤더(패딩 20~24px + 하단 보더) / 본문(스크롤) / 푸터(상단 보더, 우측 정렬, gap 8px)
닫기: 우상단 x 32px, 백드롭 클릭, ESC

확인 모달은 상단 원형 아이콘 56px + 제목 H3 + 설명 + 버튼 2개(각 50%, 44px).

---

## Toast

380px, 패딩 16px, `--shadow-float`, radius `--radius-lg`
좌측에 8px 원형 점 또는 `circle-check` 아이콘 — **색은 인디고**. 우상단 스택, 자동 소멸 2.6~3.2초.

---

## Tooltip

배경 `--surface-inverse`, 텍스트 `#FFFFFF` 14px/400, 높이 28px, 패딩 0 10px, radius `--radius-sm`, `--shadow-float`
대상에서 8px 떨어뜨리고 `pointer-events:none`. 한 줄만. 긴 설명은 툴팁에 넣지 않습니다.

---

## Table

CSS Grid 기반. `<table>` 을 쓰지 않습니다 — 열 정렬 규칙은 `05-patterns.md` 참조.

| 요소 | 값 |
|---|---|
| 헤더 | 높이 44px, 배경 `--surface-alt`, 하단 `1px --border`, 12px/700 `--text-muted` |
| 행 | 높이 52~64px 또는 상하 패딩 10~16px, 하단 `1px --border` |
| hover | 배경 `--surface-alt` (클릭 가능한 행만) |
| 셀 패딩 | 좌우 6~12px (열 개수에 반비례) |
| 강조 행 | 좌측 3px `--color-primary` 세로 바 |

정렬 — 텍스트 좌측, 금액 우측(`tabular-nums`), 상태·액션 중앙.
헤더 라벨과 데이터 셀은 **같은 grid 정의**를 참조해야 합니다.
