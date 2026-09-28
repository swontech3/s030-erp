import { describe, expect, it } from 'vitest';
import {
  BODY_MAX,
  DAILY_LIMIT,
  PAGE_SIZE,
  UNLOCK_MAX_ATTEMPTS,
  MAX_OPERATOR_ANSWERS,
  OPERATOR_DISPLAY_NAME,
  REPLY_BLOCK_MESSAGE,
  RETENTION_MONTHS,
  inquiryStatus,
  maskName,
  operatorReplyBlock,
  parseOperatorReply,
  type MessageKind,
  phoneDigits,
  validateFollowUp,
  validateInquiry,
  type InquiryInput,
} from './inquiry.ts';

/* ═══════════════════════════════════════════════════════════════════════════
   이름 가리기 — 목록에 실명이 나가지 않는 마지막 자리
   ★ 서버가 가려서 내려보낸다(02-screens.md §2). 화면에서 가리면 응답에는 남는다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('maskName', () => {
  it('성만 남기고 ** 를 붙인다', () => {
    expect(maskName('김도현')).toBe('김**');
  });

  it('★ 글자 수를 드러내지 않는다 — 몇 자든 ** 고정', () => {
    expect(maskName('남궁민수')).toBe('남**');
    expect(maskName('이산')).toBe('이**');
  });

  it('앞뒤 공백은 이름이 아니다', () => {
    expect(maskName('  박서준 ')).toBe('박**');
  });

  it('빈 이름이면 빈 문자열 — 「**」만 남겨 사람이 있는 척하지 않는다', () => {
    expect(maskName('')).toBe('');
    expect(maskName('   ')).toBe('');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   연락처 숫자만 — 스팸 판정이 표기 차이에 속지 않게
   ═══════════════════════════════════════════════════════════════════════════ */
describe('phoneDigits', () => {
  it('★ 010-1234-5678 과 01012345678 은 같은 연락처다', () => {
    expect(phoneDigits('010-1234-5678')).toBe(phoneDigits('01012345678'));
  });

  it('공백·괄호·+ 도 지운다', () => {
    expect(phoneDigits(' (010) 1234 5678 ')).toBe('01012345678');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   상태 — **마지막 글로 정한다**(03-thread.md §2)
   저장 컬럼이 아니다. 추가 질문이 달리면 다시 접수로 돌아간다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('inquiryStatus', () => {
  it('원글만 있으면 접수', () => {
    expect(inquiryStatus([])).toBe('R');
  });

  it('운영자 글 답변이 마지막이면 답변완료', () => {
    expect(inquiryStatus(['text'])).toBe('A');
  });

  it('전화 답변 기록도 답변완료다 — 본문이 없을 뿐 답은 했다', () => {
    expect(inquiryStatus(['phone'])).toBe('A');
  });

  it('★★★ 추가 질문이 달리면 다시 접수 — 운영자가 이 값으로 「답변 필요」를 찾는다', () => {
    expect(inquiryStatus(['text', 'customer'])).toBe('R');
  });

  it('추가 질문 뒤에 답하면 다시 답변완료', () => {
    expect(inquiryStatus(['text', 'customer', 'phone'])).toBe('A');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   등록 검증 — 화면과 서버가 같은 함수를 부른다
   ★ 화면 검사는 친절이고 **서버 검사가 규칙이다**. API 를 직접 찌르면 화면을 지나가지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
const OK: InquiryInput = {
  name: '김도현',
  phone: '010-2345-6789',
  email: 'kim@bridgelab.co.kr',
  companyName: '브릿지랩 주식회사',
  type: 'O',
  body: '3명이 함께 쓸 사무실을 찾고 있습니다.',
  password: '1234',
  agreed: true,
};
const TYPES = ['O', 'L', 'T', 'R', 'E'];

describe('validateInquiry', () => {
  it('다 채우면 통과한다', () => {
    expect(validateInquiry(OK, TYPES)).toEqual([]);
  });

  it('회사명은 선택이다', () => {
    expect(validateInquiry({ ...OK, companyName: '' }, TYPES)).toEqual([]);
  });

  it('이름은 공백 제외 1자 이상', () => {
    expect(validateInquiry({ ...OK, name: '   ' }, TYPES)).toEqual(['name']);
  });

  it('연락처는 숫자 10자리 이상', () => {
    expect(validateInquiry({ ...OK, phone: '010-234' }, TYPES)).toEqual(['phone']);
  });

  it('이메일 형식을 본다', () => {
    expect(validateInquiry({ ...OK, email: 'kim@bridgelab' }, TYPES)).toEqual(['email']);
  });

  it('★ 문의 유형은 **코드 마스터에 있는 값**이어야 한다 — 화면 밖에서 아무 값이나 오지 않게', () => {
    expect(validateInquiry({ ...OK, type: 'X' }, TYPES)).toEqual(['type']);
    expect(validateInquiry({ ...OK, type: '' }, TYPES)).toEqual(['type']);
  });

  it('본문은 1자 이상 1000자 이하', () => {
    expect(validateInquiry({ ...OK, body: '  ' }, TYPES)).toEqual(['body']);
    expect(validateInquiry({ ...OK, body: 'ㄱ'.repeat(BODY_MAX + 1) }, TYPES)).toEqual(['body']);
    expect(validateInquiry({ ...OK, body: 'ㄱ'.repeat(BODY_MAX) }, TYPES)).toEqual([]);
  });

  it('비밀번호는 4자 이상', () => {
    expect(validateInquiry({ ...OK, password: '123' }, TYPES)).toEqual(['password']);
  });

  it('★ 동의하지 않으면 등록할 수 없다 — 개인정보를 받는 근거가 없다', () => {
    expect(validateInquiry({ ...OK, agreed: false }, TYPES)).toEqual(['agreed']);
  });

  it('★ 여러 곳이 비면 **화면 순서대로** 전부 돌려준다 — 배너가 개수를 센다', () => {
    const empty: InquiryInput = {
      name: '', phone: '', email: '', companyName: '', type: '', body: '', password: '', agreed: false,
    };
    expect(validateInquiry(empty, TYPES)).toEqual(['name', 'phone', 'email', 'type', 'body', 'password', 'agreed']);
  });
});

describe('validateFollowUp', () => {
  it('공백만이면 막는다', () => {
    expect(validateFollowUp('   ')).toBe(false);
  });

  it('1000자까지', () => {
    expect(validateFollowUp('ㄱ'.repeat(BODY_MAX))).toBe(true);
    expect(validateFollowUp('ㄱ'.repeat(BODY_MAX + 1))).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   운영자 답변 — 문의 관리(s0300200080)가 쓴다
   ★ 화면과 서버가 이 함수 하나를 부른다. API 를 직접 찌르면 화면을 지나가지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('parseOperatorReply', () => {
  it('글답변은 앞뒤 공백을 떼고 담는다', () => {
    expect(parseOperatorReply('text', '  10시에 방문 가능합니다 ')).toEqual({
      kind: 'text',
      body: '10시에 방문 가능합니다',
    });
  });

  it('★ 공백만인 글답변은 답변이 아니다', () => {
    expect(parseOperatorReply('text', '   ')).toBeNull();
  });

  it('1000자까지', () => {
    expect(parseOperatorReply('text', 'ㄱ'.repeat(BODY_MAX))).not.toBeNull();
    expect(parseOperatorReply('text', 'ㄱ'.repeat(BODY_MAX + 1))).toBeNull();
  });

  it('★★ 전화 답변은 **본문이 없다** — 보내와도 버린다', () => {
    expect(parseOperatorReply('phone', '통화로 안내함')).toEqual({ kind: 'phone', body: null });
  });

  it('★★★ 운영자가 고객 글(customer)을 붙일 길은 없다', () => {
    expect(parseOperatorReply('customer', '고객인 척')).toBeNull();
  });

  it('모르는 kind 는 거절한다', () => {
    expect(parseOperatorReply('', '내용')).toBeNull();
    expect(parseOperatorReply('TEXT', '내용')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   답변 횟수 — 질문 하나에 답변 하나 · 최대 2회 (2026-09-28)
   ★ 화면의 잠금과 서버의 409 가 이 함수 하나를 본다.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('operatorReplyBlock', () => {
  it('★ 원글만 있으면 답할 수 있다 — 원글이 답 안 한 질문이다', () => {
    expect(operatorReplyBlock([])).toBeNull();
  });

  it('★★★ 답변1 뒤에는 막힌다 — 연달아 두 번 답하지 않는다', () => {
    expect(operatorReplyBlock(['text'])).toBe('nothing_to_answer');
    expect(operatorReplyBlock(['phone'])).toBe('nothing_to_answer');
  });

  it('★★★ 고객이 추가 질문을 남기면 다시 열린다', () => {
    expect(operatorReplyBlock(['text', 'customer'])).toBeNull();
  });

  it('★★★ 답변2 뒤에는 2회를 다 썼다', () => {
    expect(operatorReplyBlock(['text', 'customer', 'text'])).toBe('used_up');
    expect(operatorReplyBlock(['text', 'customer', 'phone'])).toBe('used_up');
    expect(operatorReplyBlock(['phone', 'customer', 'text'])).toBe('used_up');
  });

  it('★ 전화 답변도 한 번으로 센다 — 글답변과 같다', () => {
    expect(operatorReplyBlock(['phone'])).toBe('nothing_to_answer');
    expect(operatorReplyBlock(['phone', 'customer', 'phone'])).toBe('used_up');
  });

  it('★ 고객 글이 먼저 와도(추가 질문 먼저) 답할 수 있다', () => {
    expect(operatorReplyBlock(['customer'])).toBeNull();
  });

  it('★★ 흐름 전체 — 문의 → 답변1 → 추가 질문 → 답변2 → 끝', () => {
    const thread: MessageKind[] = [];
    expect(operatorReplyBlock(thread)).toBeNull(); // 답변1 가능
    thread.push('text');
    expect(operatorReplyBlock(thread)).toBe('nothing_to_answer');
    thread.push('customer');
    expect(operatorReplyBlock(thread)).toBeNull(); // 답변2 가능
    thread.push('text');
    expect(operatorReplyBlock(thread)).toBe('used_up');
  });

  it('이유마다 사람 말이 있다 — 화면과 서버가 같은 문장을 쓴다', () => {
    expect(REPLY_BLOCK_MESSAGE.used_up).toContain('두 번까지');
    expect(REPLY_BLOCK_MESSAGE.nothing_to_answer).toContain('추가 질문');
    // 둘 다 「수정」으로 안내한다 — 막고 끝내지 않는다
    expect(REPLY_BLOCK_MESSAGE.used_up).toContain('수정');
    expect(REPLY_BLOCK_MESSAGE.nothing_to_answer).toContain('수정');
  });
});

describe('상수 — 명세와 같은 값인가', () => {
  it('목록 20건 · 하루 3건 · 시도 5회', () => {
    expect(PAGE_SIZE).toBe(20);
    expect(DAILY_LIMIT).toBe(3);
    expect(UNLOCK_MAX_ATTEMPTS).toBe(5);
  });

  it('보유 기간 6개월 — 「보관 기간 지남」 표시의 기준(04-data-model §5)', () => {
    expect(RETENTION_MONTHS).toBe(6);
  });

  it('답변은 최대 2회 · 답변자 이름은 고정 문구다', () => {
    expect(MAX_OPERATOR_ANSWERS).toBe(2);
    expect(OPERATOR_DISPLAY_NAME).toBe('에스원비즈 운영담당자');
  });
});
