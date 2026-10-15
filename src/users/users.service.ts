import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { AccountStatus, Role } from '@/common/enums';
import { AppError } from '@/common/errors';
import { escapeRegex, normalizeEgyptPhone, normalizeEmail } from '@/common/utils/text';
import { paginate, PageQueryDto } from '@/common/pagination';
import { User, UserDocument } from './user.schema';
import { UpdateMeDto } from './users.dto';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  status: AccountStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** Accepts an email or an Egyptian mobile number. */
  findByIdentifier(identifier: string, withPassword = false) {
    const filter = identifier.includes('@')
      ? { email: normalizeEmail(identifier) }
      : { phone: normalizeEgyptPhone(identifier) ?? '__invalid__' };
    const q = this.users.findOne(filter);
    return withPassword ? q.select('+passwordHash') : q;
  }

  async getById(id: string): Promise<UserDocument> {
    const user = await this.users.findById(id);
    if (!user) throw AppError.notFound('User');
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.getById(userId);
    if (dto.name) user.name = dto.name;
    await user.save();
    return toPublicUser(user);
  }

  list(query: PageQueryDto & { q?: string; status?: AccountStatus }) {
    const filter: FilterQuery<User> = {};
    if (query.status) filter.status = query.status;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    return paginate(this.users, filter, query);
  }

  async adminIds(): Promise<string[]> {
    const admins = await this.users.find({ roles: Role.SUPER_ADMIN, status: AccountStatus.ACTIVE }).select('_id').lean();
    return admins.map((a) => a._id.toString());
  }

  async setStatus(userId: string, status: AccountStatus) {
    const user = await this.getById(userId);
    user.status = status;
    await user.save();
    return toPublicUser(user);
  }
}

export function toPublicUser(u: User & { _id: unknown }): PublicUser {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone,
    roles: u.roles,
    status: u.status,
    emailVerified: !!u.emailVerifiedAt,
    phoneVerified: !!u.phoneVerifiedAt,
    createdAt: u.createdAt,
  };
}
