/**
 * 아이콘 모듈 생성 — svg/*.svg → icons.generated.ts
 *
 * 왜 로컬인가: DS 원본 Icon.jsx 는 unpkg 에서 SVG 를 fetch 한다.
 *   - CDN 이 죽으면 로그인 화면의 아이콘이 통째로 사라진다
 *   - 외부 요청이라 CSP(SEC-01)에 도메인을 열어야 한다
 *   - 런타임 fetch 라 첫 페인트에 아이콘이 늦게 뜬다
 * 번들에 넣으면 셋 다 사라진다.
 *
 * 왜 이름을 타입으로 좁히는가: lucide 는 `circle-check` 가 맞고 `check-circle` 은
 *   404 다(실제 확인). 그런데 **오타는 에러를 내지 않는다** — 아이콘이 안 보일 뿐이고
 *   콘솔도 조용하다. 유니온 타입으로 좁혀 컴파일에서 잡는다.
 *   유니온은 svg 폴더에 있는 파일에서 생성되므로 손으로 유지보수하지 않는다.
 *
 * 사용:
 *   node scripts/build-icons.js          생성물이 svg 폴더와 맞는지 확인 (다르면 exit 1)
 *   node scripts/build-icons.js --write  다시 생성
 *
 * 아이콘 추가: svg/ 에 lucide-static@0.414.0 의 svg 를 넣고 --write 로 다시 만든다.
 *   https://unpkg.com/lucide-static@0.414.0/icons/<name>.svg
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SVG_DIR = path.join(REPO_ROOT, 'packages', 'web', 'src', 'components', 'icons', 'svg');
const OUT = path.join(REPO_ROOT, 'packages', 'web', 'src', 'components', 'icons', 'icons.generated.ts');
const write = process.argv.includes('--write');

const names = fs.readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
if (names.length === 0) { console.error(`svg 없음: ${SVG_DIR}`); process.exit(2); }

/** <svg> 안쪽 마크업만 뽑는다. width/height/class 는 컴포넌트가 정하므로 버린다. */
function innerMarkup(svg) {
  const m = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if (!m) return null;
  return m[1]
    .replace(/\s*\n\s*/g, '')
    .trim();
}

const entries = [];
for (const n of names) {
  const raw = fs.readFileSync(path.join(SVG_DIR, `${n}.svg`), 'utf8');
  const inner = innerMarkup(raw);
  if (!inner) { console.error(`svg 파싱 실패: ${n}.svg`); process.exit(2); }
  entries.push([n, inner]);
}

const body = `/**
 * 자동 생성 파일 — 손으로 고치지 않는다.
 * 원본: packages/web/src/components/icons/svg/*.svg (lucide-static v0.414.0, ISC)
 * 갱신: node scripts/build-icons.js --write
 */

/** 1차에서 쓰는 아이콘 이름. svg 폴더에 있는 것만 존재한다. */
export type IconName =
${names.map((n) => `  | '${n}'`).join('\n')};

/** <svg> 안쪽 마크업. viewBox 24x24, stroke=currentColor 를 전제한다. */
export const ICON_MARKUP: Record<IconName, string> = {
${entries.map(([n, inner]) => `  '${n}': ${JSON.stringify(inner)},`).join('\n')}
};

export const ICON_NAMES = Object.keys(ICON_MARKUP) as IconName[];
`;

if (write) {
  fs.writeFileSync(OUT, body, 'utf8');
  console.log(`생성: ${path.relative(REPO_ROOT, OUT)} (${names.length}종: ${names.join(', ')})`);
  process.exit(0);
}

if (!fs.existsSync(OUT)) { console.error(`생성물 없음: ${OUT} (--write 로 먼저 만들 것)`); process.exit(2); }
const current = fs.readFileSync(OUT, 'utf8');
if (current === body) {
  console.log(`OK  아이콘 ${names.length}종 — 생성물이 svg 와 일치`);
  process.exit(0);
}
console.error('NG  생성물이 svg 폴더와 다르다. node scripts/build-icons.js --write 로 다시 만들 것');
process.exit(1);
