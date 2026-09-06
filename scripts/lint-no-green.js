/**
 * 녹색 금지 lint (PLAT-05).
 *
 * 디자인 규칙: 어떤 경우에도 녹색을 쓰지 않는다. 완료·성공도 인디고로 표현한다
 * (design/_ds/swonbiz/tokens/colors.css 주석에 명문화되어 있다).
 * 사람이 지키는 규칙은 언젠가 깨지므로 빌드에서 막는다.
 *
 * 검사 대상: packages/<pkg>/src 의 .css .ts .tsx .js .jsx
 * 검사 제외: design/_ds/ 트리 — 디자인 소유 자산이라 개발이 고치지 않는다.
 *            node_modules · .next · public 도 제외.
 *
 * ※ packages/web/src/styles/tokens.css 는 디자인에서 이관해 온 사본이지만 검사한다.
 *   지금은 녹색이 없고, 다음 전달분에 녹색이 섞여 들어오면 빌드가 멈춰서 알 수 있다.
 *   그때 고치는 곳은 이 사본이 아니라 디자인 원본이다.
 *
 * 사용: node scripts/lint-no-green.js
 * 종료코드: 0 = 없음 / 1 = 녹색 발견 / 2 = 실행 실패
 */
const fs = require('fs');
const path = require('path');

/**
 * ★ 경로는 cwd 가 아니라 이 스크립트 위치에서 잡는다.
 *   npm run build 는 packages/web 에서 돌기 때문에, 'packages' 를 상대경로로 쓰면
 *   검사 대상이 0개가 되고 **아무것도 안 잡으면서 통과한다**. 실제로 그렇게 새어서
 *   잡았다(2026-09-06). 검사가 조용히 통과하는 것이 가장 나쁜 실패 방식이다.
 */
const REPO_ROOT = path.resolve(__dirname, '..');
const ROOTS = [path.join(REPO_ROOT, 'packages')];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'public', '_ds']);
const EXTS = new Set(['.css', '.ts', '.tsx', '.js', '.jsx']);

/** 녹색 계열로 볼 색상 이름 (CSS named colors 중 녹색 색상환에 있는 것). */
const GREEN_NAMES = [
  'green', 'darkgreen', 'lightgreen', 'forestgreen', 'seagreen', 'mediumseagreen',
  'darkseagreen', 'lightseagreen', 'springgreen', 'mediumspringgreen', 'limegreen',
  'lime', 'olive', 'olivedrab', 'darkolivegreen', 'yellowgreen', 'greenyellow',
  'chartreuse', 'lawngreen', 'palegreen', 'honeydew', 'mintcream',
];

/** 색상환에서 녹색으로 보는 구간. 시안(--color-accent #22D3EE 는 188°)은 들어오지 않는다. */
const HUE_MIN = 75;
const HUE_MAX = 165;
const SAT_MIN = 0.15;   // 회색에 가까우면 색으로 치지 않는다
const LIGHT_MIN = 0.08; // 거의 검정
const LIGHT_MAX = 0.94; // 거의 흰색

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

const isGreenHsl = ({ h, s, l }) =>
  h >= HUE_MIN && h <= HUE_MAX && s >= SAT_MIN && l >= LIGHT_MIN && l <= LIGHT_MAX;

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  else h = h.slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** 주석을 지운다 — colors.css 의 "no green under any circumstance" 같은 문장에 걸리지 않게. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

function findViolations(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const lines = src.split(/\r?\n/);
  const out = [];

  lines.forEach((line, i) => {
    const hit = (literal, why) => out.push({ file, line: i + 1, literal, why });

    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0];
      if (![4, 5, 7, 9].includes(hex.length)) continue;
      const hsl = rgbToHsl(...hexToRgb(hex));
      if (isGreenHsl(hsl)) hit(hex, `hue ${hsl.h.toFixed(0)}°`);
    }

    for (const m of line.matchAll(/rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)/g)) {
      const hsl = rgbToHsl(+m[1], +m[2], +m[3]);
      if (isGreenHsl(hsl)) hit(m[0] + ')', `hue ${hsl.h.toFixed(0)}°`);
    }

    for (const m of line.matchAll(/hsla?\(\s*([0-9.]+)(?:deg)?\s*[, ]\s*([0-9.]+)%\s*[, ]\s*([0-9.]+)%/g)) {
      const hsl = { h: +m[1] % 360, s: +m[2] / 100, l: +m[3] / 100 };
      if (isGreenHsl(hsl)) hit(m[0] + ')', `hue ${hsl.h.toFixed(0)}°`);
    }

    for (const name of GREEN_NAMES) {
      // CSS 값 자리(`: green`) 또는 문자열 리터럴(`'green'`)만 본다.
      const re = new RegExp(`(?::\\s*|['"\`])${name}\\b`, 'i');
      if (re.test(line)) hit(name, '색상 이름');
    }
  });
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (EXTS.has(path.extname(e.name))) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

const files = ROOTS.filter(fs.existsSync).flatMap((r) => walk(r));

// 검사 대상이 0개면 "통과"가 아니라 설정 오류다. 조용히 넘어가지 않는다.
if (files.length === 0) {
  console.error(`설정 오류: 검사할 파일이 없다 (${ROOTS.join(', ')})`);
  process.exit(2);
}

const rel = (f) => path.relative(REPO_ROOT, f);
const violations = files.flatMap(findViolations);

if (violations.length === 0) {
  console.log(`OK  녹색 없음 — ${files.length}개 파일 검사`);
  process.exit(0);
}

console.error(`NG  녹색 계열 색상 ${violations.length}건 (${files.length}개 파일 검사)`);
for (const v of violations) {
  console.error(`    ${rel(v.file)}:${v.line}  ${v.literal}  (${v.why})`);
}
console.error('');
console.error('    이 프로젝트는 어떤 경우에도 녹색을 쓰지 않는다. 완료·성공도 인디고다.');
console.error('    (design/_ds/swonbiz/tokens/colors.css — "no green under any circumstance")');
process.exit(1);
