import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { BrandMembersService } from '@/brands/brand-members.service';
import { toPublicUser, UsersService } from './users.service';
import { UpdateMeDto } from './users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly members: BrandMembersService,
  ) {}

  /** Current user plus the brand they manage (if any), so the app can pick the right experience. */
  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const [doc, membership] = await Promise.all([
      this.users.getById(user.userId),
      this.members.findForUser(user.userId),
    ]);
    return {
      ...toPublicUser(doc),
      brand: membership ? { id: membership.brandId.toString(), role: membership.role } : null,
    };
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.userId, dto);
  }
}
