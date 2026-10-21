import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum AdPlacement {
  /** First results when customers search. */
  SEARCH_TOP = 'SEARCH_TOP',
  /** First products in the product's category. */
  CATEGORY_TOP = 'CATEGORY_TOP',
  /** The "featured" rail on the home screen. */
  HOME_BANNER = 'HOME_BANNER',
}

export enum AdStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
}

/** A paid placement for a product, bought with an InstaPay transfer the admin reviews. */
@Schema({ timestamps: true, collection: 'ads' })
export class Ad {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true, index: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  /** The product's category when bought (for CATEGORY_TOP matching). */
  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  @Prop({ type: String, enum: AdPlacement, required: true })
  placement: AdPlacement;

  @Prop({ required: true, min: 1, max: 4 })
  weeks: number;

  @Prop({ required: true })
  price: number;

  @Prop({ type: Types.ObjectId, ref: 'StoredFile', required: true })
  proofFileId: Types.ObjectId;

  @Prop({ required: true })
  transactionReference: string;

  @Prop({ required: true, index: true })
  transactionReferenceNormalized: string;

  @Prop({ type: String, enum: AdStatus, default: AdStatus.PENDING_REVIEW })
  status: AdStatus;

  @Prop({ type: Date, default: null })
  startsAt: Date | null;

  @Prop({ type: Date, default: null })
  endsAt: Date | null;

  @Prop({ type: String, default: null })
  rejectReason: string | null;

  @Prop({ default: 0 })
  impressions: number;

  @Prop({ default: 0 })
  clicks: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  submittedBy: Types.ObjectId;

  createdAt: Date;
}
export const AdSchema = SchemaFactory.createForClass(Ad);
AdSchema.index({ placement: 1, status: 1, endsAt: 1 });
