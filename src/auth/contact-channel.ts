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
export interface ContactChannel {
  send(channel: 'email' | 'phone', target: string, message: string, code?: CodeMessage): Promise<void>;
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

  /** Codes that went to the log instead of a real inbox (development and tests read these). */
  get sent() {
    return this.log.sent;
  }

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true }) ?? `فاترينة <${user}>`;
    this.transport =
      host && user && pass
        ? createTransport({ host, port, secure: port === 465, auth: { user, pass } })
        : null;
    if (!this.transport) this.logger.warn('SMTP is not configured; email codes are only written to the log');
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
