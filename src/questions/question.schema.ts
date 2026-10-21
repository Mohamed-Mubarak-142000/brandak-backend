import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** A customer's question on a product; public once the store answers it. */
@Schema({ timestamps: true, collection: 'questions' })
export class Question {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** First name only, shown publicly. */
  @Prop({ required: true })
  userName: string;

  @Prop({ required: true, trim: true })
  text: string;

  @Prop({ type: String, default: null })
  answer: string | null;

  @Prop({ type: Date, default: null })
  answeredAt: Date | null;

  /** Hidden by an admin (spam, abuse). */
  @Prop({ default: false })
  hidden: boolean;

  createdAt: Date;
}
export const QuestionSchema = SchemaFactory.createForClass(Question);
QuestionSchema.index({ productId: 1, answeredAt: -1 });
QuestionSchema.index({ brandId: 1, answeredAt: 1, createdAt: -1 });
