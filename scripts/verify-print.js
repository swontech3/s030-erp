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
 *           계약ID 를 안 주면 DB 에서 확정 계약 하나를 고른다.
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

function readEnv(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

async function pickContract() {
  const env = readEnv('.env');
  const c = new Client({ host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  await c.connect();
  try {
    const r = await c.query(`SELECT contract_id FROM public.tb_s080_contracts WHERE status = 'confirmed' ORDER BY created_at LIMIT 1`);
    if (r.rows.length === 0) throw new Error('확정된 계약이 없다 — 계약 하나를 확정하고 다시 돌려라');
    return r.rows[0].contract_id;
  } finally {
    await c.end();
  }
}

const DOCS = [
  { kind: 'usage', name: '이용계약서', pages: 1 },
  { kind: 'sublease', name: '전대차계약서', pages: 3 },
];

(async () => {
  const contractId = process.argv[2] || (await pickContract());
  console.log(`계약 ${contractId.slice(0, 8)} 로 실제 PDF 를 뽑는다\n`);

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
  });

  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 ${results.length}항목 — 통과 ${results.length - bad} · 실패 ${bad}`);
  if (bad > 0) {
    console.log('✘ 인쇄 검증 실패 — doc/CONTRACT_DOCUMENTS.md §I 를 볼 것');
    process.exit(1);
  }
  console.log('✔ 인쇄 검증 전부 통과');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
