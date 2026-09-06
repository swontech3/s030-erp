# SwonBiz 디자인 시스템 — 전달 (2026-09-06)

요청 ①②③에 해당하는 파일을 원본 그대로 담았습니다. 정리·통합·개선하지 않았습니다.

```
handoff/
├─ tokens/          fonts / colors / typography / spacing / shape / base  (6개)
├─ styles.css       @import 6줄만 들어있는 진입점
└─ assets/          swonbiz-logo.png, swonbiz-logo-white.png, 사용인감.png
```

`design/_ds/swonbiz/` 에 그대로 넣으시면 됩니다. `_ds_bundle.js` 는 요청대로 제외했습니다.

**요청 ③ 컴포넌트 15종은 별도 다운로드로 보냅니다** (`components` 폴더). 같은 프로젝트 안에 사본을 두면 컴파일러가 두 벌을 같은 이름으로 등록해 충돌하기 때문입니다. 받으신 `components/` 를 `design/_ds/swonbiz/components/` 에 넣으시면 위 구조가 완성됩니다.

---

## 요청 ③ — 컴포넌트 15종

15종 **전부 있습니다.** 없는 것 없음.

| 그룹 | 컴포넌트 |
| --- | --- |
| core | Button · IconButton · Icon · Card · Badge · Tag |
| forms | Input · Select · Checkbox · Radio · Switch |
| navigation | Tabs |
| feedback | Dialog · Toast · Tooltip |

각 컴포넌트 폴더에 4개 파일이 있습니다.

- `<Name>.jsx` — 원본 소스. React 함수 컴포넌트, named export, 의존성은 React 하나뿐입니다. 스타일은 인라인 + CSS 변수로만 되어 있어 React 이관 시 그대로 쓰실 수 있습니다.
- `<Name>.d.ts` — props 계약
- `<Name>.prompt.md` — 용도와 사용 예, 변형 규칙
- `*.card.html` — 상태·변형 전체를 보여주는 스펙 카드

**1차 4종의 위치**

```
components/core/Icon.jsx        components/core/Button.jsx
components/forms/Input.jsx      components/forms/Checkbox.jsx
```

### Icon 구현 방식 — 확인 필요

`Icon` 은 SVG를 내장하지 않습니다. Lucide(`lucide-static@0.414.0`)를 CDN에서 CSS `mask-image` 로 불러와 `currentColor` 를 상속시키는 래퍼입니다. 요청하신 11종 아이콘 이름은 전부 그 세트에 있으니 `<Icon name="eye" />` 로 바로 쓰실 수 있습니다.

**다만 CDN 의존이 그대로 넘어갑니다.** 개발에서 SVG를 저장소에 내려두고 인라인 방식으로 바꾸실 계획이면 `Icon.jsx` 의 `BASE` 상수 한 줄만 교체하시면 됩니다. 아이콘 이름은 그대로 유지됩니다.

또한 **Lucide 0.414의 이름 규칙에 주의하세요.** `circle-check` / `circle-alert` 가 맞고, `check-circle` / `alert-circle` 은 404입니다. 작업 중 두 번 겪었습니다.

---

## ④-1 — 31개 변수 정의 여부

**31개 전부 정의되어 있습니다.** 누락 없음.

`--bp-tablet:768px` / `--bp-desktop:1280px` 도 `tokens/spacing.css` 에 있습니다. 단 예약 템플릿(T5) 작업 때 도입한 값이라 그 이전 템플릿은 고정폭이며 소급 적용하지 않았습니다.

목록에 없지만 다른 템플릿이 쓰는 변수가 더 있습니다. 전달 파일에 모두 포함되어 있으니 추가 확인은 필요 없습니다. 주요한 것만 적으면,

```
--color-warning-bg  --color-warning-text  --color-danger-text
--gradient-brand  --gradient-brand-line  --border-strong
--radius-xs  --radius-sm  --radius-lg  --shadow-float  --shadow-overlay
--font-mono  --weight-semibold  --weight-black
--text-h3-*  --text-body-*  --text-caption-*  --text-display-*
--space-1 … --space-30  --container  --gutter  --section-y
--control-h  --control-h-sm  --dur-fast  --dur-slow  --ease-in-out
```

---

## ④-2 — 녹색 계열

**없습니다.** 토큰과 템플릿 전체에 녹색 변수도 녹색 리터럴도 없습니다.

`--color-success` 같은 이름은 정의하지 않았습니다. 완료·성공은 전부 `--color-primary`(인디고) 또는 `--color-accent-bg` 배지로 표현합니다. 빌드 검사를 그대로 거셔도 됩니다.

**상태색은 앰버·레드 2종만 있습니다** — ERP 전용이고 브랜드·랜딩에는 쓰지 않습니다.

```
--color-warning      #D97706   --color-warning-bg   #FEF3C7   --color-warning-text  #92400E
--color-danger       #DC2626   --color-danger-bg    #FEE2E2   --color-danger-text   #991B1B
```

오렌지는 로고 전용이라 토큰에 없습니다. `assets/swonbiz-logo.png` 안에만 존재합니다.

---

## ④-3 — 마크업에 박힌 리터럴 색

**세 부류로 나뉩니다.**

### 1. 의도된 것 — 그대로 리터럴로 두세요

로그인 화면 우측 브랜드 패널의 그라디언트 시작값 `#131C33`, 배지 배경 `rgba(79,70,229,.18)`, 테두리 `rgba(129,140,248,.35)` 가 여기 해당합니다.

`#131C33` 은 `--surface-inverse`(#0B1120)보다 밝은 딥 네이비로, 다크 패널 상단에서 하단으로 떨어지는 그라디언트 시작점입니다. 이 한 곳에서만 쓰이는 값이라 토큰으로 빼지 않았습니다. 알파가 섞인 `rgba()` 값들도 같은 이유입니다 — CSS 변수로는 알파를 조합할 수 없어서, 다크 배경 위 반투명 레이어는 전부 리터럴로 작성했습니다.

### 2. 의도된 것 — 다만 값이 반복됩니다

`rgba(255,255,255,.06)` / `.10` / `.14` 계열이 다크 패널 여러 곳에 나옵니다. 다크 배경 위 카드·보더의 표준 알파값인데 토큰화하지 않았습니다. 개발에서 `--dark-layer-*` 같은 이름으로 빼시는 편이 관리에 유리할 수 있습니다. 값은 그대로 유지해 주세요.

### 3. 토큰으로 빼야 하는데 안 뺀 것 — 키오스크 팔레트

`erp-booking-kiosk` 는 `:root` 에 4개 변수를 자체 선언합니다.

```css
--k-booked:#818CF8      /* = --indigo-400 */
--k-booked-bar:#4F46E5  /* = --color-primary */
--k-empty:#EEF0F4       /* 전용값. --surface-alt(#F8FAFC)와 다름 */
--k-now:#22D3EE         /* = --color-accent */
```

원거리 판독을 위해 벽면 화면 전용으로 잡은 값이라 의도적으로 분리했습니다. `--k-empty` 만 시스템에 대응값이 없는 전용 회색입니다. `erp-booking` 월간 뷰의 밀도 막대(`#818CF8` / `#EEF0F4`)와 대시보드 타임라인도 같은 값을 리터럴로 씁니다.

**이 4개는 토큰으로 올리는 편이 맞습니다.** 필요하시면 `tokens/colors.css` 에 추가해 드리겠습니다.

---

## 요청 ④ — 셸 기준 템플릿

**셸 전용 템플릿은 없습니다.** 6개 템플릿에 같은 프레임이 복제되어 있습니다.

**기준으로 삼을 것: `erp-tenants/ErpTenants.dc.html`**

이 셸이 가장 완성도가 높습니다.

- 사이드바 접기·펼치기 전체 구현 (248px ↔ 64px, 240ms)
- 경계선에 걸친 24px 원형 토글, 기본 `opacity:.45` → hover 1
- 접힘 시 아이콘만 남고 hover 툴팁 표시
- 라벨 노출을 폭 측정으로 게이팅 (전환 중 삐져나옴 방지)
- `localStorage`(`swonbiz-sidebar-collapsed`)로 상태 유지
- 로고가 대시보드 진입점 겸용, 브랜드 접미어 교체 구조(`brand` prop: Biz ↔ Tech)

`erp-dashboard` 와 `erp-settings` 의 셸은 정적입니다 — 접기 기능이 없고 메뉴 항목만 같습니다. 참고하지 마세요.

**메뉴 6항목** (전 템플릿 동일)

```
로고(=대시보드) · 입주사 · 청구 · 세무 · 회의실 · 호실 · 설정
```

대시보드는 별도 메뉴 항목이 아니라 **로고 클릭**이 진입점입니다. 대시보드 화면일 때 로고 영역이 `--color-accent-bg` 로 활성 표시됩니다.

셸만 뽑은 템플릿이 필요하시면 만들어 드리겠습니다. 다만 `ErpTenants` 에서 `<aside>` 와 토글 버튼, 그리고 로직의 `bindSidebar()` / `applySidebar()` 두 메서드만 가져가시면 동일합니다.

---

## 5절 회신 — 만들지 않는 화면

확인했습니다. `ErpAuth` 의 `reset` / `sent` / `invite` 블록은 그대로 두고 더 손대지 않겠습니다. 로그인 화면의 "비밀번호 찾기"가 삐용 외부 링크가 되는 것도 반영해 두겠습니다.

**`s0300000080` 접근 권한 없음** — DS 컴포넌트 조립으로 충분합니다. 별도 디자인은 필요 없다고 봅니다.

`ErpAuth` 의 `sent` 블록이 거의 그대로 쓰입니다 — 중앙 정렬 카드에 원형 아이콘(56px) + 제목 + 설명 + 액션 버튼 구조입니다. 아이콘만 `mail-check` → `shield-off` 나 `circle-alert` 로 바꾸고, 아이콘 배경을 `--color-warning-bg`, 아이콘 색을 `--color-warning` 으로 두시면 됩니다. 액션은 "로그아웃" ghost 하나면 충분하고, 문의처는 `070-4355-2312` 를 `tel:` 링크로 두시는 편이 좋습니다.

시안이 필요해지면 말씀해 주세요.

---

## 남은 확인 사항

**`ds-base.js` 의 `base` 상수** — 11개 파일 모두 `'../..'` 그대로 두었습니다. 개발에서 `'../_ds/swonbiz'` 로 고치시면 됩니다.

**폰트** — `tokens/fonts.css` 는 Pretendard Variable 과 Inter 를 CDN(jsDelivr / Fontsource)에서 불러옵니다. 저장소에 `.woff2` 바이너리는 없습니다. 자체 호스팅이 필요하시면 라이선스 파일을 주시면 로컬 `@font-face` 로 바꿔 드리겠습니다.
