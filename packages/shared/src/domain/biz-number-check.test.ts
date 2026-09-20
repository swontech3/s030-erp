/**
 * 사업자번호 확인 — **국세청 상태**와 **ERP 중복**이 한 버튼에서 섞인다.
 *
 * 둘은 성격이 다르다:
 *   국세청  바깥 사실이다. 알려 줄 뿐 **아무것도 막지 않는다** — 폐업자와도 계약할 수 있고,
 *           그 판단은 운영자가 한다. 국세청이 죽어도 계약 등록은 그대로 된다.
 *   중복     우리 규칙이다. **「종료」인 입주사는 중복이 아니다** — 퇴실 후 재입주다.
 *
 * 이 파일이 그 두 규칙을 고정한다. 섞여 있어서 화면·서버 어느 쪽이든 다시 쓰면
 * 조용히 갈린다.
 */
import { describe, it, expect } from 'vitest';
import {
  duplicateVerdictOf,
  isBizNumberFormatOk,
  ntsKindOf,
  ntsMessageOf,
  bizCheckLine,
  NO_NAME_DUPLICATE,
} from './biz-number-check.ts';

/* ══════════════════════════════════════════════════════════════════════════
   형식 — 틀리면 **API 를 부르지 않는다**
   ══════════════════════════════════════════════════════════════════════════ */
describe('isBizNumberFormatOk', () => {
  it('하이픈이 있든 없든 10자리면 통과한다', () => {
    expect(isBizNumberFormatOk('111-81-00001')).toBe(true);
    expect(isBizNumberFormatOk('1118100001')).toBe(true);
  });

  it('빈 값은 통과가 아니다 — 확인할 것이 없다', () => {
    expect(isBizNumberFormatOk('')).toBe(false);
    expect(isBizNumberFormatOk('   ')).toBe(false);
  });

  it('자릿수가 모자라거나 넘치면 통과가 아니다', () => {
    expect(isBizNumberFormatOk('111-81-0000')).toBe(false);
    expect(isBizNumberFormatOk('111-81-000012')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   국세청 상태조회 — 네 가지를 구분한다
   ══════════════════════════════════════════════════════════════════════════
   응답의 정본은 `b_stt_cd` 다. `b_stt`(한글 문구)로 가르지 않는다 — 문구는 바뀐다. */
describe('ntsKindOf', () => {
  it('01 은 계속사업자다', () => {
    expect(ntsKindOf({ b_stt_cd: '01', b_stt: '계속사업자' })).toBe('active');
  });

  it('02 는 휴업자다', () => {
    expect(ntsKindOf({ b_stt_cd: '02', b_stt: '휴업자' })).toBe('suspended');
  });

  it('03 은 폐업자다', () => {
    expect(ntsKindOf({ b_stt_cd: '03', b_stt: '폐업자' })).toBe('closed');
  });

  /**
   * ★ 국세청은 없는 번호에도 **행을 하나 돌려준다.** `b_stt_cd` 가 빈 문자열이고
   *   `tax_type` 에 「국세청에 등록되지 않은…」이 들어온다. 행이 있다고 등록된 것이 아니다.
   */
  it('b_stt_cd 가 비어 있으면 등록되지 않은 번호다', () => {
    expect(
      ntsKindOf({ b_stt_cd: '', tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.' }),
    ).toBe('unregistered');
  });

  it('행이 아예 없으면 등록되지 않은 번호다', () => {
    expect(ntsKindOf(null)).toBe('unregistered');
    expect(ntsKindOf(undefined)).toBe('unregistered');
  });

  it('모르는 코드는 지어내지 않는다', () => {
    expect(ntsKindOf({ b_stt_cd: '09' })).toBe('unknown');
  });
});

describe('ntsMessageOf', () => {
  it('네 가지가 서로 다른 문구다', () => {
    const messages = (['active', 'suspended', 'closed', 'unregistered'] as const).map((k) =>
      ntsMessageOf(k),
    );
    expect(new Set(messages).size).toBe(4);
  });

  it('폐업이면 폐업일을 함께 보여준다 — 언제 닫혔는지가 판단 재료다', () => {
    expect(ntsMessageOf('closed', { b_stt_cd: '03', end_dt: '20240131' })).toContain('2024-01-31');
  });

  it('폐업일이 없으면 날짜 없이 말한다 — 빈 괄호를 남기지 않는다', () => {
    const message = ntsMessageOf('closed', { b_stt_cd: '03', end_dt: '' });
    expect(message).toContain('폐업');
    expect(message).not.toContain('(');
  });

  /** ★ 국세청 호출이 실패한 것과 「등록되지 않았다」는 **다른 말**이다. */
  it('확인 실패는 등록되지 않음과 다른 문구다', () => {
    expect(ntsMessageOf('unavailable')).not.toBe(ntsMessageOf('unregistered'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ERP 중복 — **「종료」는 중복이 아니다**
   ══════════════════════════════════════════════════════════════════════════ */
describe('duplicateVerdictOf', () => {
  const ended = { companyId: 'c-1', companyName: '나간회사', filters: ['ended'] as const, statusLabel: '종료' };
  const active = { companyId: 'c-2', companyName: '있는회사', filters: ['active'] as const, statusLabel: '계약중' };
  const soon = { companyId: 'c-3', companyName: '곧만기', filters: ['active', 'soon'] as const, statusLabel: 'D-9' };
  const review = { companyId: 'c-4', companyName: '검토중회사', filters: ['review'] as const, statusLabel: '검토중' };

  it('같은 번호가 없으면 중복이 아니다', () => {
    expect(duplicateVerdictOf(null, null).kind).toBe('none');
  });

  /** ★★ 퇴실 후 재입주다. 막지 않고 **기존 입주사를 쓰겠냐고 묻는다.** */
  it('종료된 입주사는 중복이 아니라 재입주 제안이다', () => {
    const v = duplicateVerdictOf(ended, null);
    expect(v.kind).toBe('ended');
    expect(v.companyId).toBe('c-1');
    expect(v.message).toContain('기존 입주사로 계약');
    // ★ 링크가 없어졌으니 답할 수 없는 질문을 띄우지 않는다.
    expect(v.message).not.toContain('?');
  });

  it('계약중이면 그 입주사로 보낸다', () => {
    const v = duplicateVerdictOf(active, null);
    expect(v.kind).toBe('active');
    expect(v.companyId).toBe('c-2');
  });

  it('만기 임박도 계약중이다 — 아직 끝나지 않았다', () => {
    expect(duplicateVerdictOf(soon, null).kind).toBe('active');
  });

  it('검토중도 종료가 아니므로 중복이다', () => {
    expect(duplicateVerdictOf(review, null).kind).toBe('active');
  });

  /**
   * ★★ **자기 자신은 중복이 아니다.** 이미 저장된 계약에서 [확인] 을 누르면 그 회사가
   *    그대로 걸린다 — 「이미 등록된 입주사입니다」가 자기를 가리키면 운영자는
   *    무엇을 고쳐야 할지 알 수 없다.
   */
  it('지금 편집 중인 그 회사는 중복이 아니다', () => {
    expect(duplicateVerdictOf(active, 'c-2').kind).toBe('none');
    expect(duplicateVerdictOf(ended, 'c-1').kind).toBe('none');
  });

  it('다른 회사면 편집 중이어도 중복이다', () => {
    expect(duplicateVerdictOf(active, 'c-9').kind).toBe('active');
  });

  it('중복이 아니면 갈 곳도 없다', () => {
    expect(duplicateVerdictOf(null, null).companyId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   한 줄로 합치기 — 화면에 뜨는 그 문장
   ══════════════════════════════════════════════════════════════════════════ */
describe('bizCheckLine', () => {
  const nts = { kind: 'active' as const, message: '국세청: 계속사업자입니다' };
  const tenant = (over: Partial<Parameters<typeof duplicateVerdictOf>[0] & object> = {}) => ({
    companyId: 'c-2',
    companyName: '에스원3DP',
    filters: ['active'] as const,
    statusLabel: '계약중',
    ...over,
  });

  it('둘 다 아니면 국세청 한 줄만', () => {
    expect(
      bizCheckLine({ nts, duplicate: duplicateVerdictOf(null, null), nameDuplicate: NO_NAME_DUPLICATE }),
    ).toBe('국세청: 계속사업자입니다');
  });

  it('사업자번호 중복이면 회사명을 괄호로 붙여 한 줄로 잇는다', () => {
    expect(
      bizCheckLine({
        nts,
        duplicate: duplicateVerdictOf(tenant(), null),
        nameDuplicate: NO_NAME_DUPLICATE,
      }),
    ).toBe('국세청: 계속사업자입니다 · 이미 계약중인 입주사입니다 (에스원3DP)');
  });

  it('회사명만 겹치면 그것을 잇는다', () => {
    expect(
      bizCheckLine({
        nts,
        duplicate: duplicateVerdictOf(null, null),
        nameDuplicate: { found: true, companyId: 'c-9', companyName: '에스원3DP' },
      }),
    ).toBe('국세청: 계속사업자입니다 · 같은 회사명이 있습니다 (에스원3DP)');
  });

  /**
   * ★★ 같은 번호면 **같은 회사**다. 둘 다 말하면 두 곳이 걸린 것처럼 읽힌다.
   */
  it('사업자번호가 걸렸으면 회사명은 말하지 않는다', () => {
    const line = bizCheckLine({
      nts,
      duplicate: duplicateVerdictOf(tenant(), null),
      nameDuplicate: { found: true, companyId: 'c-2', companyName: '에스원3DP' },
    });
    expect(line).not.toContain('같은 회사명');
  });

  it('계약중이 아니면 상태를 괄호에 함께 적는다', () => {
    const line = bizCheckLine({
      nts,
      duplicate: duplicateVerdictOf(
        tenant({ filters: ['ended'] as const, statusLabel: '종료', companyName: '나간회사' }),
        null,
      ),
      nameDuplicate: NO_NAME_DUPLICATE,
    });
    expect(line).toContain('(나간회사 · 종료)');
  });

  it('국세청을 확인 못 해도 중복은 그대로 붙는다 — 둘은 서로에게 매이지 않는다', () => {
    const line = bizCheckLine({
      nts: { kind: 'unavailable', message: ntsMessageOf('unavailable') },
      duplicate: duplicateVerdictOf(tenant(), null),
      nameDuplicate: NO_NAME_DUPLICATE,
    });
    expect(line).toContain('이미 계약중인 입주사입니다 (에스원3DP)');
  });
});
