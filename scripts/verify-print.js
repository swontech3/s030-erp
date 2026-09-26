/**
 * 계약서 인쇄 검증 — **실제 크롬으로 실제 PDF 를 뽑아** 확인한다.
 *
 * =============================================================================
 * ★★★ 왜 이 스크립트가 있는가
 * =============================================================================
 * 2026-09-21, 이용계약서 PDF 에서 **가로선이 몇 줄 걸러 하나씩 사라졌다.** 화면에서는
 * 멀쩡했다. 원인은 칠하는 순서였다 — 가로선이 «줄(.tr)»의 보더라서, 다음 줄 제목 칸의
 * 회색 배경이 **나중에** 칠해지며 선을 덮었다(경위: `doc/CONTRACT_DOCUMENTS.md` §I).
 *
 * 그래서 이 검사는 «선이 PDF 에 있는가»만 보지 않는다. **선보다 뒤에 칠해지면서 맞닿는
 * 칠이 있는가**를 본다. 그런 선은 PDF 를 그리는 쪽의 반올림에 목숨이 달려 있어서
 * 뷰어마다 보였다 안 보였다 한다 — 실제로 그렇게 새어 나갔다.
 *
 * =============================================================================
 * 미리 켜 둘 것
 * =============================================================================
 *   웹 개발 서버 localhost:3000 · API 3001 · DB
 *   ★ `127.0.0.1` 이 아니라 **localhost** 다 (Next 16 하이드레이션).
 *
 * 쓰는 법:  node scripts/verify-print.js [계약ID]
 *           계약ID 를 안 주면 **검증용 계약을 새로 만들어** 쓰고 끝나면 지운다(2026-09-26).
 *           예전에는 DB 에서 확정 계약을 골랐는데, 개발계에 확정 계약이 없으면 돌지 않았다.
 *
 * ★ 중도해지 정산서(s0300200070p3)도 뽑는다 — 검증용 계약을 중도 해지해 정산을 만들고,
 *   사이드바 「청구」 정산 탭에서 그 계약의 상세를 열고 [정산서] 를 눌러 **진짜 인쇄 경로**를 탄다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { Client } = require('pg');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const PORT = 9366;
const WEB = 'http://localhost:3000';
const LOGIN = { email: 'operator@s-wontech.co.kr', password: 'erp1234!' };
/** 맞닿았다고 볼 간격(px). 1px 선이 장치 픽셀 하나 안에서 흔들리는 폭이다. */
const GAP = 0.6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'OK ' : 'X  '} ${name}${detail ? `   ${detail}` : ''}`);
};

/* ══════════════════════════════════════════════════════════════════════════
   PDF 읽기 — 칠한 직사각형을 **칠한 순서대로** 꺼낸다
   ══════════════════════════════════════════════════════════════════════════ */

/** 페이지 콘텐츠 스트림들(그리기와 글자가 둘 다 있는 것). */
function contentStreams(buf) {
  const s = buf.toString('latin1');
  const out = [];
  const re = /(\d+)\s+0\s+obj([\s\S]{0,400}?)stream\r?\n/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (!/FlateDecode/.test(m[2])) continue;
    const len = m[2].match(/\/Length\s+(\d+)/);
    const start = m.index + m[0].length;
    const end = len ? start + Number(len[1]) : s.indexOf('endstream', start);
    let data;
    try {
      data = zlib.inflateSync(buf.slice(start, end)).toString('latin1');
    } catch {
      continue; // 이미지·글꼴 등 — 페이지 내용이 아니다
    }
    if ((data.match(/\bre\b/g) || []).length > 5 && /Tj|TJ/.test(data)) out.push(data);
  }
  return out;
}

/**
 * 칠한 직사각형 목록. `i` 가 칠한 순서다 — **이 순서가 이 검사의 전부다.**
 *
 * ★ 곡선(`m`/`c`/`l`)으로 그린 도형과 오려내기(`W n`)는 버린다. 여기서 보는 것은
 *   표의 칸과 선, 즉 축에 붙은 직사각형뿐이다.
 */
function paintsOf(content) {
  const toks = content.split(/\s+/);
  const num = (k) => Number(toks[k]);
  let rgb = [1, 1, 1];
  const stack = [];
  let pending = [];
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t === 'q') stack.push(rgb.slice());
    else if (t === 'Q') { const p = stack.pop(); if (p) rgb = p; }
    else if (t === 'rg') rgb = [num(k - 3), num(k - 2), num(k - 1)];
    else if (t === 're') pending.push([num(k - 4), num(k - 3), num(k - 2), num(k - 1)]);
    else if (t === 'f' || t === 'f*') { for (const r of pending) out.push({ r, rgb: rgb.slice(), i: out.length }); pending = []; }
    else if (t === 'n' || t === 'm' || t === 'c' || t === 'l' || t === 'h' || t === 'W' || t === 'W*') pending = [];
  }
  return out;
}

const isBlack = (c) => c[0] < 0.2 && c[1] < 0.2 && c[2] < 0.2;

/** 검은 가로선과, 그보다 **뒤에 칠해지면서 맞닿는** 칠. */
function riskyLines(content) {
  const paints = paintsOf(content);
  const lines = paints.filter((p) => isBlack(p.rgb) && p.r[3] <= 1.5 && p.r[2] > 20);
  return lines.map((L) => {
    const [x, y, w, h] = L.r;
    const covered = paints.filter((p) => p.i > L.i && !isBlack(p.rgb)
      && p.r[0] < x + w - 0.01 && p.r[0] + p.r[2] > x + 0.01
      && p.r[1] < y + h + GAP && p.r[1] + p.r[3] > y - GAP);
    return { x, y, w, covered };
  });
}

function pageCount(buf) {
  return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
}

/* ══════════════════════════════════════════════════════════════════════════
   크롬 — 계약 폼을 열고 [계약서 출력] 을 눌러 진짜 인쇄 경로를 탄다
   ══════════════════════════════════════════════════════════════════════════ */

async function withChrome(fn) {
  const bin = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!bin) throw new Error('크롬을 찾지 못했다');
  const profile = path.join(os.tmpdir(), `verify-print-${Date.now()}`);
  const chrome = spawn(bin, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { /* 아직 */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('크롬이 뜨지 않았다'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiters = new Map();
  ws.onmessage = (m) => {
    const x = JSON.parse(m.data);
    if (x.id && waiters.has(x.id)) {
      const { res, rej } = waiters.get(x.id);
      waiters.delete(x.id);
      x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => { const n = ++id; waiters.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });

  try {
    return await fn(send);
  } finally {
    ws.close();
    chrome.kill();
  }
}

/** 계약서 한 종을 뽑는다. `kind` 는 `usage` | `sublease`. */
async function printDoc(send, contractId, kind) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');
  const ev = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const goto = async (url) => {
    await S('Page.navigate', { url });
    for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('document.readyState') === 'complete') return; }
  };

  await goto(`${WEB}/login`);
  const status = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(LOGIN))}}).then(r=>r.status)`, true);
  if (status !== 200) throw new Error(`로그인 실패 ${status}`);

  await goto(`${WEB}/contracts/${contractId}`);
  await sleep(2500);
  const opened = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('계약서 출력')); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
  if (opened !== 'OK') throw new Error('[계약서 출력] 버튼이 없다 — 확정된 계약인가');
  await sleep(1200);
  if (kind === 'sublease') {
    await ev(`(() => { const t=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('전대차')); t && t.click(); })()`);
    await sleep(900);
  }
  const page = await ev(`(() => { const p=document.querySelector('[data-doc-page]'); return p ? p.getAttribute('data-doc-page') : 'NONE'; })()`);
  if (page !== kind) throw new Error(`열린 문서가 ${kind} 가 아니다: ${page}`);

  // ★ 모달이 열려 있는 동안 body 에 `data-printing` 이 붙는다 — 진짜 인쇄 CSS 를 탄다
  const { data } = await S('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  });
  await send('Target.closeTarget', { targetId });
  return Buffer.from(data, 'base64');
}

/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * 중도해지 정산서(s0300200070p3) — 청구 화면 정산 탭(그 계약의 상세)에서 [정산서] 를 눌러 뽑는다.
 * ★ 정산서는 **이 화면에만** 있다(한 업무는 한 화면에서 — CLAUDE.md).
 *
 * ★ 인쇄 규칙은 계약서와 같다(`print.css` 의 `data-printing='contract-doc'`). 그래서 같은
 *   검사(가로선이 뒤에 칠해지는 배경에 맞닿는가)를 그대로 건다.
 * ★ PDF 글자는 글꼴 부호라 읽기 어렵다 — 내용 확인은 **인쇄 직전의 문서 DOM** 에서 한다.
 */
async function printSettlement(send, companyId, contractId) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');
  const ev = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const goto = async (url) => {
    await S('Page.navigate', { url });
    for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('document.readyState') === 'complete') return; }
  };

  await goto(`${WEB}/login`);
  const status = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(LOGIN))}}).then(r=>r.status)`, true);
  if (status !== 200) throw new Error(`로그인 실패 ${status}`);

  await goto(`${WEB}/billing?tab=settle&company=${encodeURIComponent(companyId)}&contract=${encodeURIComponent(contractId)}`);
  let opened = 'NO';
  for (let i = 0; i < 40 && opened !== 'OK'; i++) {
    await sleep(250);
    opened = await ev(`(() => { const card=document.querySelector('[data-settlement-card="${contractId}"]'); if(!card) return 'NO'; const b=[...card.querySelectorAll('button')].find(x=>x.textContent.includes('정산서')); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
  }
  if (opened !== 'OK') throw new Error('정산 탭 상세에 [정산서] 가 없다');
  await sleep(900);

  const text = await ev(`(() => { const p=document.querySelector('[data-doc-page="settlement"]'); return p ? p.innerText : 'NONE'; })()`);
  if (text === 'NONE') throw new Error('정산서 문서가 열리지 않았다');

  const { data } = await S('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  });
  await send('Target.closeTarget', { targetId });
  return { pdf: Buffer.from(data, 'base64'), text };
}

function readEnv(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

/**
 * 검증용 계약 — 새로 만들어 쓰고 지운다. 개발계는 공용 DB 라 흔적을 남기지 않는다.
 *
 *   ① 확정(월납 3개월 · 2026-09-01 시작)   → 이용계약서 · 전대차계약서
 *   ② 2026-09-10 중도 해지                  → 정산이 생긴다 → 정산서
 *
 * 만들고 끝내는 것은 **웹 API** 로 한다(화면이 쓰는 그 길). 지우는 것만 DB 로 한다 —
 * 청구서·수납·정산·예치금 장부는 계약에서 CASCADE 되지 않는다(일부러 그렇다).
 */
async function createTempContract() {
  const env = readEnv('.env');
  const TAG = `verify-print-${Date.now()}`;
  const db = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await db.connect();

  const login = await fetch(`${WEB}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(LOGIN),
  });
  if (login.status !== 200) { await db.end(); throw new Error(`로그인 실패 ${login.status}`); }
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const api = async (method, url, body) => {
    const res = await fetch(`${WEB}${url}`, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const build = (await db.query('SELECT build_id FROM public.tb_s080_buildings LIMIT 1')).rows[0]?.build_id;
  const company = (await db.query(`SELECT c.company_id FROM public.tb_s080_companies c
     WHERE (SELECT count(*) FROM public.tb_cm_file f WHERE f.target_id = c.company_id) >= 2 ORDER BY c.company_id LIMIT 1`)).rows[0]?.company_id;
  const space = (await db.query(`SELECT s.space_id, s.room_type FROM public.tb_s080_spaces s
     WHERE s.build_id = $1 AND s.room_type = 'VR' AND s.is_active AND NOT EXISTS (
       SELECT 1 FROM public.tb_s080_contract_spaces cs JOIN public.tb_s080_contracts k ON k.contract_id = cs.contract_id
        WHERE cs.space_id = s.space_id AND k.status IN ('confirmed','draft')) ORDER BY s.room_name LIMIT 1`, [build])).rows[0];
  if (!build || !company || !space) { await db.end(); throw new Error('검증용 계약을 만들 준비가 안 됐다(건물·서류 있는 회사·빈 비상주)'); }

  const created = await api('POST', '/api/contracts', {
    companyId: company, buildId: build, contractRoom: `VP${String(Date.now()).slice(-6)}`, paymentMethod: 'M',
    periodMonths: 3, contractDate: '2026-08-25', startDate: '2026-09-01', status: 'confirmed', memo: TAG,
    spaces: [{ roomType: space.room_type, spaceId: space.space_id, standardFee: 500000, deposit: 100000, monthlyFee: 500000, vatYn: true }],
  });
  if (created.status !== 201) { await db.end(); throw new Error(`검증용 계약 생성 실패 ${created.status} ${JSON.stringify(created.body)}`); }
  const contractId = created.body.contractId;

  return {
    contractId,
    companyId: company,
    terminate: async () => {
      const r = await api('POST', `/api/contracts/${contractId}/status`, {
        to: 'terminated', terminatedDate: '2026-09-10', terminationReason: '인쇄 검증',
      });
      if (r.status !== 200 || r.body.billing !== 'settled') throw new Error(`중도 해지 실패 ${r.status} ${JSON.stringify(r.body)}`);
    },
    /** 정산 처리 — 환불 계좌가 정산서에 찍히는지 보려고 처리까지 한다. */
    process: async () => {
      const r = await api('POST', `/api/contracts/${contractId}/settlement/process`, {
        // ★ 10원 미만을 버린 값이다(2026-09-26) — 원장·정산서·정산 카드가 같은 466,660 이다.
        paidOn: '2026-09-26', amount: 466660, payMethod: 'B',
        refundBank: '신한은행', refundAccount: '110-123-456789', refundHolder: '인쇄검증',
      });
      if (r.status !== 200) throw new Error(`정산 처리 실패 ${r.status} ${JSON.stringify(r.body)}`);
    },
    cleanup: async () => {
      const ids = (await db.query('SELECT contract_id FROM public.tb_s080_contracts WHERE memo = $1', [TAG])).rows.map((r) => r.contract_id);
      if (ids.length > 0) {
        await db.query('DELETE FROM public.tb_s080_deposit_ledger WHERE contract_id = ANY($1::text[])', [ids]);
        await db.query('DELETE FROM public.tb_s080_settlements WHERE contract_id = ANY($1::text[])', [ids]);
        await db.query(`DELETE FROM public.tb_s080_payments p USING public.tb_s080_invoices i
                         WHERE i.invoice_id = p.invoice_id AND i.contract_id = ANY($1::text[])`, [ids]);
        await db.query('DELETE FROM public.tb_s080_invoices WHERE contract_id = ANY($1::text[])', [ids]);
        await db.query('DELETE FROM public.tb_s080_contracts WHERE contract_id = ANY($1::text[])', [ids]);
      }
      const left = (await db.query('SELECT count(*)::int n FROM public.tb_s080_contracts WHERE memo = $1', [TAG])).rows[0].n;
      check('검증용 계약을 지웠다', left === 0, `${ids.length}건 삭제`);
      await db.end();
    },
  };
}

const DOCS = [
  { kind: 'usage', name: '이용계약서', pages: 1 },
  { kind: 'sublease', name: '전대차계약서', pages: 3 },
];

(async () => {
  const temp = await createTempContract();
  const contractId = process.argv[2] || temp.contractId;
  console.log(`계약 ${contractId.slice(0, 8)} 로 실제 PDF 를 뽑는다\n`);

  try {
  await withChrome(async (send) => {
    for (const doc of DOCS) {
      console.log(`── ${doc.name}`);
      const pdf = await printDoc(send, contractId, doc.kind);
      check(`${doc.name} ${doc.pages}장`, pageCount(pdf) === doc.pages, `${pageCount(pdf)}장`);

      const pages = contentStreams(pdf);
      let total = 0;
      let risky = 0;
      const where = [];
      for (const content of pages) {
        for (const line of riskyLines(content)) {
          total++;
          if (line.covered.length > 0) { risky++; where.push(`y=${line.y}`); }
        }
      }
      /*
       * ★★ 이 줄이 이 검사의 본체다. 0 이어야 한다.
       *    0 이 아니면 그 선은 **뷰어에 따라 사라진다** — 화면으로는 못 잡는다.
       */
      check(`${doc.name} 가로선이 뒤에 칠해지는 배경에 안 맞닿는다`, risky === 0,
        `위태 ${risky} / 가로선 ${total}${where.length ? `  (${where.slice(0, 6).join(' ')})` : ''}`);

      if (doc.kind === 'usage') {
        check(`${doc.name} 가로선이 충분히 있다`, total >= 40, `${total}개 — 칸마다 스스로 그린다`);
      }
    }

    /* ── 중도해지 정산서 — 검증용 계약을 9/10 에 해지하고 정산 처리까지 한 뒤 뽑는다 ── */
    console.log('── 중도해지 정산서');
    await temp.terminate();
    await temp.process();
    const { pdf, text } = await printSettlement(send, temp.companyId, temp.contractId);
    check('중도해지 정산서 1장', pageCount(pdf) === 1, `${pageCount(pdf)}장`);

    let total = 0;
    let risky = 0;
    for (const content of contentStreams(pdf)) {
      for (const line of riskyLines(content)) {
        total++;
        if (line.covered.length > 0) risky++;
      }
    }
    check('중도해지 정산서 가로선이 뒤에 칠해지는 배경에 안 맞닿는다', risky === 0, `위태 ${risky} / 가로선 ${total}`);
    check('중도해지 정산서 가로선이 충분히 있다', total >= 12, `${total}개`);

    // 내용 — 인쇄 직전의 문서에서 읽는다(PDF 글자는 글꼴 부호라 읽기 어렵다)
    check('실제 이용 기간 「2026.09.01 ~ 2026.09.10 (10일)」', text.includes('2026.09.01 ~ 2026.09.10 (10일)'));
    check('할인 환수 근거 조항 「전대차계약서 제8조 3항」', text.includes('전대차계약서 제8조 3항'));
    // ★ 무상 환수는 조항이 없다 — 근거가 특기사항의 자동 줄이다(`FREE_CLAWBACK_BASIS`).
    check('무상 환수 근거 「전대차계약서 특기사항」', text.includes('전대차계약서 특기사항'));
    // ★★ 순정산금은 10원 미만을 버린다 — 466,667 → 466,660. 절사 줄도 같이 찍힌다.
    check('환불할 금액 466,660원 (10원 미만 버림)', text.includes('환불할 금액') && text.includes('466,660원'));
    check('절사 줄 — 7원 · 10원 미만 버림', text.includes('절사') && text.includes('10원 미만 버림'));
    check('환불 계좌 — 전체 번호', text.includes('신한은행 110-123-456789'));
    check('서명란이 없다', !text.includes('서명') && !text.includes('(인)'));
  });
  } finally {
    await temp.cleanup();
  }

  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${results.length}항목 — 통과 ${results.length - bad} · 실패 ${bad}`);
  if (bad > 0) {
    console.log('✘ 인쇄 검증 실패 — doc/CONTRACT_DOCUMENTS.md §I 를 볼 것');
    process.exit(1);
  }
  console.log('✔ 인쇄 검증 전부 통과');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
