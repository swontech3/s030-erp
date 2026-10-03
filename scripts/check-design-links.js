/**
 * 디자인 템플릿의 자원 참조가 실제로 존재하는지 확인한다.
 *
 * 브라우저로 열지 않고도 "로드에 실패할 자원"을 미리 잡는다.
 * ds-base.js 가 base 상수로 붙이는 CSS·번들 경로와, .dc.html 안의 상대경로
 * (img src, link href, script src)를 전부 디스크에서 찾아본다.
 *
 * 사용: node scripts/check-design-links.js [템플릿폴더명]
 */
const fs = require('fs');
const path = require('path');

const DESIGN = 'design';
const only = process.argv[2];

// =============================================================================
// 알려진 누락 — 경고로 낮춘다. **영구 무시가 아니다.**
// =============================================================================
// 규칙 셋:
//   1) 여기 있는 자원이 없으면 WARN (검사는 통과)
//   2) 여기 **없는** 자원이 없으면 NG (검사 실패) — 기존 동작 그대로
//   3) ★ 여기 있는 자원이 **생기면 STALE 로 실패한다** — 디자인이 전달한 순간 이 목록은
//      낡은 것이 되고, 지우지 않으면 다음 누락을 이 항목이 가려 버린다.
//      "회신이 오면 자동으로 다시 빨개진다"는 것이 3번이다.
// ★ 2026-10-01 — 공간 사진 7장 항목을 지웠다. 3번이 실제로 작동한 자리다:
//   사진은 2026-09-13 2차 인계분(`시안_2/assets/spaces/`)에 이미 들어와 있었는데
//   `_ds/swonbiz/assets/` 사본만 갱신이 안 돼서 18일 동안 아무도 몰랐다. 랜딩을
//   만들려고 사본을 채운 순간 이 스크립트가 STALE 7건으로 터졌다 — 그래서 알았다.
const KNOWN_MISSING = [];

const knownFor = (folder, url) =>
  KNOWN_MISSING.find((k) => k.folder === folder && k.urls.includes(url));

const folders = fs.readdirSync(DESIGN, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_ds')
  .map((d) => d.name)
  .filter((n) => !only || n === only);

let missing = 0;
let checked = 0;
let warned = 0;
const stale = [];

for (const folder of folders) {
  const dir = path.join(DESIGN, folder);
  const refs = [];

  // 1) ds-base.js 가 붙이는 것들
  const dsBase = path.join(dir, 'ds-base.js');
  if (fs.existsSync(dsBase)) {
    const js = fs.readFileSync(dsBase, 'utf8');
    const baseMatch = js.match(/const base\s*=\s*'([^']+)'/);
    const base = baseMatch ? baseMatch[1] : null;
    if (!base) {
      console.log(`  [${folder}] ds-base.js 에서 base 상수를 못 찾음`);
    } else {
      const listMatch = js.match(/for \(const p of \[([^\]]+)\]/);
      const files = listMatch ? [...listMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
      for (const f of files) refs.push({ from: 'ds-base.js', url: `${base}/${f}` });
      refs.push({ from: 'ds-base.js', url: `${base}/_ds_bundle.js` });
    }
  }

  // 2) .dc.html 안의 상대경로
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.dc.html'))) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const re = /(?:src|href)\s*=\s*"((?!https?:|data:|#|mailto:|tel:|javascript:)[^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) refs.push({ from: file, url: m[1] });
  }

  const bad = [];
  const expected = [];
  const known = [];
  for (const r of refs) {
    checked++;
    const abs = path.resolve(dir, r.url);
    if (fs.existsSync(abs)) {
      // ★ 알려진 누락으로 등록해 둔 자원이 생겼다 = 디자인이 전달했다. 목록을 지워야 한다.
      const k = knownFor(folder, r.url);
      if (k) stale.push({ folder, url: r.url, recover: k.recover });
      continue;
    }
    // _ds_bundle.js 는 디자인이 "요청대로 제외"한 파일이다(design/_ds/swonbiz/README.md).
    // 없는 게 정상이고, 없으면 DS 컴포넌트(<x-import>)만 렌더되지 않는다 —
    // 토큰 CSS·인라인 스타일로 만들어진 색·글꼴·간격은 영향을 받지 않는다.
    if (r.url.endsWith('_ds_bundle.js')) { expected.push(r); continue; }
    if (knownFor(folder, r.url)) { known.push(r); continue; }
    bad.push(r);
    missing++;
  }

  const note = expected.length ? `  (예상된 부재 ${expected.length}: _ds_bundle.js)` : '';
  if (bad.length === 0) {
    console.log(`OK  ${folder.padEnd(20)} 참조 ${refs.length}건 전부 존재${note}`);
  } else {
    console.log(`NG  ${folder.padEnd(20)} 참조 ${refs.length}건 중 ${bad.length}건 없음${note}`);
    for (const b of bad) console.log(`      ${b.from} → ${b.url}`);
  }
  if (known.length) {
    const k = knownFor(folder, known[0].url);
    console.log(`    WARN 알려진 누락 ${known.length}건 (${k.since} 등록) — ${k.reason}`);
    for (const w of known) console.log(`      ${w.from} → ${w.url}`);
    console.log(`    복구 조건: ${k.recover}`);
    warned += known.length;
  }
}

for (const s of stale) {
  console.log(`STALE ${s.folder} → ${s.url} 이(가) 이제 존재한다. KNOWN_MISSING 에서 지울 것.`);
  console.log(`      ${s.recover}`);
}

console.log(`\n총 ${checked}건 확인 · 없는 자원 ${missing}건 · 알려진 누락(경고) ${warned}건 · 낡은 예외 ${stale.length}건`);
process.exit(missing > 0 || stale.length > 0 ? 1 : 0);
