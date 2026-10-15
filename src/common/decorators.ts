import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from './enums';

export interface AuthUser {
  userId: string;
  roles: Role[];
  sessionId: string;
}

export interface BrandContext {
  brandId: string;
  memberRole: string;
}

export const IS_PUBLIC = 'isPublic';
/** Route is reachable without a token. If a valid token is sent, `req.user` is still populated. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

export const OptionalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined => ctx.switchToHttp().getRequest().user,
);

/** Brand resolved by BrandMemberGuard from the caller's membership — never from the request body. */
export const CurrentBrand = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): BrandContext => ctx.switchToHttp().getRequest().brand,
);

export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest().headers['idempotency-key'],
);
