import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

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
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
