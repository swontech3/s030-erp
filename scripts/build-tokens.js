/**
 * 디자인 토큰 이관 + 대조.
 *
 * design/_ds/swonbiz/tokens/ 6파일을 **파일째 이어붙여**
 * packages/web/src/styles/tokens.css 를 만들고, 원본과 변수 단위로 대조한다.
 * 손으로 옮겨 적으면 값이 하나 달라져도 알 수 없으므로 이 스크립트만 쓴다.
 *
 * 사용:
 *   node scripts/build-tokens.js          대조만 (CI·점검용). 다르면 exit 1
 *   node scripts/build-tokens.js --write  다시 생성한 뒤 대조
 */
const fs = require('fs');
const path = require('path');

const ORDER = ['fonts', 'colors', 'typography', 'spacing', 'shape', 'base'];

/**
 * 이관 중 딱 두 군데만 바꾼다 — 웹폰트를 CDN 에서 자체 호스팅으로 돌린다.
 *
 * 왜: CDN 이 느리거나 막히면 로그인 화면에서 글꼴이 늦게 바뀌며 글자가 튀고(CLS),
 *     CSP(SEC-01)에 외부 도메인을 열어야 한다.
 * 근거: Pretendard·Inter 둘 다 SIL Open Font License 1.1 이라 재배포가 허용된다
 *      (각 저장소 LICENSE 확인. 원문을 packages/web/public/fonts/ 에 동봉했다).
 *
 * ★ 바꾸는 것은 파일 위치뿐이다. 패밀리 이름("Pretendard Variable"·"Inter")도,
 *   CSS 변수 119개도 건드리지 않는다 — 그래서 아래 변수 대조가 여전히 성립한다.
 */
const REWRITES = [
  ['https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2',
    '/fonts/PretendardVariable.woff2'],
  ['https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2',
    '/fonts/Inter-latin-wght-normal.woff2'],
];
const SRC_DIR = path.join('design', '_ds', 'swonbiz', 'tokens');
const OUT = path.join('packages', 'web', 'src', 'styles', 'tokens.css');
const write = process.argv.includes('--write');

/** `--name:value` 선언을 뽑는다. var(--x) 참조는 선언이 아니므로 제외된다. */
function declarations(css) {
  const out = new Map();
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) out.set(m[1], m[2].trim());
  return out;
}

const sources = ORDER.map((n) => {
  const p = path.join(SRC_DIR, `${n}.css`);
  if (!fs.existsSync(p)) { console.error(`원본 없음: ${p}`); process.exit(2); }
  return { name: n, path: p, css: fs.readFileSync(p, 'utf8') };
});

if (write) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const header = [
    '/* =============================================================================',
    ' * SwonBiz 디자인 토큰 — design/_ds/swonbiz/tokens/ 6파일을 파일째 이어붙인 것.',
    ' *',
    ' * ★ 손으로 옮겨 적지 않는다. 값이 하나라도 달라지면 원본과 대조가 불가능해진다.',
    ' *   갱신은 scripts/build-tokens.js --write 로 다시 만든다.',
    ' * ★ 개발이 토큰을 새로 만들지 않는다. 토큰 추가는 디자인 시스템 원본을 고치는',
    ' *   일이고, 임의로 이름을 지으면 다음 내보내기와 충돌한다.',
    ' *',
    ' * 이관 중 바꾼 것은 웹폰트 src 2건뿐이다 (CDN → 자체 호스팅, /public/fonts/).',
    ' * 패밀리 이름과 CSS 변수 119개는 원본 그대로다 — 대조로 확인한다.',
    ' *',
    ` * 원본:  ${SRC_DIR}/{${ORDER.join(',')}}.css`,
    ` * 생성:  ${stamp}`,
    ' * ============================================================================= */',
  ].join('\n');
  let body = sources.map((s) =>
    `\n/* ---- ${s.name}.css ------------------------------------------------------------- */\n${s.css}`).join('');
  for (const [from, to] of REWRITES) {
    if (!body.includes(from)) { console.error(`치환 대상을 못 찾음(원본이 바뀌었나?): ${from}`); process.exit(2); }
    body = body.split(from).join(to);
  }
  fs.writeFileSync(OUT, header + body, 'utf8');
  console.log(`생성: ${OUT} (웹폰트 src ${REWRITES.length}건 자체 호스팅으로 치환)`);
}

if (!fs.existsSync(OUT)) { console.error(`대상 없음: ${OUT} (--write 로 먼저 생성)`); process.exit(2); }

const srcDecl = new Map();
for (const s of sources) for (const [k, v] of declarations(s.css)) srcDecl.set(k, v);
const outDecl = declarations(fs.readFileSync(OUT, 'utf8'));

const missing = [...srcDecl.keys()].filter((k) => !outDecl.has(k));
const extra = [...outDecl.keys()].filter((k) => !srcDecl.has(k));
const changed = [...srcDecl.entries()].filter(([k, v]) => outDecl.has(k) && outDecl.get(k) !== v);

console.log(`원본 변수 ${srcDecl.size}개 / 이관본 ${outDecl.size}개`);
console.log(`  누락 ${missing.length} · 추가 ${extra.length} · 값 변경 ${changed.length}`);
for (const k of missing) console.log(`  누락  ${k}`);
for (const k of extra) console.log(`  추가  ${k} = ${outDecl.get(k)}   ← 개발이 만든 토큰이면 지운다`);
for (const [k, v] of changed) console.log(`  변경  ${k}: 원본 "${v}" → 이관본 "${outDecl.get(k)}"`);

// 외부 도메인이 하나도 남지 않았는지 — CSP(SEC-01)와 CLS 양쪽의 조건이다.
const outCss = fs.readFileSync(OUT, 'utf8');
const external = [...outCss.matchAll(/url\(\s*["']?(https?:\/\/[^"')]+)/g)].map((m) => m[1]);
console.log(`외부 URL ${external.length}건`);
for (const u of external) console.log(`  ★ 남아 있음: ${u}`);

const bad = missing.length + extra.length + changed.length + external.length;
console.log(bad === 0 ? 'OK  변수는 원본과 완전히 일치 · 외부 URL 없음' : 'NG  차이 있음');
process.exit(bad === 0 ? 0 : 1);
