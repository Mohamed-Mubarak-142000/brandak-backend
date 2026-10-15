import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReportStatus, ReportTarget, ReviewStatus } from '@/common/enums';

@Schema({ timestamps: true })
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Display name at the time of writing. */
  @Prop({ required: true })
  userName: string;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  /** The delivered order that makes this a verified purchase. */
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ default: '' })
  comment: string;

  @Prop({ type: String, enum: ReviewStatus, default: ReviewStatus.VISIBLE })
  status: ReviewStatus;

  createdAt: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ userId: 1, productId: 1, orderId: 1 }, { unique: true });
ReviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ brandId: 1, status: 1 });

@Schema({ timestamps: true })
export class Report {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: ReportTarget, required: true })
  targetType: ReportTarget;

  @Prop({ type: Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ required: true })
  reason: string;

  @Prop({ default: '' })
  details: string;

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.OPEN })
  status: ReportStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop()
  resolutionNote?: string;

  createdAt: Date;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ status: 1, createdAt: -1 });
// A user can have only one open report per target.
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: ReportStatus.OPEN } },
);
