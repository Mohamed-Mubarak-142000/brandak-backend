import { PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { StoreType } from '@/common/enums';

export class CreateCategoryDto {
  @IsString()
  @Length(2, 60)
  nameAr: string;

  @IsString()
  @Length(2, 60)
  nameEn: string;

  @Matches(/^[a-z0-9-]{2,60}$/)
  slug: string;

  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Store types that see this category when opening a store. Empty or missing = all. */
  @IsOptional()
  @IsArray()
  @IsEnum(StoreType, { each: true })
  storeTypes?: StoreType[];
}

export class CategoriesQueryDto {
  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
