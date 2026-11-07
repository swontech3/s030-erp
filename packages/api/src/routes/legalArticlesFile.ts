/**
 * 법무 회사별 정관 파일(결정 2026-11-07) — 법인변경 상세 「기본정보」 카드의 「정관 파일」.
 *
 *   GET  /legal/orgs/:orgId/articles-file        { file, canUpload, completedIncorporationId }
 *   GET  /legal/orgs/:orgId/articles-file/url    { url, originalName } — 만료되는 주소(no-store). 없으면 404
 *   POST /legal/orgs/:orgId/articles-file        올리기 · 바꾸기 — 본문은 파일 바이트, 원본 이름은 `X-File-Name`
 *
 * ★ 단체는 법인변경과 같은 규칙으로 읽는다(`parseOrgTarget`) — 회사 세션이 남의 단체를 적으면 403.
 *   회사 세션은 050 정책으로 DB 에서도 자기 단체 행만 보이고 쓸 수 있다.
 * ★ 올리기 · 바꾸기: 운영사 또는 회사 정보를 고칠 수 있는 사람(`canEditCompany` — 입주사는 늘 false 라
 *   입주사는 운영사만). 보기: 운영사 · 그 회사 사람. 권한은 트랜잭션 밖에서 한 번 정한다(`companyEditor` — 삐용).
 * ★★ 순서는 계약 첨부(`routes/files.ts` 머리말)와 같다 — 기록 없는 파일은 남기지 않는다:
 *      ① 새 실물을 올린다 → ② 한 트랜잭션에서 옛 행을 지우고 새 행을 넣는다(`replaceFile`, 실패하면 ①을 지운다)
 *      → ③ 커밋 뒤 옛 실물을 지운다(실패하면 옛 파일이 고아로 남고 로그에 적는다). 이력은 남기지 않는다.
 * ★ 형식 · 크기는 기존 첨부 규칙 그대로(`rejectBytes`). 버킷도 같은 제한이다.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ErpSession } from '@swonbiz/shared';
import { rejectBytes } from '@swonbiz/shared/domain/contract-files';
import { parseOrgTarget } from '@swonbiz/shared/domain/corp-change-detail';
import {
  ARTICLES_FILE_PURPOSE,
  articlesStoragePathFor,
  canUploadArticles,
  type ArticlesFileView,
} from '@swonbiz/shared/domain/legal-articles-file';
import { requireSession } from '../session/hook.ts';
import { scopeOfSession, withCompanyScope, type ScopedClient } from '../db/withCompanyScope.ts';
import { readCompanySource } from '../db/corpChanges.ts';
import { replaceFile, type FileRow } from '../db/files.ts';
import {
  completedIncorporationIdOf,
  findArticlesFile,
  legalOrgTarget,
  operatorIdForLegalOrg,
} from '../db/legalArticlesFile.ts';
import { putObject, removeObject, signedUrl, StorageError } from '../lib/storage.ts';
import { canEditLegalCompany } from '../legal/companyEditGrant.ts';

/** 바꿔 끼울 수 있는 바깥 — 시험이 DB · 저장소 · 삐용 없이 순서와 권한을 본다. */
export interface LegalArticlesFileDeps {
  run<T>(session: ErpSession, fn: (client: ScopedClient) => Promise<T>): Promise<T>;
  /** 회사 정보를 고칠 수 있는가(`canEditLegalCompany`) — 트랜잭션 밖에서 부른다. */
  companyEditor(session: ErpSession): Promise<boolean>;
  putObject(args: { path: string; body: Buffer; contentType: string }): Promise<void>;
  removeObject(path: string): Promise<void>;
  signedUrl(path: string): Promise<string>;
}

const defaultDeps: LegalArticlesFileDeps = {
  run: (session, fn) => withCompanyScope(scopeOfSession(session), fn),
  companyEditor: (session) => canEditLegalCompany(session),
  putObject,
  removeObject,
  signedUrl,
};

const toInfo = (row: FileRow) => ({
  fileId: row.id,
  originalName: row.original_name,
  fileSize: row.file_size,
  mimeType: row.mime_type,
  uploadedAt: new Date(row.created_at).toISOString(),
});

/** 화면에 줄 모양 — 파일 · 올릴 수 있는지 · 완료된 설립 건. */
async function readView(client: ScopedClient, session: ErpSession, orgId: number, editor: boolean): Promise<ArticlesFileView> {
  const source = await readCompanySource(client, orgId);
  const file = await findArticlesFile(client, orgId);
  return {
    file: file ? toInfo(file) : null,
    canUpload: canUploadArticles(session.role, editor && !source.isTenant),
    completedIncorporationId: await completedIncorporationIdOf(client, orgId),
  };
}

/** 원본 이름 — 계약 첨부와 같은 규칙(경로 구분자 · `..` 를 지우고 200자). */
function readFileName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  name = name.replace(/[\\/]/g, '_').replace(/\.{2,}/g, '.').trim();
  if (name === '' || name === '.') return null;
  return name.slice(0, 200);
}

const bad = (reply: FastifyReply, status: number, message: string) =>
  reply.code(status).send({ error: status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'invalid_request', message });

export function registerLegalArticlesFileRoutes(app: FastifyInstance, deps: LegalArticlesFileDeps = defaultDeps): void {
  /** 주소의 단체 — 회사 세션은 자기 단체만(403). */
  const orgOf = (session: ErpSession, raw: string) => parseOrgTarget(raw, null, session);

  app.get<{ Params: { orgId: string } }>('/legal/orgs/:orgId/articles-file', async (req, reply) => {
    const session = requireSession(req);
    const org = orgOf(session, req.params.orgId);
    if (!org.ok) return bad(reply, org.status, org.message);
    const editor = await deps.companyEditor(session);
    return reply.send(await deps.run(session, (client) => readView(client, session, org.value.orgId, editor)));
  });

  app.get<{ Params: { orgId: string } }>('/legal/orgs/:orgId/articles-file/url', async (req, reply) => {
    const session = requireSession(req);
    reply.header('Cache-Control', 'no-store');
    const org = orgOf(session, req.params.orgId);
    if (!org.ok) return bad(reply, org.status, org.message);
    const row = await deps.run(session, (client) => findArticlesFile(client, org.value.orgId));
    if (!row) return bad(reply, 404, '올려 둔 정관 파일이 없습니다');
    try {
      return reply.send({ url: await deps.signedUrl(row.storage_path), originalName: row.original_name });
    } catch (err) {
      req.log.error({ err, fileId: row.id }, '정관 파일 서명 URL 발급 실패');
      return reply.code(502).send({ error: 'storage_unavailable', message: '파일 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요' });
    }
  });

  app.post<{ Params: { orgId: string } }>('/legal/orgs/:orgId/articles-file', async (req, reply) => {
    const session = requireSession(req);
    const org = orgOf(session, req.params.orgId);
    if (!org.ok) return bad(reply, org.status, org.message);
    const orgId = org.value.orgId;

    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      // 허용 형식이 아니면 content-type 파서가 붙지 않아 여기로 온다(계약 첨부와 같다).
      return reply.code(415).send({ error: 'unsupported_media_type', message: 'JPG · PNG · PDF 만 올릴 수 있습니다' });
    }
    const mimeType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    const originalName = readFileName(req.headers['x-file-name']);
    if (!originalName) return bad(reply, 400, '파일 이름이 없습니다');
    const rejected = rejectBytes(mimeType, body.length);
    if (rejected) return bad(reply, 400, rejected);

    const editor = await deps.companyEditor(session);
    const prepared = await deps.run(session, async (client) => {
      const source = await readCompanySource(client, orgId);
      if (!canUploadArticles(session.role, editor && !source.isTenant)) return { kind: 'forbidden' as const };
      const operatorId = await operatorIdForLegalOrg(client, source);
      return operatorId === null ? { kind: 'no-operator' as const } : { kind: 'ok' as const, operatorId };
    });
    if (prepared.kind === 'forbidden') {
      return bad(reply, 403, '정관 파일은 운영사 또는 회사 정보 수정 권한이 있는 사람만 올릴 수 있습니다');
    }
    if (prepared.kind === 'no-operator') return bad(reply, 400, '이 회사의 운영사를 확인할 수 없습니다');

    const fileId = randomUUID();
    const storagePath = articlesStoragePathFor({ operatorId: prepared.operatorId, orgId, fileId, mimeType });

    // ── ① 실물 먼저 ──
    try {
      await deps.putObject({ path: storagePath, body, contentType: mimeType });
    } catch (err) {
      req.log.error({ err, storagePath }, '정관 파일 업로드 실패 — DB 는 건드리지 않았다');
      if (err instanceof StorageError && err.status === 413) return bad(reply, 400, '파일이 너무 큽니다');
      return reply.code(502).send({ error: 'storage_unavailable', message: '파일 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요' });
    }

    // ── ② 옛 행 지우고 새 행 — 한 트랜잭션. 실패하면 ① 을 지운다 ──
    let previous: FileRow | null;
    try {
      previous = (
        await deps.run(session, (client) =>
          replaceFile(client, {
            target: legalOrgTarget(orgId),
            purpose: ARTICLES_FILE_PURPOSE,
            fileId,
            originalName,
            storagePath,
            mimeType,
            size: body.length,
            operatorId: prepared.operatorId,
            createdBy: String(session.s020MemberId),
          }),
        )
      ).previous;
    } catch (err) {
      req.log.error({ err, storagePath }, '정관 파일 DB 기록 실패 — 방금 올린 실물을 되돌린다');
      await deps.removeObject(storagePath).catch((cleanupErr: unknown) => {
        req.log.error({ err: cleanupErr, storagePath }, '★ 되돌리기 실패 — 고아 파일이 남았다. 기록은 없다(의도한 방향)');
      });
      throw err;
    }

    // ── ③ 커밋 뒤 옛 실물을 지운다 — 이력은 남기지 않는다 ──
    if (previous) {
      await deps.removeObject(previous.storage_path).catch((err: unknown) => {
        req.log.error({ err, storagePath: previous.storage_path }, '★ 이전 정관 파일 실물 삭제 실패 — 고아 파일이 남았다. 기록은 바뀌었다');
      });
    }

    return reply.send(await deps.run(session, (client) => readView(client, session, orgId, editor)));
  });
}
