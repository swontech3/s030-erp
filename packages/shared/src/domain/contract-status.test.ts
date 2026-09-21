/**
 * 계약 상태 전이와 섹션 잠금 — 테스트가 규칙의 기록이다.
 *
 * 정본은 `design/handoff/tenant-contract/04-status.md` 의 표 두 개다.
 * 요구사항 번호로는 CONT-07(전이) · CONT-08(서버 거부) · CONT-09(섹션2 잠금).
 *
 * ★ 이 규칙은 **화면 버튼 노출과 무관하게** 서버가 강제해야 한다(CONT-08).
 *   API 를 직접 불러도 뚫리지 않는 것이 요구사항이다.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTRACT_STATUS,
  canTransition,
  assertTransition,
  isContractLocked,
  editableSections,
  isContractExpired,
  terminationDefaults,
  EXPIRED_TERMINATION_REASON,
} from './contract-status';

describe('CONTRACT_STATUS — 저장되는 상태는 넷이다', () => {
  it('draft · confirmed · terminated · cancelled', () => {
    expect(CONTRACT_STATUS).toEqual(['draft', 'confirmed', 'terminated', 'cancelled']);
  });

  // ★ create 는 상태가 아니다 — 아직 저장되지 않은 화면의 모드다.
  //   DB 의 ck_s080_contracts_status 도 넷만 받는다.
  it("'create' 는 저장되는 상태가 아니다", () => {
    expect(CONTRACT_STATUS).not.toContain('create');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 전이 — 04-status.md 「상태 전이」
//
//   create ──임시저장──→ draft
//   create ──계약확정──→ confirmed
//   draft  ──계약확정──→ confirmed
//   draft  ──계약취소──→ cancelled
//   confirmed ──종료──→ terminated
//
// 되돌리는 전이는 없다. 조건을 바꾸려면 종료 후 재계약이다.
// ═══════════════════════════════════════════════════════════════════════════
describe('canTransition — 허용되는 전이 다섯', () => {
  it('최초 생성으로 draft 를 만든다 (임시저장)', () => {
    expect(canTransition(null, 'draft')).toBe(true);
  });

  it('최초 생성으로 바로 confirmed 를 만든다 (create → 계약확정)', () => {
    expect(canTransition(null, 'confirmed')).toBe(true);
  });

  it('draft → confirmed (계약확정)', () => {
    expect(canTransition('draft', 'confirmed')).toBe(true);
  });

  it('draft → cancelled (계약취소)', () => {
    expect(canTransition('draft', 'cancelled')).toBe(true);
  });

  it('confirmed → terminated (종료)', () => {
    expect(canTransition('confirmed', 'terminated')).toBe(true);
  });
});

describe('canTransition — 되돌리는 전이는 없다', () => {
  it('★ confirmed → draft 는 거부한다', () => {
    expect(canTransition('confirmed', 'draft')).toBe(false);
  });

  it('★ terminated → confirmed 는 거부한다', () => {
    expect(canTransition('terminated', 'confirmed')).toBe(false);
  });

  it('★ cancelled → draft 는 거부한다', () => {
    expect(canTransition('cancelled', 'draft')).toBe(false);
  });
});

describe('canTransition — 종착 상태에서는 나갈 수 없다', () => {
  it('terminated 에서 나가는 전이가 하나도 없다', () => {
    for (const to of CONTRACT_STATUS) {
      expect(canTransition('terminated', to)).toBe(false);
    }
  });

  it('cancelled 에서 나가는 전이가 하나도 없다', () => {
    for (const to of CONTRACT_STATUS) {
      expect(canTransition('cancelled', to)).toBe(false);
    }
  });
});

describe('canTransition — 그 밖에 막는 것', () => {
  // 확정된 계약은 종료만 된다. 취소는 대기 상태에서만이다(04-status.md 확인 모달 문구
  // "임시저장된 계약 정보가 삭제됩니다").
  it('★ confirmed → cancelled 는 거부한다 — 확정된 계약은 종료다', () => {
    expect(canTransition('confirmed', 'cancelled')).toBe(false);
  });

  it('draft → terminated 는 거부한다 — 확정을 건너뛸 수 없다', () => {
    expect(canTransition('draft', 'terminated')).toBe(false);
  });

  it('★ 같은 상태로의 전이는 전이가 아니다 — 재저장은 이 경로가 아니다', () => {
    for (const status of CONTRACT_STATUS) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('★ 알 수 없는 상태값은 거부한다 — 화면이 보낸 문자열을 믿지 않는다', () => {
    expect(canTransition('draft', 'DELETED')).toBe(false);
    expect(canTransition('초안', 'confirmed')).toBe(false);
    expect(canTransition(null, 'terminated')).toBe(false);
  });
});

describe('assertTransition — 거부는 던진다', () => {
  it('허용되는 전이는 조용히 통과한다', () => {
    expect(() => assertTransition('draft', 'confirmed')).not.toThrow();
  });

  it('막힌 전이는 던진다', () => {
    expect(() => assertTransition('confirmed', 'draft')).toThrow();
  });

  it('★ 오류 문구에 어느 전이가 막혔는지 들어 있다', () => {
    expect(() => assertTransition('confirmed', 'draft')).toThrow(/confirmed.*draft/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 섹션 잠금 — 04-status.md 「섹션별 수정 가능 여부」
//
//   섹션        create  draft  confirmed  terminated  cancelled
//   1 회사        ○      ○        ○           ×          ×
//   2 계약정보    ○      ○      잠금         잠금        잠금
//   3 사용자      ○      ○        ○           ×          ×
//   4 첨부        ○      ○        ○           ×          ×
//
// 핵심 원칙 — confirmed 이후 **계약 조건만** 잠긴다.
// terminated / cancelled 는 전 섹션이 읽기 전용이다.
// ═══════════════════════════════════════════════════════════════════════════
describe('isContractLocked — 계약 조건(섹션2) 잠금', () => {
  it('draft 면 잠기지 않는다', () => {
    expect(isContractLocked('draft')).toBe(false);
  });

  it('아직 저장 전(null)이면 잠기지 않는다', () => {
    expect(isContractLocked(null)).toBe(false);
  });

  it('★ confirmed 면 잠긴다', () => {
    expect(isContractLocked('confirmed')).toBe(true);
  });

  it('terminated 면 잠긴다', () => {
    expect(isContractLocked('terminated')).toBe(true);
  });

  it('cancelled 면 잠긴다', () => {
    expect(isContractLocked('cancelled')).toBe(true);
  });

  it('★ 알 수 없는 상태는 잠긴 것으로 본다 — fail-closed', () => {
    expect(isContractLocked('DELETED')).toBe(true);
  });
});

describe('editableSections — 섹션별 수정 가능 여부', () => {
  it('아직 저장 전(null)이면 1·2·3·4 전부 수정 가능하다', () => {
    expect(editableSections(null)).toEqual([1, 2, 3, 4]);
  });

  it('draft 면 1·2·3·4 전부 수정 가능하다', () => {
    expect(editableSections('draft')).toEqual([1, 2, 3, 4]);
  });

  it('★ confirmed 면 2(계약정보)만 빠진다 — 회사·사용자·첨부는 계속 수정한다', () => {
    expect(editableSections('confirmed')).toEqual([1, 3, 4]);
  });

  it('★ terminated 면 전 섹션이 읽기 전용이다', () => {
    expect(editableSections('terminated')).toEqual([]);
  });

  it('★ cancelled 면 전 섹션이 읽기 전용이다', () => {
    expect(editableSections('cancelled')).toEqual([]);
  });

  it('알 수 없는 상태는 전부 읽기 전용이다 — fail-closed', () => {
    expect(editableSections('DELETED')).toEqual([]);
  });

  it('돌려준 배열을 고쳐도 다음 호출에 영향이 없다 — 내부 상수를 내주지 않는다', () => {
    const sections = editableSections('draft');
    sections.push(9 as never);
    expect(editableSections('draft')).toEqual([1, 2, 3, 4]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   기간 만료 — **상태가 아니라 날짜다**
   ══════════════════════════════════════════════════════════════════════════
   종료일이 지나도 저장된 상태는 `confirmed` 그대로다. 자동으로 종료하는 배치를
   만들지 않기 때문이다 — 운영자가 입주사에게 재계약 의사를 확인한 뒤 손으로 닫는다.

   ★ 그래서 만료된 계약도 **호실을 계속 잡는다.** 확인하는 동안 호실이 다른 회사에
     넘어가면 안 된다. `ROOM_LIVE_STATUSES` 가 그 약속이고 아래에서 함께 못 박는다. */
describe('isContractExpired', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('★ 종료일이 지났고 계약중이면 만료다', () => {
    expect(isContractExpired({ status: 'confirmed', endDate: day('2026-09-20'), today: day('2026-09-21') })).toBe(true);
  });

  /** ★ 하루 겹침을 만들지 않는 것과 같은 경계다 — 종료일 당일은 아직 계약 중이다. */
  it('★ 종료일 당일은 만료가 아니다', () => {
    expect(isContractExpired({ status: 'confirmed', endDate: day('2026-09-21'), today: day('2026-09-21') })).toBe(false);
  });

  it('아직 남았으면 만료가 아니다', () => {
    expect(isContractExpired({ status: 'confirmed', endDate: day('2026-12-31'), today: day('2026-09-21') })).toBe(false);
  });

  /** ★ 이미 닫힌 계약은 만료가 아니다 — 「종료 처리할 것이 남았다」는 뜻이기 때문이다. */
  it('★ 종료·취소·임시저장은 만료가 아니다 — 확정된 계약만 만료된다', () => {
    for (const status of ['terminated', 'cancelled', 'draft']) {
      expect(isContractExpired({ status, endDate: day('2026-01-01'), today: day('2026-09-21') })).toBe(false);
    }
  });

  it('시각이 섞여 있어도 날짜로만 본다', () => {
    expect(
      isContractExpired({
        status: 'confirmed',
        endDate: new Date('2026-09-21T23:00:00.000Z'),
        today: new Date('2026-09-21T01:00:00.000Z'),
      }),
    ).toBe(false);
  });
});

describe('terminationDefaults — [계약종료] 모달의 첫 값', () => {
  const TODAY = '2026-09-21';

  /**
   * ★ 종료일자 기본값이 **오늘이 아니라 원래 종료일**이다. 만료된 계약을 뒤늦게 닫는
   *   것이라, 오늘을 넣으면 계약이 실제보다 길었던 것으로 남는다. 실제 퇴실일이 다르면
   *   운영자가 바꾼다.
   */
  it('★ 만료된 계약이면 종료일자는 원래 종료일이고 사유가 채워져 있다', () => {
    expect(terminationDefaults({ endDate: '2026-08-31', today: TODAY })).toEqual({
      terminatedDate: '2026-08-31',
      reason: EXPIRED_TERMINATION_REASON,
    });
  });

  it('사유 문구가 「계약기간 만료로 계약 종료」다', () => {
    expect(EXPIRED_TERMINATION_REASON).toBe('계약기간 만료로 계약 종료');
  });

  /** 아직 안 끝난 계약을 중도 종료하는 것이라 사유를 지어내지 않는다. */
  it('★ 아직 안 끝난 계약이면 오늘이고 사유는 비어 있다', () => {
    expect(terminationDefaults({ endDate: '2026-12-31', today: TODAY })).toEqual({
      terminatedDate: TODAY,
      reason: '',
    });
  });

  it('★ 종료일 당일은 만료가 아니다 — 오늘이고 사유는 비어 있다', () => {
    expect(terminationDefaults({ endDate: TODAY, today: TODAY })).toEqual({
      terminatedDate: TODAY,
      reason: '',
    });
  });

  it('종료일을 읽을 수 없으면 오늘로 떨어진다', () => {
    expect(terminationDefaults({ endDate: '', today: TODAY }).terminatedDate).toBe(TODAY);
    expect(terminationDefaults({ endDate: '2026-02-31', today: TODAY }).terminatedDate).toBe(TODAY);
    expect(terminationDefaults({ endDate: '2026-08-31T15:00:00.000Z', today: TODAY }).reason).toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ pg 가 주는 날짜는 **로컬 자정**이다 — UTC 로 세면 하루가 어긋난다
   ══════════════════════════════════════════════════════════════════════════
   `tb_s080_contracts.end_date` 는 `date`/`timestamp` 이고, pg 드라이버는 그것을
   **로컬 자정의 Date** 로 준다. 웹으로 오면 JSON 이 UTC 로 바꿔 `...T15:00:00.000Z`
   가 되는데, 그 값의 **UTC 날짜는 하루 앞**이다(KST 기준).

   반대로 「오늘」(`new Date()`)은 낮 시간대에는 UTC 날짜와 로컬 날짜가 같다.
   즉 **둘의 어긋남이 서로 다르다** — 한쪽만 밀린다. 그래서 종료일 당일이 만료로
   읽히고, 아직 계약 중인 입주사가 「기간 만료」 칩에 뜬다.

   `new Date(y, m, d)` 는 **정의상 로컬 자정**이라 pg 가 주는 모양 그대로다.
   아래 두 시험이 그 모양을 박아 둔다. */
describe('★★ 로컬 자정으로 오는 날짜 — pg 가 주는 모양', () => {
  /** pg 가 `2026-09-18` 을 줄 때의 Date. 시간대와 무관하게 로컬 자정이다. */
  const pgDay = (y: number, m: number, d: number) => new Date(y, m - 1, d);

  it('★ 종료일 당일은 만료가 아니다 — 오전에 봐도, 저녁에 봐도', () => {
    const endDate = pgDay(2026, 9, 18);
    for (const hour of [0, 9, 15, 23]) {
      const today = new Date(2026, 8, 18, hour, 30);
      expect(isContractExpired({ status: 'confirmed', endDate, today }), `${hour}시`).toBe(false);
    }
  });

  it('★ 그 다음 날부터 만료다', () => {
    const endDate = pgDay(2026, 9, 18);
    expect(
      isContractExpired({ status: 'confirmed', endDate, today: new Date(2026, 8, 19, 0, 1) }),
    ).toBe(true);
  });
});
