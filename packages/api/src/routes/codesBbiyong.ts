/**
 * 코드 관리(s030100030) — **주인이 삐용인 코드**(통합 방 · 대표 결정 2026-11-18).
 *
 *   GET   /codes-admin/bbiyong/types                          종류 목록
 *   GET   /codes-admin/bbiyong/values?category=&cdTp=         값 목록(사용 안 함 줄도)
 *   POST  /codes-admin/bbiyong/values                         추가   { category?, cdTp, cdV, cdVMeaning, sortSeq? }
 *   PATCH /codes-admin/bbiyong/values                         수정   { category?, cdTp, cdV, cdVMeaning, sortSeq? } — 이름 · 순서만
 *   PATCH /codes-admin/bbiyong/values/unuse                   사용 안 함 { category?, cdTp, cdV }
 *   PATCH /codes-admin/bbiyong/values/reuse                   다시 사용  { category?, cdTp, cdV }
 *
 * ★★ 넘기기만 한다 — 삐용 화면 토큰 API(명세 118 의 1 ~ 5-1)를 **로그인한 사람의 토큰**으로 부른다(`callBbiyong`).
 *    볼 수 있는지 · 고칠 수 있는지는 **삐용이** 화면일람 S030100030 의 VIEW · UPDATE 로 정한다 —
 *    여기서 역할로 사람을 막지 않는다(권한은 권한관리에서). 삐용이 거절하면 그 문구를 409 로 그대로 돌려준다.
 * ★ 지우기 · 새 종류 만들기는 없다 — 삐용에 그 주소가 없다(명세 2-1). 지우는 대신 「사용 안 함」.
 * ★ 같이 쓰는 코드(이메일 도메인 · 국가 · 시간대)를 고치면 ERP 서버의 보관을 비운다(`sharedCodes.forget`).
 * ★ ERP 주인 코드는 `routes/codes.ts`(`/codes-admin/**` 의 나머지)가 그대로 다룬다. 이 파일은 `bbiyong` 아래만.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireSession } from '../session/hook.ts';
import { callBbiyong } from '../session/bbiyongToken.ts';
import { bbiyongCodes, sharedCodes } from '../bbiyong/index.ts';
import {
  DEFAULT_CODE_CATEGORY,
  type BbiyongCodeKey,
  type BbiyongCodeOutcome,
  type BbiyongCodeWrite,
} from '../bbiyong/codes.ts';

type KeyBody = { category?: unknown; cdTp?: unknown; cdV?: unknown };
type WriteBody = KeyBody & { cdVMeaning?: unknown; sortSeq?: unknown };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 본문 → 열쇠. 종류 · 코드값이 없으면 null. 묶음이 비면 `000`(삐용과 같다). */
export function keyOf(b: KeyBody | undefined): BbiyongCodeKey | null {
  const cdTp = str(b?.cdTp);
  const cdV = str(b?.cdV);
  if (!cdTp || !cdV) return null;
  return { category: str(b?.category) || DEFAULT_CODE_CATEGORY, cdTp, cdV };
}

/** 본문 → 추가 · 수정. 순서는 비면 뺀다(삐용이 정한다) · 0 이상 정수가 아니면 null(400). */
export function writeOf(b: WriteBody | undefined): BbiyongCodeWrite | null {
  const key = keyOf(b);
  if (!key) return null;
  const cdVMeaning = str(b?.cdVMeaning);
  if (!cdVMeaning) return null;
  const s = b?.sortSeq;
  if (s === undefined || s === null || s === '') return { ...key, cdVMeaning };
  const n = typeof s === 'number' ? s : typeof s === 'string' && /^\d+$/.test(s.trim()) ? Number(s) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return { ...key, cdVMeaning, sortSeq: n };
}

function bad(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: 'invalid_request', message });
}

function send<T>(reply: FastifyReply, out: BbiyongCodeOutcome<T>, ok: (v: T) => object) {
  if (out.kind === 'rejected') return reply.code(409).send({ error: 'bbiyong_rejected', message: out.message });
  return reply.send(ok(out.value));
}

export function registerBbiyongCodeRoutes(app: FastifyInstance): void {
  app.get('/codes-admin/bbiyong/types', async (req, reply) => {
    const session = requireSession(req);
    const out = await callBbiyong(session.erpSid, (t) => bbiyongCodes.listTypes(t));
    return send(reply, out, (types) => ({ types }));
  });

  app.get<{ Querystring: { category?: string; cdTp?: string } }>('/codes-admin/bbiyong/values', async (req, reply) => {
    const session = requireSession(req);
    const cdTp = str(req.query.cdTp);
    if (!cdTp) return bad(reply, '코드 종류가 없습니다');
    const category = str(req.query.category) || DEFAULT_CODE_CATEGORY;
    const out = await callBbiyong(session.erpSid, (t) => bbiyongCodes.listValues(category, cdTp, t));
    return send(reply, out, (values) => ({ values }));
  });

  const write = (
    method: 'POST' | 'PATCH',
    url: string,
    parse: (b: WriteBody | undefined) => BbiyongCodeKey | null,
    call: (body: never, token: string) => Promise<BbiyongCodeOutcome<string>>,
    invalid: string,
  ) =>
    app.route<{ Body: WriteBody }>({
      method,
      url,
      handler: async (req, reply) => {
        const session = requireSession(req);
        const body = parse(req.body);
        if (!body) return bad(reply, invalid);
        const out = await callBbiyong(session.erpSid, (t) => call(body as never, t));
        if (out.kind === 'ok') sharedCodes.forget(body.cdTp);
        return send(reply, out, (message) => ({ ok: true, message }));
      },
    });

  write('POST', '/codes-admin/bbiyong/values', writeOf, (b, t) => bbiyongCodes.addValue(b, t), '종류 · 코드값 · 이름을 넣어 주세요(순서는 0 이상 숫자)');
  write('PATCH', '/codes-admin/bbiyong/values', writeOf, (b, t) => bbiyongCodes.updateValue(b, t), '종류 · 코드값 · 이름을 넣어 주세요(순서는 0 이상 숫자)');
  write('PATCH', '/codes-admin/bbiyong/values/unuse', keyOf, (b, t) => bbiyongCodes.unuseValue(b, t), '종류 · 코드값이 없습니다');
  write('PATCH', '/codes-admin/bbiyong/values/reuse', keyOf, (b, t) => bbiyongCodes.reuseValue(b, t), '종류 · 코드값이 없습니다');
}
