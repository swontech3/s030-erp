/**
 * 사업자등록증 OCR 파서 — **실제 4장으로 돌린다.**
 *
 * 픽스처는 `__fixtures__/biz-reg-samples.ts` 에 있고, 그 파일 머리말에 왜 합성
 * 텍스트를 쓰지 않는지가 적혀 있다. 여기서는 그 결과만 본다.
 *
 * 아래 두 덩어리는 목적이 다르다.
 *   ① 표본 4장          — 장마다 7개 필드를 **전부** 맞히는가
 *   ② 레거시 결함 6건    — 그 장에서 레거시가 어떻게 틀렸고, 왜 지금은 안 틀리는가
 * ②는 ①과 겹치지만 일부러 남긴다. ①이 깨지면 「어느 장이 틀렸다」만 알 수 있고,
 * ②가 깨지면 **어느 결함이 되살아났는지**를 이름으로 알 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { parseBizReg, bizRegPatch } from './biz-reg-ocr.ts';
import { SAMPLES, CORP_1, CORP_2, SOLE_1, SOLE_2 } from './__fixtures__/biz-reg-samples.ts';

describe('표본 4장', () => {
  it.each(SAMPLES)('$name — 7개 필드를 전부 읽는다', ({ text, expected }) => {
    expect(parseBizReg(text)).toEqual(expected);
  });
});

describe('레거시 결함 6건', () => {
  /**
   * ① 개인 ① 에서 「상호」가 `상성개 사` / `호 : 값` 으로 쪼개져 레거시는 null 을 냈다.
   *    라벨의 **꼬리 글자만 남은 줄**을 알아보지 못하면 이 테스트가 깨진다.
   */
  it('① 라벨이 세로로 쪼개져도 회사명을 읽는다', () => {
    expect(parseBizReg(SOLE_1).companyName).toBe('사바사엔터테인먼트(SabaEnt)');
  });

  /**
   * ② 두 가지 형태로 터졌다.
   *    - 법인 ② : 한 줄에 두 필드 → 값 뒤의 **다음 라벨까지** 삼킴
   *    - 개인 ② : 라벨이 `성명(대표자)` 라 **괄호 잔여물**이 값에 붙음
   *    레거시는 라벨 뒤를 `([^\n]+)` 로 줄 끝까지 먹어서 둘 다 틀렸다.
   */
  it('② 대표자가 같은 줄의 뒤 필드를 삼키지 않는다', () => {
    expect(parseBizReg(CORP_2).ceoName).toBe('박라마');
  });

  it('② 대표자에 라벨 잔여물이 붙지 않는다', () => {
    expect(parseBizReg(SOLE_2).ceoName).toBe('최아자');
  });

  /**
   * ③ 레거시는 「문서에서 **처음 보이는** 하이픈 숫자」를 번호로 삼았다. 개인 ② 의
   *    `주민(법인)등록번호` 밑에 있는 **주민등록번호**가 법인등록번호 칸에 들어갔다.
   *    번호는 반드시 **라벨로** 고른다.
   */
  it('③ 주민등록번호를 법인등록번호로 넣지 않는다', () => {
    const fields = parseBizReg(SOLE_2);
    expect(fields.corpNumber).toBeNull();
    // 주민등록번호가 **어느 칸에도** 새지 않는다 — 칸을 하나 고치고 다른 칸으로 새면 의미가 없다.
    expect(Object.values(fields).join('|')).not.toContain('800101');
  });

  it('③ 사업자번호를 라벨로 고른다 — 머리글의 전화번호를 집지 않는다', () => {
    expect(parseBizReg(CORP_2).bizNumber).toBe('222-81-00002');
  });

  /**
   * ④ 개인 ② 에는 「법인」이라는 **글자**가 세 군데 있다(`상호(법인명)` 등). 레거시는
   *    `/법인/` 한 번으로 법인이라 판정해 개인사업자를 `R`(주식회사)로 저장했다.
   */
  it('④ 「법인」이라는 글자만으로 회원구분을 정하지 않는다', () => {
    expect(SOLE_2).toContain('법인'); // 글자는 분명히 있다
    expect(parseBizReg(SOLE_2).memberType).toBe('P');
  });

  /**
   * ⑤ 주소는 **읽지 않는다.** 등록증의 주소는 사업장 소재지이고 폼의 주소 칸은
   *    대표자 자택이다(`tenant-registration.ts` address 주석). 다른 개념을 채우면
   *    계약서에 틀린 주소가 인쇄된다. 레거시에도 없었고 여기에도 넣지 않는다.
   */
  it('⑤ 주소를 읽지 않는다 — 사업장 소재지가 어느 칸에도 들어가지 않는다', () => {
    const fields = parseBizReg(CORP_1);
    expect(Object.keys(fields).some((k) => /addr|주소|zip/i.test(k))).toBe(false);
    expect(Object.values(fields).join('|')).not.toContain('테헤란로');
  });

  /**
   * ⑥ 레거시는 라벨 바로 뒤 한 조각을 값으로 썼다. 개인 ② 에서 종목 라벨 뒤에 있던
   *    워터마크 조각 `ATION` 이 그대로 종목이 됐다. **읽을 수 없으면 비운다** —
   *    화면이 non-null 만 덮으므로, 비우면 사람이 채우고 잡음은 조용히 저장된다.
   */
  it('⑥ 라벨 뒤 잡음을 종목으로 넣지 않는다', () => {
    expect(SOLE_2).toContain('ATION'); // 잡음은 분명히 있다
    expect(parseBizReg(SOLE_2).businessItem).toBeNull();
  });

  /**
   * ⑥ 반대쪽 — 읽을 수 있는 장에서는 업태와 종목이 **서로 섞이지 않는다.**
   *    개인 ① 은 OCR 이 두 열을 뒤섞어 내놓은 장이다.
   */
  it('⑥ 업태 값이 종목 칸으로 새지 않는다', () => {
    const fields = parseBizReg(SOLE_1);
    expect(fields.businessType).toBe('서비스업');
    expect(fields.businessItem).toBe('공연, 제작, 에이전시');
  });
});

describe('회원구분', () => {
  it('법인 2장은 법인등록번호와 함께 법인 코드가 나온다', () => {
    for (const text of [CORP_1, CORP_2]) {
      const fields = parseBizReg(text);
      expect(fields.memberType).toBe('R');
      expect(fields.corpNumber).toMatch(/^\d{6}-\d{7}$/);
    }
  });

  it('개인 2장은 P 이고 법인등록번호가 없다', () => {
    for (const text of [SOLE_1, SOLE_2]) {
      const fields = parseBizReg(text);
      expect(fields.memberType).toBe('P');
      expect(fields.corpNumber).toBeNull();
    }
  });
});

describe('빈 입력', () => {
  it('빈 문자열이면 모든 칸이 null 이다 — 빈 문자열로 폼을 덮지 않는다', () => {
    expect(parseBizReg('')).toEqual({
      companyName: null,
      ceoName: null,
      bizNumber: null,
      corpNumber: null,
      memberType: null,
      businessType: null,
      businessItem: null,
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   폼에 얹기 — **non-null 만 덮는다**
   ══════════════════════════════════════════════════════════════════════════ */
describe('bizRegPatch', () => {
  const ALL_CODES = ['R', 'A', 'C', 'S', 'P', 'Z'];

  it('읽지 못한 칸은 patch 에 넣지 않는다 — 폼의 기존 값을 지우지 않는다', () => {
    const { patch } = bizRegPatch(parseBizReg(SOLE_2), ALL_CODES);
    expect(patch).not.toHaveProperty('corpno');
    expect(patch).not.toHaveProperty('bizKind');
    expect(patch).not.toHaveProperty('industry');
  });

  it('등록증 업태는 bizKind 로, 종목은 industry 로 간다', () => {
    const { patch } = bizRegPatch(parseBizReg(CORP_1), ALL_CODES);
    expect(patch.bizKind).toBe('도매 및 소매업');
    expect(patch.industry).toBe('수산물 가공식품 도매업');
  });

  it('불러온 칸 수를 센다 — 화면의 「n개 불러왔습니다」가 이 수다', () => {
    expect(bizRegPatch(parseBizReg(CORP_1), ALL_CODES).applied).toBe(7);
    expect(bizRegPatch(parseBizReg(SOLE_2), ALL_CODES).applied).toBe(4);
  });

  it('하나도 못 읽으면 applied 가 0 이다', () => {
    expect(bizRegPatch(parseBizReg(''), ALL_CODES).applied).toBe(0);
  });

  /**
   * ★ 코드 목록에 없는 회원구분은 넣지 않는다. Select 에 없는 값을 넣으면 칸이 빈 채로
   *   보이는데 폼 상태에는 값이 있다 — 저장하면 아무도 고른 적 없는 코드가 들어간다.
   */
  it('코드 목록에 없는 회원구분은 넣지 않는다', () => {
    const { patch } = bizRegPatch(parseBizReg(CORP_1), ['P', 'Z']);
    expect(patch).not.toHaveProperty('memberType');
  });

  /**
   * ★★ 사업자번호를 덮으면 **확인 상태를 되돌려야 한다.** 되돌리지 않으면 앞서 다른
   *    번호로 받은 「확인됨」 표시가 새 번호에 그대로 남는다 — 확인한 적 없는 번호가
   *    확인된 것으로 보인다.
   */
  it('사업자번호를 덮으면 확인 상태를 되돌리라고 알린다', () => {
    expect(bizRegPatch(parseBizReg(CORP_1), ALL_CODES).resetBizCheck).toBe(true);
  });

  it('사업자번호를 못 읽었으면 확인 상태를 건드리지 않는다', () => {
    expect(bizRegPatch(parseBizReg(''), ALL_CODES).resetBizCheck).toBe(false);
  });
});
