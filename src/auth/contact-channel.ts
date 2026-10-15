import { Injectable, Logger } from '@nestjs/common';

export const CONTACT_CHANNEL = Symbol('CONTACT_CHANNEL');

/** Delivers verification codes by SMS or email. Swap the implementation for a real provider. */
export interface ContactChannel {
  send(channel: 'email' | 'phone', target: string, message: string): Promise<void>;
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
