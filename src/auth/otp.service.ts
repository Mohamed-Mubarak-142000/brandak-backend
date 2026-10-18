import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomInt } from 'crypto';
import { Model, Types } from 'mongoose';
import { OtpPurpose } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Env } from '@/config/env';
import { CONTACT_CHANNEL, ContactChannel } from './contact-channel';
import { Otp } from './otp.schema';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(
    @InjectModel(Otp.name) private readonly otps: Model<Otp>,
    @Inject(CONTACT_CHANNEL) private readonly channel: ContactChannel,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(userId: string, purpose: OtpPurpose, channel: 'email' | 'phone', target: string) {
    const last = await this.otps
      .findOne({ userId: new Types.ObjectId(userId), purpose })
      .sort({ createdAt: -1 });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new AppError('OTP_COOLDOWN', 'Please wait before requesting a new code', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.otps.create({
      userId: new Types.ObjectId(userId),
      purpose,
      channel,
      codeHash: this.hash(userId, purpose, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    await this.channel.send(channel, target, `Brandak code: ${code}`, { code, purpose });
  }

  /** Consumes the latest valid code. Throws on a wrong, expired or exhausted code. */
  async consume(userId: string, purpose: OtpPurpose, code: string): Promise<Otp> {
    const otp = await this.otps
      .findOne({
        userId: new Types.ObjectId(userId),
        purpose,
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 });
    const invalid = new AppError('OTP_INVALID', 'The code is invalid or expired');
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw invalid;

    if (otp.codeHash !== this.hash(userId, purpose, code)) {
      otp.attempts += 1;
      await otp.save();
      throw invalid;
    }
    otp.consumedAt = new Date();
    await otp.save();
    return otp;
  }

  private hash(userId: string, purpose: OtpPurpose, code: string) {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET', { infer: true }))
      .update(`${userId}:${purpose}:${code}`)
      .digest('hex');
  }
}
