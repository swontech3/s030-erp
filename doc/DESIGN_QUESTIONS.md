# 디자인 회신 대기 목록

**상태: 페이즈 1 종료(2026-09-07) — 보낼 준비 완료.** 회신 요청 ①②③⑤ · 참고 ④.
**보내는 시점:** 페이즈 1 종료 시 한 번에.
**원칙:** 개발이 디자인 자산(`design/_ds/`)을 고치지 않는다. 토큰을 새로 만들지도 않는다 —
임의로 이름을 지으면 다음 내보내기와 충돌한다. 그래서 여기 모아 두고 한 번에 묻는다.

작업 중 새로 생기면 이 파일에 계속 붙인다.

---

## ① 다크 패널 알파 값 토큰 추가 요청

**무엇:** `rgba(255,255,255,.06)` · `.10` · `.14` 세 값이 다크 패널에서 반복된다.

**어디:** `design/erp-auth/ErpAuth.dc.html` 브랜드 패널의 기능 아이콘 상자
(`background:rgba(255,255,255,.06)`, `border:1px solid rgba(255,255,255,.10)`).
이관본은 `packages/web/src/components/patterns/AuthBrandPanel.tsx`.

**요청:** 토큰 이름을 붙여 다음 전달분에 포함해 주세요. 개발이 이름을 지으면
다음 내보내기와 충돌하므로 리터럴로 두고 기다립니다.

**지금 처리:** 리터럴 유지. `#131C33`·`rgba(79,70,229,.18)` 같은 알파 조합도 마찬가지로
리터럴로 뒀습니다 — CSS 변수로는 알파를 조합할 수 없어 **의도된 것**으로 이해했습니다.
그 이해가 맞는지도 함께 확인 부탁드립니다.

---

## ② `landing-hero` 의 공간 사진 7개 누락

**무엇:** `LandingHero.dc.html` 이 참조하는 이미지 7개가 전달분에 없습니다.

```
assets/spaces/lounge.png            assets/spaces/single-room.png
assets/spaces/two-person-room.png   assets/spaces/dedicated-desk.png
assets/spaces/team-office.png       assets/spaces/meeting-room.png
assets/spaces/pantry.png
```

전달된 `assets/` 에는 `swonbiz-logo.png` · `swonbiz-logo-white.png` · `사용인감.png`
3개뿐입니다. `node scripts/check-design-links.js landing-hero` 로 재확인할 수 있습니다.

**영향:** 랜딩(0차)에서만 씁니다. 페이즈 1(로그인·접근권한없음)은 막지 않습니다.

**요청:** 다음 전달분에 포함하거나, 사진을 개발이 준비해야 하는 것이면 알려주세요.

---

## ③ ★ 로그인 화면이 DS `Input`·`Button`·`Checkbox` 를 쓰지 않습니다

**발견:** `ErpAuth.dc.html` 은 DS 컴포넌트를 `Icon` 하나만 부릅니다(`x-import` 18건 전부
`Icon`). 입력·버튼·체크박스는 인라인 스타일로 직접 그려져 있고, **값이 DS 와 다릅니다.**

| | 템플릿(ErpAuth.dc.html) | DS 컴포넌트 |
|---|---|---|
| 입력 높이 | `48px` | `var(--control-h)` = **54px** |
| 입력 글자 | `15px` | `16px` |
| 버튼 높이 | `52px` | `var(--control-h)` = **54px** |
| 체크박스 | 네이티브 `<input type=checkbox>` + `accent-color` (18px) | 숨긴 input + 커스텀 20px 상자 |

색과 hover 규칙은 일치합니다 — 예를 들어 `sent` 블록의 "다시 보내기" 버튼은
`border:1px solid var(--border)` / `background:var(--surface)` / `color:var(--text-heading)` /
hover `background:var(--surface-alt)` 로 **DS `Button` 의 `ghost` 변형과 같은 값**입니다.
어긋나는 것은 **크기**뿐입니다.

**질문:** 이게 로그인 화면만의 의도적 예외인가요, 아니면 템플릿이 DS 보다 먼저
만들어져 아직 맞춰지지 않은 것인가요?

- **의도적 예외라면** — 인증 화면은 이 값으로 고정하고, 나중에 DS 를 쓰는 화면과
  섞이지 않게 문서에 남기겠습니다.
- **안 맞춰진 것이라면** — 템플릿을 DS 값으로 갱신해 주시면 이관본도 DS 컴포넌트로
  바꾸겠습니다. 그 편이 이후 화면들과 일관됩니다.

**지금 처리:** `.dc.html` 이 시각 기준이라는 원칙에 따라 **원본 우선**으로
진행 중입니다(48px/52px 유지). 회신에 따라 바꿉니다.

관련: `packages/web/src/app/(auth)/login/page.tsx`,
`packages/web/src/app/(auth)/no-access/page.tsx`

---

## ④ 참고 — 확인은 끝났고 회신이 필요 없는 것

기록만 남깁니다. 회신 대상이 아닙니다.

- **폰트는 자체 호스팅으로 진행합니다 (통보).** Pretendard · Inter 모두 SIL Open Font License 로
  확인했고(`packages/web/public/fonts/LICENSE-*.txt` 동봉), `next/font/local` 로 전환했습니다.
  CDN 의존이 사라져 로그인 화면의 글꼴 튐(CLS)과 CSP 외부 도메인 허용이 함께 없어집니다.
  Pretendard 자체 호스팅 파일이 2MB 라 subset 배포본 검토는 남아 있습니다.
- **셸 라벨 노출 타이밍** — `ErpTenants` 원본은 펼칠 때 레일 폭을 60ms 마다 재서 200px 을 넘을 때
  라벨을 켭니다. 이관본은 flex 축소로 레일이 넓어지는 만큼 드러나게 했습니다(끝 상태는 같음).
  개발 쪽에서 화면을 보고 판단 중이며, 원본 타이밍이 맞다고 결론 나면 되돌립니다. 회신 불필요.

- **`_ds_bundle.js` 부재는 정상입니다.** `design/_ds/swonbiz/README.md` 에 "요청대로
  제외했습니다"라고 적혀 있습니다. 템플릿을 브라우저로 열면 `<x-import>` 로 들어간
  아이콘만 안 그려지고, 색·글꼴·간격은 정상입니다.
- **`styles.css` 는 컴포넌트 클래스가 아니라 `@import` 6줄짜리 진입점입니다.**
  개발 지시서가 "컴포넌트 클래스 정의"로 알고 있었는데 실제로는 아니었습니다.
  `globals.css` 로 가져갈 클래스가 없습니다.

---

## ⑤ 파비콘 요청

**무엇:** 브라우저 탭 아이콘(`/favicon.ico`)이 전달분에 없습니다. 지금은 모든 화면에서
`/favicon.ico` 404 가 콘솔에 한 줄씩 남습니다 — 동작에는 영향이 없습니다.

**개발이 임시로 아무거나 넣지 않습니다.** 탭 아이콘은 브랜드 자산이라 디자인이 정합니다.
로고(`swonbiz-logo.png`, 32×51)는 세로로 길어 그대로 파비콘으로 쓰면 찌그러집니다.

**요청:** 다음 전달분에 아래를 포함해 주세요.
- `favicon.ico` (16·32·48px 포함) 또는 `icon.svg` 1개 + `apple-touch-icon.png` (180px)
- 배경 투명/흰색 중 어느 쪽인지

받으면 `packages/web/src/app/` 에 두기만 하면 됩니다(Next.js 파일 규약).
