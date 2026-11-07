import { describe, expect, it } from 'vitest';
import {
  ARTICLES_REPLACE_CONFIRM,
  articlesStoragePathFor,
  canUploadArticles,
  INCORP_ARTICLES_NOTE,
  incorpArticlesFormName,
  incorpArticlesHref,
  LEGAL_ORG_FILE_TARGET,
} from './legal-articles-file.ts';

describe('법무 회사별 정관 파일(결정 2026-11-07)', () => {
  it('올리기 · 바꾸기 — 운영사 또는 회사 정보를 고칠 수 있는 사람만', () => {
    expect(canUploadArticles('operator', false)).toBe(true);
    expect(canUploadArticles('tenant', true)).toBe(true);
    expect(canUploadArticles('tenant', false)).toBe(false);
  });
  it('저장소 경로 — 운영사로 시작 · 단체 · ARTICLES · 원본 이름 없음', () => {
    expect(articlesStoragePathFor({ operatorId: 1, orgId: 9003, fileId: 'f-1', mimeType: 'application/pdf' })).toBe(
      '1/legal-orgs/9003/ARTICLES/f-1.pdf',
    );
    expect(articlesStoragePathFor({ operatorId: 1, orgId: 9003, fileId: 'f-2', mimeType: 'image/jpeg' })).toMatch(/\/f-2\.jpg$/);
  });
  it('대상 · 확인 문구', () => {
    expect(LEGAL_ORG_FILE_TARGET).toBe('LEGAL_ORG');
    expect(ARTICLES_REPLACE_CONFIRM).toBe('바꾸면 이전 정관 파일은 지워집니다');
  });
  it('설립 건 정관 바로가기 — 주소 표시 · 회사 형태에 맞는 정관 · 빈 칸 안내', () => {
    expect(incorpArticlesHref('16f561dd-87c2-4203-a571-4a4b14576f17')).toBe('/legal/incorporations/16f561dd-87c2-4203-a571-4a4b14576f17?print=articles');
    expect(incorpArticlesFormName('A')).toBe('정관(유한회사)');
    expect(incorpArticlesFormName('R')).toBe('정관');
    expect(INCORP_ARTICLES_NOTE).toBe('우리 시스템에서 설립한 회사 — 설립 건에서 정관을 출력합니다');
  });
});
