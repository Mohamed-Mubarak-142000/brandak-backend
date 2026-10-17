import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, SortOrder, Types } from 'mongoose';
import { BrandStatus, FilePurpose, StoreType } from '@/common/enums';
import { AppError } from '@/common/errors';
import { paginate, PageResult } from '@/common/pagination';
import { escapeRegex, normalizeEgyptPhone, normalizeSearchText, slugify } from '@/common/utils/text';
import { withTransaction } from '@/common/utils/transaction';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { CategoriesService } from '@/categories/categories.service';
import { Env } from '@/config/env';
import { NotificationsService } from '@/notifications/notifications.service';
import { UploadsService } from '@/uploads/uploads.service';
import { Brand, BrandDocument } from './brand.schema';
import { BrandMembersService } from './brand-members.service';
import {
  AdminBrandsQueryDto,
  BrandContactDto,
  BrandsQueryDto,
  CreateBrandApplicationDto,
  UpdateBrandDto,
} from './brands.dto';

const PUBLIC_FIELDS =
  'name slug storeType description logo cover categoryIds contact socialLinks settings ratingAvg ratingCount createdAt';

@Injectable()
export class BrandsService {
  constructor(
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @InjectConnection() private readonly connection: Connection,
    private readonly members: BrandMembersService,
    private readonly categories: CategoriesService,
    private readonly uploads: UploadsService,
    private readonly audit: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** A brand is visible (and can take orders) when approved and its subscription is running. */
  visibleFilter(): FilterQuery<Brand> {
    const graceMs = this.config.get('SUBSCRIPTION_GRACE_DAYS', { infer: true }) * 86_400_000;
    return { status: BrandStatus.ACTIVE, subscriptionEndsAt: { $gt: new Date(Date.now() - graceMs) } };
  }

  isVisible(brand: Pick<Brand, 'status' | 'subscriptionEndsAt'>) {
    const graceMs = this.config.get('SUBSCRIPTION_GRACE_DAYS', { infer: true }) * 86_400_000;
    return (
      brand.status === BrandStatus.ACTIVE &&
      !!brand.subscriptionEndsAt &&
      brand.subscriptionEndsAt.getTime() > Date.now() - graceMs
    );
  }

  async visibleBrandIds(extra: FilterQuery<Brand> = {}): Promise<Types.ObjectId[]> {
    const rows = await this.brands.find({ ...this.visibleFilter(), ...extra }).select('_id').lean();
    return rows.map((r) => r._id);
  }

  // ---------- Owner ----------

  async apply(userId: string, dto: CreateBrandApplicationDto) {
    if (await this.members.findForUser(userId)) {
      throw AppError.conflict('BRAND_EXISTS', 'You already manage a brand');
    }
    const categoryIds = await this.categories.requireActive(dto.categoryIds);
    const [logo] = dto.logoFileId
      ? await this.uploads.imageRefs(userId, [dto.logoFileId], FilePurpose.BRAND_LOGO)
      : [];
    const [cover] = dto.coverFileId
      ? await this.uploads.imageRefs(userId, [dto.coverFileId], FilePurpose.BRAND_COVER)
      : [];
    const slug = await this.uniqueSlug(dto.name);

    return withTransaction(this.connection, async (session) => {
      const [brand] = await this.brands.create(
        [
          {
            ownerUserId: new Types.ObjectId(userId),
            name: dto.name.trim(),
            slug,
            storeType: dto.storeType,
            description: dto.description ?? '',
            categoryIds,
            logo,
            cover,
            contact: this.normalizeContact(dto.contact),
            socialLinks: dto.socialLinks ?? {},
            searchText: normalizeSearchText(dto.name),
          },
        ],
        { session },
      );
      await this.members.addOwner(brand._id, userId, session);
      await this.audit.log(
        { actorId: userId, actorType: 'USER', action: 'BRAND_APPLIED', entityType: 'Brand', entityId: brand._id },
        session,
      );
      return this.toOwnerView(brand);
    });
  }

  async getMine(brandId: string) {
    return this.toOwnerView(await this.getById(brandId));
  }

  async updateMine(userId: string, brandId: string, dto: UpdateBrandDto) {
    const brand = await this.getById(brandId);
    if (brand.status === BrandStatus.SUSPENDED) {
      throw AppError.forbidden('BRAND_SUSPENDED', 'Suspended brands cannot be edited');
    }
    if (dto.name) {
      brand.name = dto.name.trim();
      brand.searchText = normalizeSearchText(dto.name);
    }
    if (dto.storeType) brand.storeType = dto.storeType;
    if (dto.description !== undefined) brand.description = dto.description;
    if (dto.categoryIds) brand.categoryIds = await this.categories.requireActive(dto.categoryIds);
    if (dto.contact) brand.contact = this.normalizeContact(dto.contact);
    if (dto.socialLinks) brand.socialLinks = dto.socialLinks;
    if (dto.logoFileId) {
      [brand.logo] = await this.uploads.imageRefs(userId, [dto.logoFileId], FilePurpose.BRAND_LOGO);
    }
    if (dto.coverFileId) {
      [brand.cover] = await this.uploads.imageRefs(userId, [dto.coverFileId], FilePurpose.BRAND_COVER);
    }
    if (dto.settings) {
      const zones = dto.settings.shippingZones;
      if (zones && new Set(zones.map((z) => z.governorate)).size !== zones.length) {
        throw AppError.unprocessable('DUPLICATE_ZONE', 'Each governorate can appear only once');
      }
      Object.assign(brand.settings, dto.settings);
      brand.markModified('settings');
    }
    await brand.save();
    return this.toOwnerView(brand);
  }

  /** A rejected brand can fix its profile and ask for another review. */
  async resubmit(userId: string, brandId: string) {
    const brand = await this.brands.findOneAndUpdate(
      { _id: brandId, status: BrandStatus.REJECTED },
      { $set: { status: BrandStatus.PENDING_REVIEW }, $unset: { statusReason: 1 } },
      { new: true },
    );
    if (!brand) throw AppError.conflict('INVALID_STATE', 'Only rejected brands can be resubmitted');
    await this.audit.log({ actorId: userId, actorType: 'USER', action: 'BRAND_RESUBMITTED', entityType: 'Brand', entityId: brand._id });
    return this.toOwnerView(brand);
  }

  // ---------- Public ----------

  async listPublic(query: BrandsQueryDto) {
    const filter: FilterQuery<Brand> = this.visibleFilter();
    if (query.categoryId) filter.categoryIds = new Types.ObjectId(query.categoryId);
    if (query.storeType) Object.assign(filter, this.storeTypeFilter(query.storeType));
    if (query.q?.trim()) filter.searchText = new RegExp(escapeRegex(normalizeSearchText(query.q)));
    const sort: Record<string, SortOrder> =
      query.sort === 'rating'
        ? { ratingAvg: -1, ratingCount: -1 }
        : query.sort === 'name'
          ? { name: 1 }
          : { approvedAt: -1, createdAt: -1 };
    const page = await paginate(this.brands, filter, query, { sort, select: PUBLIC_FIELDS });
    return new PageResult(page.items.map((b) => this.toPublicView(b)), page.page, page.limit, page.total);
  }

  async getPublicBySlug(slug: string) {
    const brand = await this.brands.findOne({ slug, ...this.visibleFilter() }).select(PUBLIC_FIELDS).lean();
    if (!brand) throw AppError.notFound('Brand');
    return this.toPublicView(brand);
  }

  // ---------- Admin ----------

  async adminList(query: AdminBrandsQueryDto) {
    const filter: FilterQuery<Brand> = {};
    if (query.status) filter.status = query.status;
    if (query.storeType) Object.assign(filter, this.storeTypeFilter(query.storeType));
    if (query.q?.trim()) filter.searchText = new RegExp(escapeRegex(normalizeSearchText(query.q)));
    const page = await paginate(this.brands, filter, query, { populate: { path: 'ownerUserId', select: 'name email phone' } });
    // Visibility is computed on the server so every client agrees on "now" and the grace period.
    return new PageResult(page.items.map((b) => ({ ...b, isVisible: this.isVisible(b) })), page.page, page.limit, page.total);
  }

  async adminGet(id: string) {
    const brand = await this.brands
      .findById(id)
      .populate('ownerUserId', 'name email phone status')
      .populate('categoryIds', 'nameAr nameEn slug')
      .lean();
    if (!brand) throw AppError.notFound('Brand');
    return { ...brand, isVisible: this.isVisible(brand) };
  }

  approve(adminId: string, id: string) {
    return this.transition(adminId, id, [BrandStatus.PENDING_REVIEW], BrandStatus.ACTIVE, 'BRAND_APPROVED', {
      title: 'تمت الموافقة على متجرك',
      body: 'راجعنا بيانات المتجر ووافقنا عليها. اختار باقتك وابدأ تبيع.',
    });
  }

  reject(adminId: string, id: string, reason: string) {
    return this.transition(adminId, id, [BrandStatus.PENDING_REVIEW], BrandStatus.REJECTED, 'BRAND_REJECTED', {
      title: 'طلب المتجر محتاج تعديلات',
      body: `السبب: ${reason}`,
    }, reason);
  }

  suspend(adminId: string, id: string, reason: string) {
    return this.transition(adminId, id, [BrandStatus.ACTIVE], BrandStatus.SUSPENDED, 'BRAND_SUSPENDED', {
      title: 'تم إيقاف المتجر',
      body: `السبب: ${reason}`,
    }, reason);
  }

  reinstate(adminId: string, id: string) {
    return this.transition(adminId, id, [BrandStatus.SUSPENDED], BrandStatus.ACTIVE, 'BRAND_REINSTATED', {
      title: 'تمت إعادة تفعيل المتجر',
      body: 'تقدر تكمّل البيع على دكاكين.',
    });
  }

  // ---------- Helpers ----------

  async getById(id: string | Types.ObjectId): Promise<BrandDocument> {
    const brand = await this.brands.findById(id);
    if (!brand) throw AppError.notFound('Brand');
    return brand;
  }

  private async transition(
    adminId: string,
    id: string,
    from: BrandStatus[],
    to: BrandStatus,
    action: string,
    message: { title: string; body: string },
    reason?: string,
  ) {
    const update: Record<string, unknown> = { $set: { status: to, ...(reason ? { statusReason: reason } : {}) } };
    if (!reason) update.$unset = { statusReason: 1 };
    if (to === BrandStatus.ACTIVE && from.includes(BrandStatus.PENDING_REVIEW)) {
      (update.$set as Record<string, unknown>).approvedAt = new Date();
    }
    const brand = await withTransaction(this.connection, async (session) => {
      const updated = await this.brands.findOneAndUpdate({ _id: id, status: { $in: from } }, update, {
        new: true,
        session,
      });
      if (!updated) {
        const exists = await this.brands.exists({ _id: id }).session(session);
        if (!exists) throw AppError.notFound('Brand');
        throw AppError.conflict('INVALID_STATE', `Brand must be ${from.join(' or ')} to do this`);
      }
      await this.audit.log(
        { actorId: adminId, actorType: 'ADMIN', action, entityType: 'Brand', entityId: updated._id, data: reason ? { reason } : undefined },
        session,
      );
      return updated;
    });
    await this.notifications.notify(await this.members.memberUserIds(brand._id), {
      type: action,
      ...message,
      data: { brandId: brand.id },
    });
    return this.toOwnerView(brand);
  }

  private async uniqueSlug(name: string) {
    const base = slugify(name) || 'brand';
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      if (!(await this.brands.exists({ slug: candidate }))) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private normalizeContact(contact: BrandContactDto) {
    const phone = normalizeEgyptPhone(contact.phone);
    if (!phone) {
      throw AppError.unprocessable('INVALID_PHONE', 'Enter a valid Egyptian mobile number', [
        { field: 'contact.phone', reason: 'invalid_egypt_mobile' },
      ]);
    }
    const whatsapp = contact.whatsapp ? normalizeEgyptPhone(contact.whatsapp) : undefined;
    if (contact.whatsapp && !whatsapp) {
      throw AppError.unprocessable('INVALID_PHONE', 'Enter a valid WhatsApp number', [
        { field: 'contact.whatsapp', reason: 'invalid_egypt_mobile' },
      ]);
    }
    return { phone, email: contact.email?.toLowerCase(), whatsapp: whatsapp ?? undefined };
  }

  /** Stores created before storeType existed have no value and count as BRAND. */
  private storeTypeFilter(type: StoreType): FilterQuery<Brand> {
    return type === StoreType.BRAND ? { storeType: { $in: [StoreType.BRAND, null] } } : { storeType: type };
  }

  toOwnerView(brand: Brand & { _id: Types.ObjectId }) {
    return {
      id: brand._id.toString(),
      name: brand.name,
      slug: brand.slug,
      storeType: brand.storeType ?? StoreType.BRAND,
      description: brand.description,
      logoUrl: brand.logo?.url ?? null,
      coverUrl: brand.cover?.url ?? null,
      categoryIds: brand.categoryIds.map(String),
      status: brand.status,
      statusReason: brand.statusReason ?? null,
      contact: brand.contact ?? {},
      socialLinks: brand.socialLinks ?? {},
      settings: brand.settings,
      subscriptionEndsAt: brand.subscriptionEndsAt,
      isVisible: this.isVisible(brand),
      ratingAvg: brand.ratingAvg,
      ratingCount: brand.ratingCount,
      createdAt: brand.createdAt,
    };
  }

  toPublicView(brand: Partial<Brand> & { _id: Types.ObjectId }) {
    const s = brand.settings;
    return {
      id: brand._id.toString(),
      name: brand.name,
      slug: brand.slug,
      // .lean() reads skip schema defaults; stores older than storeType are brands.
      storeType: brand.storeType ?? StoreType.BRAND,
      description: brand.description,
      logoUrl: brand.logo?.url ?? null,
      coverUrl: brand.cover?.url ?? null,
      categoryIds: (brand.categoryIds ?? []).map(String),
      contact: brand.contact ?? {},
      socialLinks: brand.socialLinks ?? {},
      shipping: s && {
        zones: s.shippingZones,
        defaultFee: s.defaultShippingFee,
        freeShippingThreshold: s.freeShippingThreshold,
        minOrderAmount: s.minOrderAmount,
        processingDays: s.processingDays,
        shippingPolicy: s.shippingPolicy,
        returnPolicy: s.returnPolicy,
        acceptsOrders: s.acceptsOrders,
      },
      ratingAvg: brand.ratingAvg,
      ratingCount: brand.ratingCount,
    };
  }
}
