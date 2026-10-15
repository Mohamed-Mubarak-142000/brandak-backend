import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { paginate, PageQueryDto } from '@/common/pagination';
import { AuditLog } from './audit-log.schema';

export interface AuditEntry {
  actorId?: string;
  actorType: AuditLog['actorType'];
  action: string;
  entityType: string;
  entityId: string | Types.ObjectId;
  data?: Record<string, unknown>;
}

@Injectable()
export class AuditLogsService {
  constructor(@InjectModel(AuditLog.name) private readonly logs: Model<AuditLog>) {}

  /** Pass the transaction session so the log is committed (or rolled back) with the change itself. */
  async log(entry: AuditEntry, session?: ClientSession) {
    await this.logs.create(
      [
        {
          ...entry,
          actorId: entry.actorId ? new Types.ObjectId(entry.actorId) : undefined,
          entityId: new Types.ObjectId(String(entry.entityId)),
        },
      ],
      { session },
    );
  }

  list(query: PageQueryDto & { entityType?: string; entityId?: string; action?: string }) {
    const filter: FilterQuery<AuditLog> = {};
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
    if (query.action) filter.action = query.action;
    return paginate(this.logs, filter, query);
  }
}
