/**
 * 205 검증 — 세무(S05) 뺀 줄 종류 코드(TAX_SKIP_REASON).
 *
 * 사용: node scripts/verify-205.js .env packages/api/.env
 *
 * ★ 읽기만 한다 — 아무것도 넣지 않는다. 앱과 같은 길로 erp_app 접속 · 운영사 스코프에서 읽는다
 *   (트랜잭션은 ROLLBACK 으로 닫는다). verify-202 · 204 와 같은 방식.
 * ★★ 코드값이 API 응답의 뺀 줄 키(shared `InvoiceExcluded`)와 **빠짐없이 · 더하지 않고** 같은지 본다 —
 *    하나라도 어긋나면 화면이 그 종류의 이름을 못 찾는다. 키 목록은 shared 소스에서 읽는다(두 벌로 적지 않는다).
 *
 * 종료코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 실행 실패
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const readEnv = (file) =>
  Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
  );

const apiEnv = readEnv(process.argv[3] || 'packages/api/.env');
const CAT = 'TAX_SKIP_REASON';

/** shared 의 `InvoiceExcluded` 키 — 소스의 인터페이스 본문에서 `이름:` 을 읽는다. */
function excludedKeys() {
  const src = fs.readFileSync(path.join(__dirname, '../packages/shared/src/domain/tax-uploads.ts'), 'utf8');
  const body = /export interface InvoiceExcluded \{([\s\S]*?)\n\}/.exec(src);
  if (!body) throw new Error('shared tax-uploads.ts 에서 InvoiceExcluded 를 찾지 못했다');
  return [...body[1].matchAll(/^\s+(\w+):\s*number;/gm)].map((m) => m[1]);
}

const results = [];
const check = (id, what, cond, note = '') => results.push({ 항목: id, 내용: what, 결과: cond ? '통과' : '실패', 비고: note });

async function codeChecks(q) {
  const keys = excludedKeys();
  const master = await q(`SELECT name FROM public.tb_s080_code_masters WHERE build_id = '1' AND category = $1`, [CAT]);
  check('C1', `분류 ${CAT} — 이름 「뺀 줄 종류」`, master.length === 1 && master[0].name === '뺀 줄 종류', master.map((m) => m.name).join(','));

  const parts = await q(`SELECT use_tp FROM public.tb_s080_code_categories WHERE build_id = '1' AND category = $1`, [CAT]);
  check('C2', '파티션은 공통(000) 하나', parts.length === 1 && parts[0].use_tp === '000', parts.map((p) => p.use_tp).join(','));

  const lines = await q(`SELECT code, name, use_tp, sort_order, is_active FROM public.tb_s080_codes_line
    WHERE build_id = '1' AND category = $1 ORDER BY sort_order`, [CAT]);
  // 209 가 카드 · 현금 뺀 줄 종류를 8번부터 더했다 — 205 의 일곱(순서 1~7)만 계산서 키와 맞춰 본다(나머지는 verify-209)
  const codes = lines.filter((l) => l.sort_order <= 7).map((l) => l.code);
  check('C3', `★ 고정 코드 — 205 코드값(순서 1~7)이 API 계산서 뺀 줄 키 ${keys.length}개와 빠짐없이 · 더하지 않고 같다(순서까지)`,
    codes.join(',') === keys.join(','), `DB ${codes.join(',')} / API ${keys.join(',')}`);
  check('C4', '이름이 모두 차 있다(화면 문구)', lines.length > 0 && lines.every((l) => (l.name || '').trim() !== ''),
    lines.map((l) => `${l.code}=${l.name}`).join(' '));
  check('C5', '모두 000 파티션 · 켜짐', lines.every((l) => l.use_tp === '000' && l.is_active));
  check('C6', '205 코드값 7(순서 1~7)', codes.length === 7, String(codes.length));
}

(async () => {
  const erpUrl = apiEnv.ERP_DATABASE_URL || '';
  if (!erpUrl) {
    check('C*', 'erp_app 접속', false, 'packages/api/.env 에 ERP_DATABASE_URL 이 없다');
  } else {
    const ec = new Client({ connectionString: erpUrl });
    await ec.connect();
    try {
      await ec.query('BEGIN');
      await ec.query(`SELECT set_config('app.current_role', 'operator', true)`);
      await codeChecks((s, p) => ec.query(s, p).then((r) => r.rows));
    } finally {
      await ec.query('ROLLBACK');
      await ec.end();
    }
  }

  console.table(results);
  const failed = results.filter((r) => r.결과 !== '통과').length;
  console.log(failed === 0 ? `✔ 전부 통과 (${results.length}건)` : `✘ 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('✘ 실행 실패:', e.message);
  process.exit(2);
});
