import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { BrandMembersService } from '@/brands/brand-members.service';
import { ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
import { escapeRegex } from '@/common/utils/text';
import { Brand } from '@/brands/brand.schema';
import { NotificationsService } from '@/notifications/notifications.service';
import { Product } from '@/products/product.schema';
import { UsersService } from '@/users/users.service';
import { Question } from './question.schema';

/**
 * Questions before buying: a signed-in customer asks, the store answers, the answer shows to
 * everyone. Fewer repeated messages for the store, more confidence for customers.
 */
@Injectable()
export class QuestionsService {
  constructor(
    @InjectModel(Question.name) private readonly questions: Model<Question>,
    @InjectModel(Product.name) private readonly products: Model<Product>,
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    private readonly users: UsersService,
    private readonly members: BrandMembersService,
    private readonly notifications: NotificationsService,
  ) {}

  async ask(userId: string, productId: string, text: string) {
    const product = await this.products.findOne({ _id: productId, status: ProductStatus.ACTIVE }).select('brandId title').lean();
    if (!product) throw AppError.notFound('Product');
    // A few open questions per person and product at most.
    const open = await this.questions.countDocuments({ userId: new Types.ObjectId(userId), productId: product._id, answeredAt: null });
    if (open >= 3) throw AppError.unprocessable('TOO_MANY_QUESTIONS', 'Wait for the store to answer your questions first');
    const user = await this.users.getById(userId);
    const q = await this.questions.create({
      productId: product._id,
      brandId: product.brandId,
      userId: user._id,
      userName: user.name.split(' ')[0],
      text: text.trim(),
    });
    await this.notifications.notify(await this.members.memberUserIds(product.brandId), {
      type: 'QUESTION_NEW',
      title: 'سؤال جديد على منتجك',
      body: `${product.title}: ${q.text.slice(0, 100)}`,
      data: { questionId: q.id, productId: product._id.toString() },
    });
    return this.toView(q.toObject(), userId);
  }

  /** Answered questions for everyone, plus the viewer's own unanswered ones. */
  async listForProduct(productId: string, query: { page: number; limit: number }, viewerId?: string) {
    const filter: FilterQuery<Question> = {
      productId: new Types.ObjectId(productId),
      hidden: false,
      $or: [{ answeredAt: { $ne: null } }, ...(viewerId ? [{ userId: new Types.ObjectId(viewerId) }] : [])],
    };
    const page = await paginate(this.questions, filter, query, { sort: { answeredAt: -1, createdAt: -1 } });
    return new PageResult(page.items.map((q) => this.toView(q, viewerId)), page.page, page.limit, page.total);
  }

  async listForBrand(brandId: string, query: { page: number; limit: number; unanswered?: boolean }) {
    const filter: FilterQuery<Question> = { brandId: new Types.ObjectId(brandId), hidden: false };
    if (query.unanswered) filter.answeredAt = null;
    const page = await paginate(this.questions, filter, query, { sort: { answeredAt: 1, createdAt: -1 } });
    const titles = new Map(
      (await this.products.find({ _id: { $in: page.items.map((q) => q.productId) } }).select('title').lean()).map((p) => [p._id.toString(), p.title]),
    );
    return new PageResult(
      page.items.map((q) => ({ ...this.toView(q), productTitle: titles.get(q.productId.toString()) ?? '' })),
      page.page,
      page.limit,
      page.total,
    );
  }

  async answer(brandId: string, id: string, text: string) {
    const q = await this.questions.findOneAndUpdate(
      { _id: id, brandId: new Types.ObjectId(brandId) },
      { $set: { answer: text.trim(), answeredAt: new Date() } },
      { new: true },
    );
    if (!q) throw AppError.notFound('Question');
    await this.notifications.notify(q.userId.toString(), {
      type: 'QUESTION_ANSWERED',
      title: 'المتجر رد على سؤالك',
      body: q.answer!.slice(0, 120),
      data: { productId: q.productId.toString() },
    });
    return this.toView(q.toObject());
  }

/** Moderation list for admins: every question, newest first, with product and store names. */
  async listAll(query: { page: number; limit: number; hidden?: boolean; answered?: boolean; q?: string }) {
    const filter: FilterQuery<Question> = {};
    if (query.hidden !== undefined) filter.hidden = query.hidden;
    if (query.answered !== undefined) filter.answeredAt = query.answered ? { $ne: null } : null;
    if (query.q?.trim()) {
      const re = new RegExp(escapeRegex(query.q.trim()), 'i');
      filter.$or = [{ text: re }, { answer: re }, { userName: re }];
    }
    const page = await paginate(this.questions, filter, query, { sort: { createdAt: -1 } });
    const [products, brands] = await Promise.all([
      this.products.find({ _id: { $in: page.items.map((q) => q.productId) } }).select('title').lean(),
      this.brands.find({ _id: { $in: page.items.map((q) => q.brandId) } }).select('name').lean(),
    ]);
    const titles = new Map(products.map((p) => [p._id.toString(), p.title]));
    const names = new Map(brands.map((b) => [b._id.toString(), b.name]));
    return new PageResult(
      page.items.map((q) => ({
        ...this.toView(q),
        hidden: q.hidden,
        brandId: q.brandId.toString(),
        productTitle: titles.get(q.productId.toString()) ?? '',
        brandName: names.get(q.brandId.toString()) ?? '',
      })),
      page.page,
      page.limit,
      page.total,
    );
  }

  async setHidden(id: string, hidden: boolean) {
    const q = await this.questions.findByIdAndUpdate(id, { $set: { hidden } }, { new: true }).lean();
    if (!q) throw AppError.notFound('Question');
    return this.toView(q);
  }

  /** Median hours a store takes to answer (null with too few answers), for its badges. */
  async medianAnswerHours(brandId: Types.ObjectId) {
    const rows = await this.questions
      .find({ brandId, answeredAt: { $ne: null } })
      .sort({ answeredAt: -1 })
      .limit(30)
      .select('createdAt answeredAt')
      .lean();
    if (rows.length < 3) return null;
    const hours = rows.map((r) => (r.answeredAt!.getTime() - r.createdAt.getTime()) / 3_600_000).sort((a, b) => a - b);
    return hours[Math.floor(hours.length / 2)];
  }

  private toView(q: Lean<Question>, viewerId?: string) {
    return {
      id: q._id.toString(),
      productId: q.productId.toString(),
      userName: q.userName,
      text: q.text,
      answer: q.answer,
      answeredAt: q.answeredAt,
      mine: !!viewerId && q.userId.toString() === viewerId,
      createdAt: q.createdAt,
    };
  }
}
