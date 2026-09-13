# ERP 셸

기준 템플릿: **`erp-tenants/ErpTenants.dc.html`**
접기·툴팁·localStorage 가 모두 온전한 유일한 셸입니다.
`erp-dashboard` · `erp-settings` 의 사이드바는 정적이므로 참고하지 마세요.

---

## 레이아웃

```
┌──────────┬────────────────────────────────────┐
│ 사이드바  │ 헤더 64px                          │
│ 248px    ├────────────────────────────────────┤
│ ↔ 64px   │ 콘텐츠 (독립 스크롤)                 │
└──────────┴────────────────────────────────────┘
```

| 영역 | 값 |
|---|---|
| 루트 | `display:flex`, 높이 `100dvh` (시안은 900px 고정) |
| 사이드바 | 248px ↔ 64px, 배경 `--surface`, 우측 `1px --border`, 패딩 `20px 16px` ↔ `20px 12px` |
| 헤더 | 64px, 하단 `1px --border`, 배경 `--surface`, 좌우 패딩 28px |
| 콘텐츠 | `flex:1; min-width:0`, 배경 `--surface-alt`, 내부에서만 스크롤 |

전환: `width/padding 240ms var(--ease-out)`

> 헤더 72px 은 계약 폼의 **페이지 헤더**(sticky)이고, 셸 헤더는 64px 입니다. 두 개가 함께 나타납니다.

---

## 사이드바 접기

```
localStorage key: "swonbiz-sidebar-collapsed"   값 "1" | "0"
```

우선순위: 화면 내 토글(state) → prop → localStorage → 기본 펼침

### 토글 버튼 — 경계선 위 배치

```css
position: fixed;
left: 248px;                                  /* 접힘: 64px */
top: 50%;
transform: translateX(-50%) translateY(-50%); /* 중심이 경계선과 일치 */
width: 24px; height: 24px;
border-radius: 999px;
background: var(--surface);
border: 1px solid var(--border);
opacity: .45;                                 /* hover 시 1 */
box-shadow: none;                             /* 경계선에 붙어 있어 불필요 */
transition: left 240ms var(--ease-out), opacity 180ms var(--ease-out);
```

- 아이콘 `chevron-left` ↔ `chevron-right` 14px
- 사이드바 hover 시에도 `opacity:1`
- hover 툴팁 "사이드바 접기" / "사이드바 펼치기"

### 접힘 상태 처리

| 요소 | 처리 |
|---|---|
| 로고 | 워드마크 숨김, 심볼만 중앙 정렬 |
| 메뉴 | 아이콘 20px만 중앙, 라벨 완전히 숨김(축약 아님) |
| 툴팁 | 우측 22px, 다크 배경 + 좌측 화살표 삼각형 |
| 하단 알림 | 카드 → bell 아이콘 + 숫자 배지로 축약 |

### ★ 라벨 표시 타이밍 — 중요

라벨은 `display` 로 토글되는데 이는 애니메이션되지 않고, 툴팁 때문에 `overflow:visible` 이어야 합니다.
따라서 **펼칠 때 폭 전환이 끝난 뒤** 라벨을 표시해야 좁은 레일 밖으로 삐져나오지 않습니다.

```js
// 접을 때: 즉시 숨김
// 펼칠 때: 측정된 폭이 200px 을 넘은 뒤 표시 (고정 타이머 금지 — 전환이 지연되면 어긋남)
const waitForWidth = () => {
  if (collapsed) return;
  if (aside.getBoundingClientRect().width >= 200) { showLabels(); return; }
  timer = setTimeout(waitForWidth, 60);
};
```

React 에서는 `transitionend` 이벤트로 대체해도 됩니다.

---

## 로고 브랜드 분기

심볼은 동일하고 **워드마크 접미어만** 도메인에 따라 다릅니다.

| 도메인 | 워드마크 |
|---|---|
| `swonbiz.com` | S·won**Biz** |
| `s-wontech.co.kr` | S·won**Tech** |

```
"S·won" → --text-heading (#0B1120)
접미어   → --color-primary (#4F46E5)
인터펀크트(·) → opacity .55
weight 800 고정, letter-spacing -.03em
다크 배경에서는 전체 #FFFFFF
```

호스트명으로 판별: `host.includes("s-wontech") ? "tech" : "biz"`

로고 영역 전체가 **대시보드 진입점**입니다 — 메뉴에 "대시보드" 항목을 두지 않습니다.
hover 시 `--surface-alt`, 대시보드 화면일 때 `--color-accent-bg` 활성 표시.

---

## 메뉴 구조

현재 6종. 권한 기반 동적 렌더링을 전제로 합니다.

| key | 라벨 | 아이콘 |
|---|---|---|
| `tenants` | 입주사 | `building-2` |
| `billing` | 청구 | `receipt` |
| `tax` | 세무 | `calculator` |
| `rooms` | 회의실 | `calendar-check` |
| `spaces` | 호실 | `door-open` |
| `settings` | 설정 | `settings` |

### API 응답 예시 (TBD — 권한 시스템 확정 후)

```json
{
  "user": { "name": "최현수", "role": "operator", "org": "운영 관리자" },
  "brand": "biz",
  "menu": [
    { "key": "tenants",  "label": "입주사", "icon": "building-2",     "href": "/tenants" },
    { "key": "rooms",    "label": "회의실", "icon": "calendar-check", "href": "/booking" },
    { "key": "settings", "label": "설정",   "icon": "settings",       "href": "/settings" }
  ]
}
```

**규칙 — 권한이 없는 항목은 렌더링하지 않습니다.** 비활성으로 남기면 문의가 발생합니다.
예외는 "준비 중"이 명시된 항목뿐입니다(설정의 권한 관리).

### 항목 스타일

```
높이 40px, 좌우 패딩 12px(펼침) / 0(접힘), radius --radius-md, gap 12px
기본  배경 transparent, 색 --text-muted, weight 400
hover 배경 --surface-alt
활성  배경 --color-accent-bg, 색 --color-primary-hover, weight 700
```

---

## 헤더

좌측: 브레드크럼 12px `--text-caption` + 제목 17px/700 `--text-heading`
우측: 아이콘 버튼(도움·알림 36px) + 구분선 + 계정 블록

계정 블록 — 32px 아바타(이니셜, `--color-accent-bg` 배경) + 이름 14px/700 + 소속 12px `--text-muted`

---

## 접힘 상태 플라이아웃

현재 6개 메뉴에 하위 항목이 없어 구현하지 않았습니다.
서브메뉴가 생기면 — 우측 플라이아웃 패널(`--surface` + `1px --border` + `--shadow-float`),
상단에 부모 라벨 + 구분선, 마우스가 패널로 이동해도 150ms 지연 후 닫힘.
