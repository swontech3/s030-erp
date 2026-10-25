# 세무 서비스 (S05) — 1단계 인계본

**확정 2026-10-24 · 대표 확인**

## 확정 범위

| 구분 | 파일 |
|---|---|
| 명세 | `01-flow.md` · `02-collect.md` · `03-match.md` · `04-results.md` · `05-settings.md` · `06-rules.md` · `07-data-model.md` |
| 시안 | `../prototypes/s05-tax/` (`index.html` · `tax.css` · `tax-data.js` · `tax-app.js` · `tax-screens-a.js` · `tax-screens-b.js`) |
| 결과서 | `08-screen-report.md` — 시안을 화면마다 글로 옮긴 것 (2026-10-24 추가, 확정본 내용은 바꾸지 않음) |
| 기록 (확정 범위 아님) | `_history/` — 1단계(`stage1-screens-questions.md`) · 2단계(`stage2-draft-questions.md`) 질문과 답. 결정의 근거를 볼 때만 |

남은 확인 · 질문: **없음.**

**읽는 순서** — `01-flow.md` → `06-rules.md` → 화면별(02~05) → `07-data-model.md`.

## 확정본을 고치는 방법

확정본(명세 01~07 · 시안)은 **직접 고치지 않습니다.** 바꿀 일이 생기면 아래 「변경 이력」에 한 줄을 더하고, 고친 파일 이름을 함께 적습니다.

---

## 변경 이력

| 날짜 | 내용 | 이유 | 바뀐 파일 |
|---|---|---|---|
| 2026-10-24 | 화면 시안 결과서 `08-screen-report.md` 추가 | 개발팀이 시안과 똑같이 만들도록 시안 내용을 글로 정리. 확정본(01~07 · 시안)은 고치지 않음. 결과서 끝 「미정」 22건은 대표 결정 필요 | `08-screen-report.md` · `README.md` |
| 2026-10-24 | 시안·결과서 수정 — 행 선택 + 목록 위 버튼(5개 목록) · 할 일 줄 누르면 이동 · 화면 버튼 줄 왼쪽 · 세무 설정 [저장] 한 번에 반영 · 원천세 신고 주기 라디오 · 반기 마감일 신고 주기·달 따라 · 받침 고침 · 결과서에 화면 번호 짝(부록 E) · 미정 정리(부록 C) | 대표 확정 사항 반영 | `prototypes/s05-tax/` (tax-app.js · tax-screens-a.js · tax-screens-b.js · tax.css · index.html) · `08-screen-report.md` · `README.md` |
| 2026-10-24 | 2차 수정 — S05-03 삐용 경비를 S05-02 자료 올리기에 합침(카드 + 올린 파일 한 줄, 할 일 6단계) · 원천세에 「직원별 월 이력 · 누계」 탭(급여 내역 합침) · 미정 15건 확정(처리할 줄 수 통일 · 입력 검사 · 달 선택 숨김 · 지난 달 같은 화면 · 저장 전 떠남 확인 · 파일 이름 · 대출 안내 · 확인 창 · 버튼 왼쪽 · 최신순 · 남은 금액 이어 맞추기 · 건너뜀 알림) · 화면 번호 짝 정리 | 대표 확정 사항 반영 | `prototypes/s05-tax/` 전체 · `08-screen-report.md` · `README.md` |
| 2026-10-24 | **시안 확정** — 남은 미정 없음. 「삐용 경비」 줄 지울 수 없음 확정, 삐용 경비 처리 상태의 거래 분류 표시는 나중(세무 1단계 작업 뒤) | 대표 확인 | `08-screen-report.md` · `README.md` |
| 2026-10-24 | 4대보험 자료 추가 — 자료 올리기에 「4대보험」 카드(기관 선택 없음, 할 일 자료 10종) · s050300040 이름을 「세금 · 보험 납부 · 대출」로 바꾸고 「4대보험」 탭(연금·건강·고용·산재별 회사·직원 부담)을 결과서에 적음(시안 없음) · 손익 회사 부담과 은행 자동이체 짝을 4대보험 자료로 | 대표 요청 | `prototypes/s05-tax/tax-data.js` · `tax-screens-a.js` · `08-screen-report.md` · `README.md` |
| 2026-10-24 | 결과서 부록 E 「4대보험」 탭 표에 「장기요양」 줄 추가 (건강보험 아래, 회사·직원 부담). 시안은 그대로 | 대표 요청 | `08-screen-report.md` · `README.md` |
| 2026-10-24 | S05-12 「직원 급여」(s050300030) 화면 추가 · 자료 올리기에서 급여대장 빼기(카드 9장, 할 일 9종) · 원천세 값을 직원 급여에서(정규직 세금은 세무사 계산) · 세무사 전달에 「직원 급여(엑셀)」 | 대표 요청 | `prototypes/s05-tax/` (tax-screens-c.js 새 파일 · tax-data.js · tax-app.js · tax-screens-a.js · tax-screens-b.js · index.html) · `08-screen-report.md` · `README.md` |
| 2026-10-24 | 할 일에 「직원 급여 확인」 2단계 추가(7단계 · 숫자 = 직원 급여 배지 「4대보험 자료에 없음 N명」/「저장 전」) · 직원 급여 머리 배지 · 원천세 본문과 결과서 전체의 「급여대장」 표현을 「직원 급여」로 고침 · **시안 확정** (남은 미정 없음) | 대표 확인 | `prototypes/s05-tax/` (tax-app.js · tax-screens-a.js · tax-screens-b.js · tax-screens-c.js · tax-data.js) · `08-screen-report.md` · `README.md` |
| 2026-10-24 | 은행 짝 맞추기 — 정규직 급여 이체는 직원 · 달 기준 짝(받는 사람 이름으로 직원 추천, 금액 차이는 「세금 등 차이」), 프리랜서는 실지급 금액으로 짝. 짝 이름 「9월 직원 급여 이체」 | 대표 요청 | `tax-data.js` · `tax-screens-a.js` · `08-screen-report.md` · `README.md` |
| 2026-10-24 | 부문별 기간 조회 · [엑셀 내려받기](ERP 공통 부품, 표준 양식 칸) · 올린 파일 [보기]로 이동 — 거래 분류 「확인할 줄만 / 전체」 보기 · 자료 종류 거르기, 은행 짝 맞추기 · 부가세 기간과 엑셀, 직원 급여 · 세무사 전달 안내 문구, 서류 출력은 표양식 관리(PDF). 결과서 0-7 | 대표 요청 | `prototypes/s05-tax/` (tax-screens-d.js 새 파일 · tax-data.js · tax-screens-a.js · tax-screens-b.js · tax-screens-c.js · index.html) · `08-screen-report.md` · `README.md` |
| 2026-10-24 | 세무사 전달에 기간 선택 카드(같은 기간 부품 + 신고 기간 바로 고르기, 코드 표) — 기간에 따라 보낼 파일 · 건수 · 메일 제목이 바뀜 · 기간 직접 지정은 화면마다 따로(작업할 달만 따라감) · 0-7 화면별 변경을 각 화면 본문에도 넣음 · **시안 확정** (남은 미정 없음) | 대표 확인 | `tax-screens-b.js` · `tax-screens-d.js` · `08-screen-report.md` · `README.md` |
| 2026-10-25 | 시안 예시 자료의 대표 실명 → 「김대표」, 메일 주소 두 개 → tax@example.com · ceo@example.com. (주)케이티 · 쿠팡(주) 사업자번호는 그대로 | 저장소 커밋 전 개인정보 정리(대표 지시) | `prototypes/s05-tax/tax-data.js` · `08-screen-report.md` |
