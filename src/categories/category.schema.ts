import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { StoreType } from '@/common/enums';
import { CategoryTemplate } from './category-template';

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true, trim: true })
  nameAr: string;

  @Prop({ required: true, trim: true })
  nameEn: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', default: null })
  parentId: Types.ObjectId | null;

  /** 0 = top-level section, 1 = category, 2 = sub-category. Kept in sync with parentId. */
  @Prop({ default: 0, min: 0, max: 2 })
  level: number;

  /** Parents from the top down, so "everything under X" is one indexed query. */
  @Prop({ type: [Types.ObjectId], default: [] })
  ancestors: Types.ObjectId[];

  /** What a product here asks for; inherited by sub-categories (see category-template.ts). */
  @Prop({ type: Object, default: null })
  template: CategoryTemplate | null;

  @Prop()
  icon?: string;

  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ default: true })
  isActive: boolean;

  /** Store types this category is offered to. Empty = every type (admin-created and legacy categories). */
  @Prop({ type: [String], enum: StoreType, default: [] })
  storeTypes: StoreType[];

  /** Soft delete (also deactivates); restore unsets it and reactivates. */
  @Prop()
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deletedBy?: Types.ObjectId;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.index({ parentId: 1, sortOrder: 1 });
CategorySchema.index({ storeTypes: 1 });
CategorySchema.index({ ancestors: 1 });
