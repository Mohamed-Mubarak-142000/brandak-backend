import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '@/common/decorators';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  RequestVerificationDto,
  ResetPasswordDto,
  VerifyContactDto,
} from './auth.dto';
import { AuthService } from './auth.service';

const STRICT = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, clientMeta(req));
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, clientMeta(req));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @HttpCode(204)
  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.sessionId);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('verify-contact/request')
  requestVerification(@CurrentUser() user: AuthUser, @Body() dto: RequestVerificationDto) {
    return this.auth.requestVerification(user.userId, dto.channel);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('verify-contact')
  verifyContact(@CurrentUser() user: AuthUser, @Body() dto: VerifyContactDto) {
    return this.auth.verifyContact(user.userId, dto.channel, dto.code);
  }

  @ApiBearerAuth()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.userId, user.sessionId, dto);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.identifier);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }
}

function clientMeta(req: Request) {
  return { userAgent: req.headers['user-agent']?.slice(0, 300), ip: req.ip };
}
