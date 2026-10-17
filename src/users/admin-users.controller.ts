import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '@/common/decorators';
import { AccountStatus, Role } from '@/common/enums';
import { AppError } from '@/common/errors';
import { PageResult } from '@/common/pagination';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { SessionsService } from '@/auth/sessions.service';
import { AdminUsersQueryDto, SetUserStatusDto } from './users.dto';
import { toPublicUser, UsersService } from './users.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditLogsService,
  ) {}

  @Get()
  async list(@Query() query: AdminUsersQueryDto) {
    const page = await this.users.list(query);
    return new PageResult(page.items.map(toPublicUser), page.page, page.limit, page.total);
  }

  @Patch(':id/status')
  async setStatus(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: SetUserStatusDto) {
    if (id === admin.userId) throw AppError.forbidden('SELF_ACTION', 'You cannot change your own status');
    const user = await this.users.setStatus(id, dto.status);
    // Suspension takes effect immediately: every open session is revoked.
    if (dto.status === AccountStatus.SUSPENDED) await this.sessions.revokeAllForUser(id);
    await this.audit.log({ actorId: admin.userId, actorType: 'ADMIN', action: `USER_${dto.status}`, entityType: 'User', entityId: id });
    return user;
  }

  /** Soft delete: the account can't sign in and every session ends now. Reversible with /restore. */
  @HttpCode(200)
  @Post(':id/delete')
  async softDelete(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    if (id === admin.userId) throw AppError.forbidden('SELF_ACTION', 'You cannot delete your own account');
    const target = await this.users.getById(id);
    if (target.roles.includes(Role.SUPER_ADMIN)) throw AppError.forbidden('ADMIN_PROTECTED', 'Admin accounts cannot be deleted here');
    const user = await this.users.setDeleted(id, admin.userId, true);
    await this.sessions.revokeAllForUser(id);
    await this.audit.log({ actorId: admin.userId, actorType: 'ADMIN', action: 'USER_DELETED', entityType: 'User', entityId: id });
    return user;
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(@CurrentUser() admin: AuthUser, @Param('id', ParseObjectIdPipe) id: string) {
    const user = await this.users.setDeleted(id, admin.userId, false);
    await this.audit.log({ actorId: admin.userId, actorType: 'ADMIN', action: 'USER_RESTORED', entityType: 'User', entityId: id });
    return user;
  }
}
