import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from './contract-files.ts';
import {
  FACILITY_PURPOSE,
  FILE_TARGET_BUILDING,
  FILE_TARGET_FLOOR,
  facilityPurposeFor,
  facilityStoragePathFor,
  isFacilityTarget,
  rejectFacilityUpload,
} from './facility-files.ts';

const ok = { mimeType: 'application/pdf', size: 1024 };

describe('facilityPurposeFor', () => {
  it('대상마다 서류 종류가 하나씩이다', () => {
    expect(facilityPurposeFor(FILE_TARGET_BUILDING)).toBe('BUILDING_CONTRACT');
    expect(facilityPurposeFor(FILE_TARGET_FLOOR)).toBe('FLOOR_PLAN');
  });

  it('모르는 대상은 null — 지어내지 않는다', () => {
    expect(facilityPurposeFor('COMPANY')).toBeNull();
    expect(facilityPurposeFor('')).toBeNull();
    expect(isFacilityTarget('COMPANY')).toBe(false);
  });
});

describe('rejectFacilityUpload', () => {
  it('맞으면 통과한다', () => {
    expect(
      rejectFacilityUpload({ target: 'BUILDING', purpose: 'BUILDING_CONTRACT', ...ok }),
    ).toBeNull();
    expect(rejectFacilityUpload({ target: 'FLOOR', purpose: 'FLOOR_PLAN', ...ok })).toBeNull();
  });

  it('대상과 종류가 어긋나면 막는다 — 층 도면을 건물에 넣을 수 없다', () => {
    expect(rejectFacilityUpload({ target: 'BUILDING', purpose: 'FLOOR_PLAN', ...ok })).not.toBeNull();
  });

  it('모르는 대상은 막는다', () => {
    expect(rejectFacilityUpload({ target: 'COMPANY', purpose: 'CEO_ID', ...ok })).not.toBeNull();
  });

  /** ★ 형식·크기는 계약 서류와 **같은 함수**가 본다(`rejectBytes`). 여기서 그 연결을 지킨다. */
  it('형식·크기 규칙은 계약 서류와 같다', () => {
    const base = { target: 'BUILDING', purpose: 'BUILDING_CONTRACT' };
    expect(rejectFacilityUpload({ ...base, mimeType: 'image/gif', size: 1024 })).toBe(
      'JPG · PNG · PDF 만 올릴 수 있습니다',
    );
    expect(rejectFacilityUpload({ ...base, mimeType: 'image/png', size: 0 })).toBe('빈 파일입니다');
    expect(
      rejectFacilityUpload({ ...base, mimeType: 'image/png', size: MAX_FILE_BYTES + 1 }),
    ).toContain('10MB');
    expect(rejectFacilityUpload({ ...base, mimeType: 'image/png', size: MAX_FILE_BYTES })).toBeNull();
  });
});

describe('facilityStoragePathFor', () => {
  it('계약 서류와 같은 모양 — 운영사 번호로 시작한다', () => {
    expect(
      facilityStoragePathFor({
        operatorId: 1,
        target: 'BUILDING',
        targetId: 'B-1',
        fileId: 'f-1',
        mimeType: 'application/pdf',
      }),
    ).toBe('1/buildings/B-1/BUILDING_CONTRACT/f-1.pdf');

    expect(
      facilityStoragePathFor({
        operatorId: 7,
        target: 'FLOOR',
        targetId: 'F-9',
        fileId: 'f-2',
        mimeType: 'image/jpeg',
      }),
    ).toBe('7/floors/F-9/FLOOR_PLAN/f-2.jpg');
  });

  it('경로에 들어가는 종류는 `FACILITY_PURPOSE` 와 같다 — 두 벌로 적지 않았다', () => {
    const path = facilityStoragePathFor({
      operatorId: 1,
      target: 'FLOOR',
      targetId: 'F-1',
      fileId: 'f',
      mimeType: 'image/png',
    });
    expect(path).toContain(`/${FACILITY_PURPOSE.FLOOR}/`);
  });
});
