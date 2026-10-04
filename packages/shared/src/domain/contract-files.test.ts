/**
 * 첨부 서류 규칙 시험.
 *
 * ★ 여기서 지키는 것은 **화면과 서버가 같은 답을 낸다**는 것이다. 두 곳이 각자
 *   판정하면 화면을 우회한 요청이 통과한다(레거시 결함 ⑤ 와 같은 병).
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME_TYPES,
  DOC_DEFS,
  FILE_PURPOSES,
  MAX_FILE_BYTES,
  docRuleFor,
  isFilePurpose,
  missingDocsMessage,
  missingRequiredDocs,
  offRuleDocs,
  offRuleNote,
  rejectUpload,
  storagePathFor,
  visibleDocs,
} from './contract-files.ts';

const CORP = 'R'; // 주식회사
const SOLE = 'P'; // 개인사업자
const INDIV = 'Z'; // 개인

describe('서류 종류', () => {
  it('4종이고 DOC_DEFS 와 같은 집합이다', () => {
    expect(FILE_PURPOSES).toHaveLength(4);
    expect(DOC_DEFS.map((d) => d.purpose).sort()).toEqual([...FILE_PURPOSES].sort());
  });

  it('레거시 48행이 쓰던 문자열을 그대로 쓴다 — 이름을 바꾸면 옛 기록과 끊긴다', () => {
    for (const legacy of ['CEO_ID', 'BIZ_REG', 'EXISTING_CONTRACT']) {
      expect(isFilePurpose(legacy)).toBe(true);
    }
  });

  it('모르는 값은 거른다', () => {
    for (const bad of ['', 'ceo_id', 'PASSPORT', null, 7, undefined]) {
      expect(isFilePurpose(bad)).toBe(false);
    }
  });
});

describe('표시·필수 규칙', () => {
  it('신분증은 회원구분과 무관하게 항상 필수다', () => {
    for (const mt of [CORP, SOLE, INDIV, '']) {
      expect(docRuleFor('CEO_ID', mt)).toEqual({ show: true, required: true });
    }
  });

  it('★ 개인사업자도 사업자등록증이 필수다 — 법인 여부로 가르면 여기서 샌다', () => {
    expect(docRuleFor('BIZ_REG', SOLE).required).toBe(true);
    expect(docRuleFor('BIZ_REG', CORP).required).toBe(true);
  });

  it('개인(Z)만 사업자등록증이 선택이다', () => {
    expect(docRuleFor('BIZ_REG', INDIV)).toEqual({ show: true, required: false });
  });

  it('회원구분 미선택이면 사업자등록증은 선택이다 — 아직 모르는 것을 필수라 하지 않는다', () => {
    expect(docRuleFor('BIZ_REG', '').required).toBe(false);
  });

  it('법인등기부등본은 법인에만 보이고, 보여도 선택이다', () => {
    expect(docRuleFor('CORP_REG', CORP)).toEqual({ show: true, required: false });
    expect(docRuleFor('CORP_REG', SOLE).show).toBe(false);
    expect(docRuleFor('CORP_REG', INDIV).show).toBe(false);
    expect(docRuleFor('CORP_REG', '').show).toBe(false);
  });

  it('기존 이용계약서는 항상 보이고 항상 선택이다', () => {
    for (const mt of [CORP, SOLE, INDIV, '']) {
      expect(docRuleFor('EXISTING_CONTRACT', mt)).toEqual({ show: true, required: false });
    }
  });

  it('visibleDocs — 법인은 4장, 그 외는 3장', () => {
    expect(visibleDocs(CORP)).toHaveLength(4);
    expect(visibleDocs(SOLE)).toHaveLength(3);
    expect(visibleDocs(INDIV)).toHaveLength(3);
    expect(visibleDocs('')).toHaveLength(3);
  });

  it('앞뒤 공백이 붙은 코드도 같게 본다', () => {
    expect(docRuleFor('CORP_REG', ' R ').show).toBe(true);
    expect(docRuleFor('BIZ_REG', ' Z ').required).toBe(false);
  });
});

describe('업로드 검사', () => {
  const ok = { purpose: 'CEO_ID', mimeType: 'image/jpeg', size: 1024, memberType: CORP };

  it('정상 건은 통과한다', () => {
    expect(rejectUpload(ok)).toBeNull();
  });

  it('허용 형식 셋은 모두 통과한다 — 버킷 allowed_mime_types 와 같은 집합', () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(rejectUpload({ ...ok, mimeType: mime })).toBeNull();
    }
    expect(ALLOWED_MIME_TYPES).toHaveLength(3);
  });

  it('형식이 아니면 막는다', () => {
    for (const mime of ['image/gif', 'text/html', 'application/zip', '']) {
      expect(rejectUpload({ ...ok, mimeType: mime })).toMatch(/JPG/);
    }
  });

  it('경계 — 10MB 는 통과하고 1바이트 더면 막는다', () => {
    expect(rejectUpload({ ...ok, size: MAX_FILE_BYTES })).toBeNull();
    expect(rejectUpload({ ...ok, size: MAX_FILE_BYTES + 1 })).toMatch(/10MB/);
  });

  it('0바이트는 막는다 — 열리지 않는 첨부가 남는다', () => {
    expect(rejectUpload({ ...ok, size: 0 })).toBe('빈 파일입니다');
    expect(rejectUpload({ ...ok, size: -1 })).toBe('빈 파일입니다');
  });

  it('모르는 종류는 막는다', () => {
    expect(rejectUpload({ ...ok, purpose: 'PASSPORT' })).toMatch(/알 수 없는/);
  });

  it('★ 숨긴 카드로는 올릴 수 없다 — 화면을 우회한 요청을 서버가 막는 자리다', () => {
    expect(rejectUpload({ ...ok, purpose: 'CORP_REG', memberType: SOLE })).toMatch(/회원구분/);
    expect(rejectUpload({ ...ok, purpose: 'CORP_REG', memberType: INDIV })).toMatch(/회원구분/);
    // 법인이면 같은 요청이 통과한다 — 막는 것이 종류가 아니라 조합임을 보인다
    expect(rejectUpload({ ...ok, purpose: 'CORP_REG', memberType: CORP })).toBeNull();
  });
});

describe('규칙 밖 서류 — 회원구분을 바꾼 뒤 남는 것', () => {
  it('★ 법인으로 올린 등기부등본은 개인사업자로 바뀌면 규칙 밖이 된다', () => {
    // 올리는 길은 막혀 있다. 그래도 이 상태는 **회원구분을 바꾸면** 생긴다.
    expect(
      rejectUpload({ purpose: 'CORP_REG', mimeType: 'image/jpeg', size: 1024, memberType: SOLE }),
    ).toMatch(/회원구분/);
    expect(offRuleDocs(SOLE, ['CORP_REG']).map((d) => d.purpose)).toEqual(['CORP_REG']);
    expect(offRuleDocs(INDIV, ['CORP_REG']).map((d) => d.purpose)).toEqual(['CORP_REG']);
    expect(offRuleDocs('', ['CORP_REG']).map((d) => d.purpose)).toEqual(['CORP_REG']);
  });

  it('법인에게는 규칙 밖이 아니다 — 대조군', () => {
    expect(offRuleDocs(CORP, ['CORP_REG'])).toEqual([]);
  });

  it('보이는 칸에 붙은 서류는 규칙 밖이 아니다', () => {
    expect(offRuleDocs(SOLE, ['CEO_ID', 'BIZ_REG', 'EXISTING_CONTRACT'])).toEqual([]);
  });

  it('안 붙어 있으면 규칙 밖도 없다 — 빈 칸을 치우라고 하지 않는다', () => {
    expect(offRuleDocs(SOLE, [])).toEqual([]);
  });

  it('모르는 값은 무시한다', () => {
    expect(offRuleDocs(SOLE, ['PASSPORT', 'corp_reg'])).toEqual([]);
  });

  it('★ 규칙 밖은 **확정을 막지 않는다** — 필수가 아니라 치울 것이다', () => {
    expect(missingRequiredDocs(SOLE, ['CEO_ID', 'BIZ_REG', 'CORP_REG'])).toEqual([]);
  });

  it('이유 한 줄 — 코드가 아니라 표시명으로 말한다', () => {
    expect(offRuleNote('개인사업자')).toBe('개인사업자에는 필요 없는 서류입니다');
    expect(offRuleNote('개인')).toBe('개인에는 필요 없는 서류입니다');
    // 회원구분을 아직 안 골랐으면 이름이 없다. 그래도 문장이 돼야 한다.
    expect(offRuleNote('')).toBe('지금 회원구분에는 필요 없는 서류입니다');
    expect(offRuleNote('  ')).toBe('지금 회원구분에는 필요 없는 서류입니다');
  });
});

describe('스토리지 경로', () => {
  const args = {
    operatorId: 1,
    companyId: 'cmp_abc',
    purpose: 'CEO_ID' as const,
    fileId: '11111111-2222-3333-4444-555555555555',
    mimeType: 'image/jpeg',
  };

  it('운영사 번호로 시작한다 — 나중에 경로 접두사로 운영사를 가를 수 있다', () => {
    expect(storagePathFor(args)).toBe(
      '1/companies/cmp_abc/CEO_ID/11111111-2222-3333-4444-555555555555.jpg',
    );
  });

  it('형식마다 확장자가 다르다', () => {
    expect(storagePathFor({ ...args, mimeType: 'image/png' })).toMatch(/\.png$/);
    expect(storagePathFor({ ...args, mimeType: 'application/pdf' })).toMatch(/\.pdf$/);
  });

  it('★ 원본 파일 이름이 경로에 들어가지 않는다 — URL 에 사람 이름이 실린다', () => {
    // 인자로 받지도 않는다. 경로는 식별자만으로 만들어진다.
    expect(storagePathFor(args)).not.toMatch(/[가-힣]/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   계약확정 게이트
   ══════════════════════════════════════════════════════════════════════════ */

describe('계약확정에 빠진 서류', () => {
  const names = (memberType: string, attached: string[]) =>
    missingRequiredDocs(memberType, attached).map((d) => d.purpose);

  it('개인(Z)은 신분증 하나로 확정된다 — 사업자등록증을 묻지 않는다', () => {
    expect(names(INDIV, ['CEO_ID'])).toEqual([]);
    expect(missingDocsMessage(INDIV, ['CEO_ID'])).toBeNull();
  });

  it('법인은 신분증만으로는 막힌다 — 사업자등록증이 빠졌다', () => {
    expect(names(CORP, ['CEO_ID'])).toEqual(['BIZ_REG']);
    expect(missingDocsMessage(CORP, ['CEO_ID'])).toBe('계약을 확정하려면 사업자등록증이 필요합니다');
  });

  it('법인은 둘 다 있으면 확정된다', () => {
    expect(names(CORP, ['CEO_ID', 'BIZ_REG'])).toEqual([]);
  });

  it('★ 법인등기부등본은 없어도 막지 않는다 — 선택이다', () => {
    expect(names(CORP, ['CEO_ID', 'BIZ_REG'])).toEqual([]);
    expect(missingDocsMessage(CORP, ['CEO_ID', 'BIZ_REG'])).toBeNull();
  });

  it('★ 개인사업자(P)도 사업자등록증이 필요하다 — 법인 여부로 가르면 여기서 샌다', () => {
    expect(names(SOLE, ['CEO_ID'])).toEqual(['BIZ_REG']);
  });

  it('아무것도 없으면 빠진 것을 전부 말한다 — 하나씩 알려주고 돌려보내지 않는다', () => {
    expect(names(CORP, [])).toEqual(['CEO_ID', 'BIZ_REG']);
    expect(missingDocsMessage(CORP, [])).toBe(
      '계약을 확정하려면 대표자 신분증 · 사업자등록증이 필요합니다',
    );
  });

  it('회원구분 미선택은 신분증만 본다 — 아직 모르는 것을 필수라고 하지 않는다', () => {
    expect(names('', ['CEO_ID'])).toEqual([]);
    expect(names('', [])).toEqual(['CEO_ID']);
  });

  it('모르는 서류 종류가 섞여 있어도 필수를 대신하지 못한다', () => {
    expect(names(CORP, ['PASSPORT', 'CEO_ID'])).toEqual(['BIZ_REG']);
  });

  it('공백이 섞인 회원구분도 같은 답을 낸다 — DB 값이 늘 깨끗하지는 않다', () => {
    expect(names(' Z ', ['CEO_ID'])).toEqual([]);
    expect(names(' R ', ['CEO_ID'])).toEqual(['BIZ_REG']);
  });
});
