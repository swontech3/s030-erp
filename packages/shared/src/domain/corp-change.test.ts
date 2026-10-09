import { describe, expect, it } from 'vitest';
import {
  CORP_CHANGE_STATUSES,
  CORP_CHANGE_TYPES,
  CHANGE_TYPE_DEFS,
  INITIAL_CORP_CHANGE_STATUS,
  REGISTRATION_DEADLINE_DAYS,
  availableTransitions,
  canEditCorpChange,
  canPrintCorpChange,
  checkDelete,
  checkTransition,
  purposeLines,
  registrationDeadline,
  validateCorpChange,
  validateOfficer,
  validateRrn,
  type CorpChangeContent,
  type CorpChangeOfficerInput,
} from './corp-change.ts';

const fields = (errors: { field: string }[]) => errors.map((e) => e.field);

const okOfficer: CorpChangeOfficerInput = { name: '김이사', changeKind: 'APPOINT', position: '사내이사', effectiveDate: '2026-10-01' };

/** 구분마다 통과하는 내용. */
const VALID: Record<string, CorpChangeContent> = {
  NAME: { changeType: 'NAME', payload: { newName: '주식회사 새이름' }, officers: [] },
  HQ: { changeType: 'HQ', payload: { newHqAddress: { zipCode: '06164', address: '서울 강남구 봉은사로 1' } }, officers: [] },
  PURPOSE: { changeType: 'PURPOSE', payload: { purposes: '소프트웨어 개발\n\n  부동산 임대업 ' }, officers: [] },
  OFFICER: { changeType: 'OFFICER', payload: {}, officers: [okOfficer] },
  CEO_ADDR: {
    changeType: 'CEO_ADDR',
    payload: { newCeoAddress: { zipCode: '04524', address: '서울 중구 세종대로 110' }, moveInDate: '2026-10-01' },
    officers: [],
  },
};

// =============================================================================
describe('코드 어휘', () => {
  it('변경 구분 5종 — CEO_CHG 는 없다(구현 없음, 나중)', () => {
    expect([...CORP_CHANGE_TYPES]).toEqual(['NAME', 'HQ', 'PURPOSE', 'OFFICER', 'CEO_ADDR']);
    expect(Object.keys(CHANGE_TYPE_DEFS).sort()).toEqual([...CORP_CHANGE_TYPES].sort());
  });

  it('상태 5종 · 새 건은 P · 준비중(S)은 쓰지 않는다', () => {
    expect([...CORP_CHANGE_STATUSES]).toEqual(['P', 'E', 'A', 'C', 'X']);
    expect(INITIAL_CORP_CHANGE_STATUS).toBe('P');
  });

  it('필수 칸은 레거시 레지스트리 그대로', () => {
    const required = Object.fromEntries(
      CORP_CHANGE_TYPES.map((t) => [t, CHANGE_TYPE_DEFS[t].fields.filter((f) => f.required).map((f) => f.name)]),
    );
    expect(required).toEqual({
      NAME: ['newName'],
      HQ: ['newHqAddress'],
      PURPOSE: ['purposes'],
      OFFICER: [],
      CEO_ADDR: ['newCeoAddress', 'moveInDate'],
    });
    expect(CORP_CHANGE_TYPES.filter((t) => CHANGE_TYPE_DEFS[t].usesOfficers)).toEqual(['OFFICER']);
  });
});

// =============================================================================
describe('검증 — 서류작성완료(P→E)', () => {
  it.each(Object.keys(VALID))('%s — 채운 내용은 통과', (t) => {
    expect(validateCorpChange(VALID[t]!)).toEqual([]);
  });

  it('★ 모르는 구분은 거절 — CEO_CHG 포함(레거시는 통과시켰다)', () => {
    for (const changeType of ['CEO_CHG', '', 'name']) {
      expect(fields(validateCorpChange({ changeType, payload: {}, officers: [] }))).toEqual(['changeType']);
    }
  });

  it('payload 가 객체가 아니면 거절 · null 은 빈 내용으로 본다', () => {
    expect(fields(validateCorpChange({ changeType: 'NAME', payload: '문자', officers: [] }))).toEqual(['payload']);
    expect(fields(validateCorpChange({ changeType: 'NAME', payload: [], officers: [] }))).toEqual(['payload']);
    expect(fields(validateCorpChange({ changeType: 'NAME', payload: null, officers: [] }))).toEqual(['newName']);
  });

  it('필수 글자 칸 — 비었거나 공백뿐이면 거절, 글자가 아니면 거절', () => {
    for (const newName of [undefined, null, '', '   ']) {
      expect(fields(validateCorpChange({ changeType: 'NAME', payload: { newName }, officers: [] }))).toEqual(['newName']);
    }
    const e = validateCorpChange({ changeType: 'NAME', payload: { newName: 123 }, officers: [] });
    expect(e).toEqual([{ field: 'newName', message: '신규 상호은(는) 글자로 입력하세요' }]);
  });

  it('선택 글자 칸은 비어도 되지만 글자가 아니면 거절', () => {
    expect(validateCorpChange({ changeType: 'NAME', payload: { newName: 'A', newNameEn: '' }, officers: [] })).toEqual([]);
    expect(fields(validateCorpChange({ changeType: 'NAME', payload: { newName: 'A', newNameEn: 5 }, officers: [] }))).toEqual(['newNameEn']);
  });

  describe('★ 주소 묶음 — 우편번호 · 기본주소가 둘 다 있어야 한다 (상세는 선택)', () => {
    const hq = (newHqAddress: unknown) => fields(validateCorpChange({ changeType: 'HQ', payload: { newHqAddress }, officers: [] }));

    it('없으면 두 칸 모두 오류', () => {
      expect(hq(undefined)).toEqual(['newHqAddress.zipCode', 'newHqAddress.address']);
      expect(hq({})).toEqual(['newHqAddress.zipCode', 'newHqAddress.address']);
    });
    it('★ 한 칸만 있으면 거절 — 레거시는 통과시켰다', () => {
      expect(hq({ addressDetail: '3층' })).toEqual(['newHqAddress.zipCode', 'newHqAddress.address']);
      expect(hq({ zipCode: '06164' })).toEqual(['newHqAddress.address']);
      expect(hq({ address: '서울', zipCode: ' ' })).toEqual(['newHqAddress.zipCode']);
    });
    it('상세주소는 비어도 통과', () => {
      expect(hq({ zipCode: '06164', address: '서울', addressDetail: '' })).toEqual([]);
    });
    it('주소 모양이 아니면 거절', () => {
      expect(hq('서울 강남구')).toEqual(['newHqAddress']);
      expect(hq({ zipCode: 6164, address: '서울' })).toEqual(['newHqAddress.zipCode']);
    });
    it('선택 주소(변경 전 대표자 주소)는 비어도, 일부만 있어도 통과', () => {
      const base = VALID.CEO_ADDR!;
      const p = base.payload as Record<string, unknown>;
      expect(validateCorpChange({ ...base, payload: { ...p, oldCeoAddress: { address: '서울' } } })).toEqual([]);
      expect(validateCorpChange({ ...base, payload: { ...p, oldCeoAddress: null } })).toEqual([]);
    });
  });

  describe('날짜 — YYYY-MM-DD 이고 있는 날짜', () => {
    const name = (resolutionDate: unknown) =>
      fields(validateCorpChange({ changeType: 'NAME', payload: { newName: 'A', resolutionDate }, officers: [] }));
    it('맞는 날짜 · 빈 값(선택 칸)은 통과', () => {
      expect(name('2026-10-10')).toEqual([]);
      expect(name('')).toEqual([]);
      expect(name(undefined)).toEqual([]);
    });
    it('형식이 틀리거나 없는 날짜면 거절', () => {
      for (const d of ['2026/10/10', '2026-1-1', '20261010', '2026-02-30', '2026-10-10T00:00:00Z', 20261010]) {
        expect(name(d)).toEqual(['resolutionDate']);
      }
    });
    it('전입일은 필수 — 비면 거절', () => {
      const p = { newCeoAddress: { zipCode: '1', address: '서울' } };
      expect(fields(validateCorpChange({ changeType: 'CEO_ADDR', payload: p, officers: [] }))).toEqual(['moveInDate']);
    });
  });

  describe('사업목적 — 빈 줄을 뺀 뒤 1줄 이상', () => {
    it('줄 나누기', () => {
      expect(purposeLines(' 가 \r\n\n나\n  \n')).toEqual(['가', '나']);
    });
    it('빈 줄뿐이면 거절', () => {
      const e = validateCorpChange({ changeType: 'PURPOSE', payload: { purposes: '\n  \n' }, officers: [] });
      expect(fields(e)).toEqual(['purposes']);
    });
  });

  describe('임원', () => {
    it('★ 임원 건은 1명 이상', () => {
      expect(fields(validateCorpChange({ changeType: 'OFFICER', payload: {}, officers: [] }))).toEqual(['officers']);
    });
    it('★ 성명 · 직위가 비면, 구분이 셋이 아니면 거절 — 칸 자리에 순번이 붙는다', () => {
      const e = validateCorpChange({
        changeType: 'OFFICER',
        payload: {},
        officers: [okOfficer, { name: ' ', changeKind: 'FIRE', position: '' }],
      });
      expect(fields(e)).toEqual(['officers.1.name', 'officers.1.changeKind', 'officers.1.position']);
    });
    it('구분은 취임 · 사임 · 중임', () => {
      for (const changeKind of ['APPOINT', 'RESIGN', 'REELECT']) {
        expect(validateOfficer({ ...okOfficer, changeKind }, 0)).toEqual([]);
      }
      for (const changeKind of [null, '', 'appoint', '취임']) {
        expect(fields(validateOfficer({ ...okOfficer, changeKind }, 0))).toEqual(['officers.0.changeKind']);
      }
    });
    it('효력일은 선택이지만 형식은 본다', () => {
      expect(validateOfficer({ ...okOfficer, effectiveDate: null }, 0)).toEqual([]);
      expect(fields(validateOfficer({ ...okOfficer, effectiveDate: '2026-13-01' }, 2))).toEqual(['officers.2.effectiveDate']);
    });
    it('주민번호는 넘어왔을 때만 본다', () => {
      expect(validateOfficer({ ...okOfficer, rrn: '901231-1234567' }, 0)).toEqual([]);
      expect(fields(validateOfficer({ ...okOfficer, rrn: '9012311' }, 0))).toEqual(['officers.0.rrn']);
    });
    it('임원을 쓰지 않는 구분은 딸려 온 임원을 보지 않는다', () => {
      expect(validateCorpChange({ ...VALID.NAME!, officers: [{ name: '' }] })).toEqual([]);
    });
  });
});

describe('주민번호 — 입력할 때', () => {
  it('숫자 13자리 · 앞 6자리 뒤 하이픈 허용 · 비면 통과', () => {
    for (const ok of ['9012311234567', '901231-1234567', ' 901231-1234567 ', '', null, undefined]) {
      expect(validateRrn(ok)).toBeNull();
    }
  });
  it('모양이 틀리면 거절', () => {
    for (const bad of ['901231-123456', '90123-11234567', '901231--1234567', '9012311234567-', '90123112345678', '901231-123456a', 9012311234567]) {
      expect(validateRrn(bad)).toEqual({ field: 'rrn', message: '주민등록번호는 숫자 13자리로 입력하세요' });
    }
  });
});

// =============================================================================
describe('상태 전이 — 전수', () => {
  /** 허용되는 전이와 역할(사용자 결정 2026-10-09). 이 밖은 전부 막힌다. */
  const ALLOWED: Record<string, readonly ('operator' | 'tenant')[]> = {
    PE: ['operator', 'tenant'],
    PX: ['operator'],
    EP: ['operator', 'tenant'],
    EA: ['operator', 'tenant'],
    EX: ['operator'],
    AP: ['operator'],
    AC: ['operator'],
    AX: ['operator'],
    XP: ['operator'],
    XE: ['operator'],
    XA: ['operator'],
  };

  const run = (from: string, to: string, role: 'operator' | 'tenant') =>
    checkTransition({
      from,
      to,
      role,
      statusBeforeCancel: from === 'X' ? to : null, // 복원은 맞는 대상으로
      content: VALID.NAME,
    });

  for (const from of CORP_CHANGE_STATUSES) {
    for (const to of CORP_CHANGE_STATUSES) {
      for (const role of ['operator', 'tenant'] as const) {
        const roles = ALLOWED[`${from}${to}`];
        const expected = roles === undefined ? 'not_allowed' : roles.includes(role) ? 'ok' : 'forbidden';
        it(`${from}→${to} · ${role} → ${expected}`, () => {
          const r = run(from, to, role);
          expect(r.ok ? 'ok' : r.code).toBe(expected);
        });
      }
    }
  }

  it('★ C 는 종착 — 나가는 전이가 없다', () => {
    expect(availableTransitions('C', 'operator')).toEqual([]);
  });

  it('★ 회사가 막히는 자리는 사유가 무엇을 해야 하는지 말한다', () => {
    const r = checkTransition({ from: 'A', to: 'C', role: 'tenant' });
    expect(r).toEqual({ ok: false, code: 'forbidden', reason: '완료 처리는 운영사만 할 수 있습니다' });
    const back = checkTransition({ from: 'A', to: 'P', role: 'tenant' });
    expect(back.ok === false && back.reason).toBe('제출한 서류는 운영사만 수정 상태로 되돌릴 수 있습니다');
  });

  it('모르는 상태값은 거절', () => {
    for (const [from, to] of [['S', 'P'], ['P', 'S'], ['p', 'e'], ['', 'E']] as const) {
      const r = checkTransition({ from, to, role: 'operator', content: VALID.NAME });
      expect(r.ok === false && r.code).toBe('unknown_status');
    }
  });

  it('같은 상태로의 전이는 없다', () => {
    for (const s of CORP_CHANGE_STATUSES) {
      const r = checkTransition({ from: s, to: s, role: 'operator' });
      expect(r.ok === false && r.code).toBe('not_allowed');
    }
  });

  it('availableTransitions — 역할별 버튼', () => {
    expect(availableTransitions('P', 'tenant')).toEqual(['E']);
    expect(availableTransitions('P', 'operator')).toEqual(['E', 'X']);
    expect(availableTransitions('E', 'tenant')).toEqual(['P', 'A']);
    expect(availableTransitions('E', 'operator')).toEqual(['P', 'A', 'X']);
    expect(availableTransitions('A', 'tenant')).toEqual([]);
    expect(availableTransitions('A', 'operator')).toEqual(['P', 'C', 'X']);
    expect(availableTransitions('X', 'tenant', 'E')).toEqual([]);
    expect(availableTransitions('Q', 'operator')).toEqual([]);
  });
});

describe('복원 — 취소 직전 상태로만', () => {
  it.each(['P', 'E', 'A'])('직전 %s 로 복원', (before) => {
    expect(checkTransition({ from: 'X', to: before, role: 'operator', statusBeforeCancel: before })).toEqual({ ok: true });
    expect(availableTransitions('X', 'operator', before)).toEqual([before]);
  });

  it('직전 상태가 아닌 곳으로는 못 간다', () => {
    const r = checkTransition({ from: 'X', to: 'P', role: 'operator', statusBeforeCancel: 'A' });
    expect(r.ok === false && r.code).toBe('restore_target');
  });

  it('★ 직전 상태 기록이 없거나 이상하면 어디로도 못 간다', () => {
    for (const before of [null, undefined, 'C', 'X', '']) {
      for (const to of ['P', 'E', 'A']) {
        const r = checkTransition({ from: 'X', to, role: 'operator', statusBeforeCancel: before });
        expect(r.ok === false && r.code).toBe('restore_target');
      }
      expect(availableTransitions('X', 'operator', before)).toEqual([]);
    }
  });

  it('회사는 복원할 수 없다 — 대상이 맞아도', () => {
    const r = checkTransition({ from: 'X', to: 'E', role: 'tenant', statusBeforeCancel: 'E' });
    expect(r.ok === false && r.code).toBe('forbidden');
  });
});

describe('★ P→E 는 저장될 내용으로 검증한다', () => {
  it('내용이 없으면 거절 — 검증 없이 통과시키지 않는다', () => {
    const r = checkTransition({ from: 'P', to: 'E', role: 'tenant' });
    expect(r.ok === false && r.code).toBe('invalid');
  });

  it('칸 오류를 함께 돌려준다', () => {
    const r = checkTransition({
      from: 'P',
      to: 'E',
      role: 'tenant',
      content: { changeType: 'OFFICER', payload: {}, officers: [] },
    });
    expect(r).toEqual({
      ok: false,
      code: 'invalid',
      reason: '입력 내용을 확인하세요',
      errors: [{ field: 'officers', message: '임원을 1명 이상 등록하세요' }],
    });
  });

  it('역할을 검증보다 먼저 본다', () => {
    const r = checkTransition({ from: 'A', to: 'C', role: 'tenant', content: { changeType: 'X', payload: 1, officers: [] } });
    expect(r.ok === false && r.code).toBe('forbidden');
  });

  it('P→E 가 아닌 전이는 내용을 보지 않는다', () => {
    const bad = { changeType: 'NAME', payload: {}, officers: [] };
    expect(checkTransition({ from: 'E', to: 'A', role: 'tenant', content: bad })).toEqual({ ok: true });
  });
});

describe('수정 · 출력 · 삭제', () => {
  it('고칠 수 있는 상태는 P 뿐 · 모르는 값은 잠근다', () => {
    expect(CORP_CHANGE_STATUSES.filter(canEditCorpChange)).toEqual(['P']);
    expect(canEditCorpChange('S')).toBe(false);
  });

  it('★ 출력은 E · A · C (제출 뒤에도 뽑는다)', () => {
    expect(CORP_CHANGE_STATUSES.filter(canPrintCorpChange)).toEqual(['E', 'A', 'C']);
  });

  it('삭제는 운영사만, P · X 에서만', () => {
    expect(CORP_CHANGE_STATUSES.filter((s) => checkDelete(s, 'operator').ok)).toEqual(['P', 'X']);
    expect(CORP_CHANGE_STATUSES.filter((s) => checkDelete(s, 'tenant').ok)).toEqual([]);
    const r = checkDelete('A', 'operator');
    expect(r.ok === false && r.reason).toBe('진행 중인 건은 취소한 뒤에 삭제할 수 있습니다');
  });
});

// =============================================================================
describe('신청기한 — 대표주소 변경, 전입일 + 14일', () => {
  const at = (moveInDate: unknown, baseDay: string, changeType = 'CEO_ADDR') =>
    registrationDeadline(changeType, { moveInDate }, baseDay);

  it('기한은 14일', () => {
    expect(REGISTRATION_DEADLINE_DAYS).toBe(14);
  });

  it('★ 14일째까지는 기한 안 · 15일째부터 초과', () => {
    expect(at('2026-10-01', '2026-10-14')).toEqual({ elapsedDays: 13, overdue: false });
    expect(at('2026-10-01', '2026-10-15')).toEqual({ elapsedDays: 14, overdue: false });
    expect(at('2026-10-01', '2026-10-16')).toEqual({ elapsedDays: 15, overdue: true });
  });

  it('달 · 해를 넘겨도 날수로 센다', () => {
    expect(at('2026-12-25', '2027-01-08')).toEqual({ elapsedDays: 14, overdue: false });
    expect(at('2028-02-20', '2028-03-06')).toEqual({ elapsedDays: 15, overdue: true }); // 윤년
  });

  it('전입일이 미래면 음수 · 초과 아님', () => {
    expect(at('2026-10-20', '2026-10-10')).toEqual({ elapsedDays: -10, overdue: false });
  });

  it('다른 구분 · 전입일 없음 · 형식 오류는 null', () => {
    expect(at('2026-10-01', '2026-12-01', 'HQ')).toBeNull();
    expect(at(undefined, '2026-10-10')).toBeNull();
    expect(at('2026-02-30', '2026-10-10')).toBeNull();
    expect(at('2026-10-01', 'today')).toBeNull();
    expect(registrationDeadline('CEO_ADDR', null, '2026-10-10')).toBeNull();
  });
});
