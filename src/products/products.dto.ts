import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductStatus } from '@/common/enums';
import { PageQueryDto } from '@/common/pagination';

export class VariantDto {
  /** Present when updating an existing variant; omit to create a new one. */
  @IsOptional()
  @IsMongoId()
  id?: string;

  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(30) size?: string;
  @IsOptional() @IsString() @MaxLength(30) color?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  price?: number | null;

  @IsInt()
  @Min(0)
  @Max(100_000)
  stock: number;
}

export class SaleDto {
  @IsInt()
  @Min(1)
  @Max(90)
  percent: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsDateString()
  endsAt: string;

  /** Join a running season (White Friday, Ramadan...). */
  @IsOptional()
  @IsMongoId()
  campaignId?: string;
}

export class WholesaleTierDto {
  @IsInt()
  @Min(2)
  @Max(100_000)
  minQty: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  price: number;
}

export class WholesaleDto {
  /** Fewest pieces of this product per order (all sizes and colours together). */
  @IsInt()
  @Min(1)
  @Max(10_000)
  minQty: number;

  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => WholesaleTierDto)
  tiers: WholesaleTierDto[];
}

export class CreateProductDto {
  @IsString()
  @Length(2, 120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsMongoId()
  categoryId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  price: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  compareAtPrice?: number | null;

  /** null removes a sale. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleDto)
  sale?: SaleDto | null;

  /** Quantity prices and a minimum order; null removes them. */
  @IsOptional()
  @ValidateNested()
  @Type(() => WholesaleDto)
  wholesale?: WholesaleDto | null;

  /** Ids from POST /uploads with purpose PRODUCT_IMAGE; the first is the cover image. */
  @IsArray()
  @ArrayMaxSize(10)
  @IsMongoId({ each: true })
  imageFileIds: string[];

  /** Same order as imageFileIds: the colour each photo shows ("" = every colour). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  imageColors?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  /** ACTIVE publishes the product (needs an active subscription within plan limits). */
  @IsOptional()
  @IsIn([ProductStatus.DRAFT, ProductStatus.ACTIVE])
  status?: ProductStatus;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}

export class AdjustStockDto {
  /** Positive to add stock, negative to remove. */
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  delta: number;
}

export class BrandProductsQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
}

export class ProductsQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsMongoId() categoryId?: string;
  /** Several categories at once (comma-separated ids); products in any of them match. */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',')).map((v: string) => v.trim()).filter(Boolean))
  @IsArray()
  @ArrayMaxSize(30)
  @IsMongoId({ each: true })
  categoryIds?: string[];
  @IsOptional() @IsMongoId() brandId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsIn(['newest', 'price_asc', 'price_desc', 'rating', 'popular', 'discount'])
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'popular' | 'discount';

  /** Only products with a sale running now. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  onSale?: boolean;

  /** Only products on sale in this season. */
  @IsOptional()
  @IsMongoId()
  campaignId?: string;
}
