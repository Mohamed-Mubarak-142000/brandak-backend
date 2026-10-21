import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsMongoId, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ReportStatus, ReportTarget, ReviewStatus } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';

export class CreateReviewDto {
  /** A delivered order of yours that contains this product. */
  @IsMongoId()
  orderId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  /** Ids from POST /uploads with purpose REVIEW_IMAGE. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsMongoId({ each: true })
  imageFileIds?: string[];
}

export class ReplyReviewDto {
  @IsString()
  @Length(2, 500)
  text: string;
}

export const REPORT_REASONS = ['SPAM', 'OFFENSIVE', 'FAKE', 'PROHIBITED_PRODUCT', 'FRAUD', 'OTHER'] as const;

export class CreateReportDto {
  @IsEnum(ReportTarget)
  targetType: ReportTarget;

  @IsMongoId()
  targetId: string;

  @IsIn(REPORT_REASONS)
  reason: (typeof REPORT_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ReportsQueryDto extends PageQueryDto {
  @IsOptional() @IsEnum(ReportStatus) status?: ReportStatus;
  @IsOptional() @IsEnum(ReportTarget) targetType?: ReportTarget;
  /** true = only soft-deleted reports. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() deleted?: boolean;
}

export class ResolveReportDto {
  @IsIn([ReportStatus.RESOLVED, ReportStatus.DISMISSED])
  status: ReportStatus;

  @IsString()
  @Length(3, 500)
  resolutionNote: string;
}

export class SetReviewStatusDto {
  @IsEnum(ReviewStatus)
  status: ReviewStatus;
}

export class BrandReviewsQueryDto extends PageQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unanswered?: boolean;
}
