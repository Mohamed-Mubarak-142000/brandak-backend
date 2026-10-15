import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, SortOrder, Types } from 'mongoose';
import { FilePurpose, ProductStatus } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, paginate, PageResult } from '@/common/pagination';
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

/** Safety cap on unpublished drafts so a brand without a plan can't fill the database. */
const MAX_TOTAL_PRODUCTS = 1000;

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly brands: BrandsService,
    private readonly categories: CategoriesService,
    private readonly subscriptions: SubscriptionsService,
    private readonly uploads: UploadsService,
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
      images: await this.uploads.imageRefs(userId, dto.imageFileIds, FilePurpose.PRODUCT_IMAGE),
      price: dto.price,
      compareAtPrice: dto.compareAtPrice ?? null,
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
    this.assertCompareAtPrice(product.price, product.compareAtPrice);
    if (dto.tags) product.tags = dto.tags;
    if (dto.imageFileIds) {
      product.images = await this.uploads.imageRefs(userId, dto.imageFileIds, FilePurpose.PRODUCT_IMAGE);
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
    if (query.categoryId) filter.categoryId = { $in: await this.categories.withChildren(query.categoryId) };
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {
        ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
      };
    }
    if (query.inStock) filter.totalStock = { $gt: 0 };
    if (query.q?.trim()) filter.searchText = new RegExp(escapeRegex(normalizeSearchText(query.q)));

    const sorts: Record<string, Record<string, SortOrder>> = {
      newest: { publishedAt: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      rating: { ratingAvg: -1, ratingCount: -1 },
      popular: { soldCount: -1 },
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
      images: product.images.map((i) => i.url),
      categoryId: product.categoryId.toString(),
      tags: product.tags,
      variants: product.variants.map((v) => ({
        id: v._id.toString(),
        size: v.size ?? null,
        color: v.color ?? null,
        price: v.price ?? product.price,
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

  private async assertCanPublish(brandId: string, excludeId?: Types.ObjectId) {
    const current = await this.subscriptions.currentFor(brandId);
    if (!current) {
      throw AppError.forbidden('SUBSCRIPTION_REQUIRED', 'An active subscription is required to publish products');
    }
    const active = await this.products.countDocuments({
      brandId: new Types.ObjectId(brandId),
      status: ProductStatus.ACTIVE,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    const max = current.planSnapshot.limits.maxActiveProducts;
    if (active >= max) {
      throw AppError.unprocessable('PLAN_LIMIT_REACHED', `Your plan allows up to ${max} published products`);
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
    return {
      id: p._id.toString(),
      title: p.title,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      imageUrl: p.images[0]?.url ?? null,
      inStock: p.totalStock > 0,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
      brand: brand?.name
        ? { id: brand._id.toString(), name: brand.name, slug: brand.slug, logoUrl: brand.logo?.url ?? null }
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
