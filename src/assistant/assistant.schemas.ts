import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';

@Schema({ _id: false })
export class AssistantMessage {
  @Prop({ type: String, enum: ['user', 'assistant'], required: true }) role: 'user' | 'assistant';
  @Prop({ required: true }) text: string;
  /** Products shown with an assistant reply. */
  @Prop({ type: [SchemaTypes.ObjectId], default: [] }) productIds: Types.ObjectId[];
  /** The assistant couldn't answer from the store's data (shown to the owner to fill the gap). */
  @Prop({ default: false }) unanswered: boolean;
  @Prop({ required: true }) at: Date;
}
const AssistantMessageSchema = SchemaFactory.createForClass(AssistantMessage);

/** A visitor's chat with one store's assistant. */
@Schema({ collection: 'assistantConversations', timestamps: true })
export class AssistantConversation {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Brand', required: true }) brandId: Types.ObjectId;
  /** Random id the client keeps per browser/device (not an identity). */
  @Prop({ required: true, maxlength: 64 }) visitorId: string;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' }) userId?: Types.ObjectId;
  /** The product page the chat started on. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Product' }) productId?: Types.ObjectId;
  @Prop({ type: [AssistantMessageSchema], default: [] }) messages: AssistantMessage[];
  @Prop({ required: true }) lastAt: Date;
  /** Number of messages (both sides). */
  @Prop({ default: 0 }) count: number;
  @Prop() ownerSeenAt?: Date;
  createdAt: Date;
}
export const AssistantConversationSchema = SchemaFactory.createForClass(AssistantConversation);
AssistantConversationSchema.index({ brandId: 1, lastAt: -1 });
AssistantConversationSchema.index({ brandId: 1, 'messages.unanswered': 1, lastAt: -1 });
AssistantConversationSchema.index({ visitorId: 1, brandId: 1 });

/** Assistant replies per store per (Cairo) day. */
@Schema({ collection: 'assistantUsage' })
export class AssistantUsage {
  @Prop({ type: SchemaTypes.ObjectId, required: true }) brandId: Types.ObjectId;
  @Prop({ required: true }) day: string;
  @Prop({ default: 0 }) count: number;
}
export const AssistantUsageSchema = SchemaFactory.createForClass(AssistantUsage);
AssistantUsageSchema.index({ brandId: 1, day: 1 }, { unique: true });

/** Assistant messages per visitor (or signed-in user) per day, across all stores. */
@Schema({ collection: 'assistantVisitorUsage' })
export class AssistantVisitorUsage {
  /** `u:<userId>` when signed in, else `v:<visitorId>`. */
  @Prop({ required: true }) key: string;
  @Prop({ required: true }) day: string;
  @Prop({ default: 0 }) count: number;
}
export const AssistantVisitorUsageSchema = SchemaFactory.createForClass(AssistantVisitorUsage);
AssistantVisitorUsageSchema.index({ key: 1, day: 1 }, { unique: true });

@Schema({ _id: false })
export class CopilotMessage {
  @Prop({ type: String, enum: ['user', 'assistant'], required: true }) role: 'user' | 'assistant';
  @Prop({ required: true }) text: string;
  @Prop({ required: true }) at: Date;
}
const CopilotMessageSchema = SchemaFactory.createForClass(CopilotMessage);

/** A store owner's chat with the seller copilot. */
@Schema({ collection: 'copilotConversations', timestamps: true })
export class CopilotConversation {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Brand', required: true }) brandId: Types.ObjectId;
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true }) userId: Types.ObjectId;
  @Prop({ type: [CopilotMessageSchema], default: [] }) messages: CopilotMessage[];
  @Prop({ required: true }) lastAt: Date;
}
export const CopilotConversationSchema = SchemaFactory.createForClass(CopilotConversation);
CopilotConversationSchema.index({ brandId: 1, userId: 1, lastAt: -1 });

@Schema({ collection: 'copilotUsage' })
export class CopilotUsage {
  @Prop({ type: SchemaTypes.ObjectId, required: true }) brandId: Types.ObjectId;
  @Prop({ required: true }) day: string;
  @Prop({ default: 0 }) count: number;
}
export const CopilotUsageSchema = SchemaFactory.createForClass(CopilotUsage);
CopilotUsageSchema.index({ brandId: 1, day: 1 }, { unique: true });
