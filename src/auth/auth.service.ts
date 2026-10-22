import { HttpStatus, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { Connection, Model, Types } from 'mongoose';
import { BrandMembersService } from '@/brands/brand-members.service';
import { AccountStatus, OtpPurpose, Role } from '@/common/enums';
import { AppError } from '@/common/errors';
import { normalizeEgyptPhone, normalizeEmail } from '@/common/utils/text';
import { User, UserDocument } from '@/users/user.schema';
import { toPublicUser, UsersService } from '@/users/users.service';
import { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';

type ClientMeta = { userAgent?: string; ip?: string };

@Injectable()
export class AuthService {
  /** Verified against when the account does not exist, so login timing does not reveal accounts. */
  private readonly dummyHash = argon2.hash('brandak-dummy-password', { type: argon2.argon2id });

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
    private readonly members: BrandMembersService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async register(dto: RegisterDto, meta: ClientMeta) {
    const phone = normalizeEgyptPhone(dto.phone);
    if (!phone) {
      throw AppError.unprocessable('INVALID_PHONE', 'Enter a valid Egyptian mobile number', [
        { field: 'phone', reason: 'invalid_egypt_mobile' },
      ]);
    }
    const email = normalizeEmail(dto.email);
    const taken = await this.userModel.exists({ $or: [{ email }, { phone }] });
    if (taken) throw AppError.conflict('ACCOUNT_EXISTS', 'An account with this email or phone already exists');

    const user = await this.userModel.create({
      name: dto.name.trim(),
      email,
      phone,
      passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
      roles: [Role.CUSTOMER],
    });
    return this.issueTokens(user, meta);
  }

  async login(dto: LoginDto, meta: ClientMeta) {
    const user = await this.users.findByIdentifier(dto.identifier, true);
    const ok = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), dto.password).catch(() => false);
    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== AccountStatus.ACTIVE) {
      throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended', HttpStatus.FORBIDDEN);
    }
    return this.issueTokens(user, meta);
  }

  async refresh(refreshToken: string) {
    const rotated = await this.sessions.rotate(refreshToken);
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');
    const user = await this.users.getById(rotated.userId);
    if (user.status !== AccountStatus.ACTIVE || user.deletedAt) {
      await this.sessions.revoke(rotated.sessionId);
      throw new UnauthorizedException('Account is not active');
    }
    return {
      accessToken: await this.signAccess(user, rotated.sessionId),
      refreshToken: rotated.refreshToken,
    };
  }

  logout(sessionId: string) {
    return this.sessions.revoke(sessionId);
  }

  async requestVerification(userId: string, channel: 'email' | 'phone') {
    const user = await this.users.getById(userId);
    if (channel === 'email' ? user.emailVerifiedAt : user.phoneVerifiedAt) {
      throw AppError.conflict('ALREADY_VERIFIED', 'Already verified');
    }
    await this.otp.issue(userId, OtpPurpose.VERIFY_CONTACT, channel, channel === 'email' ? user.email : user.phone);
  }

  async verifyContact(userId: string, channel: 'email' | 'phone', code: string) {
    const otp = await this.otp.consume(userId, OtpPurpose.VERIFY_CONTACT, code);
    if (otp.channel !== channel) throw new AppError('OTP_INVALID', 'The code is invalid or expired');
    const user = await this.users.getById(userId);
    if (channel === 'email') user.emailVerifiedAt = new Date();
    else user.phoneVerifiedAt = new Date();
    await user.save();
    return toPublicUser(user);
  }

  /** Always succeeds from the caller's point of view, so it can't be used to discover accounts. */
  async forgotPassword(identifier: string) {
    const user = await this.users.findByIdentifier(identifier);
    if (!user || user.status !== AccountStatus.ACTIVE) return;
    const channel = identifier.includes('@') ? 'email' : 'phone';
    await this.otp
      .issue(user.id, OtpPurpose.RESET_PASSWORD, channel, channel === 'email' ? user.email : user.phone)
      // The response never says whether the account exists, but a failed send must be visible in the logs.
      .catch((e: Error & { code?: string }) => {
        if (e?.code !== 'OTP_COOLDOWN') new Logger('AuthService').error(`reset code not sent to user ${user.id}: ${e?.message}`);
      });
  }

  /**
   * The customer deletes their own account (Google Play requires this in the app). Personal data
   * is wiped and every session ends; orders stay with the stores under their own snapshot.
   * Store owners first close their store with support (it has orders and dues to settle).
   */
  async deleteAccount(userId: string, password: string) {
    const user = await this.userModel.findOne({ _id: userId, deletedAt: null }).select('+passwordHash');
    if (!user) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      throw AppError.unprocessable('WRONG_PASSWORD', 'Password is incorrect', [{ field: 'password', reason: 'incorrect' }]);
    }
    if (await this.members.findForUser(userId)) {
      throw AppError.conflict('STORE_OWNER', 'Close your store with Fatrina support before deleting the account');
    }
    const id = new Types.ObjectId(userId);
    // An order on its way still needs the customer's name, phone and address.
    const orders = this.connection.models['Order'];
    const active = ['AWAITING_CONFIRMATION', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'];
    if (orders && (await orders.exists({ userId: id, status: { $in: active }, deletedAt: null }))) {
      throw AppError.conflict('ACTIVE_ORDERS', 'Wait for your orders to arrive (or cancel them) before deleting the account');
    }
    // Stores keep their order history (accounting), without the customer's personal data.
    await orders?.updateMany({ userId: id }, { $set: { customer: { name: 'مستخدم محذوف', phone: '' }, addressSnapshot: null } });
    // Unique placeholders free the email and phone for a new account later.
    await this.userModel.updateOne(
      { _id: id },
      {
        $set: {
          name: 'مستخدم محذوف',
          email: `deleted-${userId}@deleted.fatrina`,
          phone: `deleted-${userId}`,
          passwordHash: await argon2.hash(`${userId}-${Date.now()}-${Math.random()}`, { type: argon2.argon2id }),
          deletedAt: new Date(),
          deletedBy: id,
        },
        $unset: { emailVerifiedAt: 1, phoneVerifiedAt: 1 },
      },
    );
    // Reviews and questions stay useful to other shoppers, without the name.
    for (const name of ['Review', 'Question']) {
      await this.connection.models[name]?.updateMany({ userId: id }, { $set: { userName: 'مستخدم محذوف' } });
    }
    // Personal lists go with the account (models that aren't loaded are skipped).
    for (const name of ['Address', 'Cart', 'WishlistItem', 'Watch', 'Follow']) {
      await this.connection.models[name]?.deleteMany({ userId: id });
    }
    await this.sessions.revokeAllForUser(userId);
  }

  /** Keeps the current session signed in and signs out every other device. */
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, dto.currentPassword).catch(() => false);
    if (!ok) {
      throw AppError.unprocessable('WRONG_PASSWORD', 'Current password is incorrect', [
        { field: 'currentPassword', reason: 'incorrect' },
      ]);
    }
    if (dto.currentPassword === dto.newPassword) {
      throw AppError.unprocessable('SAME_PASSWORD', 'Choose a password different from the current one', [
        { field: 'newPassword', reason: 'same_as_current' },
      ]);
    }
    user.passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await user.save();
    await this.sessions.revokeAllForUser(userId, sessionId);
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.users.findByIdentifier(dto.identifier);
    if (!user) throw new AppError('OTP_INVALID', 'The code is invalid or expired');
    await this.otp.consume(user.id, OtpPurpose.RESET_PASSWORD, dto.code);
    user.passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await user.save();
    await this.sessions.revokeAllForUser(user.id);
  }

  private async issueTokens(user: UserDocument, meta: ClientMeta) {
    const { sessionId, refreshToken } = await this.sessions.create(user.id, meta);
    return {
      user: toPublicUser(user),
      accessToken: await this.signAccess(user, sessionId),
      refreshToken,
    };
  }

  private signAccess(user: UserDocument, sessionId: string) {
    return this.jwt.signAsync({ sub: user.id, sid: sessionId, roles: user.roles });
  }
}
