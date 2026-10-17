import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BrandMembersService } from '@/brands/brand-members.service';
import { AuthUser } from '../decorators';
import { AppError } from '../errors';

/**
 * Resolves the caller's brand from their membership and attaches it as `req.brand`.
 * Any brandId sent by the client is ignored for authorization purposes.
 */
@Injectable()
export class BrandMemberGuard implements CanActivate {
  constructor(private readonly members: BrandMembersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (!user) return false;
    const membership = await this.members.findForUser(user.userId);
    if (!membership) throw AppError.forbidden('NO_BRAND', 'You do not manage a brand yet');
    if (await this.members.isBrandDeleted(membership.brandId)) {
      throw AppError.forbidden('BRAND_DELETED', 'This store was removed by the Dakakeen team');
    }
    req.brand = { brandId: membership.brandId.toString(), memberRole: membership.role };
    return true;
  }
}
