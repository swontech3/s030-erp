/**
 * 입주사 상태 판정 시험.
 *
 * 정본은 `design/handoff/tenant-contract/02-master-detail.md` 와 시안
 * `s0300200030.html` 의 `DEMO_TENANTS` 다 — 시안 5건이 어떤 상태로 그려져 있는지가
 * 이 규칙의 근거이므로, 그 5건을 그대로 재현하는 시험을 마지막에 둔다.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPIRY_SOON_DAYS,
  deriveTenantStatus,
  matchesChips,
  type TenantContractFact,
} from './tenant-status.ts';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day('2026-09-18');

const confirmed = (endIso: string): TenantContractFact => ({ status: 'confirmed', endDate: day(endIso) });

describe('deriveTenantStatus', () => {
  it('유효 계약이 넉넉히 남으면 계약중이다', () => {
    const s = deriveTenantStatus({ contracts: [confirmed('2027-01-14')], today: TODAY });
    expect(s.label).toBe('계약중');
    expect(s.filters).toEqual(['active']);
    expect(s.remainingDays).toBe(118);
  });

  it('30일 이내면 만기 임박이고 뱃지가 D-n 이다', () => {
    const s = deriveTenantStatus({ contracts: [confirmed('2026-09-27')], today: TODAY });
    expect(s.label).toBe('D-9');
    expect(s.filters).toEqual(['active', 'soon']);
  });

  it('경계 — 딱 30일은 임박이고 31일은 아니다', () => {
    const at30 = deriveTenantStatus({ contracts: [confirmed('2026-10-18')], today: TODAY });
    const at31 = deriveTenantStatus({ contracts: [confirmed('2026-10-19')], today: TODAY });
    expect(at30.remainingDays).toBe(EXPIRY_SOON_DAYS);
    expect(at30.filters).toContain('soon');
    expect(at31.filters).not.toContain('soon');
  });

  it('★ 종료일 당일은 아직 계약 중이다 — 하루 일찍 끊지 않는다', () => {
    const s = deriveTenantStatus({ contracts: [confirmed('2026-09-18')], today: TODAY });
    expect(s.filters).toContain('active');
    expect(s.label).toBe('D-0');
  });

  it('어제 끝났으면 종료다', () => {
    const s = deriveTenantStatus({ contracts: [confirmed('2026-09-17')], today: TODAY });
    expect(s.label).toBe('종료');
    expect(s.filters).toEqual(['ended']);
  });

  it('계약이 여러 건이면 **가장 빨리 끝나는 것**이 기준이다', () => {
    const s = deriveTenantStatus({
      contracts: [confirmed('2027-05-01'), confirmed('2026-09-27')],
      today: TODAY,
    });
    expect(s.label).toBe('D-9');
  });

  it('★ 임시저장·취소뿐이면 「검토중」이다 — 끝난 회사로 보이면 안 된다', () => {
    const s = deriveTenantStatus({
      contracts: [
        { status: 'draft', endDate: day('2027-01-14') },
        { status: 'cancelled', endDate: day('2027-01-14') },
      ],
      today: TODAY,
    });
    expect(s.label).toBe('검토중');
    expect(s.filters).toEqual(['review']);
  });

  it('중도 종료된 계약이 있으면 「종료」다', () => {
    const s = deriveTenantStatus({
      contracts: [{ status: 'terminated', endDate: day('2027-01-14') }],
      today: TODAY,
    });
    expect(s.label).toBe('종료');
  });

  it('★ 만료된 확정 계약 + 새 임시저장이면 「종료」다 — 성립한 적이 있다', () => {
    const s = deriveTenantStatus({
      contracts: [confirmed('2026-09-17'), { status: 'draft', endDate: day('2027-06-30') }],
      today: TODAY,
    });
    expect(s.label).toBe('종료');
  });

  it('계약이 한 건도 없으면 검토중이다', () => {
    const s = deriveTenantStatus({ contracts: [], today: TODAY });
    expect(s.label).toBe('검토중');
    expect(s.filters).toEqual(['review']);
  });

  it('★ 시안 5건을 그대로 재현한다', () => {
    // s0300200030.html 의 DEMO_TENANTS — 노틸러스·오르카·한결(계약중) /
    // 브릿지랩(D-9, 계약 2건) / 세움(계약 0건 → 검토중).
    const cases: [string, TenantContractFact[], string, string[]][] = [
      ['노틸러스', [confirmed('2027-03-01')], '계약중', ['active']],
      ['브릿지랩', [confirmed('2027-01-14'), confirmed('2026-09-27')], 'D-9', ['active', 'soon']],
      ['오르카', [confirmed('2027-02-01')], '계약중', ['active']],
      ['한결세무법인', [confirmed('2027-06-30')], '계약중', ['active']],
      ['세움컴퍼니', [], '검토중', ['review']],
    ];
    for (const [name, contracts, label, filters] of cases) {
      const s = deriveTenantStatus({ contracts, today: TODAY });
      expect(s.label, name).toBe(label);
      expect(s.filters, name).toEqual(filters);
    }
  });
});

describe('matchesChips', () => {
  it('★ 하나도 안 켜져 있으면 거르지 않는다', () => {
    expect(matchesChips(['ended'], [])).toBe(true);
    expect(matchesChips([], [])).toBe(true);
  });

  it('하나라도 겹치면 통과한다', () => {
    expect(matchesChips(['active', 'soon'], ['soon'])).toBe(true);
    expect(matchesChips(['active'], ['soon'])).toBe(false);
  });
});
