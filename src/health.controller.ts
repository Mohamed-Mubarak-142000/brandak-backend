import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { CONTACT_CHANNEL, type ContactChannel } from './auth/contact-channel';
import { Public } from './common/decorators';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Inject(CONTACT_CHANNEL) private readonly mail: ContactChannel & { configured?: boolean },
  ) {}

  @Public()
  @Get()
  info() {
    return { name: 'Fatrina API', version: 'v1', status: 'ok', health: '/api/v1/health' };
  }

  /** For uptime monitors: 200 when the database answers, 503 otherwise. */
  @Public()
  @Get('health')
  async health() {
    try {
      await this.connection.db!.admin().ping();
      // "smtp" = codes are emailed; "log-only" = SMTP_* env vars are missing on this deployment.
      return { status: 'ok', database: 'up', email: this.mail.configured ? 'smtp' : 'log-only', time: new Date().toISOString() };
    } catch {
      throw new HttpException({ message: 'Database unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
