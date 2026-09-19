/**
 * 첨부 서류(CONT-17) — **판정만** 한다. 스토리지도 DB 도 여기서 만지지 않는다.
 *
 * =============================================================================
 * ★★ 화면과 서버가 **같은 규칙**을 본다
 * =============================================================================
 * 레거시의 결함 ⑤ 가 «권한 판정이 흐름마다 다름» 이었다. 형식·크기·서류 종류도 같은
 * 병이 든다 — 화면이 거르는 것과 서버가 거르는 것이 갈리면, 화면을 우회한 요청이
 * 그대로 통과한다. 그래서 규칙을 이 파일 하나에 두고 **양쪽이 이것을 부른다.**
 *
 *   화면  `SectionDocs`      — 카드를 보일지, 「필수」인지, 고른 파일을 막을지
 *   서버  `routes/files.ts`  — 같은 함수로 **다시** 검사한다(화면을 믿지 않는다)
 *
 * =============================================================================
 * ★ 첨부는 **회사(COMPANY)에 붙는다** — 계약이 아니다
 * =============================================================================
 * 신분증·사업자등록증은 회사의 속성이지 계약의 속성이 아니다. 계약에 붙이면
 * **재계약할 때마다 같은 신분증을 다시 올려야 한다.** `tb_cm_file.target_type`
 * 이 이미 polymorphic 이라 `'COMPANY'` 하나만 쓰면 된다.
 */

/** `tb_cm_file.target_type`. 이 기능은 이 값 하나만 쓴다. */
export const FILE_TARGET_COMPANY = 'COMPANY';

/**
 * 서류 4종. **값이 `tb_cm_file.file_purpose` 에 그대로 들어간다** —
 * 레거시 48행도 같은 문자열을 썼다(`CEO_ID`·`BIZ_REG`·`EXISTING_CONTRACT`).
 * 이름을 바꾸면 옛 기록과 이어지지 않으므로 바꾸지 않는다.
 */
export const FILE_PURPOSES = ['CEO_ID', 'BIZ_REG', 'CORP_REG', 'EXISTING_CONTRACT'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export function isFilePurpose(value: unknown): value is FilePurpose {
  return typeof value === 'string' && (FILE_PURPOSES as readonly string[]).includes(value);
}

/**
 * 허용 형식. **버킷 `erp-files` 의 `allowed_mime_types` 와 같은 값이어야 한다** —
 * 스토리지가 마지막 방어선이고, 여기는 사용자에게 이유를 말해 주기 위한 첫 번째 방어선이다.
 * 둘이 갈리면 화면은 통과시키는데 업로드가 500 으로 죽는다.
 */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

/** 확장자 — 스토리지 경로를 만들 때 쓴다. `mime_type` 이 정본이고 이건 표기용이다. */
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export function extensionFor(mimeType: string): string {
  return EXT_BY_MIME[mimeType] ?? 'bin';
}

/** 파일당 최대 크기. 버킷의 `file_size_limit`(10485760)과 같은 값이다. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 화면 안내 문구가 이 값을 쓴다 — 「최대 10MB」를 두 곳에 적지 않는다. */
export const MAX_FILE_MB = MAX_FILE_BYTES / 1024 / 1024;

/* ══════════════════════════════════════════════════════════════════════════
   서류 종류별 표시·필수 규칙
   ══════════════════════════════════════════════════════════════════════════ */

export interface DocDef {
  purpose: FilePurpose;
  name: string;
  desc: string;
}

/** 화면에 뜨는 순서다. 명세 「섹션 4」의 차례를 그대로 쓴다. */
export const DOC_DEFS: readonly DocDef[] = [
  { purpose: 'CEO_ID', name: '대표자 신분증', desc: '주민등록증 또는 운전면허증 사본' },
  { purpose: 'BIZ_REG', name: '사업자등록증', desc: '사업자등록 전이면 발급 후 제출해 주세요' },
  { purpose: 'CORP_REG', name: '법인등기부등본', desc: '최근 3개월 이내 발급본' },
  { purpose: 'EXISTING_CONTRACT', name: '기존 이용계약서', desc: '타 지점·타 사에서 이전해 온 경우' },
];

export interface DocRule {
  /** 카드를 그리는가. `false` 면 **업로드도 막는다** — 안 보이는 칸에 파일이 들어가면 안 된다. */
  show: boolean;
  /** 「필수」 뱃지. 저장을 막지는 않는다 — 막는 것은 계약확정 쪽 규칙이고 여기 없다. */
  required: boolean;
}

/**
 * 회원구분(`MEMBER_TYPE` 코드)이 표시·필수를 정한다.
 *
 *   법인 R·A·C·S   신분증 필수 · 사업자등록증 필수 · 법인등기부등본 **표시**(선택)
 *   개인사업자 P    신분증 필수 · 사업자등록증 필수 · 법인등기부등본 숨김
 *   개인 Z          신분증 필수 · 사업자등록증 **선택** · 법인등기부등본 숨김
 *   미선택 ''       신분증만 필수. 나머지는 선택 — 아직 모르는 것을 필수라고 하지 않는다
 *
 * ★ 기존 이용계약서는 **항상 보이고 항상 선택**이다. 이전해 온 회사만 내는 서류라
 *   회원구분과 무관하다.
 *
 * ★ 사업자등록증 판정에 `isCorpMemberType` 을 쓰지 않는다. 그러면 **개인사업자가
 *   사업자등록증 없이 통과한다** — 두 규칙은 가르는 선이 다르다(개인 `Z` 만 예외).
 */
export function docRuleFor(purpose: FilePurpose, memberType: string): DocRule {
  const code = memberType.trim();
  switch (purpose) {
    case 'CEO_ID':
      return { show: true, required: true };
    case 'BIZ_REG':
      // 개인(Z)만 선택이다. 미선택('')도 선택으로 둔다 — 아직 모른다.
      return { show: true, required: code !== '' && code !== MEMBER_TYPE_INDIVIDUAL };
    case 'CORP_REG':
      return { show: isCorpMemberType(code), required: false };
    case 'EXISTING_CONTRACT':
      return { show: true, required: false };
  }
}

/** 개인 — 사업자등록이 아직 없을 수 있다. 017 이 만든 코드다. */
export const MEMBER_TYPE_INDIVIDUAL = 'Z';
/** 개인사업자 — 사업자등록을 한 개인. 법인은 아니다. */
export const MEMBER_TYPE_SOLE_PROPRIETOR = 'P';

/** 법인인가 — **개인(Z)·개인사업자(P)가 아닌 전부**. 미선택('')은 법인이 아니다. */
export function isCorpMemberType(memberType: string): boolean {
  const code = memberType.trim();
  return code !== '' && code !== MEMBER_TYPE_INDIVIDUAL && code !== MEMBER_TYPE_SOLE_PROPRIETOR;
}

/** 이 회원구분에서 화면에 보일 서류들. */
export function visibleDocs(memberType: string): readonly DocDef[] {
  return DOC_DEFS.filter((d) => docRuleFor(d.purpose, memberType).show);
}

/* ══════════════════════════════════════════════════════════════════════════
   업로드 검사
   ══════════════════════════════════════════════════════════════════════════ */

export interface UploadCandidate {
  purpose: string;
  mimeType: string;
  size: number;
  memberType: string;
}

/** 통과면 `null`, 아니면 **사용자에게 보여줄 문구**. 기계용 코드가 아니다. */
export function rejectUpload(c: UploadCandidate): string | null {
  if (!isFilePurpose(c.purpose)) return '알 수 없는 서류 종류입니다';

  // ★ 숨긴 카드로는 올릴 수 없다. 화면에 없는 칸을 API 로 찔러 넣는 것을 막는다 —
  //   개인사업자에게 법인등기부등본이 붙으면 아무도 그것을 볼 화면이 없다.
  if (!docRuleFor(c.purpose, c.memberType).show) {
    return '이 회원구분에서는 등록할 수 없는 서류입니다';
  }

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(c.mimeType)) {
    return 'JPG · PNG · PDF 만 올릴 수 있습니다';
  }

  // 0바이트는 «고르다 만 파일»이다. 스토리지에 넣으면 열리지 않는 첨부가 생긴다.
  if (c.size <= 0) return '빈 파일입니다';
  if (c.size > MAX_FILE_BYTES) return `파일당 최대 ${MAX_FILE_MB}MB 까지 올릴 수 있습니다`;

  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   스토리지 경로
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * 버킷 안의 경로. **레거시와 같은 모양을 쓴다** —
 * `{operatorId}/companies/{companyId}/{PURPOSE}/{fileId}.{ext}`
 *
 * ★ 운영사 번호로 시작하는 것이 중요하다. 나중에 스토리지 정책을 걸 때 경로
 *   접두사로 운영사를 가를 수 있다. 회사 식별자로 시작하면 그게 안 된다.
 *
 * ★ **파일 이름에 원본 이름을 쓰지 않는다.** 「최현수_신분증.jpg」가 경로에 들어가면
 *   URL 에 사람 이름이 실린다. 원본 이름은 `original_name` 에만 둔다.
 */
export function storagePathFor(args: {
  operatorId: number;
  companyId: string;
  purpose: FilePurpose;
  fileId: string;
  mimeType: string;
}): string {
  const ext = extensionFor(args.mimeType);
  return `${args.operatorId}/companies/${args.companyId}/${args.purpose}/${args.fileId}.${ext}`;
}
