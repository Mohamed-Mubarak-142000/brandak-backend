import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { FilePurpose, FileVisibility } from '@/common/enums';

@Schema({ timestamps: true })
export class StoredFile {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ type: String, enum: FilePurpose, required: true })
  purpose: FilePurpose;

  @Prop({ type: String, enum: FileVisibility, required: true })
  visibility: FileVisibility;

  @Prop({ required: true })
  key: string;

  @Prop()
  url?: string;

  @Prop({ required: true })
  mime: string;

  @Prop({ required: true })
  size: number;
}

export type StoredFileDocument = HydratedDocument<StoredFile>;
export const StoredFileSchema = SchemaFactory.createForClass(StoredFile);
StoredFileSchema.index({ ownerId: 1, purpose: 1 });
