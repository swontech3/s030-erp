/**
 * 같이 쓰는 코드 — 이메일 도메인 · 국가 · 시간대(통합 방 · 대표 결정 2026-11-18).
 *
 * 주인은 삐용이다(`docs/코드주인_나누기_20261118.md` 「같이 씀」). ERP 서버가 삐용 서버 키 주소
 * (`GET /rest/v1/code-server/code-values`, 명세 118 의 7)로 받아 쓴다 — 사람 토큰 없이.
 *
 * =============================================================================
 * ★★ 받은 것을 잠시 보관한다 — 삐용이 잠깐 멈춰도 마지막 값으로 화면이 뜬다
 * =============================================================================
 *   · 받은 값은 `FRESH_MS`(5분) 동안 그대로 쓴다 — 계약 폼을 열 때마다 삐용을 부르지 않는다
 *   · 그 뒤에는 다시 받는다. **못 받으면 마지막으로 받은 값**을 쓴다(기록 한 줄). 한 번도 못 받았으면 빈 목록
 *   · ERP 코드 관리 화면에서 그 종류를 고치면 보관을 비운다(`forget`) — 다음 읽기가 새 값을 받는다
 * ★ 보관은 이 프로세스 메모리뿐이다(다시 띄우면 비어 있다). DB 에 복사하지 않는다 — 정본은 삐용 표다.
 * ★ 사용 안 함 줄(`useYn: 'N'`)은 내주지 않는다 — 선택지에서 빠진다(삐용 `retrieve-code` 와 같다).
 */
import { DEFAULT_CODE_CATEGORY, type BbiyongCodeServerReader, type BbiyongCodeValue } from './codes.ts';

/** 같이 쓰는 종류 — 이 셋만 서버 키로 받는다. */
export const SHARED_CODE_TYPES = ['EMAIL_DOMAIN', 'COUNTRY', 'COUNTRY_TZ'] as const;
export type SharedCodeType = (typeof SHARED_CODE_TYPES)[number];

export const SHARED_CODES_FRESH_MS = 5 * 60 * 1000;

export interface SharedCodesLog {
  warn(obj: object, msg?: string): void;
}

export interface SharedCodes {
  /** 쓰는 줄(사용 중)만, 순서대로. 던지지 않는다. */
  values(cdTp: SharedCodeType, log?: SharedCodesLog): Promise<BbiyongCodeValue[]>;
  /** 보관을 비운다 — 코드 관리에서 고친 뒤. 종류를 안 주면 전부. */
  forget(cdTp?: string): void;
}

export function isSharedCodeType(cdTp: string): cdTp is SharedCodeType {
  return (SHARED_CODE_TYPES as readonly string[]).includes(cdTp);
}

export function createSharedCodes(
  reader: BbiyongCodeServerReader,
  opts: { freshMs?: number; now?: () => number } = {},
): SharedCodes {
  const freshMs = opts.freshMs ?? SHARED_CODES_FRESH_MS;
  const now = opts.now ?? Date.now;
  const kept = new Map<string, { at: number; rows: BbiyongCodeValue[] }>();

  return {
    async values(cdTp, log) {
      const last = kept.get(cdTp);
      if (last && now() - last.at < freshMs) return last.rows;
      try {
        const rows = (await reader.listValues(DEFAULT_CODE_CATEGORY, cdTp))
          .filter((r) => r.useYn === 'Y')
          .sort((a, b) => (a.sortSeq ?? Number.MAX_SAFE_INTEGER) - (b.sortSeq ?? Number.MAX_SAFE_INTEGER) || a.cdV.localeCompare(b.cdV));
        kept.set(cdTp, { at: now(), rows });
        return rows;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        (log ?? console).warn(
          { cdTp, reason, kept: last ? last.rows.length : 0 },
          last ? '[같이 쓰는 코드] 삐용에서 받지 못해 마지막 값을 쓴다' : '[같이 쓰는 코드] 삐용에서 받지 못했고 보관한 값도 없다 — 빈 목록',
        );
        return last ? last.rows : [];
      }
    },
    forget(cdTp) {
      if (cdTp === undefined) kept.clear();
      else kept.delete(cdTp);
    },
  };
}
