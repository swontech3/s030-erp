/**
 * 문의상담관리(s030200080) — 앱 안 휴대폰 모양 규칙 · 앱 1단계 5-나 (대표 지시 2026-11-07)
 *
 * ★ 같은 화면 `/inquiry-admin` 이다. 처리 기능(답변 · 전화로 답변함 · 답변 수정)은 그대로이고 모양만 바뀐다.
 * ★ 휴대폰 모양은 **앱 안일 때만** 켠다 — PC 브라우저는 좁은 창이어도 지금 화면 그대로다.
 *   - 목록 : 접수만 · 상태 칩 감춤 · 이름 · 연락처 검색 남김 · 정렬은 지금 그대로(원글 순 — 서버)
 *   - 상세 : 글 삭제 감춤(PC 만)
 *   - 목록 ↔ 상세는 한 장씩. 상세를 열 때 방문 기록을 남긴다 — 폰 [뒤로] = 목록으로
 */
import { describe, expect, it } from 'vitest';
import { detailHistory, initialStatus, inquiryAdminLayout, resetStatus, retentionDeleteHint } from './inquiry-admin-layout';

const APP = inquiryAdminLayout(true);
const PC = inquiryAdminLayout(false);

describe('inquiryAdminLayout', () => {
  it('앱 안 — 휴대폰 모양 · 상태 칩 감춤 · 삭제 감춤 · 접수 고정 · 상세 열기는 기록을 남긴다', () => {
    expect(APP).toEqual({ phone: true, statusChips: false, deleteButton: false, fixedStatus: 'R', detailHistory: 'push' });
  });
  it('앱 아님(PC) — 지금 그대로', () => {
    expect(PC).toEqual({ phone: false, statusChips: true, deleteButton: true, fixedStatus: null, detailHistory: 'replace' });
  });
});

describe('initialStatus — 처음 상태 거르기(주소 ?st=)', () => {
  it.each([['all'], ['A'], ['R'], [null], ['']])('앱 안은 주소(%p)와 상관없이 접수', (st) => {
    expect(initialStatus(APP, st)).toBe('R');
  });
  it('PC — st=all 이면 전체(null)', () => {
    expect(initialStatus(PC, 'all')).toBeNull();
  });
  it('PC — st=A 면 그 상태', () => {
    expect(initialStatus(PC, 'A')).toBe('A');
  });
  it.each([[null], ['']])('PC — 없으면(%p) 접수', (st) => {
    expect(initialStatus(PC, st)).toBe('R');
  });
});

describe('resetStatus — 빈 목록의 [전체 보기]', () => {
  it('앱 안은 접수를 놓지 않는다(유형 · 검색어만 비운다)', () => {
    expect(resetStatus(APP)).toBe('R');
  });
  it('PC 는 상태도 전체로 — 지금 그대로', () => {
    expect(resetStatus(PC)).toBeNull();
  });
});

describe('detailHistory — 고른 문의가 바뀔 때 주소를 어떻게 적는가', () => {
  it('앱 안 · 목록에서 상세를 열 때 → 기록을 남긴다(push)', () => {
    expect(detailHistory(APP, null, '7')).toBe('push');
  });
  it('앱 안 · 상세를 닫을 때(뒤로 · 조건 바꿈) → 기록을 쌓지 않는다', () => {
    expect(detailHistory(APP, '7', null)).toBe('replace');
  });
  it('앱 안 · 상세에서 다른 상세로 → 기록을 쌓지 않는다', () => {
    expect(detailHistory(APP, '7', '8')).toBe('replace');
  });
  it('앱 안 · 고른 것이 그대로(거르기만 바뀜) → 기록을 쌓지 않는다', () => {
    expect(detailHistory(APP, null, null)).toBe('replace');
  });
  it.each([
    [null, '7'],
    ['7', null],
    ['7', '8'],
  ])('PC(%p → %p) → 지금처럼 기록을 쌓지 않는다', (prev, next) => {
    expect(detailHistory(PC, prev, next)).toBe('replace');
  });
});

describe('retentionDeleteHint — 「보관 기간 지남」 안내의 지우는 곳(9-나)', () => {
  it('PC(삭제 단추 보임) — 지금 문구 그대로', () => {
    expect(retentionDeleteHint(PC.deleteButton)).toBe('[글 삭제]로 개인정보를 지워 주세요.');
  });
  it('앱 안(삭제 단추 감춤) — PC 화면에서 지우라고 알린다', () => {
    expect(retentionDeleteHint(APP.deleteButton)).toBe('PC 화면에서 [글 삭제]로 개인정보를 지워 주세요.');
  });
});
