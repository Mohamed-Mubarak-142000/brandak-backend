import { PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BillingPeriod, PaymentStatus, SubscriptionStatus } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';

export class RequestSubscriptionDto {
  @IsMongoId()
  planId: string;

  @IsEnum(BillingPeriod)
  billingPeriod: BillingPeriod;
}

export class SubmitPaymentProofDto {
  /** Id from POST /uploads with purpose PAYMENT_PROOF. */
  @IsMongoId()
  proofFileId: string;

  @IsString()
  @Length(4, 64)
  transactionReference: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderName?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class ApprovePaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}

export class RejectPaymentDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class AdminPaymentsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /** oldest = first come, first reviewed (the review queue); newest = history. */
  @IsOptional()
  @IsIn(['oldest', 'newest'])
  sort?: 'oldest' | 'newest';

  @IsOptional()
  @IsMongoId()
  brandId?: string;

  /** true = only soft-deleted payments. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  deleted?: boolean;
}

export class AdminSubscriptionsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsMongoId()
  brandId?: string;

  /** true = only soft-deleted payments. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  deleted?: boolean;
}

class PlanLimitsDto {
  @IsInt()
  @Min(1)
  maxActiveProducts: number;
}

export class CreatePlanDto {
  @Matches(/^[A-Z_]{2,30}$/)
  code: string;

  @IsString() @Length(2, 60) nameAr: string;
  @IsString() @Length(2, 60) nameEn: string;

  @IsOptional() @IsString() @MaxLength(500) descriptionAr?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceMonthly: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceYearly: number;

  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limits: PlanLimitsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  features?: string[];

  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
