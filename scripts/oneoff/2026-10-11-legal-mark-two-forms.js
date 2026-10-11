/**
 * 일회용(결정 D, 2026-10-11) — 기존 법무 양식 2건에 법무 표시를 붙이고 자리표시 이름을 바꾼다.
 *
 *   법인변경등록1         — 표시: 변경 구분 5종 · 전체 · 건마다 한 장
 *                           자리표시: {{today}} → {{applyDate}}(신청일)
 *   사내이사 중임승낙서   — 표시: 임원변경 · 전체 · 임원마다 한 장 · 중임
 *                           자리표시: {{grade}} → {{officerPosition}} · {{day}} → {{writeDate}}
 *                                     {{ceoName}} → {{officerName}}   (별칭 없음, 칸은 새로 만들지 않는다)
 *
 * ★ 기본은 **보기만** 한다(바뀌는 칸을 전후로 찍는다). `--apply` 를 붙여야 쓴다 — 한 트랜잭션.
 * ★ 양식은 **이름으로** 찾고, 각각 정확히 1건이어야 한다. 이미 표시가 있으면 손대지 않고 멈춘다(두 번 돌려도 같다).
 * ★ 레거시 `dataSource` 는 지우지 않는다. 다른 칸 · 다른 양식은 건드리지 않는다.
 * ★ 개발 DB 전용으로 썼다. 운영계에 쓸지는 그때 정한다.
 *
 *   node scripts/oneoff/2026-10-11-legal-mark-two-forms.js .env            (보기)
 *   node scripts/oneoff/2026-10-11-legal-mark-two-forms.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-11-legal-mark-two-forms.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const ALL_TYPES = ['NAME', 'HQ', 'PURPOSE', 'OFFICER', 'CEO_ADDR'];
const PLAN = [
  {
    name: '법인변경등록1',
    legal: { domain: 'corp-change', changeTypes: ALL_TYPES, companyType: 'ALL', unit: 'case' },
    renames: [['today', 'applyDate']],
  },
  {
    name: '사내이사 중임승낙서',
    legal: { domain: 'corp-change', changeTypes: ['OFFICER'], companyType: 'ALL', unit: 'officer', officerKinds: ['REELECT'] },
    renames: [
      ['grade', 'officerPosition'],
      ['day', 'writeDate'],
      ['ceoName', 'officerName'],
    ],
  },
];

/** `{{ 이름 }}`(앞뒤 공백 허용) → `{{새 이름}}`. 다른 자리표시는 그대로. */
function renameTokens(text, renames) {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, raw) => {
    const hit = renames.find(([from]) => from === raw.trim());
    return hit ? `{{${hit[1]}}}` : whole;
  });
}

/** 화면용 — 공백 덩어리는 ␣×N 으로 줄인다(값은 바꾸지 않는다). */
const show = (s) => {
  const t = s.replace(/ {4,}/g, (m) => `␣×${m.length}`);
  return JSON.stringify(t.length > 160 ? `${t.slice(0, 157)}…` : t);
};

(async () => {
  const c = new Client({
    host: env.DB_HOST,
    port: +env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });
  await c.connect();
  await c.query('BEGIN');
  try {
    const updates = [];
    for (const p of PLAN) {
      const { rows } = await c.query(
        `SELECT id, name, definition FROM public.tb_s080_form_templates WHERE name = $1 FOR UPDATE`,
        [p.name],
      );
      if (rows.length !== 1) throw new Error(`「${p.name}」 이 ${rows.length}건입니다 — 1건이어야 합니다`);
      const { id, definition } = rows[0];
      if (definition.legal !== undefined) throw new Error(`「${p.name}」 에 이미 법무 표시가 있습니다 — 손대지 않습니다`);

      console.log(`\n■ ${p.name} (${id})`);
      console.log(`  dataSource: ${JSON.stringify(definition.dataSource)} — 그대로 둔다`);
      console.log(`  + legal: ${JSON.stringify(p.legal)}`);

      const next = { ...definition, legal: p.legal };
      let changedCells = 0;
      const seen = new Set();
      next.pages = definition.pages.map((page, pi) => ({
        ...page,
        cells: page.cells.map((cell) => {
          if (typeof cell.text !== 'string') return cell;
          const text = renameTokens(cell.text, p.renames);
          if (text === cell.text) return cell;
          changedCells += 1;
          for (const [from] of p.renames) if (new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`).test(cell.text)) seen.add(from);
          console.log(`  ${pi + 1}장 행${cell.row} 열${cell.col}`);
          console.log(`    전 ${show(cell.text)}`);
          console.log(`    후 ${show(text)}`);
          return { ...cell, text };
        }),
      }));
      const missing = p.renames.filter(([from]) => !seen.has(from)).map(([from]) => `{{${from}}}`);
      if (missing.length > 0) throw new Error(`「${p.name}」 에서 찾지 못한 자리표시: ${missing.join(' · ')}`);
      console.log(`  바뀌는 칸 ${changedCells}개`);
      updates.push({ id, next });
    }

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 쓰려면 --apply');
      return;
    }
    for (const u of updates) {
      await c.query(
        `UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = 'oneoff-2026-10-11' WHERE id = $1`,
        [u.id, JSON.stringify(u.next)],
      );
    }
    await c.query('COMMIT');
    console.log(`\n썼습니다 — ${updates.length}건`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
