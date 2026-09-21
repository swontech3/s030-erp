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
const TODAY_ISO = '2026-09-18';
const TODAY = day(TODAY_ISO);

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

  /**
   * ★★ 예전에는 이것도 「종료」였다. 나눴다 — **종료 처리한 곳과 안 한 곳이 섞여**
   *    운영자가 어디를 처리해야 하는지 알 수 없었기 때문이다. 자동 종료 배치가 없으니
   *    이 상태는 **할 일이 남았다는 뜻**이고, 칩이 그 목록이다.
   */
  it('★★ 어제 끝났는데 아직 계약중이면 「기간 만료」다 — 「종료」가 아니다', () => {
    const s = deriveTenantStatus({ contracts: [confirmed('2026-09-17')], today: TODAY });
    expect(s.label).toBe('기간 만료');
    expect(s.filters).toEqual(['expired']);
  });

  it('★ 종료 처리를 끝내면 「종료」로 옮겨간다', () => {
    const s = deriveTenantStatus({
      contracts: [{ status: 'terminated', endDate: day('2026-09-17') }],
      today: TODAY,
    });
    expect(s.label).toBe('종료');
    expect(s.filters).toEqual(['ended']);
  });

  /**
   * ★ 재계약을 확정하면 이전 계약이 같은 트랜잭션에서 닫히므로 이 상태는 오래가지
   *   않는다. 그래도 손으로 만든 계약 때문에 생길 수 있고, 그때 **닫아야 할 계약이
   *   있다는 것**이 보여야 한다.
   */
  it('★ 살아 있는 계약 + 종료 처리 안 된 만료 계약이면 둘 다에 걸린다', () => {
    const s = deriveTenantStatus({
      contracts: [confirmed('2027-06-30'), confirmed('2026-09-17')],
      today: TODAY,
    });
    expect(s.filters).toEqual(['active', 'expired']);
    // 뱃지는 **할 일 쪽**을 보여준다 — 계약중인 것은 칩으로 이미 찾을 수 있다.
    expect(s.label).toBe('기간 만료');
  });

  /**
   * ★★ 칩은 **더해진다.** 만료가 붙었다고 「만기 임박」에서 빠지면, 임박으로 거르는
   *    운영자가 그 회사를 못 본다 — 실제로 한 번 그렇게 만들었다(2026-09-21).
   */
  it('★★ 만기 임박이면서 만료인 입주사는 세 칩 모두에 걸린다', () => {
    const s = deriveTenantStatus({
      contracts: [confirmed('2026-09-27'), confirmed('2026-09-17')],
      today: TODAY,
    });
    expect(s.filters).toEqual(['active', 'soon', 'expired']);
    expect(s.label).toBe('기간 만료');
    expect(s.remainingDays).toBe(9);
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

  it('★ 만료된 확정 계약 + 새 임시저장이면 「기간 만료」다 — 옛 계약을 아직 안 닫았다', () => {
    const s = deriveTenantStatus({
      contracts: [confirmed('2026-09-17'), { status: 'draft', endDate: day('2027-06-30') }],
      today: TODAY,
    });
    expect(s.label).toBe('기간 만료');
    expect(s.filters).toEqual(['expired']);
  });

  /** ★ 만료 판정은 `contract-status` 의 `isContractExpired` 하나다 — 두 벌이 아니다. */
  it('★ 종료일 당일은 만료가 아니다 — 계약중이다', () => {
    const s = deriveTenantStatus({ contracts: [confirmed(TODAY_ISO)], today: TODAY });
    expect(s.filters).not.toContain('expired');
    expect(s.filters).toContain('active');
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
