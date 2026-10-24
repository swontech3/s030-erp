/**
 * 일회용(2026-10-22) — 인허가 기준표(049) 규칙 11개를 「검토됨」으로.
 *
 * 사용자 결정(2026-10-22):
 *   · 검토됨으로 바꿀 규칙 — 통신판매업 신고 / 일반음식점 · 휴게음식점 · 제과점 영업 신고 / 식품제조ㆍ가공업 등록 /
 *     미용업 · 이용업 · 숙박업 · 세탁업 신고 / 미용 · 이용 면허(아래 RULE_IDS). 나머지는 「확인 필요」 그대로
 *   · 검토자 「대표 최현수」, 검토한 때는 적용(--apply) 시각
 *   · 그 규칙들의 근거 조문 해시(body_hash_at_review)는 지금 048 조문 값으로 맞춘다
 *
 * ★ 하나라도 어긋나면(규칙이 없음 · 사용 안 함 · 이미 검토됨 · 구분이 비었음, 근거 조문이 없음 · 사용 안 함 · 삭제 조)
 *   아무것도 쓰지 않고 멈춘다(두 번 돌리면 「이미 검토됨」으로 멈춘다).
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 *
 *   node scripts/oneoff/2026-10-22-license-rule-reviewed.js .env            (보기)
 *   node scripts/oneoff/2026-10-22-license-rule-reviewed.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-22-license-rule-reviewed.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const RULE_IDS = [
  'ecom_mail_order',
  'food_restaurant', 'food_cafe', 'food_bakery',
  'food_manufacture',
  'beauty', 'barber', 'lodging', 'laundry',
  'beauty_license', 'barber_license',
];
const REVIEWER = '대표 최현수';

const artLabel = (a) => `제${a.article_no}조${a.branch_no ? `의${a.branch_no}` : ''}${a.part ? ` ${a.part}` : ''}`;

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const rules = new Map((await c.query(
      `SELECT rule_id, name_easy, license_kind, license_name, review_status, active
         FROM public.tb_s080_license_rule WHERE rule_id = ANY($1) ${APPLY ? 'FOR UPDATE' : ''}`, [RULE_IDS],
    )).rows.map((r) => [r.rule_id, r]));
    const basis = (await c.query(
      `SELECT b.rule_id, b.law_id, b.article_no, b.branch_no, b.part, b.body_hash_at_review, b.active,
              a.body_hash, a.active AS art_active, a.is_deleted, a.title, l.law_name
         FROM public.tb_s080_license_rule_basis b
         JOIN public.tb_s080_law_article a USING (law_id, article_no, branch_no)
         JOIN public.tb_s080_law l USING (law_id)
        WHERE b.rule_id = ANY($1) ORDER BY b.rule_id, b.law_id, b.article_no, b.branch_no`, [RULE_IDS],
    )).rows;
    const codes = new Map((await c.query(
      `SELECT rule_id, count(*)::int AS n FROM public.tb_s080_license_rule_biz_code
        WHERE rule_id = ANY($1) AND active GROUP BY rule_id`, [RULE_IDS],
    )).rows.map((r) => [r.rule_id, r.n]));

    const bad = [];
    let nBasis = 0, nHash = 0, nCodes = 0;
    for (const id of RULE_IDS) {
      const r = rules.get(id);
      if (!r) { bad.push(`${id}: 규칙이 없습니다`); continue; }
      if (!r.active) bad.push(`${id}: 사용 안 함입니다`);
      if (r.review_status !== '확인 필요') bad.push(`${id}: 이미 「${r.review_status}」입니다`);
      if (!r.license_kind) bad.push(`${id}: 구분이 비었습니다(근거 못 찾음)`);
      const bs = basis.filter((x) => x.rule_id === id && x.active);
      if (!bs.length) bad.push(`${id}: 사용 중 근거 조문이 없습니다`);
      console.log(`\n■ ${id} — ${r.name_easy} · ${r.license_kind ?? '(비었음)'}${r.license_name ? ` · ${r.license_name}` : ''}  ${r.review_status} → 검토됨`);
      for (const x of bs) {
        if (!x.art_active || x.is_deleted) bad.push(`${id}: ${x.law_name} ${artLabel(x)} 가 사용 안 함 · 삭제 조입니다`);
        const same = x.body_hash_at_review === x.body_hash;
        if (!same) nHash++;
        console.log(`  근거: ${x.law_name} ${artLabel(x)}(${x.title || '제목 없음'}) — 해시 ${same ? '그대로' : `바뀜 ${x.body_hash_at_review.slice(0, 8)} → ${x.body_hash.slice(0, 8)}`}`);
      }
      nBasis += bs.length;
      nCodes += codes.get(id) || 0;
      console.log(`  업종코드 연결: ${codes.get(id) || 0}`);
    }
    if (bad.length) throw new Error(`어긋남 ${bad.length} — 아무것도 쓰지 않았습니다\n  ${bad.join('\n  ')}`);

    const { rows: [rest] } = await c.query(
      "SELECT count(*)::int AS n FROM public.tb_s080_license_rule WHERE NOT (rule_id = ANY($1))", [RULE_IDS],
    );
    console.log(`\n합계 — 검토됨으로 ${RULE_IDS.length}규칙 · 근거 조문 ${nBasis}(해시 바뀜 ${nHash}) · 업종코드 연결 ${nCodes} · 검토자 「${REVIEWER}」`);
    console.log(`그대로(확인 필요) ${rest.n}규칙`);

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    const now = new Date();
    const u1 = await c.query(
      `UPDATE public.tb_s080_license_rule SET review_status = '검토됨', reviewed_at = $2, reviewed_by = $3
        WHERE rule_id = ANY($1) AND review_status = '확인 필요'`, [RULE_IDS, now, REVIEWER],
    );
    const u2 = await c.query(
      `UPDATE public.tb_s080_license_rule_basis b SET body_hash_at_review = a.body_hash
         FROM public.tb_s080_law_article a
        WHERE b.rule_id = ANY($1) AND b.active
          AND a.law_id = b.law_id AND a.article_no = b.article_no AND a.branch_no = b.branch_no`, [RULE_IDS],
    );
    if (u1.rowCount !== RULE_IDS.length || u2.rowCount !== nBasis) {
      throw new Error(`바뀐 줄 수가 다릅니다(규칙 ${u1.rowCount}/${RULE_IDS.length} · 근거 ${u2.rowCount}/${nBasis}) — 되돌렸습니다`);
    }
    await c.query('COMMIT');
    console.log(`✔ 썼습니다 — 검토됨 ${u1.rowCount}규칙 · 근거 해시 ${u2.rowCount}줄 (${now.toISOString()})`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
