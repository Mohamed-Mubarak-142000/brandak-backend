import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '@/common/errors';
import { paginate, PageQueryDto, PageResult } from '@/common/pagination';
import { Notification } from './notification.schema';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@InjectModel(Notification.name) private readonly notifications: Model<Notification>) {}

  /**
   * Best effort: a failed notification must never fail the business action that triggered it,
   * so call this after the transaction commits. Push delivery (Expo) will hook in here later.
   */
  async notify(userIds: string | string[], input: NotifyInput) {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    for (const userId of ids) {
      try {
        await this.notifications.create({ ...input, userId: new Types.ObjectId(userId) });
      } catch (e: any) {
        if (e?.code !== 11000) this.logger.warn(`Notification failed for ${userId}: ${e?.message}`);
      }
    }
  }

  async listMine(userId: string, query: PageQueryDto) {
    const filter = { userId: new Types.ObjectId(userId) };
    const [page, unread] = await Promise.all([
      paginate(this.notifications, filter, query),
      this.notifications.countDocuments({ ...filter, readAt: { $exists: false } }),
    ]);
    return new PageResult(page.items, page.page, page.limit, page.total, { unread });
  }

  async markRead(userId: string, id: string) {
    const res = await this.notifications.updateOne(
      { _id: id, userId: new Types.ObjectId(userId) },
      { $set: { readAt: new Date() } },
    );
    if (!res.matchedCount) throw AppError.notFound('Notification');
  }

  async markAllRead(userId: string) {
    await this.notifications.updateMany(
      { userId: new Types.ObjectId(userId), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
  }
}
