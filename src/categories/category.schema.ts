import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { StoreType } from '@/common/enums';

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

  @Prop()
  icon?: string;

  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ default: true })
  isActive: boolean;

  /** Store types this category is offered to. Empty = every type (admin-created and legacy categories). */
  @Prop({ type: [String], enum: StoreType, default: [] })
  storeTypes: StoreType[];
}

export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.index({ parentId: 1, sortOrder: 1 });
CategorySchema.index({ storeTypes: 1 });
