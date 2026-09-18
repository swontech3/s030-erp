/**
 * 3-4 검증 보조 — 입주사·구성원.
 *
 * ★★ RLS 가 걸린 표(`companies`·`members`·`contracts`)는 `pool.query` 로 직접 읽으면
 *    **0행**이 온다. 오류가 아니라 정책이 거른 것이라 조용히 「없다」로 보인다 —
 *    4-3 검증이 이 함정을 밟아 6항목을 잘못 실패시켰고 DELETE 는 0건이 지워졌다.
 *    반드시 `withCompanyScope()` 안에서 본다.
 *
 * 사용:
 *   npx tsx scripts/verify-3-4.js probe            구조·값 어휘 조사
 *   npx tsx scripts/verify-3-4.js members <회사ID>  구성원 조회
 *   npx tsx scripts/verify-3-4.js company <회사ID>  입주사 1건
 */
import { pool, closePool } from '../packages/api/src/db/pool.ts';
import { withCompanyScope } from '../packages/api/src/db/withCompanyScope.ts';

const asOperator = (fn) => withCompanyScope({ role: 'operator', companyId: null }, fn);
const [cmd, arg] = process.argv.slice(2);

async function main() {
  if (cmd === 'probe') {
    const cols = await pool.query(
      `SELECT column_name, data_type, coalesce(character_maximum_length, numeric_precision) len,
              is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tb_s080_members'
        ORDER BY ordinal_position`,
    );
    console.log('── tb_s080_members 컬럼 ──');
    for (const c of cols.rows) {
      console.log(
        `  ${c.column_name.padEnd(20)} ${c.data_type}${c.len ? `(${c.len})` : ''}`.padEnd(48) +
          `null=${c.is_nullable} default=${c.column_default ?? '-'}`,
      );
    }

    // 이 표를 가리키는 FK — 행을 지워도 되는지가 여기서 갈린다.
    const refs = await pool.query(
      `SELECT c.conname, src.relname AS from_table, pg_get_constraintdef(c.oid) def
         FROM pg_constraint c
         JOIN pg_class src ON src.oid = c.conrelid
         JOIN pg_class tgt ON tgt.oid = c.confrelid
        WHERE c.contype='f' AND tgt.relname='tb_s080_members'`,
    );
    console.log('\n── tb_s080_members 를 참조하는 FK ──');
    console.log(refs.rows.length ? refs.rows.map((r) => `  ${r.from_table}: ${r.def}`).join('\n') : '  0건');

    const data = await asOperator(async (c) => {
      const cnt = await c.query(`SELECT count(*)::int n FROM public.tb_s080_members`);
      const rep = await c.query(
        `SELECT is_representative, count(*)::int n FROM public.tb_s080_members GROUP BY 1 ORDER BY 1`,
      );
      const st = await c.query(`SELECT status, count(*)::int n FROM public.tb_s080_members GROUP BY 1 ORDER BY 1`);
      const comp = await c.query(
        `SELECT company_id, company_name, biz_number, member_type, status FROM public.tb_s080_companies ORDER BY company_id`,
      );
      return { cnt: cnt.rows[0].n, rep: rep.rows, st: st.rows, comp: comp.rows };
    });
    console.log(`\n── 데이터 ──\n  구성원 ${data.cnt}행`);
    console.log(`  is_representative 분포: ${JSON.stringify(data.rep)}`);
    console.log(`  status 분포: ${JSON.stringify(data.st)}`);
    console.log(`  입주사 ${data.comp.length}건: ${JSON.stringify(data.comp)}`);

    // 코드 마스터에 대표자 어휘가 정의돼 있는가
    const code = await pool.query(
      `SELECT category, code, name FROM public.tb_s080_codes_line
        WHERE category IN ('RES_TP','COMPANY_ST') ORDER BY category, sort_order`,
    );
    console.log(`\n── RES_TP · COMPANY_ST ──`);
    for (const r of code.rows) console.log(`  ${r.category} ${r.code} = ${r.name}`);
  } else if (cmd === 'members') {
    const out = await asOperator((c) =>
      c.query(
        `SELECT member_id, name, phone, email, is_representative, memo, status
           FROM public.tb_s080_members WHERE company_id = $1 ORDER BY created_at, member_id`,
        [arg],
      ),
    );
    console.log(JSON.stringify(out.rows, null, 2));
  } else if (cmd === 'company') {
    const out = await asOperator((c) =>
      c.query(`SELECT * FROM public.tb_s080_companies WHERE company_id = $1`, [arg]),
    );
    console.log(JSON.stringify(out.rows[0] ?? null, null, 2));
  } else if (cmd === 'purge-inactive') {
    // 검증하며 만든 비활성 행 정리. 예약이 걸린 사람은 남긴다 — 지우면 그 예약의
    // 예약자가 조용히 비워진다(ON DELETE SET NULL).
    const n = await asOperator(async (c) => {
      const r = await c.query(
        `DELETE FROM public.tb_s080_members m
          WHERE m.company_id = $1 AND m.status = 'inactive'
            AND NOT EXISTS (SELECT 1 FROM public.tb_s080_reservations r WHERE r.member_id = m.member_id)`,
        [arg],
      );
      return r.rowCount;
    });
    console.log(`비활성 구성원 ${n}행 삭제`);
  } else {
    console.error('probe | members <회사ID> | company <회사ID> | purge-inactive <회사ID>');
    process.exitCode = 2;
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
