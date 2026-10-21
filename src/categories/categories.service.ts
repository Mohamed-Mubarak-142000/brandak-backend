import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { StoreType } from '@/common/enums';
import { AuditLogsService } from '@/audit-logs/audit-logs.service';
import { AppError } from '@/common/errors';
import { Category } from './category.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

@Injectable()
export class CategoriesService {
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
    return this.categories.find(filter).sort({ sortOrder: 1, nameEn: 1 }).lean();
  }

  listAll() {
    return this.categories.find().sort({ sortOrder: 1, nameEn: 1 }).lean();
  }

  async create(dto: CreateCategoryDto) {
    if (dto.parentId) await this.requireActive([dto.parentId]);
    return this.categories.create({ ...dto, parentId: dto.parentId ? new Types.ObjectId(dto.parentId) : null });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    if (dto.parentId === id) throw AppError.unprocessable('INVALID_PARENT', 'A category cannot be its own parent');
    // A deleted category is edited only after it is restored.
    const updated = await this.categories.findOneAndUpdate({ _id: id, deletedAt: null }, dto, { new: true });
    if (!updated) throw AppError.notFound('Category');
    return updated;
  }

  /** Throws unless every id is an existing, active category. */
  async requireActive(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !Types.ObjectId.isValid(id))) throw this.invalid();
    const count = await this.categories.countDocuments({ _id: { $in: unique }, isActive: true, deletedAt: null });
    if (count !== unique.length) throw this.invalid();
    return unique.map((id) => new Types.ObjectId(id));
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
    await this.audit.log({ actorId: adminId, actorType: 'ADMIN', action: 'CATEGORY_RESTORED', entityType: 'Category', entityId: cat._id });
    return cat;
  }

  private async stateError(id: string, deleting: boolean): Promise<never> {
    if (!(await this.categories.exists({ _id: id }))) throw AppError.notFound('Category');
    throw AppError.conflict('INVALID_STATE', deleting ? 'Category is already deleted' : 'Category is not deleted');
  }

  /** The category plus its direct children, so filtering by a parent includes sub-categories. */
  async withChildren(id: string): Promise<Types.ObjectId[]> {
    const children = await this.categories.find({ parentId: new Types.ObjectId(id) }).select('_id').lean();
    return [new Types.ObjectId(id), ...children.map((c) => c._id)];
  }

  /** Active categories among `ids` and their children, with Arabic names (for AI suggestions). */
  async activeWithChildren(ids: Types.ObjectId[]) {
    return this.categories
      .find({ isActive: true, deletedAt: null, $or: [{ _id: { $in: ids } }, { parentId: { $in: ids } }] })
      .select('nameAr')
      .lean()
      .then((rows) => rows.map((c) => ({ id: c._id.toString(), name: c.nameAr })));
  }

  private invalid() {
    return AppError.unprocessable('INVALID_CATEGORY', 'Unknown or inactive category');
  }
}
