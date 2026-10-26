// envFiles.js 의 타입 — 설명은 그 파일에 있다.
export type EnvFileName = 'common' | 'erp-api' | 'erp-web' | 'admin';

export interface EnvFilesOptions {
  /** 새 폴더가 없을 때만 읽는 옛 `.env` (저장소 루트 기준 또는 절대경로). 앞에 준 파일이 이긴다. */
  legacy?: string[];
}

export const ENV_FILE_NAMES: readonly EnvFileName[];
export const DEFAULT_ENV_DIR: string;
export function envDir(): string;
export function readEnvFiles(names: EnvFileName[], opts?: EnvFilesOptions): Record<string, string>;
export function loadEnvFiles(names: EnvFileName[], opts?: EnvFilesOptions): void;
