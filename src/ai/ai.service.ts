import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BrandsService } from '@/brands/brands.service';
import { CategoriesService } from '@/categories/categories.service';
import { FilePurpose } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Env } from '@/config/env';
import { UploadsService } from '@/uploads/uploads.service';
import { PRODUCT_AI, ProductAiProvider, ProductDraft } from './product-ai.provider';

/** Drafts made per store per (Cairo) day, so one store can't use up the free quota. */
@Schema({ collection: 'aiUsage' })
export class AiUsage {
  @Prop({ type: Types.ObjectId, required: true }) brandId: Types.ObjectId;
  @Prop({ required: true }) day: string;
  @Prop({ default: 0 }) count: number;
}
export const AiUsageSchema = SchemaFactory.createForClass(AiUsage);
AiUsageSchema.index({ brandId: 1, day: 1 }, { unique: true });

const cairoDay = (d = new Date()) => new Date(d.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v: unknown, max: number, len = 30) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => clean(x, len)).filter(Boolean))].slice(0, max);

/** "Product from a photo": the seller uploads a photo and gets a draft to review. */
@Injectable()
export class AiService {
  private readonly dailyLimit: number;

  constructor(
    @InjectModel(AiUsage.name) private readonly usage: Model<AiUsage>,
    @Inject(PRODUCT_AI) private readonly ai: ProductAiProvider,
    private readonly uploads: UploadsService,
    private readonly brands: BrandsService,
    private readonly categories: CategoriesService,
    config: ConfigService<Env, true>,
  ) {
    this.dailyLimit = config.get('AI_DAILY_LIMIT', { infer: true });
  }

  async status(brandId: string) {
    if (!this.ai.enabled) return { enabled: false, remaining: 0, dailyLimit: 0 };
    const row = await this.usage.findOne({ brandId: new Types.ObjectId(brandId), day: cairoDay() }).lean();
    return { enabled: true, remaining: Math.max(0, this.dailyLimit - (row?.count ?? 0)), dailyLimit: this.dailyLimit };
  }

  async draftFromImage(userId: string, brandId: string, imageFileId: string): Promise<ProductDraft> {
    if (!this.ai.enabled) throw new AppError('AI_UNAVAILABLE', 'Product suggestions are not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    const [file] = await this.uploads.requireOwned(userId, [imageFileId], FilePurpose.PRODUCT_IMAGE);
    const brand = await this.brands.getById(brandId);

    // Count first (atomically, capped) so parallel taps can't pass the limit.
    const day = cairoDay();
    const counted = await this.usage
      .findOneAndUpdate({ brandId: brand._id, day, count: { $lt: this.dailyLimit } }, { $inc: { count: 1 } }, { new: true })
      .lean();
    if (!counted) {
      const created = await this.usage.create({ brandId: brand._id, day, count: 1 }).catch(() => null);
      if (!created) throw AppError.unprocessable('AI_DAILY_LIMIT', `Up to ${this.dailyLimit} suggestions per day`);
    }

    const categories = await this.categories.activeWithChildren(brand.categoryIds ?? []);
    let raw: ProductDraft;
    try {
      raw = await this.ai.draft({ imageUrl: file.url!, storeType: brand.storeType, categories });
    } catch {
      // A failed call shouldn't eat the store's quota.
      await this.usage.updateOne({ brandId: brand._id, day, count: { $gt: 0 } }, { $inc: { count: -1 } });
      throw new AppError('AI_FAILED', 'Could not read the photo, try another one', HttpStatus.BAD_GATEWAY);
    }
    return {
      title: clean(raw.title, 120),
      description: clean(raw.description, 1500),
      categoryId: categories.some((c) => c.id === raw.categoryId) ? raw.categoryId : (categories.length === 1 ? categories[0].id : null),
      colors: list(raw.colors, 8),
      sizes: list(raw.sizes, 12, 10),
      tags: list(raw.tags, 10),
    };
  }
}
