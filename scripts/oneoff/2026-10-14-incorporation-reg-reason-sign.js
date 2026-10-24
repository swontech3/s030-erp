/**
 * 일회용(2026-10-14) — 법인설립 서류 고침.
 *
 * 사용자 결정(2026-10-14):
 *   ① 등기 설정(법인설립 · 발기설립 R_PROMOTER 줄)의 등기의 사유(reg_reason)에 고정 문구
 *      「발기설립의 절차를 마쳤으므로 다음 사항의 등기를 구함」을 채운다
 *   ② 설립등기신청서 3쪽 서명란(대표이사 줄)의 「(전화 :   )」에 {{ceoPhone}} 을 넣는다
 *   ③ 취임승낙서(설립) 서명란 「취임승낙인 :」 뒤에 {{personName}} 을 넣는다
 *   · 새로 쓰는 자리표시의 이름표(manualFields)를 그 양식에 더한다(이미 있으면 그대로) —
 *     설립등기신청서: ceoPhone · attachments1 · attachments2(양식이 이미 쓰는데 이름표가 없다)
 *     취임승낙서(설립): personName
 *
 * ★ 바꿀 글자만 바꾼다. 칸 위치 · 다른 글자 · 법무 표시 · 등기 설정의 다른 칸은 건드리지 않는다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 하나라도 어긋나면(줄 · 양식이 정확히 1건이 아님, 사유가 이미 차 있음, 칸 글자가 다름) 아무것도
 *   쓰지 않고 멈춘다(두 번 돌리면 「이미 바뀜」으로 멈춘다).
 *
 *   node scripts/oneoff/2026-10-14-incorporation-reg-reason-sign.js .env            (보기)
 *   node scripts/oneoff/2026-10-14-incorporation-reg-reason-sign.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-14-incorporation-reg-reason-sign.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const REG_REASON = '발기설립의 절차를 마쳤으므로 다음 사항의 등기를 구함';

/** 이름표 — shared `INCORP_PRINT_FIELDS` 의 label 과 같다. */
const LABEL = {
  ceoPhone: '대표이사 전화',
  attachments1: '첨부서면(앞 절반)',
  attachments2: '첨부서면(뒤 절반)',
  personName: '성명',
};

/**
 * 양식마다 바꿀 칸. `page` 는 0부터.
 *   pattern/to — 칸 글자 안에서 pattern 에 맞는 곳(정확히 1곳)을 to 로
 *   expect/append — 칸 글자(끝 공백 뗀 것)가 expect 와 같을 때 뒤에 붙인다
 */
const PLAN = [
  {
    name: '설립등기신청서',
    cells: [{ page: 2, row: 10, col: 0, pattern: /\(전화 :\s*\)/g, to: '(전화 : {{ceoPhone}})' }],
    fields: ['ceoPhone', 'attachments1', 'attachments2'],
  },
  {
    name: '취임승낙서(설립)',
    cells: [{ page: 0, row: 8, col: 2, expect: '취임승낙인 :', append: ' {{personName}}' }],
    fields: ['personName'],
  },
];

const show = (s) => JSON.stringify(s.length > 120 ? `${s.slice(0, 117)}…` : s);

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query('BEGIN');
  try {
    // ① 등기 설정 — 등기의 사유
    const { rows: settings } = await c.query(
      `SELECT id, company_type, reg_reason FROM public.tb_s080_doc_form_settings
        WHERE operator_id = 1 AND domain = 'incorporation' AND reg_type_key = 'R_PROMOTER' FOR UPDATE`,
    );
    if (settings.length !== 1) throw new Error(`발기설립 등기 설정 줄이 ${settings.length}건입니다 — 1건이어야 합니다`);
    const setting = settings[0];
    if (setting.reg_reason !== null && setting.reg_reason.trim() !== '') {
      throw new Error(`등기의 사유가 이미 ${show(setting.reg_reason)} 입니다 — 손대지 않습니다`);
    }
    console.log(`■ 등기 설정 발기설립(R_PROMOTER, 회사유형 ${JSON.stringify(setting.company_type)}, ${setting.id})`);
    console.log(`  등기의 사유  ${JSON.stringify(setting.reg_reason)}`);
    console.log(`            → ${JSON.stringify(REG_REASON)}`);

    // ② · ③ 양식
    const updates = [];
    for (const p of PLAN) {
      const { rows } = await c.query(
        `SELECT id, definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1 FOR UPDATE`,
        [p.name],
      );
      if (rows.length !== 1) throw new Error(`「${p.name}」 이 ${rows.length}건입니다 — 1건이어야 합니다`);
      const { id, definition } = rows[0];
      if (definition.legal?.domain !== 'incorporation') {
        throw new Error(`「${p.name}」 의 법무 표시가 ${JSON.stringify(definition.legal ?? null)} 입니다 — incorporation 이어야 합니다`);
      }
      const next = structuredClone(definition);
      console.log(`■ ${p.name} (${id})`);
      for (const spec of p.cells) {
        const page = next.pages?.[spec.page];
        if (!page) throw new Error(`「${p.name}」 에 ${spec.page + 1}쪽이 없습니다`);
        const hits = page.cells.filter((cl) => cl.row === spec.row && cl.col === spec.col);
        if (hits.length !== 1) throw new Error(`「${p.name}」 ${spec.page + 1}쪽 r${spec.row} c${spec.col} 칸이 ${hits.length}개입니다`);
        const cell = hits[0];
        const before = cell.text ?? '';
        let after;
        if (spec.append) {
          if (before.trimEnd() !== spec.expect) {
            throw new Error(`「${p.name}」 r${spec.row} c${spec.col} 글자가 ${show(before)} 입니다 — ${show(spec.expect)} 여야 합니다(이미 바뀜?)`);
          }
          after = spec.expect + spec.append;
        } else {
          const n = [...before.matchAll(spec.pattern)].length;
          if (n !== 1) throw new Error(`「${p.name}」 r${spec.row} c${spec.col} 에 ${spec.pattern} 가 ${n}번 있습니다 — 1번이어야 합니다(이미 바뀜?)`);
          after = before.replace(spec.pattern, spec.to);
        }
        console.log(`  ${spec.page + 1}쪽 r${spec.row} c${spec.col}  ${show(before)}`);
        console.log(`             → ${show(after)}`);
        cell.text = after;
      }
      const manual = Array.isArray(next.manualFields) ? next.manualFields : [];
      const added = p.fields.filter((f) => !manual.some((m) => m.name === f));
      next.manualFields = [...manual, ...added.map((f) => ({ name: f, label: LABEL[f] }))];
      const kept = p.fields.filter((f) => !added.includes(f));
      console.log(`  이름표 더함: ${added.length ? added.map((f) => `${f}(${LABEL[f]})`).join(' · ') : '없음'}${kept.length ? ` · 이미 있음: ${kept.join(' · ')}` : ''}`);
      updates.push({ id, next });
    }

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 쓰려면 --apply');
      return;
    }
    await c.query(
      `UPDATE public.tb_s080_doc_form_settings SET reg_reason = $2, updated_at = now(), updated_by = 'oneoff-2026-10-14' WHERE id = $1`,
      [setting.id, REG_REASON],
    );
    for (const u of updates) {
      await c.query(
        `UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = 'oneoff-2026-10-14' WHERE id = $1`,
        [u.id, JSON.stringify(u.next)],
      );
    }
    await c.query('COMMIT');
    console.log(`\n썼습니다 — 등기 설정 1줄 · 양식 ${updates.length}건`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(`\n멈춤 — ${e.message} (아무것도 쓰지 않았습니다)`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
