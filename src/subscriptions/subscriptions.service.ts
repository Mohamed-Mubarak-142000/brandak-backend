import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { BrandStatus, FilePurpose, PaymentStatus, SubscriptionStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { paginate } from '@/common/pagination';
import { normalizeReference } from '@/common/utils/text';
import { withTransaction } from '@/common/utils/transaction';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { Brand } from '@/brands/brand.schema';
import { BrandMembersService } from '@/brands/brand-members.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { UploadsService } from '@/uploads/uploads.service';
import { UsersService } from '@/users/users.service';
import { SUBSCRIPTION_PAYMENT_PROVIDER, SubscriptionPaymentProvider } from './payment-provider';
import { Payment } from './payment.schema';
import { SubscriptionPlan } from './plan.schema';
import { Subscription } from './subscription.schema';
import { computePeriod, DURATION_DAYS } from './subscription-period';
import {
  AdminPaymentsQueryDto,
  AdminSubscriptionsQueryDto,
  CreatePlanDto,
  RequestSubscriptionDto,
  SubmitPaymentProofDto,
  UpdatePlanDto,
} from './subscriptions.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel(SubscriptionPlan.name) private readonly plans: Model<SubscriptionPlan>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<Subscription>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(SUBSCRIPTION_PAYMENT_PROVIDER) private readonly provider: SubscriptionPaymentProvider,
    private readonly uploads: UploadsService,
    private readonly members: BrandMembersService,
    private readonly users: UsersService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Plans ----------

  listActivePlans() {
    return this.plans.find({ isActive: true, deletedAt: null }).sort({ sortOrder: 1, priceMonthly: 1 }).lean();
  }

  listAllPlans() {
    return this.plans.find().sort({ sortOrder: 1, priceMonthly: 1 }).lean();
  }

  createPlan(dto: CreatePlanDto) {
    return this.plans.create(dto);
  }

  async updatePlan(adminId: string, id: string, dto: UpdatePlanDto) {
    // A deleted plan is edited only after it is restored.
    const plan = await this.plans.findOneAndUpdate({ _id: id, deletedAt: null }, dto, { new: true });
    if (!plan) throw AppError.notFound('Plan');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'PLAN_UPDATED', entityType: 'SubscriptionPlan', entityId: plan._id, data: { ...dto } });
    return plan;
  }

  /** Soft delete: no new subscriptions; running ones keep their plan snapshot. */
  async deletePlan(adminId: string, id: string) {
    const plan = await this.plans.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(adminId), isActive: false } },
      { new: true },
    );
    if (!plan) return this.planStateError(id, true);
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'PLAN_DELETED', entityType: 'SubscriptionPlan', entityId: plan._id });
    return plan;
  }

  async restorePlan(adminId: string, id: string) {
    const plan = await this.plans.findOneAndUpdate(
      { _id: id, deletedAt: { $ne: null } },
      { $unset: { deletedAt: 1, deletedBy: 1 }, $set: { isActive: true } },
      { new: true },
    );
    if (!plan) return this.planStateError(id, false);
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'PLAN_RESTORED', entityType: 'SubscriptionPlan', entityId: plan._id });
    return plan;
  }

  private async planStateError(id: string, deleting: boolean): Promise<never> {
    if (!(await this.plans.exists({ _id: id }))) throw AppError.notFound('Plan');
    throw AppError.conflict('INVALID_STATE', deleting ? 'Plan is already deleted' : 'Plan is not deleted');
  }

  /** Decided payments only; a reference stays reserved after delete (anti-reuse checks see it). */
  async deletePayment(adminId: string, id: string) {
    const done = [PaymentStatus.APPROVED, PaymentStatus.REJECTED, PaymentStatus.CANCELLED];
    const payment = await this.payments.findOneAndUpdate(
      { _id: id, deletedAt: null, status: { $in: done } },
      { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(adminId) } },
      { new: true },
    );
    if (!payment) {
      const p = await this.payments.findById(id).select('status').lean();
      if (!p) throw AppError.notFound('Payment');
      if (!done.includes(p.status)) throw AppError.conflict('PAYMENT_IN_PROGRESS', 'Review the payment before deleting it');
      throw AppError.conflict('INVALID_STATE', 'Payment is already deleted');
    }
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'PAYMENT_DELETED', entityType: 'Payment', entityId: payment._id });
    return payment;
  }

  async restorePayment(adminId: string, id: string) {
    const payment = await this.payments.findOneAndUpdate({ _id: id, deletedAt: { $ne: null } }, { $unset: { deletedAt: 1, deletedBy: 1 } }, { new: true });
    if (!payment) {
      if (!(await this.payments.exists({ _id: id }))) throw AppError.notFound('Payment');
      throw AppError.conflict('INVALID_STATE', 'Payment is not deleted');
    }
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'PAYMENT_RESTORED', entityType: 'Payment', entityId: payment._id });
    return payment;
  }

  // ---------- Brand owner ----------

  /** The subscription in force right now (used for plan limits). */
  currentFor(brandId: string | Types.ObjectId) {
    const now = new Date();
    return this.subscriptions
      .findOne({
        brandId: new Types.ObjectId(String(brandId)),
        status: SubscriptionStatus.ACTIVE,
        startsAt: { $lte: now },
        endsAt: { $gt: now },
      })
      .lean();
  }

  async request(userId: string, brandId: string, dto: RequestSubscriptionDto) {
    const brand = await this.brands.findById(brandId).lean();
    if (!brand) throw AppError.notFound('Brand');
    if (brand.status === BrandStatus.SUSPENDED || brand.status === BrandStatus.REJECTED) {
      throw AppError.forbidden('BRAND_NOT_ELIGIBLE', 'This brand cannot subscribe in its current state');
    }
    const plan = await this.plans.findOne({ _id: dto.planId, isActive: true }).lean();
    if (!plan) throw AppError.notFound('Plan');

    const durationDays = DURATION_DAYS[dto.billingPeriod];
    const price = dto.billingPeriod === 'YEARLY' ? plan.priceYearly : plan.priceMonthly;

    const result = await withTransaction(this.connection, async (session) => {
      // Only one open request at a time. An unreviewed one is replaced; one under review blocks.
      const open = await this.subscriptions
        .find({ brandId: brand._id, status: SubscriptionStatus.PENDING_PAYMENT })
        .session(session);
      for (const sub of open) {
        const payment = await this.payments.findOne({ subscriptionId: sub._id }).session(session);
        if (payment?.status === PaymentStatus.PENDING_REVIEW) {
          throw AppError.conflict('PAYMENT_UNDER_REVIEW', 'A payment is already under review');
        }
        sub.status = SubscriptionStatus.CANCELLED;
        sub.cancelledAt = new Date();
        await sub.save({ session });
        if (payment) {
          payment.status = PaymentStatus.CANCELLED;
          await payment.save({ session });
        }
      }

      const previous = await this.subscriptions
        .findOne({ brandId: brand._id, status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] } })
        .sort({ endsAt: -1 })
        .session(session);

      const [subscription] = await this.subscriptions.create(
        [
          {
            brandId: brand._id,
            planId: plan._id,
            planSnapshot: {
              code: plan.code,
              nameAr: plan.nameAr,
              nameEn: plan.nameEn,
              price,
              durationDays,
              limits: { maxActiveProducts: plan.limits.maxActiveProducts },
            },
            billingPeriod: dto.billingPeriod,
            renewalOf: previous?._id,
          },
        ],
        { session },
      );
      const [payment] = await this.payments.create(
        [{ brandId: brand._id, subscriptionId: subscription._id, amount: price, method: this.provider.method }],
        { session },
      );
      await this.audit.log(
        { actorId: userId, actorType: 'USER', action: 'SUBSCRIPTION_REQUESTED', entityType: 'Subscription', entityId: subscription._id, data: { plan: plan.code, billingPeriod: dto.billingPeriod, price } },
        session,
      );
      return { subscription, payment };
    });

    return {
      subscription: result.subscription.toObject(),
      payment: this.paymentView(result.payment.toObject()),
      instructions: this.provider.instructions(price),
    };
  }

  async submitProof(userId: string, brandId: string, subscriptionId: string, dto: SubmitPaymentProofDto) {
    const subscription = await this.subscriptions.findOne({
      _id: subscriptionId,
      brandId: new Types.ObjectId(brandId),
    });
    if (!subscription) throw AppError.notFound('Subscription');
    if (subscription.status !== SubscriptionStatus.PENDING_PAYMENT) {
      throw AppError.conflict('INVALID_STATE', 'This subscription is not awaiting payment');
    }
    await this.uploads.requireOwned(userId, [dto.proofFileId], FilePurpose.PAYMENT_PROOF);

    const reference = normalizeReference(dto.transactionReference);
    const reused = await this.payments.exists({
      transactionReferenceNormalized: reference,
      subscriptionId: { $ne: subscription._id },
      status: { $in: [PaymentStatus.APPROVED, PaymentStatus.PENDING_REVIEW] },
    });
    if (reused) throw AppError.conflict('REFERENCE_ALREADY_USED', 'This transfer reference was already submitted');

    const payment = await this.payments.findOne({ subscriptionId: subscription._id });
    if (!payment) throw AppError.notFound('Payment');
    if (![PaymentStatus.AWAITING_PROOF, PaymentStatus.REJECTED].includes(payment.status)) {
      throw AppError.conflict('INVALID_STATE', 'This payment cannot receive a new proof');
    }
    if (payment.status === PaymentStatus.REJECTED && payment.proofFileId) {
      payment.previousAttempts.push({
        proofFileId: payment.proofFileId,
        transactionReference: payment.transactionReference!,
        senderName: payment.senderName,
        submittedAt: payment.submittedAt!,
        rejectedAt: payment.reviewedAt,
        rejectionReason: payment.rejectionReason,
      });
    }
    Object.assign(payment, {
      status: PaymentStatus.PENDING_REVIEW,
      proofFileId: new Types.ObjectId(dto.proofFileId),
      transactionReference: dto.transactionReference.trim(),
      transactionReferenceNormalized: reference,
      senderName: dto.senderName,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
      submittedAt: new Date(),
      reviewedBy: undefined,
      reviewedAt: undefined,
      rejectionReason: undefined,
    });
    await payment.save();
    await this.audit.log({ actorId: userId, actorType: 'USER', action: 'PAYMENT_PROOF_SUBMITTED', entityType: 'Payment', entityId: payment._id });
    await this.notifications.notify(await this.users.adminIds(), {
      type: 'PAYMENT_PENDING_REVIEW',
      title: 'إيصال دفع جديد للمراجعة',
      body: `مبلغ ${payment.amount} ج.م بانتظار المراجعة`,
      data: { paymentId: payment.id },
    });
    return this.paymentView(payment.toObject());
  }

  async mine(brandId: string) {
    const id = new Types.ObjectId(brandId);
    const [brand, current, history, payments] = await Promise.all([
      this.brands.findById(id).select('subscriptionEndsAt').lean(),
      this.currentFor(id),
      this.subscriptions.find({ brandId: id }).sort({ createdAt: -1 }).limit(24).lean(),
      this.payments.find({ brandId: id, deletedAt: null }).sort({ createdAt: -1 }).limit(24).lean(),
    ]);
    const paymentBySub = new Map(payments.map((p) => [p.subscriptionId.toString(), this.paymentView(p)]));
    const withPayment = (s: (typeof history)[number]) => ({ ...s, payment: paymentBySub.get(s._id.toString()) ?? null });
    const pending = history.find((s) => s.status === SubscriptionStatus.PENDING_PAYMENT);
    return {
      paidUntil: brand?.subscriptionEndsAt ?? null,
      current: current ? withPayment(current) : null,
      pending: pending
        ? { ...withPayment(pending), instructions: this.provider.instructions(pending.planSnapshot.price) }
        : null,
      history: history.map(withPayment),
    };
  }

  instructions(amount = 0) {
    return this.provider.instructions(amount);
  }

  // ---------- Admin review ----------

  listPayments(query: AdminPaymentsQueryDto) {
    const filter: FilterQuery<Payment> = { deletedAt: query.deleted ? { $ne: null } : null };
    if (query.status) filter.status = query.status;
    if (query.brandId) filter.brandId = new Types.ObjectId(query.brandId);
    return paginate(this.payments, filter, query, {
      sort: query.sort === 'oldest' ? { submittedAt: 1, createdAt: 1 } : { submittedAt: -1, createdAt: -1 },
      populate: 'brandId',
    });
  }

  async getPayment(id: string) {
    const payment = await this.payments
      .findById(id)
      .populate('brandId', 'name slug status contact subscriptionEndsAt')
      .populate('subscriptionId')
      .lean();
    if (!payment) throw AppError.notFound('Payment');
    return payment;
  }

  /** Short-lived link to the private receipt image. */
  async proofUrl(adminId: string, id: string) {
    const payment = await this.payments.findById(id).lean();
    if (!payment?.proofFileId) throw AppError.notFound('Payment proof');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'PAYMENT_PROOF_VIEWED', entityType: 'Payment', entityId: payment._id });
    return { url: await this.uploads.signedUrl(payment.proofFileId, 300), expiresInSeconds: 300 };
  }

  async approve(adminId: string, id: string, reviewNote?: string) {
    const { payment, subscription } = await withTransaction(this.connection, async (session) => {
      const payment = await this.payments.findOneAndUpdate(
        { _id: id, status: PaymentStatus.PENDING_REVIEW },
        {
          $set: {
            status: PaymentStatus.APPROVED,
            reviewedBy: new Types.ObjectId(adminId),
            reviewedAt: new Date(),
            reviewNote,
          },
        },
        { new: true, session },
      );
      if (!payment) throw await this.reviewStateError(id);

      const subscription = await this.subscriptions.findById(payment.subscriptionId).session(session);
      if (!subscription || subscription.status !== SubscriptionStatus.PENDING_PAYMENT) {
        throw AppError.conflict('INVALID_STATE', 'Subscription is not awaiting payment');
      }
      const brand = await this.brands.findById(payment.brandId).session(session);
      if (!brand) throw AppError.notFound('Brand');

      const { startsAt, endsAt } = computePeriod(
        new Date(),
        brand.subscriptionEndsAt,
        subscription.planSnapshot.durationDays,
      );
      subscription.status = SubscriptionStatus.ACTIVE;
      subscription.startsAt = startsAt;
      subscription.endsAt = endsAt;
      await subscription.save({ session });

      brand.subscriptionEndsAt = endsAt;
      await brand.save({ session });

      await this.audit.log(
        { actorId: adminId, actorType: 'ADMIN', action: 'PAYMENT_APPROVED', entityType: 'Payment', entityId: payment._id, data: { amount: payment.amount, subscriptionId: subscription.id, startsAt, endsAt } },
        session,
      );
      return { payment, subscription };
    }).catch((e) => {
      if (e?.code === 11000) {
        throw AppError.conflict('REFERENCE_ALREADY_USED', 'This transfer reference already backs an approved payment');
      }
      throw e;
    });

    await this.notifications.notify(await this.members.memberUserIds(payment.brandId), {
      type: 'PAYMENT_APPROVED',
      title: 'تم تفعيل الاشتراك',
      body: `تم تأكيد الدفع وتفعيل باقة ${subscription.planSnapshot.nameAr} حتى ${subscription.endsAt!.toISOString().slice(0, 10)}`,
      data: { subscriptionId: subscription.id },
    });
    return { payment: this.paymentView(payment.toObject()), subscription: subscription.toObject() };
  }

  async reject(adminId: string, id: string, reason: string) {
    const payment = await withTransaction(this.connection, async (session) => {
      const payment = await this.payments.findOneAndUpdate(
        { _id: id, status: PaymentStatus.PENDING_REVIEW },
        {
          $set: {
            status: PaymentStatus.REJECTED,
            reviewedBy: new Types.ObjectId(adminId),
            reviewedAt: new Date(),
            rejectionReason: reason,
          },
        },
        { new: true, session },
      );
      if (!payment) throw await this.reviewStateError(id);
      await this.audit.log(
        { actorId: adminId, actorType: 'ADMIN', action: 'PAYMENT_REJECTED', entityType: 'Payment', entityId: payment._id, data: { reason } },
        session,
      );
      return payment;
    });
    await this.notifications.notify(await this.members.memberUserIds(payment.brandId), {
      type: 'PAYMENT_REJECTED',
      title: 'تم رفض إيصال الدفع',
      body: `السبب: ${reason}. يمكنك رفع إيصال جديد.`,
      data: { subscriptionId: payment.subscriptionId.toString() },
    });
    return this.paymentView(payment.toObject());
  }

  listSubscriptions(query: AdminSubscriptionsQueryDto) {
    const filter: FilterQuery<Subscription> = {};
    if (query.status) filter.status = query.status;
    if (query.brandId) filter.brandId = new Types.ObjectId(query.brandId);
    return paginate(this.subscriptions, filter, query, { populate: 'brandId' });
  }

  private async reviewStateError(id: string) {
    const exists = await this.payments.exists({ _id: id });
    return exists
      ? AppError.conflict('ALREADY_REVIEWED', 'This payment is not pending review')
      : AppError.notFound('Payment');
  }

  /** Owners never see internal review fields beyond the outcome. */
  private paymentView(p: Payment & { _id: Types.ObjectId }) {
    return {
      id: p._id.toString(),
      subscriptionId: p.subscriptionId.toString(),
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      status: p.status,
      transactionReference: p.transactionReference ?? null,
      submittedAt: p.submittedAt ?? null,
      reviewedAt: p.reviewedAt ?? null,
      rejectionReason: p.rejectionReason ?? null,
    };
  }
}
