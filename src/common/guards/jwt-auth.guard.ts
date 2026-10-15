import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SessionsService } from '@/auth/sessions.service';
import { IS_PUBLIC } from '../decorators';
import { Role } from '../enums';

interface AccessPayload {
  sub: string;
  sid: string;
  roles: Role[];
}

/** Global guard: verifies the access token and that its session was not revoked. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest();
    const token = extractBearer(req.headers.authorization);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token);
      if (!(await this.sessions.isActive(payload.sid, payload.sub))) throw new Error('revoked');
      req.user = { userId: payload.sub, roles: payload.roles, sessionId: payload.sid };
      return true;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

function extractBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const [type, value] = header.split(' ');
  return type === 'Bearer' && value ? value : undefined;
}
