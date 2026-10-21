import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProductStatus } from '@/common/enums';
import { ImageRefProp } from '@/brands/brand.schema';

/**
 * Every product has at least one variant; a product without sizes/colors has a single default
 * variant. That keeps cart, stock and order logic identical for all products.
 */
@Schema()
export class Variant {
  _id: Types.ObjectId;

  @Prop({ trim: true })
  sku?: string;

  @Prop({ trim: true })
  size?: string;

  @Prop({ trim: true })
  color?: string;

  /** Overrides the product price when set. */
  @Prop({ type: Number, default: null, min: 0 })
  price: number | null;

  @Prop({ required: true, min: 0 })
  stock: number;
}
const VariantSchema = SchemaFactory.createForClass(Variant);

@Schema({ _id: false })
class ProductImage extends ImageRefProp {
  /** The variant colour this photo shows; null = shown for every colour. */
  @Prop({ type: String, default: null })
  color?: string | null;
}
const ProductImageSchema = SchemaFactory.createForClass(ProductImage);

@Schema({ timestamps: true })
export class Product {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [ProductImageSchema], default: [] })
  images: ProductImage[];

  /** EGP. */
  @Prop({ required: true, min: 0 })
  price: number;

  /** Original price shown struck-through when the product is discounted. */
  @Prop({ type: Number, default: null })
  compareAtPrice: number | null;

  /** A time-limited percent off every variant; optionally part of a season (campaign). */
  @Prop({ type: Object, default: null })
  sale: { percent: number; startsAt: Date; endsAt: Date; campaignId?: Types.ObjectId | null } | null;

  /** Wholesale: a minimum per order and cheaper unit prices by quantity (mostly warehouses). */
  @Prop({ type: Object, default: null })
  wholesale: { minQty: number; tiers: { minQty: number; price: number }[] } | null;

  @Prop({ type: [VariantSchema], default: [] })
  variants: Variant[];

  @Prop({ type: String, enum: ProductStatus, default: ProductStatus.DRAFT })
  status: ProductStatus;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: '' })
  searchText: string;

  /** Sum of variant stock, kept in sync for "in stock" filtering. */
  @Prop({ default: 0 })
  totalStock: number;

  @Prop({ default: 0 })
  soldCount: number;

  @Prop({ default: 0 })
  ratingAvg: number;

  @Prop({ default: 0 })
  ratingCount: number;

  @Prop()
  publishedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type ProductDocument = HydratedDocument<Product>;
export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ brandId: 1, status: 1, createdAt: -1 });
ProductSchema.index({ status: 1, categoryId: 1, price: 1 });
ProductSchema.index({ status: 1, publishedAt: -1 });
ProductSchema.index({ searchText: 1 });
