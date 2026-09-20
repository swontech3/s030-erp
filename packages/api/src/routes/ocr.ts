/**
 * 사업자등록증 **판독만** — 아직 입주사가 없는 계약 폼(`/contracts/new`)이 쓴다.
 *
 * =============================================================================
 * ★★★ 왜 첨부 업로드와 따로 있는가
 * =============================================================================
 * 첨부는 **회사에 붙는다**(`routes/files.ts`). 그래서 `companyId` 가 있어야 하는데,
 * 신규 등록 폼에는 아직 회사가 없다. 그런데 판독이 가장 쓸모 있는 순간이 바로
 * 그때다 — 섹션 1 이 통째로 비어 있으니까.
 *
 * 그래서 화면은 이렇게 한다:
 *   회사가 **있으면**  첨부 업로드 한 번으로 저장과 판독을 같이 한다(`files.ts`)
 *   회사가 **없으면**  이 라우트로 판독만 하고, 파일은 화면이 붙들고 있다가
 *                     첫 저장(회사 생성) 직후에 첨부로 올린다
 *
 * 두 경로 모두 판독은 **같은 함수**(`lib/bizRegScan.ts`)가 한다 — 두 벌이면 갈린다.
 *
 * =============================================================================
 * ★★ 아무것도 남기지 않는다
 * =============================================================================
 * 스토리지에 쓰지 않고, DB 를 열지 않고, **OCR 원문도 돌려주지 않는다.**
 * 이 라우트로 온 파일은 「아직 첨부가 아니다」 — 첨부로 남기려면 회사가 생긴 뒤
 * `POST /companies/:id/files` 로 다시 올라와야 한다. 그 일은 화면이 한다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rejectUpload } from '@swonbiz/shared/domain/contract-files';
import { requireSession } from '../session/hook.ts';
import { scanBizReg } from '../lib/bizRegScan.ts';

/** 첨부 라우트와 같은 값이다. 사업자등록증 판독은 입주사 업무가 아니다. */
const OPERATOR = 'operator';

function assertOperator(req: FastifyRequest, reply: FastifyReply): FastifyReply | null {
  const session = requireSession(req);
  if (session.role !== OPERATOR) {
    reply.code(403).send({ error: 'forbidden', message: '사업자등록증 판독은 운영사만 쓸 수 있습니다' });
    return reply;
  }
  return null;
}

export function registerOcrRoutes(app: FastifyInstance): void {
  app.post('/contracts/ocr-biz-reg', async (req, reply) => {
    const blocked = assertOperator(req, reply);
    if (blocked) return blocked;

    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      // 허용 형식이 아니면 content-type 파서가 붙지 않아 여기로 온다(`index.ts`).
      return reply
        .code(415)
        .send({ error: 'unsupported_media_type', message: 'JPG · PNG · PDF 만 읽을 수 있습니다' });
    }

    const mimeType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    /**
     * ★ 첨부와 **같은 함수**로 거른다. 이 파일은 곧 첨부로도 올라갈 파일이라,
     *   여기서 통과한 것이 저기서 막히면 「판독은 됐는데 첨부가 안 되는」 상태가 된다.
     *   `memberType` 은 아직 고르지 않았을 수 있어 빈 값으로 둔다 — `BIZ_REG` 는
     *   어느 회원구분에서도 보이는 칸이라(`docRuleFor`) 그 조합으로 막히지 않는다.
     */
    const reason = rejectUpload({ purpose: 'BIZ_REG', mimeType, size: body.length, memberType: '' });
    if (reason) return reply.code(400).send({ error: 'invalid_request', message: reason });

    // ★ `scanBizReg` 는 던지지 않는다. 못 읽으면 `null` 이고, 그 뜻은
    //   「섹션 1 을 건드리지 않는다」다.
    const bizReg = await scanBizReg(body, mimeType, req.log);

    // `no-store` — 중간 캐시에 남의 사업자등록증 판독 결과가 남지 않게 한다.
    return reply.header('cache-control', 'no-store').send({ bizReg });
  });
}
