import { Controller, Get, Headers, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '@/common/decorators';
import { Env } from '@/config/env';
import { SubscriptionJobs } from './subscription-jobs';

/**
 * Triggered by Vercel Cron (serverless has no long-running scheduler). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; anything else is rejected.
 */
@ApiExcludeController()
@Controller('internal/cron')
export class CronController {
  constructor(
    private readonly jobs: SubscriptionJobs,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @HttpCode(204)
  @Get('subscriptions')
  async subscriptions(@Headers('authorization') authorization?: string) {
    const secret = this.config.get('CRON_SECRET', { infer: true });
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const given = Buffer.from(authorization ?? '');
    if (!secret || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new UnauthorizedException();
    }
    await this.jobs.run();
  }
}
