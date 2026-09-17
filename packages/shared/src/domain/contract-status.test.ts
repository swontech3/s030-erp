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
