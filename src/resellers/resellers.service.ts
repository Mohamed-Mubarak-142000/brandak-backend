import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { round2 } from '@/commissions/commission-math';
import { OrderStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { paginate, PageResult } from '@/common/pagination';
import { withTransaction } from '@/common/utils/transaction';
import { NotificationsService } from '@/notifications/notifications.service';
import { UsersService } from '@/users/users.service';
import { EarningStatus, Reseller, ResellerEarning, ResellerPayout } from './reseller.schemas';

/** Smallest payout a reseller can ask for. */
export const MIN_PAYOUT = 100;
/** A reseller may sell at up to twice the store's price. */
export const MAX_MARKUP = 1;

/**
 * Resellers sell stores' products to their own followers at their own price. The store ships and
 * collects the cash; the reseller's margin is added to what the store owes Fatrina, and Fatrina
 * pays the reseller (InstaPay) once the order is delivered.
 */
@Injectable()
export class ResellersService {
  constructor(
    @InjectModel(Reseller.name) private readonly resellers: Model<Reseller>,
    @InjectModel(ResellerEarning.name) private readonly earnings: Model<ResellerEarning>,
    @InjectModel(ResellerPayout.name) private readonly payouts: Model<ResellerPayout>,
    @InjectConnection() private readonly connection: Connection,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  async join(userId: string, dto: { payoutAddress: string; payoutName: string }) {
    const existing = await this.resellers.findOne({ userId: new Types.ObjectId(userId) }).lean();
    if (existing?.status === 'SUSPENDED') throw AppError.forbidden('RESELLER_SUSPENDED', 'Your reseller account is suspended');
    await this.resellers.updateOne(
      { userId: new Types.ObjectId(userId) },
      { $set: { payoutAddress: dto.payoutAddress.trim(), payoutName: dto.payoutName.trim() }, $setOnInsert: { status: 'ACTIVE' } },
      { upsert: true },
    );
    return this.me(userId);
  }

  async me(userId: string) {
    const r = await this.resellers.findOne({ userId: new Types.ObjectId(userId) }).lean();
    if (!r) return { joined: false as const };
    const rows = await this.earnings.aggregate<{ _id: EarningStatus; total: number; count: number }>([
      { $match: { resellerId: r.userId } },
      { $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const sum = (s: EarningStatus) => round2(rows.find((x) => x._id === s)?.total ?? 0);
    return {
      joined: true as const,
      status: r.status,
      payoutAddress: r.payoutAddress,
      payoutName: r.payoutName,
      wallet: {
        pending: sum(EarningStatus.PENDING),
        available: sum(EarningStatus.AVAILABLE),
        requested: sum(EarningStatus.REQUESTED),
        paid: sum(EarningStatus.PAID),
        orders: rows.reduce((n, x) => n + (x._id === EarningStatus.CANCELLED ? 0 : x.count), 0),
      },
      minPayout: MIN_PAYOUT,
      maxMarkup: MAX_MARKUP,
    };
  }

  /** Checkout calls this before placing an order on someone else's behalf. */
  async assertActive(userId: string) {
    const r = await this.resellers.findOne({ userId: new Types.ObjectId(userId) }).lean();
    if (!r) throw AppError.forbidden('NOT_A_RESELLER', 'Join as a reseller first');
    if (r.status !== 'ACTIVE') throw AppError.forbidden('RESELLER_SUSPENDED', 'Your reseller account is suspended');
    return r;
  }

  async recordEarning(order: { _id: Types.ObjectId; orderNumber: string; brandId: Types.ObjectId; userId: Types.ObjectId }, amount: number, session: ClientSession) {
    if (amount <= 0) return;
    await this.earnings.create([{ resellerId: order.userId, orderId: order._id, orderNumber: order.orderNumber, brandId: order.brandId, amount: round2(amount) }], { session });
  }

  /** Follows the order: delivered = the margin can be paid out; cancelled/refused = nothing earned. */
  async onOrderStatus(orderId: Types.ObjectId, to: OrderStatus, session: ClientSession) {
    if (to === OrderStatus.DELIVERED) {
      await this.earnings.updateOne({ orderId, status: EarningStatus.PENDING }, { $set: { status: EarningStatus.AVAILABLE } }, { session });
    } else if (to === OrderStatus.CANCELLED || to === OrderStatus.REFUSED) {
      await this.earnings.updateOne({ orderId, status: EarningStatus.PENDING }, { $set: { status: EarningStatus.CANCELLED } }, { session });
    }
  }

  /** Returned items: the margin on them is taken back (from a later payout if already paid). */
  async reverseForReturn(orderId: Types.ObjectId, marginBack: number, session: ClientSession) {
    if (marginBack <= 0) return;
    const e = await this.earnings.findOne({ orderId }).session(session);
    if (!e) return;
    if (e.status === EarningStatus.AVAILABLE || e.status === EarningStatus.PENDING) {
      e.amount = round2(Math.max(0, e.amount - marginBack));
      await e.save({ session });
    } else {
      // Already requested or paid: a negative earning settles it on the next payout.
      await this.earnings.create(
        [{ resellerId: e.resellerId, orderId: new Types.ObjectId(), orderNumber: `${e.orderNumber}-R`, brandId: e.brandId, amount: -round2(marginBack), status: EarningStatus.AVAILABLE }],
        { session },
      );
    }
  }

  async listEarnings(userId: string, query: { page: number; limit: number }) {
    return paginate(this.earnings, { resellerId: new Types.ObjectId(userId) }, query, { sort: { createdAt: -1 } });
  }

  async requestPayout(userId: string) {
    const r = await this.assertActive(userId);
    const payout = await withTransaction(this.connection, async (session) => {
      const available = await this.earnings.find({ resellerId: r.userId, status: EarningStatus.AVAILABLE }).session(session).lean();
      const amount = round2(available.reduce((s, e) => s + e.amount, 0));
      if (amount < MIN_PAYOUT) throw AppError.unprocessable('PAYOUT_TOO_SMALL', `You can ask for a payout from ${MIN_PAYOUT} EGP`);
      if (await this.payouts.exists({ resellerId: r.userId, status: 'REQUESTED' }).session(session)) {
        throw AppError.conflict('PAYOUT_PENDING', 'A payout is already being processed');
      }
      const [p] = await this.payouts.create([{ resellerId: r.userId, amount, payoutAddress: r.payoutAddress, payoutName: r.payoutName }], { session });
      await this.earnings.updateMany(
        { _id: { $in: available.map((e) => e._id) }, status: EarningStatus.AVAILABLE },
        { $set: { status: EarningStatus.REQUESTED, payoutId: p._id } },
        { session },
      );
      return p.toObject();
    });
    await this.notifications.notify(await this.users.adminIds(), {
      type: 'RESELLER_PAYOUT_REQUESTED',
      title: 'طلب صرف أرباح مسوّق',
      body: `${payout.amount} ج.م على ${payout.payoutAddress}`,
      data: { payoutId: payout._id.toString() },
    });
    return payout;
  }

  myPayouts(userId: string, query: { page: number; limit: number }) {
    return paginate(this.payouts, { resellerId: new Types.ObjectId(userId) }, query, { sort: { createdAt: -1 } });
  }

  async listPayouts(query: { page: number; limit: number; status?: string }) {
    const filter: FilterQuery<ResellerPayout> = query.status ? { status: query.status } : {};
    const page = await paginate(this.payouts, filter, query, { sort: { createdAt: -1 } });
    const users = new Map(
      await Promise.all(
        [...new Set(page.items.map((p) => p.resellerId.toString()))].map(async (id) => [id, await this.users.getById(id).catch(() => null)] as const),
      ),
    );
    return new PageResult(
      page.items.map((p) => {
        const u = users.get(p.resellerId.toString());
        return { ...p, id: p._id.toString(), reseller: u ? { name: u.name, phone: u.phone, email: u.email } : null };
      }),
      page.page,
      page.limit,
      page.total,
    );
  }

  async markPaid(adminId: string, id: string, reference: string) {
    const p = await withTransaction(this.connection, async (session) => {
      const p = await this.payouts.findOneAndUpdate({ _id: id, status: 'REQUESTED' }, { $set: { status: 'PAID', reference: reference.trim() } }, { new: true, session });
      if (!p) throw AppError.unprocessable('PAYOUT_NOT_PENDING', 'This payout is not waiting');
      await this.earnings.updateMany({ payoutId: p._id }, { $set: { status: EarningStatus.PAID } }, { session });
      return p;
    });
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'RESELLER_PAYOUT_PAID', entityType: 'ResellerPayout', entityId: p._id, data: { reference } });
    await this.notifications.notify(p.resellerId.toString(), {
      type: 'RESELLER_PAID',
      title: 'أرباحك اتحوّلت',
      body: `حوّلنالك ${p.amount} ج.م على ${p.payoutAddress}`,
      data: { payoutId: p.id },
    });
    return p.toObject();
  }

  async reject(adminId: string, id: string, reason: string) {
    const p = await withTransaction(this.connection, async (session) => {
      const p = await this.payouts.findOneAndUpdate({ _id: id, status: 'REQUESTED' }, { $set: { status: 'REJECTED', rejectReason: reason.trim() } }, { new: true, session });
      if (!p) throw AppError.unprocessable('PAYOUT_NOT_PENDING', 'This payout is not waiting');
      await this.earnings.updateMany({ payoutId: p._id }, { $set: { status: EarningStatus.AVAILABLE, payoutId: null } }, { session });
      return p;
    });
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'RESELLER_PAYOUT_REJECTED', entityType: 'ResellerPayout', entityId: p._id, data: { reason } });
    await this.notifications.notify(p.resellerId.toString(), {
      type: 'RESELLER_PAYOUT_REJECTED',
      title: 'طلب الصرف محتاج مراجعة',
      body: reason,
      data: { payoutId: p.id },
    });
    return p.toObject();
  }

  async setStatus(adminId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const r = await this.resellers.findOneAndUpdate({ userId: new Types.ObjectId(userId) }, { $set: { status } }, { new: true }).lean();
    if (!r) throw AppError.notFound('Reseller');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: `RESELLER_${status}`, entityType: 'Reseller', entityId: r._id });
    return r;
  }
}
