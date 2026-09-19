/**
 * 첨부 서류 저장소 — `tb_cm_file` (CONT-17).
 *
 * =============================================================================
 * ★★ 이 파일은 **DB 만** 만진다. 스토리지는 `lib/storage.ts` 다
 * =============================================================================
 * 두 곳에 나뉜 자원이라 순서가 중요하고, 그 순서를 정하는 것은 라우트(`routes/files.ts`)
 * 다. 여기서 스토리지를 부르면 순서가 두 파일에 흩어진다.
 *
 * =============================================================================
 * ★ RLS 가 켜져 있다 (020)
 * =============================================================================
 * `erp_files_operator_only` 정책이 `erp_is_operator()` 를 본다. 입주사 스코프로
 * 들어오면 SELECT 가 **0건**이고 INSERT 는 정책 위반으로 튕긴다. 라우트가 403 으로
 * 먼저 막지만, 그 한 줄이 빠져도 DB 가 막는다.
 */
import type { ScopedClient } from './withCompanyScope.ts';

interface Rows<T> {
  rows: T[];
  rowCount: number | null;
}
const q = <T>(client: ScopedClient, sql: string, params?: unknown[]): Promise<Rows<T>> =>
  client.query(sql, params) as Promise<Rows<T>>;

export interface FileRow {
  id: string;
  target_type: string;
  target_id: string;
  file_purpose: string;
  original_name: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: Date;
}

/** `tb_cm_file.target_type`. 이 기능은 이 값 하나만 쓴다. */
const TARGET_COMPANY = 'COMPANY';

/**
 * 한 회사의 첨부 전부.
 *
 * ★ `storage_path` 를 함께 준다 — 라우트가 이것으로 서명 URL 을 만든다.
 *   **주소는 DB 에 없다**(020 이 `storage_url` 컬럼을 지웠다).
 */
export async function listCompanyFiles(client: ScopedClient, companyId: string): Promise<FileRow[]> {
  const { rows } = await q<FileRow>(
    client,
    `SELECT id, target_type, target_id, file_purpose, original_name,
            storage_path, file_size, mime_type, created_at
       FROM public.tb_cm_file
      WHERE target_type = $1 AND target_id = $2
      ORDER BY file_purpose`,
    [TARGET_COMPANY, companyId],
  );
  return rows;
}

/** 한 건. 삭제 전에 **경로를 알아내려고** 부른다 — 지운 뒤에는 경로를 알 수 없다. */
export async function findCompanyFile(
  client: ScopedClient,
  companyId: string,
  fileId: string,
): Promise<FileRow | null> {
  const { rows } = await q<FileRow>(
    client,
    `SELECT id, target_type, target_id, file_purpose, original_name,
            storage_path, file_size, mime_type, created_at
       FROM public.tb_cm_file
      WHERE target_type = $1 AND target_id = $2 AND id = $3`,
    [TARGET_COMPANY, companyId, fileId],
  );
  return rows[0] ?? null;
}

/** 같은 종류의 기존 첨부. 재업로드할 때 **옛 파일을 지우려고** 먼저 찾는다. */
export async function findCompanyFileByPurpose(
  client: ScopedClient,
  companyId: string,
  purpose: string,
): Promise<FileRow | null> {
  const { rows } = await q<FileRow>(
    client,
    `SELECT id, target_type, target_id, file_purpose, original_name,
            storage_path, file_size, mime_type, created_at
       FROM public.tb_cm_file
      WHERE target_type = $1 AND target_id = $2 AND file_purpose = $3`,
    [TARGET_COMPANY, companyId, purpose],
  );
  return rows[0] ?? null;
}

/**
 * 종류당 한 장 — **옛 행을 지우고 새 행을 넣는다. 한 트랜잭션 안이다.**
 *
 * ★ UPDATE 가 아니라 DELETE+INSERT 인 이유: `id` 가 스토리지 경로에 들어간다.
 *   같은 행을 UPDATE 하면 id 는 그대로인데 경로만 바뀌어서, 「id 로 경로를 만든다」는
 *   규칙이 깨진다. 새 파일은 새 id 다.
 *
 * ★ 020 의 유일 인덱스가 같은 것을 DB 에서도 막는다. 동시에 두 번 올리면 두 번째가
 *   23505 로 튕긴다 — 응답이 실패하는 편이 파일 두 장이 남는 것보다 낫다.
 *
 * 돌려주는 값은 **지워진 옛 행**이다(없으면 null). 라우트가 그 경로의 스토리지
 * 실물을 지운다 — DB 가 먼저 커밋되고 그 다음이라, 실패하면 고아 파일이 남는다.
 */
export async function replaceCompanyFile(
  client: ScopedClient,
  input: {
    companyId: string;
    purpose: string;
    fileId: string;
    originalName: string;
    storagePath: string;
    mimeType: string;
    size: number;
    operatorId: number;
    createdBy: string | null;
  },
): Promise<{ previous: FileRow | null }> {
  const { rows: removed } = await q<FileRow>(
    client,
    `DELETE FROM public.tb_cm_file
      WHERE target_type = $1 AND target_id = $2 AND file_purpose = $3
      RETURNING id, target_type, target_id, file_purpose, original_name,
                storage_path, file_size, mime_type, created_at`,
    [TARGET_COMPANY, input.companyId, input.purpose],
  );

  await q(
    client,
    `INSERT INTO public.tb_cm_file
       (id, target_type, target_id, file_purpose, original_name,
        storage_path, file_size, mime_type, operator_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.fileId,
      TARGET_COMPANY,
      input.companyId,
      input.purpose,
      input.originalName,
      input.storagePath,
      input.size,
      input.mimeType,
      input.operatorId,
      input.createdBy,
    ],
  );

  return { previous: removed[0] ?? null };
}

/** 지운다. 실제로 지워졌는지(1행) 돌려준다 — 0행이면 남의 회사 것이거나 이미 없다. */
export async function deleteCompanyFile(
  client: ScopedClient,
  companyId: string,
  fileId: string,
): Promise<boolean> {
  const { rowCount } = await q(
    client,
    `DELETE FROM public.tb_cm_file
      WHERE target_type = $1 AND target_id = $2 AND id = $3`,
    [TARGET_COMPANY, companyId, fileId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * 이 회사가 속한 운영사 번호. `tb_cm_file.operator_id` 가 NOT NULL + FK 다(019).
 *
 * ★ 상수 `1` 을 박지 않는다. 지금 운영사가 하나뿐이라 결과는 같지만, 박아 두면
 *   둘째 운영사가 생기는 날 **모든 첨부가 1번 운영사 것으로 들어간다.**
 *   회사 → 건물 → 운영사로 타고 간다. 건물이 없으면 null 이고, 그때는 라우트가
 *   400 을 낸다 — 아무 번호나 골라 넣지 않는다.
 */
export async function operatorIdForCompany(
  client: ScopedClient,
  companyId: string,
): Promise<number | null> {
  const { rows } = await q<{ operator_id: number | null }>(
    client,
    `SELECT b.operator_id
       FROM public.tb_s080_companies c
       JOIN public.tb_s080_buildings b ON b.build_id = c.build_id
      WHERE c.company_id = $1`,
    [companyId],
  );
  return rows[0]?.operator_id ?? null;
}
