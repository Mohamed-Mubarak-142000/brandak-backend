import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { StoreType } from '@/common/enums';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { AppError } from '@/common/errors';
import { Lean } from '@/common/pagination';
import { Category } from './category.schema';
import { CategoryTemplate, resolveTemplate, ResolvedTemplate, SIZE_PRESETS, UNITS } from './category-template';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

/** Top-level section, category, sub-category. */
const MAX_LEVEL = 2;
/** The tree is small and read on every product save; a short in-memory copy saves a query each time. */
const CACHE_MS = 60_000;

@Injectable()
export class CategoriesService {
  private cache: { at: number; byId: Map<string, Lean<Category>> } | null = null;

  constructor(
    @InjectModel(Category.name) private readonly categories: Model<Category>,
    private readonly audit: AuditLogsService,
  ) {}

  /** Active categories; with a store type, only those offered to it (plus the ones for every type). */
  listActive(storeType?: StoreType) {
    const filter: FilterQuery<Category> = { isActive: true, deletedAt: null };
    if (storeType) {
      filter.$or = [{ storeTypes: storeType }, { storeTypes: { $size: 0 } }, { storeTypes: { $exists: false } }];
    }
    return this.categories.find(filter).sort({ level: 1, sortOrder: 1, nameEn: 1 }).lean();
  }

  listAll() {
    return this.categories.find().sort({ level: 1, sortOrder: 1, nameEn: 1 }).lean();
  }

  /** Reference data for the admin template editor. */
  presets() {
    return { sizes: SIZE_PRESETS, units: UNITS };
  }

  async create(dto: CreateCategoryDto) {
    const placement = await this.placement(dto.parentId ?? null);
    assertTemplate(dto.template);
    // Sub-categories are offered to the same store types as their section.
    const storeTypes = placement.ancestors.length ? await this.rootTypes(placement.ancestors[0]) : (dto.storeTypes ?? []);
    const created = await this.categories.create({ ...dto, ...placement, storeTypes, template: dto.template ?? null });
    this.cache = null;
    return created;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    if (dto.parentId === id) throw AppError.unprocessable('INVALID_PARENT', 'A category cannot be its own parent');
    assertTemplate(dto.template);
    // A deleted category is edited only after it is restored.
    const current = await this.categories.findOne({ _id: id, deletedAt: null });
    if (!current) throw AppError.notFound('Category');

    const { parentId, ...rest } = dto;
    const moving = parentId !== undefined && String(parentId ?? '') !== String(current.parentId ?? '');
    if (moving) {
      const placement = await this.placement(parentId ?? null);
      if (placement.ancestors.some((a) => a.equals(current._id))) {
        throw AppError.unprocessable('INVALID_PARENT', 'A category cannot move under its own sub-category');
      }
      const depth = await this.subtreeDepth(current._id);
      if (placement.level + depth > MAX_LEVEL) {
        throw AppError.unprocessable('TOO_DEEP', `Categories go at most ${MAX_LEVEL + 1} levels deep`);
      }
      Object.assign(current, placement);
    }
    Object.assign(current, rest);
    await current.save();
    if (moving) await this.rebuildBelow(current._id, current.ancestors, current.level);
    if (moving || dto.storeTypes) await this.cascadeTypes(current.ancestors[0] ?? current._id);
    this.cache = null;
    return current.toObject();
  }

  /** Throws unless every id is an existing, active category. */
  async requireActive(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !Types.ObjectId.isValid(id))) throw this.invalid();
    const count = await this.categories.countDocuments({ _id: { $in: unique }, isActive: true, deletedAt: null });
    if (count !== unique.length) throw this.invalid();
    return unique.map((id) => new Types.ObjectId(id));
  }

  /**
   * The category a product is filed under: active, offered to the store's type, under one of
   * the store's chosen sections, and with no sub-categories left to choose from.
   */
  async requireProductCategory(id: string, store: { storeType?: StoreType | null; categoryIds?: Types.ObjectId[] }) {
    const byId = await this.snapshot();
    const cat = Types.ObjectId.isValid(id) ? byId.get(id) : undefined;
    if (!cat || !cat.isActive || cat.deletedAt) throw this.invalid();
    if (cat.storeTypes?.length && store.storeType && !cat.storeTypes.includes(store.storeType)) {
      throw AppError.unprocessable('CATEGORY_NOT_FOR_STORE_TYPE', 'This category is not offered to your kind of store');
    }
    const path = [...(cat.ancestors ?? []), cat._id].map(String);
    const own = (store.categoryIds ?? []).map(String);
    // Categories for every store type ("Other") stay open to all stores.
    if (own.length && cat.storeTypes?.length && !path.some((p) => own.includes(p))) {
      throw AppError.unprocessable('CATEGORY_NOT_IN_STORE', 'Pick a category under your store\'s sections, or add the section in store settings');
    }
    const hasChildren = [...byId.values()].some((c) => c.isActive && !c.deletedAt && String(c.parentId) === id);
    if (hasChildren) throw AppError.unprocessable('CATEGORY_NOT_LEAF', 'Pick a more specific sub-category');
    return cat._id;
  }

  /** The product template for a category, after inheritance and the store type's own fields. */
  async template(id: string, storeType?: StoreType | null): Promise<ResolvedTemplate> {
    const byId = await this.snapshot();
    const cat = byId.get(String(id));
    if (!cat) throw AppError.notFound('Category');
    const chain = [...(cat.ancestors ?? []), cat._id].map((a) => byId.get(String(a))?.template);
    return resolveTemplate(chain, storeType);
  }

  /** Arabic names from the top down ("ملابس › رجالي › تيشيرتات"). */
  async pathName(id: string) {
    const byId = await this.snapshot();
    const cat = byId.get(String(id));
    if (!cat) return '';
    return [...(cat.ancestors ?? []), cat._id].map((a) => byId.get(String(a))?.nameAr ?? '').filter(Boolean).join(' › ');
  }

  /** Soft delete: hidden from stores and customers. Refused while it still has live sub-categories. */
  async softDelete(adminId: string, id: string) {
    if (await this.categories.exists({ parentId: new Types.ObjectId(id), deletedAt: null })) {
      throw AppError.conflict('HAS_CHILDREN', 'Delete or move the sub-categories first');
    }
    const cat = await this.categories.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), deletedBy: new Types.ObjectId(adminId), isActive: false } },
      { new: true },
    );
    if (!cat) return this.stateError(id, true);
    this.cache = null;
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'CATEGORY_DELETED', entityType: 'Category', entityId: cat._id });
    return cat;
  }

  async restore(adminId: string, id: string) {
    const cat = await this.categories.findOneAndUpdate(
      { _id: id, deletedAt: { $ne: null } },
      { $unset: { deletedAt: 1, deletedBy: 1 }, $set: { isActive: true } },
      { new: true },
    );
    if (!cat) return this.stateError(id, false);
    this.cache = null;
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'CATEGORY_RESTORED', entityType: 'Category', entityId: cat._id });
    return cat;
  }

  private async stateError(id: string, deleting: boolean): Promise<never> {
    if (!(await this.categories.exists({ _id: id }))) throw AppError.notFound('Category');
    throw AppError.conflict('INVALID_STATE', deleting ? 'Category is already deleted' : 'Category is not deleted');
  }

  /** The category plus everything under it, so filtering by a section includes all its sub-categories. */
  async withChildren(id: string): Promise<Types.ObjectId[]> {
    const oid = new Types.ObjectId(id);
    const below = await this.categories.find({ $or: [{ ancestors: oid }, { parentId: oid }] }).select('_id').lean();
    return [oid, ...below.map((c) => c._id)];
  }

  /**
   * Categories a store can file products under — the ends of the tree below its sections — named
   * with their path so the AI (and people) can tell "رجالي › تيشيرتات" from "حريمي › تيشيرتات".
   */
  async activeWithChildren(ids: Types.ObjectId[], storeType?: StoreType | null) {
    const byId = await this.snapshot();
    const live = [...byId.values()].filter((c) => c.isActive && !c.deletedAt);
    const own = new Set(ids.map(String));
    const parents = new Set(live.map((c) => String(c.parentId)));
    const rows = live.filter(
      (c) =>
        !parents.has(String(c._id)) &&
        (!storeType || !c.storeTypes?.length || c.storeTypes.includes(storeType)) &&
        [...(c.ancestors ?? []), c._id].some((a) => own.has(String(a))),
    );
    return Promise.all(rows.map(async (c) => ({ id: c._id.toString(), name: await this.pathName(c._id.toString()) })));
  }

  private async snapshot() {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const rows = await this.categories.find().lean();
      this.cache = { at: Date.now(), byId: new Map(rows.map((r) => [r._id.toString(), r as Lean<Category>])) };
    }
    return this.cache.byId;
  }

  /** Where a category sits when filed under `parentId`. */
  private async placement(parentId: string | null) {
    if (!parentId) return { parentId: null, level: 0, ancestors: [] as Types.ObjectId[] };
    const parent = await this.categories.findOne({ _id: parentId, isActive: true, deletedAt: null }).lean();
    if (!parent) throw this.invalid();
    if ((parent.level ?? 0) >= MAX_LEVEL) {
      throw AppError.unprocessable('TOO_DEEP', `Categories go at most ${MAX_LEVEL + 1} levels deep`);
    }
    return { parentId: parent._id, level: (parent.level ?? 0) + 1, ancestors: [...(parent.ancestors ?? []), parent._id] };
  }

  /** Levels below a category (0 when it has no sub-categories). */
  private async subtreeDepth(id: Types.ObjectId): Promise<number> {
    const children = await this.categories.find({ parentId: id }).select('_id').lean();
    if (!children.length) return 0;
    const depths = await Promise.all(children.map((c) => this.subtreeDepth(c._id)));
    return 1 + Math.max(...depths);
  }

  private async rootTypes(rootId: Types.ObjectId) {
    return (await this.categories.findById(rootId).select('storeTypes').lean())?.storeTypes ?? [];
  }

  /** A section's store types apply to everything under it. */
  private async cascadeTypes(rootId: Types.ObjectId) {
    await this.categories.updateMany({ ancestors: rootId }, { $set: { storeTypes: await this.rootTypes(rootId) } });
  }

  /** After a move, children take their new place in the tree. */
  private async rebuildBelow(id: Types.ObjectId, ancestors: Types.ObjectId[], level: number) {
    const children = await this.categories.find({ parentId: id }).select('_id').lean();
    for (const child of children) {
      const childAncestors = [...ancestors, id];
      await this.categories.updateOne({ _id: child._id }, { $set: { ancestors: childAncestors, level: level + 1 } });
      await this.rebuildBelow(child._id, childAncestors, level + 1);
    }
  }

  private invalid() {
    return AppError.unprocessable('INVALID_CATEGORY', 'Unknown or inactive category');
  }
}

function assertTemplate(t?: CategoryTemplate | null) {
  if (!t) return;
  const keys = (t.specs ?? []).map((s) => s.key);
  if (new Set(keys).size !== keys.length) throw AppError.unprocessable('INVALID_TEMPLATE', 'Each field needs its own key');
  const emptySelect = t.specs?.find((s) => s.type === 'select' && !s.options?.length);
  if (emptySelect) throw AppError.unprocessable('INVALID_TEMPLATE', `«${emptySelect.labelAr}» needs at least one choice`);
}
