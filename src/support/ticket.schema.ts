import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum TicketType {
  /** Buyer protection: the order never arrived. */
  NOT_RECEIVED = 'NOT_RECEIVED',
  /** Buyer protection: the product is different from its photos/description. */
  NOT_AS_DESCRIBED = 'NOT_AS_DESCRIBED',
  ORDER_PROBLEM = 'ORDER_PROBLEM',
  PAYMENT = 'PAYMENT',
  ACCOUNT = 'ACCOUNT',
  OTHER = 'OTHER',
}
export const PROTECTION_TYPES = [TicketType.NOT_RECEIVED, TicketType.NOT_AS_DESCRIBED];

export enum TicketStatus {
  /** Protection case waiting for the store's answer (48 hours). */
  WAITING_STORE = 'WAITING_STORE',
  /** Waiting for Fatrina support. */
  OPEN = 'OPEN',
  /** The store didn't answer in time: Fatrina decides. */
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}
export const ACTIVE_TICKET_STATUSES = [TicketStatus.WAITING_STORE, TicketStatus.OPEN, TicketStatus.ESCALATED];

export enum TicketOutcome {
  /** Decided for the customer; counts as a strike on the store. */
  CUSTOMER = 'CUSTOMER',
  STORE = 'STORE',
  /** Settled without blame (info given, solved together). */
  NEUTRAL = 'NEUTRAL',
}

@Schema({ _id: true })
export class TicketMessage {
  @Prop({ required: true }) author: 'CUSTOMER' | 'BRAND' | 'ADMIN';
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) authorId: Types.ObjectId;
  @Prop({ required: true }) text: string;
  @Prop({ type: [String], default: [] }) images: string[];
  @Prop({ required: true }) at: Date;
}
const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);

@Schema({ timestamps: true, collection: 'supportTickets' })
export class SupportTicket {
  @Prop({ required: true, unique: true })
  number: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  userName: string;

  @Prop({ type: String, enum: TicketType, required: true })
  type: TicketType;

  @Prop({ required: true })
  subject: string;

  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  orderId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  orderNumber: string | null;

  @Prop({ type: Types.ObjectId, ref: 'Brand', default: null })
  brandId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  brandName: string | null;

  /** Buyer-protection case: the store must answer within 48 hours. */
  @Prop({ default: false })
  protection: boolean;

  @Prop({ type: Date, default: null })
  storeDeadline: Date | null;

  @Prop({ type: String, enum: TicketStatus, required: true })
  status: TicketStatus;

  @Prop({ type: [TicketMessageSchema], default: [] })
  messages: TicketMessage[];

  @Prop({ type: Object, default: null })
  resolution: { outcome: TicketOutcome; note: string; at: Date; by: Types.ObjectId } | null;

  @Prop({ type: Date, default: null })
  escalatedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}
export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
SupportTicketSchema.index({ status: 1, updatedAt: -1 });
SupportTicketSchema.index({ brandId: 1, status: 1, updatedAt: -1 });
SupportTicketSchema.index({ status: 1, storeDeadline: 1 });
