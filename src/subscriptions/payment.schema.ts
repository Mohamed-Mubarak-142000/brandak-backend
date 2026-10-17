import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PaymentMethod, PaymentStatus } from '@/common/enums';

@Schema({ _id: false, timestamps: false })
export class ProofAttempt {
  @Prop({ type: Types.ObjectId, required: true }) proofFileId: Types.ObjectId;
  @Prop({ required: true }) transactionReference: string;
  @Prop() senderName?: string;
  @Prop({ required: true }) submittedAt: Date;
  @Prop() rejectedAt?: Date;
  @Prop() rejectionReason?: string;
}
const ProofAttemptSchema = SchemaFactory.createForClass(ProofAttempt);

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Brand', required: true })
  brandId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Subscription', required: true, unique: true })
  subscriptionId: Types.ObjectId;

  /** Copied from the subscription's plan snapshot — never taken from a client request. */
  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ default: 'EGP' })
  currency: string;

  @Prop({ type: String, enum: PaymentMethod, required: true })
  method: PaymentMethod;

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.AWAITING_PROOF })
  status: PaymentStatus;

  @Prop({ type: Types.ObjectId, ref: 'StoredFile' })
  proofFileId?: Types.ObjectId;

  @Prop()
  transactionReference?: string;

  @Prop()
  transactionReferenceNormalized?: string;

  @Prop()
  senderName?: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  submittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewedAt?: Date;

  @Prop()
  reviewNote?: string;

  @Prop()
  rejectionReason?: string;

  /** Earlier rejected submissions, kept for the audit trail. */
  @Prop({ type: [ProofAttemptSchema], default: [] })
  previousAttempts: ProofAttempt[];

  /** Soft delete: hidden from every list and stat; restore unsets it. */
  @Prop()
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deletedBy?: Types.ObjectId;

  createdAt: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ status: 1, createdAt: -1 });
PaymentSchema.index({ brandId: 1, createdAt: -1 });
// One InstaPay transfer can back exactly one approved payment.
PaymentSchema.index(
  { transactionReferenceNormalized: 1 },
  { unique: true, partialFilterExpression: { status: PaymentStatus.APPROVED }, name: 'uniq_approved_reference' },
);
