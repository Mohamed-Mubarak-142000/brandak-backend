import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AccountStatus, Role } from '@/common/enums';

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true, unique: true })
  phone: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ type: [String], enum: Role, default: [Role.CUSTOMER] })
  roles: Role[];

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.ACTIVE })
  status: AccountStatus;

  @Prop()
  emailVerifiedAt?: Date;

  @Prop()
  phoneVerifiedAt?: Date;

  /** Soft delete: can't sign in, hidden from admin lists by default; restore unsets it. */
  @Prop()
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deletedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
