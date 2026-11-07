/**
 * 법무 회사별 정관 파일(결정 2026-11-07) — 회사(단체 org_id)마다 한 개, 최종본만.
 *
 * ★ 저장은 ERP 기존 첨부 그대로 — 비공개 저장소(api `lib/storage.ts`) + `tb_cm_file` 한 줄
 *   (`target_type = LEGAL_ORG` · `target_id = 단체 org_id` · `file_purpose = ARTICLES`).
 *   유일 인덱스(020)가 회사당 한 개를 지킨다. 회사 세션은 자기 단체 행만(050 정책).
 * ★ 바꾸면 이전 파일은 지운다(행 · 저장소 실물) — 이력 없음. 순서는 계약 첨부와 같다(api `routes/files.ts` 머리말).
 * ★ 파일 종류 · 크기는 기존 첨부 규칙 그대로(`rejectBytes` — JPG · PNG · PDF · 10MB).
 * ★ 권한 — 올리기 · 바꾸기: 운영사 · 회사 정보를 고칠 수 있는 사람(`canEditCompany` — 입주사는 늘 false 라
 *   입주사는 운영사만). 보기: 운영사 · 그 회사 사람.
 * ★ 우리 시스템 설립 회사의 정관은 따로 저장하거나 만들지 않는다 — 완료된 설립 건이 있으면 그 상세로 가는
 *   바로가기만 준다(`completedIncorporationId`).
 */
import { extensionFor } from './contract-files.ts';
import { INCORP_LTD_ENTITY_TYPE } from './incorporation.ts';

/** `tb_cm_file.target_type` — 법무 단체. 050 정책이 이 값으로 회사 세션을 연다. */
export const LEGAL_ORG_FILE_TARGET = 'LEGAL_ORG';
/** `tb_cm_file.file_purpose` — 정관. */
export const ARTICLES_FILE_PURPOSE = 'ARTICLES';

/** 바꾸기 전 확인 문구(결정 2026-11-07). */
export const ARTICLES_REPLACE_CONFIRM = '바꾸면 이전 정관 파일은 지워집니다';

/** 「정관 파일」 칸이 비고 완료된 설립 건이 있을 때의 안내(결정 2026-11-07). */
export const INCORP_ARTICLES_NOTE = '우리 시스템에서 설립한 회사 — 설립 건에서 정관을 출력합니다';

/**
 * 「설립 건 정관 보기」 바로가기 — 설립 건 상세 주소에 표시 하나(`?print=articles`)를 단다(결정 2026-11-07).
 * 상세가 [서류 출력]을 열고 그 건의 정관을 골라 둔다. 다른 서류 · 다른 경로는 그대로다.
 */
export const INCORP_PRINT_ARTICLES = 'articles';
export function incorpArticlesHref(incorporationId: string): string {
  return `/legal/incorporations/${encodeURIComponent(incorporationId)}?print=${INCORP_PRINT_ARTICLES}`;
}

/**
 * 설립 건의 정관 서류 이름(= 양식 이름) — 유한회사 「정관(유한회사)」, 그 밖 「정관」.
 * 서류 목록은 서버가 이미 회사 형태로 거른다(`buildIncorpPrintDocuments`) — 이 이름으로 그중 하나를 고른다.
 */
export function incorpArticlesFormName(entityType: string): string {
  return entityType === INCORP_LTD_ENTITY_TYPE ? '정관(유한회사)' : '정관';
}

/** 올려 둔 정관 파일 한 개. 주소는 싣지 않는다 — 볼 때 따로 받는다(만료되는 주소). */
export interface ArticlesFileInfo {
  fileId: string;
  originalName: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedAt: string;
}

/** `GET /legal/orgs/:orgId/articles-file` · 올리기 응답. */
export interface ArticlesFileView {
  file: ArticlesFileInfo | null;
  /** 올리기 · 바꾸기를 할 수 있는가 — 운영사 또는 `canEditCompany`. 서버가 다시 판정한다. */
  canUpload: boolean;
  /** 그 단체의 완료된 법인설립 건(가장 최근) — 「설립 건 정관 보기」 바로가기. 없으면 null. */
  completedIncorporationId: string | null;
}

/** 올리기 · 바꾸기를 할 수 있는가 — 운영사이거나 회사 정보를 고칠 수 있는 사람. */
export function canUploadArticles(role: string, canEditCompany: boolean): boolean {
  return role === 'operator' || canEditCompany;
}

/**
 * 버킷 안의 경로 — 계약 서류 · 건물 · 층과 같은 모양.
 * `{operatorId}/legal-orgs/{orgId}/ARTICLES/{fileId}.{ext}`. 원본 이름은 경로에 쓰지 않는다(`original_name` 에만).
 */
export function articlesStoragePathFor(args: { operatorId: number; orgId: number; fileId: string; mimeType: string }): string {
  return `${args.operatorId}/legal-orgs/${args.orgId}/${ARTICLES_FILE_PURPOSE}/${args.fileId}.${extensionFor(args.mimeType)}`;
}
