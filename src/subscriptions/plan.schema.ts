import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class PlanLimits {
  @Prop({ required: true, min: 1 })
  maxActiveProducts: number;
}
const PlanLimitsSchema = SchemaFactory.createForClass(PlanLimits);

@Schema({ timestamps: true, collection: 'subscriptionPlans' })
export class SubscriptionPlan {
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ required: true })
  nameAr: string;

  @Prop({ required: true })
  nameEn: string;

  @Prop({ default: '' })
  descriptionAr: string;

  /** EGP. */
  @Prop({ required: true, min: 0 })
  priceMonthly: number;

  @Prop({ required: true, min: 0 })
  priceYearly: number;

  @Prop({ type: PlanLimitsSchema, required: true })
  limits: PlanLimits;

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  sortOrder: number;
}

export type SubscriptionPlanDocument = HydratedDocument<SubscriptionPlan>;
export const SubscriptionPlanSchema = SchemaFactory.createForClass(SubscriptionPlan);
