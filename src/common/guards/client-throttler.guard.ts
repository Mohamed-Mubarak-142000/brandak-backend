import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from '../client-ip';

/** Same as ThrottlerGuard, but counts web visitors by their real IP (see clientIp). */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    return super.getTracker({ ip: clientIp(req) });
  }
}
