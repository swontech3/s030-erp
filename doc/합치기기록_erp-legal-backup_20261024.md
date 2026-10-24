# 합치기 기록 — erp-legal-backup → integrate-erp-legal (2026-10-24)

> ERP 팀 확인용. master 에는 아직 합치지 않았다 — 이 가지(`integrate-erp-legal`)를 ERP 팀이 확인한 뒤 master.

| 항목 | 값 |
|---|---|
| 기준 | master `5f205cb` (= origin/master) |
| 합친 가지 | origin/erp-legal-backup `5d3b3d1` (커밋 98개) |
| 공통 조상 | `d2ffc61` |
| master 쪽에만 있던 커밋 | 5개 (규격서 Q6 로그인 · 서로 안에 뜨는 모드 · erp-register-org 주소 등) |
| 받은 지시 | 로그인 관련(연동 타입 · 상수 · 로그인 시험) = master 방식 기준 + ERP 가지가 더한 것을 얹는다 · .gitignore = 양쪽 줄 모두 · 그 밖의 충돌은 멈추고 묻는다 |

master 방식(지켜야 할 것) : ERP 서버는 비밀번호를 받지 않는다 · 삐용 주소는 설정으로만(기본값 없음) · 세션 회사 구분(`org_tp`)은 비어도 된다.

---

## 1. 글자 충돌 6개 — 어떻게 풀었나

| 파일 | 충돌 내용 | 푼 방법 |
|---|---|---|
| `.gitignore` | master : 「개인 PC 설정」 머리말 / ERP : `doc/data-src/` · `doc/forms-src/` 두 줄 + 「개인 PC 의 Claude 설정」 머리말. 그 아래 `.claude/settings.local.json*` 은 양쪽 공통 | **양쪽 줄 모두.** ERP 의 두 줄 → master 머리말 → ERP 머리말 → 공통 줄 순서. ※ ERP 머리말의 「이미 추적 중인 것은 그대로」는 master 가 `.claude/settings.local.json` 을 저장소에서 지운 뒤라 지금은 해당 파일이 없다(추적 0건) |
| `packages/api/src/bbiyong/types.ts` | 회사 등록 주소 `erp-register-org` 위 주석 한 줄 — 근거 표기만 다름(「삐용 명세 082」 / 「회신 2026-10-14」) | master 줄. 주소 · 코드는 양쪽이 같다 |
| `packages/shared/src/constants.ts` | 같은 주소의 설명 주석 — 내용은 같고 문장만 다름 | master 문장. 코드는 양쪽이 같다 |
| `packages/api/src/bbiyong/HttpBbiyongAuth.test.ts` | import 줄 — master 는 `parseSignIn` 등을 지움(규격서 Q6) / ERP 는 옛 목록에 `parseMyMenus` 를 더함 | master 줄 + ERP 가 더한 `parseMyMenus` : `import { HttpBbiyongAuth, parseReIssue, parseMyMenus }`. `INVALID_CREDENTIALS_MESSAGE` · `ORG_SELECT_MESSAGE` 는 시험 본문에서 쓰지 않아(master 가 그 시험을 지움) 넣지 않았다. ERP 가 더한 `parseMyMenus` · `myMenus` 시험 본문은 자동 병합으로 그대로 들어왔다 |
| `scripts/verify-2-8.js` | master : mock 토큰(`mock-access.{회원번호}`) / ERP : 비밀번호 상수(`const PASSWORD = …`) | master 쪽. ERP 가 바꾼 웹 포트 3100 은 충돌 밖이라 자동 병합으로 들어왔다 |
| `scripts/verify-print.js` | master : `LOGIN = mockTokens(...)` / ERP : `LOGIN = { email, password }` | master 쪽. 포트 3100 은 위와 같이 들어왔다 |

## 2. 글자 충돌은 아니지만 고친 것 1개

| 파일 | 문제 | 푼 방법 |
|---|---|---|
| `packages/api/src/bbiyong/MockBbiyongAuth.test.ts` (ERP 가 새로 만든 파일) | master 가 지운 `signIn` · `MOCK_PASSWORD` 로 토큰을 만든다 → tsc 오류 3 · 시험 1 실패 | 로그인 시험이라 같은 규칙 적용 — **토큰 만드는 줄만** master 방식(`MOCK_ACCOUNTS` 의 회원번호 → `mock-access.{회원번호}.{시각}`)으로. ERP 가 넣은 단언(운영사 = `['S021100010']` · 회사 = `[]` · 이상한 토큰 = rejected)은 그대로 |

자동 병합된 파일(`HttpBbiyongAuth.ts` · `MockBbiyongAuth.ts` · `HttpBbiyongOrg.test.ts` · `next.config.ts` · `verify-cont17.js` 등)도 master 방식이 남아 있는지 확인했다 : 비밀번호를 받는 길 없음 · `BBIYONG_BASE_URL` 이 없으면 기동 중단(기본값 없음) · `tb_s080_auth_session.org_tp` NULL 허용.

## 3. DB 037 둘

| 파일 | 쪽 | 다루는 표 | 개발계(.14:54322) |
|---|---|---|---|
| `037_auth_session_org_tp_nullable.sql` | master | `tb_s080_auth_session.org_tp` NULL 허용 | **적용됨** (칸이 NULL 허용) |
| `037_legal_org_scope.sql` | ERP | 법무 표 RLS · `tb_s080_legal_orgs` · 회사 사본 칸 | **적용됨** (`tb_s080_legal_orgs` 있음) |

- **서로 다른 표 · 순서 무관 · 개발계 둘 다 적용.** 법무 037 은 `auth_session` 을 한 번도 부르지 않는다.
- 이름은 **그대로 둔다**(대표 결정 2026-10-24). `038` 은 이미 `038_legal_org_name_type.sql` 이 쓰고 있어 038 로 바꿀 수도 없었다.
- 적용 방식 확인 : 적용 도구는 `scripts/apply-migration.js` 하나 — 사람이 파일 하나를 지정해 postgres 로 보낸다. **적용 기록을 DB 에 남기지 않는다**(`supabase_migrations.schema_migrations` · drizzle 표 없음, `_prisma_migrations` 는 레거시 Prisma 기록). 적용 여부는 `배포_계통전환.md` §6-1 표에 **파일 이름 전체**로 적혀 있는 것이 유일한 기억이다 → 앞 번호로 건너뛰는 일은 지금 방식에서는 없다.

### ★ ERP 팀이 볼 것 (고치지 않았다)

1. `배포_계통전환.md` §6-1 「운영계에 아직 올리지 않은 것」 표에 **`037_auth_session_org_tp_nullable.sql` 이 없다**(master 문서에도 없다). 이 목록대로 가동계에 올리면 이 파일이 빠진다. 앱(8b3e029 이후)이 회사 구분 없는 세션을 쓰므로 앱보다 먼저 올려야 할 것으로 보인다 — 줄 추가는 ERP 팀이 정한다.
2. 계획 문서(`.planning/PHASE1_지시서.md` · `REQUIREMENTS.md` PLAT-01 · `SWONBIZ_PROJECT_STRUCTURE.md`)는 「Supabase CLI 로 적용」을 적고 있다. Supabase CLI 는 **파일 이름 앞부분을 버전으로** 기억하므로, 나중에 CLI 로 바꾸면 037 둘이 같은 버전으로 부딪힌다. 지금은 CLI 를 쓰지 않는다.

### 다음 번호부터 겹치지 않게 — 규칙 안 (정하지 않았다)

| 안 | 방법 | 좋은 점 | 걸리는 점 |
|---|---|---|---|
| 가 | 번호를 쓰기 전에 **master 에 빈 자리 파일을 먼저 커밋**(예약) — 가지에서는 예약된 번호만 쓴다 | 지금 이름 모양 그대로 | 예약 커밋을 잊으면 같은 일이 난다 |
| 나 | **팀별 번호대** — 예 : ERP 100번대 · 법무 200번대(또는 접두어 `e050` · `l050`) | 가지끼리 절대 안 겹침 | 적용 순서가 이름 순서와 달라진다 — 순서는 §6-1 표가 정한다 |
| 다 | 앞 번호를 **날짜 · 시각**(`20261024_1530_...`)으로 | 거의 안 겹침 · Supabase CLI 와도 맞음 | 기존 001~049 와 모양이 섞인다 |
| 라 | 합치기 전 점검 — `supabase/migrations` 앞 번호 중복을 찾는 시험을 하나 둔다 | 위 안과 함께 쓸 수 있음 · 사람 실수를 기계가 잡음 | 이미 있는 037 둘은 예외로 적어야 한다 |

## 4. 시험 (합친 뒤 · 커밋 전 작업 트리)

| 명령 | 결과 |
|---|---|
| `packages/api` `npx vitest run` | 31 파일 · **425/425 통과** (고치기 전 : 424 통과 · 1 실패 — §2) |
| `packages/api` `npx tsc --noEmit` | 종료 0 (고치기 전 : TS2305 · TS2339 ×2 — §2) |
| `packages/shared` `npx vitest run` | 51 파일 · **1266/1266 통과** |
| `packages/shared` `npx tsc --noEmit` | 종료 0 |

## 5. 되돌리는 방법

- 이 가지만 있고 master 는 그대로다. 버리려면 : `git push origin --delete integrate-erp-legal` · `git branch -D integrate-erp-legal`
- master 에 합친 뒤 되돌리려면 : `git revert -m 1 <합친 커밋>`
- DB 는 이 합치기로 바뀐 것이 없다(037~049 는 이전에 이미 개발계에 적용돼 있었다).
