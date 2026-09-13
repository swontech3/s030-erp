# 자산 목록

| 파일 | 용도 | 사용처 |
|---|---|---|
| `swonbiz-logo.png` | 오렌지 심볼 — 라이트 배경 | ERP 셸 사이드바, 계약서 상단, 랜딩 네비·푸터 |
| `swonbiz-logo-white.png` | 다크 배경용 심볼 | 다크 섹션의 목업 사이드바 |
| `사용인감.png` | 법인 사용인감 | 이용계약서·전대차계약서 갑 서명란 |

---

## 참조 경로

템플릿은 전부 `../../assets/<파일명>` 으로 참조합니다.
`templates/<slug>/` 기준이므로 저장소 루트의 `assets/` 를 가리킵니다.

React 이관 시 `public/assets/` 또는 `src/assets/` 로 옮기고 import 경로만 바꾸세요.

---

## 로고 사용 규칙

```
심볼
  오렌지 색을 어떤 경우에도 변경하지 않습니다.
  예외: 인디고·컬러 단색 배경 위에서는 화이트 단색 버전 사용.
  최소 여백 = 심볼 높이의 40%
  그림자·글로우·그라데이션 적용 금지

워드마크  "S·wonBiz"
  "S·won" → --text-heading (#0B1120)
  "Biz"   → --color-primary (#4F46E5)
  인터펀크트(·) opacity .55
  weight 800 고정, letter-spacing -.03em
  다크 배경에서는 전체 #FFFFFF

금지
  오렌지는 로고 전용 — 버튼·아이콘·뱃지·차트 어디에도 쓰지 않습니다.
  오렌지를 인디고나 시안으로 치환한 변형을 만들지 않습니다.
  심볼과 워드마크의 비율·간격을 임의로 바꾸지 않습니다.
```

---

## 아이콘

**Lucide** (`lucide-static@0.414.0`, CDN) 를 CSS `mask-image` 로 씁니다.
자체 아이콘 세트가 없어 대체한 것입니다 — 브랜드 세트가 생기면 `Icon` 컴포넌트의
`BASE` 상수 한 줄만 바꾸면 전환됩니다.

```
크기  16 (인라인·캡션·테이블) / 20 (기본·버튼·네비) / 24 (피처)
색    currentColor 상속 — 아이콘 자체에 색을 넣지 않습니다
```

### ★ 이름 규칙 주의

0.414 에서 일부 아이콘이 `circle-*` / `file-pen-line` 으로 리네이밍되었습니다.

| 맞음 | 틀림 (404) |
|---|---|
| `circle-check` | `check-circle` |
| `circle-alert` | `alert-circle` |
| `circle-x` | `x-circle` |
| `file-pen-line` | `file-signature` |

### 화면별 사용 아이콘 — 1차

**ERP 셸** (`04-shell.md`)
```
building-2 · receipt · calculator · calendar-check · door-open · settings
chevron-left · chevron-right
```

**입주사·계약 관리** (`02-master-detail.md`)
```
plus              신규 입주사 등록 · 신규 계약
search            좌측 검색 인풋
check             상태 필터 칩 선택 표시
copy-plus         재계약 (행 액션 · 상세 모달 푸터)
file-text         계약 없음 빈 상태 · 첨부 파일
mouse-pointer-click  입주사 미선택 상태
download          상세 모달 첨부 다운로드
x                 모달 닫기
```

**계약 폼** (`03-contract-form.md`)
```
arrow-left        [이전]
save              [임시저장] [저장]
circle-check      [계약확정] · 사업자번호 확인 성공 · 잠긴 계산서발행 체크 · 입력 완료
circle-alert      사업자번호 중복·무효 · 가등록 안내
circle            잠긴 계산서발행 미체크
circle-x          계약취소 모달
triangle-alert    종료 모달
lock              섹션 2 "확정됨" 뱃지
search            계약호실 조회
trash-2           행 삭제
upload            첨부 [파일 선택]
eye               첨부 미리보기
file-text         첨부 등록됨 · [계약서 출력]
chevron-down      Select 표기 (템플릿 마크업에 한함)
```

**계약서 미리보기** (`06-contracts.md`)
```
printer           [인쇄]
x                 모달 닫기
```

> `chevron-down` 은 템플릿에서 DS `Icon` 으로 쓰지만,
> JS 로 생성하는 테이블 행에서는 CSS 캐럿을 씁니다 (`03-components.md#Select`).

**이모지는 쓰지 않습니다.** 유니코드 픽토그램도 아이콘으로 쓰지 않습니다.
허용되는 비아이콘 글리프는 `×`(닫기), `→`(링크 텍스트), CSS 로 그린 Select 캐럿뿐입니다.

---

## 폰트

```
Pretendard Variable  — 한글 + 라틴, 본문 전체
Inter                — 라틴 폴백
```

현재 **CDN 로드**이며 `.woff2` 바이너리는 저장소에 없습니다.

```
Pretendard Variable
https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/woff2/PretendardVariable.woff2
  format("woff2-variations"), font-weight: 400 800

Inter
https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2
  format("woff2-variations"), font-weight: 400 800
```

선언 원본은 `handoff/tokens/fonts.css` 에 있습니다.
자체 호스팅이 필요하면 라이선스 파일을 전달받아 `src` 만 교체하세요.

---

## 없는 자산

| 항목 | 상태 |
|---|---|
| 워드마크 이미지 | 없음 — 텍스트로 조판합니다 (Pretendard 800) |
| 파비콘 | 없음 — 필요하면 요청 주세요 |
| 브랜드 일러스트 | 없음 — 브랜드 원칙상 스톡 이미지·일러스트를 쓰지 않습니다 |
