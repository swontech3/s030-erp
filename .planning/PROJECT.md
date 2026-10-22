# SwonBiz ERP

## What This Is

에스원비즈가 운영하는 공유오피스의 내부 운영 시스템(`erp.swonbiz.com`). 운영사 직원이 건물·층·호실 기준정보를 관리하고, 입주사와의 계약을 등록·확정·종료하며, 회의실 예약과 호실 점유 현황을 한 곳에서 처리한다. 입주사 담당자도 같은 시스템에 로그인해 자사 계약 정보를 확인하고 회의실을 예약한다.

계정은 ERP가 자체 발급하지 않는다. 기존 삐용(s02) 시스템의 JWT 인증을 재사용한다.

## Core Value

**운영사가 계약을 시스템 안에서 끝까지 처리할 수 있어야 한다** — 입주사 등록부터 계약 확정(`confirmed`)과 계약서 출력까지. 다른 모든 기능이 실패해도 이것만은 동작해야 한다.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(아직 없음 — 배포 후 검증)

### Active

<!-- 1차 마일스톤 범위. 상세 REQ-ID는 REQUIREMENTS.md 참조 -->

- [ ] 삐용 계정으로 ERP 로그인 (2단계: 계정 확인 → 조직 선택), 역할별 홈 분기
- [ ] 기준관리 — 건물·층·호실·회의실 등록 및 관리
- [ ] 입주사 등록 및 목록·상세 조회
- [ ] 계약 등록·수정 및 상태 전이 (`draft → confirmed → terminated`, `draft → cancelled`)
- [ ] 계약서 미리보기·인쇄 (이용계약서 / 전대차계약서)
- [ ] 회의실 예약 — 월간(운영사)·주간 현황, 예약 등록·수정·취소
- [ ] 회의실 현황판 (키오스크, 표시 전용)
- [ ] 호실 점유·공실 현황 조회
- [ ] 멀티테넌트 격리 — 입주사는 타사 데이터를 볼 수 없음

### Out of Scope

<!-- 명시적 경계. 이유를 함께 남겨 재추가를 막는다. -->

- **청구(납부) 기능** — 3차로 분리. 1차 범위(기준관리+예약+계약+로그인)만으로도 볼륨이 크고, 결제 연동 정책이 미정. 스키마(`s030_billing`, `s030_billing_item`)는 1차에서 설계만 하고 화면·API는 3차
- **결제 연동(PG)** — 3차 이후. 1차는 결제 수단 자체를 다루지 않음
- **온라인 신청 폼(s030500020) / 외부 회의실 예약(s030500040)** — 보류. 사업자 유무 분기가 계약 폼 필드 의미까지 바꾸는 미결 정책 3건에 막혀 있음 (`HANDOVER_T7_ErpApplyForm.md`)
- **설정 화면(s030000070)** — 2차. 1차는 미확정 상수를 `lib/constants.ts`에 집중
- **멤버 관리(s030200050) / 신청 대기(s030200060) / 외부 예약 승인 큐(s030600020)** — 2차
- **법무(040) · 세무(030)** — 4·5차, 화면 미확정
- **랜딩 페이지(s030500010)** — 0차로 이미 분리된 별도 범위
- **ERP 전용 계정 발급·비밀번호 관리** — 삐용 JWT 재사용이 전제. ERP는 계정을 만들지 않는다
- **별도 권한 시스템(13테이블·모듈 구독·역할 템플릿)** — 경계 미확정. 1차는 운영사/입주사 2역할 분기만

## Context

**설계 산출물이 이미 존재한다.** 이 프로젝트는 백지에서 시작하지 않는다.

- `design/*/[Name].dc.html` — Claude Design 산출 템플릿 11종. **각 화면의 시각 기준이며 새로 설계하지 않고 이관한다.** `ds-base.js`에 디자인 시스템 15종 마크업이 들어 있음
  - `ErpAuth` `ErpDashboard` `ErpTenants` `ErpMasterDetail` `ErpContractForm` `ErpBooking` `ErpBookingKiosk` `ErpBookingCompare` `ErpSettings` `ErpApplyForm` `LandingHero`
- `doc/SWONBIZ_SCREEN_LIST.md` — 화면 ID 체계(`s030` + 업무구분 3자리 + 순번 4자리 + `p{n}`)와 전체 화면 목록·차수·상태
- `doc/SWONBIZ_PROJECT_STRUCTURE.md` — Next.js 디렉터리 구조, 라우트 그룹(`(public)`/`(auth)`/`(erp)`), `lib/screens.ts` 중앙 매핑, 이관 규칙, 1차 개발 순서 9단계
- `doc/SWONBIZ_MODAL_COMPOSITION_P1.md` — 1차 팝업 5종을 기존 템플릿에서 조합하는 명세

**화면 ID와 라우트는 분리한다.** `s030200040`은 문서·소통용 식별자, URL은 `/contracts/[id]`. 팝업(`p{n}`)은 화면 ID를 갖되 라우트를 갖지 않는다.

**인증 대상 시스템(삐용, s02)**: Spring Boot + Java 11. 로그인 POST로 JWT 발급, `memberId` 기반, 2단계 로그인(계정 확인 → 조직 선택), `token010` 테이블 세션 관리, 리프레시 토큰 구조 보유. 도메인이 다르다 — ERP는 `swonbiz.com`, 삐용은 `bbiyong.s-wontech.co.kr`.

**1차에서 가장 무거운 화면은 계약 폼(s030200040)**이다. 섹션 4개, 상태 5종, 계약 항목 최대 10행, 계약 사용자 최대 20명, 계약서 2종 출력.

**하드코딩된 값이 템플릿에 남아 있다.** 계약서 미리보기의 담당자명("이정희")·센터명("강남 삼성점"). 조회 순서는 지점 담당자 → 조직 기본 담당자.

## Constraints

- **Tech stack**: Next.js (App Router) + Fastify + PostgreSQL(Supabase) — 확정. 삐용과 다른 스택이지만 신규 시스템이고 프런트 생산성을 우선함
- **Tech stack**: DB 접두어 정의(2026-10-22 결정) — `tb_s080_` = 공통 접두어. ERP 저장소의 표는 서비스(S03 ERP · S04 법무 · S05 세무)와 상관없이 모두 `tb_s080_` 으로 만들고, 어느 서비스 표인지는 표 설명(COMMENT)에 적는다. 삐용 `tb_s020_`(스키마 `tb_s020_t001`) · 메일 Agent `tb_s090_`(스키마 `tb_s090_t001`)은 그대로. (옛 D1 「`tb_s030_t001.tb_s030_*` · `public` 사용 금지」는 철회 — `public.tb_s080_*` 제자리 확장)
- **Security**: JWT 시크릿·DB 접속 정보는 `.env`에만. 코드에 하드코딩 금지
- **Security**: 멀티테넌트 격리 — 입주사끼리 데이터가 노출되면 안 됨. 타사 예약은 "예약됨"으로만 표시하고 제목·조직명·인원을 마스킹
- **Dependencies**: 인증이 삐용 시스템에 종속된다. 삐용 JWT TTL·리프레시 정책과 세션 만료를 일치시켜야 함
- **Design**: `design/*.dc.html`이 시각 기준. 새로 설계하지 말고 이관한다
- **Design**: Primary `#4F46E5` / Accent `#22D3EE` / warning `#D97706` / danger `#DC2626`. **녹색 계열 금지** — 완료·성공도 인디고로 표현. 오렌지는 로고 전용
- **Design**: 기본 고정 1440px. 3단 반응형은 예약 현황(s030600010)과 현황판(s030500060) 두 화면만
- **Compatibility**: 미확정 상수는 `lib/constants.ts`에 집중 관리 (예약 시간·요금·QR URL 등)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 1차 범위에서 청구(납부)를 3차로 분리 | SCREEN_LIST의 차수 정의와 마일스톤 지시가 충돌. 기준관리·예약·계약만으로도 볼륨이 크고 결제 정책이 미정 | — Pending |
| 회의실 예약·기준관리를 2차 → 1차로 앞당김 | 마일스톤 지시 우선. 계약과 함께 운영 핵심 기능으로 판단 | — Pending |
| 인증은 삐용 JWT 재사용, ERP 전용 계정 미발급 | 사용자가 두 시스템에 각각 계정을 만들지 않게 함. 계정 관리 중복 제거 | — Pending |
| 화면 ID와 라우트 분리 (`lib/screens.ts` 중앙 매핑) | `/s030200040` 같은 URL은 SEO·공유·기억 어느 쪽에도 불리 | ✓ Good |
| Horizontal Layers 구조 (계층별 완성) | `SWONBIZ_PROJECT_STRUCTURE.md`의 1차 개발 순서(스캐폴딩→tokens→DS 15종→auth→셸→화면)와 일치. DS를 먼저 세우지 않으면 화면마다 재작업 발생 | — Pending |
| 순차 실행(Sequential), Standard granularity | 계층이 서로 의존해 병렬 이득이 적음 | — Pending |
| 품질 게이트: Researcher + Verifier (Plan Checker 제외) | 외부 JWT 검증·Supabase 멀티테넌트는 조사 가치가 큼. 플랜 검증은 Interactive 모드의 사람 확인으로 대체 | — Pending |
| 참조 문서 경로는 `doc/` (지시문의 `design/`이 아님) | 실제 파일 위치 확인 결과 | ✓ Good |
| **D1: 기존 ERP 32테이블을 `tb_s030_t001` 스키마로 이동·리네임** (2026-09-06) | `public.tb_s080_*`가 이미 존재하고 Prisma 앱이 단독 소유. 이름에 걸린 DB 객체는 FK 1건뿐이고 데이터는 시드 370행이라 이동 비용이 사실상 없다. 신규 구축(중복)도 tb_s080 유지(접두어 혼재)도 더 비싸다 | ✓ Decided — 실행은 Prisma 앱 소스 grep 확인 후 |
| 접두어 제약을 `s030_*` → `tb_s030_t001.tb_s030_*`로 구체화 | 삐용 `tb_s020_t001`·메일 `tb_s090_t001`이 이미 `tb_sXXX_t001` 스키마 규칙을 쓴다. `public` 공유를 끊으면 Supabase PostgREST 노출도 함께 끊긴다 | ✓ Decided → 철회(D1 철회). 2026-10-22 정의: `tb_s080_` 공통 접두어(위 Tech stack) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-01 after initialization*
