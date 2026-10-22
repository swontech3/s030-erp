# 옵션 A 실행 계획 — ERP 테이블을 `tb_s030_t001`로 이동

**결정일:** 2026-09-06 (D1 = A)
**근거:** `SCHEMA_ANALYSIS.md` §6 — 이름에 걸린 DB 객체는 FK 1건, 데이터는 시드 약 370행
**생성 SQL:** `migrations/001_move_erp_to_s030.sql` (`node scripts/gen-move-sql.js .env`로 재생성)
**상태:** 미실행. 아래 선행조건 3건이 남아 있다.

> ★ **DB 접두어 정의(2026-10-22 결정)** — `tb_s080_` = 공통 접두어. ERP 저장소의 표는 서비스(S03 ERP · S04 법무 · S05 세무)와 상관없이 모두 `tb_s080_` 으로 만들고, 어느 서비스 표인지는 표 설명(COMMENT)에 적는다. 삐용 `tb_s020_`(스키마 `tb_s020_t001`) · 메일 Agent `tb_s090_`(스키마 `tb_s090_t001`)은 그대로. 아래의 `tb_s030_` 이동 · 이름은 철회된 D1 의 기록이다.

---

## 1. 무엇을 하는가

`public.tb_s080_*` 29개 테이블을 새 스키마 `tb_s030_t001`으로 옮기고 접두어를 `tb_s030_`으로 바꾼다. 삐용 `tb_s020_t001`, 메일 Agent `tb_s090_t001`과 같은 규칙에 맞춘다.

| 단계 | 대상 | 건수 |
|---|---|---:|
| 1 | `ALTER TABLE ... SET SCHEMA tb_s030_t001` | 29 |
| 2 | `RENAME TO tb_s030_*` | 29 |
| 3 | 제약 이름 정리 | 70 |
| 4 | 인덱스 이름 정리 | 46 |
| 5 | 시퀀스 이름 정리 | 1 |
| 6 | 권한 재설정 (`service_role`만) | — |

전부 한 트랜잭션 안에서 돈다. 실패하면 통째로 롤백된다. 커밋 후 되돌리려면 파일 하단의 역순 스크립트를 쓴다.

## 2. 선행조건 (전부 충족 전 실행 금지)

**① Prisma 앱 소스 grep 3종 — 미확인**

앱 루트에서:

```bash
grep -rn "from('tb_s080\|from(\"tb_s080" .   # supabase-js 직접 호출
grep -rn "queryRaw\|executeRaw" .            # Prisma raw SQL
grep -rn "tb_s080" prisma/ supabase/         # 스키마·config 하드코딩
```

셋 다 0이면 앱 수정은 `schema.prisma` 한 파일이다. 하나라도 걸리면 그 지점을 먼저 목록화한다.

**② 백업**

```bash
pg_dump -h 192.168.0.14 -p 54322 -U postgres -n public -Fc postgres > before_move.dump
```

**③ Prisma 앱 정지**

이동 중 앱이 붙어 있으면 `ALTER TABLE`이 락을 기다린다. 데이터가 시드뿐이라 다운타임 제약은 없다.

## 3. 앱 쪽 후속 작업

`schema.prisma`에서:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]      // 스키마 분리에 필요
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "tb_s030_t001"]
}

model Company {
  // ...
  @@map("tb_s030_companies")             // tb_s080_companies 에서 변경
  @@schema("tb_s030_t001")               // 추가
}
```

29개 모델의 `@@map` 값 치환 + `@@schema` 추가. 이동은 DB에서 이미 끝난 상태이므로 Prisma에는 **`migrate resolve --applied`로 기록만 맞추거나**, `migrate diff`로 빈 마이그레이션을 만들어 이력에 넣는다. `migrate dev`를 그냥 돌리면 Prisma가 "테이블이 없다"고 판단해 재생성하려 들 수 있으니 주의한다.

## 4. 이동하지 않는 것 — 판단 필요

| 테이블 | 행 | 현재 | 메모 |
|---|---:|---|---|
| `public."User"` | 1 | 이동 안 함 | Prisma 앱 자체 계정 테이블. `tenant_id → tb_s030_tenant010` FK가 스키마를 가로지르게 된다(문제 없음). **AUTH-01(ERP 전용 계정 미발급)에 따라 결국 폐기 대상**이므로 이동에 비용을 쓰지 않는다 |
| `public.tb_cm_file` | 48 | 이동 안 함 | `tb_cm_` = 공통 접두어. 소유자와 사용처 미확인 — **확인 필요** |
| `public._prisma_migrations` | 35 | 이동 안 함 | Prisma 소유. 그대로 둔다 |

## 5. 이동으로 함께 해결되는 것

`public`의 32개 테이블은 전부 RLS가 꺼져 있는데 `anon`·`authenticated`에 전권 grant가 걸려 있다(87건, Supabase 기본값). anon 키만 있으면 브라우저에서 계약·청구·회원을 읽고 쓸 수 있다.

생성 SQL은 **새 스키마에 이 상태를 복제하지 않는다.** `service_role`에만 권한을 주고 `anon`·`authenticated`에는 아무것도 주지 않는다. PostgREST 경유 직접 노출이 끊기고, 접근 경로는 Fastify 한 곳으로 좁혀진다 — ACL-02(스코프 헬퍼 단일 경로)의 전제와 맞다.

`public`에 남는 `User`·`tb_cm_file`의 grant는 **별도로 닫아야 한다.** 이 계획에 포함하지 않았다.

## 6. 검증

이동 후:

```bash
node scripts/rowcounts.js .env      # 행 수가 이동 전과 같은지
node scripts/inspect-deps.js .env   # tb_s080 잔여 참조가 0인지
```

`tb_s030_t001` 29테이블의 행 수가 §6.2 표와 일치하고, `public`에 `tb_s080` 이름이 하나도 남지 않으면 성공이다.
