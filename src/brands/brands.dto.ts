import { OmitType, PartialType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BrandStatus, StoreType } from '@/common/enums';
import { GOVERNORATE_CODES } from '@/common/governorates';
import { PageQueryDto } from '@/common/pagination';

export class BrandContactDto {
  @IsString()
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp?: string;
}

export class SocialLinksDto {
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(300) instagram?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(300) facebook?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(300) tiktok?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(300) website?: string;
}

export class CreateBrandApplicationDto {
  /** Kind of business: brand, showroom, warehouse or shop. */
  @IsEnum(StoreType)
  storeType: StoreType;

  @IsString()
  @Length(2, 60)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsMongoId({ each: true })
  categoryIds: string[];

  @ValidateNested()
  @Type(() => BrandContactDto)
  contact: BrandContactDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  /** Id returned by POST /uploads with purpose BRAND_LOGO. */
  @IsOptional()
  @IsMongoId()
  logoFileId?: string;

  @IsOptional()
  @IsMongoId()
  coverFileId?: string;
}

export class ShippingZoneDto {
  @IsIn(GOVERNORATE_CODES)
  governorate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  fee: number;
}

export class BrandSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(27)
  @ValidateNested({ each: true })
  @Type(() => ShippingZoneDto)
  shippingZones?: ShippingZoneDto[];

  /** null = no delivery outside the listed zones. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  defaultShippingFee?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  freeShippingThreshold?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  processingDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shippingPolicy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  returnPolicy?: string;

  @IsOptional()
  @IsBoolean()
  acceptsOrders?: boolean;
}

export class UpdateBrandDto extends PartialType(OmitType(CreateBrandApplicationDto, ['contact'] as const)) {
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandContactDto)
  contact?: BrandContactDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BrandSettingsDto)
  settings?: BrandSettingsDto;
}

export class BrandsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;

  @IsOptional()
  @IsIn(['newest', 'rating', 'name'])
  sort?: 'newest' | 'rating' | 'name';
}

export class AdminBrandsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;

  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;

  /** true = only soft-deleted stores; otherwise deleted stores are left out. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  deleted?: boolean;
}

export class ReasonDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}
