import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { FilePurpose } from '@/common/enums';
import { AppError } from '@/common/errors';
import { paginate, PageResult } from '@/common/pagination';
import { cairoMonthStart } from '@/common/utils/month';
import { normalizeReference } from '@/common/utils/text';
import { withTransaction } from '@/common/utils/transaction';
import { NotificationsService } from '@/notifications/notifications.service';
import { UploadsService } from '@/uploads/uploads.service';
import { UsersService } from '@/users/users.service';
import { commissionFor, isBlocked, round2 } from './commission-math';
import { LedgerEntry, LedgerType, PlatformSettings, Settlement, SettlementStatus } from './commission.schemas';

export interface CommissionTerms {
  commissionRate: number;
  settlementDays: number;
  maxUnpaidBalance: number;
}

const DEFAULT_TERMS: CommissionTerms = { commissionRate: 0.05, settlementDays: 14, maxUnpaidBalance: 2000 };

/**
 * The platform earns a commission on every delivered order instead of plan subscriptions.
 * Cash orders leave the commission owed by the store; it settles by InstaPay transfer, and a
 * store that owes too much (or for too long) stops receiving new orders until it pays.
 */
@Injectable()
export class CommissionsService {
  private cached: { terms: CommissionTerms; at: number } | null = null;

  constructor(
    @InjectModel(PlatformSettings.name) private readonly settingsModel: Model<PlatformSettings>,
    @InjectModel(LedgerEntry.name) private readonly ledger: Model<LedgerEntry>,
    @InjectModel(Settlement.name) private readonly settlements: Model<Settlement>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @InjectConnection() private readonly connection: Connection,
    private readonly uploads: UploadsService,
    private readonly members: BrandMembersService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  // ---------- Terms ----------

  async terms(): Promise<CommissionTerms> {
    if (this.cached && Date.now() - this.cached.at < 60_000) return this.cached.terms;
    const doc = await this.settingsModel.findOne({ key: 'default' }).lean();
    const terms = doc
      ? { commissionRate: doc.commissionRate, settlementDays: doc.settlementDays, maxUnpaidBalance: doc.maxUnpaidBalance }
      : DEFAULT_TERMS;
    this.cached = { terms, at: Date.now() };
    return terms;
  }

  async updateTerms(adminId: string, patch: Partial<CommissionTerms>) {
    const doc = await this.settingsModel.findOneAndUpdate(
      { key: 'default' },
      { $set: patch, $setOnInsert: { key: 'default' } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    this.cached = null;
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'COMMISSION_TERMS_UPDATED', entityType: 'PlatformSettings', entityId: doc._id, data: patch });
    return this.terms();
  }

  // ---------- Orders ----------

  /**
   * Records the commission when an order is delivered (inside the delivery transaction).
   * Returns what was charged so it can be stored on the order.
   */
  async recordForOrder(
    order: { _id: Types.ObjectId; brandId: Types.ObjectId; orderNumber: string; subtotal: number; discountTotal?: number },
    session: ClientSession,
  ) {
    const { commissionRate } = await this.terms();
    const c = commissionFor(order, commissionRate);
    if (c.amount <= 0) return c;
    await this.ledger.create(
      [{ brandId: order.brandId, type: LedgerType.COMMISSION, amount: c.amount, rate: c.rate, base: c.base, orderId: order._id, orderNumber: order.orderNumber }],
      { session },
    );
    // Start the settlement clock only when the store goes from owing nothing to owing something.
    await this.brands.updateOne({ _id: order.brandId, commissionDueSince: null }, { $set: { commissionDueSince: new Date() } }, { session });
    return c;
  }

  async balance(brandId: string | Types.ObjectId) {
    const [row] = await this.ledger.aggregate<{ total: number }>([
      { $match: { brandId: new Types.ObjectId(String(brandId)) } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return round2(row?.total ?? 0);
  }

  /** What a store owes, by when, and whether it is blocked from new orders. */
  async statusFor(brandId: string | Types.ObjectId) {
    const [terms, balance, brand, pending] = await Promise.all([
      this.terms(),
      this.balance(brandId),
      this.brands.findById(brandId).select('commissionDueSince').lean(),
      this.settlements.findOne({ brandId: new Types.ObjectId(String(brandId)), status: SettlementStatus.PENDING_REVIEW }).lean(),
    ]);
    const dueSince = balance > 0 ? (brand?.commissionDueSince ?? null) : null;
    return {
      balance,
      dueSince,
      dueBy: dueSince ? new Date(dueSince.getTime() + terms.settlementDays * 86_400_000) : null,
      blocked: isBlocked(balance, dueSince, terms),
      pendingSettlement: pending ? { id: pending._id.toString(), amount: pending.amount, createdAt: pending.createdAt } : null,
      ...terms,
    };
  }

  /** Called by checkout before accepting an order. */
  async assertCanReceiveOrders(brandId: string | Types.ObjectId) {
    const s = await this.statusFor(brandId);
    if (s.blocked) throw AppError.unprocessable('STORE_PAYMENT_OVERDUE', 'This store is not receiving orders right now');
  }

  ledgerFor(brandId: string, query: { page: number; limit: number }) {
    return paginate(this.ledger, { brandId: new Types.ObjectId(brandId) }, query, { sort: { createdAt: -1 } });
  }

  // ---------- Settlements (store pays) ----------

  async submitSettlement(userId: string, brandId: string, dto: { amount: number; proofFileId: string; transactionReference: string }) {
    const { balance } = await this.statusFor(brandId);
    if (balance <= 0) throw AppError.unprocessable('NOTHING_DUE', 'There is nothing to pay');
    if (dto.amount > balance) throw AppError.unprocessable('AMOUNT_TOO_HIGH', 'The amount is more than what is owed');
    if (await this.settlements.exists({ brandId: new Types.ObjectId(brandId), status: SettlementStatus.PENDING_REVIEW })) {
      throw AppError.conflict('PAYMENT_UNDER_REVIEW', 'A payment is already under review');
    }
    await this.uploads.requireOwned(userId, [dto.proofFileId], FilePurpose.PAYMENT_PROOF);
    const reference = normalizeReference(dto.transactionReference);
    if (await this.settlements.exists({ transactionReferenceNormalized: reference, status: { $ne: SettlementStatus.REJECTED } })) {
      throw AppError.conflict('REFERENCE_ALREADY_USED', 'This transfer reference was already submitted');
    }
    const s = await this.settlements.create({
      brandId: new Types.ObjectId(brandId),
      amount: dto.amount,
      proofFileId: new Types.ObjectId(dto.proofFileId),
      transactionReference: dto.transactionReference.trim(),
      transactionReferenceNormalized: reference,
      submittedBy: new Types.ObjectId(userId),
    });
    await this.notifications.notify(await this.users.adminIds(), {
      type: 'SETTLEMENT_SUBMITTED',
      title: 'سداد عمولة جديد',
      body: `متجر أرسل إيصال سداد بـ ${dto.amount} ج.م للمراجعة`,
      data: { settlementId: s.id },
    });
    return s.toObject();
  }

  settlementsFor(brandId: string, query: { page: number; limit: number }) {
    return paginate(this.settlements, { brandId: new Types.ObjectId(brandId) }, query, { sort: { createdAt: -1 } });
  }

  // ---------- Admin ----------

  async listSettlements(query: { page: number; limit: number; status?: SettlementStatus }) {
    const filter: FilterQuery<Settlement> = query.status ? { status: query.status } : {};
    const page = await paginate(this.settlements, filter, query, { sort: { createdAt: -1 } });
    const names = await this.brandNames(page.items.map((s) => s.brandId));
    return new PageResult(
      page.items.map((s) => ({ ...s, id: s._id.toString(), brandName: names.get(s.brandId.toString()) ?? '' })),
      page.page,
      page.limit,
      page.total,
    );
  }

  async proofUrl(adminId: string, id: string) {
    const s = await this.settlements.findById(id).lean();
    if (!s) throw AppError.notFound('Settlement');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'SETTLEMENT_PROOF_VIEWED', entityType: 'Settlement', entityId: s._id });
    return { url: await this.uploads.signedUrl(s.proofFileId, 300), expiresInSeconds: 300 };
  }

  async approveSettlement(adminId: string, id: string) {
    const s = await withTransaction(this.connection, async (session) => {
      const s = await this.settlements.findOneAndUpdate(
        { _id: id, status: SettlementStatus.PENDING_REVIEW },
        { $set: { status: SettlementStatus.APPROVED, reviewedBy: new Types.ObjectId(adminId), reviewedAt: new Date() } },
        { new: true, session },
      );
      if (!s) throw AppError.conflict('INVALID_STATE', 'This payment is not awaiting review');
      await this.ledger.create([{ brandId: s.brandId, type: LedgerType.PAYMENT, amount: -s.amount, settlementId: s._id, note: s.transactionReference }], { session });
      await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'SETTLEMENT_APPROVED', entityType: 'Settlement', entityId: s._id, data: { amount: s.amount } }, session);
      return s;
    });
    await this.refreshDueSince(s.brandId);
    await this.notifications.notify(await this.members.memberUserIds(s.brandId), {
      type: 'SETTLEMENT_APPROVED',
      title: 'اتأكد السداد',
      body: `استلمنا ${s.amount} ج.م. شكراً!`,
      data: { settlementId: s.id },
    });
    return s.toObject();
  }

  async rejectSettlement(adminId: string, id: string, reason: string) {
    const s = await this.settlements.findOneAndUpdate(
      { _id: id, status: SettlementStatus.PENDING_REVIEW },
      { $set: { status: SettlementStatus.REJECTED, reviewedBy: new Types.ObjectId(adminId), reviewedAt: new Date(), rejectionReason: reason } },
      { new: true },
    );
    if (!s) throw AppError.conflict('INVALID_STATE', 'This payment is not awaiting review');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'SETTLEMENT_REJECTED', entityType: 'Settlement', entityId: s._id, data: { reason } });
    await this.notifications.notify(await this.members.memberUserIds(s.brandId), {
      type: 'SETTLEMENT_REJECTED',
      title: 'إيصال السداد اترفض',
      body: reason,
      data: { settlementId: s.id },
    });
    return s.toObject();
  }

  /** Manual correction by an admin (positive = store owes more, negative = credit). */
  async adjust(adminId: string, brandId: string, amount: number, note: string) {
    await this.ledger.create({ brandId: new Types.ObjectId(brandId), type: LedgerType.ADJUSTMENT, amount: round2(amount), note });
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'COMMISSION_ADJUSTED', entityType: 'Brand', entityId: new Types.ObjectId(brandId), data: { amount, note } });
    await this.refreshDueSince(new Types.ObjectId(brandId));
    return this.statusFor(brandId);
  }

  /** Platform totals for the admin overview. */
  async summary() {
    const monthStart = cairoMonthStart();
    const [month, balances, pending] = await Promise.all([
      this.ledger.aggregate<{ total: number; orders: number }>([
        { $match: { type: LedgerType.COMMISSION, createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' }, orders: { $sum: 1 } } },
      ]),
      this.brandBalances(),
      this.settlements.countDocuments({ status: SettlementStatus.PENDING_REVIEW }),
    ]);
    const owing = balances.filter((b) => b.balance > 0);
    return {
      commissionThisMonth: round2(month[0]?.total ?? 0),
      ordersThisMonth: month[0]?.orders ?? 0,
      outstanding: round2(owing.reduce((s, b) => s + b.balance, 0)),
      storesOwing: owing.length,
      storesBlocked: owing.filter((b) => b.blocked).length,
      pendingSettlements: pending,
    };
  }

  /** Every store with a ledger, with what it owes; owing and blocked stores first. */
  async brandBalances() {
    const [terms, rows] = await Promise.all([
      this.terms(),
      this.ledger.aggregate<{ _id: Types.ObjectId; balance: number; commission: number }>([
        {
          $group: {
            _id: '$brandId',
            balance: { $sum: '$amount' },
            commission: { $sum: { $cond: [{ $eq: ['$type', LedgerType.COMMISSION] }, '$amount', 0] } },
          },
        },
      ]),
    ]);
    const brands = await this.brands.find({ _id: { $in: rows.map((r) => r._id) } }).select('name slug commissionDueSince').lean();
    const byId = new Map(brands.map((b) => [b._id.toString(), b]));
    return rows
      .map((r) => {
        const b = byId.get(r._id.toString());
        const balance = round2(r.balance);
        const dueSince = balance > 0 ? (b?.commissionDueSince ?? null) : null;
        return {
          brandId: r._id.toString(),
          name: b?.name ?? '',
          slug: b?.slug ?? '',
          balance,
          totalCommission: round2(r.commission),
          dueSince,
          blocked: isBlocked(balance, dueSince, terms),
        };
      })
      .sort((a, z) => Number(z.blocked) - Number(a.blocked) || z.balance - a.balance);
  }

  // ---------- Helpers ----------

  /** Clears the settlement clock once the store owes nothing. */
  private async refreshDueSince(brandId: Types.ObjectId) {
    if ((await this.balance(brandId)) <= 0) await this.brands.updateOne({ _id: brandId }, { $set: { commissionDueSince: null } });
  }

  private async brandNames(ids: Types.ObjectId[]) {
    const rows = await this.brands.find({ _id: { $in: ids } }).select('name').lean();
    return new Map(rows.map((b) => [b._id.toString(), b.name]));
  }
}
