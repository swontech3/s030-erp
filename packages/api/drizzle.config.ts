import type { Config } from 'drizzle-kit';

/**
 * 산출물은 저장소 공용 마이그레이션 폴더로 나간다 — 001~003 과 같은 계보에 둔다.
 * `supabase/migrations_hold/` 는 자동 적용 금지 구역이라 여기서 건드리지 않는다.
 *
 * ★ `drizzle-kit push` 를 쓰지 않는다. generate 로 SQL 을 만들고 사람이 확인한 뒤
 *   postgres 역할로 적용한다(§9).
 */
export default {
  schema: './src/db/schema/index.ts',
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.ERP_DATABASE_URL ?? '',
  },
} satisfies Config;
