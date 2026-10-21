/**
 * 일회용(2026-10-21, 다시 돌린다) — 법령 원문 적재(048 의 두 표).
 *
 * 원본: 국가법령정보 공동활용 API — 법령 목록 조회(lawSearch, 현행법령 XML)로 법령 ID · 시행일을 찾고,
 *       본문 조회(lawService, XML — 목록의 법령일련번호 MST 로)로 조문을 받는다.
 * ★ 인증키는 packages/api/.env 의 LAW_API_OC 에서만 읽는다. 출력하지 않는다(오류 글에서도 가린다).
 * ★ 호출 간격 1.1초.
 *
 * 사용자 결정(2026-10-21):
 *   · 대상 11개(아래 LAWS). 법령마다 목록 조회에서 법령명이 정확히 일치하는 현행 법령 하나를 고른다
 *     — 없거나 둘 이상이면 멈춘다
 *   · 시행일이 DB 와 같으면 건너뛴다(본문을 받지 않는다). 바뀌었으면 본문 해시로 바뀐 조문만 고친다
 *   · 시행일은 **목록** 값을 저장 · 비교한다. 본문 기본정보의 시행일자가 다르면 경고만 찍고 진행한다
 *     (2026-10-21 결정 A — 지방세법: 같은 판인데 목록 20260701 · 본문 20260101)
 *   · 새 본문에서 빠진 조문은 지우지 않고 active = false
 *   · 조문은 본문의 「조문」만 — 장 · 절 제목 줄(「전문」) · 부칙은 넣지 않는다
 *   · 삭제 여부 = 조문내용이 「제N조 삭제」 · 「제N조의M 삭제」로 시작
 *   · 종류 = 원본 법종구분 법률 → 법률, 대통령령 → 시행령(그 밖이면 멈춘다)
 *
 * ★ 기본은 **보기만** 한다. `--apply` 일 때만 쓴다(본문을 다 받은 뒤 한 트랜잭션).
 * ★ 048 을 먼저 적용해야 --apply 가 돈다(보기는 표가 없어도 돈다 — 전부 「새로 생김」으로 보인다).
 *
 *   node scripts/oneoff/2026-10-21-law-text.js .env              (보기)
 *   node scripts/oneoff/2026-10-21-law-text.js .env --apply      (쓰기)
 */
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');

const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) {
  console.error('사용법: node scripts/oneoff/2026-10-21-law-text.js <.env> [--apply]');
  process.exit(2);
}
const readEnv = (p) => Object.fromEntries(
  fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const env = readEnv(envPath);
const OC = readEnv('packages/api/.env').LAW_API_OC;
if (!OC) { console.error('✘ packages/api/.env 에 LAW_API_OC 가 없습니다'); process.exit(2); }
const mask = (s) => String(s).split(OC).join('***').split(encodeURIComponent(OC)).join('***');

const LAWS = [
  '상법', '상업등기법', '지방세법', '부가가치세법', '전자상거래 등에서의 소비자보호에 관한 법률', '식품위생법', '공중위생관리법',
  '지방세법 시행령', '식품위생법 시행령', '전자상거래 등에서의 소비자보호에 관한 법률 시행령', '공중위생관리법 시행령',
];
const KIND = { 법률: '법률', 대통령령: '시행령' };

// ── API ──────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
// 호출마다 「목록 · 본문 — 법령명」을 찍는다. 연결이 끊긴 오류(fetch · 응답 읽기가 던지는 네트워크 오류)만
// 5초 뒤 1회 다시 시도하고, 두 번째도 끊기면 멈춘다. HTTP 오류 · XML 아닌 응답(키 · IP)은 다시 시도하지 않는다.
async function get(path, params, label) {
  console.log(`  호출: ${label}`);
  const q = new URLSearchParams({ OC, target: 'law', type: 'XML', ...params });
  let r, body;
  for (let attempt = 1; ; attempt++) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      r = await fetch(`https://www.law.go.kr/DRF/${path}?${q}`);
      body = await r.text();
      break;
    } catch (e) {
      const why = mask(`${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`);
      if (attempt >= 2) throw new Error(`${label}: 연결이 두 번 끊겼습니다 — ${why}`);
      console.log(`  ⚠ ${label}: 연결이 끊겼습니다(${why}) — 5초 뒤 1회 다시 시도`);
      await sleep(5000);
    }
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${mask(body.slice(0, 300))}`);
  if (!body.trimStart().startsWith('<?xml')) throw new Error(`XML 이 아닌 응답(IP · 키 확인): ${mask(body.slice(0, 300))}`);
  return body;
}
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const text = (raw) => { const m = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/); return (m ? m[1] : dec(raw)).trim(); };
const tag = (x, t) => { const m = x.match(new RegExp(String.raw`<${t}(?:\s[^>]*)?>([\s\S]*?)</${t}>`)); return m ? text(m[1]) : ''; };
const ymd = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

async function findLaw(name) {
  const x = await get('lawSearch.do', { display: '100', query: name }, `목록 — ${name}`);
  const rows = (x.match(/<law id="[^"]*">[\s\S]*?<\/law>/g) || []).map((l) => ({
    name: tag(l, '법령명한글'), id: tag(l, '법령ID'), mst: tag(l, '법령일련번호'), eff: tag(l, '시행일자'), dept: tag(l, '소관부처명'), cur: tag(l, '현행연혁코드'), kind: tag(l, '법령구분명'),
  }));
  const exact = rows.filter((r) => r.name === name && r.cur === '현행');
  if (exact.length !== 1) throw new Error(`「${name}」: 법령명이 정확히 일치하는 현행 법령이 ${exact.length}개 — 멈춥니다`);
  const p = exact[0];
  if (!/^\d{6}$/.test(p.id) || !/^\d+$/.test(p.mst) || !ymd(p.eff)) throw new Error(`「${name}」: 법령 ID · 시행일 모양이 다릅니다(${p.id} · ${p.eff})`);
  if (!KIND[p.kind]) throw new Error(`「${name}」: 종류 「${p.kind}」 — 법률 · 대통령령만 받습니다`);
  return { mst: p.mst, law_id: p.id, law_name: p.name, law_kind: KIND[p.kind], effective_date: ymd(p.eff), ministry: p.dept };
}

async function fetchArticles(law) {
  // ★ 법령 ID(ID=)로 받으면 목록과 다른 시행일 판이 올 때가 있다(2026-10-21 지방세법: 목록 20260701 · ID 본문 20260101).
  //   목록의 법령일련번호(MST=)로 받아 목록과 같은 판을 받는다. 아래에서 시행일을 다시 대조한다.
  const x = await get('lawService.do', { MST: law.mst }, `본문 — ${law.law_name}`);
  const info = x.match(/<기본정보>[\s\S]*?<\/기본정보>/);
  if (!info) throw new Error(`「${law.law_name}」: 본문에 기본정보가 없습니다`);
  if (tag(info[0], '법령ID') !== law.law_id) throw new Error(`「${law.law_name}」: 본문의 법령 ID(${tag(info[0], '법령ID')})가 목록과 다릅니다`);
  // 시행일은 목록 값을 저장 · 비교한다(결정 2026-10-21 A). 본문 기본정보의 시행일자가 다르면 보기에 경고만 찍는다.
  const bodyEff = ymd(tag(info[0], '시행일자'));
  const warn = bodyEff !== law.effective_date ? `본문 시행일 ${bodyEff || tag(info[0], '시행일자')} ≠ 목록 ${law.effective_date} (목록 값으로 저장)` : null;
  const units = x.match(/<조문단위[\s\S]*?<\/조문단위>/g) || [];
  const arts = new Map();
  let heads = 0;
  for (const u of units) {
    if (tag(u, '조문여부') !== '조문') { heads++; continue; }
    const no = +tag(u, '조문번호'), br = +(tag(u, '조문가지번호') || 0);
    if (!(no > 0) || !(br >= 0)) throw new Error(`「${law.law_name}」: 조문 번호 모양이 다릅니다(${tag(u, '조문번호')}의${tag(u, '조문가지번호')})`);
    const key = `${no}-${br}`;
    if (arts.has(key)) throw new Error(`「${law.law_name}」: 조문 번호가 겹칩니다(제${no}조${br ? `의${br}` : ''})`);
    const parts = [...u.matchAll(/<(조문내용|항내용|호내용|목내용)>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2])).filter(Boolean);
    const body = parts.join('\n');
    if (!body) throw new Error(`「${law.law_name}」: 제${no}조${br ? `의${br}` : ''} 본문이 비었습니다`);
    arts.set(key, {
      article_no: no, branch_no: br, title: tag(u, '조문제목') || null, body,
      is_deleted: /^제\d+조(의\d+)?\s*삭제/.test(text(u.match(/<조문내용>([\s\S]*?)<\/조문내용>/)?.[1] || '')),
      body_hash: crypto.createHash('sha256').update(body).digest('hex'),
    });
  }
  return { arts, heads, warn };
}

// ── 실행 ──────────────────────────────────────────────────────────────────────
(async () => {
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const { rows: [{ ok }] } = await c.query("SELECT to_regclass('public.tb_s080_law') IS NOT NULL AND to_regclass('public.tb_s080_law_article') IS NOT NULL AS ok");
    if (!ok && APPLY) throw new Error('048 을 먼저 적용하세요 — 아무것도 쓰지 않았습니다');
    const oldLaw = new Map(ok
      ? (await c.query('SELECT law_id, effective_date::text AS effective_date FROM public.tb_s080_law')).rows.map((r) => [r.law_id, r])
      : []);
    console.log(ok ? `DB: 법령 ${oldLaw.size}줄` : 'DB: 048 이 적용되지 않았다(표 없음) — 전부 「새로 생김」');

    // 1) 목록 · 본문 받기(네트워크는 트랜잭션 밖에서 다 끝낸다)
    const plan = [];
    for (const name of LAWS) {
      const law = await findLaw(name);
      const o = oldLaw.get(law.law_id);
      if (o && o.effective_date === law.effective_date) { plan.push({ law, skip: true }); continue; }
      plan.push({ law, prev: o ? o.effective_date : null, ...(await fetchArticles(law)) });
    }

    // 2) DB 와 대조
    for (const p of plan) {
      const L = p.law;
      console.log(`\n■ ${L.law_name}  (ID ${L.law_id} · ${L.law_kind} · 시행 ${L.effective_date} · ${L.ministry})`);
      if (p.skip) { console.log('  시행일이 DB 와 같다 — 건너뜀'); continue; }
      const old = new Map(ok
        ? (await c.query('SELECT article_no, branch_no, body_hash, is_deleted, active FROM public.tb_s080_law_article WHERE law_id = $1', [L.law_id]))
          .rows.map((r) => [`${r.article_no}-${r.branch_no}`, r])
        : []);
      const all = [...p.arts.values()];
      p.added = all.filter((a) => !old.has(`${a.article_no}-${a.branch_no}`));
      p.changed = all.filter((a) => { const o = old.get(`${a.article_no}-${a.branch_no}`); return o && (o.body_hash !== a.body_hash || !o.active); });
      p.removed = [...old.entries()].filter(([k, o]) => o.active && !p.arts.has(k)).map(([, o]) => o);
      const label = (a) => `제${a.article_no}조${a.branch_no ? `의${a.branch_no}` : ''}`;
      console.log(`  ${p.prev ? `시행일 ${p.prev} → ${L.effective_date}` : '새 법령'}`);
      if (p.warn) console.log(`  ⚠ ${p.warn}`);
      console.log(`  조문 ${all.length} (삭제 조 ${all.filter((a) => a.is_deleted).length} · 가지조문 ${all.filter((a) => a.branch_no).length}) · 장 · 절 제목 줄(넣지 않음) ${p.heads}`);
      console.log(`  처음 3개: ${all.slice(0, 3).map((a) => `${label(a)}(${a.title || '제목 없음'})`).join(' · ')}`);
      console.log(`  DB 와 대조 — 새로 생김 ${p.added.length} · 바뀜 ${p.changed.length} · 빠짐(사용 안 함으로) ${p.removed.length}`);
      for (const a of p.changed.slice(0, 10)) console.log(`    바뀜 ${label(a)} ${a.title || ''}`);
      for (const o of p.removed.slice(0, 10)) console.log(`    빠짐 ${label(o)}`);
    }

    if (!APPLY) { console.log('\n보기만 했습니다. 쓰려면 048 적용 뒤 --apply.'); return; }

    // 3) 쓰기 — 한 트랜잭션
    await c.query('BEGIN');
    const now = new Date();
    for (const p of plan.filter((x) => !x.skip)) {
      const L = p.law;
      await c.query(
        `INSERT INTO public.tb_s080_law (law_id, law_name, law_kind, effective_date, ministry, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (law_id) DO UPDATE SET law_name = EXCLUDED.law_name, law_kind = EXCLUDED.law_kind,
           effective_date = EXCLUDED.effective_date, ministry = EXCLUDED.ministry, fetched_at = EXCLUDED.fetched_at`,
        [L.law_id, L.law_name, L.law_kind, L.effective_date, L.ministry, now],
      );
      for (const a of [...p.added, ...p.changed]) {
        await c.query(
          `INSERT INTO public.tb_s080_law_article (law_id, article_no, branch_no, title, body, is_deleted, body_hash, fetched_at, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
           ON CONFLICT (law_id, article_no, branch_no) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body,
             is_deleted = EXCLUDED.is_deleted, body_hash = EXCLUDED.body_hash, fetched_at = EXCLUDED.fetched_at, active = true`,
          [L.law_id, a.article_no, a.branch_no, a.title, a.body, a.is_deleted, a.body_hash, now],
        );
      }
      for (const o of p.removed) {
        await c.query('UPDATE public.tb_s080_law_article SET active = false WHERE law_id = $1 AND article_no = $2 AND branch_no = $3',
          [L.law_id, o.article_no, o.branch_no]);
      }
    }
    await c.query('COMMIT');
    const { rows: [n] } = await c.query(`SELECT (SELECT count(*) FROM public.tb_s080_law)::int AS l,
      (SELECT count(*) FROM public.tb_s080_law_article WHERE active)::int AS a`);
    console.log(`\n✔ 썼습니다 — 법령 ${n.l}줄 · 사용 중 조문 ${n.a}줄`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(`✘ ${mask(e.message)}`); process.exit(1); });
