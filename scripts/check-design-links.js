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

const folders = fs.readdirSync(DESIGN, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_ds')
  .map((d) => d.name)
  .filter((n) => !only || n === only);

let missing = 0;
let checked = 0;

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
  for (const r of refs) {
    checked++;
    const abs = path.resolve(dir, r.url);
    if (fs.existsSync(abs)) continue;
    // _ds_bundle.js 는 디자인이 "요청대로 제외"한 파일이다(design/_ds/swonbiz/README.md).
    // 없는 게 정상이고, 없으면 DS 컴포넌트(<x-import>)만 렌더되지 않는다 —
    // 토큰 CSS·인라인 스타일로 만들어진 색·글꼴·간격은 영향을 받지 않는다.
    if (r.url.endsWith('_ds_bundle.js')) { expected.push(r); continue; }
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
}

console.log(`\n총 ${checked}건 확인 · 없는 자원 ${missing}건`);
process.exit(missing > 0 ? 1 : 0);
