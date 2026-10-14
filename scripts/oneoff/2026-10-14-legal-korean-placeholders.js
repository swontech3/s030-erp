/**
 * 일회용(2026-10-14) — 법무 양식의 한글 자리표시 8종을 정리한다(A).
 *
 * 사용자 결정(2026-10-14):
 *   · 주주 서면결의서     {{결의일}} → {{resolutionDate}}
 *   · 발기인총회의사록    {{대표이사}} → {{ceoName}}(2곳) · {{주주명수}} → {{founderCount}}(2곳) ·
 *                         {{이사구성}} → {{officerComposition}} · 개회 시각 자리 → {{meetingTime}} ·
 *                         「{{폐회시간}} 시」 → {{closingTime}} (시각 값이 「10시 30분」 모양이라 뒤의 「시」는 지운다)
 *   · 주식발행사항동의서  {{주식의 종류}} → 「보통주식」 고정 글자
 *   · 조사보고서          {{주거래은행}} → {{paymentBank}}
 *   · 주식인수증          「5. 납입기관 및 장소 :」 뒤에 {{paymentBank}}
 *   · 사임서              {{사임사유}} → {{officerResignReason}}
 *   · 새로 쓰는 자리표시의 이름표(manualFields)를 그 양식에 더한다(이미 있으면 그대로)
 *
 * ★ 칸 글자는 아래 표의 바꿀 글자만 바꾼다. 칸 위치 · 다른 글자 · 법무 표시는 건드리지 않는다.
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 양식마다 정확히 1건 · 법무 표시가 있고 · 칸의 지금 글자에 바꿀 글자가 있어야 한다 — 하나라도 어긋나면
 *   아무것도 쓰지 않고 멈춘다(두 번 돌리면 「이미 바뀜」으로 멈춘다).
 *
 *   node scripts/oneoff/2026-10-14-legal-korean-placeholders.js .env            (보기)
 *   node scripts/oneoff/2026-10-14-legal-korean-placeholders.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-14-legal-korean-placeholders.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

/** 이름표 — shared `INCORP_PRINT_FIELDS` · `CORP_CHANGE_PRINT_FIELDS` 의 label 과 같다. */
const LABEL = {
  resolutionDate: '결의일',
  ceoName: '대표이사 성명',
  founderCount: '발기인 수',
  officerComposition: '이사 구성(사내이사 n명, 감사 n명)',
  meetingTime: '개회시간',
  closingTime: '폐회시간(개회 + 30분)',
  paymentBank: '납입은행(지점)',
  officerResignReason: '사임사유',
};

/**
 * 양식마다 바꿀 칸. `row` · `col` 은 1쪽(pages[0])의 칸.
 *   from/to — 칸 글자 안의 그 글자를 바꾼다(`count` 번 있어야 한다, 기본 1)
 *   append  — 칸 글자 끝 공백을 떼고 그 뒤에 붙인다(`expect` 와 같아야 한다)
 */
const PLAN = [
  {
    name: '주주 서면결의서',
    domain: 'corp-change',
    cells: [{ row: 13, col: 0, from: '{{결의일}}', to: '{{resolutionDate}}' }],
    fields: ['resolutionDate'],
  },
  {
    name: '발기인총회의사록',
    domain: 'incorporation',
    cells: [
      { row: 3, col: 0, from: '{{meetingDate}} 시 ', to: '{{meetingDate}} {{meetingTime}} ' },
      { row: 6, col: 1, from: '{{주주명수}}', to: '{{founderCount}}' },
      { row: 7, col: 1, from: '{{주주명수}}', to: '{{founderCount}}' },
      { row: 10, col: 0, from: '{{대표이사}}', to: '{{ceoName}}' },
      { row: 19, col: 0, from: '{{이사구성}}', to: '{{officerComposition}}' },
      { row: 43, col: 0, from: '{{폐회시간}} 시)', to: '{{closingTime}})' },
      { row: 50, col: 0, from: '{{대표이사}}', to: '{{ceoName}}' },
    ],
    fields: ['ceoName', 'founderCount', 'officerComposition', 'meetingTime', 'closingTime'],
  },
  {
    name: '주식발행사항동의서',
    domain: 'incorporation',
    cells: [{ row: 7, col: 2, from: '{{주식의 종류}}', to: '보통주식' }],
    fields: [],
  },
  {
    name: '조사보고서',
    domain: 'incorporation',
    cells: [{ row: 12, col: 0, from: '{{주거래은행}}', to: '{{paymentBank}}' }],
    fields: ['paymentBank'],
  },
  {
    name: '주식인수증',
    domain: 'incorporation',
    cells: [{ row: 11, col: 0, expect: '5. 납입기관 및 장소 :', append: ' {{paymentBank}}' }],
    fields: ['paymentBank'],
  },
  {
    name: '사임서',
    domain: 'corp-change',
    cells: [{ row: 9, col: 0, from: '{{사임사유}}', to: '{{officerResignReason}}' }],
    fields: ['officerResignReason'],
  },
];

const countOf = (s, sub) => s.split(sub).length - 1;
const show = (s) => JSON.stringify(s.length > 120 ? `${s.slice(0, 117)}…` : s);

/** 바꿀 글자 주변만 보여 준다(긴 문단). */
function around(text, at, len) {
  const from = Math.max(0, at - 20);
  const to = Math.min(text.length, at + len + 20);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query('BEGIN');
  try {
    const updates = [];
    for (const p of PLAN) {
      const { rows } = await c.query(
        `SELECT id, definition FROM public.tb_s080_form_templates WHERE operator_id = 1 AND name = $1 FOR UPDATE`,
        [p.name],
      );
      if (rows.length !== 1) throw new Error(`「${p.name}」 이 ${rows.length}건입니다 — 1건이어야 합니다`);
      const { id, definition } = rows[0];
      if (definition.legal?.domain !== p.domain) {
        throw new Error(`「${p.name}」 의 법무 표시가 ${JSON.stringify(definition.legal ?? null)} 입니다 — ${p.domain} 이어야 합니다`);
      }
      const next = structuredClone(definition);
      const page = next.pages?.[0];
      if (!page) throw new Error(`「${p.name}」 에 1쪽이 없습니다`);

      console.log(`■ ${p.name} (${id})`);
      for (const spec of p.cells) {
        const hits = page.cells.filter((cl) => cl.row === spec.row && cl.col === spec.col);
        if (hits.length !== 1) throw new Error(`「${p.name}」 r${spec.row} c${spec.col} 칸이 ${hits.length}개입니다`);
        const cell = hits[0];
        const before = cell.text ?? '';
        let after;
        if (spec.append) {
          if (before.trimEnd() !== spec.expect) {
            throw new Error(`「${p.name}」 r${spec.row} c${spec.col} 글자가 ${show(before)} 입니다 — ${show(spec.expect)} 여야 합니다(이미 바뀜?)`);
          }
          after = spec.expect + spec.append;
          console.log(`  r${spec.row} c${spec.col}  ${show(before)}`);
          console.log(`         → ${show(after)}`);
        } else {
          const n = countOf(before, spec.from);
          const want = spec.count ?? 1;
          if (n !== want) {
            throw new Error(`「${p.name}」 r${spec.row} c${spec.col} 에 ${show(spec.from)} 가 ${n}번 있습니다 — ${want}번이어야 합니다(이미 바뀜?)`);
          }
          after = before.split(spec.from).join(spec.to);
          const at = before.indexOf(spec.from);
          console.log(`  r${spec.row} c${spec.col}  ${show(around(before, at, spec.from.length))}`);
          console.log(`         → ${show(around(after, at, spec.to.length))}`);
        }
        cell.text = after;
      }

      const manual = Array.isArray(next.manualFields) ? next.manualFields : [];
      const added = p.fields.filter((f) => !manual.some((m) => m.name === f));
      next.manualFields = [...manual, ...added.map((f) => ({ name: f, label: LABEL[f] }))];
      const kept = p.fields.filter((f) => !added.includes(f));
      console.log(`  이름표 더함: ${added.length ? added.map((f) => `${f}(${LABEL[f]})`).join(' · ') : '없음'}${kept.length ? ` · 이미 있음: ${kept.join(' · ')}` : ''}`);
      updates.push({ id, next });
    }

    // 바꾼 뒤 법무 양식에 한글 자리표시가 남았는지 — 이 스크립트가 맡은 8종이 다 빠졌는지 본다
    const left = [];
    for (const u of updates) {
      for (const pg of u.next.pages) for (const cl of pg.cells) {
        for (const m of (cl.text ?? '').matchAll(/\{\{([^}]*?)\}\}/g)) if (/[가-힣]/.test(m[1])) left.push(m[0]);
      }
    }
    if (left.length) throw new Error(`바꾼 뒤에도 한글 자리표시가 남습니다: ${left.join(' · ')}`);
    console.log(`\n바꾼 뒤 이 양식들의 한글 자리표시: 0개 · 양식 ${updates.length}건`);

    if (!APPLY) {
      await c.query('ROLLBACK');
      console.log('\n보기만 했습니다 — 쓰려면 --apply');
      return;
    }
    for (const u of updates) {
      await c.query(
        `UPDATE public.tb_s080_form_templates SET definition = $2::jsonb, updated_at = now(), updated_by = 'oneoff-2026-10-14' WHERE id = $1`,
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
