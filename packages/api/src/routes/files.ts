/**
 * 첨부 서류 라우트 — CONT-17 (계약 폼 섹션 4).
 *
 * =============================================================================
 * ★★★ 자원이 **두 곳**에 나뉘어 있다 — 순서가 이 파일의 전부다
 * =============================================================================
 * 스토리지(실물)와 `tb_cm_file`(기록)이 따로 산다. 둘을 원자적으로 바꿀 방법은
 * 없다. 그래서 «둘이 어긋났을 때 **어느 쪽이 남을 것인가**»를 먼저 정하고,
 * 모든 순서를 거기에 맞춘다.
 *
 *     ★ 정한 것 — **고아 파일이 남는다. 기록 없는 파일은 남기지 않는다.**
 *
 * 왜 그쪽인가: 고아 파일은 **아무도 볼 수 없다.** 화면은 `tb_cm_file` 을 읽어
 * 목록을 만들고, 버킷은 비공개이며 경로에는 UUID 가 들어간다. 스토리지 용량이
 * 조금 새는 것이 전부다. 반대쪽 — 기록은 있는데 실물이 없는 상태 — 는 화면에
 * 「등록됨」으로 보이고, 눌러야 비로소 깨진다. **레거시 48행이 정확히 그 상태였다.**
 *
 * 그래서 순서는 이렇게 고정된다:
 *
 *     올릴 때   ① 스토리지에 쓴다  →  ② DB 에 쓴다
 *               ②가 실패하면 ①을 되돌린다. 되돌리기도 실패하면 **고아 파일이 남는다**
 *     지울 때   ① DB 에서 지운다  →  ② 스토리지에서 지운다
 *               ②가 실패하면 **고아 파일이 남는다**
 *     바꿀 때   ① 새 파일을 올린다 → ② DB 를 바꾼다 → ③ 옛 실물을 지운다
 *               ③이 실패하면 **옛 파일이 고아로 남는다**
 *
 * 어느 경우에도 **DB 에 있는데 스토리지에 없는 상태는 만들지 않는다.**
 * 실패는 전부 로그에 남긴다 — 조용히 삼키지 않는다(레거시 결함 ④).
 *
 * =============================================================================
 * ★★ 운영사 전용 — 세 흐름이 **같은 한 줄**을 본다 (레거시 결함 ⑤)
 * =============================================================================
 * 레거시는 업로드·조회·삭제의 권한 판정이 서로 달랐다. 여기서는 `assertOperator()`
 * 하나를 세 라우트가 모두 제일 먼저 부른다. 그리고 DB 쪽에도 같은 잠금이 있다 —
 * 020 의 RLS 정책이 `erp_is_operator()` 를 본다. 이 함수를 빼먹어도 DB 가 막는다.
 *
 * 여기 들어가는 것이 **주민등록증과 사업자등록증**이다. 한 겹으로 두지 않는다.
 *
 * =============================================================================
 * ★★ 형식·크기를 **서버에서 다시** 검사한다
 * =============================================================================
 * 화면도 검사하지만 화면은 우회할 수 있다. 검사 규칙은 화면과 **같은 함수**를 쓴다
 * (`@swonbiz/shared/domain/contract-files`) — 두 벌이면 언젠가 갈린다.
 * 버킷 `erp-files` 자체도 10MB · JPG/PNG/PDF 로 제한돼 있어 **세 겹**이다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  rejectUpload,
  storagePathFor,
  type FilePurpose,
} from '@swonbiz/shared/domain/contract-files';
import { requireSession } from '../session/hook.ts';
import { withCompanyScope, type CompanyScope } from '../db/withCompanyScope.ts';
import { findCompany } from '../db/companies.ts';
import {
  companyTarget,
  deleteFile,
  findFile,
  listFiles,
  operatorIdForCompany,
  replaceFile,
  type FileRow,
} from '../db/files.ts';
import { putObject, removeObject, signedUrl, StorageError } from '../lib/storage.ts';
import { scanBizReg } from '../lib/bizRegScan.ts';
import type { BizRegFields } from '@swonbiz/shared/domain/biz-reg-ocr';

/** 입주사 라우트와 같은 값이다. 첨부는 입주사 업무가 아니다. */
const OPERATOR = 'operator';

const scopeOf = (session: { role: string; companyId: string | null }): CompanyScope => ({
  role: session.role as CompanyScope['role'],
  companyId: session.companyId,
});

/**
 * ★ 세 라우트가 **가장 먼저** 부르는 한 줄. 업로드·조회·삭제의 기준이 갈리지 않게
 *   하는 것이 목적이다(레거시 결함 ⑤). 막았으면 reply 를 돌려주고, 통과면 null.
 */
function assertOperator(req: FastifyRequest, reply: FastifyReply): FastifyReply | null {
  const session = requireSession(req);
  if (session.role !== OPERATOR) {
    // ★ 「없는 회사」와 「볼 수 없는 회사」를 구분해 주지 않는다 — 탐색의 단서가 된다.
    reply.code(403).send({ error: 'forbidden', message: '첨부 서류는 운영사만 다룰 수 있습니다' });
    return reply;
  }
  return null;
}

const notFound = (reply: FastifyReply) =>
  reply.code(404).send({ error: 'not_found', message: '입주사를 찾을 수 없습니다' });

/** 응답 모양. ★ `storage_path` 는 내보내지 않는다 — 버킷 내부 구조를 알릴 이유가 없다. */
function toFile(row: FileRow, url: string | null) {
  return {
    fileId: row.id,
    purpose: row.file_purpose,
    originalName: row.original_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    /**
     * ★ **만료된다.** 화면은 이 값을 저장하지 않고 그때그때 다시 받는다.
     *   DB 에도 없다(020 이 `storage_url` 컬럼을 지웠다).
     */
    url,
  };
}

export function registerFileRoutes(app: FastifyInstance): void {
  // ★ 바이트 본문의 content-type 파서는 `index.ts` 에서 한 번만 등록한다 —
  //   Fastify 는 같은 타입을 두 번 등록하면 던지고, 첨부와 OCR 이 같은 파서를 쓴다.

  // ── 목록 ────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/companies/:id/files', async (req, reply) => {
    const blocked = assertOperator(req, reply);
    if (blocked) return blocked;

    const rows = await withCompanyScope(scopeOf(requireSession(req)), async (client) => {
      const company = await findCompany(client, req.params.id);
      if (!company) return null;
      return listFiles(client, companyTarget(req.params.id));
    });
    if (rows === null) return notFound(reply);

    // ★ 서명 URL 은 **행마다 스토리지를 한 번 부른다.** 서류는 최대 4장이라 4회다.
    //   한 장이 실패해도 목록 전체를 죽이지 않는다 — 나머지는 보여주고 그 칸만 null 이다.
    const files = await Promise.all(
      rows.map(async (row) => {
        try {
          return toFile(row, await signedUrl(row.storage_path));
        } catch (err) {
          req.log.error({ err, fileId: row.id }, '서명 URL 발급 실패 — 그 칸만 비운다');
          return toFile(row, null);
        }
      }),
    );
    return reply.send({ files });
  });

  // ── 업로드 (같은 종류가 있으면 바꾼다) ──────────────────────────────────
  app.post<{ Params: { id: string }; Querystring: { purpose?: string } }>(
    '/companies/:id/files',
    async (req, reply) => {
      const blocked = assertOperator(req, reply);
      if (blocked) return blocked;

      const body = req.body;
      if (!Buffer.isBuffer(body)) {
        // 허용 형식이 아니면 content-type 파서가 붙지 않아 여기로 온다.
        return reply
          .code(415)
          .send({ error: 'unsupported_media_type', message: 'JPG · PNG · PDF 만 올릴 수 있습니다' });
      }

      const purpose = req.query.purpose ?? '';
      const mimeType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
      const originalName = readFileName(req.headers['x-file-name']);
      if (!originalName) {
        return reply.code(400).send({ error: 'invalid_request', message: '파일 이름이 없습니다' });
      }

      const session = requireSession(req);
      const prepared = await withCompanyScope(scopeOf(session), async (client) => {
        const company = await findCompany(client, req.params.id);
        if (!company) return { kind: 'not-found' as const };

        // ★ 화면과 **같은 함수**로 검사한다. 종류·형식·크기, 그리고 회원구분과의 조합까지.
        //   숨겨진 카드(개인사업자의 법인등기부등본)로 들어오는 요청이 여기서 막힌다.
        const reason = rejectUpload({
          purpose,
          mimeType,
          size: body.length,
          memberType: company.member_type ?? '',
        });
        if (reason) return { kind: 'rejected' as const, reason };

        const operatorId = await operatorIdForCompany(client, req.params.id);
        if (operatorId === null) {
          // 건물이 없으면 어느 운영사인지 알 수 없다. 아무 번호나 넣지 않는다.
          return { kind: 'rejected' as const, reason: '이 입주사의 운영사를 확인할 수 없습니다' };
        }
        return { kind: 'ok' as const, operatorId };
      });

      if (prepared.kind === 'not-found') return notFound(reply);
      if (prepared.kind === 'rejected') {
        return reply.code(400).send({ error: 'invalid_request', message: prepared.reason });
      }

      const fileId = randomUUID();
      const storagePath = storagePathFor({
        operatorId: prepared.operatorId,
        companyId: req.params.id,
        purpose: purpose as FilePurpose,
        fileId,
        mimeType,
      });

      /* ══════════════════════════════════════════════════════════════════
         ★★ 사업자등록증이면 **같은 바이트로 판독까지** 한다
         ══════════════════════════════════════════════════════════════════
         예전에는 화면이 파일을 두 번 보냈다 — 첨부로 한 번, 판독으로 한 번.
         10MB 짜리를 두 번 올리는 것도 문제지만, 더 나쁜 것은 **두 번이 다른
         파일일 수 있다는 것**이다. 사람이 첨부와 판독 사이에 다른 파일을 고르면
         섹션 1 은 A 를 읽고 첨부는 B 가 남는다. 한 번 받아 둘 다 쓰면 그 틈이 없다.

         ★ 판독은 `BIZ_REG` 에서만 돈다. 신분증·등기부등본·기존계약서는 읽지 않는다 —
           사업자등록증 양식을 전제한 파서라 다른 서류에서는 엉뚱한 값이 나오고,
           무엇보다 **신분증을 외부 API 에 보낼 이유가 없다.**

         ★ 스토리지 쓰기와 **동시에** 돈다. 줄 세우면 Vision 왕복(1~3초)만큼 첨부가
           늦어지는데, 둘은 서로의 결과를 쓰지 않는다.

         ★ `scanBizReg` 는 던지지 않는다(그쪽 파일 머리말). 그래서 판독 실패가
           업로드 실패가 되는 길이 없다. */
      const scanning: Promise<BizRegFields | null> =
        purpose === 'BIZ_REG' ? scanBizReg(body, mimeType, req.log) : Promise.resolve(null);

      // ── ① 스토리지 먼저 ───────────────────────────────────────────────
      try {
        await putObject({ path: storagePath, body, contentType: mimeType });
      } catch (err) {
        req.log.error({ err, storagePath }, '스토리지 업로드 실패 — DB 는 건드리지 않았다');
        // ★ 첨부가 실패해도 **이미 읽은 값은 돌려준다.** 판독은 끝났고, 그 결과를
        //   버리면 운영자가 같은 파일을 다시 올려 같은 판독을 또 시켜야 한다.
        return storageFailed(reply, err, await scanning);
      }

      // ── ② DB. 실패하면 ①을 되돌린다 ──────────────────────────────────
      let previous: FileRow | null = null;
      try {
        const result = await withCompanyScope(scopeOf(session), (client) =>
          replaceFile(client, {
            target: companyTarget(req.params.id),
            purpose,
            fileId,
            originalName,
            storagePath,
            mimeType,
            size: body.length,
            operatorId: prepared.operatorId,
            createdBy: String(session.s020MemberId),
          }),
        );
        previous = result.previous;
      } catch (err) {
        // ★ 기록 없는 파일을 남기지 않는다. 되돌리기가 또 실패하면 그때는 고아로 남긴다.
        req.log.error({ err, storagePath }, 'DB 기록 실패 — 방금 올린 실물을 되돌린다');
        await removeObject(storagePath).catch((cleanupErr: unknown) => {
          req.log.error(
            { err: cleanupErr, storagePath },
            '★ 되돌리기 실패 — 고아 파일이 남았다. 기록은 없다(의도한 방향)',
          );
        });
        // ★ 던지지 않고 여기서 답한다 — 전역 핸들러로 보내면 본문이 통째로 갈리면서
        //   **이미 끝난 판독 결과까지 사라진다.** 사용자에게 보이는 것(500 + 일반 문구)은
        //   전역 핸들러와 같게 두고, `bizReg` 만 살린다.
        return reply.code(500).send({
          error: 'internal_error',
          message: '서버 오류가 났습니다',
          bizReg: await scanning,
        });
      }

      // ── ③ 옛 실물. 여기서 실패해도 **응답은 성공**이다 ────────────────
      //    새 파일과 새 기록은 이미 짝이 맞다. 남는 것은 아무도 못 보는 옛 파일뿐이다.
      const replacedPath = previous?.storage_path ?? null;
      if (replacedPath) {
        await removeObject(replacedPath).catch((err: unknown) => {
          req.log.error(
            { err, storagePath: replacedPath },
            '★ 옛 실물 삭제 실패 — 고아 파일이 남았다. 기록은 이미 새것을 가리킨다',
          );
        });
      }

      let url: string | null = null;
      try {
        url = await signedUrl(storagePath);
      } catch (err) {
        req.log.error({ err, storagePath }, '업로드는 됐고 서명 URL 만 실패 — 화면이 다시 받는다');
      }

      return reply.code(201).send({
        file: toFile(
          {
            id: fileId,
            target_type: 'COMPANY',
            target_id: req.params.id,
            file_purpose: purpose,
            original_name: originalName,
            storage_path: storagePath,
            file_size: body.length,
            mime_type: mimeType,
            created_at: new Date(),
          },
          url,
        ),
        /** 옛 파일을 바꿔치웠는가 — 화면이 「교체했습니다」라고 말할 수 있게. */
        replaced: previous !== null,
        /**
         * ★ 사업자등록증을 읽은 결과. 다른 서류거나 판독이 안 되면 `null` 이고,
         *   그 뜻은 「섹션 1 을 건드리지 않는다」다. **OCR 원문은 싣지 않는다.**
         */
        bizReg: await scanning,
      });
    },
  );

  // ── 삭제 ────────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string; fileId: string } }>(
    '/companies/:id/files/:fileId',
    async (req, reply) => {
      const blocked = assertOperator(req, reply);
      if (blocked) return blocked;

      // ★ 지우기 **전에** 경로를 읽어 둔다. 지운 뒤에는 어디에 있는지 알 수 없다.
      const target = await withCompanyScope(scopeOf(requireSession(req)), async (client) => {
        const row = await findFile(client, companyTarget(req.params.id), req.params.fileId);
        if (!row) return null;
        const removed = await deleteFile(client, companyTarget(req.params.id), req.params.fileId);
        return removed ? row : null;
      });

      if (!target) {
        return reply.code(404).send({ error: 'not_found', message: '첨부 서류를 찾을 수 없습니다' });
      }

      // ── DB 가 먼저 지워졌다. 실물이 안 지워지면 고아로 남는다 ─────────
      //    반대 순서로 하면 «실물은 없는데 목록에는 있는» 상태가 되고, 그게 더 나쁘다.
      try {
        await removeObject(target.storage_path);
      } catch (err) {
        req.log.error(
          { err, storagePath: target.storage_path },
          '★ 실물 삭제 실패 — 고아 파일이 남았다. 기록은 지워졌다(의도한 방향)',
        );
        // 응답은 성공이다. 사용자 입장에서 그 첨부는 사라졌고, 실제로 아무도 볼 수 없다.
      }

      return reply.code(204).send();
    },
  );
}

/**
 * 원본 파일 이름. 헤더로 오므로 **인코딩돼 있다** — 한글 이름이 그대로 헤더에
 * 들어가면 HTTP 규격 위반이라 프록시가 끊는다.
 *
 * ★ 경로 조각(`/`, `..`)을 지운다. 이 값은 경로에 쓰이지 않지만(경로는 UUID 다),
 *   나중에 누가 다운로드 파일명으로 쓸 때를 대비한다.
 */
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

/**
 * 스토리지가 거절한 것을 사용자 문구로. 내부 주소·토큰은 내보내지 않는다.
 *
 * ★ `bizReg` 를 실어 보낸다. 첨부는 실패했어도 판독은 끝났을 수 있고, 그 값은
 *   섹션 1 을 채우는 데 쓸 수 있다 — 둘은 서로의 실패에 끌려가지 않는다.
 */
function storageFailed(
  reply: FastifyReply,
  err: unknown,
  bizReg: BizRegFields | null,
): FastifyReply {
  if (err instanceof StorageError && err.status === 413) {
    return reply.code(400).send({ error: 'invalid_request', message: '파일이 너무 큽니다', bizReg });
  }
  return reply.code(502).send({
    error: 'storage_unavailable',
    message: '파일 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요',
    bizReg,
  });
}
