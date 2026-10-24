/**
 * 일회용(2026-10-22) — 인허가 기준표 첫 적재(049 의 세 표).
 *
 * 원본: 2026-10-22 보고한 초안(저장된 법령 원문 048 · 업종 사전 047 에서 찾은 것). 아래 RULES 가 그 초안이다.
 * 사용자 결정(2026-10-22):
 *   · 초안 전부를 「확인 필요」로 넣는다. 검토 상태는 일회용 스크립트로만 바꾼다
 *   · 미용업 · 이용업에 「면허」 줄을 더한다(공중위생관리법 제6조 · 제8조제1항)
 *   · 소프트웨어 · 컨설팅은 「없음」, 예외 칸 「별도 신고 · 허가 없음(일반 사업자등록만)」
 *   · 통신판매업 신고는 예외 칸에 제12조 단서(공정위 고시 기준 이하 면제)
 *   · 근거를 못 찾은 업종(건강기능식품 · 호텔 · 숙박공유)은 근거 조문 없이, 구분도 비우고(NULL) 넣는다
 *   · 업종코드는 보고에 적은 후보만 잇는다(「등」으로 줄인 나머지는 잇지 않는다)
 *
 * ★ 근거 조문은 048 에 있고 사용 중(active) · 삭제 조가 아니어야 한다. 업종코드는 047 에 있고 사용 중이어야 한다.
 *   하나라도 어긋나면 아무것도 쓰지 않고 멈춘다.
 * ★ 근거마다 지금 048 조문의 body_hash 를 body_hash_at_review 로 넣는다.
 * ★ 첫 적재만 한다 — 규칙 표에 이미 줄이 있으면 --apply 는 멈춘다(다시 적재 · 검토 상태 변경은 이 스크립트가 아니다).
 * ★ 기본은 **보기만** 한다(읽기 전용 트랜잭션). `--apply` 일 때만 쓴다(한 트랜잭션). 049 를 먼저 적용해야 --apply 가 돈다
 *   (보기는 049 가 없어도 돈다).
 *
 *   node scripts/oneoff/2026-10-22-license-rule.js .env            (보기)
 *   node scripts/oneoff/2026-10-22-license-rule.js .env --apply    (쓰기)
 */
const fs = require('fs');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-22-license-rule.js <.env> [--apply]');
  process.exit(2);
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

// 법령 ID(048)
const ECOM = '009318', ECOM_RULE = '009338', FOOD = '001805', FOOD_RULE = '004097', HYG = '001964', HYG_RULE = '002373';
const b = (law_id, article_no, branch_no, part) => ({ law_id, article_no, branch_no, part });
const NONE_NOTE = '별도 신고 · 허가 없음(일반 사업자등록만)';
const FOOD_SERVICE = (mok) => [b(FOOD, 37, 0, '제4항'), b(FOOD_RULE, 25, 0, '제1항제8호'), b(FOOD_RULE, 21, 0, `제8호${mok}목`)];

const RULES = [
  {
    rule_id: 'ecom_mail_order', name_easy: '쇼핑몰 · 온라인 판매', license_kind: '신고', license_name: '통신판매업 신고',
    note: '제12조제1항 단서 — 통신판매의 거래횟수, 거래규모 등이 공정거래위원회가 고시로 정하는 기준 이하인 경우에는 신고하지 않는다(고시 원문은 저장돼 있지 않다)',
    basis: [b(ECOM, 12, 0, '제1항'), b(ECOM_RULE, 13, 0, '제1항')],
    codes: ['525101', '525103'],
  },
  {
    rule_id: 'food_restaurant', name_easy: '일반음식점', license_kind: '신고', license_name: '일반음식점영업 신고',
    note: '일반음식점 · 휴게음식점은 음주행위가 허용되는지로 나뉜다(영 제21조제8호) — 업종코드로 갈리지 않는다. 김밥 · 간이 음식점(552108 · 552119)은 어느 쪽인지 정하지 않아 잇지 않았다',
    basis: FOOD_SERVICE('나'),
    codes: ['552101', '552102', '552103', '552104', '552114', '552115', '552116', '552117', '552107', '552118'],
  },
  {
    rule_id: 'food_cafe', name_easy: '휴게음식점(카페)', license_kind: '신고', license_name: '휴게음식점영업 신고',
    note: '일반음식점 · 휴게음식점은 음주행위가 허용되는지로 나뉜다(영 제21조제8호) — 업종코드로 갈리지 않는다',
    basis: FOOD_SERVICE('가'),
    codes: ['552303', '552307', '552310', '552123', '552305'],
  },
  {
    rule_id: 'food_bakery', name_easy: '제과점', license_kind: '신고', license_name: '제과점영업 신고', note: null,
    basis: FOOD_SERVICE('바'),
    codes: ['552301'],
  },
  {
    rule_id: 'food_manufacture', name_easy: '식품 제조', license_kind: '등록', license_name: '식품제조ㆍ가공업 등록',
    note: '주류를 제조하면 식품의약품안전처장에게 등록한다(영 제26조의2제1항 단서). 단순 가공 등은 등록하지 않는다(같은 조 제2항). 업종코드는 대표 후보만 이었다(15xxxx 식료품 제조 나머지는 잇지 않았다)',
    basis: [b(FOOD, 37, 0, '제5항'), b(FOOD_RULE, 26, 2, '제1항제1호')],
    codes: ['154104', '154101', '154102', '153107', '154103', '154400'],
  },
  {
    rule_id: 'food_instant', name_easy: '즉석판매 제조', license_kind: '신고', license_name: '즉석판매제조ㆍ가공업 신고',
    note: '대상 식품을 정하는 총리령 원문이 없어 업종코드를 잇지 않았다',
    basis: [b(FOOD_RULE, 25, 0, '제1항제2호')],
    codes: [],
  },
  {
    rule_id: 'health_food_manufacture', name_easy: '건강기능식품 제조', license_kind: null, license_name: null,
    note: '근거 못 찾음 — 식품위생법 시행령 제26조의2제2항제5호가 「건강기능식품에 관한 법률」로 넘기는데, 그 법 원문이 저장돼 있지 않다',
    basis: [],
    codes: ['154908'],
  },
  {
    rule_id: 'food_sale', name_easy: '식품 판매', license_kind: '신고', license_name: '식품소분ㆍ판매업 신고',
    note: '신고 대상 식품판매업은 영 제21조제5호나목 1)~6)(식용얼음 · 자동판매기 · 유통전문 · 집단급식소 · 총리령으로 정하는 일정 규모 이상 기타)뿐이다 — 일반 소매가 드는지는 총리령 원문이 없어 판단하지 않았다',
    basis: [b(FOOD_RULE, 25, 0, '제1항제5호'), b(FOOD_RULE, 21, 0, '제5호')],
    codes: ['522063', '522096', '522061', '522109', '512116'],
  },
  {
    rule_id: 'health_food_retail', name_easy: '건강보조식품 소매', license_kind: null, license_name: null,
    note: '근거 못 찾음 — 「건강기능식품에 관한 법률」 원문이 저장돼 있지 않다',
    basis: [],
    codes: ['522091', '522101'],
  },
  {
    rule_id: 'beauty', name_easy: '미용', license_kind: '신고', license_name: '미용업 신고', note: null,
    basis: [b(HYG, 3, 0, '제1항'), b(HYG, 2, 0, '제1항제5호')],
    codes: ['930203', '930205', '930207'],
  },
  {
    rule_id: 'beauty_license', name_easy: '미용', license_kind: '면허', license_name: '미용사 면허',
    note: '미용사 면허를 받은 자가 아니면 미용업을 개설하거나 그 업무에 종사할 수 없다(법 제8조제1항)',
    basis: [b(HYG, 6, 0, '제1항'), b(HYG, 8, 0, '제1항')],
    codes: ['930203', '930205', '930207'],
  },
  {
    rule_id: 'barber', name_easy: '이용', license_kind: '신고', license_name: '이용업 신고', note: null,
    basis: [b(HYG, 3, 0, '제1항'), b(HYG, 2, 0, '제1항제4호')],
    codes: ['930201'],
  },
  {
    rule_id: 'barber_license', name_easy: '이용', license_kind: '면허', license_name: '이용사 면허',
    note: '이용사 면허를 받은 자가 아니면 이용업을 개설하거나 그 업무에 종사할 수 없다(법 제8조제1항)',
    basis: [b(HYG, 6, 0, '제1항'), b(HYG, 8, 0, '제1항')],
    codes: ['930201'],
  },
  {
    rule_id: 'lodging', name_easy: '숙박', license_kind: '신고', license_name: '숙박업 신고', note: null,
    basis: [b(HYG, 3, 0, '제1항'), b(HYG, 2, 0, '제1항제2호'), b(HYG_RULE, 4, 0, null), b(HYG_RULE, 2, 0, '제1항')],
    codes: ['551002', '551009', '551006', '551017'],
  },
  {
    rule_id: 'lodging_hotel_share', name_easy: '호텔 · 숙박공유', license_kind: null, license_name: null,
    note: '근거 못 찾음 — 관광진흥법 · 농어촌정비법 원문이 저장돼 있지 않다(공중위생관리법 시행령 제2조에 이름만 나온다)',
    basis: [],
    codes: ['551001', '551007'],
  },
  {
    rule_id: 'laundry', name_easy: '세탁', license_kind: '신고', license_name: '세탁업 신고',
    note: '930102 세탁물 공급업은 직접 세탁하는 업종인지 몰라 잇지 않았다',
    basis: [b(HYG, 3, 0, '제1항'), b(HYG, 2, 0, '제1항제6호')],
    codes: ['930100', '930101'],
  },
  {
    rule_id: 'software', name_easy: '소프트웨어', license_kind: '없음', license_name: null, note: NONE_NOTE,
    basis: [],
    codes: ['722000', '722001', '722002', '722003', '722004', '722005'],
  },
  {
    rule_id: 'consulting', name_easy: '컨설팅', license_kind: '없음', license_name: null, note: NONE_NOTE,
    basis: [],
    codes: ['741400', '741401'],
  },
];

const artLabel = (a) => `제${a.article_no}조${a.branch_no ? `의${a.branch_no}` : ''}${a.part ? ` ${a.part}` : ''}`;
const firstLine = (body) => {
  const lines = body.split('\n');
  const head = lines[0].replace(/^제\d+조(의\d+)?\([^)]*\)\s*/, '');
  const s = head || lines[1] || '';
  return s.length > 70 ? `${s.slice(0, 67)}…` : s;
};

(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    // 키 · 짝 겹침
    const ids = RULES.map((r) => r.rule_id);
    if (new Set(ids).size !== ids.length) throw new Error('rule_id 가 겹칩니다');
    for (const r of RULES) {
      const bk = r.basis.map((x) => `${x.law_id}-${x.article_no}-${x.branch_no}`);
      if (new Set(bk).size !== bk.length) throw new Error(`${r.rule_id}: 근거 조문이 겹칩니다`);
      if (new Set(r.codes).size !== r.codes.length) throw new Error(`${r.rule_id}: 업종코드가 겹칩니다`);
    }

    const { rows: [{ ok }] } = await c.query("SELECT to_regclass('public.tb_s080_license_rule') IS NOT NULL AS ok");
    if (!ok && APPLY) throw new Error('049 를 먼저 적용하세요 — 아무것도 쓰지 않았습니다');
    if (ok) {
      const { rows: [{ n }] } = await c.query('SELECT count(*)::int AS n FROM public.tb_s080_license_rule');
      console.log(`DB: 규칙 ${n}줄`);
      if (n > 0 && APPLY) throw new Error('규칙 표에 이미 줄이 있습니다 — 첫 적재만 합니다. 아무것도 쓰지 않았습니다');
    } else console.log('DB: 049 가 적용되지 않았다(표 없음) — 보기만');

    // 048 조문 · 047 업종코드 대조
    const arts = new Map((await c.query(
      `SELECT a.law_id, a.article_no, a.branch_no, a.title, a.body, a.body_hash, a.is_deleted, a.active, l.law_name
         FROM public.tb_s080_law_article a JOIN public.tb_s080_law l USING (law_id)
        WHERE a.law_id = ANY($1)`, [[...new Set(RULES.flatMap((r) => r.basis.map((x) => x.law_id)))]],
    )).rows.map((a) => [`${a.law_id}-${a.article_no}-${a.branch_no}`, a]));
    const codes = new Map((await c.query(
      'SELECT biz_code, item_name, active FROM public.tb_s080_biz_code WHERE biz_code = ANY($1)', [[...new Set(RULES.flatMap((r) => r.codes))]],
    )).rows.map((x) => [x.biz_code, x]));

    const bad = [];
    for (const r of RULES) {
      console.log(`\n■ ${r.rule_id} — ${r.name_easy} · ${r.license_kind ?? '(근거 못 찾음)'}${r.license_name ? ` · ${r.license_name}` : ''} · 확인 필요`);
      if (r.note) console.log(`  예외: ${r.note}`);
      for (const x of r.basis) {
        const a = arts.get(`${x.law_id}-${x.article_no}-${x.branch_no}`);
        if (!a) { bad.push(`${r.rule_id}: ${x.law_id} ${artLabel(x)} 가 048 에 없습니다`); continue; }
        if (!a.active || a.is_deleted) bad.push(`${r.rule_id}: ${a.law_name} ${artLabel(x)} 가 사용 안 함 · 삭제 조입니다`);
        x.hash = a.body_hash;
        console.log(`  근거: ${a.law_name} ${artLabel(x)}(${a.title || '제목 없음'}) — ${firstLine(a.body)}`);
      }
      if (!r.basis.length) console.log('  근거: 없음');
      const shown = r.codes.map((k) => {
        const x = codes.get(k);
        if (!x) { bad.push(`${r.rule_id}: 업종코드 ${k} 가 047 에 없습니다`); return `${k}(없음)`; }
        if (!x.active) bad.push(`${r.rule_id}: 업종코드 ${k} 가 사용 안 함입니다`);
        return `${k} ${x.item_name.length > 20 ? `${x.item_name.slice(0, 19)}…` : x.item_name}`;
      });
      console.log(`  업종코드: ${shown.length ? shown.join(' · ') : '없음'}`);
    }
    if (bad.length) throw new Error(`어긋남 ${bad.length} — 아무것도 쓰지 않았습니다\n  ${bad.join('\n  ')}`);

    const nBasis = RULES.reduce((s, r) => s + r.basis.length, 0);
    const nCodes = RULES.reduce((s, r) => s + r.codes.length, 0);
    const kinds = RULES.reduce((m, r) => { const k = r.license_kind ?? '근거 못 찾음'; m[k] = (m[k] || 0) + 1; return m; }, {});
    console.log(`\n합계 — 규칙 ${RULES.length} (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(' · ')}) · 근거 조문 ${nBasis} · 업종코드 연결 ${nCodes}(서로 다른 업종코드 ${new Set(RULES.flatMap((r) => r.codes)).size})`);

    if (!APPLY) { console.log('보기만 했습니다. 쓰려면 049 적용 뒤 --apply.'); await c.query('ROLLBACK'); return; }

    const now = new Date();
    for (const r of RULES) {
      await c.query(
        `INSERT INTO public.tb_s080_license_rule (rule_id, name_easy, license_kind, license_name, note, review_status, loaded_at)
         VALUES ($1, $2, $3, $4, $5, '확인 필요', $6)`,
        [r.rule_id, r.name_easy, r.license_kind, r.license_name, r.note, now],
      );
      for (const x of r.basis) {
        await c.query(
          `INSERT INTO public.tb_s080_license_rule_basis (rule_id, law_id, article_no, branch_no, part, body_hash_at_review, loaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [r.rule_id, x.law_id, x.article_no, x.branch_no, x.part, x.hash, now],
        );
      }
      for (const k of r.codes) {
        await c.query('INSERT INTO public.tb_s080_license_rule_biz_code (rule_id, biz_code, loaded_at) VALUES ($1, $2, $3)', [r.rule_id, k, now]);
      }
    }
    await c.query('COMMIT');
    const { rows: [n] } = await c.query(`SELECT (SELECT count(*) FROM public.tb_s080_license_rule)::int AS r,
      (SELECT count(*) FROM public.tb_s080_license_rule_basis)::int AS b, (SELECT count(*) FROM public.tb_s080_license_rule_biz_code)::int AS k`);
    console.log(`✔ 썼습니다 — 규칙 ${n.r} · 근거 조문 ${n.b} · 업종코드 연결 ${n.k}`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
