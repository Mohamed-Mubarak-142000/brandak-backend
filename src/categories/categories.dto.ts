import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { StoreType } from '@/common/enums';
import { SIZE_PRESETS, SpecType } from './category-template';

export class SpecDefDto {
  @Matches(/^[a-z][a-z0-9_]{1,30}$/)
  key: string;

  @IsString()
  @Length(1, 40)
  labelAr: string;

  @IsIn(['text', 'number', 'select', 'boolean'])
  type: SpecType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(15)
  unit?: string;

  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() filterable?: boolean;
}

export class SizeAxisDto {
  @IsString()
  @Length(1, 20)
  label: string;

  @IsOptional()
  @IsIn(Object.keys(SIZE_PRESETS))
  preset?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  values?: string[];

  @IsOptional() @IsBoolean() allowCustom?: boolean;
}

export class ColorAxisDto {
  @IsString()
  @Length(1, 20)
  label: string;

  @IsOptional() @IsBoolean() allowCustom?: boolean;
}

/** Leave a field out to inherit it from the parent; null turns an axis off. */
export class CategoryTemplateDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SizeAxisDto)
  size?: SizeAxisDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ColorAxisDto)
  color?: ColorAxisDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SpecDefDto)
  specs?: SpecDefDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  units?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  sizeGuide?: string;
}

export class CreateCategoryDto {
  @IsString()
  @Length(2, 60)
  nameAr: string;

  @IsString()
  @Length(2, 60)
  nameEn: string;

  @Matches(/^[a-z0-9-]{2,60}$/)
  slug: string;

  /** null moves the category to the top level. */
  @IsOptional()
  @IsMongoId()
  parentId?: string | null;

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

  /** null clears the category's own template (it then inherits everything). */
  @IsOptional()
  @ValidateNested()
  @Type(() => CategoryTemplateDto)
  template?: CategoryTemplateDto | null;
}

export class CategoriesQueryDto {
  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
