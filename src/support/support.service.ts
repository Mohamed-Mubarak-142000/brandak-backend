import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomInt } from 'crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { BrandStatus, FilePurpose } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
import { NotificationsService } from '@/notifications/notifications.service';
import { Order } from '@/orders/order.schema';
import { UploadsService } from '@/uploads/uploads.service';
import { UsersService } from '@/users/users.service';
import { CreateTicketDto, ResolveTicketDto, TicketMessageDto, TicketsQueryDto } from './support.dto';
import { ACTIVE_TICKET_STATUSES, PROTECTION_TYPES, SupportTicket, TicketOutcome, TicketStatus } from './ticket.schema';

/** Hours a store has to answer a buyer-protection case before Fatrina decides. */
export const STORE_REPLY_HOURS = 48;
/** Protection cases lost before a store is suspended. */
export const MAX_STRIKES = 3;

/**
 * Customer support and Fatrina buyer protection. A customer opens a ticket (optionally about an
 * order). "Didn't arrive" and "not as described" are protection cases: the store gets 48 hours to
 * answer, after which the case escalates and an admin decides. A decision for the customer is a
 * strike on the store; three strikes suspend it.
 */
@Injectable()
export class SupportService {
  constructor(
    @InjectModel(SupportTicket.name) private readonly tickets: Model<SupportTicket>,
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly users: UsersService,
    private readonly uploads: UploadsService,
    private readonly members: BrandMembersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  async create(userId: string, dto: CreateTicketDto) {
    const protection = PROTECTION_TYPES.includes(dto.type);
    if (protection && !dto.orderId) throw AppError.unprocessable('ORDER_REQUIRED', 'Choose the order this is about');
    const order = dto.orderId
      ? await this.orders.findOne({ _id: dto.orderId, userId: new Types.ObjectId(userId), deletedAt: null }).select('orderNumber brandId brandSnapshot').lean()
      : null;
    if (dto.orderId && !order) throw AppError.notFound('Order');
    if (order) {
      const open = await this.tickets.exists({ orderId: order._id, type: dto.type, status: { $in: ACTIVE_TICKET_STATUSES } });
      if (open) throw AppError.conflict('TICKET_ALREADY_OPEN', 'You already have an open ticket about this order');
    }
    const user = await this.users.getById(userId);
    const images = await this.imageUrls(userId, dto.imageFileIds);
    const now = new Date();
    const t = await this.tickets.create({
      number: ticketNumber(),
      userId: user._id,
      userName: user.name,
      type: dto.type,
      subject: dto.subject.trim(),
      orderId: order?._id ?? null,
      orderNumber: order?.orderNumber ?? null,
      brandId: order?.brandId ?? null,
      brandName: order?.brandSnapshot.name ?? null,
      protection,
      storeDeadline: protection ? new Date(now.getTime() + STORE_REPLY_HOURS * 3_600_000) : null,
      status: protection ? TicketStatus.WAITING_STORE : TicketStatus.OPEN,
      messages: [{ author: 'CUSTOMER', authorId: user._id, text: dto.text.trim(), images, at: now }],
    });
    if (protection && order) {
      await this.notifications.notify(await this.members.memberUserIds(order.brandId), {
        type: 'PROTECTION_CASE',
        title: 'شكوى من عميل: رد خلال 48 ساعة',
        body: `طلب ${order.orderNumber}: ${t.subject}`,
        data: { ticketId: t.id },
      });
    } else {
      await this.notifications.notify(await this.users.adminIds(), {
        type: 'TICKET_NEW',
        title: 'تذكرة دعم جديدة',
        body: `${t.number}: ${t.subject}`,
        data: { ticketId: t.id },
      });
    }
    return this.toView(t.toObject());
  }

  listMine(userId: string, query: TicketsQueryDto) {
    return this.list({ userId: new Types.ObjectId(userId) }, query);
  }

  listForBrand(brandId: string, query: TicketsQueryDto) {
    return this.list({ brandId: new Types.ObjectId(brandId), protection: true }, query);
  }

  async listAll(query: TicketsQueryDto) {
    await this.escalateOverdue();
    return this.list({}, query, { escalatedAt: -1, updatedAt: -1 });
  }

  async getMine(userId: string, id: string) {
    return this.toView(await this.find({ _id: id, userId: new Types.ObjectId(userId) }));
  }

  async getForBrand(brandId: string, id: string) {
    return this.toView(await this.find({ _id: id, brandId: new Types.ObjectId(brandId), protection: true }));
  }

  async getForAdmin(id: string) {
    return this.toView(await this.find({ _id: id }));
  }

  async customerReply(userId: string, id: string, dto: TicketMessageDto) {
    const t = await this.find({ _id: id, userId: new Types.ObjectId(userId) });
    this.assertActive(t);
    // A protection case still waiting for the store keeps waiting; otherwise support takes it.
    const status = t.status === TicketStatus.WAITING_STORE || t.status === TicketStatus.ESCALATED ? t.status : TicketStatus.OPEN;
    const updated = await this.push(t, { author: 'CUSTOMER', authorId: userId, ...dto }, status);
    const notifyIds = t.status === TicketStatus.WAITING_STORE && t.brandId ? await this.members.memberUserIds(t.brandId) : await this.users.adminIds();
    await this.notifications.notify(notifyIds, {
      type: 'TICKET_REPLY',
      title: `رد جديد على التذكرة ${t.number}`,
      body: dto.text.slice(0, 120),
      data: { ticketId: id },
    });
    return updated;
  }

  async brandReply(brandId: string, userId: string, id: string, dto: TicketMessageDto) {
    const t = await this.find({ _id: id, brandId: new Types.ObjectId(brandId), protection: true });
    this.assertActive(t);
    // The store answered: the case moves on to support (unless already escalated).
    const status = t.status === TicketStatus.ESCALATED ? TicketStatus.ESCALATED : TicketStatus.OPEN;
    const updated = await this.push(t, { author: 'BRAND', authorId: userId, ...dto }, status);
    await this.notifications.notify(t.userId.toString(), {
      type: 'TICKET_REPLY',
      title: `المتجر رد على شكوتك ${t.number}`,
      body: dto.text.slice(0, 120),
      data: { ticketId: id },
    });
    return updated;
  }

  async adminReply(adminId: string, id: string, dto: TicketMessageDto) {
    const t = await this.find({ _id: id });
    this.assertActive(t);
    const updated = await this.push(t, { author: 'ADMIN', authorId: adminId, ...dto }, t.status);
    const ids = [t.userId.toString(), ...(t.protection && t.brandId ? await this.members.memberUserIds(t.brandId) : [])];
    await this.notifications.notify(ids, {
      type: 'TICKET_REPLY',
      title: `دعم فاترينة رد على التذكرة ${t.number}`,
      body: dto.text.slice(0, 120),
      data: { ticketId: id },
    });
    return updated;
  }

  async close(userId: string, id: string) {
    const t = await this.find({ _id: id, userId: new Types.ObjectId(userId) });
    this.assertActive(t);
    const updated = await this.tickets.findByIdAndUpdate(t._id, { $set: { status: TicketStatus.CLOSED } }, { new: true }).lean();
    return this.toView(updated!);
  }

  /** Admin decision. For the customer on a protection case = a strike; three suspend the store. */
  async resolve(adminId: string, id: string, dto: ResolveTicketDto) {
    const t = await this.find({ _id: id });
    this.assertActive(t);
    const updated = await this.tickets
      .findOneAndUpdate(
        { _id: t._id, status: { $in: ACTIVE_TICKET_STATUSES } },
        { $set: { status: TicketStatus.RESOLVED, resolution: { outcome: dto.outcome, note: dto.note.trim(), at: new Date(), by: new Types.ObjectId(adminId) } } },
        { new: true },
      )
      .lean();
    if (!updated) throw AppError.conflict('TICKET_CHANGED', 'This ticket was just updated');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: `TICKET_RESOLVED_${dto.outcome}`, entityType: 'SupportTicket', entityId: t._id });

    const memberIds = t.brandId ? await this.members.memberUserIds(t.brandId) : [];
    await this.notifications.notify(t.userId.toString(), {
      type: 'TICKET_RESOLVED',
      title: `تم حل التذكرة ${t.number}`,
      body: dto.note.slice(0, 160),
      data: { ticketId: id },
    });
    if (t.protection && t.brandId) {
      await this.notifications.notify(memberIds, {
        type: 'TICKET_RESOLVED',
        title: dto.outcome === TicketOutcome.CUSTOMER ? 'الشكوى اتحكمت لصالح العميل' : `تم حل الشكوى ${t.number}`,
        body: dto.note.slice(0, 160),
        data: { ticketId: id },
      });
    }
    if (t.protection && t.brandId && dto.outcome === TicketOutcome.CUSTOMER) {
      const brand = await this.brands.findByIdAndUpdate(t.brandId, { $inc: { protectionStrikes: 1 } }, { new: true }).select('protectionStrikes status').lean();
      if (brand && brand.protectionStrikes >= MAX_STRIKES && brand.status === BrandStatus.ACTIVE) {
        await this.brands.updateOne({ _id: t.brandId }, { $set: { status: BrandStatus.SUSPENDED } });
        await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'BRAND_SUSPENDED_STRIKES', entityType: 'Brand', entityId: t.brandId });
        await this.notifications.notify(memberIds, {
          type: 'BRAND_SUSPENDED',
          title: 'المتجر اتوقف مؤقتاً',
          body: `اتحكم ضد المتجر في ${MAX_STRIKES} شكاوى. تواصل مع دعم فاترينة.`,
          data: {},
        });
      }
    }
    return this.toView(updated);
  }

  /** Protection cases the store left unanswered for 48 hours go to Fatrina to decide. */
  async escalateOverdue(now = new Date()) {
    const due = await this.tickets.find({ status: TicketStatus.WAITING_STORE, storeDeadline: { $lte: now } }).select('_id number userId subject').lean();
    if (!due.length) return 0;
    await this.tickets.updateMany({ _id: { $in: due.map((t) => t._id) }, status: TicketStatus.WAITING_STORE }, { $set: { status: TicketStatus.ESCALATED, escalatedAt: now } });
    const admins = await this.users.adminIds();
    for (const t of due) {
      await this.notifications.notify(t.userId.toString(), {
        type: 'TICKET_ESCALATED',
        title: 'دعم فاترينة استلم شكوتك',
        body: 'المتجر مردش خلال 48 ساعة، وفريقنا هيحكم في الشكوى.',
        data: { ticketId: t._id.toString() },
        dedupeKey: `ticket-escalated:${t._id.toString()}`,
      });
      await this.notifications.notify(admins, {
        type: 'TICKET_ESCALATED',
        title: `شكوى محتاجة حكم: ${t.number}`,
        body: t.subject,
        data: { ticketId: t._id.toString() },
        dedupeKey: `ticket-escalated:${t._id.toString()}`,
      });
    }
    return due.length;
  }

  /** Summary for the admin dashboard header. */
  async counts() {
    await this.escalateOverdue();
    const rows = await this.tickets.aggregate<{ _id: TicketStatus; n: number }>([
      { $match: { status: { $in: ACTIVE_TICKET_STATUSES } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    return Object.fromEntries(ACTIVE_TICKET_STATUSES.map((s) => [s, rows.find((r) => r._id === s)?.n ?? 0]));
  }

  private async push(
    t: Lean<SupportTicket>,
    m: { author: 'CUSTOMER' | 'BRAND' | 'ADMIN'; authorId: string; text: string; imageFileIds?: string[] },
    status: TicketStatus,
  ) {
    const images = await this.imageUrls(m.authorId, m.imageFileIds);
    const updated = await this.tickets
      .findOneAndUpdate(
        { _id: t._id, status: { $in: ACTIVE_TICKET_STATUSES } },
        {
          $set: { status },
          $push: { messages: { author: m.author, authorId: new Types.ObjectId(m.authorId), text: m.text.trim(), images, at: new Date() } },
        },
        { new: true },
      )
      .lean();
    if (!updated) throw AppError.unprocessable('TICKET_CLOSED', 'This ticket is closed');
    return this.toView(updated);
  }

  private async imageUrls(ownerId: string, ids?: string[]) {
    if (!ids?.length) return [];
    return (await this.uploads.imageRefs(ownerId, ids, FilePurpose.CLAIM_IMAGE)).map((r) => r.url);
  }

  private assertActive(t: Lean<SupportTicket>) {
    if (!ACTIVE_TICKET_STATUSES.includes(t.status)) throw AppError.unprocessable('TICKET_CLOSED', 'This ticket is closed');
  }

  private async list(base: FilterQuery<SupportTicket>, query: TicketsQueryDto, sort: Record<string, 1 | -1> = { updatedAt: -1 }) {
    const filter: FilterQuery<SupportTicket> = { ...base };
    if (query.status) filter.status = query.status;
    else if (query.active) filter.status = { $in: ACTIVE_TICKET_STATUSES };
    const page = await paginate(this.tickets, filter, query, { sort, select: '-messages' });
    return new PageResult(page.items.map((t) => this.toView(t, false)), page.page, page.limit, page.total);
  }

  private async find(filter: FilterQuery<SupportTicket>) {
    const t = await this.tickets.findOne(filter).lean();
    if (!t) throw AppError.notFound('Ticket');
    return t;
  }

  private toView(t: Lean<SupportTicket>, withMessages = true) {
    return {
      id: t._id.toString(),
      number: t.number,
      userName: t.userName,
      type: t.type,
      subject: t.subject,
      orderId: t.orderId?.toString() ?? null,
      orderNumber: t.orderNumber,
      brandId: t.brandId?.toString() ?? null,
      brandName: t.brandName,
      protection: t.protection,
      storeDeadline: t.storeDeadline,
      status: t.status,
      escalatedAt: t.escalatedAt,
      resolution: t.resolution && { outcome: t.resolution.outcome, note: t.resolution.note, at: t.resolution.at },
      messages: withMessages
        ? (t.messages ?? []).map((m) => ({ id: (m as { _id?: Types.ObjectId })._id?.toString(), author: m.author, text: m.text, images: m.images, at: m.at }))
        : undefined,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}

function ticketNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `T-${ymd}-${randomInt(100000, 999999)}`;
}
