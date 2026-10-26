import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFiles, readEnvFiles } from './envFiles.js';

// 값은 전부 시험용 가짜다.
let root: string;
let dir: string;
const savedDir = process.env.SWONBIZ_ENV_DIR;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'envfiles-'));
  dir = join(root, 'env');
  process.env.SWONBIZ_ENV_DIR = dir;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.SWONBIZ_ENV_DIR;
  else process.env.SWONBIZ_ENV_DIR = savedDir;
});

function writeEnv(name: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.env`), body);
}

describe('readEnvFiles', () => {
  it('이름을 댄 파일을 합쳐 돌려준다', () => {
    writeEnv('common', 'T_A=1\n');
    writeEnv('erp-api', '﻿T_B="two words"\n# 주석\n');
    expect(readEnvFiles(['common', 'erp-api'])).toEqual({ T_A: '1', T_B: 'two words' });
  });

  it('같은 칸이 두 파일에 있으면 멈춘다 — 값은 오류 문구에 넣지 않는다', () => {
    writeEnv('common', 'T_DUP=secret-a\n');
    writeEnv('erp-api', 'T_DUP=secret-b\n');
    expect(() => readEnvFiles(['common', 'erp-api'])).toThrow(/T_DUP \(common\.env · erp-api\.env\)/);
    try {
      readEnvFiles(['common', 'erp-api']);
    } catch (e) {
      expect(String(e)).not.toMatch(/secret/);
    }
  });

  it('폴더는 있는데 파일이 없으면 옛 경로로 돌아가지 않고 멈춘다', () => {
    writeEnv('common', 'T_A=1\n');
    const legacy = join(root, 'old.env');
    writeFileSync(legacy, 'T_A=old\n');
    expect(() => readEnvFiles(['common', 'erp-api'], { legacy: [legacy] })).toThrow(/erp-api\.env/);
  });

  it('모르는 파일 이름이면 멈춘다', () => {
    writeEnv('common', '');
    expect(() => readEnvFiles(['commn' as never])).toThrow(/모르는 환경 파일 이름/);
  });

  it('폴더가 없고 옛 경로도 없으면 멈춘다', () => {
    expect(() => readEnvFiles(['common'])).toThrow(/환경 폴더가 없다/);
  });

  it('폴더가 없으면 옛 경로를 읽는다 — 겹치면 앞에 준 파일이 이긴다', () => {
    const a = join(root, 'a.env');
    const b = join(root, 'b.env');
    writeFileSync(a, 'T_X=from-a\n');
    writeFileSync(b, 'T_X=from-b\nT_Y=only-b\n');
    expect(readEnvFiles(['common', 'erp-api'], { legacy: [a, b] })).toEqual({ T_X: 'from-a', T_Y: 'only-b' });
  });

  it('옛 파일이 없으면 멈춘다', () => {
    expect(() => readEnvFiles(['common'], { legacy: [join(root, 'none.env')] })).toThrow(/환경 파일이 없다/);
  });
});

describe('loadEnvFiles', () => {
  it('이미 있는 process.env 칸은 덮어쓰지 않는다', () => {
    writeEnv('common', 'T_KEEP=file\nT_NEW=file\n');
    process.env.T_KEEP = 'os';
    try {
      loadEnvFiles(['common']);
      expect(process.env.T_KEEP).toBe('os');
      expect(process.env.T_NEW).toBe('file');
    } finally {
      delete process.env.T_KEEP;
      delete process.env.T_NEW;
    }
  });
});
