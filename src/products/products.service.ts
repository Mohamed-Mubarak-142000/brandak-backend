import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, SortOrder, Types } from 'mongoose';
import { FilePurpose, ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
import { IMAGE_WIDTH, optimizedImage } from '@/common/utils/image';
import { PromotionsService } from '@/promotions/promotions.service';
import { activeSalePercent, salePrice } from '@/promotions/price-math';
import { escapeRegex, normalizeSearchText } from '@/common/utils/text';
import { BrandsService } from '@/brands/brands.service';
import { CategoriesService } from '@/categories/categories.service';
import { SubscriptionsService } from '@/subscriptions/subscriptions.service';
import { UploadsService } from '@/uploads/uploads.service';
import { Product, ProductDocument, Variant } from './product.schema';
import {
  BrandProductsQueryDto,
  CreateProductDto,
  ProductsQueryDto,
  UpdateProductDto,
  VariantDto,
} from './products.dto';

/** Safety caps so a single store can't fill the database. */
const MAX_TOTAL_PRODUCTS = 2000;
const MAX_ACTIVE_PRODUCTS = 1000;
const MAX_IMAGES = 10;

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly brands: BrandsService,
    private readonly categories: CategoriesService,
    private readonly subscriptions: SubscriptionsService,
    private readonly uploads: UploadsService,
    private readonly promotions: PromotionsService,
  ) {}

  // ---------- Brand owner ----------

  listForBrand(brandId: string, query: BrandProductsQueryDto) {
    const filter: FilterQuery<Product> = { brandId: new Types.ObjectId(brandId) };
    filter.status = query.status ?? { $ne: ProductStatus.ARCHIVED };
    if (query.q?.trim()) filter.searchText = new RegExp(escapeRegex(normalizeSearchText(query.q)));
    return paginate(this.products, filter, query, { sort: { updatedAt: -1 } });
  }

  async getForBrand(brandId: string, id: string) {
    return this.ownedOrThrow(brandId, id);
  }

  async create(userId: string, brandId: string, dto: CreateProductDto) {
    const total = await this.products.countDocuments({ brandId: new Types.ObjectId(brandId) });
    if (total >= MAX_TOTAL_PRODUCTS) {
      throw AppError.unprocessable('PRODUCT_LIMIT', 'Maximum number of products reached');
    }
    const [categoryId] = await this.categories.requireActive([dto.categoryId]);
    const status = dto.status ?? ProductStatus.DRAFT;
    if (status === ProductStatus.ACTIVE) await this.assertCanPublish(brandId);
    this.assertCompareAtPrice(dto.price, dto.compareAtPrice);

    const product = new this.products({
      brandId: new Types.ObjectId(brandId),
      categoryId,
      title: dto.title.trim(),
      description: dto.description ?? '',
      images: await this.productImages(userId, brandId, dto.imageFileIds, dto.imageColors),
      price: dto.price,
      compareAtPrice: dto.compareAtPrice ?? null,
      sale: await this.saleFrom(dto.sale),
      variants: dto.variants.map(toVariant),
      tags: dto.tags ?? [],
      status,
      publishedAt: status === ProductStatus.ACTIVE ? new Date() : undefined,
    });
    this.refreshDerived(product);
    await product.save();
    return product.toObject();
  }

  async update(userId: string, brandId: string, id: string, dto: UpdateProductDto) {
    const product = await this.ownedOrThrow(brandId, id);
    if (dto.categoryId) [product.categoryId] = await this.categories.requireActive([dto.categoryId]);
    if (dto.title) product.title = dto.title.trim();
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.compareAtPrice !== undefined) product.compareAtPrice = dto.compareAtPrice;
    if (dto.sale !== undefined) product.sale = await this.saleFrom(dto.sale);
    this.assertCompareAtPrice(product.price, product.compareAtPrice);
    if (dto.tags) product.tags = dto.tags;
    if (dto.imageFileIds) {
      product.images = await this.productImages(userId, brandId, dto.imageFileIds, dto.imageColors);
    } else if (dto.imageColors) {
      product.images.forEach((img, i) => (img.color = cleanColor(dto.imageColors![i])));
    }
    if (dto.variants) this.applyVariants(product, dto.variants);

    if (dto.status && dto.status !== product.status) {
      if (dto.status === ProductStatus.ACTIVE) {
        await this.assertCanPublish(brandId, product._id);
        product.publishedAt ??= new Date();
      }
      product.status = dto.status;
    }
    this.refreshDerived(product);
    await product.save();
    return product.toObject();
  }

  /** Validates and normalises a sale (a season sale must fit the season). null clears it. */
  private async saleFrom(dto?: { percent: number; startsAt?: string; endsAt: string; campaignId?: string } | null) {
    if (!dto) return null;
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw AppError.unprocessable('INVALID_DATES', 'The sale must end after it starts');
    if (dto.campaignId) await this.promotions.assertSaleFitsCampaign(dto.campaignId, { percent: dto.percent, startsAt, endsAt });
    return { percent: dto.percent, startsAt, endsAt, campaignId: dto.campaignId ? new Types.ObjectId(dto.campaignId) : null };
  }

  /** Photos allowed per product on the store's plan (10 without a plan, for drafts). */
  async imageLimit(_brandId: string) {
    return MAX_IMAGES;
  }

  private async productImages(userId: string, brandId: string, ids: string[], colors?: (string | null)[]) {
    const max = await this.imageLimit(brandId);
    if (ids.length > max) {
      throw AppError.unprocessable('IMAGE_LIMIT', `Your plan allows up to ${max} images per product`);
    }
    const refs = await this.uploads.imageRefs(userId, ids, FilePurpose.PRODUCT_IMAGE);
    return refs.map((r, i) => ({ ...r, color: cleanColor(colors?.[i]) }));
  }

  /** How many more products the plan lets the store publish; null when there is no active plan. */
  async publishSlots(brandId: string): Promise<number | null> {
    const active = await this.products.countDocuments({ brandId: new Types.ObjectId(brandId), status: ProductStatus.ACTIVE });
    return Math.max(0, MAX_ACTIVE_PRODUCTS - active);
  }

  /**
   * Second step of a file import: downloads the product's image links and, when asked,
   * publishes it once it has at least one photo. A link that fails is reported, not fatal.
   */
  async importImages(userId: string, brandId: string, id: string, urls: string[], publish: boolean, colors?: (string | null)[]) {
    const product = await this.ownedOrThrow(brandId, id);
    const room = Math.max(0, (await this.imageLimit(brandId)) - product.images.length);
    const results = await Promise.all(
      urls.slice(0, room).map((url) =>
        this.uploads
          .importFromUrl(userId, url, FilePurpose.PRODUCT_IMAGE)
          .then((f) => ({ url, file: f, color: cleanColor(colors?.[urls.indexOf(url)]) }))
          .catch((e: unknown) => ({ url, error: e instanceof AppError ? e.code : 'IMAGE_FETCH_FAILED' })),
      ),
    );
    const ok = results.flatMap((r) => ('file' in r ? [r] : []));
    if (ok.length) {
      const refs = await this.uploads.imageRefs(userId, ok.map((r) => r.file.id), FilePurpose.PRODUCT_IMAGE);
      product.images.push(...refs.map((ref, i) => ({ ...ref, color: ok[i].color })));
    }
    let publishError: string | null = null;
    if (publish && product.status === ProductStatus.DRAFT && product.images.length) {
      try {
        await this.assertCanPublish(brandId, product._id);
        product.status = ProductStatus.ACTIVE;
        product.publishedAt ??= new Date();
      } catch (e) {
        publishError = e instanceof AppError ? e.code : 'PUBLISH_FAILED';
      }
    }
    await product.save();
    return {
      id: product._id.toString(),
      status: product.status,
      imported: ok.length,
      failed: results.flatMap((r) => ('error' in r ? [{ url: r.url, code: r.error }] : [])),
      publishError,
    };
  }

  /** Products with order history are archived rather than deleted; orders keep their own snapshot. */
  async archive(brandId: string, id: string) {
    const product = await this.ownedOrThrow(brandId, id);
    product.status = ProductStatus.ARCHIVED;
    await product.save();
  }

  /** Atomic stock change, safe to run alongside checkouts. */
  async adjustStock(brandId: string, id: string, variantId: string, delta: number) {
    const filter: FilterQuery<Product> = {
      _id: id,
      brandId: new Types.ObjectId(brandId),
      variants: { $elemMatch: { _id: new Types.ObjectId(variantId), ...(delta < 0 ? { stock: { $gte: -delta } } : {}) } },
    };
    const updated = await this.products.findOneAndUpdate(
      filter,
      { $inc: { 'variants.$.stock': delta, totalStock: delta } },
      { new: true },
    );
    if (!updated) {
      await this.ownedOrThrow(brandId, id);
      throw AppError.unprocessable('INVALID_STOCK_CHANGE', 'Variant not found or stock would become negative');
    }
    return updated.toObject();
  }

  // ---------- Public catalog ----------

  async search(query: ProductsQueryDto) {
    const filter: FilterQuery<Product> = {
      status: ProductStatus.ACTIVE,
      brandId: { $in: await this.brands.visibleBrandIds(query.brandId ? { _id: query.brandId } : {}) },
    };
    const categoryIds = [...(query.categoryId ? [query.categoryId] : []), ...(query.categoryIds ?? [])];
    if (categoryIds.length) {
      const withChildren = await Promise.all(categoryIds.map((id) => this.categories.withChildren(id)));
      filter.categoryId = { $in: withChildren.flat() };
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {
        ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
      };
    }
    if (query.inStock) filter.totalStock = { $gt: 0 };
    if (query.onSale || query.campaignId || query.sort === 'discount') {
      const now = new Date();
      Object.assign(filter, { 'sale.startsAt': { $lte: now }, 'sale.endsAt': { $gt: now } });
      if (query.campaignId) filter['sale.campaignId'] = new Types.ObjectId(query.campaignId);
    }
    if (query.q?.trim()) filter.searchText = new RegExp(escapeRegex(normalizeSearchText(query.q)));

    const sorts: Record<string, Record<string, SortOrder>> = {
      newest: { publishedAt: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      rating: { ratingAvg: -1, ratingCount: -1 },
      popular: { soldCount: -1 },
      discount: { 'sale.percent': -1 },
    };
    const page = await paginate(this.products, filter, query, {
      sort: { ...sorts[query.sort ?? 'newest'], _id: -1 },
      populate: 'brandId',
    });
    return new PageResult(page.items.map((p) => this.toCard(p)), page.page, page.limit, page.total);
  }

  async getPublic(id: string) {
    const product = await this.products
      .findOne({ _id: id, status: ProductStatus.ACTIVE })
      .populate('brandId')
      .lean();
    const brand = product?.brandId as unknown as Parameters<BrandsService['isVisible']>[0] | undefined;
    if (!product || !brand || !this.brands.isVisible(brand)) throw AppError.notFound('Product');
    return {
      ...this.toCard(product),
      description: product.description,
      images: product.images.map((i) => optimizedImage(i.url, IMAGE_WIDTH.full)!),
      /** Same order as images; a colour shows only its own photos (null = every colour). */
      imageColors: product.images.map((i) => i.color ?? null),
      categoryId: product.categoryId.toString(),
      tags: product.tags,
      variants: product.variants.map((v) => ({
        id: v._id.toString(),
        size: v.size ?? null,
        color: v.color ?? null,
        price: salePrice(v.price ?? product.price, activeSalePercent(product.sale)),
        inStock: v.stock > 0,
        // Exact stock helps the quantity picker; capped so competitors can't read inventory precisely.
        available: Math.min(v.stock, 20),
      })),
    };
  }

  // ---------- Helpers ----------

  async ownedOrThrow(brandId: string, id: string): Promise<ProductDocument> {
    const product = await this.products.findOne({ _id: id, brandId: new Types.ObjectId(brandId) });
    if (!product) throw AppError.notFound('Product');
    return product;
  }

  /** No plans any more: only a generous safety cap on published products per store. */
  private async assertCanPublish(brandId: string, excludeId?: Types.ObjectId) {
    const active = await this.products.countDocuments({
      brandId: new Types.ObjectId(brandId),
      status: ProductStatus.ACTIVE,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (active >= MAX_ACTIVE_PRODUCTS) {
      throw AppError.unprocessable('PLAN_LIMIT_REACHED', `Up to ${MAX_ACTIVE_PRODUCTS} published products per store`);
    }
  }

  private assertCompareAtPrice(price: number, compareAt?: number | null) {
    if (compareAt != null && compareAt <= price) {
      throw AppError.unprocessable('INVALID_COMPARE_PRICE', 'compareAtPrice must be greater than price');
    }
  }

  /** Updates listed variants in place (keeping their ids for carts/orders) and adds new ones. */
  private applyVariants(product: ProductDocument, dtos: VariantDto[]) {
    const variants = product.variants as unknown as Types.DocumentArray<Variant>;
    const keep = new Set(dtos.filter((d) => d.id).map((d) => d.id));
    for (const existing of [...variants]) {
      if (!keep.has(existing._id.toString())) variants.pull(existing._id);
    }
    for (const dto of dtos) {
      if (dto.id) {
        const v = variants.id(dto.id);
        if (!v) throw AppError.unprocessable('INVALID_VARIANT', `Variant ${dto.id} does not belong to this product`);
        Object.assign(v, toVariant(dto));
      } else {
        variants.push(toVariant(dto));
      }
    }
    if (!product.variants.length) throw AppError.unprocessable('VARIANT_REQUIRED', 'At least one variant is required');
  }

  private refreshDerived(product: ProductDocument) {
    product.totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
    product.searchText = normalizeSearchText([product.title, ...product.tags].join(' '));
  }

  toCard(p: Lean<Product>) {
    const brand = p.brandId as unknown as { _id: Types.ObjectId; name?: string; slug?: string; logo?: { url: string } };
    // During a sale the old price shows struck through and the countdown uses sale.endsAt.
    const pct = activeSalePercent(p.sale);
    return {
      id: p._id.toString(),
      title: p.title,
      price: salePrice(p.price, pct),
      compareAtPrice: pct ? Math.max(p.price, p.compareAtPrice ?? 0) : p.compareAtPrice,
      sale: pct ? { percent: pct, endsAt: p.sale!.endsAt, campaignId: p.sale!.campaignId?.toString() ?? null } : null,
      imageUrl: optimizedImage(p.images[0]?.url, IMAGE_WIDTH.card),
      inStock: p.totalStock > 0,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      brand: brand?.name
        ? { id: brand._id.toString(), name: brand.name, slug: brand.slug, logoUrl: optimizedImage(brand.logo?.url, IMAGE_WIDTH.logo) }
        : { id: String(p.brandId) },
    };
  }
}

function toVariant(dto: VariantDto) {
  return {
    sku: dto.sku?.trim() || undefined,
    size: dto.size?.trim() || undefined,
    color: dto.color?.trim() || undefined,
    price: dto.price ?? null,
    stock: dto.stock,
  };
}

const cleanColor = (c?: string | null) => c?.trim().slice(0, 30) || null;
