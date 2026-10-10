import { describe, expect, it } from 'vitest';
import {
  CANCEL_REASON_MAX,
  buildSubmitSnapshot,
  parseSeenStatus,
  parseTransitionBody,
} from './corp-change-transition.ts';
import type { CorpChangeOfficerView } from './corp-change-detail.ts';

describe('parseTransitionBody', () => {
  it('★ 화면이 본 상태(from)가 없으면 400 — 보내지 않으면 낡은 화면이 상태를 덮는다', () => {
    const r = parseTransitionBody({ to: 'E' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors?.[0]?.field).toBe('from');
  });

  it('모르는 상태값은 400', () => {
    expect(parseTransitionBody({ from: 'P', to: 'S' }).ok).toBe(false);
    expect(parseTransitionBody({ from: 'Q', to: 'E' }).ok).toBe(false);
    expect(parseTransitionBody(null).ok).toBe(false);
    expect(parseTransitionBody([]).ok).toBe(false);
  });

  it('모양만 본다 — 표에 없는 전이도 여기서는 통과(판정은 checkTransition)', () => {
    expect(parseTransitionBody({ from: 'C', to: 'P' })).toEqual({ ok: true, value: { from: 'C', to: 'P', cancelReason: null } });
  });

  it('취소 사유 — 앞뒤 공백을 떼고, 비우면 null', () => {
    expect(parseTransitionBody({ from: 'E', to: 'X', cancelReason: '  고객 요청  ' })).toEqual({
      ok: true,
      value: { from: 'E', to: 'X', cancelReason: '고객 요청' },
    });
    expect(parseTransitionBody({ from: 'E', to: 'X', cancelReason: '   ' })).toEqual({
      ok: true,
      value: { from: 'E', to: 'X', cancelReason: null },
    });
  });

  it(`★ 취소 사유는 취소 때만 · ${CANCEL_REASON_MAX}자까지 · 글자만`, () => {
    expect(parseTransitionBody({ from: 'E', to: 'A', cancelReason: '왜' }).ok).toBe(false);
    expect(parseTransitionBody({ from: 'E', to: 'X', cancelReason: 'a'.repeat(CANCEL_REASON_MAX) }).ok).toBe(true);
    expect(parseTransitionBody({ from: 'E', to: 'X', cancelReason: 'a'.repeat(CANCEL_REASON_MAX + 1) }).ok).toBe(false);
    expect(parseTransitionBody({ from: 'E', to: 'X', cancelReason: 3 }).ok).toBe(false);
  });
});

describe('parseSeenStatus — 삭제의 ?from=', () => {
  it('없거나 모르는 값은 400', () => {
    for (const v of [undefined, null, '', 'S', 'p']) expect(parseSeenStatus(v).ok).toBe(false);
    expect(parseSeenStatus('X')).toEqual({ ok: true, value: 'X' });
  });
});

describe('buildSubmitSnapshot', () => {
  const officer: CorpChangeOfficerView = {
    id: 'o-1',
    name: '김임원',
    changeKind: 'APPOINT',
    position: '이사',
    effectiveDate: '2026-10-01',
    zipCode: '04500',
    address: '서울 중구',
    addressDetail: '1층',
    rrnMasked: '900101-1******',
    sortOrder: 1,
  };
  const company = {
    isTenant: false,
    legalName: '주식회사 에이',
    corpNumber: '110111-1234567',
    ceoName: '홍길동',
    headZipCode: '06000',
    headAddress: '서울 강남구',
    headAddressDetail: '2층',
    ceoZipCode: '04000',
    ceoAddress: '서울 마포구',
    ceoAddressDetail: null,
  };

  it('★★ 임원에 주민번호가 없다 — 마스킹 값도 없다 · 고른 칸만', () => {
    const s = buildSubmitSnapshot({ changeType: 'OFFICER', company, payload: { resolutionDate: '2026-10-01' }, officers: [officer] });
    const json = JSON.stringify(s);
    expect(json).not.toContain('900101');
    expect(json).not.toMatch(/rrn/i);
    expect(s.officers).toEqual([
      {
        name: '김임원',
        changeKind: 'APPOINT',
        position: '이사',
        effectiveDate: '2026-10-01',
        zipCode: '04500',
        address: '서울 중구',
        addressDetail: '1층',
      },
    ]);
  });

  it('변경 전 회사값(회사명 · 법인번호 · 대표 · 본점 · 대표 자택) + 변경 내용', () => {
    const s = buildSubmitSnapshot({ changeType: 'NAME', company, payload: { newName: '주식회사 비' }, officers: [] });
    expect(s).toEqual({
      version: 1,
      changeType: 'NAME',
      company: {
        isTenant: false,
        name: '주식회사 에이',
        corpNumber: '110111-1234567',
        ceoName: '홍길동',
        head: { zipCode: '06000', address: '서울 강남구', addressDetail: '2층' },
        ceoHome: { zipCode: '04000', address: '서울 마포구', addressDetail: null },
      },
      payload: { newName: '주식회사 비' },
      officers: [],
    });
  });
});
