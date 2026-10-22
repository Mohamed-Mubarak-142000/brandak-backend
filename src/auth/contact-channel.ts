import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { OtpPurpose } from '@/common/enums';
import { Env } from '@/config/env';

export const CONTACT_CHANNEL = Symbol('CONTACT_CHANNEL');

export interface CodeMessage {
  code: string;
  purpose: OtpPurpose;
}

/** Delivers verification codes by SMS or email. Swap the implementation for a real provider. */
export interface EmailNotice {
  to: string;
  subject: string;
  title: string;
  lines: string[];
}

export interface ContactChannel {
  send(channel: 'email' | 'phone', target: string, message: string, code?: CodeMessage): Promise<void>;
  /** A short notice email (reminders, reports). */
  sendNotice(notice: EmailNotice): Promise<void>;
}

/** Development channel: writes codes to the server log instead of sending them. */
@Injectable()
export class LogContactChannel implements ContactChannel {
  private readonly logger = new Logger('ContactChannel');
  readonly sent: { channel: string; target: string; message: string }[] = [];

  async send(channel: 'email' | 'phone', target: string, message: string) {
    this.sent.push({ channel, target, message });
    this.logger.log(`[${channel}] to ${target}: ${message}`);
  }

  async sendNotice(notice: EmailNotice) {
    this.sent.push({ channel: 'email', target: notice.to, message: `${notice.subject}\n${notice.lines.join('\n')}` });
    this.logger.log(`[email] to ${notice.to}: ${notice.subject}`);
  }
}

/**
 * Sends email codes over SMTP (Gmail app password, Zoho, Brevo, Mailgun... any SMTP server).
 * Phone codes, and email when SMTP isn't configured, fall back to the log channel.
 */
@Injectable()
export class MailContactChannel implements ContactChannel {
  private readonly logger = new Logger('MailContactChannel');
  private readonly log = new LogContactChannel();
  private readonly transport: Transporter | null;
  private readonly from: string;

  /** Whether email really goes out (false = codes only reach the log). */
  get configured() {
    return !!this.transport;
  }

  /** Codes that went to the log instead of a real inbox (development and tests read these). */
  get sent() {
    return this.log.sent;
  }

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    // Always sent as «فاترينة»: MAIL_FROM only supplies the address (old configs still say Dakakeen).
    const configured = config.get('MAIL_FROM', { infer: true });
    const address = configured?.match(/<([^>]+)>/)?.[1] ?? configured?.trim() ?? user;
    this.from = `فاترينة <${address}>`;
    this.transport =
      host && user && pass
        ? createTransport({ host, port, secure: port === 465, auth: { user, pass } })
        : null;
    if (!this.transport) this.logger.warn('SMTP is not configured; email codes are only written to the log');
  }

  async sendNotice(notice: EmailNotice) {
    if (!this.transport) return this.log.sendNotice(notice);
    await this.transport.sendMail({
      from: this.from,
      to: notice.to,
      subject: notice.subject,
      text: [notice.title, ...notice.lines].join('\n\n'),
      html: noticeHtml(notice.title, notice.lines),
    });
  }

  async send(channel: 'email' | 'phone', target: string, message: string, code?: CodeMessage) {
    if (channel !== 'email' || !this.transport || !code) return this.log.send(channel, target, message);
    const copy = {
      [OtpPurpose.RESET_PASSWORD]: { subject: 'كود تغيير كلمة السر في فاترينة', intro: 'طلبت تغيير كلمة السر. استخدم الكود ده:' },
      [OtpPurpose.CONFIRM_ORDER]: { subject: 'كود تأكيد طلبك من فاترينة', intro: 'عشان نبعت طلبك للمتجر، اكتب الكود ده في التطبيق:' },
      [OtpPurpose.VERIFY_CONTACT]: { subject: 'كود تأكيد بريدك في فاترينة', intro: 'أهلاً بيك في فاترينة! اكتب الكود ده في التطبيق عشان تأكّد بريدك:' },
    }[code.purpose];
    const subject = `${code.code} ${copy.subject}`;
    const intro = copy.intro;
    await this.transport.sendMail({
      from: this.from,
      to: target,
      subject,
      text: `${intro}\n\n${code.code}\n\nالكود صالح لمدة 10 دقايق. لو مش انت اللي طلبته، تجاهل الرسالة دي.`,
      html: emailHtml(intro, code.code),
    });
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function noticeHtml(title: string, lines: string[]) {
  return `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#FEFCF7;font-family:Tahoma,Arial,sans-serif;color:#2A1D14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FFFFFF;border:1px solid #F1E5D8;border-radius:16px">
<tr><td style="padding:28px 24px;text-align:right">
<div style="font-size:22px;font-weight:bold;color:#F16B21;margin-bottom:16px">فاترينة</div>
<p style="font-size:18px;font-weight:bold;margin:0 0 12px">${escapeHtml(title)}</p>
${lines.map((l) => `<p style="font-size:15px;line-height:1.7;margin:0 0 8px">${escapeHtml(l)}</p>`).join('')}
<p style="font-size:13px;color:#7A6656;margin:20px 0 0">افتح تطبيق فاترينة عشان تكمّل.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function emailHtml(intro: string, code: string) {
  return `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#FEFCF7;font-family:Tahoma,Arial,sans-serif;color:#2A1D14">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#FFFFFF;border:1px solid #F1E5D8;border-radius:16px">
<tr><td style="padding:28px 24px;text-align:right">
<div style="font-size:22px;font-weight:bold;color:#F16B21;margin-bottom:16px">فاترينة</div>
<p style="font-size:16px;line-height:1.7;margin:0 0 20px">${intro}</p>
<div dir="ltr" style="font-size:34px;letter-spacing:10px;font-weight:bold;text-align:center;background:#FFF6EE;border-radius:12px;padding:16px 8px;color:#C2500F">${code}</div>
<p style="font-size:13px;line-height:1.7;color:#7A6656;margin:20px 0 0">الكود صالح لمدة 10 دقايق. لو مش انت اللي طلبته، تجاهل الرسالة دي ومحدش هيقدر يدخل حسابك.</p>
</td></tr></table></td></tr></table></body></html>`;
}
