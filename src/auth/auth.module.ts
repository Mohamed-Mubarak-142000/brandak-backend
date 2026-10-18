import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Env } from '@/config/env';
import { User, UserSchema } from '@/users/user.schema';
import { UsersModule } from '@/users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CONTACT_CHANNEL, MailContactChannel } from './contact-channel';
import { Otp, OtpSchema } from './otp.schema';
import { OtpService } from './otp.service';
import { Session, SessionSchema } from './session.schema';
import { SessionsService } from './sessions.service';

@Global()
@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
      { name: Otp.name, schema: OtpSchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) as any },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    OtpService,
    { provide: CONTACT_CHANNEL, useClass: MailContactChannel },
    // Order matters: throttle first, then authenticate, then check roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionsService, CONTACT_CHANNEL],
})
export class AuthModule {}
