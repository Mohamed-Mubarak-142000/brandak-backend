import { Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { PageQueryDto } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('me')
  list(@CurrentUser() user: AuthUser, @Query() query: PageQueryDto) {
    return this.notifications.listMine(user.userId, query);
  }

  @Patch(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('me/read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.userId);
  }
}
