import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { OrderStatus, ProductStatus, ReportStatus, ReportTarget, ReviewStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { paginate, PageQueryDto, PageResult } from '@/common/pagination';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { Brand } from '@/brands/brand.schema';
import { Order } from '@/orders/order.schema';
import { Product } from '@/products/product.schema';
import { UsersService } from '@/users/users.service';
import { Report, Review } from './review.schema';
import { CreateReportDto, CreateReviewDto, ReportsQueryDto, ResolveReportDto } from './reviews.dto';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(Order.name) private readonly orders: Model<Order>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly users: UsersService,
    private readonly audit: AuditLogsService,
  ) {}

  async create(userId: string, productId: string, dto: CreateReviewDto) {
    const order = await this.orders
      .findOne({
        _id: dto.orderId,
        userId: new Types.ObjectId(userId),
        status: OrderStatus.DELIVERED,
        'items.productId': new Types.ObjectId(productId),
      })
      .lean();
    if (!order) {
      throw AppError.forbidden('NOT_ELIGIBLE', 'You can review a product after receiving it');
    }
    const user = await this.users.getById(userId);
    try {
      const review = await this.reviews.create({
        userId: user._id,
        userName: user.name,
        productId: new Types.ObjectId(productId),
        brandId: order.brandId,
        orderId: order._id,
        rating: dto.rating,
        comment: dto.comment?.trim() ?? '',
      });
      await this.refreshRatings(review.productId, review.brandId);
      return this.toView(review.toObject());
    } catch (e: any) {
      if (e?.code === 11000) throw AppError.conflict('ALREADY_REVIEWED', 'You already reviewed this product for this order');
      throw e;
    }
  }

  async listForProduct(productId: string, query: PageQueryDto) {
    const product = await this.products.exists({ _id: productId, status: ProductStatus.ACTIVE });
    if (!product) throw AppError.notFound('Product');
    const filter = { productId: new Types.ObjectId(productId), status: ReviewStatus.VISIBLE, deletedAt: null };
    const [page, distribution] = await Promise.all([
      paginate(this.reviews, filter, query),
      this.reviews.aggregate<{ _id: number; count: number }>([
        { $match: filter },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ]),
    ]);
    const stars = Object.fromEntries([1, 2, 3, 4, 5].map((s) => [s, distribution.find((d) => d._id === s)?.count ?? 0]));
    return new PageResult(page.items.map((r) => this.toView(r)), page.page, page.limit, page.total, { stars });
  }

  async listMine(userId: string, query: PageQueryDto) {
    const page = await paginate(this.reviews, { userId: new Types.ObjectId(userId), deletedAt: null }, query);
    return new PageResult(page.items.map((r) => ({ ...this.toView(r), status: r.status })), page.page, page.limit, page.total);
  }

  async report(userId: string, dto: CreateReportDto) {
    const models: Record<ReportTarget, Model<any>> = {
      [ReportTarget.REVIEW]: this.reviews,
      [ReportTarget.PRODUCT]: this.products,
      [ReportTarget.BRAND]: this.brands,
    };
    // Deleted stores and reviews can no longer be reported (products have no deletedAt, so null matches).
    if (!(await models[dto.targetType].exists({ _id: dto.targetId, deletedAt: null }))) throw AppError.notFound(dto.targetType);
    try {
      const report = await this.reports.create({
        reporterId: new Types.ObjectId(userId),
        targetType: dto.targetType,
        targetId: new Types.ObjectId(dto.targetId),
        reason: dto.reason,
        details: dto.details ?? '',
      });
      return { id: report.id, status: report.status };
    } catch (e: any) {
      if (e?.code === 11000) throw AppError.conflict('ALREADY_REPORTED', 'You already reported this');
      throw e;
    }
  }

  // ---------- Admin ----------

  async listReports(query: ReportsQueryDto) {
    const filter: FilterQuery<Report> = { deletedAt: query.deleted ? { $ne: null } : null };
    if (query.status) filter.status = query.status;
    if (query.targetType) filter.targetType = query.targetType;
    const page = await paginate(this.reports, filter, query, { populate: 'reporterId' });

    // One query per target type, so moderators see what was reported without extra requests.
    const idsOf = (type: ReportTarget) => page.items.filter((r) => r.targetType === type).map((r) => r.targetId);
    const [reviews, products, brands] = await Promise.all([
      this.reviews.find({ _id: { $in: idsOf(ReportTarget.REVIEW) } }).select('rating comment userName status productId deletedAt').lean(),
      this.products.find({ _id: { $in: idsOf(ReportTarget.PRODUCT) } }).select('title status brandId images').lean(),
      this.brands.find({ _id: { $in: idsOf(ReportTarget.BRAND) } }).select('name slug status deletedAt').lean(),
    ]);
    const summary = (r: (typeof page.items)[number]) => {
      const id = r.targetId.toString();
      switch (r.targetType) {
        case ReportTarget.REVIEW: {
          const t = reviews.find((x) => x._id.toString() === id);
          return t && { title: t.comment || `تقييم ${t.rating}/5`, subtitle: t.userName, status: t.status, productId: t.productId.toString(), deleted: !!t.deletedAt };
        }
        case ReportTarget.PRODUCT: {
          const t = products.find((x) => x._id.toString() === id);
          return t && { title: t.title, status: t.status, imageUrl: t.images[0]?.url ?? null, brandId: t.brandId.toString() };
        }
        case ReportTarget.BRAND: {
          const t = brands.find((x) => x._id.toString() === id);
          return t && { title: t.name, subtitle: t.slug, status: t.status, deleted: !!t.deletedAt };
        }
      }
    };
    const items = page.items.map((r) => {
      const reporter = r.reporterId as unknown as { _id: Types.ObjectId; name?: string; email?: string } | null;
      return {
        ...r,
        reporterId: undefined,
        reporter: reporter ? { id: reporter._id.toString(), name: reporter.name, email: reporter.email } : null,
        target: summary(r) ?? null, // null when the target was deleted
      };
    });
    return new PageResult(items, page.page, page.limit, page.total);
  }

  async resolveReport(adminId: string, id: string, dto: ResolveReportDto) {
    const report = await this.reports.findOneAndUpdate(
      { _id: id, status: ReportStatus.OPEN },
      { $set: { status: dto.status, resolutionNote: dto.resolutionNote, resolvedBy: new Types.ObjectId(adminId) } },
      { new: true },
    );
    if (!report) throw AppError.conflict('INVALID_STATE', 'Report not found or already handled');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: `REPORT_${dto.status}`, entityType: 'Report', entityId: report._id, data: { note: dto.resolutionNote } });
    return report;
  }

  async setReviewStatus(adminId: string, id: string, status: ReviewStatus) {
    const review = await this.reviews.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!review) throw AppError.notFound('Review');
    await this.refreshRatings(review.productId, review.brandId);
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: `REVIEW_${status}`, entityType: 'Review', entityId: review._id });
    return this.toView(review.toObject());
  }

  /** Handled reports only: an open one must be resolved or dismissed first. */
  async deleteReport(adminId: string, id: string) {
    const report = await this.reports.findOneAndUpdate(
      { _id: id, deletedAt: null, status: { $ne: ReportStatus.OPEN } },
      { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(adminId) } },
      { new: true },
    );
    if (!report) {
      const r = await this.reports.findById(id).select('status deletedAt').lean();
      if (!r) throw AppError.notFound('Report');
      if (r.status === ReportStatus.OPEN) throw AppError.conflict('REPORT_OPEN', 'Resolve or dismiss the report before deleting it');
      throw AppError.conflict('INVALID_STATE', 'Report is already deleted');
    }
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'REPORT_DELETED', entityType: 'Report', entityId: report._id });
    return report;
  }

  async restoreReport(adminId: string, id: string) {
    const report = await this.reports.findOneAndUpdate({ _id: id, deletedAt: { $ne: null } }, { $unset: { deletedAt: 1, deletedBy: 1 } }, { new: true });
    if (!report) {
      if (!(await this.reports.exists({ _id: id }))) throw AppError.notFound('Report');
      throw AppError.conflict('INVALID_STATE', 'Report is not deleted');
    }
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'REPORT_RESTORED', entityType: 'Report', entityId: report._id });
    return report;
  }

  /** Soft delete a review; ratings are recomputed without it. */
  async setReviewDeleted(adminId: string, id: string, deleted: boolean) {
    const review = await this.reviews.findOneAndUpdate(
      { _id: id, deletedAt: deleted ? null : { $ne: null } },
      deleted ? { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(adminId) } } : { $unset: { deletedAt: 1, deletedBy: 1 } },
      { new: true },
    );
    if (!review) {
      if (!(await this.reviews.exists({ _id: id }))) throw AppError.notFound('Review');
      throw AppError.conflict('INVALID_STATE', deleted ? 'Review is already deleted' : 'Review is not deleted');
    }
    await this.refreshRatings(review.productId, review.brandId);
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: deleted ? 'REVIEW_DELETED' : 'REVIEW_RESTORED', entityType: 'Review', entityId: review._id });
    return this.toView(review.toObject());
  }

  async archiveProduct(adminId: string, id: string, reason: string) {
    const product = await this.products.findByIdAndUpdate(id, { $set: { status: ProductStatus.ARCHIVED } }, { new: true });
    if (!product) throw AppError.notFound('Product');
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'PRODUCT_TAKEN_DOWN', entityType: 'Product', entityId: product._id, data: { reason } });
  }

  /** Recomputes averages from visible reviews, so hiding a review also fixes the rating. */
  private async refreshRatings(productId: Types.ObjectId, brandId: Types.ObjectId) {
    const stats = async (match: FilterQuery<Review>) => {
      const [s] = await this.reviews.aggregate<{ avg: number; count: number }>([
        { $match: { ...match, status: ReviewStatus.VISIBLE, deletedAt: null } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]);
      return { ratingAvg: s ? Math.round(s.avg * 10) / 10 : 0, ratingCount: s?.count ?? 0 };
    };
    await Promise.all([
      stats({ productId }).then((s) => this.products.updateOne({ _id: productId }, { $set: s })),
      stats({ brandId }).then((s) => this.brands.updateOne({ _id: brandId }, { $set: s })),
    ]);
  }

  private toView(r: Review & { _id: Types.ObjectId }) {
    return {
      id: r._id.toString(),
      productId: r.productId.toString(),
      userName: r.userName,
      rating: r.rating,
      comment: r.comment,
      verifiedPurchase: true,
      createdAt: r.createdAt,
    };
  }
}
