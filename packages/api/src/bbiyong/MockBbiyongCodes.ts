/**
 * 모의 삐용 공통 코드 — `BBIYONG_MOCK=true` 로 개발할 때 코드 관리 화면 · 같이 쓰는 코드가 돈다(2026-11-18).
 *
 * ★ 프로세스 메모리에만 둔다(다시 띄우면 처음으로). 화면 토큰 · 서버 키 두 갈래가 **같은 저장소**를 본다 —
 *   코드 관리에서 고친 값이 계약 폼의 이메일 도메인에 그대로 나와야 실연동과 같다.
 * ★ 권한은 보지 않는다(모의는 늘 허락) — 실연동에서는 삐용이 S030100030 VIEW · UPDATE 로 가른다.
 * ★ 들어 있는 값 : EMAIL_DOMAIN 다섯 줄은 명세 118 의 삐용 줄 그대로(순서 naver 1 · daum 2 · gmail 3 ·
 *   hanmail 4 · nate 5). COUNTRY · COUNTRY_TZ 는 **모의 값**이다(삐용 실제 줄은 개발계에서 본다).
 */
import {
  DEFAULT_CODE_CATEGORY,
  type BbiyongCodeAdmin,
  type BbiyongCodeKey,
  type BbiyongCodeOutcome,
  type BbiyongCodeServerReader,
  type BbiyongCodeType,
  type BbiyongCodeValue,
  type BbiyongCodeWrite,
} from './codes.ts';

interface Row {
  category: string;
  cdTp: string;
  cdTpMeaning: string;
  cdV: string;
  cdVMeaning: string;
  sortSeq: number;
  useYn: 'Y' | 'N';
}

const SEED: readonly Omit<Row, 'category' | 'useYn'>[] = [
  { cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '이메일도메인', cdV: 'naver.com', cdVMeaning: 'naver.com', sortSeq: 1 },
  { cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '이메일도메인', cdV: 'daum.net', cdVMeaning: 'daum.net', sortSeq: 2 },
  { cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '이메일도메인', cdV: 'gmail.com', cdVMeaning: 'gmail.com', sortSeq: 3 },
  { cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '이메일도메인', cdV: 'hanmail.net', cdVMeaning: 'hanmail.net', sortSeq: 4 },
  { cdTp: 'EMAIL_DOMAIN', cdTpMeaning: '이메일도메인', cdV: 'nate.com', cdVMeaning: 'nate.com', sortSeq: 5 },
  { cdTp: 'COUNTRY', cdTpMeaning: '국가', cdV: 'KR', cdVMeaning: '대한민국', sortSeq: 1 },
  { cdTp: 'COUNTRY_TZ', cdTpMeaning: '국가시간대', cdV: 'KR', cdVMeaning: 'Asia/Seoul', sortSeq: 1 },
];

const ok = <T>(value: T): BbiyongCodeOutcome<T> => ({ kind: 'ok', value });
const no = (message: string): BbiyongCodeOutcome<never> => ({ kind: 'rejected', message });

export class MockBbiyongCodes implements BbiyongCodeAdmin {
  readonly #rows: Row[] = SEED.map((r) => ({ ...r, category: DEFAULT_CODE_CATEGORY, useYn: 'Y' }));

  #find(k: BbiyongCodeKey): Row | undefined {
    return this.#rows.find((r) => r.category === k.category && r.cdTp === k.cdTp && r.cdV === k.cdV);
  }

  #values(category: string, cdTp: string): BbiyongCodeValue[] {
    return this.#rows
      .filter((r) => r.category === category && r.cdTp === cdTp)
      .sort((a, b) => a.sortSeq - b.sortSeq || a.cdV.localeCompare(b.cdV))
      .map((r) => ({ ...r }));
  }

  async listTypes(): Promise<BbiyongCodeOutcome<BbiyongCodeType[]>> {
    const types = new Map<string, BbiyongCodeType>();
    for (const r of this.#rows) {
      const key = `${r.category}\u0000${r.cdTp}`;
      const t = types.get(key) ?? { category: r.category, cdTp: r.cdTp, cdTpMeaning: r.cdTpMeaning, valueCnt: 0, useCnt: 0 };
      t.valueCnt += 1;
      if (r.useYn === 'Y') t.useCnt += 1;
      types.set(key, t);
    }
    return ok([...types.values()].sort((a, b) => a.category.localeCompare(b.category) || a.cdTp.localeCompare(b.cdTp)));
  }

  async listValues(category: string, cdTp: string): Promise<BbiyongCodeOutcome<BbiyongCodeValue[]>> {
    return ok(this.#values(category, cdTp));
  }

  async addValue(b: BbiyongCodeWrite): Promise<BbiyongCodeOutcome<string>> {
    const type = this.#rows.find((r) => r.category === b.category && r.cdTp === b.cdTp);
    if (!type) return no('없는 코드 종류입니다.');
    const cdV = b.cdV.trim();
    const name = b.cdVMeaning.trim();
    if (!cdV || !name) return no('코드값과 이름을 넣어 주세요.');
    const same = this.#find({ ...b, cdV });
    if (same) return no(same.useYn === 'N' ? '같은 코드값이 「사용 안 함」으로 있습니다.' : '같은 코드값이 있습니다.');
    const last = Math.max(0, ...this.#rows.filter((r) => r.category === b.category && r.cdTp === b.cdTp).map((r) => r.sortSeq));
    this.#rows.push({
      category: b.category, cdTp: b.cdTp, cdTpMeaning: type.cdTpMeaning, cdV, cdVMeaning: name,
      sortSeq: b.sortSeq ?? last + 1, useYn: 'Y',
    });
    return ok('추가했습니다.');
  }

  async updateValue(b: BbiyongCodeWrite): Promise<BbiyongCodeOutcome<string>> {
    const row = this.#find(b);
    if (!row) return no('없는 코드값입니다.');
    const name = b.cdVMeaning.trim();
    if (!name) return no('코드값과 이름을 넣어 주세요.');
    row.cdVMeaning = name;
    if (b.sortSeq !== undefined && b.sortSeq !== null) row.sortSeq = b.sortSeq;
    return ok('수정했습니다.');
  }

  async unuseValue(k: BbiyongCodeKey): Promise<BbiyongCodeOutcome<string>> {
    const row = this.#find(k);
    if (!row) return no('없는 코드값입니다.');
    if (row.useYn === 'N') return no('이미 사용 안 함인 코드값입니다.');
    row.useYn = 'N';
    return ok('사용 안 함으로 바꿨습니다.');
  }

  async reuseValue(k: BbiyongCodeKey): Promise<BbiyongCodeOutcome<string>> {
    const row = this.#find(k);
    if (!row) return no('없는 코드값입니다.');
    if (row.useYn === 'Y') return no('이미 사용 중인 코드값입니다.');
    row.useYn = 'Y';
    return ok('다시 사용으로 바꿨습니다.');
  }
}

/** 모의 서버 키 읽기 — 같은 저장소를 본다. ★ 화면 토큰 쪽과 이름이 같아 감싼다(`BbiyongCodeServerReader`). */
export function mockServerReaderOf(mock: MockBbiyongCodes): BbiyongCodeServerReader {
  return {
    listValues: async (category, cdTp) => {
      const out = await mock.listValues(category, cdTp);
      return out.kind === 'ok' ? out.value : [];
    },
  };
}
