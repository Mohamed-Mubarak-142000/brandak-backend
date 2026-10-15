import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, ROLES } from '../decorators';
import { Role } from '../enums';
import { AppError } from '../errors';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user || !required.some((r) => user.roles.includes(r))) throw AppError.forbidden();
    return true;
  }
}
