# 공통 패턴

여러 화면에서 반복되는 규칙입니다. 화면별 문서보다 이 파일이 우선합니다.

---

## 1. 페이지 헤더 (sticky)

계약 폼·설정처럼 **값을 바꾸는 화면**은 상단 고정 헤더에 액션을 모읍니다.
하단 sticky 액션 바를 쓰지 않습니다 — 콘텐츠가 길면 두 번 스크롤해야 합니다.

```
높이 72px, position:sticky, top:0, z-index:30
배경 --surface, 하단 1px --border
내부 폭은 콘텐츠와 동일 (1120px), 좌우 패딩 32px

좌측  제목 30px/700 --text-heading
      그 아래 보조 안내 12px (미입력 경고 --color-warning / 완료 --color-primary + circle-check 12px)
우측  액션 버튼 (높이 40px, 좌우 패딩 16px, gap 8px)
```

**버튼은 미리 전부 마크업하고 상태별로 표시 여부만 토글합니다.**
DOM 순서가 모든 상태의 좌→우 배치를 만족하도록 한 번만 정렬해 두세요.

---

## 2. 섹션 컨테이너

```
배경 --surface
보더 1px --border
radius --radius-lg
패딩 24px 28px
섹션 간격 24px

섹션 제목 18px/700 (설정) 또는 H3 22px/600 (계약 폼)
제목 하단 구분선 1px --border, 상하 여백 16px
```

---

## 3. 필드 그리드

```css
display: grid;
grid-template-columns: repeat(4, minmax(0, 1fr));  /* ★ minmax(0,1fr) 필수 */
column-gap: 20px;
row-gap: 18px;
```

> `1fr` 만 쓰면 내부에 조회 버튼 같은 min-content 자식이 있을 때 트랙이 밀려
> 다른 섹션과 열 위치가 어긋납니다. 반드시 `minmax(0,1fr)`.

폭 조절은 `grid-column: span N`. 설정 화면은 2열, 계약 폼은 4열 기준입니다.

### 필드 구조

```
라벨      14px/600 --text-heading   (필수는 뒤에 * --color-danger)
설명      13px --text-muted          (라벨 하단, 선택)
입력      상단 6px
도움말/오류 하단 4px, 12px
```

---

## 4. 읽기 전용 표시

두 가지 방식을 구분합니다.

| 방식 | 형태 | 용도 |
|---|---|---|
| ReadOnly 인풋 | 배경 `--surface-alt`, 보더 유지, `cursor:default` | 자동 계산 결과 — 폼 안에서 다른 필드와 정렬이 맞아야 할 때 |
| 텍스트 표시 | 라벨 12px `--text-muted` / 값 16px `--text-heading`, 보더·배경 없음 | 잠긴 섹션 전체 — 더 이상 편집 대상이 아닐 때 |

### ★ 배경색 처리 주의

**JS 에서 필드의 `style.background` 를 쓰지 마세요.**
템플릿에 선언된 값(`--surface` / `--surface-alt` / `--color-accent-bg`)과 같은 인라인 속성을 공유하므로,
JS 가 덮어쓰거나 지우면 원래 값이 사라집니다.
동결 상태는 `disabled` 속성과 **섹션 래퍼의 톤**으로 표현하세요.

---

## 5. 잠금 섹션

확정 이후 수정 불가한 섹션의 표시 방법.

```
섹션 제목 우측  pill 뱃지 — lock 아이콘 12px + "확정됨"
               배경 --surface-alt, 텍스트 --text-muted
제목 하단 구분선 아래  안내 12px --text-muted
  "계약 조건은 확정 후 변경할 수 없습니다. 변경이 필요하면 종료 후 재계약해 주세요."
```

잠긴 테이블은 **같은 grid 정의를 유지한 채** 셀 내용만 텍스트로 바꿉니다.
숨기지 마세요 — 열 정렬이 깨지고 확정된 내용을 확인할 수 없습니다.

- Select → 값 텍스트 (chevron 숨김)
- Input → 값 텍스트 (보더·배경 없음)
- Checkbox → `circle-check`(`--color-primary`) / `circle`(`--text-caption`) 16px
- 삭제 열 → 헤더 포함 전체 숨김, grid 정의에서 해당 트랙 제거

---

## 6. 테이블 grid-template-columns

**고정 px 을 지양하고 `minmax(하한, 비율fr)` 로 씁니다.**
사이드바 접기·창 크기 변화에 자동 대응하고, 남는 공간이 열 사이에 고르게 분배됩니다.

```css
/* 계약 이력 (우측 패널 폭 ~674px) */
grid-template-columns:
  88px                    /* 기간 — 고정, "12개월" 최소폭 */
  minmax(168px, 1.2fr)    /* 계약일자 */
  minmax(164px, 1fr)      /* 플랜·호실 */
  minmax(96px,  .8fr)     /* 월 이용료 */
  minmax(70px,  .7fr)     /* 상태 */
  minmax(86px,  .75fr);   /* 액션 */
```

### 작성 원칙

1. **하한 합계가 사용 가능한 폭을 넘지 않아야 합니다.** minmax 하한은 하드 최소값이라
   합이 넘으면 그대로 가로 스크롤이 생깁니다. 설계 시 반드시 합산해 확인하세요.
2. 하한은 그 열의 **실제 잉크 폭 + 좌우 패딩**으로 잡습니다.
3. 마지막 열을 `flex:1` / `1fr` 로 두면 남는 공간이 뒤에만 몰립니다 — 전 열에 비율을 주세요.
4. **헤더와 데이터 행은 같은 정의를 참조**합니다. CSS 변수로 한 번만 선언하세요.
   ```css
   [data-panel]  { --grid-cols: 72px repeat(7, minmax(0,1fr)); }
   [data-head]   { grid-template-columns: var(--grid-cols); }
   [data-body]   { grid-template-columns: var(--grid-cols); }
   ```
5. **스크롤바 폭 문제** — 헤더와 본문을 따로 두면 본문에만 스크롤바가 생겨 열이 어긋납니다.
   하나의 스크롤 컨테이너에 넣고 헤더를 `position:sticky; top:0` 으로 고정하세요.
6. `box-sizing:border-box` 이므로 셀 패딩이 선언된 폭에서 빠집니다.
   좁은 열(60px 이하)은 자체 패딩을 두지 말고 이웃 셀의 패딩을 간격으로 쓰세요.

---

## 7. 금액 표기

```
천단위 콤마 + font-variant-numeric: tabular-nums + 우측 정렬
단위는 값 뒤에 공백 한 칸 — "440,000 원"
합계·강조 금액만 weight 700
```

입력 필드의 콤마 재삽입은 커서를 맨 앞으로 보냅니다. 보정 코드는 `tenant-contract/05-logic.md` 참조.

---

## 8. 상태 표시

### 빈 상태
```
중앙 정렬, 상하 패딩 32~80px
아이콘 32~40px --text-caption
문구 14~16px --text-muted (상단 10~14px)
액션 버튼 (선택, 상단 20px)
```

### 미선택 상태 (마스터-디테일 우측)
```
mouse-pointer-click 아이콘 40px --text-caption
"왼쪽에서 입주사를 선택하세요" 16px --text-muted
```

### 로딩
**카드별 스켈레톤.** 전체 화면 스피너를 쓰지 않습니다.
```css
background: var(--surface-alt);
border-radius: 6px;
animation: shim 1.2s ease-in-out infinite;  /* opacity .5 ↔ 1 */
```
데이터가 준비된 카드부터 순차 표시, 카드 진입은 `240ms fade-up` + 80ms 간격.

### 오류
**카드 단위로 처리합니다.** 한 카드가 실패해도 나머지는 표시합니다.
실패 카드에 `--color-danger` 캡션 + [다시 시도] 버튼.

### prefers-reduced-motion
```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

---

## 9. 내부 스크롤 영역

```css
overflow-y: auto;
overscroll-behavior: contain;
-webkit-overflow-scrolling: touch;
```

- 부모 flex 자식에 `min-height:0` / `min-width:0` 을 반드시 지정 (없으면 스크롤이 동작하지 않고 영역이 넘침)
- `min-height` 하한을 주면 부모를 넘쳐 형제 위에 얹힙니다 — flex 축소를 막지 마세요
- 스크롤바 상시 표시: 폭 8~12px, thumb `--border` → hover `--text-caption`, radius 4~6px
- 터치 환경에서는 상·하단 24px 페이드로 스크롤 가능함을 알립니다
