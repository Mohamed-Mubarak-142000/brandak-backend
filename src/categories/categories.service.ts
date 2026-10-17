import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { StoreType } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Category } from './category.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

@Injectable()
export class CategoriesService {
  constructor(@InjectModel(Category.name) private readonly categories: Model<Category>) {}

  /** Active categories; with a store type, only those offered to it (plus the ones for every type). */
  listActive(storeType?: StoreType) {
    const filter: FilterQuery<Category> = { isActive: true };
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
    const updated = await this.categories.findByIdAndUpdate(id, dto, { new: true });
    if (!updated) throw AppError.notFound('Category');
    return updated;
  }

  /** Throws unless every id is an existing, active category. */
  async requireActive(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.some((id) => !Types.ObjectId.isValid(id))) throw this.invalid();
    const count = await this.categories.countDocuments({ _id: { $in: unique }, isActive: true });
    if (count !== unique.length) throw this.invalid();
    return unique.map((id) => new Types.ObjectId(id));
  }

  /** The category plus its direct children, so filtering by a parent includes sub-categories. */
  async withChildren(id: string): Promise<Types.ObjectId[]> {
    const children = await this.categories.find({ parentId: new Types.ObjectId(id) }).select('_id').lean();
    return [new Types.ObjectId(id), ...children.map((c) => c._id)];
  }

  private invalid() {
    return AppError.unprocessable('INVALID_CATEGORY', 'Unknown or inactive category');
  }
}
