/**
 * 환경 파일 읽기 — **한 폴더(저장소 밖)의 네 파일**을 읽는 자리를 하나로 모은다(결정 2026-10-24).
 *
 *   폴더   SWONBIZ_ENV_DIR (없으면 C:\workspace\env\) — 운영 서버는 이 칸 하나로 옮긴다
 *   파일   common.env · erp-api.env · erp-web.env · admin.env  (세무 tax.env 는 나중)
 *
 *   읽는 쪽          파일
 *   API 서버         common + erp-api
 *   화면(Next.js)    common + erp-web
 *   스크립트         common + admin (+ erp-api — erp_app 으로 RLS 를 재는 것)
 *
 * ★ 관리자 계정(postgres)은 admin.env 에만 있다. API · 화면은 admin 을 읽지 않는다.
 * ★ 같은 칸이 두 파일에 있으면 **멈춘다.** `process.loadEnvFile` 은 먼저 읽은 값을
 *   덮어쓰지 않아서, 겹쳐 두면 조용히 앞 파일이 이긴다 — 루트 `.env` 와 `packages/api/.env`
 *   가 그렇게 갈렸었다(2026-09-20, env.ts 주석).
 * ★ 이름을 댄 파일이 없으면 **멈춘다.** 한 파일만 빠진 채 뜨면 무엇이 빠졌는지 모른다.
 *
 * 옛 경로로 돌아가는 장치(옮기는 동안만 — 다 옮기면 걷어낸다):
 *   새 **폴더 자체가 없을 때만** `legacy` 로 준 옛 `.env` 를 읽는다. 폴더는 있는데 파일이
 *   빠졌으면 돌아가지 않고 멈춘다 — 새 것과 옛 것이 섞여 뜨는 것을 막는다.
 *   옛 파일끼리는 원래 칸이 겹친다(SUPABASE_* 등). 그래서 옛 경로에서는 겹쳐도 멈추지 않고
 *   **앞에 준 파일이 이긴다** — 지금 각 쪽이 읽는 순서를 그대로 옮겨 적으면 동작이 같다.
 *
 * 이 파일은 TS 가 아니라 JS 다 — `node` 로 바로 도는 CommonJS 스크립트도 `require()` 로
 * 읽어야 해서다(Node 24 는 ESM 을 require 할 수 있다). 타입은 envFiles.d.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** 읽을 수 있는 파일 이름. 오타로 없는 파일을 찾지 않게 여기서 막는다. */
export const ENV_FILE_NAMES = ['common', 'erp-api', 'erp-web', 'admin'];

export const DEFAULT_ENV_DIR = 'C:\\workspace\\env';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** 새 폴더 위치. */
export function envDir() {
  return process.env.SWONBIZ_ENV_DIR || DEFAULT_ENV_DIR;
}

function parseFile(path) {
  if (!existsSync(path)) throw new Error(`[env] 환경 파일이 없다: ${path}`);
  return parseEnv(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

/**
 * 파일들을 읽어 칸 → 값 객체로 돌려준다. **`process.env` 는 건드리지 않는다**(스크립트용).
 *
 * @param {string[]} names       ENV_FILE_NAMES 중에서
 * @param {{ legacy?: string[] }} [opts]  새 폴더가 없을 때 읽을 옛 `.env` (저장소 루트 기준 또는 절대경로)
 * @returns {Record<string, string>}
 */
export function readEnvFiles(names, opts = {}) {
  const unknown = names.filter((n) => !ENV_FILE_NAMES.includes(n));
  if (unknown.length > 0) {
    throw new Error(`[env] 모르는 환경 파일 이름: ${unknown.join(', ')} — ${ENV_FILE_NAMES.join(' · ')} 중에서`);
  }

  const dir = envDir();
  if (!existsSync(dir)) {
    if (!opts.legacy || opts.legacy.length === 0) {
      throw new Error(`[env] 환경 폴더가 없다: ${dir} — SWONBIZ_ENV_DIR 를 확인할 것.`);
    }
    console.warn(`[env] 환경 폴더가 없어 옛 경로를 읽는다: ${opts.legacy.join(' · ')}`);
    const out = {};
    for (const p of opts.legacy) {
      const values = parseFile(isAbsolute(p) ? p : join(REPO_ROOT, p));
      for (const [k, v] of Object.entries(values)) if (!(k in out)) out[k] = v;
    }
    return out;
  }

  const out = {};
  const from = {};
  const dup = [];
  for (const name of names) {
    const file = `${name}.env`;
    for (const [k, v] of Object.entries(parseFile(join(dir, file)))) {
      if (k in out) dup.push(`${k} (${from[k]} · ${file})`);
      else {
        out[k] = v;
        from[k] = file;
      }
    }
  }
  // 값은 적지 않는다 — 칸 이름과 파일 이름만.
  if (dup.length > 0) throw new Error(`[env] 같은 칸이 두 파일에 있다: ${dup.join(', ')}`);
  return out;
}

/**
 * 파일들을 읽어 `process.env` 에 넣는다. **이미 있는 칸은 덮어쓰지 않는다**
 * (`process.loadEnvFile` 과 같다 — OS 환경변수 · 시험이 넣은 값이 이긴다).
 *
 * @param {string[]} names
 * @param {{ legacy?: string[] }} [opts]
 */
export function loadEnvFiles(names, opts = {}) {
  for (const [k, v] of Object.entries(readEnvFiles(names, opts))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
