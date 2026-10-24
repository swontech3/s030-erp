/**
 * 일회용(2026-10-18) — 설립 세금 값을 등기 설정으로 옮긴다.
 *
 * 사용자 결정(2026-10-18, 등기 설정 090 결정 1):
 *   설립 세금(세율 · 최소액 · 대도시 중과 배수 · 교육세율 · 수수료)을 소스 상수(`incorporation-tax.ts`)에서
 *   등기 설정 발기설립 줄(`tb_s080_doc_form_settings`, R_PROMOTER · 기본 줄)의 `taxes` 로 옮긴다.
 *   소스 상수는 090-1(91bdcd8)에서 지웠다 — **이 스크립트를 적용하기 전까지 설립 서류의 세금 칸은 빈칸**이다.
 *
 *   넣는 값 = 2026-10-14 의 소스 상수 그대로:
 *     regLicenseRate  4        등록면허세율 1,000분의 4 (지방세법 제28조 ①6호 가목1))
 *     regLicenseMin   112500   최소 등록면허세
 *     metroMultiplier 3        대도시 중과 배수 (같은 조 ②, 100분의 300)
 *     localEduRate    20       지방교육세율 100분의 20 (지방세법 제151조 ①2호)
 *     regFee          35000    등기신청수수료 (서면, 수수료규칙 제5조의3 ①)
 *
 * ★ 이 줄의 `taxes` 만 바꾼다. 다른 칸 · 다른 줄(R_SUBSCRIPTION · 법인변경)은 건드리지 않는다.
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 하나라도 어긋나면(줄이 정확히 1건이 아님, `taxes` 가 이미 차 있음) 아무것도 쓰지 않고 멈춘다
 *   (두 번 돌리면 「이미 들어감」으로 멈춘다).
 *
 *   node scripts/oneoff/2026-10-18-incorporation-tax-setting.js .env            (보기)
 *   node scripts/oneoff/2026-10-18-incorporation-tax-setting.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-18-incorporation-tax-setting.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

/** 키 이름은 shared `incorporation-tax.ts` 의 `INCORP_TAX_KEYS` 와 같다. */
const TAXES = { regLicenseRate: 4, regLicenseMin: 112500, metroMultiplier: 3, localEduRate: 20, regFee: 35000 };

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const { rows } = await c.query(
      `SELECT id, label, tax_mode, taxes, is_active FROM public.tb_s080_doc_form_settings
        WHERE operator_id = 1 AND domain = 'incorporation' AND reg_type_key = 'R_PROMOTER' AND company_type = ''
        ${APPLY ? 'FOR UPDATE' : ''}`,
    );
    if (rows.length !== 1) throw new Error(`발기설립 등기 설정 기본 줄이 ${rows.length}건입니다 — 1건이어야 합니다`);
    const row = rows[0];
    if (row.taxes !== null) {
      const same = JSON.stringify(row.taxes) === JSON.stringify(TAXES);
      throw new Error(`taxes 가 이미 ${JSON.stringify(row.taxes)} 입니다${same ? '(이미 들어감)' : ''} — 손대지 않습니다`);
    }
    console.log(`■ 등기 설정 발기설립(R_PROMOTER, 기본 줄, ${row.id}) — ${row.label} · tax_mode ${row.tax_mode} · 사용 ${row.is_active}`);
    console.log(`  taxes  ${JSON.stringify(row.taxes)}`);
    console.log(`      → ${JSON.stringify(TAXES)}`);
    if (row.tax_mode !== 'computed') console.log(`  ※ tax_mode 가 ${row.tax_mode} 입니다 — 출력은 tax_mode 를 보지 않으므로 그대로 둡니다`);
    if (!row.is_active) console.log('  ※ 사용 끈 줄입니다 — 넣어도 켜기 전까지 서류의 세금 칸은 빈칸입니다');

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 쓰려면 --apply');
      return;
    }
    await c.query(
      `UPDATE public.tb_s080_doc_form_settings SET taxes = $2::jsonb, updated_at = now(), updated_by = 'oneoff-2026-10-18' WHERE id = $1`,
      [row.id, JSON.stringify(TAXES)],
    );
    await c.query('COMMIT');
    console.log('\n썼습니다 — 등기 설정 1줄');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
