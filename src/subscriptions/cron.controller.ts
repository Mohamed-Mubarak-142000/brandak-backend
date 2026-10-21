import { Controller, Get, Headers, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '@/common/decorators';
import { Env } from '@/config/env';
import { CartsService } from '@/carts/carts.service';
import { OrdersService } from '@/orders/orders.service';
import { SupportService } from '@/support/support.service';
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
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Daily housekeeping (the path name predates the commission model). */
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
    // Orders nobody confirmed within 24 hours are cancelled and their stock released.
    await this.moduleRef.get(OrdersService, { strict: false }).expireUnconfirmed();
    // Customers who left a cart 1–3 days ago get one reminder per cart change.
    await this.moduleRef.get(CartsService, { strict: false }).remindAbandoned();
    // Buyer-protection cases the store left unanswered for 48 hours go to Fatrina.
    await this.moduleRef.get(SupportService, { strict: false }).escalateOverdue();
  }
}
