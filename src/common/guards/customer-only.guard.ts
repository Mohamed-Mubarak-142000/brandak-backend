import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BrandMembersService } from '@/brands/brand-members.service';
import { AuthUser } from '../decorators';
import { AppError } from '../errors';

/**
 * Shopping is for customer accounts. A store account manages its store only: no cart, no
 * wishlist, no orders (one app, two clearly separate experiences).
 */
@Injectable()
export class CustomerOnlyGuard implements CanActivate {
  constructor(private readonly members: BrandMembersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) return false;
    if (await this.members.findForUser(user.userId)) {
      throw AppError.forbidden('SELLER_ACCOUNT', 'Store accounts cannot shop. Use a customer account.');
    }
    return true;
  }
}
