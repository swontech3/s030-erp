# migrations_hold — 자동 적용 금지

이 폴더의 SQL은 `supabase db push` / `supabase migration up` / 일괄 적용 스크립트가
**절대 건드리면 안 되는** 파일이다. 그래서 `supabase/migrations/` 밖에 둔다.

| 파일 | 적용 시점 | 이유 |
|---|---|---|
| `004_rename_tenant.sql` | 페이즈 G — 별도 앱 정지 창 | `tenant_id → operator_id` 리네임. 운영 중인 S-WonERP(Prisma)의 `schema.prisma`와 **동시에** 바꿔야 한다. 먼저 적용하면 기존 앱이 즉시 깨진다 |

적용 순서가 확정되면 그때 `../migrations/`로 옮긴다.
