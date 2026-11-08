/**
 * 메일 부품 — 설정 읽기 · 보내기(nodemailer 를 가짜로 바꿔 끼운다. ★ 실제로 보내지 않는다).
 */
import { describe, expect, it } from 'vitest';
import { createMailer, smtpConfigOf } from './mailer.ts';

const FULL = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'user', SMTP_PASSWORD: 'pw', SMTP_FROM: 'erp@example.com' };

describe('smtpConfigOf — .env 의 SMTP 칸', () => {
  it('다섯 칸이 있으면 설정', () => {
    expect(smtpConfigOf(FULL)).toEqual({ host: 'smtp.example.com', port: 587, user: 'user', password: 'pw', from: 'erp@example.com' });
  });

  it('주소 · 포트 · 보내는 주소 중 하나라도 비면 설정 없음(null)', () => {
    expect(smtpConfigOf({})).toBeNull();
    expect(smtpConfigOf({ ...FULL, SMTP_HOST: ' ' })).toBeNull();
    expect(smtpConfigOf({ ...FULL, SMTP_FROM: '' })).toBeNull();
    expect(smtpConfigOf({ ...FULL, SMTP_PORT: 'abc' })).toBeNull();
    expect(smtpConfigOf({ ...FULL, SMTP_PORT: '0' })).toBeNull();
  });

  it('계정 · 비밀번호는 둘 다 없으면 인증 없이(사내 중계), 하나만 있으면 설정 없음', () => {
    expect(smtpConfigOf({ ...FULL, SMTP_USER: '', SMTP_PASSWORD: '' })).toMatchObject({ user: null, password: null });
    expect(smtpConfigOf({ ...FULL, SMTP_PASSWORD: '' })).toBeNull();
  });
});

describe('createMailer', () => {
  it('설정이 없으면 ready false · 보내면 던진다', async () => {
    const m = createMailer(null);
    expect(m.ready).toBe(false);
    await expect(m.send({ to: ['a@x.com'], subject: 's', text: 't', attachments: [] })).rejects.toThrow('메일 발송 설정이 아직 없습니다');
  });

  it('★ 보내는 주소 · 받는 사람 · 제목 · 본문 · 첨부를 그대로 넘긴다 — 465 는 SSL', async () => {
    const opts: unknown[] = [];
    const sent: Record<string, unknown>[] = [];
    const m = createMailer(smtpConfigOf({ ...FULL, SMTP_PORT: '465' }), (o) => {
      opts.push(o);
      return { sendMail: async (msg) => void sent.push(msg) };
    });
    expect(m.ready).toBe(true);
    await m.send({ to: ['a@x.com', 'b@x.com'], subject: '제목', text: '본문', attachments: [{ filename: '세무자료.xlsx', content: new Uint8Array([1, 2]) }] });
    expect(opts).toEqual([{ host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'user', pass: 'pw' } }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: 'erp@example.com', to: 'a@x.com, b@x.com', subject: '제목', text: '본문' });
    const att = (sent[0]!.attachments as { filename: string; content: Buffer }[])[0]!;
    expect(att.filename).toBe('세무자료.xlsx');
    expect([...att.content]).toEqual([1, 2]);
    expect(sent[0]).not.toHaveProperty('cc');
    expect(sent[0]).not.toHaveProperty('replyTo');
  });

  it('★ 보내는 이름 · 참조 · 답장 주소(11-08 ⑧) — 실제 보내는 주소는 SMTP_FROM 그대로', async () => {
    const sent: Record<string, unknown>[] = [];
    const m = createMailer(smtpConfigOf(FULL), () => ({ sendMail: async (msg) => void sent.push(msg) }));
    await m.send({
      to: ['a@x.com'], subject: '제목', text: '본문', attachments: [],
      fromName: '김사원', cc: 'ceo@x.com', replyTo: 'staff@x.com',
    });
    expect(sent[0]).toMatchObject({ from: { name: '김사원', address: 'erp@example.com' }, to: 'a@x.com', cc: 'ceo@x.com', replyTo: 'staff@x.com' });
  });

  it('587 · 인증 없음 — secure false · auth 없음', () => {
    const opts: unknown[] = [];
    createMailer(smtpConfigOf({ ...FULL, SMTP_USER: '', SMTP_PASSWORD: '' }), (o) => {
      opts.push(o);
      return { sendMail: async () => undefined };
    });
    expect(opts).toEqual([{ host: 'smtp.example.com', port: 587, secure: false }]);
  });
});
