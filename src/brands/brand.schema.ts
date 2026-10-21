import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BrandStatus, StoreType } from '@/common/enums';

@Schema({ _id: false })
export class ImageRefProp {
  @Prop({ type: Types.ObjectId, required: true })
  fileId: Types.ObjectId;

  @Prop({ required: true })
  url: string;
}
const ImageRefSchema = SchemaFactory.createForClass(ImageRefProp);

@Schema({ _id: false })
export class ShippingZone {
  @Prop({ required: true })
  governorate: string;

  @Prop({ required: true, min: 0 })
  fee: number;
}
const ShippingZoneSchema = SchemaFactory.createForClass(ShippingZone);

@Schema({ _id: false })
export class BrandSettings {
  /** Per-governorate delivery fee. Governorates not listed fall back to `defaultShippingFee`. */
  @Prop({ type: [ShippingZoneSchema], default: [] })
  shippingZones: ShippingZone[];

  /** Fee for governorates without a zone; null means the brand does not deliver there. */
  @Prop({ type: Number, default: null })
  defaultShippingFee: number | null;

  @Prop({ type: Number, default: null })
  freeShippingThreshold: number | null;

  @Prop({ default: 0 })
  minOrderAmount: number;

  @Prop({ default: 3 })
  processingDays: number;

  @Prop({ default: '' })
  shippingPolicy: string;

  @Prop({ default: '' })
  returnPolicy: string;

  /** Days after delivery a customer can ask to return items; 0 means no returns. */
  @Prop({ default: 14, min: 0, max: 30 })
  returnDays: number;

  /** Customers may collect orders from the store/showroom instead of delivery (no shipping fee). */
  @Prop({ type: Object, default: () => ({ enabled: false, address: '', governorate: null, hours: '', mapUrl: '' }) })
  pickup: { enabled: boolean; address: string; governorate: string | null; hours: string; mapUrl: string };

  /** Lets an owner pause new orders (e.g. on holiday) without hiding the store. */
  @Prop({ default: true })
  acceptsOrders: boolean;
}
const BrandSettingsSchema = SchemaFactory.createForClass(BrandSettings);

@Schema({ timestamps: true })
export class Brand {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerUserId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: ImageRefSchema })
  logo?: ImageRefProp;

  @Prop({ type: ImageRefSchema })
  cover?: ImageRefProp;

  @Prop({ type: [Types.ObjectId], ref: 'Category', default: [] })
  categoryIds: Types.ObjectId[];

  @Prop({ type: String, enum: BrandStatus, default: BrandStatus.PENDING_REVIEW })
  status: BrandStatus;

  @Prop({ type: String, enum: StoreType, default: StoreType.BRAND })
  storeType: StoreType;

  @Prop()
  statusReason?: string;

  @Prop({ type: Object, default: {} })
  contact: { phone?: string; email?: string; whatsapp?: string };

  @Prop({ type: Object, default: {} })
  socialLinks: { instagram?: string; facebook?: string; tiktok?: string; website?: string };

  @Prop({ type: BrandSettingsSchema, default: () => ({}) })
  settings: BrandSettings;

  /** Denormalized end of the latest paid period. Kept for history; commission replaced plans. */
  @Prop({ type: Date, default: null })
  subscriptionEndsAt: Date | null;

  /** Since when the store has owed commission (null = owes nothing). Drives the order block. */
  @Prop({ type: Date, default: null })
  commissionDueSince: Date | null;

  /** Buyer-protection cases decided against the store. Too many suspend it. */
  @Prop({ default: 0 })
  protectionStrikes: number;

  @Prop({ default: '' })
  searchText: string;

  @Prop({ default: 0 })
  ratingAvg: number;

  @Prop({ default: 0 })
  ratingCount: number;

  @Prop()
  approvedAt?: Date;

  /** Soft delete: hidden everywhere except the admin "deleted" filter; restore unsets it. */
  @Prop()
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deletedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type BrandDocument = HydratedDocument<Brand>;
export const BrandSchema = SchemaFactory.createForClass(Brand);
BrandSchema.index({ status: 1, subscriptionEndsAt: 1 });
BrandSchema.index({ categoryIds: 1, status: 1 });
BrandSchema.index({ storeType: 1, status: 1 });
BrandSchema.index({ searchText: 1 });
