/**
 * 단체코드 채번 — `Z01` 부터 순번. **틀리면 남의 회사에 붙는다.**
 *
 * ★ 이 파일이 지키는 것:
 *   ① Z + 숫자 2자리만 발급한다 — 삐용이 이 Z 접두사로 「ERP 가 만든 회사」를 알아본다
 *   ② 이미 쓴 번호를 다시 주지 않는다
 *   ③ 소진(Z99)이면 **지어내지 않고 null 을 준다** — ZA0 같은 코드를 즉흥적으로 만들면
 *      삐용의 Z 대역 규칙 밖으로 나가고, 그건 사람이 결정할 일이다
 */
import { describe, it, expect } from 'vitest';
import {
  FIRST_ORG_CODE,
  LAST_ORG_CODE,
  isErpOrgCode,
  nextOrgCode,
  firstFreeOrgCode,
} from './org-code';

describe('isErpOrgCode', () => {
  it('Z + 숫자 2자리만 ERP 코드다', () => {
    expect(isErpOrgCode('Z01')).toBe(true);
    expect(isErpOrgCode('Z99')).toBe(true);
    expect(isErpOrgCode('Z00')).toBe(true);
  });

  it('★ 삐용 규격(영문/숫자 3자리)이라도 Z 대역이 아니면 ERP 코드가 아니다', () => {
    // 운영자가 삐용 화면에서 손으로 만든 회사들이다. 우리 채번이 건드릴 값이 아니다.
    expect(isErpOrgCode('HAN')).toBe(false);
    expect(isErpOrgCode('ZAB')).toBe(false);
    expect(isErpOrgCode('Z1')).toBe(false);
    expect(isErpOrgCode('Z001')).toBe(false);
    expect(isErpOrgCode('z01')).toBe(false); // 소문자는 다른 코드다
    expect(isErpOrgCode('')).toBe(false);
  });
});

describe('nextOrgCode', () => {
  it('다음 번호를 준다', () => {
    expect(nextOrgCode('Z01')).toBe('Z02');
    expect(nextOrgCode('Z09')).toBe('Z10');
    expect(nextOrgCode('Z98')).toBe('Z99');
  });

  it('★ Z99 다음은 없다 — 지어내지 않는다', () => {
    expect(nextOrgCode(LAST_ORG_CODE)).toBeNull();
    expect(nextOrgCode('Z99')).toBeNull();
  });

  it('ERP 코드가 아니면 null — 남의 코드에서 순번을 이어가지 않는다', () => {
    expect(nextOrgCode('HAN')).toBeNull();
    expect(nextOrgCode('ZAB')).toBeNull();
  });
});

describe('firstFreeOrgCode', () => {
  it('아무것도 없으면 Z01 이다', () => {
    expect(firstFreeOrgCode([])).toBe(FIRST_ORG_CODE);
    expect(FIRST_ORG_CODE).toBe('Z01');
  });

  it('★ 쓰인 번호를 건너뛴다', () => {
    expect(firstFreeOrgCode(['Z01'])).toBe('Z02');
    expect(firstFreeOrgCode(['Z01', 'Z02', 'Z03'])).toBe('Z04');
  });

  it('★★ 중간 구멍을 메운다 — 최대값+1 이 아니다', () => {
    // 지운 입주사가 있으면 그 번호가 빈다. 최대값+1 로 가면 99개를 금방 태운다.
    // ★ 삐용 쪽에 그 코드의 회사가 남아 있으면 중복으로 거부되고, 그때 다음 번호로
    //   넘어간다(재시도 규칙). 그러니 구멍을 먼저 시도하는 것이 안전하다.
    expect(firstFreeOrgCode(['Z01', 'Z03'])).toBe('Z02');
  });

  it('ERP 코드가 아닌 값은 무시한다', () => {
    expect(firstFreeOrgCode(['HAN', 'ABC', 'Z01'])).toBe('Z02');
  });

  it('대소문자·공백이 섞여 있어도 같은 번호로 본다', () => {
    // DB 제약이 막지만, 레거시 행이나 손으로 넣은 값이 올 수 있다.
    expect(firstFreeOrgCode([' z01 '])).toBe('Z02');
  });

  it('★ 99개를 다 쓰면 null — 사람이 결정할 일이다', () => {
    const all = Array.from({ length: 99 }, (_, i) => `Z${String(i + 1).padStart(2, '0')}`);
    expect(all).toHaveLength(99);
    expect(all[0]).toBe('Z01');
    expect(all[98]).toBe('Z99');
    expect(firstFreeOrgCode(all)).toBeNull();
  });

  it('Z00 은 발급하지 않는다 — 번호는 1부터다', () => {
    expect(firstFreeOrgCode([])).not.toBe('Z00');
    // 어디선가 Z00 이 쓰이고 있어도 채번에 영향이 없다.
    expect(firstFreeOrgCode(['Z00'])).toBe('Z01');
  });
});
