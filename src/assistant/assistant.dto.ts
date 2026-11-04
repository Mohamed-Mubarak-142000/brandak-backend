import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ASSISTANT_TONES, AssistantTone } from '@/brands/brand.schema';
import { PageQueryDto } from '@/common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const bool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class AssistantMessageDto {
  /** Omit to start a new conversation; an id from another store/visitor also starts a new one. */
  @IsOptional() @IsMongoId() conversationId?: string;

  /** A random id the client keeps per browser/device (e.g. a UUID). */
  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9_.:-]+$/)
  visitorId: string;

  @Transform(trim)
  @IsString()
  @Length(1, 500)
  text: string;

  /** The product page the visitor is on. */
  @IsOptional() @IsMongoId() productId?: string;
}

/** Owner/admin PATCH: only the sent fields change. */
export class AssistantSettingsPatchDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsIn(ASSISTANT_TONES) tone?: AssistantTone;
  @IsOptional() @IsString() @MaxLength(2000) extraInfo?: string;
}

export class ConversationsQueryDto extends PageQueryDto {
  @IsOptional() @Transform(bool) @IsBoolean() unanswered?: boolean;
}

export class AdminConversationsQueryDto extends ConversationsQueryDto {
  @IsOptional() @IsMongoId() brandId?: string;
}

export class CopilotMessageDto {
  @IsOptional() @IsMongoId() conversationId?: string;

  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  text: string;
}
