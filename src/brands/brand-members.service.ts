import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BrandMemberRole } from '@/common/enums';
import { BrandMember } from './brand-member.schema';

@Injectable()
export class BrandMembersService {
  constructor(@InjectModel(BrandMember.name) private readonly members: Model<BrandMember>) {}

  findForUser(userId: string) {
    return this.members.findOne({ userId: new Types.ObjectId(userId) }).lean();
  }

  async addOwner(brandId: Types.ObjectId, userId: string, session?: ClientSession) {
    await this.members.create(
      [{ brandId, userId: new Types.ObjectId(userId), role: BrandMemberRole.OWNER }],
      { session },
    );
  }

  /** User ids that should receive brand notifications. */
  async memberUserIds(brandId: Types.ObjectId | string): Promise<string[]> {
    const rows = await this.members
      .find({ brandId: new Types.ObjectId(String(brandId)) })
      .select('userId')
      .lean();
    return rows.map((r) => r.userId.toString());
  }
}
