/**
 * 일회용(2026-11-01) — 법무 1단계 마무리: 인허가 기준표(049) `food_instant` 「검토됨」 + 바꿔 부르는 말(`BIZ_ALIAS`) 늘리기.
 *
 * 사용자 결정(2026-11-01):
 *   A · `food_instant`(즉석판매 제조 · 즉석판매제조ㆍ가공업 신고)만 「검토됨」 — 근거 조문 셋을 기록한다:
 *       식품위생법 제37조 제4항(신고) · 식품위생법 시행령 제21조 제2호(정의) · 시행령 제25조 제1항제2호(신고 대상, 이미 있음).
 *       업종코드 연결은 0 그대로(총리령이 없다). 나머지 「확인 필요」 6개는 그대로.
 *       검토자 「대표 최현수」(2026-10-22 와 같다), 검토한 때는 적용 시각. 근거 해시는 지금 048 조문 값
 *   B · `BIZ_ALIAS`/`000` 에 줄을 더한다 — 설계 보고 21줄에서 「무역」(519111)을 뺀 20줄. 같은 종목 이름의 업종코드가
 *       여럿이면(★) 모두에 같은 말을 붙인다 → 28줄. 모양은 2026-10-22 시드와 같다(값 `cl_1_BIZ_ALIAS_<업종코드>`,
 *       건물 `1`, `is_system = false`, 사용 중, 순서 = 그 파티션의 가장 큰 순서 + 1부터 아래 순서대로)
 *
 * ★ 멈추는 경우(아무것도 쓰지 않는다):
 *   A — 규칙이 없음 · 사용 안 함 · 이미 검토됨 · 구분이 비었음 · 근거 조문이 048 에 없음 · 사용 안 함 · 삭제 조 ·
 *       더할 근거 줄이 이미 있음
 *   B — 분류 머리 · 파티션이 1건씩이 아님 · 업종코드가 047 에 없거나 사용 안 함 · 그 코드 줄이 이미 있음 ·
 *       종목 이름이 기대와 다름 · 말이 이미 있는 줄의 말과 겹침 · 말에 「,」가 있음
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션).
 * ★ 접속 값은 환경 폴더의 admin.env 다. 값은 출력하지 않는다.
 *
 *   node scripts/oneoff/2026-11-01-license-instant-alias.js <admin.env>            (보기)
 *   node scripts/oneoff/2026-11-01-license-instant-alias.js <admin.env> --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-11-01-license-instant-alias.js <admin.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

// A
const RULE_ID = 'food_instant';
const REVIEWER = '대표 최현수';
/** 근거 — [법령명, 조, 의, 항·호]. 있어야 하는 것(keep)과 더할 것(add). */
const BASIS_KEEP = [['식품위생법 시행령', 25, 0, '제1항제2호']];
const BASIS_ADD = [['식품위생법', 37, 0, '제4항'], ['식품위생법 시행령', 21, 0, '제2호']];

// B
const BUILD_ID = '1';
const CATEGORY = 'BIZ_ALIAS';
const USE_TP = '000';
/** [업종코드들(같은 종목 이름), 기대 종목 이름, 바꿔 부르는 말] — 설계 보고 순서(10번 「무역」 뺌). */
const GROUPS = [
  [['809004', '809005', '809012'], '일반 교과학원', '학원, 보습학원, 입시학원'],
  [['809017'], '외국어학원', '영어학원, 어학원'],
  [['809018'], '기타 교습학원', '교습소'],
  [['809016'], '온라인 교육학원', '온라인 강의, 인강'],
  [['523987', '523988'], '화초 및 식물 소매업', '꽃집, 화원, 플라워샵'],
  [['749914'], '인테리어 디자인업', '인테리어, 인테리어 디자인'],
  [['452105', '452106', '452107'], '도배, 실내 장식 및 내장 목공사업', '인테리어 시공, 도배'],
  [['702001'], '부동산 분양 대행업, 부동산 중개 및 대리업', '부동산, 부동산 중개, 공인중개사'],
  [['924305'], '체력 단련시설 운영업', '헬스장, 피트니스, 헬스클럽'],
  [['659901', '749609', '749921'], '온라인 활용 마케팅 및 관련 사업지원 서비스업, 그 외 기타 분류 안된 사업 지원 서비스업', '온라인 마케팅, 바이럴 마케팅, SNS 마케팅'],
  [['743002'], '광고 대행업', '광고대행, 광고 대행사'],
  [['749910'], '시각 디자인업', '그래픽 디자인, 로고 디자인, 편집 디자인'],
  [['749902'], '번역 및 통역 서비스업', '번역, 통역'],
  [['749400', '930904'], '인물 사진 및 행사용 영상 촬영업', '사진관, 프로필 사진'],
  [['630600'], '여행사업', '여행사'],
  [['940306'], '1인미디어콘텐츠창작자', '유튜버, 크리에이터, 1인 방송'],
  [['741201'], '세무사업', '세무사, 세무사무소'],
  [['741107'], '법무사업', '법무사, 법무사 사무소'],
  [['523996'], '반려용동물 및 관련용품 소매업', '펫샵, 애견용품'],
  [['749300'], '건축물 일반 청소업', '청소업체, 입주청소, 사무실 청소'],
];
const words = (name) => name.split(',').map((w) => w.trim()).filter(Boolean);

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const bad = [];

    // ---------------------------------------------------------------- A
    const { rows: [rule] } = await c.query(
      `SELECT rule_id, name_easy, license_kind, license_name, review_status, active FROM public.tb_s080_license_rule WHERE rule_id = $1 ${APPLY ? 'FOR UPDATE' : ''}`,
      [RULE_ID],
    );
    if (!rule) bad.push(`${RULE_ID}: 규칙이 없습니다`);
    else {
      if (!rule.active) bad.push(`${RULE_ID}: 사용 안 함입니다`);
      if (rule.review_status !== '확인 필요') bad.push(`${RULE_ID}: 이미 「${rule.review_status}」입니다`);
      if (!rule.license_kind) bad.push(`${RULE_ID}: 구분이 비었습니다`);
    }
    const art = async ([law, no, br, part]) => {
      const { rows: [a] } = await c.query(
        `SELECT a.law_id, a.title, a.body_hash, a.active, a.is_deleted FROM public.tb_s080_law_article a JOIN public.tb_s080_law l USING (law_id)
          WHERE l.law_name = $1 AND a.article_no = $2 AND a.branch_no = $3`,
        [law, no, br],
      );
      if (!a) { bad.push(`${law} 제${no}조 가 048 에 없습니다`); return null; }
      if (!a.active || a.is_deleted) bad.push(`${law} 제${no}조 가 사용 안 함 · 삭제 조입니다`);
      return { ...a, law, no, br, part };
    };
    const keep = [];
    for (const b of BASIS_KEEP) {
      const a = await art(b);
      if (!a) continue;
      const { rows } = await c.query(
        `SELECT part, active FROM public.tb_s080_license_rule_basis WHERE rule_id = $1 AND law_id = $2 AND article_no = $3 AND branch_no = $4`,
        [RULE_ID, a.law_id, a.no, a.br],
      );
      if (!rows.length || !rows[0].active || rows[0].part !== a.part) bad.push(`${RULE_ID}: 근거 ${a.law} 제${a.no}조 ${a.part} 가 지금 기록과 다릅니다`);
      keep.push(a);
    }
    const add = [];
    for (const b of BASIS_ADD) {
      const a = await art(b);
      if (!a) continue;
      const { rows } = await c.query(
        `SELECT 1 FROM public.tb_s080_license_rule_basis WHERE rule_id = $1 AND law_id = $2 AND article_no = $3 AND branch_no = $4`,
        [RULE_ID, a.law_id, a.no, a.br],
      );
      if (rows.length) bad.push(`${RULE_ID}: 근거 ${a.law} 제${a.no}조 줄이 이미 있습니다`);
      add.push(a);
    }
    const { rows: [codeN] } = await c.query(`SELECT count(*)::int AS n FROM public.tb_s080_license_rule_biz_code WHERE rule_id = $1 AND active`, [RULE_ID]);
    console.log(`■ A — ${RULE_ID} ${rule ? `${rule.name_easy} · ${rule.license_kind} · ${rule.license_name}` : ''}  ${rule?.review_status} → 검토됨(검토자 「${REVIEWER}」)`);
    for (const a of keep) console.log(`  근거(있음 · 해시 맞춤): ${a.law} 제${a.no}조 ${a.part} (${a.title})`);
    for (const a of add) console.log(`  근거(더함): ${a.law} 제${a.no}조 ${a.part} (${a.title})`);
    console.log(`  업종코드 연결: ${codeN.n}(그대로)`);
    const { rows: rest } = await c.query(`SELECT rule_id FROM public.tb_s080_license_rule WHERE review_status = '확인 필요' AND rule_id <> $1 ORDER BY rule_id`, [RULE_ID]);
    console.log(`  그대로(확인 필요) ${rest.length}: ${rest.map((r) => r.rule_id).join(' · ')}`);

    // ---------------------------------------------------------------- B
    const { rows: [have] } = await c.query(
      `SELECT (SELECT count(*) FROM public.tb_s080_code_masters WHERE category = $1)::int AS m,
              (SELECT count(*) FROM public.tb_s080_code_categories WHERE category = $1 AND use_tp = $2)::int AS p,
              (SELECT coalesce(max(sort_order), 0) FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2)::int AS max_sort`,
      [CATEGORY, USE_TP],
    );
    if (have.m !== 1 || have.p !== 1) bad.push(`분류 ${CATEGORY} 머리 ${have.m} · 파티션 ${have.p}(1건씩이어야 한다)`);
    const { rows: existing } = await c.query(`SELECT code, name FROM public.tb_s080_codes_line WHERE category = $1 AND use_tp = $2`, [CATEGORY, USE_TP]);
    const usedWords = new Map();
    for (const e of existing) for (const w of words(e.name)) usedWords.set(w, e.code);
    const lines = [];
    const newWords = new Map();
    for (const [codes, expectName, name] of GROUPS) {
      if (name.split(',').some((w) => !w.trim())) bad.push(`${name}: 빈 말이 있습니다`);
      for (const w of words(name)) {
        if (usedWords.has(w)) bad.push(`말 「${w}」 이 이미 있는 줄(${usedWords.get(w)})과 겹칩니다`);
        if (newWords.has(w) && newWords.get(w) !== name) bad.push(`말 「${w}」 이 새 줄끼리 겹칩니다`);
        newWords.set(w, name);
      }
      for (const code of codes) {
        const { rows: [d] } = await c.query(`SELECT item_name, active FROM public.tb_s080_biz_code WHERE biz_code = $1`, [code]);
        if (!d || !d.active) bad.push(`업종코드 ${code} 가 047 에 없거나 사용 안 함입니다`);
        else if (d.item_name !== expectName) bad.push(`업종코드 ${code} 의 종목이 「${d.item_name}」 입니다(「${expectName}」 이어야 한다)`);
        if (existing.some((e) => e.code === code)) bad.push(`${CATEGORY}/${code} 줄이 이미 있습니다`);
        lines.push({ code, name, item: d?.item_name ?? '' });
      }
    }
    console.log(`\n■ B — ${CATEGORY}/${USE_TP} 지금 ${existing.length}줄 → 더할 ${lines.length}줄(무리 ${GROUPS.length} · 말 ${newWords.size})`);
    lines.forEach((l, i) => console.log(`  ${have.max_sort + 1 + i}. ${l.code} [${l.item.length > 30 ? `${l.item.slice(0, 30)}…` : l.item}] = ${l.name}`));

    if (bad.length) throw new Error(`어긋남 ${bad.length} — 아무것도 쓰지 않았습니다\n  ${bad.join('\n  ')}`);
    if (!APPLY) { console.log('\n보기만 했습니다 — A 1규칙(근거 더함 2 · 해시 맞춤 3) · B 28줄. 쓰려면 --apply.'); await c.query('ROLLBACK'); return; }

    const now = new Date();
    for (const a of add) {
      await c.query(
        `INSERT INTO public.tb_s080_license_rule_basis (rule_id, law_id, article_no, branch_no, part, body_hash_at_review, loaded_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [RULE_ID, a.law_id, a.no, a.br, a.part, a.body_hash, now],
      );
    }
    const u1 = await c.query(
      `UPDATE public.tb_s080_license_rule SET review_status = '검토됨', reviewed_at = $2, reviewed_by = $3 WHERE rule_id = $1 AND review_status = '확인 필요'`,
      [RULE_ID, now, REVIEWER],
    );
    const u2 = await c.query(
      `UPDATE public.tb_s080_license_rule_basis b SET body_hash_at_review = a.body_hash
         FROM public.tb_s080_law_article a
        WHERE b.rule_id = $1 AND b.active AND a.law_id = b.law_id AND a.article_no = b.article_no AND a.branch_no = b.branch_no`,
      [RULE_ID],
    );
    if (u1.rowCount !== 1 || u2.rowCount !== keep.length + add.length) throw new Error(`바뀐 줄 수가 다릅니다(규칙 ${u1.rowCount}/1 · 근거 ${u2.rowCount}/${keep.length + add.length}) — 되돌렸습니다`);
    let sort = have.max_sort;
    for (const l of lines) {
      sort += 1;
      await c.query(
        `INSERT INTO public.tb_s080_codes_line
           (line_id, build_id, category, use_tp, code, name, description, sort_order, is_active, is_system, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, true, false, CURRENT_TIMESTAMP)`,
        [`cl_${BUILD_ID}_${CATEGORY}_${l.code}`, BUILD_ID, CATEGORY, USE_TP, l.code, l.name, sort],
      );
    }
    await c.query('COMMIT');
    console.log(`\n✔ 썼습니다 — A ${RULE_ID} 검토됨 · 근거 더함 ${add.length} · 해시 ${u2.rowCount}줄 · B ${lines.length}줄 (${now.toISOString()})`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
