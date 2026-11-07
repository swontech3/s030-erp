/**
 * 메일 보내기 — nodemailer(SMTP) 하나로 보낸다(세무 1-9 세무사 전달 서류, 2026-11-07).
 *
 * ★ 설정은 환경 파일(erp-api.env)의 SMTP 칸 다섯 — SMTP_HOST · SMTP_PORT · SMTP_USER · SMTP_PASSWORD · SMTP_FROM.
 *   주소 · 포트 · 보내는 주소가 없으면 「설정 없음」(ready false) — 기동은 막지 않고 메일 보내기만 꺼진다(국세청 키와 같은 방식).
 *   계정 · 비밀번호는 둘 다 있거나 둘 다 없다(없으면 인증 없이 — 사내 중계).
 * ★ 포트 465 는 처음부터 SSL(secure), 그 밖(587 등)은 STARTTLS — nodemailer 기본.
 * ★ 시험은 실제로 보내지 않는다 — `makeTransport` 를 바꿔 끼운다.
 */
import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string;
}

export interface MailMessage {
  to: readonly string[];
  subject: string;
  text: string;
  attachments: readonly { filename: string; content: Uint8Array }[];
}

export interface Mailer {
  /** 설정이 있는가 — 없으면 화면이 [메일 보내기]를 막는다. */
  ready: boolean;
  send(m: MailMessage): Promise<void>;
}

export const MAIL_NOT_READY = '메일 발송 설정이 아직 없습니다 — 엑셀을 내려받아 보내 주세요';

const val = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : null);

/** 환경변수 → 설정. 모자라거나 틀리면 null(설정 없음). */
export function smtpConfigOf(vars: Readonly<Record<string, string | undefined>>): SmtpConfig | null {
  const host = val(vars.SMTP_HOST);
  const portRaw = val(vars.SMTP_PORT);
  const from = val(vars.SMTP_FROM);
  const user = val(vars.SMTP_USER);
  const password = val(vars.SMTP_PASSWORD);
  if (!host || !portRaw || !from) return null;
  if (!/^\d+$/.test(portRaw) || Number(portRaw) < 1 || Number(portRaw) > 65535) return null;
  if ((user === null) !== (password === null)) return null;
  return { host, port: Number(portRaw), user, password, from };
}

/** nodemailer 의 보내는 쪽 — 시험이 바꿔 끼운다. */
export interface MailTransport {
  sendMail(msg: Record<string, unknown>): Promise<unknown>;
}

const realTransport = (opts: Record<string, unknown>): MailTransport => nodemailer.createTransport(opts);

export function createMailer(config: SmtpConfig | null, makeTransport: (opts: Record<string, unknown>) => MailTransport = realTransport): Mailer {
  if (!config) {
    return {
      ready: false,
      send: async () => {
        throw new Error(MAIL_NOT_READY);
      },
    };
  }
  const transport = makeTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    ...(config.user !== null ? { auth: { user: config.user, pass: config.password } } : {}),
  });
  return {
    ready: true,
    send: async (m) => {
      await transport.sendMail({
        from: config.from,
        to: m.to.join(', '),
        subject: m.subject,
        text: m.text,
        attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })),
      });
    },
  };
}
