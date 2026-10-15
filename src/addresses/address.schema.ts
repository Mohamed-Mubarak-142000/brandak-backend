import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point' })
  type: 'Point';

  /** [longitude, latitude] — GeoJSON order. */
  @Prop({ type: [Number], required: true })
  coordinates: [number, number];
}
const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

@Schema({ timestamps: true })
export class Address {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ default: '' })
  label: string;

  @Prop({ required: true })
  recipientName: string;

  @Prop({ required: true })
  phone: string;

  @Prop({ required: true })
  governorate: string;

  @Prop({ required: true })
  city: string;

  @Prop({ default: '' })
  area: string;

  @Prop({ required: true })
  street: string;

  @Prop({ default: '' })
  building: string;

  @Prop({ default: '' })
  floor: string;

  @Prop({ default: '' })
  apartment: string;

  @Prop({ default: '' })
  landmark: string;

  /** Pin chosen on the map. Optional: the text address is what couriers rely on. */
  @Prop({ type: GeoPointSchema })
  location?: GeoPoint;

  @Prop({ default: false })
  isDefault: boolean;
}

export type AddressDocument = HydratedDocument<Address>;
export const AddressSchema = SchemaFactory.createForClass(Address);
AddressSchema.index({ userId: 1, createdAt: -1 });
AddressSchema.index({ location: '2dsphere' }, { sparse: true });
