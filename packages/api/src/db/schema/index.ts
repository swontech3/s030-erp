/**
 * Drizzle 스키마 — **DB 스키마의 소유는 여기 하나다.**
 *
 * 기존 S-WonERP 는 Prisma 로 같은 테이블을 본다. 두 ORM 이 같은 DB 를 각자 봐도
 * 무방하지만, 그러려면 소유가 갈려 있어야 한다 — 이쪽에서 만드는 것과 저쪽에서
 * 만드는 것이 겹치면 안 된다.
 *
 * 규칙 (doc/SWONBIZ_PROJECT_STRUCTURE.md §9)
 * - `drizzle-kit generate` 로 SQL 을 뽑아 `supabase/migrations/` 에 넣고 적용한다
 * - **`drizzle-kit push` 금지** — DB 에 바로 쓰면 마이그레이션 기록이 남지 않는다
 * - 적용은 항상 postgres 역할로 한다
 *
 * 테이블 정의는 각 페이즈에서 필요한 것부터 추가한다. 001~003 으로 이미 DB 에
 * 존재하는 테이블을 여기에 옮겨 적을 때는 **실제 DDL(doc/existing_schema.sql)을
 * 보고** 적는다 — 문서가 아니라 DB 가 기준이다.
 *
 * ★ 008(계약 스키마 재정의)은 generate 산출물을 그대로 쓰지 않았다.
 *   이 스키마 파일에 이력이 없어 generate 가 기존 테이블을 CREATE TABLE 로 뽑는다.
 *   실제로는 ALTER 가 필요하므로 008 은 손으로 썼다. 자세한 이유는 008 머리말.
 */
export * from './contracts';
