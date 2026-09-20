/**
 * 국세청 상태조회 호출부.
 *
 * 이 파일이 지키는 것은 하나다 — **국세청이 무슨 짓을 해도 던지지 않는다.**
 * 던지면 [확인] 버튼이 아니라 계약 폼 전체가 오류로 보인다. 확인이 안 되는 것은
 * 계약 등록을 막을 이유가 못 된다.
 *
 * ★ 실제 API 를 부르지 않는다. 바깥 호출은 `post` 로 주입해서, **응답을 어떻게
 *   읽는지**와 **실패했을 때 무엇을 하는지**만 본다.
 */
import { describe, it, expect } from 'vitest';
import { lookupNtsStatus } from './ntsStatus.ts';

const log = { warn: () => {}, error: () => {} };
const ok = (data: unknown) => () => Promise.resolve({ data } as { data: unknown });

describe('lookupNtsStatus', () => {
  it('계속사업자를 읽는다', async () => {
    const r = await lookupNtsStatus('1118100001', log, ok([{ b_stt_cd: '01', b_stt: '계속사업자' }]));
    expect(r.kind).toBe('active');
    expect(r.message).toContain('계속사업자');
  });

  it('폐업자는 폐업일까지 읽는다', async () => {
    const r = await lookupNtsStatus('1118100001', log, ok([{ b_stt_cd: '03', end_dt: '20240131' }]));
    expect(r.kind).toBe('closed');
    expect(r.message).toContain('2024-01-31');
  });

  it('등록되지 않은 번호를 구분한다', async () => {
    const r = await lookupNtsStatus('0000000000', log, ok([{ b_stt_cd: '' }]));
    expect(r.kind).toBe('unregistered');
  });

  it('data 가 비어 있으면 등록되지 않은 번호다', async () => {
    expect((await lookupNtsStatus('0000000000', log, ok([]))).kind).toBe('unregistered');
  });

  /* ── 여기서부터가 이 파일의 본론이다 ─────────────────────────────────── */

  it('국세청이 죽어도 던지지 않는다', async () => {
    const boom = () => Promise.reject(new Error('ETIMEDOUT'));
    await expect(lookupNtsStatus('1118100001', log, boom)).resolves.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('응답이 이상해도 던지지 않는다', async () => {
    const weird = () => Promise.resolve({ data: '이건 배열이 아니다' } as { data: unknown });
    await expect(lookupNtsStatus('1118100001', log, weird)).resolves.toMatchObject({
      kind: 'unavailable',
    });
  });

  /**
   * ★ 「확인하지 못했다」와 「등록되지 않았다」는 **다른 말**이다. 섞으면 멀쩡한
   *   번호가 없는 번호로 보이고, 운영자가 계약을 멈춘다.
   */
  it('확인 실패를 미등록으로 말하지 않는다', async () => {
    const failed = await lookupNtsStatus('1118100001', log, () => Promise.reject(new Error('x')));
    expect(failed.message).not.toContain('등록되지 않은');
    expect(failed.message).toContain('진행할 수 있습니다');
  });

  it('키가 없으면 부르지 않고 확인 불가로 답한다', async () => {
    let called = false;
    const spy = () => {
      called = true;
      return Promise.resolve({ data: [] } as { data: unknown });
    };
    const r = await lookupNtsStatus('1118100001', log, spy, null);
    expect(r.kind).toBe('unavailable');
    expect(called).toBe(false);
  });
});
