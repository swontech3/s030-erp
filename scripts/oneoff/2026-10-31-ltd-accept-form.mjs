/**
 * 일회용(2026-10-31) — 법무 표양식 「취임승낙서(유한회사)」 등록(결정 2026-10-31 (가)).
 *
 * ★ 표양식 「취임승낙서(설립)」(법인설립 · 임원마다 · 주식회사)을 **복사**한다. 바꾸는 것은 한 곳뿐:
 *   본문의 「발기인총회」 → 「사원총회」(유한회사 초대 이사는 사원총회에서 선임 — 상법 제547조① · 정관(유한회사) 제20조).
 *   모양(열 · 행 · 칸 · 글자 크기) · 자리표시 · 이름표(`manualFields`)는 그대로다.
 * ★ 법무 표시만 바꾼다: 법인설립 · 임원마다 · 회사 형태 유한회사(`companyType: 'A'`) — 유한회사 건에만 뜬다.
 * ★ 원본 「취임승낙서(설립)」은 읽기만 한다(고치지 않는다).
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 한 트랜잭션으로 쓴다. 멈추는 경우(아무것도 쓰지 않는다):
 *   원본이 정확히 1건이 아님 · 원본이 법인설립 · 임원마다 표시가 아님 · 「발기인총회」가 정확히 1곳이 아님 ·
 *   「취임승낙서(유한회사)」가 이미 있음 · shared `parseDefinition` 을 통과하지 못함.
 *   쓰는 표: `tb_s080_form_templates` 한 줄(넣기만).
 *
 *   npx tsx scripts/oneoff/2026-10-31-ltd-accept-form.mjs <admin.env>              (보기)
 *   npx tsx scripts/oneoff/2026-10-31-ltd-accept-form.mjs <admin.env> --apply      (쓰기)
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { parseDefinition, definitionTokens } from '../../packages/shared/src/domain/form-template.ts';

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: npx tsx scripts/oneoff/2026-10-31-ltd-accept-form.mjs <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const FROM_NAME = '취임승낙서(설립)';
const NAME = '취임승낙서(유한회사)';
const FROM_WORD = '발기인총회';
const TO_WORD = '사원총회';
const MARK = { domain: 'incorporation', unit: 'officer', companyType: 'A' };

(async () => {
  const c = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const problems = [];
    const from = (await c.query(`SELECT definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [FROM_NAME])).rows;
    if (from.length !== 1) throw new Error(`「${FROM_NAME}」 양식이 ${from.length}개다(1개여야 한다)`);
    const src = from[0].definition;
    if (src.legal?.domain !== 'incorporation' || src.legal?.unit !== 'officer') {
      throw new Error(`「${FROM_NAME}」 이 법인설립 · 임원마다 양식이 아니다(${JSON.stringify(src.legal)})`);
    }

    const def = JSON.parse(JSON.stringify(src));
    const changed = [];
    let count = 0;
    def.pages.forEach((p, pi) => {
      for (const cell of p.cells) {
        if (!cell.text || !cell.text.includes(FROM_WORD)) continue;
        count += cell.text.split(FROM_WORD).length - 1;
        const before = cell.text;
        cell.text = cell.text.split(FROM_WORD).join(TO_WORD);
        changed.push({ at: `${pi + 1}장 r${cell.row} c${cell.col}`, before, after: cell.text });
      }
    });
    if (count !== 1) problems.push(`「${FROM_WORD}」가 ${count}곳(1곳이어야 한다)`);
    def.legal = MARK;
    const parsed = parseDefinition(def);
    if (src.manualFields) parsed.manualFields = src.manualFields;

    // 대조 — 바꾼 한 곳 말고는 원본과 같아야 한다(모양 · 자리표시 · 이름표)
    // 키 순서는 보지 않는다(jsonb 는 키 순서를 바꿔 돌려준다)
    const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])) : v);
    const strip = (d) => JSON.stringify(canon({ ...d, legal: undefined, pages: d.pages.map((p) => ({ ...p, cells: p.cells.map((x) => ({ ...x, text: x.text?.split(TO_WORD).join(FROM_WORD) })) })) }));
    if (strip(parsed) !== strip(src)) problems.push('바꾼 낱말 말고 원본과 다른 곳이 있다');
    const tokens = definitionTokens(parsed);
    const srcTokens = definitionTokens(src);
    if (JSON.stringify(tokens) !== JSON.stringify(srcTokens)) problems.push('자리표시가 원본과 다르다');

    console.log(`■ ${NAME}  — 원본: 표양식 「${FROM_NAME}」 복사`);
    console.log(`  원본 표시: ${JSON.stringify(src.legal)} → 새 표시: ${JSON.stringify(parsed.legal)}`);
    console.log(`  장 ${parsed.pages.length} · 글꼴 ${parsed.font.family} ${parsed.font.size}pt`);
    for (const ch of changed) console.log(`  바꾼 곳 ${ch.at}\n    전: ${ch.before}\n    후: ${ch.after}`);
    console.log(`  자리표시 ${tokens.length}개(원본과 같음): ${tokens.join(' · ')}`);
    console.log(`  이름표 ${parsed.manualFields?.length ?? 0}개 그대로`);

    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT 1 FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1`, [NAME]);
    if (rows.length) problems.push(`이미 있는 이름: ${NAME}`);
    if (problems.length) throw new Error(problems.join(' / '));
    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 1건. 쓰려면 --apply');
      return;
    }
    await c.query(
      `INSERT INTO public.tb_s080_form_templates
         (id, operator_id, name, description, kind, definition, created_at, updated_at, created_by, updated_by)
       VALUES ($1, 1, $2, $3, 'T', $4::jsonb, now(), now(), 'oneoff-2026-10-31', 'oneoff-2026-10-31')`,
      [randomUUID(), NAME, `법인설립(유한회사) — 표양식 「${FROM_NAME}」 복사, 「${FROM_WORD}」→「${TO_WORD}」(2026-10-31)`, JSON.stringify(parsed)],
    );
    await c.query('COMMIT');
    console.log('\n썼습니다 — 1건');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
