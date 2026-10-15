import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { Public } from './common/decorators';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Public()
  @Get()
  info() {
    return { name: 'Brandak API', version: 'v1', status: 'ok', health: '/api/v1/health' };
  }

  /** For uptime monitors: 200 when the database answers, 503 otherwise. */
  @Public()
  @Get('health')
  async health() {
    try {
      await this.connection.db!.admin().ping();
      return { status: 'ok', database: 'up', time: new Date().toISOString() };
    } catch {
      throw new HttpException({ message: 'Database unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
